/**
 * dsh-terminal-panel · Host 半端入口（ESM）。
 *
 * 契约：docs/architecture/contract.md §3.3（装配时序）、§4.1（端点）、§13.1（交接清单）。
 *
 * 导出形态：`{ name, inject, apply }`（F3）。
 *  - `inject` 是硬依赖：`webServer`（注册 exact 路由）+ `connection`（认证栅栏）。
 *    两者缺失时插件不激活，前端表现为路由 404 →「Host 半端未加载」（契约 §8）。
 *  - 其余服务（shell/jobs/terminals/subagents/agentTeams/agents）全部可选：
 *    运行时用 `ctx.get(name)` 探测，缺失只降级对应来源，绝不抛异常。
 *  - 一切注册都在 `ctx.effect` 内，返回清理函数；dispose 后路由、包装、监听全撤。
 */

import { createPanel } from './host/panel.mjs'
import { MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, ROUTE_PATH, createRpcHandler } from './host/route.mjs'

/** 宿主侧插件名（Loader 诊断用）。 */
export const name = 'terminal-panel'

/** 硬依赖（与 @local/dsh-popout-window 同款）。 */
export const inject = ['webServer', 'connection']

/**
 * 插件装配。
 * @param {import('@deepseek-ai/cordis').Context} ctx 宿主上下文
 * @param {Record<string, unknown>} [config] cordis.patch.yml 里的 config
 * @returns {{panel: ReturnType<typeof createPanel>}|undefined}
 */
export function apply(ctx, config) {
  const logger = ctx.logger

  let panel
  try {
    panel = createPanel({ ctx, config, logger })
  } catch (error) {
    // 装配失败只让插件降级：不注册路由 → 前端显示「Host 半端未加载」。
    logger?.warn?.('[terminal-panel] panel assembly failed:', error?.message ?? error)
    return undefined
  }

  const handler = createRpcHandler({
    dispatch: (method, params) => panel.handleRpc(method, params),
    authReject: (req) => ctx.connection.requestRejection({ headers: req.headers }),
    maxBodyBytes: MAX_REQUEST_BYTES,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    logger,
  })

  ctx.effect(() => {
    let offRoute
    try {
      offRoute = ctx.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler,
      })
    } catch (error) {
      logger?.warn?.(`[terminal-panel] route registration failed (${ROUTE_PATH}):`, error?.message ?? error)
      return () => {}
    }
    // 采集器（bash/job/terminal/会话树）在 applyCapture 里接入后也挂到 panel.onDispose。
    const capture = typeof panel.start === 'function' ? panel.start() : undefined
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

  return { panel }
}

export default apply
