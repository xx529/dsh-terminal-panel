/**
 * frame.mjs — PollResult 组装与帧预算兜底（纯函数）。
 *
 * 契约：docs/architecture/contract.md §4.2（poll 帧形状）、§4.3（预算/截断）、
 *       §5.1（Run / ChannelDelta / TerminalDelta）、§11.1。
 *
 * 设计要点：
 *  - 游标只由「本帧真正发出的 delta.nextCursor」推进；被丢弃的 Run 必须由调用方
 *    退回注册表（store.restore），保证下一轮还能续读、绝不丢字节；
 *  - `truncated` = 本帧没发完（可续读）；`lossy` = 数据已丢（不可恢复）——语义不同；
 *  - 一律整 Run 丢弃，不切 chunk（切了就得同时改游标，容易丢字节）。
 */

import { textBytes } from './store.mjs'

export { textBytes }

/**
 * 统计一条 output 的文本字节数。
 * @param {object} output
 * @returns {number}
 */
export function outputTextBytes(output) {
  if (output === null || typeof output !== 'object') return 0
  let bytes = 0
  for (const channel of ['stdout', 'stderr', 'job']) {
    const delta = output[channel]
    if (delta === undefined || delta === null) continue
    if (typeof delta.text === 'string') bytes += textBytes(delta.text)
    for (const chunk of delta.chunks ?? []) bytes += textBytes(chunk?.text ?? '')
  }
  const terminal = output.terminal
  if (terminal !== undefined && terminal !== null) {
    if (typeof terminal.text === 'string') bytes += textBytes(terminal.text)
    for (const chunk of terminal.chunks ?? []) bytes += textBytes(chunk?.text ?? '')
  }
  return bytes
}

/**
 * 归一化输出增量，保证线上形状符合契约 §5.1。
 * @param {object} output
 * @param {number} fallbackAt
 * @returns {{stdout?: object, stderr?: object, job?: object, terminal?: object}}
 */
export function normalizeOutput(output, fallbackAt = 0) {
  const result = {}
  if (output === null || typeof output !== 'object') return result
  for (const channel of ['stdout', 'stderr', 'job']) {
    const delta = output[channel]
    if (delta === undefined || delta === null) continue
    const chunks = Array.isArray(delta.chunks)
      ? delta.chunks
          .filter((chunk) => chunk !== null && typeof chunk === 'object' && typeof chunk.text === 'string' && chunk.text.length > 0)
          .map((chunk) => ({
            at: Number.isFinite(chunk.at) ? chunk.at : fallbackAt,
            text: chunk.text,
            ...(chunk.channel !== undefined ? { channel: chunk.channel } : {}),
          }))
      : []
    if (chunks.length === 0 && delta.lossy !== true) continue
    result[channel] = {
      chunks,
      nextCursor: Number.isFinite(delta.nextCursor) ? delta.nextCursor : 0,
      lossy: delta.lossy === true,
      gapBefore: delta.gapBefore === true,
      truncated: delta.truncated === true,
    }
  }
  const terminal = output.terminal
  if (terminal !== undefined && terminal !== null) {
    const chunks = Array.isArray(terminal.chunks)
      ? terminal.chunks
          .filter((chunk) => chunk !== null && typeof chunk === 'object' && typeof chunk.text === 'string' && chunk.text.length > 0)
          .map((chunk) => ({
            at: Number.isFinite(chunk.at) ? chunk.at : fallbackAt,
            text: chunk.text,
          }))
      : []
    const text = typeof terminal.text === 'string' ? terminal.text : chunks.map((chunk) => chunk.text).join('')
    if (text.length > 0 || terminal.lossy === true || terminal.gapBefore === true) {
      result.terminal = {
        text,
        chunks,
        totalLines: Number.isFinite(terminal.totalLines) ? terminal.totalLines : 0,
        lineBegin: Number.isFinite(terminal.lineBegin) ? terminal.lineBegin : 0,
        lineEnd: Number.isFinite(terminal.lineEnd) ? terminal.lineEnd : 0,
        nextCursor: Number.isFinite(terminal.nextCursor) ? terminal.nextCursor : 0,
        lossy: terminal.lossy === true,
        gapBefore: terminal.gapBefore === true,
        truncated: terminal.truncated === true,
      }
    }
  }
  return result
}

