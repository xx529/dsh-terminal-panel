/**
 * cursors.mjs — 游标合并与读取预算规划（纯函数）。
 *
 * 契约：docs/architecture/contract.md §4.2.3（游标单调、不重复交付）、
 *       §4.3（帧预算调度）、§5.1（ChannelDelta / OutputChunk）、§11.1。
 *
 * 三种来源的游标语义不同，**不可混用**：
 *   - bash（observed.readFrom）: UTF-8 **字节偏移**，nextOffset 由服务给；
 *   - job（jobs.readAt）:        绝对**字节偏移**，`next` 当不透明整数；
 *   - terminal（terminals.read）: 「距最新行数」坐标系 → 由 terminal-window.mjs 处理，
 *     本文件的 planReads/预算只负责调度，不碰行窗口。
 */

import { textBytes } from './store.mjs'

export { textBytes }

/** 单 Run 单轮输出上限（契约 §4.3：min(16 KiB, 剩余预算)）。 */
export const PER_RUN_BUDGET_BYTES = 16384

/**
 * 取一个码点起点的信息（处理代理对）。
 * @param {string} text
 * @param {number} index
 * @returns {{size: number, units: 1|2}}
 */
function codePointAt(text, index) {
  const code = text.charCodeAt(index)
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
    const low = text.charCodeAt(index + 1)
    if (low >= 0xdc00 && low <= 0xdfff) return { size: 4, units: 2 }
  }
  if (code < 0x80) return { size: 1, units: 1 }
  if (code < 0x800) return { size: 2, units: 1 }
  return { size: 3, units: 1 }
}

/**
 * 从 UTF-8 字节偏移处截断字符串（落在码点中间时丢掉该码点）。
 * @param {string} text
 * @param {number} byteOffset
 * @returns {string}
 */
export function sliceFromBytes(text, byteOffset) {
  if (typeof text !== 'string' || text.length === 0) return ''
  if (!Number.isFinite(byteOffset) || byteOffset <= 0) return text
  let bytes = 0
  let index = 0
  while (index < text.length && bytes < byteOffset) {
    const { size, units } = codePointAt(text, index)
    bytes += size
    index += units
  }
  return text.slice(index)
}

/**
 * 取字符串的**尾** maxBytes 字节（UTF-8 对齐，不切半个码点）。
 * @param {string} text
 * @param {number} maxBytes
 * @returns {{text: string, droppedBytes: number}}
 */
export function tailBytes(text, maxBytes) {
  if (typeof text !== 'string' || text.length === 0) return { text: '', droppedBytes: 0 }
  const total = textBytes(text)
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) return { text: '', droppedBytes: total }
  if (total <= maxBytes) return { text, droppedBytes: 0 }
  // 从尾部按码点回退，直到剩余字节 ≤ maxBytes。
  let bytes = 0
  let end = text.length
  while (end > 0) {
    let start = end - 1
    const code = text.charCodeAt(start)
    if (code >= 0xdc00 && code <= 0xdfff && start > 0) {
      const high = text.charCodeAt(start - 1)
      if (high >= 0xd800 && high <= 0xdbff) start -= 1
    }
    const size = textBytes(text.slice(start, end))
    if (bytes + size > maxBytes) break
    bytes += size
    end = start
  }
  return { text: text.slice(end), droppedBytes: total - bytes }
}

/**
 * bash 通道：合并一次 observed.*.readFrom()。
 * @param {number|undefined} prevCursor 已交付字节数
 * @param {{text?: string, nextOffset?: number, lossy?: boolean}} read
 * @param {number} [at] 块时间戳
 * @returns {{chunks: object[], nextCursor: number, lossy: boolean, gapBefore: boolean}}
 */
export function mergeChannel(prevCursor, read, at = 0) {
  const prev = Number.isFinite(prevCursor) && prevCursor > 0 ? prevCursor : 0
  const next = read !== null && typeof read === 'object' && Number.isFinite(read.nextOffset)
    ? read.nextOffset
    : prev
  const text = read !== null && typeof read === 'object' && typeof read.text === 'string' ? read.text : ''
  const lossy = read !== null && typeof read === 'object' && read.lossy === true
  const chunks = text.length > 0 ? [{ at, text, byteStart: prev, byteEnd: next }] : []
  return { chunks, nextCursor: next, lossy, gapBefore: lossy && chunks.length > 0 }
}

/**
 * job 通道：裁掉与已交付字节重叠的 chunk 前缀。
 *
 * `jobs.readAt(id, from)` 在 `from` 落在 chunk 内部时会整块返回（scout §11.4），
 * 因此这里按 `chunk.at + byteLength(text)` 做去重与裁剪。
 * @param {Array<{at?: number, text?: string, channel?: string, gapBefore?: boolean}>} chunks
 * @param {number} from 绝对字节偏移
 * @returns {object[]}
 */
