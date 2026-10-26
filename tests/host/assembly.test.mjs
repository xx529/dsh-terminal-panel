// Host 装配测试（契约 §11.3）：mock webServer.register 捕获 route；dispose 后撤销；
// 路由信封行为（§4.1/§4.4）与来源缺失降级（§8）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostEntry } from '../helpers/host-modules.mjs'
import {
  createFakeHostCtx,
  createFakeJobsService,
  createFakeTerminalsService,
  makeReq,
  makeRes,
} from '../helpers/fakes.mjs'

const entry = await loadHostEntry()
const skip = entry.missing ? entry.reason : false

function fakeAgents(ids = ['root-1']) {
  const map = new Map(ids.map((id) => [id, { id, name: id === 'root-1' ? 'lead' : id }]))
  return {
    get: (id) => map.get(id),
    list: () => [...map.values()],
    roots: () => [...map.values()],
  }
}

function baseServices(extra = {}) {
  return {
    webServer: undefined, // 由 createFakeHostCtx 默认实现
    connection: undefined,
    agents: fakeAgents(),
    subagents: { listDescendants: () => [] },
    agentTeams: { listMembers: () => [], membership: () => undefined },
    jobs: createFakeJobsService(),
    terminals: createFakeTerminalsService(),
    ...extra,
  }
}

async function applyHost(services = baseServices(), config = {}) {
  assert.ok(entry.ok, entry.reason)
  const fake = createFakeHostCtx({ services, config })
  await entry.mod.apply(fake.ctx, config)
  return fake
}

async function callRoute(route, { method = 'POST', headers = {}, body = '' } = {}) {
  const req = makeReq({ method, headers, body })
  const res = makeRes()
  const delay = new Promise((resolve) => setTimeout(resolve, 2000))
  await Promise.race([Promise.resolve(route.handler(req, res)), delay])
  // handler 可能同步 end；等 end 或超时
  await Promise.race([res.done, delay])
  return {
    status: res.statusCode,
    headers: res.headers,
    body: res.body,
    json: res.json,
    finished: res.finished,
  }
}

function helloBody() {
  return JSON.stringify({ method: 'panel.hello', params: {} })
}

test('exports: { name, inject, apply }（契约 §13.1 / F3）', { skip }, () => {
  assert.ok(entry.ok, entry.reason)
  const mod = entry.mod
  assert.equal(typeof mod.apply, 'function', 'lib/index.js 必须导出 apply 函数')
  assert.equal(mod.name, 'terminal-panel', 'name 必须为 terminal-panel（patch id 同名）')
  assert.ok(Array.isArray(mod.inject), 'inject 必须是数组')
  assert.ok(mod.inject.includes('webServer'), 'inject 必须含 webServer（硬依赖）')
  assert.ok(mod.inject.includes('connection'), 'inject 必须含 connection（硬依赖）')
})

test('apply: 注册 exact 路由 /terminal-panel/rpc（契约 §4.1 / §11.3）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  assert.ok(route, `未注册 /terminal-panel/rpc，已注册：${fake.routes.map((r) => r.path).join(',') || '(无)'}`)
  assert.equal(route.kind, 'exact')
  assert.equal(typeof route.handler, 'function')
  await fake.dispose()
})

test('dispose: 路由被撤销（契约 §11.3 / practices：一切注册走 ctx.effect）', { skip }, async () => {
  const fake = await applyHost()
  assert.ok(fake.routeOf('/terminal-panel/rpc'), '前置条件：路由已注册')
  await fake.dispose()
  assert.equal(fake.routes.length, 0, `dispose 后仍残留路由：${fake.routes.map((r) => r.path).join(',')}`)
})

test('apply: 可选服务全部缺失时仍能激活并注册路由（§8 降级总原则）', { skip }, async () => {
  const fake = await applyHost({})
  const route = fake.routeOf('/terminal-panel/rpc')
  assert.ok(route, '可选服务缺失时 Host 半端不得拒绝激活（webServer/connection 是硬依赖）')
  await fake.dispose()
})

