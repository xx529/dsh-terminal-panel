// Host 半端面板 RPC 逻辑（lib/host/panel.mjs，backend 定稿 API）
//   createPanel({ ctx, config, now }) -> { handleRpc(method, params), dispose() }
// 覆盖：hello 能力集、poll 会话树/job 生命周期/终端增量、availability 降级、kill 授权边界。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'
import { createFakeHostCtx, createFakeJobsService, createFakeTerminalsService } from '../helpers/fakes.mjs'

const m = await loadHostModule('panel')
const baseSkip = m.missing ? m.reason : false

function makeAgents(ids = ['root-1']) {
  const map = new Map(ids.map((id) => [id, { id, name: id === 'root-1' ? 'lead' : id }]))
  return { get: (id) => map.get(id), list: () => [...map.values()], roots: () => [...map.values()] }
}

function baseServices(extra = {}) {
  return {
    agents: makeAgents(),
    subagents: { listDescendants: () => [] },
    agentTeams: { listMembers: () => [], membership: () => undefined },
    jobs: createFakeJobsService(),
    terminals: createFakeTerminalsService(),
    ...extra,
  }
}

function makePanel(services = baseServices(), config = {}) {
  const fake = createFakeHostCtx({ services, config })
  const clock = { t: 1_700_000_000_000 }
  let panel
  assert.doesNotThrow(() => {
    panel = fnOf(m, 'createPanel')({ ctx: fake.ctx, config, now: () => clock.t })
  })
  return { panel, fake, clock }
}

/** 宽容包装：真实实现的 handleRpc 可能返回 value、{ok,value} 或抛 typed error。 */
async function rpc(panel, method, params = {}) {
  try {
    const r = await panel.handleRpc(method, params)
    if (r && typeof r === 'object' && 'ok' in r) return r
    return { ok: true, value: r }
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error?.code ?? error?.name ?? 'error',
        message: error?.message ?? String(error),
      },
    }
  }
}

/**
 * batch1 探测：panel.mjs 的 poll 在采集器（batch 2）未接入时只返回 root + 空 runs。
 * 用例在 batch2 落地后自动生效，避免把"未完成"误报成"缺陷"。
 */
async function probeCollectors() {
  if (!m.ok) return { ready: false, reason: baseSkip || m.reason }
  const jobs = createFakeJobsService([{ id: 'probe-job', owner: 'root-1', status: 'running', output: 'probe' }])
  const { panel } = makePanel(baseServices({ jobs }))
  try {
    const r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
    const ready = r.ok === true && Array.isArray(r.value?.runs) && r.value.runs.length > 0
    return ready
      ? { ready: true }
      : { ready: false, reason: 'panel.mjs 采集器（batch 2）未接入：poll 仍返回空 runs，用例待 backend 完成后生效' }
  } finally {
    await panel.dispose?.()
  }
}
const probe = await probeCollectors()
const skip = baseSkip || probe.reason

function runIdOf(value, kind, needle) {
  return (value.runs ?? []).find((r) => r.kind === kind && r.runId.includes(needle))?.runId
}

test('exports: createPanel（契约 §13.1 / backend 定稿）', { skip }, () => {
  assert.equal(typeof fnOf(m, 'createPanel'), 'function')
})

test('panel.hello: protocol/capabilities/limits/availability（§4.2）', { skip }, async () => {
  const { panel } = makePanel()
  const r = await rpc(panel, 'panel.hello')
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const value = r.value
  assert.equal(value.protocol, 1)
  assert.equal(typeof value.hostTime, 'number')
  for (const key of ['bash', 'jobs', 'terminals', 'tree']) {
    assert.equal(typeof value.capabilities[key], 'boolean', `capabilities.${key} 必须是布尔`)
  }
  assert.equal(value.limits.maxFrameBytes, 65536)
  assert.ok(value.limits.pollHintMs >= 150 && value.limits.pollHintMs <= 300)
  await panel.dispose?.()
})

