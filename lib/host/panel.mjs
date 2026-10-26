/**
 * panel.mjs — RPC 业务装配（`panel.hello` / `panel.poll` / `panel.kill`）。
 *
 * 契约：docs/architecture/contract.md §4.2（方法/信封）、§4.3（帧预算）、
 *       §4.4（错误码）、§5.1（数据模型）、§8（降级矩阵）。
 *
 * 本模块只依赖注入的 `ctx`（cordis Context）与服务句柄，不直接 import 任何 DSH 包，
 * 因此可以用 mock ctx 在 node 里跑（scripts/smoke-host.mjs）。
 */

import { classifyTool, isBackgroundBash, isRunShapedTool } from './classify.mjs'
import { createRunStore } from './store.mjs'

/** 协议版本（hello/poll 帧里回显）。 */
export const PROTOCOL = 1

/** 服务探测（全部可选，缺失只降级）。 */
const OPTIONAL_SERVICES = ['shell', 'jobs', 'terminals', 'subagents', 'agentTeams', 'agents']

/** 契约 §9 的默认配置。 */
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
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 */
function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback
  if (value < min) return min
  if (value > max) return max
  return value
}

/**
 * 来源可用性（契约 §8 降级矩阵）。
 * @param {{available: boolean, reason?: string, code?: string}} state
 */
export function sourceState(state) {
  return state.available ? { available: true } : { available: false, reason: state.reason ?? 'unavailable', code: state.code ?? 'missing-service' }
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

  /** 后台采集器的清理函数（batch 2 由 capture-* 注册）。 */
  const cleanups = []
  /** 工具调用 → 归属（callId → {callId, agent, name, args, command, startedAt}）。 */
  const toolCalls = new Map()
  /** 服务可用性覆盖（采集器不可用时由采集器写入）。 */
  const availabilityOverride = new Map()

  /** 探测可选服务。 */
  function service(name) {
    try {
      return typeof ctx?.get === 'function' ? ctx.get(name) : undefined
    } catch {
      return undefined
    }
  }

  /** 当前各来源可用性。 */
  function availability() {
    const bash = availabilityOverride.get('bash')
    const jobs = availabilityOverride.get('jobs')
    const terminals = availabilityOverride.get('terminals')
    const tree = availabilityOverride.get('tree')
    return {
      bash: bash ?? (service('shell') !== undefined
        ? sourceState({ available: true })
        : sourceState({ available: false, reason: 'shell service unavailable' })),
      jobs: jobs ?? (service('jobs') !== undefined
        ? sourceState({ available: true })
        : sourceState({ available: false, reason: 'jobs service unavailable' })),
      terminals: terminals ?? (service('terminals') !== undefined
        ? sourceState({ available: true })
        : sourceState({ available: false, reason: 'terminals service unavailable' })),
      tree: tree ?? sourceState({ available: true }),
    }
  }

  /**
   * 记录一次工具调用（供 bash 幽灵 Run 与归属绑定）。
   * @param {any} exec tools/execute 的 exec
   */
  function recordToolCall(exec) {
    if (exec === null || typeof exec !== 'object') return
    const agentId = exec.agent?.id
    if (typeof agentId !== 'string' || agentId.length === 0) return
    if (!isRunShapedTool(exec.name)) return
    const classified = classifyTool(exec.name, exec.arguments)
    if (classified === null) return
    if (classified.kind === 'bash' && isBackgroundBash(exec.arguments)) return
    const callId = typeof exec.callId === 'string' ? exec.callId : undefined
    if (callId === undefined) return
    toolCalls.set(callId, {
      callId,
      sessionId: agentId,
      name: exec.name,
      kind: classified.kind,
      command: classified.command,
      cwd: classified.cwd,
      args: exec.arguments,
      startedAt: now(),
      done: false,
    })
    // 上限保护：工具调用记录只在内存里做短期关联。
    if (toolCalls.size > 512) {
      const oldest = toolCalls.keys().next().value
      if (oldest !== undefined) toolCalls.delete(oldest)
    }
  }

  /**
   * `panel.hello`。
   */
  async function hello() {
    return {
      ok: true,
      value: {
        protocol: PROTOCOL,
        hostTime: now(),
        capabilities: {
          bash: service('shell') !== undefined,
          jobs: service('jobs') !== undefined,
          terminals: service('terminals') !== undefined,
          tree: service('subagents') !== undefined || service('agentTeams') !== undefined || service('agents') !== undefined,
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
   * `panel.poll` —— batch 1 版本：只返回 root 会话与空 runs（采集器在 batch 2 接入）。
   * @param {any} params
   */
  async function poll(params) {
    const sessionId = typeof params?.sessionId === 'string' ? params.sessionId : ''
    if (sessionId.length === 0) {
      return { ok: false, error: { code: 'bad-request', message: 'sessionId is required' } }
    }
    const agents = service('agents')
    if (agents !== undefined && typeof agents.get === 'function') {
      let live
      try {
        live = agents.get(sessionId)
      } catch {
        live = undefined
      }
      if (live === undefined) {
        return { ok: false, error: { code: 'session-not-found', message: 'session is not live' } }
      }
    }
    store.mergeClientCursors(params?.cursors)
    const revision = store.bumpRevision()
    if (params?.cursors === undefined) store.drainRemoved()
    const value = {
      protocol: PROTOCOL,
      sessionId,
      serverTime: now(),
      revision,
      sessions: [{
        sessionId,
        displayName: '当前会话',
        role: 'root',
        depth: 0,
        accent: 'none',
        hasActivity: false,
      }],
      runs: [],
      removed: store.drainRemoved(),
      availability: availability(),
      truncated: false,
      nextCursors: {},
    }
    return { ok: true, value }
  }

  /**
   * `panel.kill`。
   * @param {any} params
   */
  async function kill(params) {
    const runId = typeof params?.runId === 'string' ? params.runId : ''
    if (runId.length === 0) return { ok: false, error: { code: 'bad-request', message: 'runId is required' } }
    return { ok: false, error: { code: 'run-not-found', message: 'run is not visible' } }
  }

  /**
   * 方法分派。
   * @param {string} method
   * @param {any} params
   */
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

  /** 释放采集器、监听与句柄（幂等）。 */
  function dispose() {
    for (const cleanup of cleanups.splice(0)) {
      try {
        cleanup()
      } catch (error) {
        logger?.warn?.('[terminal-panel] cleanup failed:', error?.message ?? error)
      }
    }
    toolCalls.clear()
  }

  return {
    store,
    config,
    now,
    service,
    availability,
    recordToolCall,
    hello,
    poll,
    kill,
    handleRpc,
    dispose,
    /** 供 capture-* 注册清理。 */
    onDispose(cleanup) {
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    setAvailability(source, state) {
      availabilityOverride.set(source, state)
    },
    logger,
  }
}

/** 仅供索引使用：可探测的服务名列表。 */
export const PROBEABLE_SERVICES = Object.freeze([...OPTIONAL_SERVICES])
