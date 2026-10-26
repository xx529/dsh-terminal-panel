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
  const chunks = text.length > 0 ? [{ at, text }] : []
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
  const chunks = trimmed.map((chunk) => ({
    at,
    text: chunk.text,
    channel: chunk.channel === 'stdout' || chunk.channel === 'stderr' ? chunk.channel : 'job',
  }))
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
  let remaining = maxBytes
  for (const run of ordered.slice(0, maxRuns)) {
    if (remaining <= 0) {
      perRunBudget[run.runId] = 0
      continue
    }
    const share = Math.min(perRunCap, remaining)
    perRunBudget[run.runId] = share
    remaining -= share
    order.push(run.runId)
  }
  return { order, perRunBudget }
}