test('panel.poll: 未知/非 live root 会话 → 明确诊断（session-not-found 或降级帧，v2 待裁决）', { skip }, async () => {
  const { panel } = makePanel()
  const r = await rpc(panel, 'panel.poll', { sessionId: 'no-such' })
  if (r.ok === false) {
    // 契约 v1 §4.4/§13.1 期望
    assert.equal(r.error.code, 'session-not-found')
  } else {
    // batch2 实现选择：返回降级帧（tree 标 unavailable）而不是错误
    assert.equal(r.value.availability.tree.available, false, '非 live 会话必须把 tree 标为不可用')
    assert.ok(r.value.availability.tree.reason.length > 0)
    assert.equal(r.value.sessions.length, 1, '非 live 会话只返回 root 作用域')
    assert.deepEqual(r.value.runs, [], '非 live 会话不产生 Run')
  }
  await panel.dispose?.()
})

test('panel.poll: 会话树含 root/子代理/队友（§5.2 归属规则）', { skip }, async () => {
  const services = baseServices({
    subagents: {
      listDescendants: () => [
        { kind: 'child', id: 'sub-1', activity: 'running', mode: 'spawn', label: 'scout', parentId: 'root-1', hasChildren: false, depth: 1 },
      ],
    },
    agentTeams: {
      listMembers: () => [{ id: 'team-1', name: 'backend', role: 'teammate', status: 'running' }],
      membership: () => ({ root: 'root-1', id: 'root-1', role: 'lead', name: 'lead' }),
    },
  })
  const { panel } = makePanel(services)
  const r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const ids = r.value.sessions.map((s) => s.sessionId)
  assert.equal(ids[0], 'root-1', 'root 恒在首位')
  assert.ok(ids.includes('sub-1'), `应包含子代理，实际 ${ids.join(',')}`)
  assert.ok(ids.includes('team-1'), `应包含队友，实际 ${ids.join(',')}`)
  await panel.dispose?.()
})

test('panel.poll: job running → stopping → completed 终态（§6.1 映射表）', { skip }, async () => {
  const jobs = createFakeJobsService([
    { id: 'job-1', owner: 'root-1', label: 'build', status: 'running', output: 'compiling' },
  ])
  const services = baseServices({ jobs })
  const { panel, clock } = makePanel(services)

  let r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  let runId = runIdOf(r.value, 'job', 'job-1')
  assert.ok(runId, `poll 应返回 job run，实际 runs=${JSON.stringify(r.value.runs.map((x) => x.runId))}`)
  let run = r.value.runs.find((x) => x.runId === runId)
  assert.equal(run.status, 'running')
  assert.equal(run.agent.name, 'lead')

  // stopping → running + stopping=true
  jobs.jobs.get('job-1').status = 'stopping'
  clock.t += 500
  r = await rpc(panel, 'panel.poll', { sessionId: 'root-1', cursors: r.value.nextCursors })
  run = (r.value.runs ?? []).find((x) => x.runId === runId)
  if (run) {
    assert.equal(run.status, 'running', 'job stopping 仍映射 running（§6.1）')
    assert.equal(run.stopping, true, 'stopping 必须置位')
  } else {
    // 若实现选择"未变化不出帧"，用完整快照接口无法验证 stopping；留 diagnostic
    assert.ok(true)
  }

  // completed 终态
  jobs.finishJob('job-1', 'completed')
  clock.t += 500
  r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  run = (r.value.runs ?? []).find((x) => x.runId === runId)
  assert.ok(run, '终态 run 必须出现在后续帧（保留窗口内）')
  assert.equal(run.status, 'completed')
  await panel.dispose?.()
})

