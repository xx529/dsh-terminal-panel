// Host v8 一致性回归（contract v8 §4.2.8/§4.2.9、§8.6；ui-spec v6 A21/A22）
// 覆盖：resync 全量重发（不产生 removed、cursors:null 等价）、removed/runs 同帧互斥、
// prune(protect) 保护本帧 discovery 已见 Run、job-only 相邻帧无 removed↔runs 抖动、revision 单调。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule } from '../helpers/host-modules.mjs'
import { createFakeHostCtx, createFakeJobsService, createFakeTerminalsService } from '../helpers/fakes.mjs'

const m = await loadHostModule('panel')
const skip = m.missing ? m.reason : false
const jobRunId = (id) => `job:${id}`
const terminalRunId = (id) => `terminal:${id}`

function liveAgents(root = 'root-1') {
  const agent = { id: root }
  return { get: (id) => (id === root ? agent : undefined), list: () => [agent], roots: () => [agent] }
}

function baseServices(extra = {}) {
  return {
    agents: liveAgents(),
    subagents: { listDescendants: () => [] },
    agentTeams: { listMembers: () => [], membership: () => undefined, tryMembership: () => undefined },
    jobs: createFakeJobsService(),
    terminals: createFakeTerminalsService(),
    ...extra,
  }
}

function makePanel(services = baseServices(), config = {}) {
  const fake = createFakeHostCtx({ services, config })
  const panel = m.ok ? m.mod.createPanel({ ctx: fake.ctx, config, now: () => 1_700_000_000_000 }) : undefined
  return { panel, fake, services }
}

async function poll(panel, params = {}) {
  const r = await panel.handleRpc('panel.poll', { sessionId: 'root-1', ...params })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const value = r.value
  // v8 硬不变量：同一帧 removed 与 runs 不得包含同一 runId
  const runIds = new Set((value.runs ?? []).map((run) => run.runId))
  for (const removedId of value.removed ?? []) {
    assert.ok(!runIds.has(removedId), `v8 不变量：removed 与 runs 同帧互斥，冲突 runId=${removedId}`)
  }
  return value
}

const runIdsOf = (frame) => (frame.runs ?? []).map((run) => run.runId)

/* 1) resync：已终态 job/terminal 在 1–3 帧内重新出现，且 removed=[] */
test('resync：已终态 job/terminal 在 1–3 帧内重新出现，且不产生 removed（v8 §4.2.8）', { skip }, async () => {
  const jobs = createFakeJobsService([
    { id: 'job-done', owner: 'root-1', status: 'completed', output: 'done\n', startedAt: 1_000, finishedAt: 2_000 },
  ])
  const { panel } = makePanel(baseServices({ jobs }))
  // 预置一条已终态 terminal Run（不再由 source 重新登记，但保留在注册表）
  panel.store.upsert({
    runId: terminalRunId('term-done'),
    kind: 'terminal',
    ownerSessionId: 'root-1',
    title: '终端',
    command: 'dev',
    startedAt: 1_000,
    status: 'completed',
    finishedAt: 2_000,
    handle: { terminalId: 'term-done' },
  })

  let frame = await poll(panel)
  assert.ok(runIdsOf(frame).includes(terminalRunId('term-done')) || runIdsOf(frame).includes(jobRunId('job-done')))
  // 普通轮询把在途变化发完后，resync 应把可见 Run 全部重发（可跨多帧收敛）
  frame = await poll(panel, { cursors: frame.nextCursors })
  const seen = new Set(runIdsOf(frame))
  let removedAcc = []
  for (let i = 0; i < 3; i += 1) {
    frame = await poll(panel, { resync: true, cursors: frame.nextCursors })
    assert.deepEqual(frame.removed, [], 'resync 不得产生 removed（只重发不删）')
    for (const id of runIdsOf(frame)) seen.add(id)
    removedAcc = removedAcc.concat(frame.removed ?? [])
  }
  assert.ok(seen.has(jobRunId('job-done')), 'resync 后已终态 job 必须重新出现')
  assert.ok(seen.has(terminalRunId('term-done')), 'resync 后已终态 terminal 必须重新出现')
  assert.deepEqual(removedAcc, [])
  assert.equal(panel.store.get(jobRunId('job-done')) !== undefined, true, 'resync 不得删除 Run')
  await panel.dispose?.()
})

/* 2) cursors:null 与 resync:true 等价（兼容旧客户端的无状态信号） */
test('cursors:null 等价于 resync:true（无状态信号），同样重发且无 removed', { skip }, async () => {
  const jobsA = createFakeJobsService([{ id: 'job-eq', owner: 'root-1', status: 'completed', output: 'x\n', finishedAt: 2_000 }])
  const a = makePanel(baseServices({ jobs: jobsA }))
  const frameA1 = await poll(a.panel)
  await poll(a.panel, { cursors: frameA1.nextCursors })
  const frameA2 = await poll(a.panel, { resync: true })
  const aIds = new Set(runIdsOf(frameA2))

  const jobsB = createFakeJobsService([{ id: 'job-eq', owner: 'root-1', status: 'completed', output: 'x\n', finishedAt: 2_000 }])
  const b = makePanel(baseServices({ jobs: jobsB }))
  const frameB1 = await poll(b.panel)
  await poll(b.panel, { cursors: frameB1.nextCursors })
  const frameB2 = await poll(b.panel, { cursors: null })
  const bIds = new Set(runIdsOf(frameB2))

  assert.deepEqual([...aIds].sort(), [...bIds].sort(), 'cursors:null 与 resync:true 的交付集必须一致')
  assert.deepEqual(frameA2.removed, [])
  assert.deepEqual(frameB2.removed, [])
  assert.ok(aIds.has(jobRunId('job-eq')))
  await a.panel.dispose?.()
  await b.panel.dispose?.()
})

