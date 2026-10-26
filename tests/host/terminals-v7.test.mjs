// Host v7 集成回归：三级终端发现 / diagnostics / inputs / notice / 事件旁路 / 帧预算 / 名称
// 契约 v7 §4.2 diagnostics、§5.1 inputs·notice·meta-only、§7.1/§7.2 三级发现、§7.3 不因 agent 缺失删 Run。
// mock ctx（参考 tests/host/panel.test.mjs）：不依赖 DSH 运行时。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule } from '../helpers/host-modules.mjs'
import { createFakeHostCtx, createFakeJobsService, createFakeTerminalsService } from '../helpers/fakes.mjs'

const m = await loadHostModule('panel')
const skip = m.missing ? m.reason : false

const terminalRunId = (id) => `terminal:${id}`
const bytes = (text) => Buffer.byteLength(text, 'utf8')

function liveAgents(root = 'root-1') {
  const rootAgent = { id: root }
  const map = new Map([[root, rootAgent]])
  return {
    get: (id) => map.get(id),
    list: () => [...map.values()],
    roots: () => [rootAgent],
  }
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
  const panel = m.ok
    ? m.mod.createPanel({ ctx: fake.ctx, config, now: () => 1_700_000_000_000 })
    : undefined
  return { panel, fake, services }
}

async function poll(panel, params = {}) {
  const r = await panel.handleRpc('panel.poll', { sessionId: 'root-1', ...params })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  return r.value
}

/** 启动面板（注册 tools/execute + tools/result 监听）并返回事件派发器。 */
function startEvents(panel, fake) {
  panel.start()
  const execute = fake.listeners.find((entry) => entry.event === 'tools/execute')
  const result = fake.listeners.find((entry) => entry.event === 'tools/result')
  return {
    async call(exec, nextResult = { isError: false }) {
      let nextCalls = 0
      let forwarded
      const returned = await execute.handler(exec, async () => {
        nextCalls += 1
        forwarded = nextResult
        return nextResult
      })
      return { returned, forwarded, nextCalls }
    },
    result(exec, resultValue) {
      result.handler(exec, resultValue)
    },
  }
}

const ROOT_EXEC = { agent: { id: 'root-1' } }

/* 1) 默认关闭 terminalController：即使存在也不得产生 Run / source≠sidebar */
test('sidebar 默认关闭：terminalController 存在也不得发现/调用，source≠sidebar（§7.2 级 2 默认关）', { skip }, async () => {
  let listCalls = 0
  const controller = {
    list() {
      listCalls += 1
      return [{ id: 'web-1', title: 'dev', shell: { name: 'zsh' }, state: 'running' }]
    },
  }
  const { panel } = makePanel(baseServices({ agents: liveAgents(), terminals: createFakeTerminalsService(), terminalController: controller }))
  const frame = await poll(panel)
  assert.equal(listCalls, 0, '默认配置不得调用 terminalController.list')
  assert.equal(frame.runs.filter((run) => run.kind === 'terminal').length, 0)
  assert.notEqual(frame.diagnostics.terminals.source, 'sidebar')
  await panel.dispose?.()
})

/* 2) 开启 sidebar：出现 Run + 字段映射（title→name、shell.name→type、state exited/failed 不得 running） */
test('sidebar 开启：2 条 WebTerminalInfo → Run 字段映射正确，source=sidebar（§7.2 级 2）', { skip }, async () => {
  const controller = {
    list(sessionId) {
      assert.equal(sessionId, 'root-1', 'terminalController.list 必须以 sessionId 调用')
      return [
        { id: 'web-1', title: 'dev', shell: { path: '/bin/zsh', args: [], name: 'zsh' }, cwd: '/repo', state: 'running', exitCode: null },
        { id: 'web-2', title: 'bad', shell: { name: 'bash' }, state: 'failed', exitCode: 1, error: 'boom' },
      ]
    },
  }
  // 无 live Agent：主链路跳过，走 sidebar 级 2（默认关闭时不会到这里）
  const services = baseServices({ agents: { get: () => undefined, list: () => [], roots: () => [] }, terminalController: controller })
  const { panel } = makePanel(services, { sidebarTerminals: true })
  const frame = await poll(panel)
  const runs = frame.runs.filter((run) => run.kind === 'terminal')
  assert.equal(runs.length, 2, `应出现 2 条 sidebar terminal Run，实际 ${runs.length}`)
  const dev = runs.find((run) => run.runId === terminalRunId('web-1'))
  assert.ok(dev)
  assert.equal(dev.command, 'dev', 'title → Run.command(name)')
  assert.equal(dev.handle.terminalType, 'zsh', 'shell.name → terminalType')
  assert.equal(dev.cwd, '/repo')
  assert.equal(dev.status, 'running')
  assert.equal(dev.outputMode, 'meta-only', '无 live Agent → meta-only')
  assert.equal(dev.notice?.code, 'terminal-no-agent')
  const bad = runs.find((run) => run.runId === terminalRunId('web-2'))
  assert.equal(bad.status, 'failed', 'state failed 不得映射成 running')
  assert.equal(frame.diagnostics.terminals.source, 'sidebar')
  assert.equal(frame.diagnostics.terminals.candidates, 2)
  assert.equal(frame.diagnostics.agentFound, false)
  await panel.dispose?.()
})

