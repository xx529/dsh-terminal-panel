/**
 * panel.mjs — RPC 业务装配（`panel.hello` / `panel.poll` / `panel.kill`）。
 *
 * 契约 v2：§4.2（方法/信封）、§4.3（帧预算）、§4.4（错误码）、§5.1/§5.2（数据模型与来源映射）、
 *          §8（降级矩阵）、§11.1（纯函数）。
 *
 * 只依赖注入的 `ctx` 与服务句柄，不 import 任何 DSH 包，可用 mock ctx 在 node 里跑
 * （scripts/smoke-host.mjs）。
 */

import { createBashCapture, wrapShellExecute } from './capture-bash.mjs'
import { collectJobRuns, killJobRun } from './capture-jobs.mjs'
import { collectTerminalRuns, killTerminalRun } from './capture-terminals.mjs'
import { classifyTool, isBackgroundBash, isRunShapedTool } from './classify.mjs'
import { planReads } from './cursors.mjs'
import { boundFrameDetailed, buildPollFrame } from './frame.mjs'
import { MAX_RESPONSE_BYTES } from './route.mjs'
import { createRunStore } from './store.mjs'
import { markActivity, mergeSessionTree, scopeOf, treeHealth } from './tree.mjs'

/** 协议版本。 */
export const PROTOCOL = 1

/** 契约 §9 默认配置。 */
export const DEFAULT_CONFIG = Object.freeze({
  pollHintMs: 250,
  maxFrameBytes: 65536,
  maxRuns: 32,
  completedLimit: 50,
  completedRetainMs: 300000,
  scrollbackLines: 600,
  terminalPageLines: 400,
  initialTailBytes: 32768,
  collapseDelayMs: 10000,
  bashCapture: true,
})

/** 夹取数字配置。 */
function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * 合并并夹取配置。
 * @param {Record<string, unknown>} [raw]
 * @returns {typeof DEFAULT_CONFIG}
 */
export function resolveConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const config = { ...DEFAULT_CONFIG }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    const value = input[key]
    if (value !== undefined && typeof value === typeof DEFAULT_CONFIG[key]) config[key] = value
  }
  config.pollHintMs = clampNumber(config.pollHintMs, 150, 300, DEFAULT_CONFIG.pollHintMs)
  config.maxFrameBytes = clampNumber(config.maxFrameBytes, 1024, 1048576, DEFAULT_CONFIG.maxFrameBytes)
  config.maxRuns = Math.round(clampNumber(config.maxRuns, 1, 64, DEFAULT_CONFIG.maxRuns))
  config.completedLimit = Math.round(clampNumber(config.completedLimit, 1, 200, DEFAULT_CONFIG.completedLimit))
  config.terminalPageLines = Math.round(clampNumber(config.terminalPageLines, 1, 2000, DEFAULT_CONFIG.terminalPageLines))
  config.initialTailBytes = Math.round(clampNumber(config.initialTailBytes, 0, 1048576, DEFAULT_CONFIG.initialTailBytes))
  return config
}

/**
 * SourceState 简写。
 * @param {boolean} available
 * @param {string} [reason]
 * @param {'missing-service'|'denied'|'error'} [code]
 */
export function sourceState(available, reason, code = 'missing-service') {
  return available ? { available: true } : { available: false, reason: reason ?? 'unavailable', code }
}

/**
 * 创建面板实例。
 * @param {{ctx: any, config?: Record<string, unknown>, now?: () => number, logger?: any}} options
 */