export function trimChunksFrom(chunks, from) {
  const list = Array.isArray(chunks) ? chunks : []
  const offset = Number.isFinite(from) && from > 0 ? from : 0
  const output = []
  for (const chunk of list) {
    if (chunk === null || typeof chunk !== 'object') continue
    const text = typeof chunk.text === 'string' ? chunk.text : ''
    if (text.length === 0) continue
    const at = Number.isFinite(chunk.at) ? chunk.at : 0
    const end = at + textBytes(text)
    if (end <= offset) continue // 完全在游标之前
    if (at >= offset) {
      output.push({
        at,
        text,
        ...(chunk.channel !== undefined ? { channel: chunk.channel } : {}),
        ...(chunk.gapBefore === true ? { gapBefore: true } : {}),
      })
      continue
    }
    const sliced = sliceFromBytes(text, offset - at)
    if (sliced.length > 0) {
      output.push({
        at: offset,
        text: sliced,
        ...(chunk.channel !== undefined ? { channel: chunk.channel } : {}),
        ...(chunk.gapBefore === true ? { gapBefore: true } : {}),
      })
    }
  }
  return output
}

/**
 * job 通道：合并一次 jobs.readAt()。
 * @param {number|undefined} prevCursor 已交付字节数（jobs 的 `next`）
 * @param {{chunks?: object[], next?: number, lossy?: boolean}} read
 * @param {number} [at] 块时间戳
 * @returns {{chunks: object[], nextCursor: number, lossy: boolean, gapBefore: boolean}}
 */
export function mergeJobRead(prevCursor, read, at = 0) {
  const prev = Number.isFinite(prevCursor) && prevCursor > 0 ? prevCursor : 0
  const safeRead = read !== null && typeof read === 'object' ? read : {}
  const trimmed = trimChunksFrom(safeRead.chunks, prev)
  let byteCursor = prev
  const chunks = trimmed.map((chunk) => {
    const text = chunk.text
    const byteStart = byteCursor
    byteCursor += textBytes(text)
    return {
      at,
      text,
      channel: chunk.channel === 'stdout' || chunk.channel === 'stderr' ? chunk.channel : 'job',
      byteStart,
      byteEnd: byteCursor,
    }
  })
  const next = Number.isFinite(safeRead.next) ? safeRead.next : prev
  const lossy = safeRead.lossy === true
  const gapBefore = lossy || trimmed.some((chunk) => chunk.gapBefore === true)
  return { chunks, nextCursor: next, lossy, gapBefore }
}

/**
 * 术语映射：RunStatus → 是否终态（避免 import status.mjs 造成额外耦合）。
 * @param {unknown} status
 * @returns {boolean}
 */
function terminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

/**
 * 读取调度计划（契约 §4.3）。
 *
 * 顺序：focusRunId → running（startedAt 升序）→ 终态（finishedAt 降序）；
 * 每个 Run 最多 `min(16 KiB, 剩余预算)`；预算耗尽后的 Run 只发元信息（预算 0）。
 * @param {object[]} runs
 * @param {Record<string, object>} [cursors] 客户端游标（当前实现只用于将来按通道细化）
 * @param {{maxBytes?: number, maxRuns?: number, focusRunId?: string}} [budget]
 * @returns {{order: string[], perRunBudget: Record<string, number>}}
 */
export function planReads(runs, cursors = {}, budget = {}) {
  const maxBytes = Number.isFinite(budget?.maxBytes) && budget.maxBytes > 0 ? budget.maxBytes : 65536
  const maxRuns = Number.isSafeInteger(budget?.maxRuns) && budget.maxRuns > 0 ? budget.maxRuns : 32
  const focusRunId = typeof budget?.focusRunId === 'string' ? budget.focusRunId : undefined
  const perRunCap = Math.min(PER_RUN_BUDGET_BYTES, maxBytes)

  const list = (Array.isArray(runs) ? runs : []).filter((run) => run !== null && typeof run === 'object' && typeof run.runId === 'string')
  const running = list
    .filter((run) => !terminalStatus(run.status))
    .sort((left, right) => (left.startedAt ?? 0) - (right.startedAt ?? 0))
  const finished = list
    .filter((run) => terminalStatus(run.status))
    .sort((left, right) => (right.finishedAt ?? right.startedAt ?? 0) - (left.finishedAt ?? left.startedAt ?? 0))
  const ordered = [...running, ...finished]
  if (focusRunId !== undefined) {
    const index = ordered.findIndex((run) => run.runId === focusRunId)
    if (index > 0) {
      const [focused] = ordered.splice(index, 1)
      ordered.unshift(focused)
    }
  }

  /** @type {string[]} */
  const order = []
  /** @type {Record<string, number>} */
  const perRunBudget = {}
  const scheduled = ordered.slice(0, maxRuns)
  let remaining = maxBytes

  // focusRunId 先拿「最多 16 KiB」，避免放大弹窗/活动列被其它列饿死。
  if (focusRunId !== undefined) {
    const focusIndex = scheduled.findIndex((run) => run.runId === focusRunId)
    if (focusIndex >= 0) {
      const share = Math.min(perRunCap, remaining)
      perRunBudget[focusRunId] = share
      remaining -= share
      order.push(focusRunId)
    }
  }

  // 其余按「剩余预算 / 剩余 Run 数」公平分配：保证 40 running 时每条都能拿到一小份，
  // 不会出现「前 4 条吃光预算、后 28 条零输出」（M2 的根因之一）。
  for (const run of scheduled) {
    if (perRunBudget[run.runId] !== undefined) continue
    const slotsLeft = Math.max(1, scheduled.length - order.length)
    if (remaining <= 0) {
      perRunBudget[run.runId] = 0
      continue
    }
    const share = Math.max(1, Math.min(perRunCap, Math.floor(remaining / slotsLeft)))
    perRunBudget[run.runId] = share
    remaining -= share
    order.push(run.runId)
  }
  return { order, perRunBudget }
}


