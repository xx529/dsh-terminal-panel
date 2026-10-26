/**
 * capture-bash.mjs — 前台 bash 采集（三层降级，Lead 裁决）。
 *
 * a) **只读旁路 tee**：尝试包装 `ctx.shell.execute`。包装体必须原样调用原方法、
 *    原样返回原返回值/原句柄；自己只拿返回的 `ShellExecution` 做旁路读取
 *    （`observed.stdout.readFrom` / `observed.stderr.readFrom`，非消费式）。
 *    任何异常 → 注销包装 + `availability.bash = {available:false, code:'error'}`。
 *    ⚠ 实测风险（scout §4.2 / Lead）：服务可能是只读属性或调用链不经过本上下文，
 *    因此**不能保证**捕获到句柄 —— 所以还有 b/c 两层兜底。
 *
 * b) 幽灵 Run：`tools/execute`（waterfall，只记录、不改 exec、必须 `return await next()`）
 *    记录前台 bash 的 command/startedAt/status=running；有 `exec.agent?.id` 才归属。
 *
 * c) 终态输出：`tools/result`（emit，observer，不可影响工具链）取
 *    `ToolExecutionResult.content` 的文本给 Run 补最终输出（`finalOnly:true`）。
 *    这样即使 a 完全失败，面板仍能看到「命令 + 结束输出」。
 *
 * 纯逻辑之外的胶水：只用注入的 store/句柄，不 import 任何 DSH 包。
 */

import { limitDelta, mergeChannel, splitChunks, tailBytes, textBytes } from './cursors.mjs'
import { parseToolResultText } from './frame.mjs'
import { isTerminalStatus, mapShellStatus, mapToolResultStatus, shellDetail } from './status.mjs'

/** 幽灵 Run 的 runId（bash 源以 callId 为 sourceId，契约 §5.1）。 */
export function bashRunId(callId) {
  return `bash:${callId}`
}

/** shell spec 里携带的属主会话（`ctx.shellEnv.collect(exec)` 注入，见 shell-env 实现）。 */
const SESSION_ENV_KEY = 'DSH_SESSION_ID'

/**
 * 包装 `shell.execute`（只读旁路）。
 * @param {any} shell `ctx.shell` 服务实例
 * @param {(execution: any, spec: any) => void} onExecution 句柄回调（异常必须由调用方吞掉）
 * @param {{warn?: Function}} [logger]
 * @returns {(() => void)|undefined} 还原函数；无法包装时 undefined
 */
export function wrapShellExecute(shell, onExecution, logger) {
  if (shell === null || typeof shell !== 'object' || typeof shell.execute !== 'function') return undefined
  const original = shell.execute
  const wrapped = function terminalPanelShellExecute(spec) {
    const returned = original.call(this, spec)
    try {
      // 句柄可能是 Promise（async execute）；解析后旁路登记，绝不改变返回给调用方的引用。
      if (returned !== null && typeof returned === 'object' && typeof returned.then === 'function') {
        returned.then(
          (execution) => {
            try {
              onExecution(execution, spec)
            } catch (error) {
              logger?.warn?.('[terminal-panel] bash tee failed:', error?.message ?? error)
            }
          },
          () => {},
        )
      }
    } catch (error) {
      logger?.warn?.('[terminal-panel] bash tee hook failed:', error?.message ?? error)
    }
    return returned
  }
  try {
    shell.execute = wrapped
  } catch (error) {
    logger?.warn?.('[terminal-panel] cannot decorate shell.execute:', error?.message ?? error)
    return undefined
  }
  return () => {
    try {
      if (shell.execute === wrapped) shell.execute = original
    } catch {
      // 服务被销毁/只读时忽略。
    }
  }
}

/**
 * 从工具参数里取 bash 命令行（兼容 command 字段）。
 * @param {unknown} name
 * @param {unknown} args
 * @returns {string|undefined}
 */
function argsCommand(args) {
  const value = args !== null && typeof args === 'object' ? args : {}
  return typeof value.command === 'string' ? value.command : undefined
}

/**
 * 工具结果文本（`ToolExecutionResult.content` 里的 text 块）。
 * @param {unknown} result
 * @returns {string}
 */
export function contentText(result) {
  if (result === null || typeof result !== 'object') return ''
  const content = Array.isArray(result.content) ? result.content : []
  return content
    .filter((item) => item !== null && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
}

/**
 * 从渲染后的 bash 结果里解析退出标记（`dsh-shell` 的 `[exit code: N]` 约定）。
 * @param {string} text
 * @returns {{body: string, exitCode?: number, signal?: string}}
 */
export function parseExitMarker(text) {
  const source = typeof text === 'string' ? text : ''
  const signal = /\n?\[killed by signal: ([^\]\n]+)\]$/.exec(source)
  if (signal?.[1] !== undefined) return { body: source.slice(0, signal.index), signal: signal[1] }
  const exit = /\n?\[exit code: (\d+)\]$/.exec(source)
  if (exit?.[1] !== undefined) return { body: source.slice(0, exit.index), exitCode: Number(exit[1]) }
  return { body: source }
}

