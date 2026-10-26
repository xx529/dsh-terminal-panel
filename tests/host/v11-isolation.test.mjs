// Host v11 P0 会话隔离回归（contract v11；ui-spec v9 A34–A38 host 侧）
// 双 session mock：帧/增量/removed/prune/resync/terminal/kill 全部按会话隔离。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule } from '../helpers/host-modules.mjs'
import { createFakeHostCtx, createFakeJobsService } from '../helpers/fakes.mjs'

const m = await loadHostModule('panel')
const skip = m.missing ? m.reason : false
const terminalRunId = (id) => `terminal:${id}`
const jobRunId = (id) => `job:${id}`

/** 身份敏感 terminals 假服务：只认 registry 里的同一 Agent 对象。 */
function makeIdentityTerminals(snapshots) {
  const calls = { list: 0, read: 0, listOwners: [], readOwners: [] }
  const entries = new Map(snapshots.map((item) => [item.owner, item]))
  return {
    calls,
    list(agent) {
      calls.list += 1
      calls.listOwners.push(agent?.id)
      const entry = entries.get(agent)
      return entry === undefined ? [] : [{ sessionId: entry.id, name: entry.name ?? 'dev', type: 'zsh', pid: 1, status: { kind: 'running' } }]
    },
    read(agent, terminalId, opts = {}) {
      calls.read += 1
      calls.readOwners.push(agent?.id)
      const entry = entries.get(agent)
      if (entry === undefined) throw new Error('owner mismatch')
      const lines = entry.lines ?? ['$ ls', 'a b c']
      const count = Math.min(opts.count ?? 400, 4000)
      const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.min(opts.offset, lines.length)) : 0
      const end = Math.max(0, lines.length - offset)
      const start = Math.max(0, end - count)
      const slice = lines.slice(start, end)
      return { text: slice.join('\n'), totalLines: lines.length, lineBegin: offset, lineEnd: offset + slice.length, truncated: start > 0 || offset > 0 }
    },
    kill() {
      return 'requested'
    },
    hasOwnerActivity(agent) {
      return entries.has(agent)
    },
  }
}

function makeAgents(agentsById) {
  return {
    get: (id) => agentsById[id],
    list: () => Object.values(agentsById),
    roots: () => [agentsById[Object.keys(agentsById)[0]]].filter(Boolean),
  }
}

const baseServices = (extra = {}) => ({
  subagents: { listDescendants: () => [] },
  agentTeams: { listMembers: () => [], membership: () => undefined, tryMembership: () => undefined },
  jobs: createFakeJobsService(),
  ...extra,
})

function makePanel(services, config = {}) {
  const fake = createFakeHostCtx({ services, config })
  const panel = m.ok ? m.mod.createPanel({ ctx: fake.ctx, config, now: () => 1_700_000_000_000 }) : undefined
  return { panel, fake }
}

async function poll(panel, sessionId, params = {}) {
  const r = await panel.handleRpc('panel.poll', { sessionId, ...params })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const frame = r.value
  const runIds = new Set((frame.runs ?? []).map((run) => run.runId))
  for (const removedId of frame.removed ?? []) assert.ok(!runIds.has(removedId), `removed/runs 同帧互斥：${removedId}`)
  return frame
}

const runIdsOf = (frame) => (frame.runs ?? []).map((run) => run.runId)
const deltaText = (delta) => {
  if (delta === undefined) return ''
  if (typeof delta.text === 'string') return delta.text
  if (Array.isArray(delta.chunks)) return delta.chunks.map((chunk) => chunk.text ?? '').join('')
  return ''
}
const ownersOf = (frame) => (frame.runs ?? []).map((run) => run.ownerSessionId)
const terminalOf = (frame, id) => (frame.runs ?? []).find((run) => run.runId === terminalRunId(id))

function upsertTerminal(panel, id, ownerSessionId, over = {}) {
  panel.store.upsert({
    runId: terminalRunId(id),
    kind: 'terminal',
    ownerSessionId,
    title: '终端',
    command: 'dev',
    startedAt: 1_000,
    status: 'running',
    handle: { terminalId: id },
    ...over,
  })
}

