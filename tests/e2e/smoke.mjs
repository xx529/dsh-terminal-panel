// 端到端冒烟（契约 §13.3 / task-5 交付物 5）：
//   host 纯逻辑（classify/status/tree/terminal-window/frame，真实导出）+ 模拟 client 轮询序列
//   → client mergePoll 归约 → 断言最终视图帧（列数、agent 名、状态、countdown 字段、removed 处理）。
//
// 运行：node tests/e2e/smoke.mjs     （退出码 0=通过 或 依赖未就绪而跳过；1=失败）
// 也可被 tests/e2e/smoke.test.mjs 以 node:test 方式调用。
import { pathToFileURL } from 'node:url'
import { loadHostModule } from '../helpers/host-modules.mjs'
import { loadClient } from '../helpers/load-client.mjs'
import { collectStrings, makeChannelDelta, makeChunk } from '../helpers/fixtures.mjs'

const HOST_MODULES = ['classify', 'status', 'tree', 'terminal-window', 'frame']

function makeCheckLog() {
  const checks = []
  return {
    checks,
    check(label, fn) {
      try {
        fn()
        checks.push({ label, ok: true })
      } catch (error) {
        checks.push({ label, ok: false, error })
        throw error
      }
    },
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message)
}

function eq(actual, expected, message) {
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) throw new Error(`${message}：期望 ${b}，实际 ${a}`)
}

