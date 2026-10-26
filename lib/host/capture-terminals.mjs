/**
 * capture-terminals.mjs — 持久终端采集（契约 v7 §5.2 / §7.2：三级发现 + 输入 + notice + 事件输出）。
 *
 * 真机缺陷①根因（scout T30 取证）：`ctx.terminals.*` 的 owner 是 **Agent 对象身份**，而
 * GUI 打开历史会话**不会加载 Agent** → `agents.get(sessionId)` 常为 undefined。旧实现把它
 * 当作「会话结束」直接删 Run → 面板永远「终端 0、无提示」。v7 起：
 *
 *   a. 主：`ctx.terminals.list(agent)`（有 live Agent；可读实时输出）
 *   b. 侧栏终端（**默认关闭**，config.sidebarTerminals）：`ctx.terminalController.list(sessionId)`
 *      —— scout §2.3 FACT：这是**另一套**「浏览器/侧栏终端」注册表，**不会**返回
 *      `terminal_open` 的 pty-4/pty-5，对缺陷①不是修复依据；仅作为可选展示（source 'sidebar'）。
 *   c. 最后（**真正的兜底**）：`tools/execute` / `tools/result` 旁路事件 —— `terminal_open`
 *      登记元信息、`terminal_send` 采集 inputs、`terminal_send.viewport` / `terminal_read.text`
 *      作为事件片段输出、`terminal_close`/`terminal_kill` 标终态。
 *
 * 其他硬约束：
 *  - agent 缺失不得删 Run（只有 close/会话结束/保留窗口过期才 removed）；
 *  - 历史 pty 不可回读（owner 卸载即清理注册表，scout §3.1）→ 只对部署后新发生的事件生效；
 *  - 绝不 startSend/signal；kill 仅用于用户点「停止」（且必须 live Agent）。
 */

import { limitDelta } from './cursors.mjs'
import { isTerminalStatus, mapTerminalStatus, terminalDetail } from './status.mjs'
import {
  applyTerminalRead,
  composeTextAppend,
  createTerminalWindow,
  planTerminalRead,
} from './terminal-window.mjs'
import { textBytes } from './store.mjs'
import {
  appendTerminalInput,
  normalizeControllerTerminal,
  noticeFor,
  parseTerminalCloseResult,
  parseTerminalListResult,
  parseTerminalOpenResult,
  parseTerminalSessionStatus,
  terminalToolCall,
} from './terminal-events.mjs'

/** terminal Run 的 runId（kind:sourceId，sourceId = TerminalSessionId）。 */
export function terminalRunId(terminalId) {
  return `terminal:${terminalId}`
}

/** 发现来源的优先级（数值越大越权威）。 */
const SOURCE_RANK = Object.freeze({ none: 0, events: 1, sidebar: 2, terminals: 3 })

/**
 * 防御式调用 `terminalController.list(sessionId)`：
 * 结果可能是数组、Promise、或 `{ ok, value }` 信封；任何异常都只降级不抛。
 * @param {any} controller
 * @param {string} sessionId
 * @param {string[]} reasons 收集降级原因
 * @returns {Promise<object[]|undefined>}
 */
async function safeControllerList(controller, sessionId, reasons) {
  if (controller === null || typeof controller !== 'object' || typeof controller.list !== 'function') {
    return undefined
  }
  try {
    const raw = controller.list(sessionId)
    const resolved = raw !== null && typeof raw === 'object' && typeof raw.then === 'function' ? await raw : raw
    if (Array.isArray(resolved)) return resolved
    if (resolved !== null && typeof resolved === 'object') {
      for (const key of ['value', 'sessions', 'terminals', 'items']) {
        if (Array.isArray(resolved[key])) return resolved[key]
      }
    }
    reasons.push('terminalController.list returned an unexpected shape')
    return undefined
  } catch (error) {
    reasons.push(`terminalController.list failed: ${error?.message ?? error}`)
    return undefined
  }
}

