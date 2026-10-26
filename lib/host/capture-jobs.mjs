/**
 * capture-jobs.mjs — 后台任务采集（`ctx.jobs`）。
 *
 * 契约 v2 §5.2：
 *  - 每个可见会话 `jobs.list(sessionId)`，按 jobId 去重合并；
 *  - `jobs.readAt(jobId, cursor, ownerSessionId)` —— **caller 一律传目标会话 sessionId**
 *    （不是当前 root；围栏是 owner，传错会 throw）；
 *  - `next` 当不透明整数游标；`from` 落在 chunk 中间会重发整 chunk → 由 cursors.mjs
 *    按 `chunk.at + byteLength` 去重；
 *  - `lossy:true` 不是错误，透传给客户端。
 *
 * 前台 bash 的 transient job（bash 工具 promoteOnTimeout）会与 `bash:*` Run 重复：
 * 用「owner + command + startedAt 窗口」识别后跳过 job Run，避免同一命令出现两列。
 */

import { limitDelta, mergeJobRead, splitChunks } from './cursors.mjs'
import { isTerminalStatus, mapJobStatus } from './status.mjs'

/** job Run 的 runId（kind:sourceId）。 */
export function jobRunId(jobId) {
  return `job:${jobId}`
}

/** 前台 bash 与 transient job 的匹配窗口（ms）。 */
const DEDUPE_WINDOW_MS = 8000

/**
 * 找出与该 job 对应的前台 bash Run（同一个命令的同一次执行）。
 * @param {any} store
 * @param {{label?: string, owner?: string, startedAt?: number}} view
 * @returns {object|undefined}
 */
export function findForegroundBash(store, view) {
  if (typeof view?.label !== 'string' || typeof view?.owner !== 'string') return undefined
  const startedAt = Number.isFinite(view.startedAt) ? view.startedAt : 0
  for (const record of store.all()) {
    if (record.kind !== 'bash') continue
    if (record.outputMode !== 'final-only') continue
    if (record.ownerSessionId !== view.owner) continue
    if (record.command !== view.label) continue
    if (Math.abs((record.startedAt ?? 0) - startedAt) > DEDUPE_WINDOW_MS) continue
    return record
  }
  return undefined
}

/**
 * 采集所有可见会话的 job（元信息 + 增量输出）。
 * @param {{
 *   jobs: any, sessionIds: string[], store: any, config: any,
 *   now?: () => number, budgets?: Record<string, number>, logger?: any,
 * }} options
 * @returns {{available: boolean, reason?: string, degradedSessions: string[]}}
 */
export function collectJobRuns(options) {
  const jobs = options.jobs
  const store = options.store
  const config = options.config
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const budgets = options.budgets ?? {}
  const sessionIds = Array.isArray(options.sessionIds) ? options.sessionIds : []
  const logger = options.logger
  const degradedSessions = []
  /** @type {Set<string>} 已处理的 jobId（unowned job 会在每个 caller 的 list 里出现一次） */
  const seen = new Set()
  let failures = 0
  let calls = 0

  for (const sessionId of sessionIds) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) continue
    let views
    calls += 1
    try {
      views = jobs.list(sessionId)
    } catch (error) {
      failures += 1
      degradedSessions.push(sessionId)
      logger?.warn?.(`[terminal-panel] jobs.list failed for ${sessionId}:`, error?.message ?? error)
      continue
    }
    if (!Array.isArray(views)) continue
    for (const view of views) {
      if (view === null || typeof view !== 'object') continue
      const jobId = typeof view.id === 'string' ? view.id : undefined
      if (jobId === undefined) continue
      if (seen.has(jobId)) continue
      seen.add(jobId)

      // 与前台 bash 重复的 transient job：跳过（bash tee / final-only 已覆盖）。
      if (view.kind === 'bash' && findForegroundBash(store, view) !== undefined) continue

      const runId = jobRunId(jobId)
      const mapped = mapJobStatus(view.status)
      const ownerSessionId = typeof view.owner === 'string' ? view.owner : sessionId
      const startedAt = Number.isFinite(view.startedAt) ? view.startedAt : now()
      const finishedAt = Number.isFinite(view.finishedAt) ? view.finishedAt : undefined
      const terminalStatus = isTerminalStatus(mapped.status)

      store.upsert({
        runId,
        kind: 'job',
        ownerSessionId,
        title: '后台任务',
        command: typeof view.label === 'string' ? view.label : undefined,
        startedAt,
        status: mapped.status,
        stopping: mapped.stopping,
        outputMode: 'live',
        progress: typeof view.progress === 'string' ? view.progress : undefined,
        detail: typeof view.detail === 'string' ? view.detail : null,
        exitCode: null,
        handle: { jobId },
        stoppable: !terminalStatus,
        totals: { job: Number.isFinite(view.output?.total) ? view.output.total : 0 },
        ...(finishedAt !== undefined ? { finishedAt } : {}),
      })

      const budget = Number.isFinite(budgets[runId]) ? budgets[runId] : 0
      if (budget <= 0) continue
      const total = Number.isFinite(view.output?.total) ? view.output.total : 0
      const prev = store.nextReadCursor(runId, 'job') ?? 0
      if (total <= prev) continue
      try {
        const read = jobs.readAt(jobId, prev, sessionId)
        const at = now()
        const merged = mergeJobRead(prev, read, at)
        const chunks = splitChunks(merged.chunks, 16384)
        const limited = limitDelta({ ...merged, chunks }, budget)
        if (limited.delta.chunks.length > 0 || limited.delta.lossy) {
          store.setOutput(runId, 'job', limited.delta)
        }
      } catch (error) {
        logger?.warn?.(`[terminal-panel] jobs.readAt failed for ${jobId}:`, error?.message ?? error)
        // 单条 job 读取失败只降级该 job（不抛、不影响其它）。
        store.upsert({ runId, detail: `read failed: ${error?.message ?? error}` })
      }
    }
  }

  if (calls > 0 && failures === calls) {
    return { available: false, reason: 'jobs service rejected every session', degradedSessions }
  }
  if (failures > 0) return { available: true, reason: `${failures}/${calls} sessions degraded`, degradedSessions }
  return { available: true, degradedSessions }
}

/**
 * 停止一个 job。
 * @param {{jobs: any, run: object, store: any, logger?: any}} options
 * @returns {'requested'|'already-finished'|'unsupported'}
 */
export function killJobRun(options) {
  const { jobs, run, store, logger } = options
  const jobId = run?.handle?.jobId
  if (typeof jobId !== 'string') return 'unsupported'
  const caller = typeof run.ownerSessionId === 'string' ? run.ownerSessionId : undefined
  if (caller === undefined) return 'unsupported'
  try {
    const outcome = jobs.kill(jobId, caller, 'cancelled by the user')
    if (outcome === 'requested') {
      store.upsert({ runId: run.runId, stopping: true, status: 'running' })
      return 'requested'
    }
    return 'already-finished'
  } catch (error) {
    logger?.warn?.(`[terminal-panel] jobs.kill failed for ${jobId}:`, error?.message ?? error)
    return 'unsupported'
  }
}
