#!/usr/bin/env node
/**
 * smoke-host.mjs — Host 半端冒烟（mock ctx，无真实 DSH 进程）。
 *
 * 覆盖路径（契约 v2 §11.1 末段）：
 *   0. 装配：apply 注册 exact 路由；dispose 后路由撤销、shell.execute 还原。
 *   1. bash 增量 → 完成 → 终态（tee 可用：observed.readFrom 增量、不重复、终态 exitCode）。
 *   2. bash tee 不可用 → tools/execute 出幽灵 Run → tools/result 补终态输出（final-only）。
 *   3. job 列表 → 增量 → 终态 → kill。
 *   4. terminal 行增量 → 换行边界正确 → 去重 → scrollback 裁剪（lossy）。
 *
 * 退出码 0 = 全部断言通过。
 *
 * 运行：node scripts/smoke-host.mjs
 */

import { apply, inject, name } from '../lib/index.js'
import { createPanel } from '../lib/host/panel.mjs'

let failures = 0
let checks = 0

/**
 * 断言并打印。
 * @param {boolean} condition
 * @param {string} label
 * @param {unknown} [detail]
 */
function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ✓ ${label}`)
    return
  }
  failures += 1
  console.log(`  ✗ ${label}${detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`)
}

/** 分隔标题。 */
function section(title) {
  console.log(`\n[${title}]`)
}

/** 等待微任务/计时器一轮，让包装里的 promise 回调跑完。 */
function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** 构造测试用 Agent（terminals/jobs 的 owner 凭据按对象身份比较）。 */
function makeAgent(id) {
  return { id, name: id }
}

/**
 * mock cordis Context。
 * @param {{services?: Record<string, any>}} [options]
 */
function createMockContext(options = {}) {
  const services = options.services ?? {}
  const listeners = new Map()
  const routes = []
  const cleanups = []

  const ctx = {
    logger: {
      warn() {},
      info() {},
    },
    get(serviceName) {
      return services[serviceName]
    },
    on(event, listener) {
      const list = listeners.get(event) ?? []
      list.push(listener)
      listeners.set(event, list)
      return () => {
        const index = list.indexOf(listener)
        if (index >= 0) list.splice(index, 1)
      }
    },
    effect(callback, _label) {
      const cleanup = callback()
      cleanups.push(cleanup)
      return {
        dispose() {
          if (typeof cleanup === 'function') cleanup()
        },
      }
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
    },
    connection: {
      requestRejection() {
        return undefined
      },
    },
  }

  /** waterfall：tools/execute 依次经过监听器，最后由 body 执行工具。 */
  async function runToolsExecute(exec, body) {
    const list = [...(listeners.get('tools/execute') ?? [])]
    let index = -1
    const next = () => {
      index += 1
      if (index >= list.length) return body()
      return Promise.resolve(list[index](exec, next))
    }
    return next()
  }

  /** emit：tools/result（observer，不影响结果）。 */
  function emitToolsResult(exec, result) {
    for (const listener of listeners.get('tools/result') ?? []) {
      try {
        listener(exec, result)
      } catch (error) {
        console.warn('[smoke] tools/result listener failed:', error)
      }
    }
  }

  return { ctx, routes, listeners, cleanups, runToolsExecute, emitToolsResult }
}

/**
 * 假 ShellExecution（observed.readFrom 非消费式；done 可手动 settle）。
 * @param {{pid?: number}} [options]
 */
function createExecution(options = {}) {
  let stdout = ''
  let stderr = ''
  let settle
  const handle = {
    pid: options.pid ?? 4321,
    status: 'running',
    exitCode: null,
    signal: null,
    observed: {
      stdout: {
        readFrom(from) {
          return { text: stdout.slice(from), nextOffset: stdout.length, lossy: false }
        },
      },
      stderr: {
        readFrom(from) {
          return { text: stderr.slice(from), nextOffset: stderr.length, lossy: false }
        },
      },
    },
    done: new Promise((resolve) => {
      settle = resolve
    }),
    kill() {
      handle.status = 'killed'
      return true
    },
    result() {
      return handle.done.then(() => ({
        exitCode: handle.exitCode,
        signal: handle.signal,
        timedOut: false,
        aborted: false,
        stdout: { text: stdout, truncated: false },
        stderr: { text: stderr, truncated: false },
      }))
    },
    // 测试辅助
    writeOut(text) {
      stdout += text
    },
    writeErr(text) {
      stderr += text
    },
    finish(exitCode) {
      handle.status = 'completed'
      handle.exitCode = exitCode
      settle()
    },
  }
  return handle
}

/** 假 shell 服务（一个 workspace，可拿到句柄 → tee 可用）。 */
function createShellService() {
  const executions = []
  let nextExecution = createExecution()
  return {
    executions,
    resolve(request) {
      return { command: request.command, workdir: request.workdir ?? '/work', dshEnv: request.dshEnv ?? {}, ...request }
    },
    async execute(spec) {
      const execution = nextExecution
      executions.push({ spec, execution })
      nextExecution = createExecution({ pid: 4000 + executions.length + 1 })
      return execution
    },
  }
}

/**
 * 假 terminals（严格按 newest-relative 语义实现）。
 * @param {string[]} lines
 */
function createTerminalState(lines) {
  const state = {
    lines,
    truncated: false,
    sessionId: 'term-1',
    name: 'dev shell',
    type: 'bash',
    pid: 9001,
    status: { kind: 'running' },
  }
  state.read = (request = {}) => {
    const total = state.lines.length
    const offset = Number.isSafeInteger(request.offset) ? request.offset : 0
    const count = Number.isSafeInteger(request.count) ? request.count : 500
    if (offset >= total) {
      return { text: '', totalLines: total, lineBegin: offset, lineEnd: offset, truncated: state.truncated }
    }
    const end = total - offset
    const start = Math.max(0, end - count)
    const page = state.lines.slice(start, end)
    return {
      text: page.join('\n'),
      totalLines: total,
      lineBegin: offset,
      lineEnd: offset + page.length,
      truncated: state.truncated,
    }
  }
  return state
}

/** 假 terminals 服务。 */
function createTerminalService(statesByAgent) {
  return {
    list(agent) {
      return (statesByAgent.get(agent) ?? []).map((state) => ({
        sessionId: state.sessionId,
        name: state.name,
        type: state.type,
        pid: state.pid,
        status: state.status,
      }))
    },
    read(agent, id, request) {
      const state = (statesByAgent.get(agent) ?? []).find((candidate) => candidate.sessionId === id)
      if (state === undefined) throw new Error(`unknown PTY session ${id}`)
      return state.read(request)
    },
    async kill(agent, id) {
      const state = (statesByAgent.get(agent) ?? []).find((candidate) => candidate.sessionId === id)
      if (state !== undefined) state.status = { kind: 'exited', exitCode: 0, signal: null }
      return true
    },
  }
}

/** 假 jobs 服务。 */
function createJobsService() {
  /** @type {Map<string, {view: any, chunks: Array<{at:number,text:string,channel?:string}>}>} */
  const jobs = new Map()
  /** @type {Map<string, string>} jobId → ownerSessionId */
  const owners = new Map()
  return {
    jobs,
    add(jobId, ownerSessionId, label) {
      owners.set(jobId, ownerSessionId)
      jobs.set(jobId, {
        view: {
          id: jobId,
          kind: 'bash',
          label,
          owner: ownerSessionId,
          status: 'running',
          startedAt: Date.now(),
          output: { total: 0, earliest: 0 },
        },
        chunks: [],
      })
    },
    append(jobId, text) {
      const entry = jobs.get(jobId)
      entry.chunks.push({ at: entry.view.output.total, text })
      entry.view.output.total += Buffer.byteLength(text, 'utf8')
    },
    finish(jobId, status = 'completed') {
      const entry = jobs.get(jobId)
      entry.view.status = status
      entry.view.finishedAt = 2000
    },
    list(caller) {
      return [...jobs.values()]
        .filter((entry) => entry.view.owner === undefined || entry.view.owner === caller)
        .map((entry) => ({ ...entry.view, output: { ...entry.view.output } }))
    },
    readAt(id, from, caller) {
      const entry = jobs.get(id)
      if (entry === undefined) throw new Error(`unknown job ${id}`)
      if (entry.view.owner !== undefined && entry.view.owner !== caller) throw new Error(`foreign job ${id}`)
      const chunks = entry.chunks.filter((chunk) => chunk.at + Buffer.byteLength(chunk.text) > from)
      return { chunks: chunks.map((chunk) => ({ ...chunk })), next: entry.view.output.total, lossy: false }
    },
    kill(id, caller) {
      const entry = jobs.get(id)
      if (entry === undefined) throw new Error(`unknown job ${id}`)
      if (entry.view.status !== 'running') return 'already-finished'
      entry.view.status = 'stopping'
      return 'requested'
    },
  }
}

/** 从 poll 帧里取某个 run。 */
function runOf(frame, runId) {
  return frame?.runs?.find((run) => run.runId === runId)
}

/** 取某个通道本轮文本。 */
function textOf(run, channel) {
  const delta = run?.output?.[channel]
  if (delta === undefined) return ''
  if (typeof delta.text === 'string') return delta.text
  return (delta.chunks ?? []).map((chunk) => chunk.text).join('')
}

async function main() {
  console.log('dsh-terminal-panel · host smoke (mock ctx)')

  // ---------------------------------------------------------------- 0. 装配
  section('0. assembly (apply / route / dispose)')
  {
    const shell = createShellService()
    const mock = createMockContext({
      services: {
        shell,
        jobs: createJobsService(),
        terminals: createTerminalService(new Map()),
        agents: { get: () => undefined },
        subagents: { listDescendants: async () => [] },
      },
    })
    const exported = apply(mock.ctx, {})
    check(name === 'terminal-panel', 'export name = terminal-panel', name)
    check(inject.join(',') === 'webServer,connection', 'export inject = [webServer, connection]', inject)
    check(mock.routes.length === 1, 'registers exactly one route', mock.routes.length)
    check(mock.routes[0]?.kind === 'exact', 'route kind = exact', mock.routes[0]?.kind)
    check(mock.routes[0]?.path === '/terminal-panel/rpc', 'route path = /terminal-panel/rpc', mock.routes[0]?.path)
    check(typeof mock.routes[0]?.handler === 'function', 'route has handler')
    check(exported?.panel !== undefined, 'apply returns panel instance')
    const wrapped = shell.execute
    check(typeof wrapped === 'function' && wrapped.name === 'terminalPanelShellExecute', 'shell.execute is tee-wrapped')
    // cleanup
    for (const cleanup of mock.cleanups) if (typeof cleanup === 'function') cleanup()
    check(mock.routes.length === 0, 'dispose removes the route', mock.routes.length)
    check(shell.execute !== wrapped, 'dispose restores original shell.execute')
    const hello = await exported.panel.handleRpc('panel.hello', {})
    check(hello.ok === true, 'hello still answers after dispose (panel object alive)', hello.ok)
    const unknown = await exported.panel.handleRpc('panel.nope', {})
    check(unknown.ok === false && unknown.error.code === 'unknown-method', 'unknown method → unknown-method', unknown)
  }

  // -------------------------------------------------------- 1. bash with tee
  section('1. bash live (tee available): increment → more → terminal state')
  {
    const shell = createShellService()
    const rootAgent = makeAgent('session-root')
    const mock = createMockContext({
      services: {
        shell,
        tools: {},
        agents: { get: (id) => (id === 'session-root' ? rootAgent : undefined) },
        subagents: { listDescendants: async () => [] },
      },
    })
    const { panel } = apply(mock.ctx, {})

    const exec = { callId: 'call-1', name: 'bash', arguments: { command: 'echo hi' }, agent: rootAgent }
    const body = async () => {
      const spec = shell.resolve({ command: exec.arguments.command, dshEnv: { DSH_SESSION_ID: exec.agent.id } })
      const execution = await shell.execute(spec)
      return { content: [{ type: 'text', text: '[exit code: 0]' }], isError: false, execution }
    }
    const dispatched = mock.runToolsExecute(exec, body)
    await flush()
    const execution = shell.executions[0].execution
    execution.writeOut('hello\n')
    await flush()

    const first = await panel.handleRpc('panel.poll', { sessionId: 'session-root' })
    const run1 = runOf(first.value, 'bash:call-1')
    check(first.ok === true, 'poll ok')
    check(run1 !== undefined, 'bash run appears immediately after tools/execute')
    check(run1?.status === 'running', 'bash run status = running', run1?.status)
    check(run1?.outputMode === 'live', 'outputMode = live after tee attaches', run1?.outputMode)
    check(textOf(run1, 'stdout') === 'hello\n', 'first frame delivers stdout increment', textOf(run1, 'stdout'))
    check(first.value.nextCursors['bash:call-1']?.stdout === 6, 'nextCursors.stdout = 6 bytes', first.value.nextCursors['bash:call-1'])

    const second = await panel.handleRpc('panel.poll', {
      sessionId: 'session-root',
      cursors: first.value.nextCursors,
    })
    check(runOf(second.value, 'bash:call-1') === undefined, 'no duplicate bytes on unchanged poll')
    check(second.value.nextCursors['bash:call-1'] === undefined, 'unchanged run omits nextCursors')

    execution.writeOut('world\n')
    const third = await panel.handleRpc('panel.poll', {
      sessionId: 'session-root',
      cursors: first.value.nextCursors,
    })
    check(textOf(runOf(third.value, 'bash:call-1'), 'stdout') === 'world\n', 'second increment is exactly the new bytes')
    check(third.value.nextCursors['bash:call-1']?.stdout === 12, 'cursor advances to 12', third.value.nextCursors['bash:call-1'])

    execution.finish(0)
    await flushed(dispatched)
    mock.emitToolsResult(exec, {
      content: [{ type: 'text', text: 'hello\nworld\n[exit code: 0]' }],
      isError: false,
    })
    const fourth = await panel.handleRpc('panel.poll', {
      sessionId: 'session-root',
      cursors: third.value.nextCursors,
    })
    const run4 = runOf(fourth.value, 'bash:call-1')
    check(run4?.status === 'completed', 'shell exit 0 → completed', run4?.status)
    check(run4?.exitCode === 0, 'exitCode propagated', run4?.exitCode)
    check(run4?.durationMs >= 0, 'durationMs present', run4?.durationMs)
    check(run4?.agent?.role === 'lead', 'root session agent role = lead', run4?.agent)
    check(run4?.output === undefined, 'no duplicate output when tee already delivered it', run4?.output)
    const hello = await panel.handleRpc('panel.hello', {})
    check(hello.value.availability.bashLive.available === true, 'bashLive becomes available after a handle was captured')
    panel.dispose()
  }

  // ------------------------------------------------------ 2. bash final-only
  section('2. bash final-only (tee unavailable): tools/execute + tools/result')
  {
    const rootAgent = makeAgent('session-root')
    const mock = createMockContext({
      services: {
        tools: {},
        agents: { get: (id) => (id === 'session-root' ? rootAgent : undefined) },
        subagents: { listDescendants: async () => [] },
      },
    })
    const { panel } = apply(mock.ctx, {})
    const hello = await panel.handleRpc('panel.hello', {})
    check(hello.value.availability.bash.available === true, 'bash source still available without tee')
    check(hello.value.availability.bashLive.available === false, 'bashLive = unavailable (no shell)')
    check(hello.value.availability.bashLive.reason === 'shell service unavailable', 'bashLive reason', hello.value.availability.bashLive)

    const exec = { callId: 'call-2', name: 'bash', arguments: { command: 'make test' }, agent: rootAgent }
    await mock.runToolsExecute(exec, async () => ({ content: [{ type: 'text', text: '' }], isError: false }))
    const first = await panel.handleRpc('panel.poll', { sessionId: 'session-root' })
    const run = runOf(first.value, 'bash:call-2')
    check(run?.status === 'running', 'ghost run appears while running', run?.status)
    check(run?.outputMode === 'final-only', 'outputMode = final-only', run?.outputMode)
    check(run?.command === 'make test', 'command captured from arguments', run?.command)
    check(run?.stoppable === false, 'final-only run is not stoppable', run?.stoppable)
    check(textOf(run, 'stdout') === '', 'no output before the tool result')

    const killRunning = await panel.handleRpc('panel.kill', { sessionId: 'session-root', runId: 'bash:call-2' })
    check(killRunning.ok === false && killRunning.error.code === 'run-not-stoppable', 'final-only running kill → run-not-stoppable', killRunning)

    mock.emitToolsResult(exec, {
      content: [{ type: 'text', text: 'ok 12 tests\n[exit code: 0]' }],
      isError: false,
    })
    const second = await panel.handleRpc('panel.poll', {
      sessionId: 'session-root',
      cursors: first.value.nextCursors,
    })
    const done = runOf(second.value, 'bash:call-2')
    check(done?.status === 'completed', 'final-only run reaches completed', done?.status)
    check(textOf(done, 'stdout').includes('ok 12 tests'), 'final output delivered once', textOf(done, 'stdout'))
    check(done?.detail === 'final-only', 'detail marks final-only', done?.detail)

    const killFinished = await panel.handleRpc('panel.kill', { sessionId: 'session-root', runId: 'bash:call-2' })
    check(killFinished.ok === true && killFinished.value.outcome === 'already-finished', 'finished run kill → already-finished', killFinished)

    const invisible = await panel.handleRpc('panel.kill', { sessionId: 'session-root', runId: 'bash:nope' })
    check(invisible.ok === false && invisible.error.code === 'run-not-found', 'invisible run → run-not-found', invisible)
    panel.dispose()
  }

  // --------------------------------------- 2c. promoted foreground → job hand-off
  section('2c. promoted foreground bash: ghost run hands over to the job run')
  {
    const shell = createShellService()
    const rootAgent = makeAgent('session-root')
    const jobs = createJobsService()
    jobs.add('job-9', 'session-root', 'slow task')
    jobs.append('job-9', 'partial output\n')
    const mock = createMockContext({
      services: {
        shell,
        tools: {},
        jobs,
        agents: { get: (id) => (id === 'session-root' ? rootAgent : undefined) },
        subagents: { listDescendants: async () => [] },
      },
    })
    const { panel } = apply(mock.ctx, {})
    const exec = { callId: 'call-9', name: 'bash', arguments: { command: 'slow task' }, agent: rootAgent }
    await mock.runToolsExecute(exec, async () => {
      const spec = shell.resolve({ command: 'slow task', dshEnv: { DSH_SESSION_ID: 'session-root' } })
      await shell.execute(spec)
      return { content: [{ type: 'text', text: '' }], isError: false }
    })
    const first = await panel.handleRpc('panel.poll', { sessionId: 'session-root' })
    const ghost = runOf(first.value, 'bash:call-9')
    check(ghost !== undefined && ghost.status === 'running', 'foreground run appears while the command is still running', ghost?.status)
    check(runOf(first.value, 'job:job-9') === undefined, 'transient foreground job is de-duplicated', first.value.runs.map((run) => run.runId))

    mock.emitToolsResult(exec, {
      content: [{ type: 'text', text: '[still running after 100ms; moved to background job job-9]' }],
      isError: false,
    })
    const second = await panel.handleRpc('panel.poll', { sessionId: 'session-root', cursors: first.value.nextCursors })
    check(runOf(second.value, 'bash:call-9') === undefined, 'ghost run is removed after promotion')
    check(second.value.removed.includes('bash:call-9'), 'removed list tells the client to drop the ghost column')
    const promoted = runOf(second.value, 'job:job-9')
    check(promoted?.kind === 'job', 'promoted job becomes the single visible run', promoted?.kind)
    check(textOf(promoted, 'job') === 'partial output\n', 'promoted job delivers its ring output', textOf(promoted, 'job'))
    panel.dispose()
  }

  // ---------------------------------------------------------------- 3. jobs
  section('3. jobs: list → increment → terminal state → kill')
  {
    const rootAgent = makeAgent('session-root')
    const childAgent = makeAgent('session-child')
    const jobs = createJobsService()
    jobs.add('job-1', 'session-child', 'npm run build')
    jobs.append('job-1', 'compiling...\n')
    const mock = createMockContext({
      services: {
        tools: {},
        jobs,
        agents: { get: (id) => (id === 'session-root' ? rootAgent : id === 'session-child' ? childAgent : undefined) },
        subagents: {
          listDescendants: async () => [
            { kind: 'child', id: 'session-child', parentId: 'session-root', depth: 1, mode: 'continuable', label: 'builder', activity: 'running', hasChildren: false },
            { kind: 'diagnostic', id: 'session-broken', parentId: 'session-root', depth: 1, reason: 'corrupt' },
          ],
        },
      },
    })
    const { panel } = apply(mock.ctx, {})
    const first = await panel.handleRpc('panel.poll', { sessionId: 'session-root' })
    check(first.value.sessions.length === 2, 'tree = root + 1 child (diagnostic skipped)', first.value.sessions.length)
    check(first.value.sessions[0]?.role === 'root', 'root is first', first.value.sessions[0])
    check(first.value.sessions[1]?.role === 'subagent', 'child is a subagent scope', first.value.sessions[1])
    const run = runOf(first.value, 'job:job-1')
    check(run?.kind === 'job', 'job run discovered by scanning child session', run?.kind)
    check(run?.ownerSessionId === 'session-child', 'job ownerSessionId = child session', run?.ownerSessionId)
    check(run?.command === 'npm run build', 'job label becomes command', run?.command)
    check(textOf(run, 'job') === 'compiling...\n', 'job ring increment delivered', textOf(run, 'job'))

    jobs.append('job-1', 'done in 1200ms\n')
    jobs.finish('job-1', 'completed')
    const second = await panel.handleRpc('panel.poll', {
      sessionId: 'session-root',
      cursors: first.value.nextCursors,
    })
    const done = runOf(second.value, 'job:job-1')
    check(done?.status === 'completed', 'job completed status', done?.status)
    check(textOf(done, 'job') === 'done in 1200ms\n', 'job latest increment only', textOf(done, 'job'))
    check(done?.stoppable === false, 'completed job not stoppable')

    jobs.add('job-2', 'session-root', 'sleep 100')
    jobs.append('job-2', 'waiting\n')
    const third = await panel.handleRpc('panel.poll', {
      sessionId: 'session-root',
      cursors: second.value.nextCursors,
    })
    const running = runOf(third.value, 'job:job-2')
    check(running?.status === 'running', 'second job running', running?.status)
    const killed = await panel.handleRpc('panel.kill', { sessionId: 'session-root', runId: 'job:job-2' })
    check(killed.ok === true && killed.value.outcome === 'requested', 'kill job → requested', killed)
    panel.dispose()
  }

  // ------------------------------------------------------------ 4. terminals
  section('4. terminals: line increment → newline boundary → dedupe → scrollback drop')
  {
    const rootAgent = makeAgent('session-root')
    const terminal = createTerminalState(['a', 'b', 'c'])
    const states = new Map([[rootAgent, [terminal]]])
    const mock = createMockContext({
      services: {
        tools: {},
        terminals: createTerminalService(states),
        agents: { get: (id) => (id === 'session-root' ? rootAgent : undefined) },
        subagents: { listDescendants: async () => [] },
      },
    })
    const { panel } = apply(mock.ctx, {})
    const cursorsOf = (frame) => frame.value.nextCursors

    const first = await panel.handleRpc('panel.poll', { sessionId: 'session-root' })
    const run = runOf(first.value, 'terminal:term-1')
    check(run?.kind === 'terminal', 'terminal run appears', run?.kind)
    check(run?.handle?.terminalType === 'bash', 'terminal type captured', run?.handle)
    let buffer = textOf(run, 'terminal')
    check(buffer === 'a\nb\nc', 'initial tail page text', buffer)
    check(cursorsOf(first)['terminal:term-1']?.terminal === 3, 'terminal cursor = totalLines(3)', cursorsOf(first))

    terminal.lines.push('d')
    const second = await panel.handleRpc('panel.poll', { sessionId: 'session-root', cursors: cursorsOf(first) })
    const deltaText = textOf(runOf(second.value, 'terminal:term-1'), 'terminal')
    buffer += deltaText
    check(deltaText === '\nd', 'delta keeps the line boundary (\\nd, not d)', deltaText)
    check(buffer === 'a\nb\nc\nd', 'appended text has no line join', buffer)

    segment: {
      terminal.lines.push('e')
      terminal.lines.push('f')
      const third = await panel.handleRpc('panel.poll', { sessionId: 'session-root', cursors: cursorsOf(second) })
      const text = textOf(runOf(third.value, 'terminal:term-1'), 'terminal')
      buffer += text
      check(text === '\ne\nf', 'multi-line delta keeps one line per row', text)
      check(buffer === 'a\nb\nc\nd\ne\nf', 'accumulated terminal text is well-formed', buffer)

      const fourth = await panel.handleRpc('panel.poll', { sessionId: 'session-root', cursors: cursorsOf(third) })
      check(runOf(fourth.value, 'terminal:term-1') === undefined, 'idle poll has no duplicate terminal rows')
    }

    // scrollback 头部被裁剪：totalLines 回退 → lossy + 重置
    terminal.lines = ['x', 'y']
    terminal.truncated = true
    const dropped = await panel.handleRpc('panel.poll', {
      sessionId: 'session-root',
      cursors: { 'terminal:term-1': { terminal: 6 } },
    })
    const droppedRun = runOf(dropped.value, 'terminal:term-1')
    check(droppedRun?.output?.terminal?.lossy === true, 'scrollback drop → lossy', droppedRun?.output?.terminal)
    check(textOf(droppedRun, 'terminal') === 'x\ny', 'after drop the retained page is re-sent', textOf(droppedRun, 'terminal'))

    // kill terminal（用户停止）
    const killed = await panel.handleRpc('panel.kill', { sessionId: 'session-root', runId: 'terminal:term-1' })
    check(killed.ok === true && killed.value.outcome === 'requested', 'kill terminal → requested', killed)
    panel.dispose()
  }

  // ---------------------------------------------------------------- summary
  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — ${checks - failures}/${checks} checks passed`)
  if (failures > 0) {
    process.exitCode = 1
  }
}

/** 等待一个 dispatch promise，允许它在断言里已 settle。 */
async function flushed(promise) {
  if (promise === undefined) return
  try {
    await promise
  } catch {
    // smoke 不关心工具结果
  }
}

main().catch((error) => {
  console.error('\nsmoke-host crashed:', error)
  process.exitCode = 1
})
