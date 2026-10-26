/**
 * status.mjs — 三个来源的原始状态 → RunStatus（纯函数，无 DSH / React 依赖）。
 *
 * 契约：docs/architecture/contract.md §6.1「来源状态映射」表。
 * RunStatus = 'running' | 'completed' | 'failed' | 'killed'
 */

/** @typedef {'running'|'completed'|'failed'|'killed'} RunStatus */

/**
 * ShellProcess（ctx.shell.execute 的句柄）→ RunStatus。
 * @param {{status?: string, exitCode?: number|null, signal?: string|null}} value
 * @returns {RunStatus}
 */
export function mapShellStatus(value) {
  const status = value !== null && typeof value === 'object' ? value.status : undefined
  if (status === 'killed') return 'killed'
  if (status !== 'completed') return 'running'
  const exitCode = value.exitCode
  if (exitCode === 0) return 'completed'
  // 非 0 或 null（null + signal 也归 failed，契约 §6.1）
  return 'failed'
}

/**
 * shell 终态的 detail 文案（失败原因 / kill 原因）。
 * @param {{status?: string, exitCode?: number|null, signal?: string|null, timedOut?: boolean, aborted?: boolean}} value
 * @returns {string|undefined}
 */
export function shellDetail(value) {
  const v = value !== null && typeof value === 'object' ? value : {}
  const parts = []
  if (v.timedOut === true) parts.push('timed out')
  if (v.aborted === true) parts.push('aborted')
  if (v.signal !== null && v.signal !== undefined) parts.push(`signal ${v.signal}`)
  if (v.status === 'killed' && parts.length === 0) parts.push('killed')
  if (v.status === 'completed' && typeof v.exitCode === 'number' && v.exitCode !== 0) {
    parts.push(`exit code ${v.exitCode}`)
  }
  if (v.status === 'completed' && v.exitCode === null && parts.length === 0) {
    parts.push('exit status unknown')
  }
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * JobView.status → { status, stopping }。
 * @param {unknown} raw JobView.status
 * @returns {{status: RunStatus, stopping: boolean}}
 */
export function mapJobStatus(raw) {
  if (raw === 'running') return { status: 'running', stopping: false }
  if (raw === 'stopping') return { status: 'running', stopping: true }
  if (raw === 'completed') return { status: 'completed', stopping: false }
  if (raw === 'killed') return { status: 'killed', stopping: false }
  if (raw === 'failed') return { status: 'failed', stopping: false }
  return { status: 'running', stopping: false }
}

/**
 * TerminalSessionSnapshot.status → RunStatus。
 * @param {{kind?: string, exitCode?: number|null, signal?: string|null}} value
 * @returns {RunStatus}
 */
export function mapTerminalStatus(value) {
  const v = value !== null && typeof value === 'object' ? value : {}
  if (v.kind !== 'exited') return 'running'
  if (v.signal !== null && v.signal !== undefined) return 'failed'
  return v.exitCode === 0 ? 'completed' : 'failed'
}

/**
 * terminal 终态 detail。
 * @param {{kind?: string, exitCode?: number|null, signal?: string|null}} value
 * @returns {string|undefined}
 */
export function terminalDetail(value) {
  const v = value !== null && typeof value === 'object' ? value : {}
  if (v.kind !== 'exited') return undefined
  const parts = []
  if (v.signal !== null && v.signal !== undefined) parts.push(`signal ${v.signal}`)
  if (typeof v.exitCode === 'number' && v.exitCode !== 0) parts.push(`exit code ${v.exitCode}`)
  return parts.length > 0 ? parts.join(' · ') : undefined
}

/**
 * RunStatus 是否为终态。
 * @param {unknown} status
 * @returns {boolean}
 */
export function isTerminalStatus(status) {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

/**
 * ToolExecutionResult → RunStatus（契约 v2 §11.1）。
 * isError=false → completed；isError=true 且 code 含 abort/cancel → killed；否则 failed。
 * @param {{isError?: boolean, error?: {message?: string, info?: {code?: string}}}} value
 * @returns {RunStatus}
 */
export function mapToolResultStatus(value) {
  const v = value !== null && typeof value === 'object' ? value : {}
  if (v.isError !== true) return 'completed'
  const code = typeof v.error?.info?.code === 'string'
    ? v.error.info.code
    : typeof v.error?.code === 'string' ? v.error.code : ''
  const normalized = code.toLowerCase()
  if (normalized.includes('abort') || normalized.includes('cancel')) return 'killed'
  return 'failed'
}
