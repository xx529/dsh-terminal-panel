/**
 * terminal-window.mjs — PTY scrollback 行坐标增量（纯函数，契约 v2 §11.1）。
 *
 * 实测语义（scout §4.4 / contract v2 §3.3，FACT）：
 *   `ctx.terminals.read(owner, id, { offset, count })` 的 offset 是**距最新行数**：
 *     end   = totalLines - offset
 *     start = max(0, end - count)
 *   返回 `lineBegin = offset`、`lineEnd = offset + 返回行数`（同坐标系）；
 *   绝对行号 = totalLines - lineBegin；`truncated` = scrollback 被裁剪/单页字节截断。
 *
 * 增量模型（契约 v2）：
 *   prev = { totalLines, tail }（tail = 已交付的最后若干行文本，用于尾重叠去重）；
 *   k = page.totalLines - prev.totalLines；
 *     k > 0  → 取尾页 + 行尾重叠去重；
 *     k = 0  → 只探尾行（PTY 用 \r 重写当前行，行未结束时 totalLines 不变）；
 *     k < 0  → scrollback 头部被裁剪，基线回退 → lossy + 重置基线。
 *   `lineEnd < totalLines` 才算「没取完」→ truncated（**不是**「还有下一页」）。
 */

/** 单页默认行数（契约 §9 terminalPageLines）。 */
export const TERMINAL_PAGE_LINES = 400

/** delta 模式一次最多请求的行数（防止病态输出把单帧撑爆；服务端还有字节上限）。 */
export const MAX_DELTA_LINES = 10000

/** 尾重叠去重的默认行数。 */
export const DEFAULT_OVERLAP_LINES = 32

/**
 * @typedef {{totalLines: number, tail: string}} TerminalBaseline
 */

/**
 * 新建基线。
 * @returns {TerminalBaseline}
 */
export function createTerminalWindow() {
  return { totalLines: 0, tail: '' }
}

/**
 * 文本最后一行（不含换行）。
 * @param {string} text
 * @returns {string}
 */
export function lastLine(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  const index = text.lastIndexOf('\n')
  return index < 0 ? text : text.slice(index + 1)
}

/**
 * 取文本最后 n 行（用于 tail 基线）。
 * @param {string} text
 * @param {number} [lines]
 * @returns {string}
 */
export function tailLinesOf(text, lines = DEFAULT_OVERLAP_LINES) {
  if (typeof text !== 'string' || text.length === 0) return ''
  const parts = text.split('\n')
  const count = Number.isSafeInteger(lines) && lines > 0 ? lines : DEFAULT_OVERLAP_LINES
  return parts.slice(Math.max(0, parts.length - count)).join('\n')
}

/**
 * 按行尾重叠去重（默认 32 行）。
 *
 * prevTail 是「已交付的最后若干行」；incoming 是本页文本。找到 prevTail 的后缀
 * 与 incoming 前缀的最长整行匹配并剥掉；另外处理「同一行被续写」的前缀情形。
 * @param {string} prevTail
 * @param {string} incoming
 * @param {number} [overlapLines]
 * @returns {{text: string, overlapLines: number}}
 */
export function dedupeTailOverlap(prevTail, incoming, overlapLines = DEFAULT_OVERLAP_LINES) {
  const text = typeof incoming === 'string' ? incoming : ''
  const previous = typeof prevTail === 'string' ? prevTail : ''
  if (text.length === 0) return { text: '', overlapLines: 0 }
  if (previous.length === 0) return { text, overlapLines: 0 }

  const incomingLines = text.split('\n')
  const previousLines = previous.split('\n')
  const cap = Math.min(
    Number.isSafeInteger(overlapLines) && overlapLines > 0 ? overlapLines : DEFAULT_OVERLAP_LINES,
    previousLines.length,
    incomingLines.length,
  )
  for (let count = cap; count >= 1; count -= 1) {
    const suffix = previousLines.slice(previousLines.length - count)
    let matches = true
    for (let index = 0; index < count; index += 1) {
      if (suffix[index] !== incomingLines[index]) {
        matches = false
        break
      }
    }
    if (!matches) continue
    return { text: incomingLines.slice(count).join('\n'), overlapLines: count }
  }

  // 行内续写：prevTail 的最后一行是本页首行的前缀（行还没结束就被读到）。
  const lastPrevious = previousLines[previousLines.length - 1]
  if (lastPrevious.length > 0 && incomingLines[0].startsWith(lastPrevious) && incomingLines[0].length > lastPrevious.length) {
    const first = incomingLines[0].slice(lastPrevious.length)
    return { text: [first, ...incomingLines.slice(1)].join('\n'), overlapLines: 0 }
  }
  return { text, overlapLines: 0 }
}

/**
 * 规划本页读取参数（capture 用；纯函数）。
 * @param {TerminalBaseline} prev
 * @param {number} totalLines
 * @param {number} [pageLines]
 * @returns {{offset: number, count: number, mode: 'initial'|'delta'|'probe'|'reset'}}
 */
export function planTerminalRead(prev, totalLines, pageLines = TERMINAL_PAGE_LINES) {
  const total = Number.isFinite(totalLines) && totalLines > 0 ? Math.floor(totalLines) : 0
  const page = Number.isFinite(pageLines) && pageLines > 0 ? Math.floor(pageLines) : TERMINAL_PAGE_LINES
  const previousTotal = Number.isFinite(prev?.totalLines) ? prev.totalLines : 0
  const hasTail = typeof prev?.tail === 'string' && prev.tail.length > 0
  if (previousTotal === 0 && !hasTail) {
    return { offset: 0, count: Math.max(1, Math.min(page, total || 1)), mode: 'initial' }
  }
  const k = total - previousTotal
  if (k > 0) return { offset: 0, count: Math.min(k, MAX_DELTA_LINES), mode: 'delta' }
  if (k === 0) return { offset: 0, count: 1, mode: 'probe' }
  return { offset: 0, count: Math.max(1, Math.min(page, total || 1)), mode: 'reset' }
}