/* 3) agent 缺失 + controller 列表：Run 保留（不被删）、meta-only + notice、diagnostics 形状 */
test('agent 缺失不删 Run：terminalController 2 条 → 2 条 meta-only Run + diagnostics 形状（§7.2/§7.3）', { skip }, async () => {
  const controller = {
    list: () => [
      { id: 'pty-a', title: 'A', state: 'running' },
      { id: 'pty-b', title: 'B', state: 'exited', exitCode: 0 },
    ],
  }
  const services = baseServices({
    agents: { get: () => undefined, list: () => [{ id: 'other' }], roots: () => [] },
    terminalController: controller,
    subagents: { listDescendants: () => [] },
  })
  const { panel } = makePanel(services, { sidebarTerminals: true })
  let frame = await poll(panel)
  assert.equal(frame.runs.length, 2)
  for (const run of frame.runs) {
    assert.equal(run.outputMode, 'meta-only')
    assert.equal(run.notice?.code, 'terminal-no-agent')
    assert.equal(typeof run.notice.message, 'string')
    assert.ok(run.notice.message.length > 0)
  }
  // 第二帧不得删除（agent 缺失不是 remove 条件）；未变化的 Run 不出现在帧里，但 store 必须保留
  frame = await poll(panel, { cursors: frame.nextCursors })
  assert.deepEqual(frame.removed, [], 'agent 缺失不是 remove 条件')
  const retained = panel.store.all().filter((record) => record.kind === 'terminal')
  assert.equal(retained.length, 2, `agent 缺失时 Run 必须在注册表保留，实际 ${retained.length}`)
  // diagnostics 形状 + 取值
  const diag = frame.diagnostics
  assert.equal(diag.rootSessionId, 'root-1')
  assert.equal(diag.agentFound, false)
  assert.equal(diag.agentCount, 1, 'agentCount = agents.list().length')
  assert.equal(diag.scopes, 1)
  assert.equal(typeof diag.terminals.candidates, 'number')
  assert.equal(diag.terminals.source, 'sidebar')
  assert.equal(typeof diag.terminals.reason, 'string')
  await panel.dispose?.()
})