/* 1) 帧隔离 + 诊断口径 */
test('A34 帧隔离：A 的 run 不出现在 B 帧；diagnostics.frameSessionId/allowedSessions/scopedRuns/droppedForeignRuns 正确', { skip }, async () => {
  const jobs = createFakeJobsService([
    { id: 'job-a', owner: 'root-a', status: 'running', output: 'A-output\n', startedAt: 1_000 },
    { id: 'job-b', owner: 'root-b', status: 'running', output: 'B-output\n', startedAt: 2_000 },
  ])
  const { panel } = makePanel(baseServices({ jobs, agents: makeAgents({ 'root-a': { id: 'root-a' }, 'root-b': { id: 'root-b' } }) }))
  const frameA1 = await poll(panel, 'root-a')
  assert.ok(runIdsOf(frameA1).includes(jobRunId('job-a')))
  const frameB1 = await poll(panel, 'root-b')
  assert.ok(runIdsOf(frameB1).includes(jobRunId('job-b')))
  assert.ok(!runIdsOf(frameB1).includes(jobRunId('job-a')), 'B 帧不得含 A 的 job run')
  assert.ok(ownersOf(frameB1).every((owner) => owner === 'root-b'), 'B 帧 runs 的 ownerSessionId 必须全属于 B 树')
  // 第二轮 A：store 里已有 B 的 run → 必须被隔离并计数
  const frameA2 = await poll(panel, 'root-a', { cursors: frameA1.nextCursors })
  assert.ok(!runIdsOf(frameA2).includes(jobRunId('job-b')), 'A 帧不得含 B 的 job run')
  const diag = frameA2.diagnostics
  assert.equal(frameA2.sessionId, 'root-a')
  assert.equal(diag.frameSessionId, 'root-a', 'frameSessionId 必须等于请求 sessionId')
  assert.equal(diag.allowedSessions, 1, 'allowedSessions = 本会话树数')
  assert.ok(diag.scopedRuns >= 1, 'scopedRuns 只数本会话 run')
  assert.ok(diag.droppedForeignRuns >= 1, 'B 的 run 必须计入 droppedForeignRuns')
  assert.equal(diag.removedSent, (frameA2.removed ?? []).length, 'removedSent === frame.removed.length')
  // B 的诊断同理
  assert.equal(frameB1.diagnostics.frameSessionId, 'root-b')
  assert.ok(frameB1.diagnostics.droppedForeignRuns >= 1)
  await panel.dispose?.()
})

/* 2) 增量不跨会话：B poll 不消费 A 的 pending */
test('A35 A 的未交付增量不被 B 偷取：B poll 后 A 继续能拿到剩余输出', { skip }, async () => {
  const output = 'x'.repeat(6000)
  const jobs = createFakeJobsService([
    { id: 'job-a', owner: 'root-a', status: 'running', output, startedAt: 1_000 },
    { id: 'job-b', owner: 'root-b', status: 'running', output: 'B\n', startedAt: 2_000 },
  ])
  const { panel } = makePanel(baseServices({ jobs, agents: makeAgents({ 'root-a': { id: 'root-a' }, 'root-b': { id: 'root-b' } }) }), { maxFrameBytes: 4096 })
  let frame = await poll(panel, 'root-a')
  let received = deltaText(frame.runs.find((run) => run.runId === jobRunId('job-a'))?.output?.job).length
  let cursors = frame.nextCursors
  // B 轮询（不得消费 A pending）
  await poll(panel, 'root-b')
  for (let i = 0; i < 10 && received < output.length; i += 1) {
    frame = await poll(panel, 'root-a', { cursors })
    cursors = frame.nextCursors
    const run = frame.runs.find((entry) => entry.runId === jobRunId('job-a'))
    received += deltaText(run?.output?.job).length
  }
  assert.equal(received, output.length, 'B poll 后 A 仍能收齐自己的全部输出（pending 未被偷）')
  await panel.dispose?.()
})

/* 3) removed 按会话 drain */
test('A36 removed 不跨会话：A 的 removed 只由 A 收到，B 不吞', { skip }, async () => {
  const { panel } = makePanel(baseServices({ agents: makeAgents({ 'root-a': { id: 'root-a' }, 'root-b': { id: 'root-b' } }) }))
  upsertTerminal(panel, 'term-a', 'root-a', { status: 'completed', finishedAt: 2_000 })
  const frameA1 = await poll(panel, 'root-a')
  assert.ok(runIdsOf(frameA1).includes(terminalRunId('term-a')))
  panel.store.remove(terminalRunId('term-a'))
  const frameB = await poll(panel, 'root-b')
  assert.ok(!(frameB.removed ?? []).includes(terminalRunId('term-a')), 'B 的 removed 不得含 A 的 run')
  assert.equal(frameB.diagnostics.removedSent, (frameB.removed ?? []).length)
  const frameA2 = await poll(panel, 'root-a', { cursors: frameA1.nextCursors })
  assert.ok((frameA2.removed ?? []).includes(terminalRunId('term-a')), 'A 必须收到自己的 removed')
  await panel.dispose?.()
})

