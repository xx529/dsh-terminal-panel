/**
 * capture-terminals.mjs — 持久终端采集（`ctx.terminals`，只读）。
 *
 * 契约 v2 §5.2 / §3.3：
 *  - 每个可见会话先 `ctx.agents.get(sessionId)` 换 **live Agent**（`terminals.*` 的 owner
 *    是 Agent 对象，且服务按对象身份比较）；拿不到 → 该会话终端不可见，**不报错**；
 *  - `terminals.list(agent)` 取快照；`terminals.read(agent, id, {offset,count})` 只读；
 *  - offset 是「距最新行数」（见 terminal-window.mjs）；增量由 `computeTerminalDelta` 算；
 *  - `truncated` 只表示 scrollback 被裁剪/单页字节截断，**不能**据此循环翻页；
 *  - 绝不调用 `startSend` / `signal`；kill 仅用于用户点「停止」。
 */

import { limitDelta } from './cursors.mjs'
import { isTerminalStatus, mapTerminalStatus, terminalDetail } from './status.mjs'
import {
  applyTerminalRead,
  createTerminalWindow,
  planTerminalRead,
} from './terminal-window.mjs'
import { textBytes } from './store.mjs'

/** terminal Run 的 runId（kind:sourceId，sourceId = TerminalSessionId）。 */
export function terminalRunId(terminalId) {
  return `terminal:${terminalId}`
}

/**
 * 采集所有可见会话的持久终端（元信息 + 行增量）。
 * @param {{
 *   terminals: any, agents: any, scopes: object[], store: any, config: any,
 *   now?: () => number, budgets?: Record<string, number>, logger?: any,
 * }} options
 * @returns {{available: boolean, reason?: string, degradedSessions: string[]}}
 */
export function collectTerminalRuns(options) {
  const terminals = options.terminals
  const agents = options.agents
  const store = options.store
  const config = options.config
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const budgets = options.budgets ?? {}
  const scopes = Array.isArray(options.scopes) ? options.scopes : []
  const logger = options.logger
  const degradedSessions = []
  let calls = 0
  let failures = 0
  let noAgent = 0

  for (const scope of scopes) {
    const sessionId = typeof scope?.sessionId === 'string' ? scope.sessionId : undefined
    if (sessionId === undefined) continue
    let agent
    try {
      agent = typeof agents?.get === 'function' ? agents.get(sessionId) : undefined
    } catch {
      agent = undefined
    }
    if (agent === undefined) {
      // 该会话没有 live Agent（已结束/不可见）→ 降级，不报错（scout §11.6）。
      // 该会话名下的 terminal Run 视为会话结束 → 移出注册表（契约 §4.2 语义 5：removed）。
      noAgent += 1
      degradedSessions.push(sessionId)
      for (const record of store.all()) {
        if (record.kind === 'terminal' && record.ownerSessionId === sessionId) store.remove(record.runId)
      }
      continue
    }
    let snapshots
    calls += 1
    try {
      snapshots = terminals.list(agent)
    } catch (error) {
      failures += 1
      degradedSessions.push(sessionId)
      logger?.warn?.(`[terminal-panel] terminals.list failed for ${sessionId}:`, error?.message ?? error)
      continue
    }
    if (!Array.isArray(snapshots)) continue
    for (const snapshot of snapshots) {
      if (snapshot === null || typeof snapshot !== 'object') continue
      const terminalId = typeof snapshot.sessionId === 'string' ? snapshot.sessionId : undefined
      if (terminalId === undefined) continue
      const runId = terminalRunId(terminalId)
      const status = mapTerminalStatus(snapshot.status)
      const terminalStatus = isTerminalStatus(status)
      const detail = terminalDetail(snapshot.status)
      const exitCode = Numbersafe(snapshot.status?.exitCode)
      const signal = typeof snapshot.status?.signal === 'string' ? snapshot.status.signal : null

      store.upsert({
        runId,
        kind: 'terminal',
        ownerSessionId: sessionId,
        title: '终端',
        command: typeof snapshot.name === 'string' ? snapshot.name : undefined,
        startedAt: store.get(runId)?.startedAt ?? now(),
        status,
        outputMode: 'live',
        ...(detail !== undefined ? { detail } : {}),
        exitCode,
        signal,
        handle: {
          terminalId,
          ...(typeof snapshot.type === 'string' ? { terminalType: snapshot.type } : {}),
          ...(typeof snapshot.pid === 'number' ? { pid: snapshot.pid } : {}),
        },
        stoppable: !terminalStatus,
        ...(terminalStatus ? { finishedAt: store.get(runId)?.finishedAt ?? now() } : {}),
      })

      const budget = Number.isFinite(budgets[runId]) ? budgets[runId] : 0
      if (budget <= 0) continue
      try {
        readTerminalPage({ terminals, agent, terminalId, runId, snapshot, store, config, budget, now })
      } catch (error) {
        logger?.warn?.(`[terminal-panel] terminals.read failed for ${terminalId}:`, error?.message ?? error)
        // 单会话失败只降级该会话的终端输出。
        degradedSessions.push(sessionId)
      }
    }
  }

  if (calls > 0 && failures === calls) {
    return { available: false, reason: 'terminals service rejected every session', degradedSessions }
  }
  if (noAgent > 0 && calls === 0) {
    return { available: true, reason: 'no live session with a terminal owner', degradedSessions }
  }
  if (failures > 0) return { available: true, reason: `${failures}/${calls} sessions degraded`, degradedSessions }
  return { available: true, degradedSessions }
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

  // 字节预算：终端按行交付，超预算时只截断本页文本（游标仍按行推进，宁可少给不重复给）。
  const bytes = textBytes(delta.text)
  let output = delta
  if (bytes > budget) {
    const limited = limitDelta({ chunks: [{ at: now(), text: delta.text }], nextCursor: delta.nextCursor }, budget)
    const keptText = limited.delta.chunks.map((chunk) => chunk.text).join('')
    output = { ...delta, text: keptText, truncated: true }
  }
  if (output.text.length > 0 || output.lossy === true || output.truncated === true) {
    store.setOutput(runId, 'terminal', output)
  }
}

/**
 * 停止一个 terminal 会话（唯一的写操作；只由用户点「停止」触发）。
 * @param {{terminals: any, run: object, agent: any, store: any, logger?: any}} options
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