/* 4) 只有 tools/execute 事件：terminal_open 登记 Run（source=events），waterfall 原样放行 */
test('事件兜底：terminal_open → 登记 meta-only Run（source=events），waterfall next 原样放行且不改结果', { skip }, async () => {
  const services = baseServices({
    agents: { get: () => undefined, list: () => [], roots: () => [] },
    terminals: undefined,
  })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)

  const exec = {
    callId: 'call-open-1',
    name: 'terminal_open',
    arguments: { type: 'zsh', name: 'dev', cwd: '/repo' },
    ...ROOT_EXEC,
  }
  const nextResult = { isError: false, ok: true }
  const invoked = await events.call(exec, nextResult)
  assert.equal(invoked.nextCalls, 1, 'waterfall 必须调用 next()')
  assert.equal(invoked.returned, nextResult, 'waterfall 必须原样返回 next() 结果（不得改工具结果）')

  const resultValue = { isError: false, value: { sessionId: 'pty-1', name: 'dev', type: 'zsh', motd: 'Welcome\n' } }
  events.result(exec, resultValue)
  // 原 result 不得被 mutating（旁路只读）
  assert.deepEqual(resultValue, { isError: false, value: { sessionId: 'pty-1', name: 'dev', type: 'zsh', motd: 'Welcome\n' } })

  const frame = await poll(panel)
  const run = frame.runs.find((item) => item.runId === terminalRunId('pty-1'))
  assert.ok(run, `terminal_open 必须登记 Run（selector 真机缺陷①），实际 ${JSON.stringify(frame.runs.map((r) => r.runId))}`)
  assert.equal(run.outputMode, 'meta-only')
  assert.equal(run.notice?.code, 'terminal-no-agent')
  assert.equal(run.command, 'dev')
  assert.equal(run.handle.terminalType, 'zsh')
  assert.deepEqual(run.inputs, ['dev'], 'inputs[0] 必须是 name')
  assert.ok((run.output?.terminal?.text ?? '').includes('Welcome'))
  assert.equal(frame.diagnostics.terminals.source, 'events', '只有事件时 source 必须为 events（不得 none）')
  assert.equal(frame.diagnostics.terminals.candidates, 1)
  await panel.dispose?.()
})

/* 5) 事件片段：send.viewport / read.text 输出、尾重叠去重、行边界与坐标一致 */
test('事件片段：send.viewport/read.text 进 output（尾重叠去重、行边界、坐标逐帧一致）', { skip }, async () => {
  const services = baseServices({
    agents: { get: () => undefined, list: () => [], roots: () => [] },
    terminals: undefined,
  })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)

  const assertDeltaCoords = (delta, label) => {
    assert.equal(typeof delta?.text, 'string', `${label}: 必须有 text`)
    assert.equal(delta.totalLines, delta.nextCursor, `${label}: totalLines === nextCursor`)
    assert.equal(delta.lineEnd, delta.totalLines, `${label}: lineEnd === totalLines`)
    assert.equal(
      delta.lineEnd - delta.lineBegin,
      delta.text.split('\n').length,
      `${label}: lineEnd-lineBegin 必须等于本段文本行数（坐标与文本一致）`,
    )
  }

  const openExec = { callId: 'call-open', name: 'terminal_open', arguments: { type: 'zsh', name: 'dev', cwd: '/repo' }, ...ROOT_EXEC }
  await events.call(openExec)
  events.result(openExec, { isError: false, value: { sessionId: 'pty-1', name: 'dev', type: 'zsh', motd: 'Welcome\n' } })
  let frame = await poll(panel)
  let run = frame.runs.find((item) => item.runId === terminalRunId('pty-1'))
  let accumulated = run.output?.terminal?.text ?? ''
  assertDeltaCoords(run.output?.terminal, 'motd')

  const send1 = { callId: 'call-send-1', name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'ls\n' }, ...ROOT_EXEC }
  await events.call(send1)
  events.result(send1, { isError: false, value: { sessionStatus: { kind: 'running' }, viewport: 'a\nb' } })
  frame = await poll(panel, { cursors: frame.nextCursors })
  run = frame.runs.find((item) => item.runId === terminalRunId('pty-1'))
  accumulated += run.output?.terminal?.text ?? ''
  assertDeltaCoords(run.output?.terminal, 'viewport#1')

  const send2 = { callId: 'call-send-2', name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'pwd' }, ...ROOT_EXEC }
  await events.call(send2)
  events.result(send2, { isError: false, value: { sessionStatus: { kind: 'running' }, viewport: 'b\nc' } })
  frame = await poll(panel, { cursors: frame.nextCursors })
  run = frame.runs.find((item) => item.runId === terminalRunId('pty-1'))
  accumulated += run.output?.terminal?.text ?? ''
  assertDeltaCoords(run.output?.terminal, 'viewport#2（与上一段尾行重叠）')

  const readExec = { callId: 'call-read', name: 'terminal_read', arguments: { sessionId: 'pty-1' }, ...ROOT_EXEC }
  events.result(readExec, { isError: false, value: { text: 'c\nd' } })
  frame = await poll(panel, { cursors: frame.nextCursors })
  run = frame.runs.find((item) => item.runId === terminalRunId('pty-1'))
  accumulated += run.output?.terminal?.text ?? ''
  assertDeltaCoords(run.output?.terminal, 'read（与尾行重叠）')

  assert.equal(
    accumulated,
    'Welcome\na\nb\nc\nd',
    'tier3 片段逐帧拼接必须保留行边界（修复前 Welcome\na\nbcd）且尾重叠只去重一次',
  )
  assert.deepEqual(run.inputs, ['dev', 'ls\n', 'pwd'], 'send.text 必须追加到 inputs')
  await panel.dispose?.()
})