export function createPanel(options) {
  const ctx = options.ctx
  const config = resolveConfig(options.config)
  const now = typeof options.now === 'function' ? options.now : () => Date.now()
  const logger = options.logger

  const store = createRunStore({
    completedLimit: config.completedLimit,
    retainCompletedMs: config.completedRetainMs,
    now,
  })
  const bashCapture = createBashCapture({ store, config, now, logger })

  /** 会话树缓存：listDescendants 会走 sessionQuery，250ms 轮询不该每帧重扫。 */
  const treeCache = new Map()
  const TREE_TTL_MS = 1500

  /** 采集器报告的可用性覆盖（null → 用服务探测结果）。 */
  const availabilityOverride = new Map()
  /** shell tee 状态。 */
  const tee = { attempted: false, ok: false, restore: undefined }
  /** start() 注册的清理函数。 */
  const cleanups = []
  let started = false

  /** 探测可选服务（`ctx.get` 缺失/抛错都只降级）。 */
  function service(name) {
    try {
      return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  /** 当前可用性。 */
  function availability() {
    const bashService = service('tools') !== undefined || service('shell') !== undefined
    const bash = availabilityOverride.get('bash')
    const jobs = availabilityOverride.get('jobs')
    const terminals = availabilityOverride.get('terminals')
    const tree = availabilityOverride.get('tree')
    let bashLive
    if (!config.bashCapture) {
      bashLive = sourceState(false, 'bashCapture disabled', 'error')
    } else if (tee.ok) {
      bashLive = sourceState(true)
    } else if (service('shell') === undefined) {
      bashLive = sourceState(false, 'shell service unavailable', 'missing-service')
    } else {
      bashLive = sourceState(false, 'no-shell-handle', 'error')
    }
    return {
      bash: bash ?? sourceState(bashService),
      bashLive,
      jobs: jobs ?? sourceState(service('jobs') !== undefined, 'jobs service unavailable'),
      terminals: terminals ?? sourceState(service('terminals') !== undefined, 'terminals service unavailable'),
      tree: tree ?? sourceState(service('subagents') !== undefined, 'subagents service unavailable'),
    }
  }

  /**
   * 解析当前可见会话树。
   * @param {string} rootSessionId
   * @returns {Promise<{sessions: object[], rootAgent: any, degradation: string|undefined}>}
   */
  async function resolveSessions(rootSessionId) {
    const cached = treeCache.get(rootSessionId)
    if (cached !== undefined && now() - cached.at < TREE_TTL_MS) return cached.value
    const agents = service('agents')
    const subagents = service('subagents')
    const teams = service('agentTeams')
    let rootAgent
    if (agents !== undefined && typeof agents.get === 'function') {
      try {
        rootAgent = agents.get(rootSessionId)
      } catch {
        rootAgent = undefined
      }
    }
    /** @type {object[]} */
    let descendants = []
    /** @type {object[]} */
    let members = []
    let degradation

    if (subagents !== undefined && typeof subagents.listDescendants === 'function') {
      try {
        const list = await subagents.listDescendants(rootSessionId)
        if (Array.isArray(list)) descendants = list
      } catch (error) {
        degradation = 'subagents unavailable'
        logger?.warn?.(`[terminal-panel] listDescendants failed: ${error?.message ?? error}`)
      }
    } else {
      degradation = 'subagents service unavailable'
    }

    if (teams !== undefined && typeof teams.listMembers === 'function' && rootAgent !== undefined) {
      try {
        const list = teams.listMembers(rootAgent)
        if (Array.isArray(list)) members = list
      } catch {
        // 非 Agent Team 会话会抛 TEAM_NOT_MEMBER —— 属正常，不降级。
        members = []
      }
    }

    const sessions = mergeSessionTree({
      rootSessionId,
      rootName: typeof rootAgent?.name === 'string' && rootAgent.name.length > 0 ? rootAgent.name : '当前会话',
      descendants,
      members,
    })
    if (degradation === undefined) {
      const health = treeHealth(descendants)
      if (!health.healthy) degradation = `${health.diagnostics} subagent branch(es) unavailable`
    }
    if (degradation !== undefined) {
      availabilityOverride.set('tree', sourceState(false, degradation, 'denied'))
    } else {
      availabilityOverride.delete('tree')
    }
    const resolved = { sessions, rootAgent, degradation }
    treeCache.set(rootSessionId, { at: now(), value: resolved })
    return resolved
  }

  /**
   * 把 Run 的 agent 引用补全成会话树里的显示名/角色（不按名字猜归属，只用 ownerSessionId）。
   * @param {object} run
   * @param {object[]} sessions
   */
  function enrichAgent(run, sessions) {
    const scope = scopeOf(sessions, run.ownerSessionId)
    if (scope === undefined) {
      return { ...run, agent: { id: run.ownerSessionId, name: run.ownerSessionId, role: 'unknown' } }
    }
    const role = scope.role === 'root' ? 'lead' : scope.role
    return {
      ...run,
      agent: { id: scope.sessionId, name: scope.displayName, role },
      ...(scope.accent !== 'none' ? { accent: scope.accent } : {}),
    }
  }

  /**
   * 记录一次工具调用（`tools/execute` waterfall 的旁路；必须原样 `return next()`）。
   * @param {any} exec
   */
  function recordToolCall(exec) {
    if (exec === null || typeof exec !== 'object') return
    const sessionId = exec.agent?.id
    // exec.agent 可选：缺失不猜归属（契约 v2 §5.2）。
    if (typeof sessionId !== 'string' || sessionId.length === 0) return
    if (!isRunShapedTool(exec.name)) return
    const classified = classifyTool(exec.name, exec.arguments)
    if (classified === null) return
    if (classified.kind === 'bash' && isBackgroundBash(exec.arguments)) return
    if (classified.kind !== 'bash') return // terminal 由 terminals 服务覆盖
    const callId = typeof exec.callId === 'string' ? exec.callId : undefined
    if (callId === undefined) return
    bashCapture.noteToolCall({
      callId,
      sessionId,
      name: exec.name,
      command: classified.command,
      cwd: classified.cwd,
      startedAt: now(),
    })
  }

  /**
   * 注册监听 + 尝试 shell tee。
   * @returns {() => void} 清理函数
   */
  function start() {
    if (started) return () => {}
    started = true
    const disposers = []

    const on = (event, listener) => {
      try {
        const dispose = ctx.on(event, listener)
        disposers.push(typeof dispose === 'function' ? dispose : () => {})
      } catch (error) {
        logger?.warn?.(`[terminal-panel] ctx.on(${event}) failed:`, error?.message ?? error)
      }
    }

    // b) 始终记录的幽灵 Run（waterfall：只记录、不改 exec、必须原样 next()）。
    on('tools/execute', async (exec, next) => {
      try {
        recordToolCall(exec)
      } catch (error) {
        logger?.warn?.('[terminal-panel] tools/execute observer failed:', error?.message ?? error)
      }
      return await next()
    })

    // c) 终态输出（emit/observer，不污染链）。
    on('tools/result', (exec, result) => {
      try {
        bashCapture.noteToolResult(exec, result)
      } catch (error) {
        logger?.warn?.('[terminal-panel] tools/result observer failed:', error?.message ?? error)
      }
    })

    // a) best-effort tee：失败只降级 availability.bashLive，绝不影响工具链。
    attemptShellTee()

    const cleanup = () => {
      for (const dispose of disposers.splice(0)) {
        try {
          dispose()
        } catch {
          // 忽略
        }
      }
      if (tee.restore !== undefined) {
        try {
          tee.restore()
        } catch {
          // 忽略
        }
      }
      tee.restore = undefined
      tee.ok = false
      tee.attempted = false
      bashCapture.dispose()
      started = false
    }
    cleanups.push(cleanup)
    return cleanup
  }

  /** 尝试（一次）装饰 `ctx.shell.execute`。 */
  function attemptShellTee() {
    if (tee.attempted || config.bashCapture !== true) return
    tee.attempted = true
    const shell = service('shell')
    if (shell === undefined) return
    const restore = wrapShellExecute(
      shell,
      (execution, spec) => {
        try {
          bashCapture.attachExecution(execution, spec)
          tee.ok = true
        } catch (error) {
          logger?.warn?.('[terminal-panel] bash attach failed:', error?.message ?? error)
        }
      },
      logger,
    )
    if (typeof restore !== 'function') {
      tee.ok = false
      return
    }
    tee.restore = restore
    // 包装本身成功 ≠ 抓到了句柄；availability.bashLive 在第一次 attachExecution 后才置 true。
    tee.ok = false
  }

  /** `panel.hello`。 */
  async function hello() {
    return {
      ok: true,
      value: {
        protocol: PROTOCOL,
        hostTime: now(),
        capabilities: {
          bash: service('tools') !== undefined || service('shell') !== undefined,
          jobs: service('jobs') !== undefined,
          terminals: service('terminals') !== undefined,
          tree: service('subagents') !== undefined || service('agents') !== undefined,
        },
        limits: {
          maxFrameBytes: config.maxFrameBytes,
          maxRuns: config.maxRuns,
          pollHintMs: config.pollHintMs,
        },
        availability: availability(),
      },
    }
  }

  /**
   * `panel.poll`。
   * @param {any} params
   */
  async function poll(params) {
    const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : ''
    if (sessionId.length === 0) {
      return { ok: false, error: { code: 'bad-request', message: 'sessionId is required' } }
    }
    const cursors = params?.cursors !== null && typeof params?.cursors === 'object' ? params.cursors : {}
    const maxRuns = Number.isSafeInteger(params?.maxRuns) && params.maxRuns > 0
      ? Math.min(params.maxRuns, config.maxRuns)
      : config.maxRuns
    const maxBytes = Number.isFinite(params?.maxBytes) && params.maxBytes > 0
      ? Math.min(params.maxBytes, config.maxFrameBytes)
      : config.maxFrameBytes
    const focusRunId = typeof params?.focusRunId === 'string' ? params.focusRunId : undefined
    const includeCompleted = params?.includeCompleted !== false

    store.mergeClientCursors(cursors)
    // 第二次 tee 尝试：覆盖 service 晚于插件加载的情况。
    attemptShellTee()

    const { sessions, rootAgent } = await resolveSessions(sessionId)
    if (rootAgent === undefined) {
      availabilityOverride.set('terminals', sourceState(false, 'session has no live agent', 'denied'))
      availabilityOverride.set('tree', sourceState(false, 'session has no live agent', 'denied'))
    } else {
      availabilityOverride.delete('tree')
    }

    const sessionIds = sessions.map((scope) => scope.sessionId)
    const jobs = service('jobs')
    const terminals = service('terminals')
    const agents = service('agents')

    // 1) 发现层：只登记元信息 —— 新出现的 job/terminal 必须先进入 store，才能排到预算。
    if (jobs !== undefined) {
      const discovery = collectJobRuns({ jobs, sessionIds, store, config, now, budgets: {}, logger })
      if (!discovery.available) availabilityOverride.set('jobs', sourceState(false, discovery.reason, 'denied'))
    }
    if (terminals !== undefined && agents !== undefined) {
      const discovery = collectTerminalRuns({
        terminals,
        agents,
        scopes: sessions,
        store,
        config,
        now,
        budgets: {},
        logger,
      })
      if (!discovery.available) availabilityOverride.set('terminals', sourceState(false, discovery.reason, 'denied'))
    }

    // 2) 预算：focus → running（startedAt 升序）→ 终态；每 Run ≤ min(16 KiB, 剩余)。
    const plan = planReads(store.all(), cursors, {
      maxBytes: config.maxFrameBytes,
      maxRuns,
      ...(focusRunId !== undefined ? { focusRunId } : {}),
    })

    // 3) 读取层：job / terminal / bash 增量（均在预算内）。
    if (jobs !== undefined) {
      const result = collectJobRuns({ jobs, sessionIds, store, config, now, budgets: plan.perRunBudget, logger })
      if (result.available) availabilityOverride.delete('jobs')
      else availabilityOverride.set('jobs', sourceState(false, result.reason, 'denied'))
    }
    if (terminals !== undefined && agents !== undefined) {
      const result = collectTerminalRuns({
        terminals,
        agents,
        scopes: sessions,
        store,
        config,
        now,
        budgets: plan.perRunBudget,
        logger,
      })
      if (result.available) availabilityOverride.delete('terminals')
      else availabilityOverride.set('terminals', sourceState(false, result.reason, 'denied'))
    }
    for (const record of store.all()) {
      if (record.kind !== 'bash') continue
      const budget = plan.perRunBudget[record.runId]
      if (!Number.isFinite(budget) || budget <= 0) continue
      try {
        bashCapture.readRun(record.runId, { total: budget })
      } catch (error) {
        logger?.warn?.(`[terminal-panel] bash read failed for ${record.runId}:`, error?.message ?? error)
      }
    }

    // 4) 组装帧
    const entries = store.takeEntries({
      includeCompleted,
      maxRuns,
      now: now(),
      ...(focusRunId !== undefined ? { focusRunId } : {}),
    })
    for (const entry of entries) entry.run = enrichAgent(entry.run, sessions)
    const activeOwners = new Set(store.all().map((record) => record.ownerSessionId))
    const sessionsWithActivity = markActivity(sessions, activeOwners)
    const revision = store.bumpRevision()
    const frame = buildPollFrame(
      {
        revision,
        serverTime: now(),
        sessionId,
        sessions: sessionsWithActivity,
        availability: availability(),
        removed: store.drainRemoved(),
        entries,
      },
      cursors,
      { maxBytes },
    )
    // Tier2 用同一 maxFrameBytes 的整帧 JSON 兜底；同时留出 Tier3(262144) 余量，
    // 保证 Tier3 永不触发（否则 route 层回退游标时，本层已提交的游标会跳过未交付字节）。
    const tier2Limit = Math.min(config.maxFrameBytes, MAX_RESPONSE_BYTES - 2048)
    const bounded = boundFrameDetailed(frame.value, tier2Limit)
    // 被预算丢掉的 Run 退回注册表（游标不推进 → 下轮续读，绝不丢字节）。
    const droppedIds = new Set([...frame.dropped, ...bounded.droppedRunIds])
    if (droppedIds.size > 0) {
      const kept = []
      const dropped = []
      for (const entry of entries) {
        if (droppedIds.has(entry.run.runId)) dropped.push(entry)
        else kept.push(entry)
      }
      store.restore(dropped)
      store.commitCursors(kept)
    } else {
      store.commitCursors(entries)
    }
    store.prune(now())
    return { ok: true, value: bounded.value }
  }

  /**
   * `panel.kill`（唯一写操作）。
   * @param {any} params
   */
  async function kill(params) {
    const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : ''
    const runId = typeof params?.runId === 'string' ? params.runId : ''
    if (sessionId.length === 0 || runId.length === 0) {
      return { ok: false, error: { code: 'bad-request', message: 'sessionId and runId are required' } }
    }
    const record = store.get(runId)
    if (record === undefined) {
      return { ok: false, error: { code: 'run-not-found', message: 'run is not visible' } }
    }
    const { sessions } = await resolveSessions(sessionId)
    if (scopeOf(sessions, record.ownerSessionId) === undefined) {
      // 越权/不可见：不泄漏存在性。
      return { ok: false, error: { code: 'run-not-found', message: 'run is not visible' } }
    }
    let outcome
    if (record.kind === 'job') {
      outcome = killJobRun({ jobs: service('jobs'), run: serializeForKill(record), store, logger })
    } else if (record.kind === 'terminal') {
      const agents = service('agents')
      let agent
      try {
        agent = agents?.get(record.ownerSessionId)
      } catch {
        agent = undefined
      }
      outcome = await killTerminalRun({ terminals: service('terminals'), run: serializeForKill(record), agent, logger })
    } else {
      outcome = bashCapture.killRun(runId)
    }
    if (outcome === 'unsupported') {
      return { ok: false, error: { code: 'run-not-stoppable', message: 'this run cannot be stopped' } }
    }
    return { ok: true, value: { outcome } }
  }

  /**
   * kill 只需要 runId/owner/handle；store 记录可直接用。
   * @param {object} record
   */
  function serializeForKill(record) {
    return { runId: record.runId, ownerSessionId: record.ownerSessionId, handle: record.handle ?? {} }
  }

  /** 方法分派。 */
  async function handleRpc(method, params) {
    switch (method) {
      case 'panel.hello':
        return hello()
      case 'panel.poll':
        return poll(params)
      case 'panel.kill':
        return kill(params)
      default:
        return { ok: false, error: { code: 'unknown-method', message: `unknown method: ${String(method)}` } }
    }
  }

  /** 释放全部采集器/监听/包装（幂等）。 */
  function dispose() {
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup()
      } catch (error) {
        logger?.warn?.('[terminal-panel] cleanup failed:', error?.message ?? error)
      }
    }
  }

  return {
    store,
    config,
    now,
    service,
    availability,
    start,
    recordToolCall,
    hello,
    poll,
    kill,
    handleRpc,
    dispose,
    /** 测试/诊断用。 */
    bashCapture,
    teeState() {
      return { attempted: tee.attempted, ok: tee.ok, wrapped: tee.restore !== undefined }
    },
  }
}