/**
 * 计算一页读数的增量（契约 v2 §11.1 `computeTerminalDelta`）。
 * @param {TerminalBaseline} prev
 * @param {{text?: string, totalLines?: number, lineBegin?: number, lineEnd?: number, truncated?: boolean}} page
 * @param {number} [overlapLines]
 * @returns {{delta: object, nextBaseline: TerminalBaseline}}
 */
export function computeTerminalDelta(prev, page, overlapLines = DEFAULT_OVERLAP_LINES) {
  const previousTotal = Number.isFinite(prev?.totalLines) ? prev.totalLines : 0
  const previousTail = typeof prev?.tail === 'string' ? prev.tail : ''
  const totalLines = Number.isFinite(page?.totalLines) ? Math.max(0, Math.floor(page.totalLines)) : previousTotal
  const lineBegin = Number.isFinite(page?.lineBegin) ? page.lineBegin : 0
  const lineEnd = Number.isFinite(page?.lineEnd) ? page.lineEnd : lineBegin
  const rawText = typeof page?.text === 'string' ? page.text : ''
  const pageTruncated = page?.truncated === true
  const absBegin = Math.max(0, totalLines - lineEnd)
  const absEnd = Math.max(0, totalLines - lineBegin)
  const k = totalLines - previousTotal

  /** @type {object} */
  const delta = {
    text: '',
    totalLines,
    lineBegin,
    lineEnd,
    absBegin,
    absEnd,
    nextCursor: totalLines,
    truncated: pageTruncated,
    lossy: false,
  }

  // k < 0：scrollback 头部被裁剪，基线回退 → lossy + 重置基线（契约 §11.1）。
  if (k < 0) {
    delta.text = rawText
    delta.lossy = true
    return { delta, nextBaseline: { totalLines, tail: tailLinesOf(rawText, overlapLines) } }
  }

  // k === 0：只探尾行。PTY 用 \r 重写当前行 / 行未结束时会命中这里。
  if (k === 0) {
    if (rawText.length === 0) {
      return { delta, nextBaseline: { totalLines: previousTotal, tail: previousTail } }
    }
    const deduped = dedupeTailOverlap(previousTail, rawText, overlapLines)
    // probe 只可能是「同一行续写」，不需要补换行。
    delta.text = deduped.text
    delta.nextCursor = previousTotal
    return {
      delta,
      nextBaseline: {
        totalLines: previousTotal,
        tail: delta.text.length > 0 ? tailLinesOf(rawText, overlapLines) : previousTail,
      },
    }
  }

  // k > 0：尾页 + 行尾重叠去重。
  const deduped = dedupeTailOverlap(previousTail, rawText, overlapLines)
  const incomingLines = rawText.split('\n')
  const remainingLines = incomingLines.length - deduped.overlapLines
  // 行边界：本页从**新行**开始时，追加前必须补一个 '\n'，否则两行会粘连
  // （'a\nb\nc' + 'd' 必须是 'a\nb\nc\nd'，而不是 'a\nb\ncd'）。
  // 空行也有语义：新增 1 个空行 → 追加 '\n'；新增 2 个空行 → '\n\n'。
  const previousLines = previousTail.split('\n')
  const lastPreviousLine = previousLines[previousLines.length - 1] ?? ''
  const firstIncomingLine = incomingLines[0] ?? ''
  const continuesLine = previousTotal > 0
    && lastPreviousLine.length > 0
    && firstIncomingLine.startsWith(lastPreviousLine)
    && firstIncomingLine.length > lastPreviousLine.length
    && deduped.overlapLines === 0
  if (continuesLine) {
    delta.text = deduped.text
  } else if (remainingLines > 0) {
    const body = incomingLines.slice(deduped.overlapLines).join('\n')
    delta.text = previousTotal > 0 ? `\n${body}` : body
  } else {
    delta.text = ''
  }
  // 「没取完」= 页没覆盖到 0 号（最新）行；page.truncated 是 scrollback 裁剪/字节截断。
  delta.truncated = pageTruncated || lineEnd < totalLines
  // 页起点晚于已交付基线 → 中间有缺口（丢行，不可恢复）。
  if (absBegin > previousTotal) delta.lossy = true
  return {
    delta,
    nextBaseline: {
      totalLines,
      tail: tailLinesOf(delta.text.length > 0 ? rawText : previousTail, overlapLines),
    },
  }
}

/**
 * 便捷封装：消费一页并返回新的窗口状态。
 * @param {TerminalBaseline} window
 * @param {object} page
 * @param {number} [overlapLines]
 * @returns {{delta: object, window: TerminalBaseline}}
 */
export function applyTerminalRead(window, page, overlapLines = DEFAULT_OVERLAP_LINES) {
  const { delta, nextBaseline } = computeTerminalDelta(window, page, overlapLines)
  return { delta, window: nextBaseline }
}

/**
 * 基线游标（= 已交付行数）。
 * @param {TerminalBaseline} window
 * @returns {number}
 */
export function windowCursor(window) {
  return window !== null && typeof window === 'object' && Number.isFinite(window.totalLines) ? window.totalLines : 0
}
