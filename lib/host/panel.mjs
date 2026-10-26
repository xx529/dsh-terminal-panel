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
import {
  collectTerminalRuns,
  createTerminalEventCapture,
  discoverTerminalCandidates,
  killTerminalRun,
  terminalRunId,
} from './capture-terminals.mjs'
import { classifyTool, isBackgroundBash, isRunShapedTool } from './classify.mjs'
import { planReads } from './cursors.mjs'
import { boundFrameDetailed, buildPollFrame, splitDeltaAtBytes } from './frame.mjs'
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
  // scout T30 §2.3 FACT：terminalController 是「浏览器/侧栏终端」独立注册表，
  // 不返回 terminal_open 的 agent PTY；因此默认关闭，仅作为可选展示（source 'sidebar'）。
  sidebarTerminals: false,
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
  /** v7 §5.2 第三级发现：terminal_* 工具事件旁路（meta-only + inputs + 终态）。 */
  const terminalCapture = createTerminalEventCapture({ store, now, logger })

  /** 会话树缓存：listDescendants 会走 sessionQuery，250ms 轮询不该每帧重扫。 */
  const treeCache = new Map()
  const TREE_TTL_MS = 1500

  /** 连续被整条丢弃的帧数（H1-c 不变量：同一 Run 不得连续 3 帧被丢且零字节交付）。 */
  const dropStreak = new Map()

  /**
   * v7/v9：从 tools/execute 缓存的 Agent 对象（terminals.* 按身份比较，必须是 registry 里的同一对象）。
   * sessionId → { ref: WeakRef<Agent>, id }；每帧用 `agents.get(id)` 收敛成 registry 引用。
   */
  const terminalOwners = new Map()
  /** 本帧 owner 解析统计（每 poll 重置；进入 diagnostics，供真机一次定位）。 */
  function freshOwnerStats() {
    return {
      cached: 0,
      resolvedRegistry: 0,
      resolvedCache: 0,
      identityMismatch: 0,
      none: 0,
    }
  }
  let ownerStats = freshOwnerStats()

  /**
   * 缓存一次 tools/execute 看到的 Agent（WeakRef，避免阻止 GC）。
   * @param {unknown} agent
   */
  function rememberTerminalOwner(agent) {
    if (agent === null || typeof agent !== 'object') return
    if (typeof WeakRef !== 'function') return
    const id = typeof agent.id === 'string'
      ? agent.id
      : typeof agent.session?.header?.id === 'string' ? agent.session.header.id : undefined
    if (typeof id !== 'string' || id.length === 0) return
    try {
      terminalOwners.set(id, { ref: new WeakRef(agent), id })
    } catch {
      // 忽略
    }
  }

  /**
   * 每个可见会话的 term owner 解析（v9 优先级）：
   *   ① tools/execute 缓存对象 → 用 `agents.get(id)` 收敛成 registry 同一引用；
   *   ② `agents.get(sessionId)`；
   *   ③ 无（meta-only 降级）。
   * `agents` 服务不可见时退化为「直接使用缓存原对象」（terminals 自身会做 identity 校验，
   * 失败只是 list 为空，不会抛）；identity 不匹配只计数、不抛。
   * @param {object[]} scopes
   * @param {any} agentsService
   * @returns {Map<string, {owner: object, source: string}>}
   */
  function resolveOwnerPlan(scopes, agentsService) {
    const plan = new Map()
    for (const [sessionKey, entry] of [...terminalOwners.entries()]) {
      let live
      try {
        live = entry?.ref?.deref?.()
      } catch {
        live = undefined
      }
      if (live === undefined) terminalOwners.delete(sessionKey)
    }
    ownerStats.cached = terminalOwners.size
    for (const scope of Array.isArray(scopes) ? scopes : []) {
      const sessionId = typeof scope?.sessionId === 'string' ? scope.sessionId : undefined
      if (sessionId === undefined) continue
      let cached
      const entry = terminalOwners.get(sessionId)
      if (entry !== undefined) {
        try {
          cached = entry.ref.deref()
        } catch {
          cached = undefined
        }
        if (cached === undefined) terminalOwners.delete(sessionId)
      }
      let registry
      try {
        registry = typeof agentsService?.get === 'function' ? agentsService.get(sessionId) : undefined
      } catch {
        registry = undefined
      }
      if (registry !== undefined) {
        ownerStats.resolvedRegistry += 1
        if (cached === undefined) plan.set(sessionId, { owner: registry, source: 'registry' })
        else if (cached === registry) plan.set(sessionId, { owner: registry, source: 'cache-confirmed' })
        else {
          // exec.agent 可能是包装对象或旧引用：以 registry 引用为准（identity 才有效）。
          ownerStats.identityMismatch += 1
          plan.set(sessionId, { owner: registry, source: 'cache-mismatch' })
        }
        continue
      }
      if (cached !== undefined) {
        ownerStats.resolvedCache += 1
        plan.set(sessionId, { owner: cached, source: 'cache-unverified' })
        continue
      }
      ownerStats.none += 1
    }
    return plan
  }
  /** 会话显示名缓存（Agent 没有 name 字段；名字只能来自 sessionTitle / Team / subagent label）。 */
  const sessionNameCache = new Map()
  const SESSION_NAME_TTL_MS = 30000

  /** 采集器报告的可用性覆盖（null → 用服务探测结果）。 */
  const availabilityOverride = new Map()
  /** shell tee 状态。 */
  const tee = { attempted: false, ok: false, restore: undefined }
  /** start() 注册的清理函数。 */
  const cleanups = []
  let started = false

  /** 可选服务访问记录（v9 诊断：'get' | 'get-loose' | 'property' | 'missing'）。 */
  const serviceAccess = new Map()

  /**
   * 可选服务获取（v9 加固）。
   *
   * Cordis 里 `ctx.get(name)` 是「无 inject 读取」API（`ReflectService.get`，strict 只认 active fiber），
   * 但仍可能因上下文隔离/服务未激活返回 undefined；属性访问 `ctx[name]` 在未 inject 时会直接抛
   * `cannot get property ... without inject`。这里三路依次尝试，任一失败都只降级、绝不抛：
   *   1) `ctx.get(name)`（官方 optional 读取）
   *   2) `ctx.reflect.get(name, false)`（宽松读取，允许未 active 的实现）
   *   3) `ctx[name]`（需要 inject；抛错则捕获）
   */
  function service(name) {
    if (typeof name !== 'string' || name.length === 0) return undefined
    const ctxRef = ctx
    try {
      if (typeof ctxRef?.get === 'function') {
        const value = ctxRef.get(name)
        if (value !== undefined) {
          serviceAccess.set(name, 'get')
          return value
        }
      }
    } catch {
      // 继续尝试其它路径
    }
    try {
      const reflectService = ctxRef?.reflect
      const reflectGet = reflectService?.get
      if (typeof reflectGet === 'function') {
        const value = reflectGet.call(reflectService, name, false)
        if (value !== undefined) {
          serviceAccess.set(name, 'get-loose')
          return value
        }
      }
    } catch {
      // 继续尝试属性访问
    }
    try {
      const value = ctxRef[name]
      if (value !== undefined) {
        serviceAccess.set(name, 'property')
        return value
      }
    } catch {
      // 未 inject → 降级
    }
    serviceAccess.set(name, 'missing')
    return undefined
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
      terminals: terminals ?? sourceState(
        service('terminals') !== undefined
        || (config.sidebarTerminals === true && service('terminalController') !== undefined),
        'terminals unavailable',
      ),
      tree: tree ?? sourceState(service('subagents') !== undefined, 'subagents service unavailable'),
    }
  }

  /**
   * 读 sessionTitle（防御式；取不到返回 undefined，不猜）。
   * @param {string} sessionId
   * @returns {string|undefined}
   */
  function lookupSessionTitle(sessionId) {
    const titles = service('sessionTitle')
    const sessions = service('sessions')
    let session
    try {
      session = typeof sessions?.get === 'function' ? sessions.get(sessionId) : undefined
    } catch {
      session = undefined
    }
    if (session === undefined || typeof titles?.get !== 'function') return undefined
    try {
      const snapshot = titles.get(session)
      const title = typeof snapshot?.title === 'string' ? snapshot.title.trim() : ''
      return title.length > 0 ? title : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 会话显示名：sessionTitle → （调用方已知的 Team name / subagent label）→ 兜底。
   * Agent 没有 `name` 字段（scout §0 FACT），所以这里绝不读 agent.name。
   * @param {string} sessionId
   * @param {string} [fallback]
   * @returns {string}
   */
  function resolveDisplayName(sessionId, fallback) {
    const cached = sessionNameCache.get(sessionId)
    if (cached !== undefined && now() - cached.at < SESSION_NAME_TTL_MS) return cached.name
    const title = lookupSessionTitle(sessionId)
    // 兜底绝不能暴露 sessionId 长串（AGENTS §4.18 / ui-spec v5）。
    const name = title ?? fallback ?? '—'
    sessionNameCache.set(sessionId, { at: now(), name })
    return name
  }

  /**
   * rootAgent 缺失时找「同一 Team 的任一 live Agent」作为 listMembers 的合法凭据。
   * @param {any} agentsService
   * @param {any} teamsService
   * @param {string} rootSessionId
   * @returns {object|undefined}
   */
  function pickTeamAnchor(agentsService, teamsService, rootSessionId) {
    let list = []
    try {
      list = typeof agentsService?.list === 'function' ? agentsService.list() : []
    } catch {
      list = []
    }
    if (!Array.isArray(list)) return undefined
    for (const agent of list) {
      if (agent === null || typeof agent !== 'object') continue
      try {
        const membership = typeof teamsService?.tryMembership === 'function'
          ? teamsService.tryMembership(agent)
          : undefined
        if (membership?.root?.id === rootSessionId) return agent
      } catch {
        // tryMembership 不抛；membership 会抛 —— 都忽略
      }
      try {
        if (agent?.session?.header?.parentSession === rootSessionId) return agent
      } catch {
        // 忽略
      }
    }
    return undefined
  }

  /**
   * 仍在世的 terminal owner 会话 id（WeakRef deref 成功）。
   * @returns {string[]}
   */
  function aliveTerminalOwnerIds() {
    const ids = []
    for (const [sessionId, entry] of terminalOwners) {
      let alive
      try {
        alive = entry?.ref?.deref?.()
      } catch {
        alive = undefined
      }
      if (alive === undefined) {
        terminalOwners.delete(sessionId)
        continue
      }
      ids.push(sessionId)
    }
    return ids
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

    if (teams !== undefined && typeof teams.listMembers === 'function') {
      // rootAgent 缺失时队友会整树缺席（旧守卫缺陷）→ 用任一 live 队友 Agent 作凭据。
      const anchor = rootAgent !== undefined
        ? rootAgent
        : pickTeamAnchor(agents, teams, rootSessionId)
      if (anchor !== undefined) {
        try {
          const list = teams.listMembers(anchor)
          if (Array.isArray(list)) members = list
        } catch {
          // 非 Agent Team 会话会抛 TEAM_NOT_MEMBER —— 属正常，不降级。
          members = []
        }
      }
    }

    // root 名：sessionTitle → Team lead 成员名 → 「当前会话」。
    // （Agent 没有 name 字段，rootAgent?.name 恒 undefined —— scout §0 FACT）
    const rootTitle = lookupSessionTitle(rootSessionId)
    const leadMember = members.find((member) => member?.id === rootSessionId && member?.role === 'lead')
    // 真实 `Agent` 没有 name 字段（scout §0 FACT）；这里仍保留 agent.name 作为**兼容兜底**
    // （mock/测试桩与未来宿主可能提供），真实环境该值恒 undefined、链路继续走 Team/兜底。
    const agentName = typeof rootAgent?.name === 'string' && rootAgent.name.length > 0
      ? rootAgent.name
      : undefined
    const rootName = rootTitle
      ?? agentName
      ?? (typeof leadMember?.name === 'string' && leadMember.name.length > 0
        ? leadMember.name
        : '当前会话')

    const sessions = mergeSessionTree({
      rootSessionId,
      rootName,
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
   * 终端来源可用性：服务存在即 available（meta-only 也算可用），只有完全缺失才 denied。
   * 降级原因写进每帧 diagnostics.terminals.reason（SourceState 的 available:true 不带 reason）。
   * @param {{available: boolean, reason?: string}} result
   */
  function applyTerminalAvailability(result) {
    if (result.available) availabilityOverride.delete('terminals')
    else availabilityOverride.set('terminals', sourceState(false, result.reason ?? 'terminals unavailable', 'missing-service'))
  }

  /**
   * 把 Run 的 agent 引用补全成会话树里的显示名/角色（不按名字猜归属，只用 ownerSessionId）。
   * @param {object} run
   * @param {object[]} sessions
   */
  function enrichAgent(run, sessions) {
    const scope = scopeOf(sessions, run.ownerSessionId)
    if (scope === undefined) {
      // 不在可见树内的会话：尽量用 sessionTitle 命名（不要直接暴露 sessionId）。
      return {
        ...run,
        agent: { id: run.ownerSessionId, name: resolveDisplayName(run.ownerSessionId, '—'), role: 'unknown' },
      }
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
    // scout §3.2 / v9：缓存 tools/execute 看到的 Agent 对象（WeakRef），
    // 真机可能是包装对象 → poll 时再用 agents.get(id) 收敛成 registry 引用。
    rememberTerminalOwner(exec.agent)
    if (!isRunShapedTool(exec.name)) return
    const classified = classifyTool(exec.name, exec.arguments)
    if (classified === null) return
    if (classified.kind === 'terminal') {
      // v7 第三级发现：terminal_open/send/read/close 的事件旁路（不依赖 Agent）。
      terminalCapture.noteToolCall(exec)
      return
    }
    if (classified.kind === 'bash' && isBackgroundBash(exec.arguments)) return
    if (classified.kind !== 'bash') return
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
      try {
        terminalCapture.noteToolResult(exec, result)
      } catch (error) {
        logger?.warn?.('[terminal-panel] terminal tools/result observer failed:', error?.message ?? error)
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
      terminalCapture.dispose()
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
          terminals: service('terminals') !== undefined
            || (config.sidebarTerminals === true && service('terminalController') !== undefined),
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
    // v8：客户端无状态信号。显式 resync:true 优先；`cursors:null` 作为等价语义。
    const hasCursorObject = params?.cursors !== null && typeof params?.cursors === 'object'
    const explicitResync = params?.resync === true || params?.cursors === null
    const cursors = hasCursorObject ? params.cursors : {}
    const maxRuns = Number.isSafeInteger(params?.maxRuns) && params.maxRuns > 0
      ? Math.min(params.maxRuns, config.maxRuns)
      : config.maxRuns
    const maxBytes = Number.isFinite(params?.maxBytes) && params.maxBytes > 0
      ? Math.min(params.maxBytes, config.maxFrameBytes)
      : config.maxFrameBytes
    const focusRunId = typeof params?.focusRunId === 'string' ? params.focusRunId : undefined
    const includeCompleted = params?.includeCompleted !== false

    store.mergeClientCursors(cursors)
    // v8 全量重同步：把可见 Run 全部标脏 + 读游标回退到保留窗口起点（不产生 removed）。
    /** @type {string[]} */
    const resyncedIds = explicitResync
      ? store.resync({
        includeCompleted,
        maxRuns,
        ...(focusRunId !== undefined ? { focusRunId } : {}),
      })
      : []
    /** @type {Set<string>} v8：本帧 discovery 已见 runId → prune 保护（防 removed↔runs 抖动） */
    const seenRunIds = new Set(resyncedIds)
    // 第二次 tee 尝试：覆盖 service 晚于插件加载的情况。
    attemptShellTee()

    const { sessions, rootAgent, degradation } = await resolveSessions(sessionId)
    if (rootAgent === undefined) {
      // v7：root 无 live Agent 只影响 tree（会话树发现），**不再**把 terminals 判为不可用：
      // 终端改走 terminalController / 工具事件兜底（meta-only）。
      availabilityOverride.set('tree', sourceState(false, 'session has no live agent', 'denied'))
    } else {
      availabilityOverride.delete('tree')
    }

    const sessionIds = sessions.map((scope) => scope.sessionId)
    const jobs = service('jobs')
    const terminals = service('terminals')
    const agents = service('agents')
    // scout §2.3：terminalController 是侧栏终端注册表，默认关闭（config.sidebarTerminals）。
    const controller = config.sidebarTerminals === true ? service('terminalController') : undefined
    // v9 owner 收敛：缓存对象 → agents.get(id) 换成 registry 同一引用；拿不到再退回缓存/降级。
    ownerStats = freshOwnerStats()
    // v9 关键收敛（scout T42 §C）：tier3 事件旁路可登记「树外 owner」的 terminal Run
    // （队友/subagent 暂时不在 scopes、或 listMembers 失败）。发现集合必须扩成
    // 「会话树 ∪ store 里 terminal Run 的 ownerSessionId」，否则这些 owner 永远不会解析
    // agent → notice 永久是 terminal-no-agent（真机 #1 黄框根因）。
    const terminalScopes = [...sessions]
    const terminalScopeIds = new Set(sessions.map((scope) => scope.sessionId))
    for (const record of store.all()) {
      if (record.kind !== 'terminal') continue
      const ownerSessionId = record.ownerSessionId
      if (typeof ownerSessionId !== 'string' || ownerSessionId.length === 0) continue
      if (terminalScopeIds.has(ownerSessionId)) continue
      terminalScopeIds.add(ownerSessionId)
      terminalScopes.push({
        sessionId: ownerSessionId,
        displayName: '—',
        role: 'unknown',
        depth: 0,
        accent: 'none',
        hasActivity: true,
      })
    }
    const ownerPlan = resolveOwnerPlan(terminalScopes, agents)
    const ownerOf = (ownerSessionId) => ownerPlan.get(ownerSessionId)?.owner
    // v7 三级发现：terminals.list(agent) → [可选] terminalController.list(sessionId) → tools/execute 事件。
    const terminalDiscovery = await discoverTerminalCandidates({
      terminals,
      agents,
      ownerOf,
      controller,
      sidebarTerminals: config.sidebarTerminals === true,
      scopes: terminalScopes,
      store,
      logger,
    })
    const terminalCollectOptions = {
      candidates: terminalDiscovery.candidates,
      readAgents: terminalDiscovery.readAgents,
      terminals,
      store,
      config,
      now,
      logger,
      // 清理集合 = 会话树 ∪ 仍存活的 owner 缓存（树外但 agent/cache 仍在的 Run 不得删）。
      visibleSessionIds: new Set([...sessionIds, ...aliveTerminalOwnerIds()]),
      // 只在会话树可信时清理「会话已结束」的终端 Run（v7：agent 缺失不删 Run）。
      allowSessionCleanup: degradation === undefined,
      // terminalController 也算终端能力存在（免 Agent 兜底），避免误标 missing-service。
      servicesAvailable: terminals !== undefined || controller !== undefined,
    }

    // 1) 发现层：只登记元信息 —— 新出现的 job/terminal 必须先进入 store，才能排到预算。
    if (jobs !== undefined) {
      const discovery = collectJobRuns({ jobs, sessionIds, store, config, now, budgets: {}, logger })
      for (const runId of discovery.seenRunIds ?? []) seenRunIds.add(runId)
      if (!discovery.available) availabilityOverride.set('jobs', sourceState(false, discovery.reason, 'denied'))
    }
    {
      const discovery = collectTerminalRuns({ ...terminalCollectOptions, budgets: {} })
      applyTerminalAvailability(discovery)
    }
    for (const candidate of terminalDiscovery.candidates) {
      if (typeof candidate?.terminalId === 'string') seenRunIds.add(terminalRunId(candidate.terminalId))
    }

    // 2) 预算：与 takeEntries **同一选择集**（M2：40 running 时预算与帧不再错配）。
    const selection = store.selectForFrame({ includeCompleted, maxRuns, ...(focusRunId !== undefined ? { focusRunId } : {}) })
    const plan = planReads(selection, cursors, {
      maxBytes: config.maxFrameBytes,
      maxRuns,
      ...(focusRunId !== undefined ? { focusRunId } : {}),
    })

    // 3) 读取层：job / terminal / bash 增量（均在预算内）。
    if (jobs !== undefined) {
      const result = collectJobRuns({ jobs, sessionIds, store, config, now, budgets: plan.perRunBudget, logger })
      for (const runId of result.seenRunIds ?? []) seenRunIds.add(runId)
      if (result.available) availabilityOverride.delete('jobs')
      else availabilityOverride.set('jobs', sourceState(false, result.reason, 'denied'))
    }
    {
      const result = collectTerminalRuns({ ...terminalCollectOptions, budgets: plan.perRunBudget })
      applyTerminalAvailability(result)
    }
    for (const record of store.all()) {
      if (record.kind !== 'bash') continue
      seenRunIds.add(record.runId)
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
    // H1-c 保底：连续 2 帧被整条丢弃的 Run，本帧排到最前（Tier1 首条放行 + Tier2 保底都优先它）。
    const forcedIds = []
    for (const [runId, streak] of dropStreak) if (streak >= 2) forcedIds.push(runId)
    if (forcedIds.length > 0) {
      const forced = new Set(forcedIds)
      entries.sort((left, right) => {
        const leftForced = forced.has(left.run.runId) ? 0 : 1
        const rightForced = forced.has(right.run.runId) ? 0 : 1
        return leftForced - rightForced
      })
    }
    for (const entry of entries) entry.run = enrichAgent(entry.run, sessions)
    const activeOwners = new Set(store.all().map((record) => record.ownerSessionId))
    const sessionsWithActivity = markActivity(sessions, activeOwners)
    // v7 §4.2：诊断字段（每帧必带；下一轮真机定位的唯一证据来源）。
    let agentCount = 0
    try {
      const liveAgents = typeof agents?.list === 'function' ? agents.list() : undefined
      if (Array.isArray(liveAgents)) agentCount = liveAgents.length
    } catch {
      agentCount = 0
    }
    let sessionIdMatchesAgent = false
    try {
      sessionIdMatchesAgent = typeof agents?.get === 'function' ? agents.get(sessionId) !== undefined : false
    } catch {
      sessionIdMatchesAgent = false
    }
    let tier1Terminals = 0
    let metaOnlyTerminals = 0
    for (const record of store.all()) {
      if (record.kind !== 'terminal') continue
      if (record.outputMode === 'live') tier1Terminals += 1
      else if (record.outputMode === 'meta-only') metaOnlyTerminals += 1
    }
    // agents registry 一致性探针（scout T42 §D2）：sample 的 get(id) 是否返回同一实例。
    let agentsProbe = { getOk: false, identityOk: false, sampleIds: [] }
    try {
      const list = typeof agents?.list === 'function' ? agents.list() : []
      const sample = Array.isArray(list) ? list.slice(0, 5) : []
      const sampleIds = sample.map((entry) => (typeof entry?.id === 'string' ? entry.id : '')).filter((id) => id.length > 0)
      agentsProbe = {
        // getOk：scout T42 §D 定义（id 都能从 registry 取到）
        getOk: sampleIds.length > 0 && sampleIds.every((id) => typeof agents?.get === 'function' && agents.get(id) !== undefined),
        // identityOk：更严格的同引用校验（排查 exec.agent 包装/旧引用）
        identityOk: sample.length > 0 && sample.every((entry) => typeof agents?.get === 'function' && agents.get(entry?.id) === entry),
        sampleIds,
      }
    } catch {
      agentsProbe = { getOk: false, identityOk: false, sampleIds: [] }
    }
    // terminal owner 分布（scout T42 §D3）：区分「owner 在树内 / 树外」。
    const aliveOwners = aliveTerminalOwnerIds()
    const treeSessionIds = new Set(sessionIds)
    const ownersInScope = aliveOwners.filter((id) => treeSessionIds.has(id)).length
    const terminalOwnersDiag = {
      captured: terminalOwners.size,
      alive: aliveOwners.length,
      inScope: ownersInScope,
      outOfScope: Math.max(0, aliveOwners.length - ownersInScope),
    }
    // v9 诊断：一次区分「agents 服务不可见 / 服务可见但本会话无 Agent / identity 不匹配 / owner 在树外」。
    const diagnostics = {
      rootSessionId: sessionId,
      agentFound: rootAgent !== undefined,
      agentCount,
      agentsCount: agentCount,
      scopes: sessions.length,
      agentsService: agents !== undefined,
      agentsAccess: serviceAccess.get('agents') ?? 'missing',
      sessionIdMatchesAgent,
      agentsProbe,
      terminalOwners: terminalOwnersDiag,
      terminalScopes: terminalScopes.length,
      ...(degradation !== undefined ? { treeDegradation: degradation } : {}),
      ownerCached: ownerStats.cached,
      ownerResolved: ownerStats.resolvedRegistry,
      ownerFromCache: ownerStats.resolvedCache,
      ownerIdentityMismatch: ownerStats.identityMismatch,
      ownerMissing: ownerStats.none,
      tier1Terminals,
      metaOnlyTerminals,
      terminals: {
        candidates: terminalDiscovery.candidates.length,
        source: terminalDiscovery.source,
        ...(terminalDiscovery.reason !== undefined ? { reason: terminalDiscovery.reason } : {}),
      },
    }
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
        diagnostics,
      },
      cursors,
      { maxBytes },
    )
    // Tier2 用同一 maxFrameBytes 的整帧 JSON 兜底；同时留出 Tier3(262144) 余量，
    // 保证 Tier3 永不触发（否则 route 层回退游标时，本层已提交的游标会跳过未交付字节）。
    const tier2Limit = Math.min(config.maxFrameBytes, MAX_RESPONSE_BYTES - 2048)
    const bounded = boundFrameDetailed(frame.value, tier2Limit, {
      ...(forcedIds.length > 0 ? { preferRunId: forcedIds[0] } : {}),
    })
    // 被预算丢掉的 Run 退回注册表（游标不推进 → 下轮续读，绝不丢字节）。
    const droppedIds = new Set([...frame.dropped, ...bounded.droppedRunIds])
    const deliveredBytes = bounded.deliveredBytes ?? {}
    const restoreList = []
    for (const entry of entries) {
      const runId = entry.run.runId
      if (droppedIds.has(runId)) {
        restoreList.push(entry)
        continue
      }
      const perChannel = deliveredBytes[runId]
      if (perChannel === undefined) continue
      // Tier2 部分交付：仅把**未交付的后缀**退回，游标只按实际交付推进。
      const remainderOutput = {}
      for (const [channel, delta] of Object.entries(entry.output ?? {})) {
        const sent = perChannel[channel]
        if (!Number.isFinite(sent)) {
          remainderOutput[channel] = delta
          continue
        }
        const split = splitDeltaAtBytes(delta, sent)
        if (split.remainder !== undefined) remainderOutput[channel] = split.remainder
      }
      if (Object.keys(remainderOutput).length > 0) restoreList.push({ ...entry, output: remainderOutput })
    }
    if (restoreList.length > 0) store.restore(restoreList)
    // 游标只按**本帧真正交付**推进（Tier2/Tier3 裁剪后唯一可信来源）。
    store.commitCursorsFromFrame(bounded.value.nextCursors)
    // H1-c 计数：整条被丢 +1，出现在帧里即清零。
    const visibleIds = new Set(bounded.value.runs.map((run) => run.runId))
    for (const entry of entries) {
      const runId = entry.run.runId
      if (visibleIds.has(runId)) dropStreak.delete(runId)
      else dropStreak.set(runId, (dropStreak.get(runId) ?? 0) + 1)
    }
    // v8：prune 保护本帧 discovery 已见的 Run（jobs/terminals/bash），避免同一 runId
    // 在相邻帧「removed → 重新 upsert」的删除/重建抖动。
    store.prune(now(), { protect: seenRunIds })
    // v8 不变量：同一帧 `removed` 与 `runs` 不得包含同一 runId；同帧冲突以 runs 为准
    // （被 Tier1/Tier2 退回的 entry 也算「本帧已尝试交付」，其 removed 延后一帧再发）。
    const entriesRunIds = new Set(entries.map((entry) => entry.run.runId))
    const frameRunIds = new Set(bounded.value.runs.map((run) => run.runId))
    const removedMerged = [...new Set([...(bounded.value.removed ?? []), ...store.drainRemoved()])]
    const removed = removedMerged.filter((runId) => !frameRunIds.has(runId) && !entriesRunIds.has(runId))
    return { ok: true, value: { ...bounded.value, removed } }
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
