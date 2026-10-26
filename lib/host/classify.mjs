/**
 * classify.mjs — 工具名 + 参数 → RunKind（纯函数，无 DSH / React 依赖）。
 *
 * 契约：docs/architecture/contract.md §11.1
 *   name 含 'terminal'      → terminal
 *   name ∈ {bash,pwsh,shell,exec} → bash
 *   以 'job_' 开头          → job
 *   其余                    → null
 *
 * 注意（与契约的实现级偏差，已回报 Lead）：
 *   `job_*` 是**管理类工具**（job_output / job_list / job_kill），它们不代表一次
 *   新的运行；真正「后台任务」的 Run 来自 `ctx.jobs.list()`。因此 classifyTool 仍按
 *   契约映射为 'job'，但「是否创建幽灵 Run」由 isRunShapedTool 把关——只有
 *   bash 系与 terminal 系工具会创建 Run。
 */

/** bash 系工具名（精确匹配）。 */
export const BASH_TOOL_NAMES = Object.freeze(['bash', 'pwsh', 'shell', 'exec'])

/** job 管理类前缀。 */
const JOB_TOOL_PREFIX = 'job_'

/**
 * 从已解析的工具参数里取命令行与工作目录。
 * @param {unknown} args 工具参数
 * @returns {{command: string|undefined, cwd: string|undefined}}
 */
/** description 最大字符数（代码点；防止帧预算/布局被长描述撑坏）。 */
const DESCRIPTION_MAX_CHARS = 200

/**
 * 规范化工具参数里的 `description`（只取用户可读的说明文本）：
 * - 非字符串/空串 → undefined；
 * - trim + 连续空白（含换行/制表）折叠成单个空格（单行化）；
 * - 按**代码点**截断到 ≤200 字符（不会切坏代理对）。
 * @param {unknown} value
 * @returns {string|undefined}
 */
function normalizeDescription(value) {
  if (typeof value !== 'string') return undefined
  const collapsed = value.replace(/\s+/g, ' ').trim()
  if (collapsed.length === 0) return undefined
  const points = [...collapsed]
  if (points.length <= DESCRIPTION_MAX_CHARS) return collapsed
  return points.slice(0, DESCRIPTION_MAX_CHARS).join('')
}

function commandAndCwd(args) {
  const value = args !== null && typeof args === 'object' ? args : {}
  const description = normalizeDescription(value.description)
  return {
    command: typeof value.command === 'string' ? value.command : undefined,
    cwd: typeof value.workdir === 'string'
      ? value.workdir
      : typeof value.cwd === 'string' ? value.cwd : undefined,
    ...(description !== undefined ? { description } : {}),
  }
}

/**
 * 工具名/参数 → RunKind。
 * @param {unknown} name 工具名
 * @param {unknown} args 已解析的工具参数
 * @returns {{kind:'bash'|'job'|'terminal', command?:string, cwd?:string, description?:string}|null}
 */
export function classifyTool(name, args) {
  if (typeof name !== 'string' || name.length === 0) return null
  const { command, cwd, description } = commandAndCwd(args)
  const optional = {
    ...(command !== undefined ? { command } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(description !== undefined ? { description } : {}),
  }
  // 契约顺序：先 terminal，再 job_，再 bash 精确名。
  if (name.toLowerCase().includes('terminal')) return { kind: 'terminal', ...optional }
  if (name.startsWith(JOB_TOOL_PREFIX)) return { kind: 'job', ...optional }
  if (BASH_TOOL_NAMES.includes(name)) return { kind: 'bash', ...optional }
  return null
}

/**
 * 该工具调用是否代表一次**可显示的运行**（会创建/维护 Run）。
 * job_* 只是查询/停止管理调用，不创建 Run。
 * @param {unknown} name 工具名
 * @returns {boolean}
 */
export function isRunShapedTool(name) {
  const classified = classifyTool(name, undefined)
  return classified !== null && classified.kind !== 'job'
}

/**
 * bash 工具是否要求后台运行（`run_in_background: true`）。
 * 后台 bash 的真实 Run 由 `ctx.jobs` 提供，不再创建幽灵 Run。
 * @param {unknown} args 工具参数
 * @returns {boolean}
 */
export function isBackgroundBash(args) {
  const value = args !== null && typeof args === 'object' ? args : {}
  return value.run_in_background === true
}

/** 三种 RunKind 的列头标签（Host 侧只给类型，最终文案由 client 本地化）。 */
export const RUN_TITLES = Object.freeze({
  bash: 'Bash',
  job: '后台任务',
  terminal: '终端',
})
