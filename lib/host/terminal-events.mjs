/**
 * terminal-events.mjs — 终端工具事件旁路（纯函数，契约 v7 §5.2/§5.5）。
 *
 * 背景（真机缺陷①）：`ctx.agents.get(sessionId)` 在会话空闲时可能拿不到 live Agent，
 * 而 `ctx.terminals.*` 的 owner 必须是 Agent，于是 `terminal_open/send/read` 实际跑过、
 * 面板却是「终端 0」。v7 增加第三级发现：**直接解析 tools/execute / tools/result 的事件**：
 *   - `terminal_open` 结果文本 → terminalId / name / type（`started terminal session …`）；
 *   - `terminal_send` 的参数 text → 追加到 `Run.inputs`；结果后缀 `[session: …]` → 状态；
 *   - `terminal_close` / `terminal_kill` → 终态；
 *   - `terminal_list` 结果每一行 → 补登记元信息。
 *
 * 本模块只做「文本/参数 → 结构化事实」的纯转换，不碰 ctx / store。
 */

import { textBytes } from './store.mjs'

/** Run.inputs 的边界（契约 v7：最后 20 条、单条 ≤2KiB、合计 ≤8KiB，超出丢最旧）。 */
export const TERMINAL_INPUT_LIMITS = Object.freeze({
  maxEntries: 20,
  maxEntryBytes: 2048,
  maxTotalBytes: 8192,
})

/** 降级提示文案（客户端在输出区顶部显示一行）。 */
export const TERMINAL_NOTICE_MESSAGES = Object.freeze({
  'terminal-no-agent': '无法解析该会话的 Agent，终端只能显示元信息（无实时输出）',
  'terminal-read-failed': '终端输出读取失败，仅显示已知信息',
  'terminal-controller-unavailable': 'terminalController 不可用，已降级到工具事件发现终端',
})

/**
 * 构造 `Run.notice`（契约 v7 §5.1）。
 * @param {string} code
 * @param {string} [message]
 * @returns {{code: string, message: string}}
 */
export function noticeFor(code, message) {
  const text = typeof message === 'string' && message.length > 0
    ? message
    : TERMINAL_NOTICE_MESSAGES[code] ?? code
  return { code, message: text }
}

/**
 * 按 UTF-8 字节截断（不切半个码点，末尾补 `…`）。
 * @param {string} text
 * @param {number} maxBytes
 * @returns {string}
 */
function truncateUtf8(text, maxBytes) {
  if (typeof text !== 'string') return ''
  if (textBytes(text) <= maxBytes) return text
  const ELLIPSIS_BYTES = 3
  const budget = Math.max(0, maxBytes - ELLIPSIS_BYTES)
  let used = 0
  let index = 0
  while (index < text.length) {
    const code = text.charCodeAt(index)
    const isPair = code >= 0xd800 && code <= 0xdbff && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff
    const units = isPair ? 2 : 1
    const size = textBytes(text.slice(index, index + units))
    if (used + size > budget) break
    used += size
    index += units
  }
  return `${text.slice(0, index)}…`
}

/**
 * 追加一条终端输入，返回有界的 `inputs`（丢最旧）。
 * @param {string[]|undefined} inputs
 * @param {unknown} entry
 * @param {{maxEntries?: number, maxEntryBytes?: number, maxTotalBytes?: number}} [limits]
 * @returns {{inputs: string[], dropped: number}}
 */
export function appendTerminalInput(inputs, entry, limits = TERMINAL_INPUT_LIMITS) {
  const maxEntries = limits.maxEntries ?? TERMINAL_INPUT_LIMITS.maxEntries
  const maxEntryBytes = limits.maxEntryBytes ?? TERMINAL_INPUT_LIMITS.maxEntryBytes
  const maxTotalBytes = limits.maxTotalBytes ?? TERMINAL_INPUT_LIMITS.maxTotalBytes
  const list = Array.isArray(inputs) ? inputs.filter((item) => typeof item === 'string') : []
  if (typeof entry !== 'string') return { inputs: [...list], dropped: 0 }
  const normalized = entry.replace(/\r\n?/g, '\n')
  if (normalized.length === 0) return { inputs: [...list], dropped: 0 }
  list.push(truncateUtf8(normalized, maxEntryBytes))
  let dropped = 0
  const totalBytes = () => list.reduce((sum, item) => sum + textBytes(item), 0)
  while (list.length > 0 && (list.length > maxEntries || totalBytes() > maxTotalBytes)) {
    list.shift()
    dropped += 1
  }
  return { inputs: list, dropped }
}