/**
 * 组装 poll 帧。
 * @param {{
 *   revision: number,
 *   serverTime: number,
 *   sessionId: string,
 *   sessions?: object[],
 *   availability?: object,
 *   removed?: string[],
 *   entries?: Array<{run: object, output?: object}>,
 * }} input
 * @param {Record<string, object>} [cursors] 客户端上一轮游标（用于回显未变化通道）
 * @param {{maxBytes?: number, maxRuns?: number}} [budget]
 * @returns {{value: object, nextCursors: Record<string, object>, dropped: string[], droppedEntries: object[]}}
 */
export function buildPollFrame(input, cursors = {}, budget = {}) {
  const maxBytes = Number.isFinite(budget?.maxBytes) && budget.maxBytes > 0 ? budget.maxBytes : 65536
  const entries = Array.isArray(input?.entries) ? input.entries : []
  const sourceCursors = cursors !== null && typeof cursors === 'object' ? cursors : {}

  /** @type {object[]} */
  const runs = []
  /** @type {Record<string, object>} */
  const nextCursors = {}
  /** @type {string[]} */
  const dropped = []
  /** @type {object[]} */
  const droppedEntries = []
  let used = 0

  for (const entry of entries) {
    const run = entry?.run
    if (run === null || typeof run !== 'object' || typeof run.runId !== 'string') continue
    const output = normalizeOutput(entry.output, run.startedAt ?? 0)
    const cost = outputTextBytes(output)
    // 第一条永远放行（否则一个大输出会饿死整帧），其余按预算截断。
    if (runs.length > 0 && used + cost > maxBytes) {
      dropped.push(run.runId)
      droppedEntries.push(entry)
      continue
    }
    used += cost

    let lossy = false
    let truncated = false
    for (const delta of Object.values(output)) {
      if (delta?.lossy === true) lossy = true
      if (delta?.truncated === true) truncated = true
    }
    const hasOutput = Object.keys(output).length > 0
    runs.push({
      ...run,
      ...(hasOutput ? { output } : {}),
      lossy: run.lossy === true || lossy,
      truncated: run.truncated === true || truncated,
    })

    const cursor = { ...(sourceCursors[run.runId] ?? {}) }
    for (const [channel, delta] of Object.entries(output)) {
      if (Number.isFinite(delta?.nextCursor)) cursor[channel] = delta.nextCursor
    }
    nextCursors[run.runId] = cursor
  }

  const value = {
    protocol: 1,
    sessionId: input?.sessionId ?? '',
    serverTime: Number.isFinite(input?.serverTime) ? input.serverTime : 0,
    revision: Number.isFinite(input?.revision) ? input.revision : 0,
    sessions: Array.isArray(input?.sessions) ? input.sessions : [],
    runs,
    removed: Array.isArray(input?.removed) ? input.removed : [],
    availability: input?.availability ?? {
      bash: { available: true },
      jobs: { available: true },
      terminals: { available: true },
      tree: { available: true },
    },
    truncated: dropped.length > 0,
    nextCursors,
  }
  return { value, nextCursors, dropped, droppedEntries }
}

/**
 * 帧预算兜底：超限时从尾部整 Run 丢弃，直到序列化体积 ≤ maxBytes。
 * @param {object} value PollResult
 * @param {number} maxBytes
 * @returns {{value: object, droppedRunIds: string[]}}
 */
export function boundFrame(value, maxBytes) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 65536
  if (value === null || typeof value !== 'object' || !Array.isArray(value.runs)) {
    return { value, droppedRunIds: [] }
  }
  if (textBytes(JSON.stringify(value)) <= limit) return { value, droppedRunIds: [] }

  const runs = [...value.runs]
  const nextCursors = { ...(value.nextCursors ?? {}) }
  /** @type {string[]} */
  const droppedRunIds = []
  let truncated = value.truncated === true
  while (runs.length > 0) {
    const candidate = { ...value, runs, nextCursors, truncated: true }
    if (textBytes(JSON.stringify(candidate)) <= limit) break
    const removedRun = runs.pop()
    truncated = true
    const runId = removedRun?.runId
    if (typeof runId === 'string') {
      droppedRunIds.push(runId)
      delete nextCursors[runId]
    }
  }
  return {
    value: { ...value, runs, nextCursors, truncated },
    droppedRunIds,
  }
}
