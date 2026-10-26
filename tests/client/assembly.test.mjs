// Client 装配测试（契约 §11.3 / §13.2）：apply 注册 conversation.view 一次且 id/order/label 正确；
// dispose 无残留（slot/locale/定时器/监听），样式用自插 <style data-plugin> 且不得使用动态包符号。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient } from '../helpers/load-client.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

/* ---------------- mock client ctx ---------------- */
function resolveKey(dict, key) {
  const ns = dict?.zh ?? dict?.en ?? dict
  if (!ns || typeof key !== 'string') return undefined
  if (Object.prototype.hasOwnProperty.call(ns, key)) return ns[key]
  let cur = ns
  for (const part of key.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined
    cur = cur[part]
  }
  return typeof cur === 'string' ? cur : undefined
}

function makeClientCtx() {
  const registered = []
  const slotDisposes = []
  const effects = []
  const localeRegs = []
  const injectCalls = []
  const lifecycle = []
  const dicts = new Map()

  const slots = {
    inject(name, cb) {
      injectCalls.push(name)
      // cordis 的 slots.inject 由 ctx 生命周期托管（内部走 effect）；mock 记录 disposer 以模拟 unload 清理。
      const result = cb()
      if (typeof result === 'function') lifecycle.push(result)
      else if (result && typeof result.dispose === 'function') lifecycle.push(() => result.dispose())
      return result
    },
    register(opts, View) {
      const entry = { opts, View }
      registered.push(entry)
      const dispose = () => {
        const i = registered.indexOf(entry)
        if (i >= 0) registered.splice(i, 1)
        slotDisposes.push(true)
      }
      return { dispose }
    },
  }

  const locale = {
    register(ns, dict) {
      dicts.set(ns, dict)
      localeRegs.push({ ns, dict })
      return {
        dispose() {
          dicts.delete(ns)
        },
      }
    },
    bind(ns) {
      return (key) => resolveKey(dicts.get(ns), key) ?? key
    },
    t(ns, key) {
      return resolveKey(dicts.get(ns), key) ?? key
    },
  }

  const ctx = {
    get(name) {
      if (name === 'slots') return slots
      if (name === 'locale') return locale
      return undefined
    },
    slots,
    locale,
    effect(fn) {
      const dispose = fn()
      effects.push(dispose)
      return dispose
    },
  }
  return { ctx, registered, slotDisposes, effects, localeRegs, injectCalls, lifecycle }
}

function makeDocumentStub() {
  const listeners = new Map()
  const doc = {
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
    createElement(tag) {
      const node = {
        tagName: String(tag).toUpperCase(),
        style: {},
        dataset: {},
        textContent: '',
        parentNode: null,
        children: [],
        setAttribute() {},
        appendChild(child) {
          child.parentNode = node
          node.children.push(child)
          return child
        },
        removeChild(child) {
          const i = node.children.indexOf(child)
          if (i >= 0) node.children.splice(i, 1)
          child.parentNode = null
          return child
        },
        remove() {
          if (node.parentNode !== null) node.parentNode.removeChild(node)
        },
      }
      return node
    },
    head: null,
    body: null,
    __listeners: listeners,
  }
  doc.head = doc.createElement('head')
  doc.body = doc.createElement('body')
  return doc
}

function installDocument() {
  const prev = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const stub = makeDocumentStub()
  globalThis.document = stub
  return {
    stub,
    restore() {
      if (prev) Object.defineProperty(globalThis, 'document', prev)
      else delete globalThis.document
    },
  }
}

function trackTimers() {
  const active = new Set()
  const realSetInterval = globalThis.setInterval
  const realClearInterval = globalThis.clearInterval
  const realSetTimeout = globalThis.setTimeout
  const realClearTimeout = globalThis.clearTimeout
  globalThis.setInterval = (fn, ms, ...args) => {
    const id = realSetInterval(fn, ms, ...args)
    active.add(id)
    return id
  }
  globalThis.clearInterval = (id) => {
    active.delete(id)
    return realClearInterval(id)
  }
  globalThis.setTimeout = (fn, ms, ...args) => {
    const id = realSetTimeout(fn, ms, ...args)
    active.add(id)
    return id
  }
  globalThis.clearTimeout = (id) => {
    active.delete(id)
    return realClearTimeout(id)
  }
  return {
    active,
    restore() {
      globalThis.setInterval = realSetInterval
      globalThis.clearInterval = realClearInterval
      globalThis.setTimeout = realSetTimeout
      globalThis.clearTimeout = realClearTimeout
    },
  }
}

function applyClient() {
  if (client.status !== 'ok') assert.fail(client.reason)
  const mock = makeClientCtx()
  const doc = installDocument()
  const timers = trackTimers()
  try {
    const result = client.mod.apply(mock.ctx)
    if (result && typeof result.then === 'function') assert.fail('apply 不应是 async（契约 §13.2 apply(ctx) 同步注册）')
    return { ...mock, doc, timers }
  } finally {
    timers.restore()
    doc.restore()
  }
}