/**
 * 把超过单 chunk 上限（契约 §4.3：单条 text ≤ 16 KiB）的块切开。
 * @param {Array<{at: number, text: string, channel?: string, byteStart?: number, byteEnd?: number}>} chunks
 * @param {number} [maxChunkBytes]
 * @returns {object[]}
 */
export function splitChunks(chunks, maxChunkBytes = 16384) {
  const list = Array.isArray(chunks) ? chunks : []
  const limit = Number.isFinite(maxChunkBytes) && maxChunkBytes > 0 ? maxChunkBytes : 16384
  const output = []
  for (const chunk of list) {
    if (chunk === null || typeof chunk !== 'object') continue
    const text = typeof chunk.text === 'string' ? chunk.text : ''
    if (text.length === 0) continue
    const byteStart = Number.isFinite(chunk.byteStart) ? chunk.byteStart : undefined
    const bytes = textBytes(text)
    if (bytes <= limit) {
      output.push({ ...chunk, ...(byteStart !== undefined ? { byteStart, byteEnd: byteStart + bytes } : {}) })
      continue
    }
    // 按字节边界切（不切开码点）。
    let index = 0
    let offset = byteStart
    while (index < text.length) {
      let piece = ''
      let pieceBytes = 0
      while (index < text.length) {
        const code = text.charCodeAt(index)
        const units = code >= 0xd800 && code <= 0xdbff && index + 1 < text.length ? 2 : 1
        const slice = text.slice(index, index + units)
        const size = textBytes(slice)
        if (pieceBytes + size > limit) break
        piece += slice
        pieceBytes += size
        index += units
      }
      if (piece.length === 0) break
      output.push({
        at: chunk.at,
        text: piece,
        ...(chunk.channel !== undefined ? { channel: chunk.channel } : {}),
        ...(offset !== undefined ? { byteStart: offset, byteEnd: offset + pieceBytes } : {}),
      })
      if (offset !== undefined) offset += pieceBytes
    }
  }
  return output
}

/**
 * 按字节预算裁剪一条 delta（帧预算 / 单 Run 上限用）。
 * 只保留完整 chunk；`nextCursor` 推进到**实际保留的最后一个字节**。
 * @param {{chunks?: object[], nextCursor?: number, lossy?: boolean, gapBefore?: boolean, truncated?: boolean}} delta
 * @param {number} maxBytes
 * @returns {{delta: object, truncated: boolean}}
 */
export function limitDelta(delta, maxBytes) {
  const source = delta !== null && typeof delta === 'object' ? delta : {}
  const chunks = Array.isArray(source.chunks) ? source.chunks : []
  const budget = Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : 0
  if (budget <= 0) {
    return {
      delta: {
        chunks: [],
        nextCursor: Number.isFinite(source.nextCursor) ? source.nextCursor : 0,
        lossy: source.lossy === true,
        gapBefore: source.gapBefore === true,
        truncated: true,
      },
      truncated: true,
    }
  }
  const kept = []
  let used = 0
  for (const chunk of chunks) {
    const bytes = textBytes(chunk?.text ?? '')
    if (kept.length > 0 && used + bytes > budget) break
    kept.push(chunk)
    used += bytes
    if (used >= budget) break
  }
  const truncated = kept.length < chunks.length
  let nextCursor = Number.isFinite(source.nextCursor) ? source.nextCursor : 0
  if (truncated) {
    const lastKept = kept[kept.length - 1]
    if (lastKept !== undefined && Number.isFinite(lastKept.byteEnd)) nextCursor = lastKept.byteEnd
    else if (kept.length === 0) nextCursor = Number.isFinite(source.nextCursor) ? source.nextCursor : 0
  }
  return {
    delta: {
      chunks: kept,
      nextCursor,
      lossy: source.lossy === true,
      gapBefore: source.gapBefore === true,
      truncated,
    },
    truncated,
  }
}

// 契约 v2 把 terminal 行坐标增量也归到 cursors.mjs（实现在 terminal-window.mjs）。
export {
  TERMINAL_PAGE_LINES,
  DEFAULT_OVERLAP_LINES,
  createTerminalWindow,
  computeTerminalDelta,
  dedupeTailOverlap,
  lastLine,
  planTerminalRead,
  tailLinesOf,
  windowCursor,
} from './terminal-window.mjs'
