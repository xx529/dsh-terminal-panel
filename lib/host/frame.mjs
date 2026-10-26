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
 * Tier2 保底在「元信息本身已超 maxFrameBytes」时允许交付的输出前缀上限。
 * 仅在极低 maxFrameBytes + 帧级元信息下触发；整帧仍远低于 Tier3(262144)。
 */
const FALLBACK_TEXT_FLOOR_BYTES = 4096

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
  let outputTruncated = false

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
    if (truncated) outputTruncated = true
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
    // Tier1 预算耗尽（本帧没读完）同样要标 truncated，client 才能立即续读（§4.3）。
    truncated: dropped.length > 0 || outputTruncated,
    nextCursors,
  }
  return { value, nextCursors, dropped, droppedEntries }
}

/**
 * 帧预算兜底（契约 v2 §11.1）：返回**裁剪后的 PollResult**。
 * 内部调用 boundFrameDetailed；需要知道被丢的 runId 时用后者。
 * @param {object} value PollResult
 * @param {number} maxBytes
 * @returns {object} PollResult
 */
export function boundFrame(value, maxBytes) {
  return boundFrameDetailed(value, maxBytes).value
}

/**
 * 帧预算兜底（带丢弃明细）：超限时从尾部整 Run 丢弃，直到序列化体积 ≤ maxBytes。
 * @param {object} value PollResult
 * @param {number} maxBytes
 * @returns {{value: object, droppedRunIds: string[]}}
 */
export function boundFrameDetailed(value, maxBytes, options = {}) {
  const limit = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 65536
  if (value === null || typeof value !== 'object' || !Array.isArray(value.runs)) {
    return { value, droppedRunIds: [], trimmedRunIds: [], deliveredBytes: {} }
  }
  const runs = [...value.runs]
  const nextCursors = { ...(value.nextCursors ?? {}) }
  /** @type {object[]} 被整条丢弃的 Run（对象，用于保底挑选） */
  const droppedRuns = []
  /** @type {string[]} 输出被裁剪的 Run */
  const trimmedRunIds = []
  /** @type {Record<string, Record<string, number>>} 被裁剪 Run 的各通道「已交付字节」 */
  const deliveredBytes = {}

  const build = () => ({
    ...value,
    runs,
    nextCursors,
    truncated: value.truncated === true || droppedRuns.length > 0 || trimmedRunIds.length > 0,
  })
  const sizeOf = (frame) => textBytes(JSON.stringify(frame))

  // 快速路径：原帧已在上限内。
  if (sizeOf(build()) <= limit) {
    return { value: build(), droppedRunIds: [], trimmedRunIds: [], deliveredBytes }
  }

  // Tier2 常规裁剪：从尾部整 Run 丢弃，直到放得下。
  while (runs.length > 0) {
    if (sizeOf(build()) <= limit) {
      return {
        value: build(),
        droppedRunIds: droppedRuns.map((run) => run.runId),
        trimmedRunIds,
        deliveredBytes,
      }
    }
    const removedRun = runs.pop()
    const runId = removedRun?.runId
    if (typeof runId === 'string') {
      droppedRuns.push(removedRun)
      delete nextCursors[runId]
    }
  }

  // H1 保底：所有 Run 都放不下时，至少保留 1 条 —— 优先「最新且 running」，否则最新。
  const preferRunId = typeof options?.preferRunId === 'string' ? options.preferRunId : undefined
  const candidate = pickFallbackRun(value.runs, preferRunId)
  if (candidate === undefined) {
    return { value: build(), droppedRunIds: droppedRuns.map((run) => run.runId), trimmedRunIds, deliveredBytes }
  }
  const others = value.runs.filter((run) => run?.runId !== candidate.runId)
  const originalCursors = { ...(value.nextCursors ?? {}) }
  const totalText = runOutputTextBytes(candidate)

  // 二分「可交付的输出字节」，找到能塞进上限的最大前缀（可能为 0）。
  let best
  let low = 0
  let high = totalText
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const attempt = trimRunOutput(candidate, middle, originalCursors[candidate.runId])
    const frame = {
      ...value,
      runs: [attempt.run],
      nextCursors: { [candidate.runId]: attempt.cursors },
      truncated: true,
    }
    if (sizeOf(frame) <= limit) {
      best = attempt
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  const deliveredTotal = best === undefined
    ? 0
    : Object.values(best.deliveredBytes ?? {}).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0)
  if (best === undefined || (totalText > 0 && deliveredTotal === 0)) {
    // 连零输出的元信息都超限（极低 maxFrameBytes + 帧级元信息）：仍然发出，否则该 Run
    // 永远不可见、且永远零字节（H1-c 违规）。按 contract v4.1/v5 裁决，Tier2 保底允许
    // 整帧超过 maxFrameBytes，但必须远低于 Tier3(262144)；这里交付一个有界前缀，
    // 保证「每 3 帧内至少推进一次字节」且帧体积可控。
    const floorAllow = Math.min(totalText, FALLBACK_TEXT_FLOOR_BYTES)
    best = trimRunOutput(candidate, floorAllow, originalCursors[candidate.runId])
  }
  if (best.trimmed) trimmedRunIds.push(candidate.runId)
  deliveredBytes[candidate.runId] = best.deliveredBytes
  return {
    value: {
      ...value,
      runs: [best.run],
      nextCursors: { [candidate.runId]: best.cursors },
      truncated: true,
    },
    droppedRunIds: others.map((run) => run.runId),
    trimmedRunIds,
    deliveredBytes,
  }
}