/**
 * 识别 `terminal_*` 工具调用（参数层面能拿到的信息）。
 * @param {unknown} name 工具名
 * @param {unknown} args 已解析参数
 * @returns {{kind: 'open'|'send'|'read'|'close'|'signal'|'list', terminalId?: string, text?: string, type?: string, name?: string}|null}
 */
export function terminalToolCall(name, args) {
  if (typeof name !== 'string' || !name.startsWith('terminal_')) return null
  const value = args !== null && typeof args === 'object' ? args : {}
  const terminalId = typeof value.sessionId === 'string'
    ? value.sessionId
    : typeof value.terminalId === 'string' ? value.terminalId : undefined
  const text = typeof value.text === 'string' ? value.text : undefined
  const optional = {
    ...(terminalId !== undefined ? { terminalId } : {}),
    ...(text !== undefined ? { text } : {}),
  }
  switch (name) {
    case 'terminal_open':
      return {
        kind: 'open',
        ...(typeof value.type === 'string' ? { type: value.type } : {}),
        ...(typeof value.name === 'string' ? { name: value.name } : {}),
      }
    case 'terminal_send':
      return { kind: 'send', ...optional }
    case 'terminal_read':
      return { kind: 'read', ...optional }
    case 'terminal_close':
    case 'terminal_kill':
      return { kind: 'close', ...optional }
    case 'terminal_signal':
      return { kind: 'signal', ...optional }
    case 'terminal_list':
      return { kind: 'list' }
    default:
      return null
  }
}

/**
 * 解析 `terminal_open` 的渲染结果：
 * `started terminal session <id> (<name>)? [type: <type>]`。
 * @param {string} text
 * @returns {{terminalId: string, name?: string, type?: string}|null}
 */
export function parseTerminalOpenResult(text) {
  if (typeof text !== 'string') return null
  const match = /^started terminal session (\S+?)(?: \((.*?)\))? \[type: ([^\]]+)\]/.exec(text)
  if (match?.[1] === undefined) return null
  return {
    terminalId: match[1],
    ...(match[2] !== undefined ? { name: match[2] } : {}),
    ...(match[3] !== undefined ? { type: match[3] } : {}),
  }
}

/**
 * 解析 `terminal_send` 结果后缀里的会话状态：
 * `[session: running]` 或 `[session: exited code=0 signal=null]`。
 * @param {string} text
 * @returns {{kind: 'running'}|{kind: 'exited', exitCode: number|null, signal: string|null}|null}
 */
export function parseTerminalSessionStatus(text) {
  if (typeof text !== 'string') return null
  const exited = /\[session: exited code=(\S+) signal=(\S+)\]/.exec(text)
  if (exited?.[1] !== undefined) {
    const code = exited[1] === 'null' ? null : Number(exited[1])
    const signal = exited[2] === 'null' ? null : exited[2]
    return { kind: 'exited', exitCode: Number.isFinite(code) ? code : null, signal }
  }
  if (/\[session: running\]/.test(text)) return { kind: 'running' }
  return null
}

/**
 * 解析 `terminal_close` 的渲染结果：`closed terminal session <id>`。
 * @param {string} text
 * @returns {{terminalId: string, outcome: 'closed'|'already-closing'}|null}
 */
export function parseTerminalCloseResult(text) {
  if (typeof text !== 'string') return null
  const closed = /^closed terminal session (\S+)/.exec(text)
  if (closed?.[1] !== undefined) return { terminalId: closed[1], outcome: 'closed' }
  const closing = /^terminal session (\S+) was already closing/.exec(text)
  if (closing?.[1] !== undefined) return { terminalId: closing[1], outcome: 'already-closing' }
  return null
}

/**
 * 解析 `terminal_list` 结果：每行 `<id>( (<name>))? [<type>] <status>( pid=<pid>)?`。
 * @param {string} text
 * @returns {Array<{terminalId: string, name?: string, type?: string, pid?: number, status: object}>}
 */