/**
 * 创建 bash 采集器。
 * @param {{store: any, config: any, now?: () => number, logger?: any}} options
 */
export function createBashCapture(options) {
  const store = options.store
  const config = options.config
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger

  /** callId → 工具调用记录（用于 tools/result 关联与 shell 句柄匹配）。 */
  const calls = new Map()
  /** `${sessionId}\u0000${command}` → callId[]（等待 shell.execute 认领） */
  const awaitingHandle = new Map()
  /** runId → 私有状态（避免污染 store 的 JSON 记录） */
  const states = new Map()

  const CALL_TTL_MS = 60_000

  function stateOf(runId) {
    let state = states.get(runId)
    if (state === undefined) {
      state = { execution: undefined, finalOutput: false }
      states.set(runId, state)
    }
    return state
  }

  function keyOf(sessionId, command) {
    return `${sessionId}\u0000${command ?? ''}`
  }

  /**
   * b) tools/execute 记录：创建幽灵 Run（不创建后台 bash —— 那由 jobs 覆盖）。
   * @param {{callId: string, sessionId: string, name: string, command?: string, cwd?: string, startedAt: number}} call
   */
  function noteToolCall(call) {
    if (call === null || typeof call !== 'object') return
    if (typeof call.callId !== 'string' || typeof call.sessionId !== 'string') return
    const record = {
      callId: call.callId,
      sessionId: call.sessionId,
      name: call.name,
      command: call.command,
      cwd: call.cwd,
      startedAt: Number.isFinite(call.startedAt) ? call.startedAt : now(),
    }
    calls.set(call.callId, record)
    const key = keyOf(record.sessionId, record.command)
    const queue = awaitingHandle.get(key) ?? []
    queue.push(record.callId)
    awaitingHandle.set(key, queue)
    // 绑定到当前可见的命令行；等待 shell.execute 认领后升级为可增量读取的 Run。
    store.upsert({
      runId: bashRunId(record.callId),
      kind: 'bash',
      ownerSessionId: record.sessionId,
      title: 'Bash',
      command: record.command,
      cwd: record.cwd,
      startedAt: record.startedAt,
      status: 'running',
      stoppable: false,
      outputMode: 'final-only',
      detail: 'final-only',
      handle: { toolCallId: record.callId },
    })
  }

  /**
   * 按 (sessionId, command) 认领最近的等待中调用。
   * @param {string} sessionId
   * @param {string|undefined} command
   * @returns {object|undefined}
   */
  function claimCall(sessionId, command) {
    const key = keyOf(sessionId, command)
    const queue = awaitingHandle.get(key)
    if (queue === undefined || queue.length === 0) return undefined
    const callId = queue.shift()
    if (queue.length === 0) awaitingHandle.delete(key)
    if (typeof callId !== 'string') return undefined
    const record = calls.get(callId)
    if (record === undefined) return undefined
    if (now() - record.startedAt > CALL_TTL_MS) return undefined
    return record
  }

  /**
   * a) shell.execute 旁路：登记句柄、开始增量读取。
   * @param {any} execution `ShellExecution`
   * @param {any} spec 已解析 spec（含 dshEnv / command / workdir）
   */
  function attachExecution(execution, spec) {
    if (execution === null || typeof execution !== 'object') return
    const sessionId = spec?.dshEnv?.[SESSION_ENV_KEY]
    const command = typeof spec?.command === 'string' ? spec.command : argsCommand(undefined)
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      // 无法归属（非模型工具触发的 shell）→ 不建立 Run，保持面板干净。
      return
    }
    const call = claimCall(sessionId, command)
    const runId = call !== undefined ? bashRunId(call.callId) : `bash:anon:${sessionId}:${Math.random().toString(36).slice(2, 8)}`
    const state = stateOf(runId)
    state.execution = execution
    state.finalOutput = false
    store.setLive(runId, state)
    store.upsert({
      runId,
      kind: 'bash',
      ownerSessionId: sessionId,
      title: 'Bash',
      command: command ?? call?.command,
      cwd: typeof spec?.workdir === 'string' ? spec.workdir : call?.cwd,
      startedAt: now(),
      status: 'running',
      stoppable: true,
      outputMode: 'live',
      detail: null,
      handle: {
        ...(call !== undefined ? { toolCallId: call.callId } : {}),
        ...(typeof execution.pid === 'number' ? { pid: execution.pid } : {}),
      },
    })
    // 终态同步：done 一定 settle 且不 reject（§4.2 F9）。
    const done = execution.done
    if (done !== null && typeof done === 'object' && typeof done.then === 'function') {
      Promise.resolve(done).then(
        () => {
          syncExecutionStatus(runId, execution)
        },
        () => {
          syncExecutionStatus(runId, execution)
        },
      )
    }
  }

  /**
   * 从句柄刷新终态。
   * @param {string} runId
   * @param {any} execution
   */
  function syncExecutionStatus(runId, execution) {
    try {
      const status = mapShellStatus(execution)
      const detail = shellDetail({
        status: execution?.status,
        exitCode: execution?.exitCode,
        signal: execution?.signal,
      })
      store.upsert({
        runId,
        status,
        exitCode: execution?.exitCode ?? null,
        signal: execution?.signal ?? null,
        ...(detail !== undefined ? { detail } : {}),
        stoppable: !isTerminalStatus(status),
        finishedAt: now(),
      })
    } catch (error) {
      logger?.warn?.('[terminal-panel] bash status sync failed:', error?.message ?? error)
    }
  }

  /**
   * c) tools/result：补终态与最终输出（无句柄时即为唯一输出来源）。
   * @param {any} exec tools/execute 的 exec（被冻结，只读）
   * @param {any} result ToolExecutionResult
   */
  function noteToolResult(exec, result) {
    if (exec === null || typeof exec !== 'object') return
    const callId = typeof exec.callId === 'string' ? exec.callId : undefined
    if (callId === undefined) return
    const call = calls.get(callId)
    if (call === undefined) return
    const runId = bashRunId(callId)
    if (store.get(runId) === undefined) return
    const state = stateOf(runId)
    const parsed = parseToolResultText(result)
    const text = parsed.text
    const marker = parseExitMarker(text)
    let status = mapToolResultStatus(result)
    let detail
    if (result?.isError === true) {
      detail = typeof result.error?.message === 'string' ? result.error.message : 'tool call failed'
    } else if (marker.signal !== undefined) {
      detail = `signal ${marker.signal}`
    } else if (marker.exitCode !== undefined && marker.exitCode !== 0) {
      detail = `exit code ${marker.exitCode}`
    } else if (state.execution === undefined) {
      detail = 'final-only'
    }
    if (state.execution !== undefined) {
      // tee 成功：过程状态由句柄决定，工具结果的 completed 不覆盖 killed 等。
      const record = store.get(runId)
      if (record !== undefined && isTerminalStatus(record.status)) status = record.status
    }

    if (state.execution === undefined && state.finalOutput !== true && text.length > 0) {
      // 没有句柄 → 用最终文本兜底（final-only）。
      const at = now()
      const prev = store.nextReadCursor(runId, 'stdout') ?? 0
      const tail = tailBytes(text, config.initialTailBytes)
      const read = {
        text: tail.text,
        nextOffset: prev + textBytes(tail.text),
        lossy: tail.droppedBytes > 0 || parsed.truncated,
      }
      const merged = mergeChannel(prev, read, at)
      const chunks = splitChunks(merged.chunks, 16384)
      const limited = limitDelta({ ...merged, chunks }, Math.max(1, config.maxFrameBytes))
      store.setOutput(runId, 'stdout', limited.delta)
      state.finalOutput = true
    }

    store.upsert({
      runId,
      ...(status !== undefined ? { status } : {}),
      ...(marker.exitCode !== undefined ? { exitCode: marker.exitCode } : {}),
      ...(marker.signal !== undefined ? { signal: marker.signal } : {}),
      ...(detail !== undefined ? { detail } : {}),
      ...(state.execution === undefined ? { finalOnly: true, outputMode: 'final-only' } : {}),
      stoppable: state.execution !== undefined ? !isTerminalStatus(store.get(runId)?.status) : false,
      ...(typeof result?.meta?.cwd === 'string' ? { cwd: result.meta.cwd } : {}),
      ...(status !== undefined ? { finishedAt: now() } : {}),
    })
  }

  /**
   * 读取一个 bash Run 的增量（只读旁路；绝不调用消费式 readOutput）。
   * @param {string} runId
   * @param {{stdout?: number, stderr?: number, total?: number}} budget
   * @returns {{stdout: boolean, stderr: boolean}}
   */
  function readRun(runId, budget = {}) {
    const state = states.get(runId)
    if (state === undefined || state.execution === undefined) return { stdout: false, stderr: false }
    const execution = state.execution
    const at = now()
    const total = Number.isFinite(budget.total) ? budget.total : config.maxFrameBytes
    const stdoutBudget = Math.max(1, Math.floor(total * 0.6))
    const stderrBudget = Math.max(1, total - stdoutBudget)
    const result = { stdout: false, stderr: false }

    const stdoutPrev = store.nextReadCursor(runId, 'stdout') ?? 0
    const stdoutRead = safeRead(execution.observed?.stdout, stdoutPrev)
    if (stdoutRead !== undefined) {
      const delta = buildStreamDelta(stdoutRead, stdoutPrev, at, config.initialTailBytes, stdoutBudget)
      if (delta.chunks.length > 0 || delta.lossy === true) {
        store.setOutput(runId, 'stdout', delta)
        result.stdout = true
      }
    }

    const stderrPrev = store.nextReadCursor(runId, 'stderr') ?? 0
    const stderrRead = safeRead(execution.observed?.stderr, stderrPrev)
    if (stderrRead !== undefined) {
      const delta = buildStreamDelta(stderrRead, stderrPrev, at, config.initialTailBytes, stderrBudget)
      if (delta.chunks.length > 0 || delta.lossy === true) {
        store.setOutput(runId, 'stderr', delta)
        result.stderr = true
      }
    }

    syncExecutionStatusIfChanged(runId, execution)
    return result
  }

  /** 状态有变化才写（避免每帧都产生 metaDirty）。 */
  function syncExecutionStatusIfChanged(runId, execution) {
    const record = store.get(runId)
    if (record === undefined) return
    const nextStatus = mapShellStatus(execution)
    const nextExit = execution?.exitCode ?? null
    const nextSignal = execution?.signal ?? null
    if (record.status === nextStatus && record.exitCode === nextExit && record.signal === nextSignal) return
    syncExecutionStatus(runId, execution)
  }

  /**
   * 安全读取一个 observed 通道。
   * @param {any} reader
   * @param {number} from
   * @returns {{text: string, nextOffset: number, lossy: boolean}|undefined}
   */
  function safeRead(reader, from) {
    if (reader === null || typeof reader !== 'object' || typeof reader.readFrom !== 'function') return undefined
    try {
      const read = reader.readFrom(from)
      if (read === null || typeof read !== 'object') return undefined
      return {
        text: typeof read.text === 'string' ? read.text : '',
        nextOffset: Number.isFinite(read.nextOffset) ? read.nextOffset : from,
        lossy: read.lossy === true,
      }
    } catch (error) {
      logger?.warn?.('[terminal-panel] observed read failed:', error?.message ?? error)
      return undefined
    }
  }

  /**
   * 组装一条通道增量（首见时只给尾 initialTailBytes 字节）。
   * @param {{text: string, nextOffset: number, lossy: boolean}} read
   * @param {number} prev
   * @param {number} at
   * @param {number} initialTailBytes
   * @param {number} budget
   */
  function buildStreamDelta(read, prev, at, initialTailBytes, budget) {
    let text = read.text
    let lossy = read.lossy
    let gapBefore = read.lossy
    let byteStart = prev
    if (prev === 0 && initialTailBytes > 0) {
      const tail = tailBytes(text, initialTailBytes)
      if (tail.droppedBytes > 0) {
        text = tail.text
        lossy = true
        gapBefore = true
        byteStart = Math.max(0, read.nextOffset - textBytes(text))
      }
    }
    const raw = {
      chunks: text.length > 0 ? [{ at, text, byteStart, byteEnd: read.nextOffset }] : [],
      nextCursor: read.nextOffset,
      lossy,
      gapBefore,
      truncated: false,
    }
    const split = splitChunks(raw.chunks, 16384)
    return limitDelta({ ...raw, chunks: split }, budget).delta
  }

  /**
   * 停止一个 bash Run。
   * @param {string} runId
   * @returns {'requested'|'already-finished'|'unsupported'}
   */
  function killRun(runId) {
    const state = states.get(runId)
    const execution = state?.execution
    if (execution === undefined) {
      const record = store.get(runId)
      if (record === undefined) return 'unsupported'
      // 幽灵 Run（无句柄）无法停止：交给工具自己的超时/取消；契约 run-not-stoppable。
      return isTerminalStatus(record.status) ? 'already-finished' : 'unsupported'
    }
    try {
      const stopped = execution.kill()
      return stopped === false ? 'already-finished' : 'requested'
    } catch (error) {
      logger?.warn?.('[terminal-panel] bash kill failed:', error?.message ?? error)
      return 'unsupported'
    }
  }

  /** 清理关联表（句柄由 store/包装还原函数负责）。 */
  function dispose() {
    calls.clear()
    awaitingHandle.clear()
    states.clear()
  }

  return {
    noteToolCall,
    attachExecution,
    noteToolResult,
    readRun,
    killRun,
    dispose,
    /** 供测试/诊断：当前是否有等待认领的调用。 */
    pendingCalls() {
      return awaitingHandle.size
    },
  }
}
