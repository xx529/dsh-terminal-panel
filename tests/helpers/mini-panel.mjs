// 迷你渲染器（测试专用，无第三方依赖）：把 client factory 的 View 用「最小 React」渲染成
// 可检查的元素树，用于验证浮层 fixed 定位 / 视口夹取 / 交互（T76）。
//
// 能力边界（与真实浏览器差异，报告需如实标注）：
// - 只实现组件函数执行 + hooks（useState/useEffect/useRef/useMemo/useCallback/…）+ host 节点树；
// - 不实现真实布局：host 节点 getBoundingClientRect 由 rig.buttonRect 提供（锚点按钮）；
// - 效果按 deps 比较，无 deps 的 effect 每轮重跑（与 React 语义一致）；settle() 有限轮收敛；
// - fetch 返回 pending Promise，避免真实轮询；window/document 用可记录监听器的 fake。
import { readFile } from 'node:fs/promises'
import { CLIENT_FILE } from './paths.mjs'

const VERSION_RE = /const SESSION_CACHE_VERSION = '([^']+)'/

export async function createMiniPanel(client, options = {}) {
  if (client.status !== 'ok') throw new Error(client.reason)
  const sessionId = typeof options.sessionId === 'string' ? options.sessionId : 'root-1'
  const sourceText = await readFile(CLIENT_FILE, 'utf8')
  const version = VERSION_RE.exec(sourceText)?.[1] ?? 'v11-1'

  const rig = {
    buttonRect: { left: 100, top: 100, right: 200, bottom: 130, width: 100, height: 30 },
    innerWidth: 800,
    innerHeight: 600,
    wrapContains: false,
    reducedMotion: false,
    layout: new Map(),
    metrics: { transformWrites: [], flipWrites: 0 },
    winListeners: new Map(),
    docListeners: new Map(),
  }
  const timers = new Map()
  let timerSeq = 0
  let clock = 0
  function fakeSetTimeout(fn, ms) {
    timerSeq += 1
    timers.set(timerSeq, { fn, ms: Number(ms) || 0, due: clock + (Number(ms) || 0) })
    return timerSeq
  }
  function fakeClearTimeout(id) { timers.delete(id) }
  function advance(ms) {
    clock += Number(ms) || 0
    const due = [...timers.entries()].filter(([, timer]) => timer.due <= clock).sort((a, b) => a[1].due - b[1].due)
    for (const [id, timer] of due) {
      timers.delete(id)
      try { timer.fn() } catch { /* 测试桩静默 */ }
    }
    return due.length
  }

  /* ---------------- mini React ---------------- */
  const states = new Map()
  const refs = new Map()
  const effectPrev = new Map()
  let dirty = false
  let effectQueue = []
  let typeCounts = new Map()
  let currentKey = ''
  let hookIndex = 0
  let lastTree = null

  const flatten = (list) => (Array.isArray(list) ? list.flat(Infinity) : [list])
  const hookKey = () => `${currentKey}#${hookIndex++}`
  const depsEqual = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const react = {
    Fragment: Symbol.for('react.fragment'),
    createElement(type, props, ...children) { return { $$typeof: 'el', type, props: props || {}, children: flatten(children) } },
    cloneElement(el, props, ...children) { return { ...el, props: { ...(el.props || {}), ...(props || {}) }, children: children.length ? flatten(children) : el.children } },
    isValidElement: (v) => Boolean(v && typeof v === 'object' && v.$$typeof === 'el'),
    memo: (component) => component,
    forwardRef: (render) => (props) => render(props, { current: null }),
    createContext: (defaultValue) => ({ Provider: (props) => props.children, Consumer: () => null, _currentValue: defaultValue }),
    createRef: () => ({ current: null }),
    useState(init) {
      const key = hookKey()
      if (!states.has(key)) states.set(key, { value: typeof init === 'function' ? init() : init })
      const entry = states.get(key)
      const set = (next) => {
        const value = typeof next === 'function' ? next(entry.value) : next
        if (Object.is(value, entry.value)) return
        entry.value = value
        dirty = true
      }
      return [entry.value, set]
    },
    useReducer(reducer, initArg, init) {
      const key = hookKey()
      if (!states.has(key)) states.set(key, { value: typeof init === 'function' ? init(initArg) : initArg })
      const entry = states.get(key)
      return [entry.value, (action) => {
        const value = reducer(entry.value, action)
        if (Object.is(value, entry.value)) return
        entry.value = value
        dirty = true
      }]
    },
    useRef(init) {
      const key = hookKey()
      if (!refs.has(key)) refs.set(key, { current: init })
      return refs.get(key)
    },
    useEffect(fn, deps) { effectQueue.push({ key: hookKey(), fn, deps }) },
    useLayoutEffect(fn, deps) { effectQueue.push({ key: hookKey(), fn, deps }) },
    useInsertionEffect() {},
    useMemo(factory) { hookIndex += 1; return factory() },
    useCallback(fn) { hookIndex += 1; return fn },
    useContext(context) { hookIndex += 1; return context?._currentValue ?? null },
    useId() { hookIndex += 1; return 'mini-id' },
    useTransition() { hookIndex += 1; return [false, (fn) => fn?.()] },
    useDeferredValue(value) { hookIndex += 1; return value },
    useSyncExternalStore(_subscribe, getSnapshot) { hookIndex += 1; return getSnapshot() },
    useImperativeHandle() {},
    useDebugValue() {},
    startTransition(fn) { fn?.() },
    Children: {
      map: (children, fn) => (Array.isArray(children) ? children : [children]).map(fn),
      toArray: (children) => (Array.isArray(children) ? children : [children]),
      count: (children) => (Array.isArray(children) ? children.length : children == null ? 0 : 1),
      only: (children) => children,
    },
  }

  function makeHostNode(tag, props) {
    const isScopeButton = typeof props.className === 'string' && props.className.includes('tp-scope-btn')
    const runId = typeof props['data-run-id'] === 'string' ? props['data-run-id'] : undefined
    const layoutRect = runId !== undefined ? (rig.layout.get(runId) ?? { left: 0, top: 0, width: 352, height: 342 }) : null
    const styleTarget = { ...(props.style || {}) }
    const style = new Proxy(styleTarget, {
      set(target, prop, value) {
        if (prop === 'transform') {
          rig.metrics.transformWrites.push(String(value))
          if (/^translate\(/.test(String(value))) rig.metrics.flipWrites += 1
        }
        target[prop] = value
        return true
      },
    })
    const node = {
      tagName: String(tag).toUpperCase(),
      props,
      style,
      dataset: {},
      className: typeof props.className === 'string' ? props.className : '',
      children: [],
      offsetLeft: layoutRect !== null ? layoutRect.left : 0,
      offsetTop: layoutRect !== null ? layoutRect.top : 0,
      offsetWidth: layoutRect !== null ? layoutRect.width : 0,
      offsetHeight: layoutRect !== null ? layoutRect.height : 0,
      getBoundingClientRect() {
        return isScopeButton
          ? { ...rig.buttonRect, width: rig.buttonRect.right - rig.buttonRect.left, height: rig.buttonRect.bottom - rig.buttonRect.top }
          : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
      },
      contains(target) { return typeof target === 'object' && target !== null && target.__inScopeWrap === true && rig.wrapContains },
      addEventListener() {},
      removeEventListener() {},
      focus() {},
    }
    if (typeof props.ref === 'function') props.ref(node)
    return node
  }

  function renderNode(el, path) {
    if (el === null || el === undefined || typeof el === 'boolean') return null
    if (Array.isArray(el)) return el.map((child, index) => renderNode(child, `${path}.${index}`))
    if (typeof el === 'string' || typeof el === 'number') return String(el)
    if (typeof el !== 'object' || el.$$typeof !== 'el') return null
    const type = el.type
    if (type === react.Fragment) return el.children.map((child, index) => renderNode(child, `${path}.f${index}`))
    if (typeof type === 'function') {
      const seq = typeCounts.get(type) || 0
      typeCounts.set(type, seq + 1)
      const prevKey = currentKey
      const prevHook = hookIndex
      currentKey = `${type.name || 'anon'}#${seq}`
      hookIndex = 0
      let out
      try {
        out = type({ ...(el.props || {}), children: el.children })
      } finally {
        currentKey = prevKey
        hookIndex = prevHook
      }
      return renderNode(out, `${path}()`)
    }
    const host = makeHostNode(type, el.props || {})
    host.children = el.children.map((child, index) => renderNode(child, `${path}.${index}`)).flat(Infinity).filter(Boolean)
    return host
  }

  function renderOnce() {
    dirty = false
    effectQueue = []
    currentKey = 'root'
    hookIndex = 0
    typeCounts = new Map()
    lastTree = renderNode(react.createElement(rig.rootType, rig.rootProps), 'root')
    return lastTree
  }

  function runEffects() {
    const queued = effectQueue
    for (const { key, fn, deps } of queued) {
      // 默认只运行 Toolbar 的下拉定位/交互 effect：避免 usePanelSession 的轮询/定时器在
      // 迷你环境中启动（那会留下 RPC timeout/真实 timer，导致测试进程不退出）。
      // FLIP/ghost 用例通过 effectFilter 放行「FLIP/ghost 清理」这几条 effect（仍跳过轮询）。
      if (typeof options.effectFilter === 'function' ? !options.effectFilter(key, fn) : !key.startsWith('Toolbar#')) continue
      const prev = effectPrev.get(key)
      const same = Array.isArray(deps) && Array.isArray(prev?.deps) && depsEqual(prev.deps, deps)
      if (prev !== undefined && same) continue
      if (prev && typeof prev.cleanup === 'function') prev.cleanup()
      const cleanup = fn()
      effectPrev.set(key, typeof cleanup === 'function' ? { deps, cleanup } : { deps })
    }
    return dirty
  }

  function settle(rounds = 4) {
    let tree = renderOnce()
    for (let i = 0; i < rounds; i += 1) {
      runEffects()
      tree = renderOnce()
    }
    return tree
  }

  /* ---------------- fake window/document ---------------- */
  const makeDocNode = (tag) => {
    const node = {
      tagName: String(tag).toUpperCase(), style: {}, dataset: {}, textContent: '', parentNode: null, children: [],
      appendChild(child) { child.parentNode = node; node.children.push(child); return child },
      removeChild(child) { const index = node.children.indexOf(child); if (index >= 0) node.children.splice(index, 1); child.parentNode = null; return child },
      remove() { if (node.parentNode !== null) node.parentNode.removeChild(node) },
      setAttribute() {},
    }
    return node
  }
  const doc = {
    visibilityState: 'visible',
    addEventListener(type, fn) { if (!rig.docListeners.has(type)) rig.docListeners.set(type, new Set()); rig.docListeners.get(type).add(fn) },
    removeEventListener(type, fn) { rig.docListeners.get(type)?.delete(fn) },
    querySelector: () => null,
    createElement: (tag) => makeDocNode(tag),
    head: makeDocNode('head'),
    body: makeDocNode('body'),
    documentElement: { style: { setProperty() {} } },
  }
  const win = {
    get innerWidth() { return rig.innerWidth },
    get innerHeight() { return rig.innerHeight },
    addEventListener(type, fn) { if (!rig.winListeners.has(type)) rig.winListeners.set(type, new Set()); rig.winListeners.get(type).add(fn) },
    removeEventListener(type, fn) { rig.winListeners.get(type)?.delete(fn) },
    matchMedia: () => ({ matches: rig.reducedMotion === true }),
    getComputedStyle: (el) => ({ transform: el && el.style && typeof el.style.transform === 'string' ? el.style.transform : '' }),
    requestAnimationFrame: (fn) => { fn?.(0); return 1 },
    cancelAnimationFrame() {},
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
  }

  const saved = {
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    fetch: globalThis.fetch,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  }
  const noopTimer = () => 0
  globalThis.window = win
  globalThis.document = doc
  globalThis.fetch = () => new Promise(() => {})
  globalThis.requestAnimationFrame = win.requestAnimationFrame
  globalThis.setTimeout = fakeSetTimeout
  globalThis.clearTimeout = fakeClearTimeout
  globalThis.setInterval = noopTimer
  globalThis.clearInterval = () => {}

  const restoreGlobals = () => {
    for (const [key, descriptor] of Object.entries(saved)) {
      if (key === 'window' || key === 'document') {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      } else if (key === 'fetch') {
        if (descriptor === undefined) delete globalThis.fetch
        else globalThis.fetch = descriptor
      } else {
        globalThis[key] = descriptor
      }
    }
  }

  try {
    const mod = await client.spec.factory((id) => {
      if (id === 'react') return react
      throw new Error(`mini require('${id}') 非法（契约只允许 react）`)
    })
    const registered = []
    const lifecycle = []
    const slots = {
      inject(_name, cb) {
        const result = cb()
        if (typeof result === 'function') lifecycle.push(result)
        return result
      },
      register(opts, View) { registered.push({ opts, View }); return { dispose() {} } },
    }
    const locale = {
      register() { return { dispose() {} } },
      bind() { return (key) => key },
      t(_ns, key) { return key },
    }
    const ctx = {
      get(name) { return name === 'slots' ? slots : name === 'locale' ? locale : undefined },
      slots,
      locale,
      effect(fn) { const dispose = fn(); lifecycle.push(dispose); return dispose },
    }
    const applied = mod.apply(ctx)
    if (applied !== undefined) throw new Error('apply 必须返回 undefined')
    if (registered.length !== 1) throw new Error('View 必须注册一次')
    rig.rootType = registered[0].View
    rig.rootProps = { sessionId, t: (key) => key }

    const baseView = options.view ?? {
      sessionId,
      status: 'ready',
      revision: 1,
      sessions: [
        { sessionId, role: 'root', displayName: 'Root', hasActivity: false, accent: 'none' },
        { sessionId: 'child-1', parentSessionId: sessionId, role: 'subagent', displayName: 'Child', hasActivity: true, accent: 'subagent' },
      ],
      runs: {},
      order: { running: [], completed: [] },
      columns: {},
      group: { completedCollapsed: true, expandedIds: [] },
      filter: { kind: 'all', sessionIds: null, search: '', autoExpandNew: true, showCompleted: true },
      availability: { bash: { available: true }, jobs: { available: true }, terminals: { available: true }, tree: { available: true } },
      droppedLines: {},
      pendingFrameRevision: 0,
      hostOffset: 0,
    }
    mod.__internals.SESSION_CACHE.set(`${sessionId}@v${version}`, { view: baseView, cursors: {}, revision: baseView.revision }, Date.now())

    const tree = settle()
    const instance = {
      rig,
      setView(nextView) {
        for (const entry of states.values()) {
          const value = entry.value
          if (value !== null && typeof value === 'object' && value.sessionId === sessionId
            && typeof value.runs === 'object' && value.order !== undefined && value.filter !== undefined) {
            entry.value = nextView
            dirty = true
            return true
          }
        }
        throw new Error('找不到 TerminalPanel 的 view state（迷你渲染器限制）')
      },
      advance,
      timers: () => timers.size,
      clock: () => clock,
      doc,
      win,
      tree: () => lastTree,
      renderOnce,
      runEffects,
      settle,
      buildTree: (root = tree) => root,
      findAll(predicate) {
        const out = []
        const walk = (nodes) => {
          const list = Array.isArray(nodes) ? nodes.flat(Infinity) : [nodes]
          for (const node of list) {
            if (node === null || node === undefined || typeof node === 'string') continue
            predicate(node) && out.push(node)
            if (node.children) walk(node.children)
          }
        }
        walk(lastTree)
        return out
      },
      byClass(className) { return instance.findAll((node) => node.className === className) },
      scopeButton() { return instance.findAll((node) => node.className.includes('tp-scope-btn'))[0] },
      openScope() {
        const button = instance.scopeButton()
        if (!button) throw new Error('找不到会话范围按钮')
        button.props.onClick()
        settle()
        return { button: instance.scopeButton(), menu: instance.byClass('tp-scope-menu')[0] }
      },
      fireWindow(type) {
        for (const fn of rig.winListeners.get(type) ?? []) fn({ type, target: null })
      },
      fireDocument(type, event = {}) {
        for (const fn of rig.docListeners.get(type) ?? []) fn({ type, stopPropagation() {}, preventDefault() {}, ...event })
      },
      close() {
        for (const cleanup of lifecycle) if (typeof cleanup === 'function') cleanup()
      },
      dispose() {
        instance.close()
        restoreGlobals()
      },
      pendingTimers: 0,
      restoreGlobals,
    }
    return instance
  } catch (error) {
    restoreGlobals()
    throw error
  }
}
