// Host 入口（lib/index.js）loader 契约回归：H2 / H2b（真机 HIGH，backend 32bbaf4 + d51ea5f）
//
// 背景（真机故障，2026-10-26）：
// - H2：apply 曾返回 `{ panel }` 普通对象。cordis `Fiber._execute` 把 apply 的返回值当 effect 解释，
//    只接受 undefined / 清理函数 / thenable / Iterator / AsyncIterator；普通对象 → `TypeError: Invalid effect`
//    → `_unload()` 回滚该 fiber 全部 effects（含 ctx.effect 内注册的 exact 路由）→ 路由从未存在
//    （curl POST /terminal-panel/rpc 得到 405 + 空 body，即 SPA fallback），而 Plugin Manager 仍显示 active。
// - H2b：曾 `export default apply`。DSH ESM loader 取 default（函数）当插件本体，丢失 `export const name/inject`
//    → cordis 认为 inject=[] → apply 内访问 ctx.webServer 抛
//    "cannot get property \"webServer\" without inject"。
//
// 本文件是独立回归：不依赖真实 cordis（离线可跑），用 fake ctx 的 effect 注册表复刻 loader 的
// 「返回值校验 + 抛错回滚」语义。写作用域 tests/**；不改 lib/**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostEntry } from '../helpers/host-modules.mjs'
import { createFakeHostCtx } from '../helpers/fakes.mjs'

const entry = await loadHostEntry()
const skip = entry.missing ? entry.reason : entry.ok ? false : entry.reason