/* ---------------- 静态检查：不得使用动态包符号，样式必须自插 ---------------- */
test('静态: client.js 不得使用 host.call / styles.insert（那是动态包符号）', { skip }, async () => {
  const src = await readFile(CLIENT_FILE, 'utf8')
  assert.ok(!/\bhost\s*\.\s*call\s*\(/.test(src), '不得使用 host.call（Lead 已核实：profile bundle 无该符号）')
  assert.ok(!/\bstyles\s*\.\s*insert\s*\(/.test(src), '不得使用 styles.insert（无该符号）')
  assert.ok(!/require\s*\(\s*['"]@deepseek-ai/.test(src), '不得 require 其它 Client 包（契约 §3.2）')
})

test('静态: 样式自插并带稳定 data-plugin* 标记（便于清理与避让）', { skip }, async () => {
  const src = await readFile(CLIENT_FILE, 'utf8')
  assert.ok(/data-plugin/.test(src), '样式节点必须带 data-plugin* 标记，便于卸载时精确清理')
  assert.ok(/dsh-terminal-panel/.test(src), '标记值应含插件包名')
  assert.ok(/\.removeChild\(|\.remove\(\)/.test(src), '样式节点必须在卸载时移除')
})

/* ---------------- apply 注册 ---------------- */
test('apply: 注册 conversation.view 一次，id/order/label/name 正确（§11.3）', { skip }, () => {
  const applied = applyClient()
  assert.equal(applied.registered.length, 1, `conversation.view 只能注册一次，实际 ${applied.registered.length}`)
  const { opts } = applied.registered[0]
  assert.equal(opts.name, 'conversation.view')
  assert.equal(opts.id, 'terminal-panel')
  assert.equal(opts.order, 30)
  assert.equal(typeof opts.label, 'function', 'label 必须是函数（locale 变化时重算）')
  assert.equal(opts.label(), '终端', `tab 文案必须是「终端」，实际 ${JSON.stringify(opts.label())}`)
  assert.deepEqual(applied.injectCalls, ['conversation.view'], 'slot 注入点必须是 conversation.view')
  assert.equal(typeof applied.registered[0].View, 'function', '必须注册 View 组件')
})

test('apply: label 走 locale 注册（不硬编码中文之外的副作用），zh 命中「终端」', { skip }, () => {
  const applied = applyClient()
  assert.ok(applied.localeRegs.length >= 1, 'apply 内必须 ctx.locale.register 内联字典（契约 §13.2/F20）')
  const dict = applied.localeRegs[0].dict
  assert.ok(dict && (dict.zh || dict.en), 'locale 字典至少含 zh 或 en')
  const zhText = resolveKey(dict, 'tab.terminal')
  assert.ok(typeof zhText === 'string' && zhText.length > 0, '字典必须提供 tab.terminal')
})

test('apply: inject(sessionId) 返回附加 props，且不覆盖 owner 保留 props（F28/§11.3）', { skip }, () => {
  const applied = applyClient()
  const { opts } = applied.registered[0]
  assert.equal(typeof opts.inject, 'function', 'conversation.view 注册必须提供 inject(sessionId)')
  const props = opts.inject('sess-42')
  assert.ok(props && typeof props === 'object', 'inject 必须返回对象（可为空对象）')
  // 契约 v2 F28：sessionId/t 等保留名由 renderer 以 owner props 注入并优先；插件 inject 不得覆盖。
  for (const reserved of ['sessionId', 't']) {
    if (reserved in props) assert.equal(props[reserved], undefined, `inject 不得返回保留 prop ${reserved}（会被 owner props 覆盖）`)
  }
  assert.equal(props.sessionId, undefined, 'sessionId 由 renderer 注入（F28），插件不重复返回')
})

test('apply: 无泄漏——dispose 后 slot 释放、locale 撤销、定时器/监听清零（§11.3）', { skip }, () => {
  const applied = applyClient()
  assert.equal(applied.registered.length, 1)
  // 执行 ctx.effect 收集到的清理函数（cordis dispose 语义）
  for (const dispose of applied.effects.splice(0)) {
    if (typeof dispose === 'function') dispose()
    else if (dispose && typeof dispose.dispose === 'function') dispose.dispose()
  }
  // 模拟 cordis 在插件 unload 时自动清理 slot 注入与其注册
  for (const dispose of applied.lifecycle.splice(0)) {
    if (typeof dispose === 'function') dispose()
  }
  assert.equal(applied.registered.length, 0, 'dispose 后不得残留 conversation.view 注册')
  assert.ok(applied.slotDisposes.length >= 1, '必须调用注册返回的 dispose（或等价清理）')
  assert.equal(applied.timers.active.size, 0, `dispose 后仍有活动定时器 ${applied.timers.active.size} 个`)
  const remainingListeners = [...applied.doc.stub.__listeners.values()].reduce((n, set) => n + set.size, 0)
  assert.equal(remainingListeners, 0, `dispose 后仍有 ${remainingListeners} 个 document 监听器`)
})