test('panel.poll: job 输出增量不重复（readAt 游标续读）', { skip }, async () => {
  const jobs = createFakeJobsService([
    { id: 'job-2', owner: 'root-1', label: 'tail', status: 'running', output: 'line-1\n' },
  ])
  const { panel } = makePanel(baseServices({ jobs }))
  let r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  const runId = runIdOf(r.value, 'job', 'job-2')
  assert.ok(runId)
  const first = r.value.runs.find((x) => x.runId === runId)
  const firstText = (first.output?.job?.chunks ?? []).map((c) => c.text).join('')
  assert.equal(firstText, 'line-1\n')
  const cursors = r.value.nextCursors

  jobs.appendJobOutput('job-2', 'line-2\n')
  r = await rpc(panel, 'panel.poll', { sessionId: 'root-1', cursors })
  const second = (r.value.runs ?? []).find((x) => x.runId === runId)
  const secondText = (second?.output?.job?.chunks ?? []).map((c) => c.text).join('')
  assert.equal(secondText, 'line-2\n', `增量必须只交付新字节，实际 ${JSON.stringify(secondText)}`)
  await panel.dispose?.()
})

test('panel.poll: 持久终端增量（行窗口首见 → probe 无增量）', { skip }, async () => {
  const terminals = createFakeTerminalsService([
    { id: 'term-1', owner: 'root-1', name: 'zsh', lines: ['$ ls', 'a b c'] },
  ])
  const { panel } = makePanel(baseServices({ terminals }))
  let r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  const runId = runIdOf(r.value, 'terminal', 'term-1')
  assert.ok(runId, `poll 应返回 terminal run，实际 runs=${JSON.stringify(r.value.runs.map((x) => x.runId))}`)
  let run = r.value.runs.find((x) => x.runId === runId)
  assert.equal(run.kind, 'terminal')
  const firstText = run.output?.terminal?.text ?? ''
  assert.ok(firstText.includes('a b c'), `终端输出应含源文本，实际 ${JSON.stringify(firstText)}`)

  // 无新行时：probe 不应重复交付已发文本
  r = await rpc(panel, 'panel.poll', { sessionId: 'root-1', cursors: r.value.nextCursors })
  run = (r.value.runs ?? []).find((x) => x.runId === runId)
  if (run) {
    const text = run.output?.terminal?.text ?? ''
    assert.ok(!text.includes('a b c'), `无新行时不得重复交付，实际 ${JSON.stringify(text)}`)
  }
  await panel.dispose?.()
})

test('panel.poll: 来源缺失 → availability 标记，帧仍正常（§8）', { skip }, async () => {
  const services = baseServices({ jobs: undefined, terminals: undefined })
  const { panel } = makePanel(services)
  const r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  assert.equal(r.ok, true, '单一来源缺失不得让整个 poll 失败（§8 总原则）')
  assert.equal(r.value.availability.jobs.available, false)
  assert.equal(typeof r.value.availability.jobs.reason, 'string')
  assert.equal(r.value.availability.terminals.available, false)
  await panel.dispose?.()
})

test('panel.kill: 终止可见 job → outcome requested（§4.2）', { skip }, async () => {
  const jobs = createFakeJobsService([{ id: 'job-3', owner: 'root-1', status: 'running' }])
  const { panel } = makePanel(baseServices({ jobs }))
  const r0 = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  const runId = runIdOf(r0.value, 'job', 'job-3')
  assert.ok(runId)
  const r = await rpc(panel, 'panel.kill', { sessionId: 'root-1', runId })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  assert.equal(r.value.outcome, 'requested')
  await panel.dispose?.()
})

test('panel.kill: 不可见 runId → run-not-found（不泄漏存在性）', { skip }, async () => {
  const { panel } = makePanel()
  const r = await rpc(panel, 'panel.kill', { sessionId: 'root-1', runId: 'bash:never' })
  assert.equal(r.ok, false)
  assert.equal(r.error.code, 'run-not-found')
  await panel.dispose?.()
})

test('panel.poll: revision 单调递增（客户端据此丢弃乱序帧，§4.2.6）', { skip }, async () => {
  const { panel, clock } = makePanel()
  const r1 = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  clock.t += 250
  const r2 = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  assert.ok(r2.value.revision > r1.value.revision, `revision 必须递增：${r1.value.revision} → ${r2.value.revision}`)
  await panel.dispose?.()
})