/* 6) 事件片段与主链路（tier1 真终端输出）写同一 Run：行边界不丢、坐标连续 */
test('片段 + 主链路输出同一 Run：tier1 live 时片段不追加（不混排），行边界/坐标不变', { skip }, async () => {
  const terminals = createFakeTerminalsService([
    { id: 'pty-mix', owner: 'root-1', name: 'dev', lines: ['$ ls', 'a b c'] },
  ])
  const { panel, fake } = makePanel(baseServices({ terminals }))
  const events = startEvents(panel, fake)
  // 主链路（live Agent + terminals.read）先产生 tier1 输出
  let frame = await poll(panel)
  let run = frame.runs.find((item) => item.runId === terminalRunId('pty-mix'))
  assert.ok(run, '主链路应发现终端')
  assert.equal(run.outputMode, 'live')
  const before = run.output?.terminal ?? {}
  assert.ok((before.text ?? '').includes('a b c'))

  // 事件片段（terminal_read）与 tier1 输出同一 Run：v7 §7.2 片段仅作 meta-only 补偿，
  // live 输出已接管时不得再追加（避免两套来源交错/重复）；边界与坐标必须保持不变。
  const readExec = { callId: 'call-mixed', name: 'terminal_read', arguments: { sessionId: 'pty-mix' }, ...ROOT_EXEC }
  events.result(readExec, { isError: false, value: { text: 'a b c\nd e f' } })
  frame = await poll(panel)
  run = frame.runs.find((item) => item.runId === terminalRunId('pty-mix'))
  const after = run.output?.terminal
  assert.equal(run.outputMode, 'live')
  // 未变化的 Run 不重复出帧：output 可为 undefined（表示本帧无新增输出）
  assert.ok(after === undefined || !String(after.text ?? '').includes('d e f'), 'live 时事件片段不得追加/混排')
  assert.ok(after === undefined || !String(after.text ?? '').includes('a b cd'))
  // 文本行数与 terminal 行坐标一致（不因片段路径破坏坐标）
  const window = panel.store.windowOf(terminalRunId('pty-mix'))
  assert.ok(window !== undefined)
  assert.equal(window.totalLines, (before.text ?? '').split('\n').length, 'terminal 坐标必须与已交付文本行数一致')
  if (after !== undefined) {
    assert.equal(after.totalLines, before.totalLines)
    assert.equal(after.nextCursor, before.nextCursor)
  }
  await panel.dispose?.()
})