test('路由: 非 POST → 405 且 Allow: POST（§4.1/§4.4 method）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  const r = await callRoute(route, { method: 'GET', body: '' })
  assert.equal(r.status, 405, `GET 期望 405，实际 ${r.status}`)
  assert.equal(String(r.headers.allow ?? '').toUpperCase(), 'POST')
  await fake.dispose()
})

test('路由: content-type 非 JSON → 415（§4.1）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  const r = await callRoute(route, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: helloBody(),
  })
  assert.equal(r.status, 415, `text/plain 期望 415，实际 ${r.status}`)
  await fake.dispose()
})

test('路由: 请求体超 4 KiB → 413（§4.1/§4.4 too-large）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  const big = JSON.stringify({ method: 'panel.hello', params: { pad: 'x'.repeat(5000) } })
  assert.ok(Buffer.byteLength(big) > 4096)
  const r = await callRoute(route, { body: big })
  assert.equal(r.status, 413, `超限请求体期望 413，实际 ${r.status}`)
  await fake.dispose()
})

test('panel.hello → 200 { ok:true, value:{ protocol:1, limits, availability } }（§4.2）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  const r = await callRoute(route, { body: helloBody() })
  assert.equal(r.status, 200)
  assert.ok(r.json, `响应必须为 JSON，实际 body=${r.body.slice(0, 120)}`)
  assert.equal(r.json.ok, true, `hello 应成功，实际 ${r.body.slice(0, 200)}`)
  const { value } = r.json
  assert.equal(value.protocol, 1)
  assert.equal(typeof value.hostTime, 'number')
  assert.ok(value.capabilities && typeof value.capabilities === 'object', 'hello 必须带 capabilities')
  for (const key of ['bash', 'jobs', 'terminals', 'tree']) {
    assert.ok(key in value.capabilities, `capabilities 缺 ${key}`)
  }
  assert.ok(value.limits && typeof value.limits === 'object', 'hello 必须带 limits')
  assert.equal(value.limits.maxFrameBytes, 65536, '默认 maxFrameBytes=65536（§9）')
  assert.equal(typeof value.limits.pollHintMs, 'number')
  await fake.dispose()
})

test('未知方法 → 200 { ok:false, error:{ code:"unknown-method" } }（§4.4）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  const r = await callRoute(route, { body: JSON.stringify({ method: 'panel.nope', params: {} }) })
  assert.equal(r.status, 200)
  assert.ok(r.json)
  assert.equal(r.json.ok, false)
  assert.equal(r.json.error?.code, 'unknown-method')
  await fake.dispose()
})

test('panel.poll: 未知 sessionId → 200 且给出明确诊断（v1 session-not-found / v2 降级帧，待裁决）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  const r = await callRoute(route, {
    body: JSON.stringify({ method: 'panel.poll', params: { sessionId: 'no-such-session' } }),
  })
  assert.equal(r.status, 200)
  assert.ok(r.json)
  if (r.json.ok === false) {
    assert.equal(r.json.error?.code, 'session-not-found')
  } else {
    assert.equal(r.json.value.availability.tree.available, false, '降级帧必须标记 tree 不可用')
    assert.equal(r.json.value.sessions.length, 1)
  }
  await fake.dispose()
})

test('认证栅栏: requestRejection 命中时不得继续处理方法（§10）', { skip }, async () => {
  const rejecting = {
    requestRejection() {
      return { status: 401, headers: {}, body: 'unauthorized' }
    },
  }
  const fake = await applyHost(baseServices({ connection: rejecting }))
  const route = fake.routeOf('/terminal-panel/rpc')
  const r = await callRoute(route, { body: helloBody() })
  const rejected = r.status >= 400 || r.json?.ok !== true
  assert.ok(rejected, `认证拒绝时不得返回成功响应，实际 status=${r.status} body=${r.body.slice(0, 120)}`)
  await fake.dispose()
})

test('响应头: cache-control: no-store（§4.1）', { skip }, async () => {
  const fake = await applyHost()
  const route = fake.routeOf('/terminal-panel/rpc')
  const r = await callRoute(route, { body: helloBody() })
  assert.equal(String(r.headers['cache-control'] ?? '').toLowerCase(), 'no-store')
  await fake.dispose()
})