/**
 * 三级发现（契约 v7 §7.2）。只登记「有哪些终端」，不读输出。
 * @param {{
 *   terminals?: any, agents?: any, controller?: any, sidebarTerminals?: boolean,
 *   ownerFor?: (sessionId: string) => object|undefined,
 *   scopes?: object[], store: any, logger?: any,
 * }} options
 * @returns {Promise<{
 *   candidates: object[], readAgents: Map<string, object>,
 *   source: 'terminals'|'sidebar'|'events'|'none', reason?: string, degradedSessions: string[],
 *   sidebarEnabled: boolean,
 * }>}
 */
export async function discoverTerminalCandidates(options) {
  const terminals = options.terminals
  const agents = options.agents
  const controller = options.controller
  const sidebarEnabled = options.sidebarTerminals === true
  const ownerFor = typeof options.ownerFor === 'function' ? options.ownerFor : undefined
  const store = options.store
  const scopes = Array.isArray(options.scopes) ? options.scopes : []
  const logger = options.logger

  /** @type {Map<string, object>} terminalId → candidate */
  const candidates = new Map()
  /** @type {Map<string, object>} terminalId → live Agent（只有主链路才有） */
  const readAgents = new Map()
  const reasons = []
  const degradedSessions = []
  let bestSource = 'none'
  const noteSource = (source) => {
    if (SOURCE_RANK[source] > SOURCE_RANK[bestSource]) bestSource = source
  }
  const controllerAvailable = sidebarEnabled && controller !== null && typeof controller === 'object'
    && typeof controller.list === 'function'
  if (sidebarEnabled && !controllerAvailable) reasons.push('terminalController unavailable')

  for (const scope of scopes) {
    const sessionId = typeof scope?.sessionId === 'string' ? scope.sessionId : undefined
    if (sessionId === undefined) continue

    // owner 解析：优先 live registry，其次 tools/execute 缓存的原始 Agent 对象
    // （terminals.* 按对象身份比较；缓存的必须是原对象，不能 clone —— scout §3.2）。
    let agent
    try {
      if (typeof agents?.get === 'function') agent = agents.get(sessionId)
    } catch {
      agent = undefined
    }
    if (agent === undefined && ownerFor !== undefined) {
      try {
        agent = ownerFor(sessionId)
      } catch {
        agent = undefined
      }
    }

    // a) 主链路：有 live Agent 才可用
    let primaryOk = false
    if (agent !== undefined && terminals !== undefined && typeof terminals.list === 'function') {
      try {
        const snapshots = terminals.list(agent)
        if (Array.isArray(snapshots)) {
          primaryOk = true
          if (snapshots.length > 0) noteSource('terminals')
          for (const snapshot of snapshots) {
            if (snapshot === null || typeof snapshot !== 'object') continue
            const terminalId = typeof snapshot.sessionId === 'string' ? snapshot.sessionId : undefined
            if (terminalId === undefined) continue
            candidates.set(terminalId, {
              terminalId,
              sessionId,
              ...(typeof snapshot.name === 'string' ? { name: snapshot.name } : {}),
              ...(typeof snapshot.type === 'string' ? { type: snapshot.type } : {}),
              ...(typeof snapshot.pid === 'number' ? { pid: snapshot.pid } : {}),
              ...(snapshot.status !== undefined ? { status: snapshot.status } : {}),
              source: 'terminals',
            })
            readAgents.set(terminalId, agent)
          }
        }
      } catch (error) {
        reasons.push(`terminals.list failed: ${error?.message ?? error}`)
        degradedSessions.push(sessionId)
        logger?.warn?.(`[terminal-panel] terminals.list failed for ${sessionId}:`, error?.message ?? error)
      }
    } else if (agent === undefined && terminals !== undefined) {
      reasons.push('session has no live agent')
    }

    // b) 侧栏终端（默认关闭）：与 agent PTY 是两套注册表，只作为可选展示。
    if (!primaryOk && controllerAvailable) {
      const listed = await safeControllerList(controller, sessionId, reasons)
      if (listed !== undefined) {
        noteSource('sidebar')
        for (const raw of listed) {
          const normalized = normalizeControllerTerminal(raw)
          if (normalized === null) continue
          // 注意：WebTerminalInfo.id 是侧栏终端 id；归属会话只能是查询用的 sessionId。
          const owner = typeof raw?.ownerSessionId === 'string'
            ? raw.ownerSessionId
            : typeof raw?.owner === 'string' ? raw.owner : sessionId
          candidates.set(normalized.terminalId, { ...normalized, sessionId: owner, source: 'sidebar' })
        }
      }
    }

    // c) 最后：事件层（tools/execute 旁路已登记的 Run）——无论主链路是否成功都合并。
    for (const record of store.all()) {
      if (record.kind !== 'terminal' || record.ownerSessionId !== sessionId) continue
      const terminalId = typeof record.handle?.terminalId === 'string'
        ? record.handle.terminalId
        : record.runId.startsWith('terminal:') ? record.runId.slice('terminal:'.length) : undefined
      if (terminalId === undefined || candidates.has(terminalId)) continue
      candidates.set(terminalId, {
        terminalId,
        sessionId,
        ...(typeof record.command === 'string' ? { name: record.command } : {}),
        ...(typeof record.handle?.terminalType === 'string' ? { type: record.handle.terminalType } : {}),
        ...(typeof record.handle?.pid === 'number' ? { pid: record.handle.pid } : {}),
        source: 'events',
      })
      noteSource('events')
    }
  }

  const list = [...candidates.values()]
  const source = list.length > 0
    ? list.reduce((best, candidate) => (SOURCE_RANK[candidate.source] > SOURCE_RANK[best] ? candidate.source : best), 'none')
    : 'none'
  let reason
  if (list.length === 0) {
    if (terminals === undefined && !controllerAvailable) reason = 'terminals unavailable and no events yet'
    else if (reasons.length > 0) reason = reasons[0]
    else reason = 'no terminal sessions discovered'
  } else if (source !== 'terminals') {
    reason = reasons[0] ?? (source === 'events' ? 'no live agent; discovered from tool events' : 'fallback discovery')
  }
  return { candidates: list, readAgents, source, reason, degradedSessions, sidebarEnabled }
}