export function parseTerminalListResult(text) {
  if (typeof text !== 'string' || text.startsWith('(no terminal sessions)')) return []
  const output = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    const match = /^(\S+?)(?: \((.*?)\))? \[([^\]]+)\] (running|exited code=\S+ signal=\S+)(?: pid=(\d+))?$/.exec(line)
    if (match?.[1] === undefined) continue
    const status = match[4].startsWith('running')
      ? { kind: 'running' }
      : parseTerminalSessionStatus(`[session: ${match[4]}]`) ?? { kind: 'running' }
    output.push({
      terminalId: match[1],
      ...(match[2] !== undefined ? { name: match[2] } : {}),
      ...(match[3] !== undefined ? { type: match[3] } : {}),
      ...(match[5] !== undefined ? { pid: Number(match[5]) } : {}),
      status,
    })
  }
  return output
}

/**
 * 归一化 `terminalController.list(sessionId)` 的返回项。
 *
 * 真实形状（Host inspect `Service.listService {service:'terminalController'}` 实测，
 * `@Remote list(sessionId: SessionId): WebTerminalInfo[]`，**无需 Agent**）：
 *   `{ id, title, shell: { path, args, name }, cwd, cols, rows,
 *      state: 'running'|'exited'|'failed', exitCode: number|null, error?: string }`
 * 同时容忍旧/其他形状（id/sessionId/terminalId、title/name、type/backend、status 字符串或对象）。
 * @param {unknown} raw
 * @param {string} [fallbackSessionId] 归属会话（避免把终端 id 当会话 id）
 * @returns {{
 *   terminalId: string, name?: string, type?: string, cwd?: string, pid?: number,
 *   status?: object, state?: 'running'|'exited'|'failed', exitCode?: number|null, error?: string,
 * }|null}
 */
export function normalizeControllerTerminal(raw, fallbackSessionId) {
  if (raw === null || typeof raw !== 'object') return null
  const id = typeof raw.id === 'string'
    ? raw.id
    : typeof raw.sessionId === 'string'
      ? raw.sessionId
      : typeof raw.terminalId === 'string' ? raw.terminalId : undefined
  if (id === undefined) return null
  const shell = raw.shell !== null && typeof raw.shell === 'object' ? raw.shell : undefined
  const name = typeof raw.title === 'string'
    ? raw.title
    : typeof raw.name === 'string' ? raw.name : undefined
  const type = typeof raw.type === 'string'
    ? raw.type
    : typeof raw.backend === 'string'
      ? raw.backend
      : typeof shell?.name === 'string' ? shell.name : undefined
  const cwd = typeof raw.cwd === 'string' ? raw.cwd : undefined
  const pid = typeof raw.pid === 'number' && Number.isFinite(raw.pid) ? raw.pid : undefined
  let state
  if (raw.state === 'running' || raw.state === 'exited' || raw.state === 'failed') state = raw.state
  const exitCode = typeof raw.exitCode === 'number' || raw.exitCode === null ? raw.exitCode : undefined
  const error = typeof raw.error === 'string' ? raw.error : undefined
  let status
  if (typeof raw.status === 'string') {
    status = raw.status === 'running' ? { kind: 'running' } : { kind: 'exited', exitCode: exitCode ?? null, signal: null }
  } else if (raw.status !== null && typeof raw.status === 'object') {
    status = raw.status
  } else if (state !== undefined) {
    // 按 scout T30 §6.2 / Lead 裁决：running→running；exited→exitCode（可为 null）；
    // failed→exitCode ?? 1（保证 mapTerminalStatus 归一为 failed，而不是误判 running）。
    status = state === 'running'
      ? { kind: 'running' }
      : { kind: 'exited', exitCode: state === 'failed' ? exitCode ?? 1 : exitCode ?? null, signal: null }
  }
  return {
    terminalId: id,
    ...(name !== undefined ? { name } : {}),
    ...(type !== undefined ? { type } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(exitCode !== undefined ? { exitCode } : {}),
    ...(error !== undefined ? { error } : {}),
    ...(fallbackSessionId !== undefined ? { fallbackSessionId } : {}),
  }
}