/**
 * 挑选 Tier2 保底 Run：最新且 running 的优先，否则最新。
 * @param {object[]} runs
 * @returns {object|undefined}
 */
export function pickFallbackRun(runs, preferRunId) {
  const list = Array.isArray(runs) ? runs.filter((run) => run !== null && typeof run === 'object') : []
  if (list.length === 0) return undefined
  if (typeof preferRunId === 'string') {
    const preferred = list.find((run) => run.runId === preferRunId)
    if (preferred !== undefined) return preferred
  }
  let best
  for (const run of list) {
    if (best === undefined) {
      best = run
      continue
    }
    const bestRunning = isRunningStatus(best.status)
    const runRunning = isRunningStatus(run.status)
    if (bestRunning !== runRunning) {
      if (runRunning) best = run
      continue
    }
    if ((run.startedAt ?? 0) >= (best.startedAt ?? 0)) best = run
  }
  return best
}

/**
 * @param {unknown} status
 * @returns {boolean}
 */
function isRunningStatus(status) {
  return status !== 'completed' && status !== 'failed' && status !== 'killed'
}

/**
 * 一条 Run 的输出文本总字节。
 * @param {object} run
 * @returns {number}
 */
export function runOutputTextBytes(run) {
  return outputTextBytes(run?.output)
}

/**
 * 把一条 Run 的输出裁到「最多 allowBytes 字节」，并给出与实际交付对应的游标。
 *
 * 只有**输出文本**会被裁；status/元信息始终保留（这是 H1 保底的核心）。
 * @param {object} run
 * @param {number} allowBytes
 * @param {object} [originalCursor]
 * @returns {{run: object, cursors: object, deliveredBytes: Record<string, number>, trimmed: boolean}}
 */
export function trimRunOutput(run, allowBytes, originalCursor) {
  const output = run?.output ?? {}
  const budget = Number.isFinite(allowBytes) && allowBytes > 0 ? allowBytes : 0
  let remaining = budget
  const nextCursors = { ...(originalCursor !== null && typeof originalCursor === 'object' ? originalCursor : {}) }
  const deliveredBytes = {}
  let trimmed = false
  const keptOutput = {}

  for (const channel of ['stdout', 'stderr', 'job']) {
    const delta = output[channel]
    if (delta === undefined || delta === null) continue
    const chunks = Array.isArray(delta.chunks) ? delta.chunks : []
    const total = chunks.reduce((sum, chunk) => sum + textBytes(chunk?.text ?? ''), 0)
    if (total === 0) {
      keptOutput[channel] = delta
      deliveredBytes[channel] = 0
      continue
    }
    if (remaining <= 0) {
      // R2：预算为 0 时输出必须裁到 0 字节（保留 meta/status，游标不前移）。
      keptOutput[channel] = { ...delta, chunks: [], truncated: true }
      deliveredBytes[channel] = 0
      delete nextCursors[channel]
      trimmed = true
      continue
    }
    if (remaining >= total) {
      keptOutput[channel] = delta
      deliveredBytes[channel] = total
      remaining -= total
      continue
    }
    const kept = []
    let used = 0
    for (const chunk of chunks) {
      const bytes = textBytes(chunk?.text ?? '')
      if (used + bytes <= remaining) {
        kept.push(chunk)
        used += bytes
        continue
      }
      const head = headBytes(chunk?.text ?? '', remaining - used)
      if (head.text.length > 0) {
        kept.push({ ...chunk, text: head.text })
        used += textBytes(head.text)
      }
      break
    }
    const removed = total - used
    const nextCursor = Number.isFinite(delta.nextCursor) ? Math.max(0, delta.nextCursor - removed) : undefined
    keptOutput[channel] = {
      ...delta,
      chunks: kept,
      ...(Number.isFinite(nextCursor) ? { nextCursor } : {}),
      truncated: true,
    }
    if (Number.isFinite(nextCursor)) nextCursors[channel] = nextCursor
    else delete nextCursors[channel]
    deliveredBytes[channel] = used
    remaining -= used
    trimmed = true
  }

  // terminal 以行为单位：整页放不下就整页不发（游标不前移，下轮重发）。
  const terminal = output.terminal
  if (terminal !== undefined && terminal !== null) {
    const terminalText = typeof terminal.text === 'string' ? terminal.text : ''
    const bytes = textBytes(terminalText)
    if (bytes === 0) {
      keptOutput.terminal = terminal
      deliveredBytes.terminal = 0
    } else if (remaining >= bytes) {
      keptOutput.terminal = terminal
      deliveredBytes.terminal = bytes
      remaining -= bytes
    } else {
      trimmed = true
      deliveredBytes.terminal = 0
      delete nextCursors.terminal
    }
  }

  return {
    run: { ...run, output: keptOutput, ...(trimmed ? { truncated: true } : {}) },
    cursors: nextCursors,
    deliveredBytes,
    trimmed,
  }
}