/**
 * 把发现到的终端登记/更新进 store，并在预算内读取输出（仅主链路有 Agent 时）。
 * @param {{
 *   candidates?: object[], readAgents?: Map<string, object>, terminals?: any, store: any, config: any,
 *   now?: () => number, budgets?: Record<string, number>, logger?: any,
 *   visibleSessionIds?: Set<string>, allowSessionCleanup?: boolean, servicesAvailable?: boolean,
 * }} options
 * @returns {{available: boolean, reason?: string, readFailures: number, candidates: number}}
 */
export function collectTerminalRuns(options) {
  const candidates = Array.isArray(options.candidates) ? options.candidates : []
  const readAgents = options.readAgents instanceof Map ? options.readAgents : new Map()
  const terminals = options.terminals
  const store = options.store
  const config = options.config
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const budgets = options.budgets ?? {}
  const logger = options.logger
  const visibleSessionIds = options.visibleSessionIds instanceof Set ? options.visibleSessionIds : undefined
  const allowSessionCleanup = options.allowSessionCleanup === true
  let readFailures = 0

  for (const candidate of candidates) {
    const terminalId = typeof candidate?.terminalId === 'string' ? candidate.terminalId : undefined
    if (terminalId === undefined) continue
    const runId = terminalRunId(terminalId)
    const record = store.get(runId)
    const ownerSessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId : record?.ownerSessionId
    if (typeof ownerSessionId !== 'string' || ownerSessionId.length === 0) continue

    const agent = readAgents.get(terminalId)
    const canRead = agent !== undefined && terminals !== undefined && typeof terminals.read === 'function'
    // 状态：WebTerminalInfo 用 state('running'|'exited'|'failed') + exitCode/error；
    // ctx.terminals 快照用 status.kind('running'|'exited')。
    let status
    let detail
    if (candidate.state === 'failed') {
      status = 'failed'
      detail = candidate.error ?? record?.detail
    } else if (candidate.state === 'exited') {
      status = (candidate.exitCode ?? 0) === 0 && candidate.error === undefined ? 'completed' : 'failed'
      detail = candidate.error ?? record?.detail
    } else if (candidate.status !== undefined) {
      status = mapTerminalStatus(candidate.status)
      detail = terminalDetail(candidate.status) ?? record?.detail
    } else {
      status = record?.status ?? 'running'
      detail = record?.detail
    }
    const terminalStatus = isTerminalStatus(status)

    /** 读不到输出时明确降级，而不是假装有输出（v7 §7.1）。 */
    const notice = canRead ? null : noticeFor('terminal-no-agent')
    store.upsert({
      runId,
      kind: 'terminal',
      ownerSessionId,
      title: '终端',
      startedAt: Number.isFinite(record?.startedAt) ? record.startedAt : now(),
      status,
      outputMode: canRead ? 'live' : 'meta-only',
      notice,
      ...(candidate.name !== undefined ? { command: candidate.name } : {}),
      ...(candidate.cwd !== undefined ? { cwd: candidate.cwd } : {}),
      ...(detail !== undefined ? { detail } : {}),
      exitCode: candidate.exitCode !== undefined
        ? Numbersafe(candidate.exitCode)
        : candidate.status !== undefined ? Numbersafe(candidate.status?.exitCode) : record?.exitCode ?? null,
      signal: candidate.status !== undefined
        ? (typeof candidate.status?.signal === 'string' ? candidate.status.signal : null)
        : record?.signal ?? null,
      handle: {
        terminalId,
        ...(candidate.type !== undefined ? { terminalType: candidate.type } : {}),
        ...(candidate.pid !== undefined ? { pid: candidate.pid } : {}),
      },
      stoppable: !terminalStatus && canRead,
      ...(terminalStatus ? { finishedAt: Number.isFinite(record?.finishedAt) ? record.finishedAt : now() } : {}),
    })

    // inputs 种子：初始 name（只写一次；后续 terminal_send 由事件采集追加）
    const live = store.liveOf(runId) ?? {}
    if (live.inputsSeeded !== true) {
      if (typeof candidate.name === 'string' && candidate.name.length > 0) {
        const seeded = appendTerminalInput(store.get(runId)?.inputs, candidate.name)
        store.upsert({ runId, inputs: seeded.inputs })
      }
      store.setLive(runId, { ...live, inputsSeeded: true })
    }

    if (!canRead) continue
    const budget = Number.isFinite(budgets[runId]) ? budgets[runId] : 0
    if (budget <= 0) continue
    try {
      readTerminalPage({ terminals, agent, terminalId, runId, store, config, budget, now })
    } catch (error) {
      readFailures += 1
      logger?.warn?.(`[terminal-panel] terminals.read failed for ${terminalId}:`, error?.message ?? error)
      store.upsert({
        runId,
        outputMode: 'meta-only',
        notice: noticeFor('terminal-read-failed', `${error?.message ?? error}`),
      })
    }
  }

  // 会话结束清理：只在树可信时移除（agent 缺失不再触发删除，v7 §7.3）。
  if (allowSessionCleanup && visibleSessionIds !== undefined) {
    for (const record of store.all()) {
      if (record.kind !== 'terminal') continue
      if (!visibleSessionIds.has(record.ownerSessionId)) store.remove(record.runId)
    }
  }

  const readable = readAgents.size
  const servicesAvailable = options.servicesAvailable === true || terminals !== undefined
  const available = candidates.length > 0 || servicesAvailable
  let reason
  if (!available) reason = 'terminals unavailable'
  else if (candidates.length > 0 && readable === 0) reason = 'no live agent; meta-only'
  else if (readFailures > 0) reason = `terminal read failed for ${readFailures} session(s)`
  return { available, reason, readFailures, candidates: candidates.length }
}