/* 6b) 片段后 tier1 接管：片段 + '\n' + 真页文本，不粘连；接管后不再追加片段 */
test('片段后 tier1 接管：同一 Run「片段 + 换行 + 真页文本」不粘连，live 后片段不再追加', { skip }, async () => {
  const services = baseServices({
    agents: { get: () => undefined, list: () => [], roots: () => [] },
    terminals: undefined,
  })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)

  // 阶段 A：无 agent/terminals → 事件片段（meta-only）
  const openExec = { callId: 'call-open', name: 'terminal_open', arguments: { name: 'dev' }, ...ROOT_EXEC }
  await events.call(openExec)
  events.result(openExec, { isError: false, value: { sessionId: 'pty-take', name: 'dev', motd: 'Welcome\n' } })
  const sendExec = { callId: 'call-send', name: 'terminal_send', arguments: { sessionId: 'pty-take', text: 'ls\n' }, ...ROOT_EXEC }
  await events.call(sendExec)
  events.result(sendExec, { isError: false, value: { viewport: 'a\nb' } })
  let frame = await poll(panel)
  let run = frame.runs.find((item) => item.runId === terminalRunId('pty-take'))
  assert.equal(run.outputMode, 'meta-only')
  const fragmentText = run.output?.terminal?.text ?? ''
  assert.equal(fragmentText, 'Welcome\na\nb')
  let accumulated = fragmentText

  // 阶段 B：Agent 上线 + terminals 服务可用 → 同一 Run 切到 live（tier1 读取），首段真输出前补一次换行
  services.terminals = createFakeTerminalsService([
    { id: 'pty-take', owner: 'root-1', name: 'dev', lines: ['$ ls', 'a b c'] },
  ])
  const liveAgent = { id: 'root-1' }
  services.agents.get = () => liveAgent
  services.agents.list = () => [liveAgent]
  frame = await poll(panel, { cursors: frame.nextCursors })
  run = frame.runs.find((item) => item.runId === terminalRunId('pty-take'))
  assert.equal(run.outputMode, 'live', 'tier1 接管后 outputMode 必须变 live')
  const pageDelta = run.output?.terminal?.text ?? ''
  assert.equal(pageDelta.startsWith('\n'), true, '片段未以换行结尾 → 首段真输出前必须补一次换行')
  accumulated += pageDelta
  assert.equal(accumulated, 'Welcome\na\nb\n$ ls\na b c', '片段+真页文本必须行边界正确（不得粘成 b$ ls）')
  assert.ok(!accumulated.includes('b$ ls'))
  // 注：接管帧的合成分隔 '\n' 是显示分隔符、不计入 terminal scrollback 行坐标
  // （lineEnd-lineBegin=真页行数，text.split('\n').length=真页行数+1）；此处不断言二者相等，
  // 纯片段帧的行坐标一致性由上一用例逐帧断言。

  // 阶段 C：live 之后事件片段不再追加
  const later = { callId: 'call-later', name: 'terminal_read', arguments: { sessionId: 'pty-take' }, ...ROOT_EXEC }
  events.result(later, { isError: false, value: { text: 'zzz-not-real' } })
  frame = await poll(panel, { cursors: frame.nextCursors })
  run = frame.runs.find((item) => item.runId === terminalRunId('pty-take'))
  assert.ok(!JSON.stringify(run?.output ?? {}).includes('zzz-not-real'), 'live 接管后不得再追加事件片段')
  await panel.dispose?.()
})

/* 7) terminal_close → 终态，非删除 */
test('terminal_close → Run 进入终态 completed（不是被 removed 静默删除）（§7.2 级 3）', { skip }, async () => {
  const services = baseServices({ agents: { get: () => undefined, list: () => [], roots: () => [] }, terminals: undefined })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)
  const openExec = { callId: 'call-open', name: 'terminal_open', arguments: { name: 'dev' }, ...ROOT_EXEC }
  await events.call(openExec)
  events.result(openExec, { isError: false, value: { sessionId: 'pty-close', name: 'dev' } })

  const closeExec = { callId: 'call-close', name: 'terminal_close', arguments: { sessionId: 'pty-close' }, ...ROOT_EXEC }
  await events.call(closeExec)
  events.result(closeExec, { isError: false, value: { sessionId: 'pty-close', outcome: 'closed' } })

  const frame = await poll(panel)
  assert.deepEqual(frame.removed, [], 'close 不得产生 removed（不是删除）')
  const run = frame.runs.find((item) => item.runId === terminalRunId('pty-close'))
  assert.ok(run, 'close 后 Run 仍必须存在（终态行）')
  assert.equal(run.status, 'completed')
  assert.equal(run.stoppable, false)
  await panel.dispose?.()
})

/* 8) diagnostics：live agent 时 agentFound/agentCount/scopes 取值，source 为 none/terminals 合理 */
test('diagnostics 每帧必带且取值正确（live agent 场景）', { skip }, async () => {
  const services = baseServices({
    agents: liveAgents(),
    subagents: {
      listDescendants: () => [
        { kind: 'child', id: 'sub-1', activity: 'running', mode: 'spawn', label: 'scout', parentId: 'root-1', depth: 1 },
      ],
    },
  })
  const { panel } = makePanel(services)
  const frame = await poll(panel)
  const diag = frame.diagnostics
  assert.equal(diag.rootSessionId, 'root-1')
  assert.equal(diag.agentFound, true)
  assert.equal(diag.agentCount, 1)
  assert.equal(diag.scopes, 2, 'root + 子代理')
  assert.ok(['terminals', 'events', 'sidebar', 'none'].includes(diag.terminals.source))
  assert.equal(typeof diag.terminals.candidates, 'number')
  await panel.dispose?.()
})