/* 4) prune 每会话配额 */
test('A37 prune 不跨会话：B 的轮询不淘汰 A 的终态 Run；每会话配额独立', { skip }, async () => {
  const { panel } = makePanel(baseServices({ agents: makeAgents({ 'root-a': { id: 'root-a' }, 'root-b': { id: 'root-b' } }) }), { completedLimit: 1 })
  const upsertJob = (id, ownerSessionId, finishedAt) => panel.store.upsert({
    runId: jobRunId(id),
    kind: 'job',
    ownerSessionId,
    title: 'job',
    command: 'sleep 1',
    startedAt: 1_000,
    status: 'completed',
    finishedAt,
  })
  const now = 1_700_000_000_000
  upsertJob('a-new', 'root-a', now - 1_000)
  upsertJob('a-old', 'root-a', now - 2_000)
  upsertJob('b-new', 'root-b', now - 3_000)
  upsertJob('b-old', 'root-b', now - 4_000)
  const frameB1 = await poll(panel, 'root-b')
  assert.ok(panel.store.get(jobRunId('a-new')) !== undefined, 'A 的终态 Run 不得被 B prune')
  assert.ok(panel.store.get(jobRunId('a-old')) !== undefined)
  assert.equal(panel.store.get(jobRunId('b-old')), undefined, 'B 自己按配额淘汰最旧')
  assert.ok((frameB1.removed ?? []).includes(jobRunId('b-old')))
  assert.ok(!(frameB1.removed ?? []).includes(jobRunId('a-old')), 'B 的 removed 不得含 A 的 run')
  // A 轮询：A 自己的配额生效，B 的 Run 不受影响
  const frameA1 = await poll(panel, 'root-a')
  assert.equal(panel.store.get(jobRunId('a-old')), undefined, 'A 按自己的配额淘汰最旧')
  assert.ok(panel.store.get(jobRunId('a-new')) !== undefined)
  assert.ok(panel.store.get(jobRunId('b-new')) !== undefined, 'A 的 prune 不得淘汰 B 的 Run')
  assert.ok(!(frameA1.removed ?? []).includes(jobRunId('b-old')), 'A 的 removed 不得含 B 的 run')
  await panel.dispose?.()
})

/* 5) resync 只影响本会话 */
test('A37 resync 隔离：B 的 resync 不重置 A 的 metaDirty/读游标（A 不重复输出）', { skip }, async () => {
  const jobs = createFakeJobsService([
    { id: 'job-a', owner: 'root-a', status: 'completed', output: 'AAAA', startedAt: 1_000, finishedAt: 2_000 },
    { id: 'job-b', owner: 'root-b', status: 'completed', output: 'BBBB', startedAt: 1_000, finishedAt: 2_000 },
  ])
  const { panel } = makePanel(baseServices({ jobs, agents: makeAgents({ 'root-a': { id: 'root-a' }, 'root-b': { id: 'root-b' } }) }))
  const frameA1 = await poll(panel, 'root-a')
  assert.equal(deltaText(frameA1.runs.find((run) => run.runId === jobRunId('job-a'))?.output?.job), 'AAAA')
  const frameB1 = await poll(panel, 'root-b')
  assert.equal(deltaText(frameB1.runs.find((run) => run.runId === jobRunId('job-b'))?.output?.job), 'BBBB')
  // B resync：只重发 B
  const frameB2 = await poll(panel, 'root-b', { resync: true, cursors: frameB1.nextCursors })
  assert.ok(runIdsOf(frameB2).includes(jobRunId('job-b')), 'B resync 重发 B 自己的 run')
  assert.deepEqual(frameB2.removed, [])
  // A 正常轮询：不得因 B resync 而重复发 AAAA
  const frameA2 = await poll(panel, 'root-a', { cursors: frameA1.nextCursors })
  const aRun = frameA2.runs.find((run) => run.runId === jobRunId('job-a'))
  assert.ok(!deltaText(aRun?.output?.job).includes('AAAA'), 'A 不得因 B resync 重复输出')
  await panel.dispose?.()
})