/* 3) removed/runs 互斥：同帧冲突以 runs 为准（被重新 discovery 的 Run 不再出现在 removed） */
test('removed/runs 同帧互斥：已被 source 重新登记的 Run 从 removed 中剔除（runs 优先）', { skip }, async () => {
  const jobs = createFakeJobsService([
    { id: 'job-conflict', owner: 'root-1', status: 'completed', output: 'x\n', finishedAt: 2_000 },
  ])
  const { panel } = makePanel(baseServices({ jobs }))
  const first = await poll(panel)
  assert.ok(runIdsOf(first).includes(jobRunId('job-conflict')))
  // 模拟 prune 把该 Run 移除：下一帧 discovery 又从 jobs.list 重新登记 → removed 与 runs 冲突
  panel.store.remove(jobRunId('job-conflict'))
  const conflict = await poll(panel, { cursors: first.nextCursors })
  const ids = runIdsOf(conflict)
  assert.ok(ids.includes(jobRunId('job-conflict')), '重新登记后本帧必须交付该 Run（runs 优先）')
  assert.deepEqual(conflict.removed, [], '同帧冲突时 removed 必须剔除（延后一帧）')
  for (const id of conflict.removed) assert.ok(!ids.includes(id))
  await panel.dispose?.()
})

/* 4) removed 正常路径（未被重新发现）：removed 出现且 runs 不含该 id */
test('removed 正常路径：服务端移除且未被 source 重发现的 Run → removed 出现、runs 不含', { skip }, async () => {
  const { panel } = makePanel(baseServices())
  const runId = terminalRunId('term-removed')
  panel.store.upsert({
    runId,
    kind: 'terminal',
    ownerSessionId: 'root-1',
    title: '终端',
    status: 'completed',
    startedAt: 1_000,
    finishedAt: 2_000,
    handle: { terminalId: 'term-removed' },
  })
  let frame = await poll(panel)
  assert.ok(runIdsOf(frame).includes(runId))
  panel.store.remove(runId)
  frame = await poll(panel, { cursors: frame.nextCursors })
  assert.ok((frame.removed ?? []).includes(runId), '被移除且未重发现的 Run 必须出现在 removed')
  assert.ok(!runIdsOf(frame).includes(runId), 'removed 的 Run 不得同时出现在 runs')
  await panel.dispose?.()
})

/* 5) prune(protect)：保护本帧 discovery 已见 Run，不被过期/条数淘汰 */
test('prune(now,{protect})：被保护的 Run 一律不淘汰；无保护时按 completedLimit 淘汰最旧', { skip }, async () => {
  const { panel } = makePanel(baseServices(), { completedLimit: 1 })
  const stamp = 1_700_000_000_000
  const upsert = (id, finishedAt) => panel.store.upsert({
    runId: terminalRunId(id),
    kind: 'terminal',
    ownerSessionId: 'root-1',
    title: '终端',
    status: 'completed',
    startedAt: finishedAt - 1_000,
    finishedAt,
    handle: { terminalId: id },
  })
  upsert('newest', stamp - 1_000)
  upsert('older', stamp - 2_000)
  // 受保护：older 已超 completedLimit 但仍应保留
  const protectedVictims = panel.store.prune(stamp, { protect: new Set([terminalRunId('older')]) })
  assert.equal(protectedVictims.includes(terminalRunId('older')), false, 'protect 的 Run 不得被 prune')
  assert.ok(panel.store.get(terminalRunId('older')) !== undefined)
  // 无保护：completedLimit=1 → 最旧被淘汰
  const victims = panel.store.prune(stamp)
  assert.ok(victims.includes(terminalRunId('older')), '无保护时超条数的最旧 Run 必须淘汰')
  assert.ok(panel.store.get(terminalRunId('newest')) !== undefined)
  await panel.dispose?.()
})

/* 6) job-only 相邻帧不抖动：已结算 job 被反复 list 到，不得出现 removed→重新 add */
test('A22 job-only 相邻帧稳定：已结算 job 反复 discovery 不产生 removed / 重复列', { skip }, async () => {
  const jobs = createFakeJobsService([
    { id: 'job-stable', owner: 'root-1', status: 'completed', output: 'ok\n', startedAt: 1_000, finishedAt: 2_000 },
  ])
  const { panel } = makePanel(baseServices({ jobs }))
  let frame = await poll(panel)
  assert.ok(runIdsOf(frame).includes(jobRunId('job-stable')))
  let cursor = frame.nextCursors
  for (let i = 0; i < 3; i += 1) {
    frame = await poll(panel, { cursors: cursor })
    cursor = frame.nextCursors
    assert.deepEqual(frame.removed, [], `第 ${i + 1} 帧不得出现 removed（移除→重新登记抖动）`)
    assert.ok(panel.store.get(jobRunId('job-stable')) !== undefined, 'Run 必须持续保留在注册表')
  }
  await panel.dispose?.()
})

/* 7) revision 单调：普通帧与 resync 帧都推进 revision（服务端不重置） */
test('revision 单调：poll 与 resync poll 都递增 revision（v8 回退只发生在服务端重建）', { skip }, async () => {
  const { panel } = makePanel(baseServices())
  const r1 = await poll(panel)
  const r2 = await poll(panel, { cursors: r1.nextCursors })
  const r3 = await poll(panel, { resync: true })
  assert.ok(r2.revision > r1.revision)
  assert.ok(r3.revision > r2.revision)
  await panel.dispose?.()
})
