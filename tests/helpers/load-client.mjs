// Client 半端加载器（契约 §11.2 / §11.3 的 Tester 取用方式）。
//
// lib/client.js 是 classic script：执行时调用 window.__ModuleLoader__.load({ id, factory })。
// 做法：
//   1. 用最小 window/document stub 替换全局，动态 import lib/client.js，捕获 load 的 spec；
//   2. 用 react stub 调 factory(require)；
//   3. 从返回值取 __internals（纯函数）与 apply/inject（装配测试）。
//
// 缺失（lib/client.js 还不存在）→ status:'missing'，测试 skip；
// 存在但 import/factory/__internals 出错 → status:'error'，测试必须失败（真实契约违例）。
import { access } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { CLIENT_FILE } from './paths.mjs'
import { createRequire } from './react-stub.mjs'

let cached

function makeDocumentStub() {
  const listeners = new Map()
  return {
    baseURI: 'http://127.0.0.1:0/',
    visibilityState: 'visible',
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(fn)
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn)
    },
    querySelector() {
      return null
    },
    createElement() {
      return { style: {}, dataset: {}, setAttribute() {}, appendChild() {}, remove() {} }
    },
    head: { appendChild() {} },
    body: { appendChild() {}, removeChild() {} },
    documentElement: { style: { setProperty() {} } },
    __listeners: listeners,
  }
}

export async function loadClient() {
  if (cached) return cached

  try {
    await access(CLIENT_FILE)
  } catch {
    cached = { status: 'missing', reason: 'lib/client.js 尚未实现（T4 frontend 进行中）', file: CLIENT_FILE }
    return cached
  }

  let captured = null
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const prevDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')

  globalThis.window = { __ModuleLoader__: { load(spec) { captured = spec } } }
  globalThis.document = makeDocumentStub()

  try {
    const url = `${pathToFileURL(CLIENT_FILE).href}?tester=${Date.now()}-${Math.random().toString(36).slice(2)}`
    await import(url)
  } catch (error) {
    cached = {
      status: 'error',
      reason: `import lib/client.js 失败：${error.message}`,
      error,
      file: CLIENT_FILE,
    }
    return cached
  } finally {
    if (prevWindow) Object.defineProperty(globalThis, 'window', prevWindow)
    else delete globalThis.window
    if (prevDocument) Object.defineProperty(globalThis, 'document', prevDocument)
    else delete globalThis.document
  }

  if (!captured) {
    cached = {
      status: 'error',
      reason: 'lib/client.js 未调用 window.__ModuleLoader__.load({...})（契约 §11.2 / F4）',
      file: CLIENT_FILE,
    }
    return cached
  }
  if (typeof captured.factory !== 'function') {
    cached = { status: 'error', reason: 'load spec 缺少 factory 函数（契约 §11.2）', file: CLIENT_FILE }
    return cached
  }

  const require = createRequire()
  let mod
  try {
    mod = await captured.factory(require)
  } catch (error) {
    cached = {
      status: 'error',
      reason: `factory(require) 抛错：${error.message}`,
      error,
      spec: captured,
      file: CLIENT_FILE,
    }
    return cached
  }

  if (!mod || typeof mod !== 'object') {
    cached = { status: 'error', reason: 'factory(require) 返回值不是对象（契约 §11.2）', spec: captured, file: CLIENT_FILE }
    return cached
  }
  if (typeof mod.apply !== 'function') {
    cached = { status: 'error', reason: 'factory 返回值缺少 apply 函数（契约 §11.2 / §13.2）', spec: captured, mod, file: CLIENT_FILE }
    return cached
  }
  if (!mod.__internals || typeof mod.__internals !== 'object') {
    cached = {
      status: 'error',
      reason: 'factory 返回值缺少 __internals（契约 §11.2：tester 依赖该出口）',
      spec: captured,
      mod,
      file: CLIENT_FILE,
    }
    return cached
  }

  cached = { status: 'ok', spec: captured, mod, internals: mod.__internals, require, file: CLIENT_FILE }
  return cached
}

/** 只对"尚未实现"返回 skip 原因；已实现但坏掉时抛错（让测试失败）。 */
export function clientGate(client) {
  if (client.status === 'ok') return false
  if (client.status === 'missing') return client.reason
  throw new Error(client.reason)
}

/** 取 __internals 上的函数导出；缺一个都视为契约违例。 */
export function internalsFn(client, name) {
  if (client.status !== 'ok') throw new Error(client.reason)
  const v = client.internals[name]
  if (typeof v !== 'function') {
    throw new Error(`__internals.${name} 缺失或不是函数（契约 §11.2）`)
  }
  return v
}

/** 取 __internals 上的常量导出。 */
export function internalsValue(client, name) {
  if (client.status !== 'ok') throw new Error(client.reason)
  if (!(name in client.internals)) {
    throw new Error(`__internals.${name} 缺失（契约 §11.2）`)
  }
  return client.internals[name]
}