/**
 * 把一条通道 delta 拆成「已交付前缀」与「待交付后缀」。
 * 用于 Tier2 部分交付后把剩余部分退回注册表（绝不丢字节）。
 * @param {object} delta
 * @param {number} deliveredBytes
 * @returns {{delivered: object|undefined, remainder: object|undefined}}
 */
export function splitDeltaAtBytes(delta, deliveredBytes) {
  if (delta === null || typeof delta !== 'object') return { delivered: undefined, remainder: undefined }
  if (!Number.isFinite(deliveredBytes) || deliveredBytes <= 0) return { delivered: undefined, remainder: delta }
  const chunks = Array.isArray(delta.chunks) ? delta.chunks : []
  const total = chunks.reduce((sum, chunk) => sum + textBytes(chunk?.text ?? ''), 0)
  if (deliveredBytes >= total) return { delivered: delta, remainder: undefined }

  const kept = []
  const rest = []
  let used = 0
  let split = false
  for (const chunk of chunks) {
    const text = typeof chunk?.text === 'string' ? chunk.text : ''
    const bytes = textBytes(text)
    if (!split && used + bytes <= deliveredBytes) {
      kept.push(chunk)
      used += bytes
      continue
    }
    if (!split) {
      // 本 chunk 只交付前缀；**立即停止**，后续 chunk 原样留在 remainder（R1：曾继续循环导致越界并入 delivered）。
      const head = headBytes(text, deliveredBytes - used)
      if (head.text.length > 0) {
        kept.push({ ...chunk, text: head.text })
        used += textBytes(head.text)
      }
      const tail = text.slice(head.text.length)
      if (tail.length > 0) rest.push({ ...chunk, text: tail })
      split = true
      continue
    }
    if (text.length > 0) rest.push(chunk)
  }

  return {
    delivered: kept.length > 0
      ? { ...delta, chunks: kept, ...(used < total ? { truncated: true } : {}) }
      : undefined,
    remainder: rest.length > 0
      ? { ...delta, chunks: rest, truncated: true }
      : undefined,
  }
}

/**
 * 把字符串截到 ≤ maxBytes 字节（保留头部、不切半个码点）。
 * @param {string} text
 * @param {number} maxBytes
 * @returns {{text: string, truncated: boolean}}
 */
export function headBytes(text, maxBytes) {
  if (typeof text !== 'string' || text.length === 0) return { text: '', truncated: false }
  // 预算 ≤ 0（或非法）必须返回空：否则会把整段文本并入「已交付」，造成静默丢字节（R1/R2）。
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return { text: '', truncated: true }
  const limit = maxBytes
  if (textBytes(text) <= limit) return { text, truncated: false }
  let bytes = 0
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    const units = code >= 0xd800 && code <= 0xdbff && index + 1 < text.length ? 2 : 1
    const size = textBytes(text.slice(index, index + units))
    if (bytes + size > limit) break
    bytes += size
    index += units
  }
  return { text: text.slice(0, index), truncated: true }
}

/**
 * 从 ToolExecutionResult 提取终态文本（契约 v2 §11.1 `parseToolResultText`）。
 *
 * 优先 `content` 里 `type:'text'` 的块；没有文本块时回退 `value` 的 JSON 摘要。
 * 超过 maxBytes 截断并标 `truncated:true`。
 * @param {{content?: Array<{type?: string, text?: string}>, value?: unknown}} result
 * @param {number} [maxBytes] 默认 32 KiB（契约 §5.2）
 * @returns {{text: string, truncated: boolean}}
 */
export function parseToolResultText(result, maxBytes = 32768) {
  const value = result !== null && typeof result === 'object' ? result : {}
  const content = Array.isArray(value.content) ? value.content : []
  let text = content
    .filter((item) => item !== null && typeof item === 'object' && item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
  if (text.length === 0 && value.value !== undefined) {
    try {
      const serialized = JSON.stringify(value.value)
      text = typeof serialized === 'string' ? serialized : String(value.value)
    } catch {
      text = String(value.value)
    }
  }
  return headBytes(text, maxBytes)
}