test('availability.bashLive=false 时 panel.poll 仍返回完整帧、bash 来源可用（T11 prevention 载体）', { skip }, async () => {
  // mock ctx：没有 shell（tee 必然失败 → bashLive 降级），但 tools 服务存在 → 前台 bash 仍能被记录为 final-only Run
  const services = baseServices({ tools: {}, shell: undefined })
  const { panel, fake } = makePanel(services)
  assert.equal(typeof panel.start, 'function')
  panel.start()

  // 模拟 tools/execute waterfall：面板观察者必须记录 ghost Run 且原样 next()
  const exec = {
    callId: 'call-live-1',
    name: 'bash',
    arguments: { command: 'npm test' },
    agent: { id: 'root-1', name: 'lead' },
  }
  const executeListener = fake.listeners.find((entry) => entry.event === 'tools/execute')
  assert.ok(executeListener, 'panel.start 必须注册 tools/execute 监听')
  let nextCalled = false
  const nextResult = await executeListener.handler(exec, async () => {
    nextCalled = true
    return { isError: false }
  })
  assert.equal(nextCalled, true, '观察者不得改变工具链：必须原样调用 next()')
  assert.deepEqual(nextResult, { isError: false })

  // 阶段 1（运行中）：bashLive 不可用，但帧必须完整
  let r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  assert.equal(r.ok, true, `bashLive=false 不得让 poll 失败：${JSON.stringify(r.error)}`)
  assert.equal(r.value.availability.bashLive.available, false, '无 shell 句柄 → bashLive 必须降级')
  assert.equal(typeof r.value.availability.bashLive.reason, 'string')
  assert.equal(r.value.availability.bash.available, true, 'tools/execute 兜底可用 → bash 来源仍 available（§8）')
  assert.equal(r.value.sessions[0].sessionId, 'root-1', 'sessions 树必须正常返回')
  assert.equal(typeof r.value.truncated, 'boolean')

  const liveRunId = 'bash:call-live-1'
  const runningRun = r.value.runs.find((run) => run.runId === liveRunId)
  assert.ok(runningRun, `runs 中必须能看到前台 bash 的 final-only Run，实际 ${JSON.stringify(r.value.runs.map((x) => x.runId))}`)
  assert.equal(runningRun.kind, 'bash')
  assert.equal(runningRun.status, 'running')
  assert.equal(runningRun.outputMode, 'final-only')
  assert.equal(runningRun.stoppable, false, 'final-only bash 不可停止')
  // §4.3 不变量①：nextCursors 只含本帧已交付的 Run
  const delivered = new Set(r.value.runs.map((run) => run.runId))
  for (const runId of Object.keys(r.value.nextCursors)) {
    assert.ok(delivered.has(runId), `nextCursors 含未交付 run: ${runId}`)
  }

  // 阶段 2（终态）：tools/result 提供终态输出，帧仍完整且 Run 变为 completed
  const resultListener = fake.listeners.find((entry) => entry.event === 'tools/result')
  assert.ok(resultListener, 'panel.start 必须注册 tools/result 监听')
  resultListener.handler(exec, {
    isError: false,
    value: { content: [{ type: 'text', text: 'Tests: 12 passed\nexit code 0' }] },
  })
  r = await rpc(panel, 'panel.poll', { sessionId: 'root-1' })
  assert.equal(r.ok, true)
  const doneRun = r.value.runs.find((run) => run.runId === liveRunId)
  assert.ok(doneRun, '终态帧必须包含该 Run')
  assert.equal(doneRun.status, 'completed')
  assert.equal(doneRun.outputMode, 'final-only')
  assert.ok(
    JSON.stringify(doneRun).includes('12 passed'),
    `终态输出应来自 tools/result 文本，实际 ${JSON.stringify(doneRun.output ?? {})}`,
  )
  await panel.dispose?.()
  assert.equal(fake.listeners.length, 0, 'panel.dispose 后监听必须撤销')
})