/* 9) inputs 边界（集成）：>20 条丢最旧；同 callId 去重；单条 >2KiB 截断 */
test('inputs 采集边界：>20 条丢最旧、同 callId 去重、单条 ≤2KiB（§7.1）', { skip }, async () => {
  const services = baseServices({ agents: { get: () => undefined, list: () => [], roots: () => [] }, terminals: undefined })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)
  const openExec = { callId: 'call-open', name: 'terminal_open', arguments: { name: 'dev' }, ...ROOT_EXEC }
  await events.call(openExec)
  events.result(openExec, { isError: false, value: { sessionId: 'pty-inputs', name: 'dev' } })

  for (let i = 0; i < 25; i += 1) {
    const exec = { callId: `call-send-${i}`, name: 'terminal_send', arguments: { sessionId: 'pty-inputs', text: `cmd-${i}` }, ...ROOT_EXEC }
    await events.call(exec)
    events.result(exec, { isError: false, value: { sessionStatus: { kind: 'running' }, viewport: '' } })
  }
  // 同一 callId 重复投递不得重复
  const dupExec = { callId: 'call-send-24', name: 'terminal_send', arguments: { sessionId: 'pty-inputs', text: 'cmd-24' }, ...ROOT_EXEC }
  await events.call(dupExec)
  events.result(dupExec, { isError: false, value: { sessionStatus: { kind: 'running' }, viewport: '' } })

  const frame = await poll(panel)
  const run = frame.runs.find((item) => item.runId === terminalRunId('pty-inputs'))
  assert.equal(run.inputs.length, 20, 'inputs 最多 20 条')
  assert.equal(run.inputs[19], 'cmd-24', '最后一条是最后输入')
  assert.ok(!run.inputs.includes('dev'), '超 20 条时最旧（name）被淘汰')
  assert.equal(run.inputs.filter((item) => item === 'cmd-24').length, 1, '同一 callId 不得重复')
  for (const entry of run.inputs) assert.ok(bytes(entry) <= 2048, `单条输入 ≤2KiB，实际 ${bytes(entry)}B`)
  await panel.dispose?.()
})

/* 10) 帧预算：带 inputs/notice 的多 Run 大帧仍 ≥1 Run 保底、truncated、游标只前移已交付 */
test('帧预算：maxFrameBytes=8192 且 inputs/notice 撑大帧 → Tier2 ≥1 Run、truncated、游标合法', { skip }, async () => {
  const { panel } = makePanel(baseServices(), { maxFrameBytes: 8192 })
  // 8 条 terminal Run，每条 inputs 接近 8KiB 上限 + notice（新字段计入 Tier2 体积）
  for (let i = 0; i < 8; i += 1) {
    const runId = terminalRunId(`big-${i}`)
    panel.store.upsert({
      runId,
      kind: 'terminal',
      ownerSessionId: 'root-1',
      title: '终端',
      startedAt: 1_000 + i,
      status: 'running',
      outputMode: 'meta-only',
      notice: { code: 'terminal-no-agent', message: '无 live Agent，只能显示元信息（no realtime output）'.repeat(20) },
      command: `dev-${i}`,
      inputs: Array.from({ length: 4 }, (_, n) => `line-${n}-` + 'x'.repeat(1900)),
      handle: { terminalId: `big-${i}` },
    })
  }
  const frame = await poll(panel)
  assert.ok(frame.runs.length >= 1, 'Tier2 必须至少保留 1 条 Run（H1 保底）')
  assert.equal(frame.truncated, true, '超出 maxFrameBytes 必须标 truncated')
  assert.ok(bytes(JSON.stringify(frame)) < 262144, '仍必须远低于 Tier3 硬上限')
  for (const runId of Object.keys(frame.nextCursors)) {
    assert.ok(frame.runs.some((run) => run.runId === runId), `nextCursors 只含本帧交付 Run：${runId}`)
  }
  for (const run of frame.runs) {
    const cursor = frame.nextCursors[run.runId]?.terminal
    if (Number.isFinite(cursor)) {
      assert.ok(cursor <= (run.output?.terminal?.totalLines ?? cursor), 'terminal 游标不得超过已交付行')
    }
  }
  await panel.dispose?.()
})