/** 最小可装配 ctx（webServer/connection 可用，其余服务按需 mock）。 */
function makeEffectCtx({ webServer, connection = { requestRejection: () => undefined }, logger } = {}) {
  const routes = []
  const effects = []
  const listeners = []
  const ws = webServer ?? {
    register(route) {
      routes.push(route)
      const dispose = () => {
        const index = routes.indexOf(route)
        if (index >= 0) routes.splice(index, 1)
      }
      dispose.dispose = dispose
      return dispose
    },
  }
  const ctx = {
    logger,
    webServer: ws,
    connection,
    effect(fn, label) {
      const dispose = fn()
      effects.push({ dispose, label })
      return dispose
    },
    on(event, handler) {
      const entry = { event, handler }
      listeners.push(entry)
      return () => {
        const index = listeners.indexOf(entry)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    get() {
      return undefined
    },
  }
  return { ctx, routes, effects, listeners }
}

/** 复刻 cordis `Fiber._execute` 对 apply 返回值的校验 + 失败回滚（fake effect 注册表）。 */
function runLikeCordis(env, plugin) {
  const result = plugin.apply(env.ctx, {})
  const isThenable = result !== null && typeof result === 'object' && typeof result.then === 'function'
  const valid = result === undefined || typeof result === 'function' || isThenable
  if (!valid) {
    // cordis：Invalid effect → unload → 回滚本次 fiber 注册过的所有 effects（逆序）。
    for (const item of [...env.effects].reverse()) {
      if (typeof item.dispose === 'function') item.dispose()
      else if (item.dispose && typeof item.dispose.dispose === 'function') item.dispose.dispose()
    }
    env.effects.length = 0
    throw new TypeError('Invalid effect')
  }
  return result
}

test('H2b 回归：模块命名空间只含具名导出，无 default，name/inject/apply 正确', { skip }, () => {
  assert.ok(entry.ok, entry.reason)
  const mod = entry.mod
  assert.equal(typeof mod.apply, 'function', 'lib/index.js 必须导出具名 apply 函数')
  assert.equal(mod.name, 'terminal-panel', 'name 必须是 terminal-panel（patch id 同名）')
  assert.ok(Array.isArray(mod.inject), 'inject 必须是数组')
  assert.ok(mod.inject.includes('webServer'), 'inject 必须含 webServer（硬依赖）')
  assert.ok(mod.inject.includes('connection'), 'inject 必须含 connection（硬依赖）')
  // H2b 核心：绝不能有 default export（否则 loader 取 default 函数，丢失 name/inject）
  assert.equal(mod.default, undefined, 'lib/index.js 不得有 default export（H2b：loader 会丢失 inject）')
  assert.equal('default' in mod, false, 'ESM 命名空间不得含 default 键')
  assert.ok(Object.prototype.hasOwnProperty.call(mod, 'apply'))
  assert.ok(Object.prototype.hasOwnProperty.call(mod, 'name'))
  assert.ok(Object.prototype.hasOwnProperty.call(mod, 'inject'))
})

test('H2 回归：apply 必须返回 undefined（返回普通对象会被 cordis 判 Invalid effect 并回滚路由）', { skip }, () => {
  assert.ok(entry.ok, entry.reason)
  const fake = createFakeHostCtx({})
  const result = entry.mod.apply(fake.ctx, {})
  assert.equal(result, undefined, 'cordis 插件契约：apply 只能返回 undefined/cleanup/thenable/iterator，不能返回普通对象')
  assert.equal(fake.routes.length, 1, '正常装配应注册 1 条 exact 路由')
  assert.equal(fake.routes[0].path, '/terminal-panel/rpc')
  fake.dispose()
  assert.equal(fake.routes.length, 0, 'dispose 后路由撤销')
})

test('H2 回归：返回普通对象会被 cordis 回滚（负向对照），而真实 apply 通过返回值校验并保留路由', { skip }, () => {
  assert.ok(entry.ok, entry.reason)

  // 负向对照：本地 fake plugin 复刻 H2 故障形态 → Invalid effect + effect 回滚 + 路由消失
  const badEnv = makeEffectCtx()
  const badPlugin = {
    apply(ctx) {
      ctx.effect(() => {
        const route = { kind: 'exact', path: '/terminal-panel/rpc' }
        badEnv.routes.push(route)
        return () => badEnv.routes.splice(badEnv.routes.indexOf(route), 1)
      }, 'bad: route')
      return { panel: {} } // H2 的故障形态
    },
  }
  assert.throws(() => runLikeCordis(badEnv, badPlugin), /Invalid effect/)
  assert.deepEqual(badEnv.routes, [], 'Invalid effect 触发 fiber 回滚：不得留下路由')
  assert.equal(badEnv.effects.length, 0, '回滚后 effect 注册表必须清空')

  // 正向：真实 lib/index.js 走同一 loader 契约 → 返回 undefined、路由保留，dispose 后撤销
  const env = makeEffectCtx()
  const result = runLikeCordis(env, entry.mod)
  assert.equal(result, undefined, '真实 apply 必须通过 cordis 返回值校验')
  assert.equal(env.routes.length, 1, '返回值合法 → 路由必须保留（真机 H2 症状为路由被回滚）')
  assert.equal(env.routes[0].path, '/terminal-panel/rpc')
  for (const item of [...env.effects].reverse()) {
    if (typeof item.dispose === 'function') item.dispose()
    else if (item.dispose && typeof item.dispose.dispose === 'function') item.dispose.dispose()
  }
  assert.equal(env.routes.length, 0, 'cleanup 后路由必须撤销')
  assert.equal(env.listeners.length, 0, 'cleanup 后 tools 监听必须撤销')
})

test('H2 回归：apply 抛错时不得留下路由（fake ctx effect 表断言，失败可见）', { skip }, () => {
  assert.ok(!entry.missing, entry.reason)

  // 场景 A：webServer.register 抛错（duplicate / 未就绪）→ apply 必须 throw，路由表为空、effect 表为空
  const envA = makeEffectCtx({
    webServer: {
      register() {
        throw new Error('route registration failed: duplicate')
      },
    },
    logger: { error() {} },
  })
  assert.throws(() => entry.mod.apply(envA.ctx, {}), /route registration failed/)
  assert.deepEqual(envA.routes, [], 'register 抛错后不得留下路由')
  assert.equal(envA.effects.length, 0, 'effect 表必须为空（失败不得保留半注册 effect）')

  // 注：createPanel 对可选服务探测有 try/catch 降级，无法稳定从外部注入「装配中途抛错」；
  // H2 的回滚语义已由上一用例（Invalid effect 负向对照）覆盖。
})

test('H2 回归：缺 webServer/connection 时 apply 必须 throw（不得静默 return），message 可读', { skip }, () => {
  assert.ok(!entry.missing, entry.reason)

  // 场景 A：ctx 完全没有 webServer 属性
  const missingLogs = []
  const ctxA = {
    connection: { requestRejection: () => undefined },
    logger: { error: (...args) => missingLogs.push(args.join(' ')) },
    effect(fn) {
      return fn()
    },
    on() {
      return () => {}
    },
    get() {
      return undefined
    },
  }
  assert.throws(
    () => entry.mod.apply(ctxA, {}),
    (error) => {
      assert.ok(error instanceof Error, '必须是 Error 实例（可见失败，而非静默 return）')
      assert.match(error.message, /webServer|required services/i, `message 必须可读：${error.message}`)
      return true
    },
    '缺 webServer 时必须 throw（H2：「active 但无路由」的静默状态不可接受）',
  )
  assert.ok(missingLogs.length >= 1, '失败必须写 logger.error/warn（Plugin Manager 可见）')

  // 场景 B：webServer getter 抛错（H2b 的真实症状：inject 丢失）
  const ctxB = {
    connection: { requestRejection: () => undefined },
    get webServer() {
      throw new Error('cannot get property "webServer" without inject')
    },
    logger: { error() {} },
    effect(fn) {
      return fn()
    },
    on() {
      return () => {}
    },
    get() {
      return undefined
    },
  }
  assert.throws(
    () => entry.mod.apply(ctxB, {}),
    /cannot get property "webServer" without inject/,
    'inject 丢失导致的原始错误必须向上抛出（不得吞掉）',
  )

  // 场景 C：缺 connection
  const ctxC = {
    webServer: { register: () => () => {} },
    logger: { error() {} },
    effect(fn) {
      return fn()
    },
    on() {
      return () => {}
    },
    get() {
      return undefined
    },
  }
  assert.throws(() => entry.mod.apply(ctxC, {}), /connection|required services/i)
})
