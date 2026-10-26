/**
 * terminal-window.mjs — PTY scrollback 行窗口（纯函数）。
 *
 * 背景（Lead 纠偏 + scout §4.4 实测）：
 *   `ctx.terminals.read(owner, id, { offset, count })` 的 offset 是**距最新行数**：
 *     end   = totalLines - offset
 *     start = max(0, end - count)
 *   返回 `lineBegin = offset`、`lineEnd = offset + 返回行数`（同一「距最新」坐标系）；
 *   绝对行号 = totalLines - lineBegin。
 *   `truncated` = scrollback 曾被裁剪 或 本页被 maxReadBytes 截断（不是「还有下一页」）。
 *
 * 增量策略（不再假设绝对行号单调）：
 *   - 基点 `baseline = totalLines`（= 客户端已收到的行数游标）；
 *   - 每轮 k = totalLines - baseline：
 *       k > 0 → 拉尾页 count = min(k, pageLines)；
 *       k = 0 → 只探 1 行（PTY 用 \\r 重写当前行，行未结束时 totalLines 不变）；
 *       k < 0 → scrollback 头部被裁剪，丢锚点 → lossy / gapBefore；
 *   - 用「已交付文本的最后一行」做尾重叠去重，避免重复行。
 *
 * 纯函数：不 import DSH / React / Buffer。
 */

/** 单页默认行数（契约 §9 terminalPageLines）。 */
export const TERMINAL_PAGE_LINES = 400

/**
 * @typedef {{baseline: number|null, tailLine: string}} TerminalWindow
 */

/**
 * 新建窗口状态。
 * @returns {TerminalWindow}
 */
export function createTerminalWindow() {
  return { baseline: null, tailLine: '' }
}

/**
 * 规划本页读取参数。
 * @param {TerminalWindow} window
 * @param {number} totalLines
 * @param {number} [pageLines]
 * @returns {{offset: number, count: number, mode: 'initial'|'delta'|'probe'|'reset'}}
 */
export function planTerminalRead(window, totalLines, pageLines = TERMINAL_PAGE_LINES) {
  const total = Number.isFinite(totalLines) && totalLines > 0 ? Math.floor(totalLines) : 0
  const page = Number.isFinite(pageLines) && pageLines > 0 ? Math.floor(pageLines) : TERMINAL_PAGE_LINES
  const baseline = window !== null && typeof window === 'object' && Number.isFinite(window.baseline)
    ? window.baseline
    : null
  if (baseline === null) {
    return { offset: 0, count: Math.max(1, Math.min(page, total || 1)), mode: 'initial' }
  }
  const k = total - baseline
  if (k > 0) return { offset: 0, count: Math.min(k, page), mode: 'delta' }
  if (k === 0) return { offset: 0, count: 1, mode: 'probe' }
  return { offset: 0, count: Math.max(1, Math.min(page, total || 1)), mode: 'reset' }
}

/**
 * 消费一页读数，产出可追加的增量。
 * @param {TerminalWindow} window
 * @param {{text?: string, totalLines?: number, lineBegin?: number, lineEnd?: number, truncated?: boolean}} page
 * @param {number} [at] 本块时间戳（Host epoch ms）
 * @returns {{delta: object, window: TerminalWindow}}
 */
export function applyTerminalRead(window, page, at = 0) {
  const state = window !== null && typeof window === 'object' && typeof window.tailLine === 'string'
    ? window
    : createTerminalWindow()
  const text = typeof page?.text === 'string' ? page.text : ''
  const totalLines = Number.isFinite(page?.totalLines) ? Math.max(0, Math.floor(page.totalLines)) : (state.baseline ?? 0)
  const lineBegin = Number.isFinite(page?.lineBegin) ? page.lineBegin : 0
  const lineEnd = Number.isFinite(page?.lineEnd) ? page.lineEnd : lineBegin
  const pageTruncated = page?.truncated === true
  const baseline = Number.isFinite(state.baseline) ? state.baseline : null

  /** @type {{text: string, chunks: object[], nextCursor: number, totalLines: number, lineBegin: number, lineEnd: number, lossy: boolean, gapBefore: boolean, truncated: boolean}} */
  const delta = {
    text: '',
    chunks: [],
    nextCursor: totalLines,
    totalLines,
    lineBegin,
    lineEnd,
    lossy: false,
    gapBefore: false,
    truncated: pageTruncated,
  }

  if (text.length === 0) {
    // 空页：只推进基线（例如 totalLines 变小但没内容可读）。
    return {
      delta,
      window: { baseline: baseline === null ? totalLines : baseline, tailLine: state.tailLine },
    }
  }

  const reset = baseline !== null && totalLines < baseline
  let nextWindow

  if (reset) {
    // 头部被裁剪：从头重发当前保留页，标记损失。
    delta.text = text
    delta.lossy = true
    delta.gapBefore = true
    nextWindow = { baseline: totalLines, tailLine: lastLine(text) }
  } else if (baseline === null) {
    // 首次：只给尾页；若还有更早的行没给，标 gapBefore/truncated。
    delta.text = text
    delta.gapBefore = lineBegin > 0 || pageTruncated
    nextWindow = { baseline: totalLines, tailLine: lastLine(text) }
  } else if (totalLines === baseline) {
    // probe：totalLines 未变。若尾行是上一尾行的延长（PTY 续写），追加后缀。
    const previousTail = state.tailLine
    if (previousTail.length > 0 && text.startsWith(previousTail) && text.length > previousTail.length) {
      delta.text = text.slice(previousTail.length)
      nextWindow = { baseline, tailLine: lastLine(text) }
    } else if (previousTail.length === 0) {
      delta.text = text
      nextWindow = { baseline, tailLine: lastLine(text) }
    } else {
      // 尾行被原地重写（\r 或用 ANSI 光标移动后重绘）：append-only 语义下不可替换，跳过。
      nextWindow = { baseline, tailLine: lastLine(text) }
    }
  } else {
    // delta：去掉与已交付尾行的重叠部分。
    const stripped = stripTailOverlap(state.tailLine, text)
    delta.text = stripped
    nextWindow = { baseline: totalLines, tailLine: lastLine(text) }
  }

  if (delta.text.length > 0) {
    delta.chunks = [{ at, text: delta.text }]
  } else {
    delta.chunks = []
  }
  return { delta, window: nextWindow }
}

/**
 * 去掉页首与「已交付尾行」重叠的部分。
 *
 * PTY 页是按行返回的，上一轮交付的最后一行在本轮页首会整行重现。
 * @param {string} previousTail 已交付的最后一行（不含换行）
 * @param {string} text 本轮页文本
 * @returns {string}
 */
export function stripTailOverlap(previousTail, text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  if (typeof previousTail !== 'string' || previousTail.length === 0) return text
  const firstLineEnd = text.indexOf('\n')
  const firstLine = firstLineEnd < 0 ? text : text.slice(0, firstLineEnd)
  if (firstLine === previousTail) {
    return firstLineEnd < 0 ? '' : text.slice(firstLineEnd + 1)
  }
  // 尾行本身是本轮首行的前缀（行被续写）→ 只取新增后缀。
  if (firstLine.startsWith(previousTail) && firstLine.length > previousTail.length) {
    return firstLine.slice(previousTail.length) + (firstLineEnd < 0 ? '' : text.slice(firstLineEnd))
  }
  return text
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
 * 从窗口状态取「已交付行数」游标（客户端回传值）。
 * @param {TerminalWindow} window
 * @returns {number}
 */
export function windowCursor(window) {
  return window !== null && typeof window === 'object' && Number.isFinite(window.baseline) ? window.baseline : 0
}