/**
 * tools/execute / tools/result 旁路：事件发现 + 输入 + 事件片段输出 + 终态。
 *
 * 优先使用 `result.value`（结构化，scout §5.2 FACT），渲染文本解析只做兜底。
 * 事件片段输出（`terminal_send.viewport` / `terminal_read.text`）让 meta-only 列也有真实内容；
 * 用「行坐标合成游标 + 尾重叠去重」，避免与真实 read 路径的文本重复。
 *
 * @param {{store: any, now?: () => number, logger?: any}} options
 */
export function createTerminalEventCapture(options) {
  const store = options.store
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger
  /** callId → 等待结果的 terminal_open 调用 */
  const pendingOpen = new Map()
  const MAX_PENDING = 64

  /**
   * 把结构化 value 或渲染文本归一成对象（结构化优先）。
   * @param {unknown} result
   * @returns {object|undefined}
   */
  function resultValue(result) {
    if (result === null || typeof result !== 'object') return undefined
    if (result.isError === true) return undefined
    const value = result.value
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  }

  /**
   * 结构化 value 可能是数组（terminal_list）。
   * @param {unknown} result
   * @returns {object[]|undefined}
   */
  function resultValueArray(result) {
    if (result === null || typeof result !== 'object' || result.isError === true) return undefined
    return Array.isArray(result.value) ? result.value : undefined
  }

  /**
   * 确保事件发现到的终端有一条 meta-only Run。
   * @param {{terminalId: string, sessionId: string, name?: string, type?: string, pid?: number, status?: object}} input
   * @returns {object|undefined}
   */
  function ensureRun(input) {
    const terminalId = input.terminalId
    if (typeof terminalId !== 'string' || terminalId.length === 0) return undefined
    if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) return undefined
    const runId = terminalRunId(terminalId)
    let record = store.get(runId)
    if (record === undefined) {
      store.upsert({
        runId,
        kind: 'terminal',
        ownerSessionId: input.sessionId,
        title: '终端',
        startedAt: now(),
        status: 'running',
        outputMode: 'meta-only',
        notice: noticeFor('terminal-no-agent'),
        ...(typeof input.name === 'string' && input.name.length > 0 ? { command: input.name } : {}),
        handle: {
          terminalId,
          ...(typeof input.type === 'string' ? { terminalType: input.type } : {}),
          ...(typeof input.pid === 'number' ? { pid: input.pid } : {}),
        },
        stoppable: false,
      })
      record = store.get(runId)
      const live = store.liveOf(runId) ?? {}
      if (typeof input.name === 'string' && input.name.length > 0) {
        const seeded = appendTerminalInput(record?.inputs, input.name)
        store.upsert({ runId, inputs: seeded.inputs })
      }
      store.setLive(runId, { ...live, inputsSeeded: true, eventSource: true })
    }
    return record
  }

  /**
   * 追加一条 terminal_send 输入（同一 callId 只记一次）。
   * @param {string} runId
   * @param {string} text
   * @param {string} callId
   */
  function appendInput(runId, text, callId) {
    const record = store.get(runId)
    if (record === undefined) return
    const live = store.liveOf(runId) ?? {}
    const seen = live.seenInputCalls instanceof Set ? live.seenInputCalls : new Set()
    if (seen.has(callId)) return
    seen.add(callId)
    const next = appendTerminalInput(record.inputs, text)
    store.upsert({ runId, inputs: next.inputs })
    store.setLive(runId, { ...live, inputsSeeded: true, eventSource: true, seenInputCalls: seen })
  }

  /**
   * 追加一段「事件片段输出」到 terminal 通道。
   *
   * 行边界（HIGH 缺陷修复）：与 `terminal-window.mjs::composeTextAppend` 共用同一套规则 —
   * 上一段未以换行结尾且新段从新行开始时补前导 `\n`，续写同一行时不补；跨段尾行重叠仍去重。
   * 坐标：`totalLines = 全文换行数 + 1`，`lineBegin/lineEnd/nextCursor` 与实际文本行数一致。
   * @param {string} runId
   * @param {unknown} text
   * @param {{truncated?: boolean, at?: number}} [meta]
   */
  function appendEventOutput(runId, text, meta = {}) {
    if (typeof text !== 'string' || text.length === 0) return
    // tier1 真终端输出已接管时不再追加事件片段，避免两套来源相互交错（混用边界由 readTerminalPage 处理）。
    const record = store.get(runId)
    if (record?.outputMode === 'live') return
    const live = store.liveOf(runId) ?? {}
    const previousLines = Number.isFinite(live.synthCursor) ? live.synthCursor : 0
    const previousNewlines = Number.isFinite(live.synthNewlines)
      ? live.synthNewlines
      : Math.max(0, previousLines - 1)
    const composed = composeTextAppend(
      {
        hasPrevious: previousLines > 0,
        tail: typeof live.synthTail === 'string' ? live.synthTail : '',
        endsWithNewline: live.synthEndsWithNewline === true,
      },
      text,
    )
    if (composed.text.length === 0) return
    const addedNewlines = countNewlines(composed.text)
    const nextNewlines = previousNewlines + addedNewlines
    const nextLines = nextNewlines + 1
    // 坐标一致性：totalLines = nextCursor = 全文行数；lineEnd-lineBegin = 本段文本行数。
    // （首行可能续写/占据上一行，因此起点取 max(0, previousLines - 1)。）
    const lineBegin = Math.max(0, previousLines - 1)
    const delta = {
      text: composed.text,
      chunks: [{ at: Number.isFinite(meta.at) ? meta.at : now(), text: composed.text }],
      totalLines: nextLines,
      lineBegin,
      lineEnd: nextLines,
      absBegin: lineBegin,
      absEnd: nextLines,
      nextCursor: nextLines,
      truncated: meta.truncated === true,
      lossy: false,
    }
    store.setOutput(runId, 'terminal', delta)
    store.setLive(runId, {
      ...(store.liveOf(runId) ?? live),
      synthCursor: nextLines,
      synthNewlines: nextNewlines,
      synthTail: contentTail(text, 32),
      synthEndsWithNewline: text.endsWith('\n'),
      eventSource: true,
    })
  }

  /**
   * @param {any} exec tools/execute 的 exec
   */
  function noteToolCall(exec) {
    if (exec === null || typeof exec !== 'object') return
    const event = terminalToolCall(exec.name, exec.arguments)
    if (event === null) return
    const sessionId = exec.agent?.id
    if (typeof sessionId !== 'string' || sessionId.length === 0) return // 不猜归属
    const callId = typeof exec.callId === 'string' ? exec.callId : `${exec.name}:${now()}`
    if (event.kind === 'open') {
      pendingOpen.set(callId, {
        sessionId,
        ...(event.type !== undefined ? { type: event.type } : {}),
        ...(event.name !== undefined ? { name: event.name } : {}),
      })
      if (pendingOpen.size > MAX_PENDING) {
        const oldest = pendingOpen.keys().next().value
        if (oldest !== undefined) pendingOpen.delete(oldest)
      }
      return
    }
    if (event.kind === 'list') return
    if (typeof event.terminalId !== 'string') return
    ensureRun({ terminalId: event.terminalId, sessionId })
    if (event.kind === 'send' && typeof event.text === 'string') {
      appendInput(terminalRunId(event.terminalId), event.text, callId)
    }
  }

  /**
   * @param {any} exec tools/result 的 exec
   * @param {any} result ToolExecutionResult
   */
  function noteToolResult(exec, result) {
    if (exec === null || typeof exec !== 'object') return
    const name = exec.name
    if (typeof name !== 'string' || !name.startsWith('terminal_')) return
    const value = resultValue(result)
    const valueArray = resultValueArray(result)
    const text = contentText(result)
    const resultError = result?.isError === true
      ? (typeof result?.error?.message === 'string' ? result.error.message : 'tool call failed')
      : undefined
    const sessionId = exec.agent?.id
    const callId = typeof exec.callId === 'string' ? exec.callId : undefined

    if (name === 'terminal_open') {
      const parsed = parseTerminalOpenResult(text)
      const pending = callId !== undefined ? pendingOpen.get(callId) : undefined
      if (callId !== undefined) pendingOpen.delete(callId)
      const terminalId = typeof value?.sessionId === 'string'
        ? value.sessionId
        : parsed?.terminalId
      if (terminalId === undefined) return
      const name0 = typeof value?.name === 'string' ? value.name : parsed?.name ?? pending?.name
      const type0 = typeof value?.type === 'string' ? value.type : parsed?.type ?? pending?.type
      ensureRun({
        terminalId,
        sessionId: typeof value?.ownerSessionId === 'string'
          ? value.ownerSessionId
          : typeof sessionId === 'string' ? sessionId : pending?.sessionId,
        ...(typeof name0 === 'string' ? { name: name0 } : {}),
        ...(typeof type0 === 'string' ? { type: type0 } : {}),
        ...(typeof value?.pid === 'number' ? { pid: value.pid } : {}),
      })
      // 启动输出（motd）直接作为首段事件输出（真实内容，减少空列）。
      const motd = typeof value?.motd === 'string' ? value.motd : undefined
      if (motd !== undefined && motd.length > 0) appendEventOutput(terminalRunId(terminalId), motd)
      return
    }

    if (name === 'terminal_list') {
      const owner = typeof sessionId === 'string' ? sessionId : undefined
      if (owner === undefined) return
      const rows = Array.isArray(valueArray) ? valueArray : parseTerminalListResult(text)
      for (const item of rows) {
        const terminalId = typeof item?.sessionId === 'string'
          ? item.sessionId
          : typeof item?.terminalId === 'string' ? item.terminalId : undefined
        if (terminalId === undefined) continue
        ensureRun({
          terminalId,
          sessionId: owner,
          ...(typeof item.name === 'string' ? { name: item.name } : {}),
          ...(typeof item.type === 'string' ? { type: item.type } : {}),
          ...(typeof item.pid === 'number' ? { pid: item.pid } : {}),
        })
      }
      return
    }

    const event = terminalToolCall(name, exec.arguments)
    const terminalId = typeof event?.terminalId === 'string'
      ? event.terminalId
      : typeof value?.sessionId === 'string' ? value.sessionId : undefined
    if (terminalId === undefined) return
    const runId = terminalRunId(terminalId)
    if (store.get(runId) === undefined) {
      // 事件层没先登记过：只有拿到归属会话才建 Run（不猜归属）。
      if (typeof sessionId !== 'string' || sessionId.length === 0) return
      ensureRun({ terminalId, sessionId })
      if (store.get(runId) === undefined) return
    }

    if (name === 'terminal_send') {
      const status = typeof value?.sessionStatus === 'object' && value.sessionStatus !== null
        ? value.sessionStatus
        : parseTerminalSessionStatus(text)
      const viewport = typeof value?.viewport === 'string' ? value.viewport : undefined
      if (typeof viewport === 'string' && viewport.length > 0) {
        appendEventOutput(runId, viewport, { truncated: value?.truncated === true })
      }
      if (status !== null && status !== undefined) {
        const mapped = mapTerminalStatus(status)
        store.upsert({
          runId,
          status: mapped,
          exitCode: status.kind === 'exited' ? Numbersafe(status.exitCode) : undefined,
          signal: status.kind === 'exited' && typeof status.signal === 'string' ? status.signal : undefined,
          ...(isTerminalStatus(mapped) ? { finishedAt: now(), stoppable: false } : {}),
          ...(resultError !== undefined ? { detail: resultError } : {}),
        })
      } else if (resultError !== undefined) {
        store.upsert({ runId, detail: resultError })
      }
      return
    }

    if (name === 'terminal_read') {
      const pageText = typeof value?.text === 'string' ? value.text : text
      if (pageText.length > 0) appendEventOutput(runId, pageText, { truncated: value?.truncated === true })
      return
    }

    if (name === 'terminal_close' || name === 'terminal_kill') {
      const parsed = parseTerminalCloseResult(text)
      const closeId = typeof value?.sessionId === 'string' ? value.sessionId : parsed?.terminalId
      if (closeId !== undefined && closeId !== terminalId) {
        logger?.warn?.(`[terminal-panel] terminal close id mismatch: ${closeId} vs ${terminalId}`)
      }
      const outcome = typeof value?.outcome === 'string' ? value.outcome : parsed?.outcome
      store.upsert({
        runId,
        status: resultError !== undefined ? 'failed' : 'completed',
        stoppable: false,
        finishedAt: now(),
        ...(resultError !== undefined
          ? { detail: resultError }
          : { detail: outcome === 'already-closing' ? 'already closing' : 'closed' }),
      })
    }
  }

  function dispose() {
    pendingOpen.clear()
  }

  return { noteToolCall, noteToolResult, dispose }
}

