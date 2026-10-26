/**
 * dsh-terminal-panel · Host 半端入口（ESM）。
 *
 * 契约：docs/architecture/contract.md §3.3（装配时序）、§4.1（端点）、§13.1（交接清单）。
 *
 * 导出形态：**只有具名导出** `{ name, inject, apply }`（F3）。
 *   ⚠ 绝不能有 `export default`：DSH loader 会把 ESM 默认导出（函数）当作插件本体，
 *   于是 `name`/`inject` 等具名元数据全部丢失，cordis 认为 inject=[]，
 *   `apply` 里访问 `ctx.webServer` 会抛 `cannot get property "webServer" without inject`。
 *   对照可用的 `@local/dsh-popout-window`：它同样只有 name/inject/apply 三个具名导出。
 *  - `inject` 是硬依赖：`webServer`（注册 exact 路由）+ `connection`（认证栅栏）。
 *    webServer 被重建/依赖不可用时本插件 fiber 不会 active，前端表现为路由未注册。
 *  - 其余服务（shell/jobs/terminals/subagents/agentTeams/agents）全部可选：
 *    运行时用 `ctx.get(name)` 探测，缺失只降级对应来源，绝不抛异常。
 *  - 一切注册都在 `ctx.effect` 内，返回清理函数；dispose 后路由、包装、监听全撤。
 *
 * ⚠ Cordis 插件契约（H2 真机故障根因）：
 *   `apply` 的返回值会被 cordis 当作 **effect** 解释，只允许
 *   `undefined` / 清理函数 / thenable / Iterator / AsyncIterator；
 *   返回普通对象会抛 `TypeError("Invalid effect")` → fiber 装载失败、effect 回滚，
 *   表现为「插件行看起来 active，但路由从未存在」。因此本函数**绝不返回对象**。
 *   同时所有失败都必须**向上抛**（而不是 logger.warn 后吞掉），让 fiber 进入 failed
 *   状态在 Plugin Manager 里可见，避免「active 但什么都不工作」的静默状态。
 */

import { createPanel } from './host/panel.mjs'
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ROUTE_PATH, createRpcHandler } from './host/route.mjs'

/** 宿主侧插件名（Loader 诊断用）。 */
export const name = 'terminal-panel'

/** 硬依赖（与 @local/dsh-popout-window 同款）。 */
export const inject = ['webServer', 'connection']

/**
 * 插件装配。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主上下文
 * @param {Record<string, unknown>} [config] cordis.patch.yml 里的 config
 * @returns {undefined} cordis 插件契约：不得返回普通对象
 */
export function apply(ctx, config) {
  const logger = ctx.logger
  /** 失败必须可见：写宿主 logger，但绝不吞异常。 */
  const logFailure = (message, error) => {
    try {
      const log = logger?.error ?? logger?.warn
      log?.call(logger, message, error)
    } catch {
      // logger 本身异常不影响主流程
    }
  }

  // 防御性自检（H2b）：若 `export const inject` 对 loader 不可见（例如误加 default export，
  // loader 只拿到函数本体），访问 ctx.webServer 会直接抛 "cannot get property ... without inject"。
  // 把它转成清晰的装配失败并 rethrow，让 fiber 在 Plugin Manager 里显示 failed 而不是静默。
  let webServer
  let connection
  try {
    webServer = ctx.webServer
    connection = ctx.connection
  } catch (error) {
    logFailure('[terminal-panel] required services are not injected; keep only named exports (no default export):', error)
    throw error
  }
  if (webServer === undefined || connection === undefined) {
    const error = new Error('[terminal-panel] required services missing: webServer/connection')
    logFailure('[terminal-panel] required services missing (inject=[webServer, connection]):', error)
    throw error
  }

  let panel
  let handler
  try {
    panel = createPanel({ ctx, config, logger })
    handler = createRpcHandler({
      dispatch: (method, params) => panel.handleRpc(method, params),
      authReject: (req) => connection.requestRejection({ headers: req.headers }),
      maxBodyBytes: MAX_REQUEST_BYTES,
      maxResponseBytes: MAX_RESPONSE_BYTES,
      logger,
    })
  } catch (error) {
    // 抛出去 → fiber failed（Plugin Manager 可见），而不是「active 但没有路由」。
    logFailure('[terminal-panel] plugin assembly failed:', error)
    throw error
  }

  ctx.effect(() => {
    let offRoute
    try {
      offRoute = webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler,
      })
    } catch (error) {
      // duplicate / webServer 未就绪都属装配错误：可见地失败，不静默留空。
      logFailure(`[terminal-panel] route registration failed (${ROUTE_PATH}):`, error)
      throw error
    }

    let capture
    try {
      capture = typeof panel.start === 'function' ? panel.start() : undefined
    } catch (error) {
      logFailure('[terminal-panel] capture wiring failed:', error)
      try {
        if (typeof offRoute === 'function') offRoute()
      } catch {
        // 忽略清理异常
      }
      throw error
    }

    return () => {
      try {
        if (typeof capture === 'function') capture()
      } finally {
        try {
          if (typeof offRoute === 'function') offRoute()
        } finally {
          panel.dispose()
        }
      }
    }
  }, 'terminal-panel: HTTP surface')

  // 契约要求：不返回任何值（返回对象会被 cordis 判为 Invalid effect）。
  return undefined
}