/* 6) terminal 隔离 + 会话树内 subagent/teammate 仍解析 */
test('A34/A35 terminal 隔离：A 的 terminal 不出现在 B；B 树内 subagent owner 仍可 live', { skip }, async () => {
  const rootA = { id: 'root-a' }
  const rootB = { id: 'root-b' }
  const childB = { id: 'child-b' }
  const terminals = makeIdentityTerminals([
    { owner: rootA, id: 'pty-a', lines: ['$ a', 'A-live'] },
    { owner: rootB, id: 'pty-b', lines: ['$ b', 'B-live'] },
    { owner: childB, id: 'pty-bc', lines: ['$ c', 'C-live'] },
  ])
  const services = baseServices({
    agents: makeAgents({ 'root-a': rootA, 'root-b': rootB, 'child-b': childB }),
    subagents: { listDescendants: (rootId) => (rootId === 'root-b' ? [{ kind: 'child', id: 'child-b', parentId: 'root-b', depth: 1, label: 'worker', activity: 'running' }] : []) },
    terminals,
  })
  const { panel } = makePanel(services)
  const frameA1 = await poll(panel, 'root-a')
  assert.ok(terminalOf(frameA1, 'pty-a'), 'A 必须看到自己的 terminal')
  assert.equal(frameA1.diagnostics.terminalScopes, 1)
  const listOwnersBeforeB = terminals.calls.listOwners.length
  const readOwnersBeforeB = terminals.calls.readOwners.length
  const frameB = await poll(panel, 'root-b')
  const idsB = runIdsOf(frameB)
  assert.ok(idsB.includes(terminalRunId('pty-b')), 'B 必须看到自己的 root terminal')
  assert.ok(idsB.includes(terminalRunId('pty-bc')), 'B 树内 subagent terminal 仍可解析（v11 未取消树内 live）')
  assert.ok(!idsB.includes(terminalRunId('pty-a')), 'B 不得看到 A 的 terminal')
  assert.equal(frameB.diagnostics.terminalScopes, 2, 'terminalScopes = B 会话树（root + subagent）')
  assert.ok(frameB.diagnostics.droppedForeignRuns >= 1, 'A 的 terminal 计入 droppedForeignRuns')
  assert.ok(!terminals.calls.listOwners.slice(listOwnersBeforeB).includes('root-a'), 'B 不得对 A 的 owner 调 terminals.list')
  assert.ok(!terminals.calls.readOwners.slice(readOwnersBeforeB).includes('root-a'), 'B 不得对 A 的 owner 调 terminals.read')
  // 树内 subagent 输出 live
  const childRun = frameB.runs.find((run) => run.runId === terminalRunId('pty-bc'))
  assert.equal(childRun.outputMode, 'live', '树内 subagent owner 仍应升级 live')
  assert.ok((childRun.output?.terminal?.text ?? '').includes('C-live'))
  // A 第二轮不含 B 数据
  const frameA2 = await poll(panel, 'root-a', { cursors: frameA1.nextCursors })
  assert.ok(!runIdsOf(frameA2).includes(terminalRunId('pty-b')))
  assert.ok(!runIdsOf(frameA2).includes(terminalRunId('pty-bc')))
  await panel.dispose?.()
})

/* 7) 跨会话 kill 拒绝 */
test('跨会话 panel.kill 拒绝：B 对 A 的 runId → run-not-found', { skip }, async () => {
  const { panel } = makePanel(baseServices({ agents: makeAgents({ 'root-a': { id: 'root-a' }, 'root-b': { id: 'root-b' } }) }))
  upsertTerminal(panel, 'term-a', 'root-a')
  const frameA = await poll(panel, 'root-a')
  assert.ok(runIdsOf(frameA).includes(terminalRunId('term-a')))
  const denied = await panel.handleRpc('panel.kill', { sessionId: 'root-b', runId: terminalRunId('term-a') })
  assert.equal(denied.ok, false)
  assert.equal(denied.error.code, 'run-not-found', '跨会话 kill 必须按不存在处理（不泄漏存在性）')
  await panel.dispose?.()
})