/**
 * 统计文本里的换行数（用于行坐标：totalLines = 换行数 + 1）。
 * @param {string} text
 * @returns {number}
 */
function countNewlines(text) {
  if (typeof text !== 'string' || text.length === 0) return 0
  let count = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) count += 1
  }
  return count
}

/**
 * 取文本最后 n 行（忽略结尾空行，供尾重叠去重用）。
 * @param {string} text
 * @param {number} [lines]
 * @returns {string}
 */
function contentTail(text, lines = 32) {
  if (typeof text !== 'string' || text.length === 0) return ''
  const parts = text.split('\n')
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop()
  const count = Number.isSafeInteger(lines) && lines > 0 ? lines : 32
  return parts.slice(Math.max(0, parts.length - count)).join('\n')
}

/**
 * 从 ToolExecutionResult 里取文本块（只读，不改 result）。
 * @param {unknown} result
 * @returns {string}
 */
function contentText(result) {
  if (result === null || typeof result !== 'object') return ''
  const content = Array.isArray(result.content) ? result.content : []
  return content
    .filter((item) => item !== null && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
}

/**
 * 数字或 null（terminals 的 exitCode 可能是 null）。
 * @param {unknown} value
 * @returns {number|null}
 */
function Numbersafe(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/**
 * 读一页并写入增量。
 * @param {object} input
 */
function readTerminalPage(input) {
  const { terminals, agent, terminalId, runId, store, config, budget, now } = input
  const window = store.windowOf(runId) ?? createTerminalWindow()
  // 先探 1 行拿 totalLines（read 请求里的 count 需要它来决定取多少）。
  const probe = terminals.read(agent, terminalId, { offset: 0, count: 1 })
  const totalLines = Number.isFinite(probe?.totalLines) ? probe.totalLines : window.totalLines ?? 0
  const plan = planTerminalRead(window, totalLines, config.terminalPageLines)
  const page = plan.mode === 'probe'
    ? probe
    : terminals.read(agent, terminalId, { offset: plan.offset, count: plan.count })
  const { delta, window: nextWindow } = applyTerminalRead(window, page)
  store.setWindow(runId, nextWindow)
  const live = store.liveOf(runId)

  // 字节预算：终端按行交付，超预算时只截断本页文本（游标仍按行推进，宁可少给不重复给）。
  const bytes = textBytes(delta.text)
  let output = delta
  if (bytes > budget) {
    const limited = limitDelta({ chunks: [{ at: now(), text: delta.text }], nextCursor: delta.nextCursor }, budget)
    const keptText = limited.delta.chunks.map((chunk) => chunk.text).join('')
    output = { ...delta, text: keptText, truncated: true }
  }
  const mixedWithEvents = live !== undefined
    && live.eventSource === true
    && live.tier1Started !== true
    && Number.isFinite(live.synthCursor)
    && live.synthCursor > 0
    && live.synthEndsWithNewline === false
  if (output.text.length > 0 && mixedWithEvents) {
    // tier3 片段与 tier1 真终端输出混用同一 Run：片段未以换行结尾时补边界，避免两段粘连。
    output = { ...output, text: `\n${output.text}` }
  }
  if (mixedWithEvents) store.setLive(runId, { ...(store.liveOf(runId) ?? {}), tier1Started: true })
  if (output.text.length > 0 || output.lossy === true || output.truncated === true) {
    store.setOutput(runId, 'terminal', output)
  }
}

/**
 * 停止一个 terminal 会话（唯一的写操作；只由用户点「停止」触发）。
 * 无 live Agent 时 terminals.kill 无法执行 → unsupported（面板提示 run-not-stoppable）。
 * @param {{terminals: any, run: object, agent: any, logger?: any}} options
 * @returns {Promise<'requested'|'already-finished'|'unsupported'>}
 */
export async function killTerminalRun(options) {
  const { terminals, run, agent, logger } = options
  const terminalId = run?.handle?.terminalId
  if (typeof terminalId !== 'string' || agent === undefined) return 'unsupported'
  try {
    const closed = await terminals.kill(agent, terminalId, 'cancelled by the user')
    return closed === false ? 'already-finished' : 'requested'
  } catch (error) {
    logger?.warn?.(`[terminal-panel] terminals.kill failed for ${terminalId}:`, error?.message ?? error)
    return 'unsupported'
  }
}