export async function run() {
  /* ---------- 1. 依赖就绪检查（缺失=skip，存在但坏=fail） ---------- */
  const host = {}
  const missing = []
  for (const name of HOST_MODULES) {
    const m = await loadHostModule(name)
    if (m.ok) host[name] = m.mod
    else if (m.missing) missing.push(m.reason)
    else throw new Error(m.reason)
  }
  const client = await loadClient()
  if (client.status === 'missing') missing.push(client.reason)
  else if (client.status !== 'ok') throw new Error(client.reason)
  if (missing.length) {
    return { status: 'skipped', reasons: missing, checks: [] }
  }

  const { classifyTool } = host.classify
  const { mapShellStatus, mapJobStatus } = host.status
  const { mergeSessionTree } = host.tree
  const tw = host['terminal-window']
  const { buildPollFrame } = host.frame
  const { mergePoll } = client.internals
  if (typeof buildPollFrame !== 'function') throw new Error('lib/host/frame.mjs 缺少 buildPollFrame')
  if (typeof mergePoll !== 'function') throw new Error('__internals.mergePoll 缺失（契约 §11.2）')

  const { checks, check } = makeCheckLog()

  /* ---------- 2. 场景数据：root + 子代理(scout) + 队友(backend) ---------- */
  const ROOT = 'root-1'
  const SCOUT = 'sub-1'
  const BACKEND = 'team-1'

  const sessions = mergeSessionTree({
    rootSessionId: ROOT,
    rootName: '当前会话',
    descendants: [
      { kind: 'child', id: SCOUT, activity: 'running', mode: 'spawn', label: 'scout', parentId: ROOT, hasChildren: false, depth: 1 },
    ],
    members: [
      { id: ROOT, name: 'lead', role: 'lead', status: 'running' },
      { id: BACKEND, name: 'backend', role: 'teammate', status: 'running' },
    ],
  })

  check('会话树：root 在首 + 子代理/队友共 3 个作用域', () => {
    eq(sessions[0].sessionId, ROOT)
    eq(sessions.map((s) => s.sessionId).slice().sort(), [ROOT, SCOUT, BACKEND].sort())
  })
  check('会话树：子代理 accent=subagent、队友 accent=teammate', () => {
    eq(sessions.find((s) => s.sessionId === SCOUT).accent, 'subagent')
    eq(sessions.find((s) => s.sessionId === BACKEND).accent, 'teammate')
  })

  /* ---------- 3. host 侧：三类 Run + 状态映射 + 终端行窗口 ---------- */
  const t0 = 1_700_000_000_000
  const bashClass = classifyTool('bash', { command: 'npm test -- --runInBand', cwd: '/repo' })
  check('classifyTool(bash) → kind=bash 且透传命令', () => {
    eq(bashClass.kind, 'bash')
    eq(bashClass.command, 'npm test -- --runInBand')
  })
  const bashStatusRunning = mapShellStatus({ status: 'running', exitCode: null, signal: null })
  const bashStatusDone = mapShellStatus({ status: 'completed', exitCode: 0, signal: null })
  check('mapShellStatus: running→running、exit0→completed', () => {
    eq(bashStatusRunning, 'running')
    eq(bashStatusDone, 'completed')
  })
  const jobStop = mapJobStatus('stopping')
  const jobDone = mapJobStatus('completed')
  check('mapJobStatus: stopping→running+stopping、completed→completed', () => {
    eq(jobStop, { status: 'running', stopping: true })
    eq(jobDone, { status: 'completed', stopping: false })
  })

  // 终端行窗口：首见 2 行 → 新增 1 行
  let termWindow = tw.createTerminalWindow()
  const termPlan1 = tw.planTerminalRead(termWindow, 2)
  // terminals.read 返回：offset 距最新行数（0=尾页），lineBegin=offset、lineEnd=offset+行数
  const termRead1 = tw.applyTerminalRead(termWindow, {
    text: '$ ls\na b c',
    totalLines: 2,
    lineBegin: 0,
    lineEnd: 2,
    truncated: false,
  })
  termWindow = termRead1.window
  const termPlan2 = tw.planTerminalRead(termWindow, 3)
  const termRead2 = tw.applyTerminalRead(termWindow, {
    text: 'new line',
    totalLines: 3,
    lineBegin: 0,
    lineEnd: 1,
    truncated: false,
  })
  check('终端行窗口：首见 initial、增量 delta、增量只交付新行且保留行边界', () => {
    eq(termPlan1.mode, 'initial')
    eq(termPlan2.mode, 'delta')
    eq(termRead1.delta.nextCursor, 2)
    eq(termRead2.delta.text, '\nnew line')
  })

  /* ---------- 4. 帧组装（真实 buildPollFrame）与 client 轮询序列 ---------- */
  const availability = {
    bash: { available: true },
    jobs: { available: true },
    terminals: { available: true },
    tree: { available: true },
  }

  const runMeta = (over) => ({
    runId: over.runId,
    kind: over.kind,
    status: over.status,
    stopping: over.stopping ?? false,
    ownerSessionId: over.ownerSessionId,
    agent: over.agent,
    title: over.title,
    command: over.command,
    cwd: '/repo',
    startedAt: over.startedAt,
    finishedAt: over.finishedAt,
    durationMs: over.durationMs ?? 0,
    handle: over.handle ?? {},
    stoppable: true,
    totals: {},
    output: {},
    lossy: false,
    truncated: false,
  })

  const BASH = 'bash:call-1'
  const JOB = 'job:job-1'
  const TERM = 'terminal:term-1'

  const frames = []
  let cursors = {}

  // frame1：三个 Run 全部 running
  {
    const input = {
      revision: 1,
      serverTime: t0,
      sessionId: ROOT,
      sessions,
      availability,
      removed: [],
      entries: [
        {
          run: runMeta({
            runId: BASH,
            kind: 'bash',
            status: bashStatusRunning,
            ownerSessionId: ROOT,
            agent: { id: ROOT, name: 'lead', role: 'lead' },
            title: 'Bash',
            command: bashClass.command,
            startedAt: t0,
            durationMs: 0,
          }),
          output: {
            stdout: makeChannelDelta({ chunks: [makeChunk('RUNS  terminal-panel\n', t0)], nextCursor: 23 }),
          },
        },
        {
          run: runMeta({
            runId: JOB,
            kind: 'job',
            status: 'running',
            ownerSessionId: BACKEND,
            agent: { id: BACKEND, name: 'backend', role: 'teammate' },
            title: '后台任务',
            command: 'pnpm build --watch',
            startedAt: t0 + 100,
            durationMs: 0,
          }),
          output: {
            job: makeChannelDelta({ chunks: [makeChunk('build:start\n', t0 + 200, 'job')], nextCursor: 12 }),
          },
        },
        {
          run: runMeta({
            runId: TERM,
            kind: 'terminal',
            status: 'running',
            ownerSessionId: SCOUT,
            agent: { id: SCOUT, name: 'scout', role: 'subagent' },
            title: '终端',
            command: undefined,
            startedAt: t0 + 50,
            durationMs: 0,
            handle: { terminalId: 'term-1', terminalType: 'pty' },
          }),
          output: { terminal: termRead1.delta },
        },
      ],
    }
    frames.push(buildPollFrame(input, cursors, { maxBytes: 65536 }))
    cursors = frames[0].nextCursors
  }

  // frame2：bash 完成（+输出）；job 进入 stopping（+输出）；终端 probe 无新行
  {
    const input = {
      revision: 2,
      serverTime: t0 + 500,
      sessionId: ROOT,
      sessions,
      availability,
      removed: [],
      entries: [
        {
          run: runMeta({
            runId: BASH,
            kind: 'bash',
            status: bashStatusDone,
            ownerSessionId: ROOT,
            agent: { id: ROOT, name: 'lead', role: 'lead' },
            title: 'Bash',
            command: bashClass.command,
            startedAt: t0,
            finishedAt: t0 + 500,
            durationMs: 500,
          }),
          output: {
            stdout: makeChannelDelta({ chunks: [makeChunk('Tests: 12 passed\n', t0 + 400)], nextCursor: 42 }),
          },
        },
        {
          run: runMeta({
            runId: JOB,
            kind: 'job',
            status: jobStop.status,
            stopping: jobStop.stopping,
            ownerSessionId: BACKEND,
            agent: { id: BACKEND, name: 'backend', role: 'teammate' },
            title: '后台任务',
            command: 'pnpm build --watch',
            startedAt: t0 + 100,
            durationMs: 400,
          }),
          output: {
            job: makeChannelDelta({ chunks: [makeChunk('build:webpack\n', t0 + 450, 'job')], nextCursor: 27 }),
          },
        },
      ],
    }
    frames.push(buildPollFrame(input, cursors, { maxBytes: 65536 }))
    cursors = frames[1].nextCursors
  }

  // frame3：job 完成；bash 已从服务端保留窗口移除（removed）；终端新增一行
  {
    const input = {
      revision: 3,
      serverTime: t0 + 1_000,
      sessionId: ROOT,
      sessions,
      availability,
      removed: [BASH],
      entries: [
        {
          run: runMeta({
            runId: JOB,
            kind: 'job',
            status: jobDone.status,
            ownerSessionId: BACKEND,
            agent: { id: BACKEND, name: 'backend', role: 'teammate' },
            title: '后台任务',
            command: 'pnpm build --watch',
            startedAt: t0 + 100,
            finishedAt: t0 + 1_000,
            durationMs: 900,
          }),
          output: {
            job: makeChannelDelta({ chunks: [makeChunk('build:done\n', t0 + 900, 'job')], nextCursor: 39 }),
          },
        },
        {
          run: runMeta({
            runId: TERM,
            kind: 'terminal',
            status: 'running',
            ownerSessionId: SCOUT,
            agent: { id: SCOUT, name: 'scout', role: 'subagent' },
            title: '终端',
            command: undefined,
            startedAt: t0 + 50,
            durationMs: 950,
            handle: { terminalId: 'term-1', terminalType: 'pty' },
          }),
          output: { terminal: termRead2.delta },
        },
      ],
    }
    frames.push(buildPollFrame(input, cursors, { maxBytes: 65536 }))
    cursors = frames[2].nextCursors
  }

  check('buildPollFrame: 序列化帧合法（protocol/revision/runs/sessions/nextCursors）', () => {
    frames.forEach((frame, i) => {
      eq(frame.value.protocol, 1)
      eq(frame.value.revision, i + 1)
      eq(frame.value.sessionId, ROOT)
      eq(frame.value.sessions[0].sessionId, ROOT)
      eq(frame.value.sessions.map((s) => s.sessionId).slice().sort(), [ROOT, SCOUT, BACKEND].sort())
      assert(typeof frame.nextCursors === 'object', 'nextCursors 必须是对象')
    })
  })

  /* ---------- 5. 模拟 client：按帧轮询归约 ---------- */
  let state = {
    sessionId: ROOT,
    status: 'ready',
    revision: 0,
    sessions: [],
    runs: {},
    order: { running: [], completed: [] },
    columns: {},
    group: { completedCollapsed: true, expandedIds: [] },
    filter: { kind: 'all', sessionIds: null, search: '', autoExpandNew: true, showCompleted: true },
    availability,
    droppedLines: {},
    pendingFrameRevision: 0,
  }

  state = mergePoll(state, frames[0].value)
  check('轮询#1：三列进行中，agent 名 lead/backend/scout 正确', () => {
    eq(state.order.running.length, 3)
    const agents = state.order.running.map((id) => state.runs[id].agent.name)
    // §6.2：按 startedAt 升序（bash t0 → terminal t0+50 → job t0+100）
    eq(agents, ['lead', 'scout', 'backend'])
    for (const id of state.order.running) eq(state.runs[id].status, 'running')
  })

  state = mergePoll(state, frames[1].value)
  check('轮询#2：bash 进已完成，countdown(deadline) 已 arm', () => {
    assert(state.order.completed.includes(BASH), `completed 应含 ${BASH}，实际 ${JSON.stringify(state.order.completed)}`)
    const collapse = state.columns[BASH].collapse
    assert(typeof collapse.deadline === 'number', '终态列必须带 countdown deadline（ui-spec §2.2/§3.2）')
    eq(state.runs[BASH].status, 'completed')
    eq(state.runs[JOB].stopping, true)
  })
  check('轮询#2：输出增量 append（bash 累积两段命令输出）', () => {
    const strings = collectStrings(state).join('\n')
    assert(strings.includes('RUNS  terminal-panel'), 'bash 首段输出缺失')
    assert(strings.includes('Tests: 12 passed'), 'bash 增量输出缺失')
    assert(!strings.includes('RUNS  terminal-panelRUNS  terminal-panel'), '输出被重复 append')
  })

  state = mergePoll(state, frames[2].value)
  check('轮询#3：removed 的 bash 从 runs/columns/order 移除（§11.2）', () => {
    assert(!(BASH in state.runs), `removed run 仍在 runs：${BASH}`)
    assert(!(BASH in state.columns), `removed run 仍在 columns：${BASH}`)
    assert(!state.order.running.includes(BASH) && !state.order.completed.includes(BASH))
  })
  check('轮询#3：job 完成进入已完成并带 countdown 字段', () => {
    assert(state.order.completed.includes(JOB), `completed 应含 ${JOB}，实际 ${JSON.stringify(state.order.completed)}`)
    const collapse = state.columns[JOB].collapse
    assert(typeof collapse.deadline === 'number', 'job 完成必须 arm countdown')
    eq(state.runs[JOB].status, 'completed')
  })
  check('轮询#3：持久终端增量累积且不重复', () => {
    const termRun = state.runs[TERM] ?? {}
    const text = termRun.streams?.terminal?.text ?? termRun.output?.terminal?.text ?? ''
    assert(text.includes('new line'), '终端增量 new line 缺失')
    const occurrences = text.split('new line').length - 1
    eq(occurrences, 1, `终端增量不得重复交付，实际文本 ${JSON.stringify(text)}`)
    assert(text.includes('a b c'), '首帧终端文本必须保留')
  })

  /* ---------- 6. 最终视图帧断言 ---------- */
  const finalRunning = state.order.running.map((id) => state.runs[id])
  const finalCompleted = state.order.completed.map((id) => state.runs[id])
  check('最终视图：列数=1（仅终端仍运行），已完成=2（bash 被 removed）', () => {
    eq(finalRunning.length, 1, `进行中列数期望 1，实际 ${finalRunning.length}`)
    eq(finalRunning[0].runId, TERM)
    eq(finalCompleted.length, 1, `已完成期望 1（job），实际 ${finalCompleted.length}`)
    eq(finalCompleted[0].runId, JOB)
  })
  check('最终视图：会话作用域完整（3 个，供筛选器渲染）', () => {
    eq(state.sessions[0].sessionId, ROOT)
    eq(state.sessions.map((s) => s.sessionId).slice().sort(), [ROOT, SCOUT, BACKEND].sort())
  })
  check('最终视图：三类 Run 字段齐备（kind/status/agent/durationMs）', () => {
    const all = [...finalRunning, ...finalCompleted]
    for (const run of all) {
      for (const key of ['runId', 'kind', 'status', 'agent', 'title', 'startedAt', 'durationMs']) {
        assert(key in run, `${run.runId} 缺少字段 ${key}`)
      }
      assert(typeof run.agent.name === 'string' && run.agent.name.length > 0, `${run.runId} agent.name 为空`)
    }
    eq(new Set(all.map((r) => r.kind)).size, 2) // terminal + job
  })
  check('最终视图：nextCursors 已推进且覆盖所有出现过 Run 的通道', () => {
    assert(Object.keys(cursors).length >= 2, `nextCursors 覆盖不足：${JSON.stringify(cursors)}`)
    assert(typeof cursors[JOB]?.job === 'number', 'job 通道游标缺失')
    assert(typeof cursors[TERM]?.terminal === 'number', 'terminal 通道游标缺失')
  })

  return {
    status: 'passed',
    checks: checks.map((c) => ({ label: c.label, ok: c.ok })),
    frames: frames.length,
  }
}

/* ---------- 独立运行入口 ---------- */
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url
if (isMain) {
  try {
    const result = await run()
    if (result.status === 'skipped') {
      console.log('SKIP: 依赖尚未就绪，冒烟未执行')
      for (const reason of result.reasons) console.log(`  - ${reason}`)
      process.exit(0)
    }
    console.log(`E2E SMOKE: ${result.checks.length} 项断言全部通过（${result.frames} 帧轮询序列）`)
    for (const c of result.checks) console.log(`  ✓ ${c.label}`)
    process.exit(0)
  } catch (error) {
    console.error(`E2E SMOKE FAILED: ${error.message}`)
    if (error.stack) console.error(error.stack)
    process.exit(1)
  }
}
