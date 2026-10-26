// 极简 React stub（测试专用，不装依赖、不做渲染）。
//
// 用途：lib/client.js 是 classic-script factory，通过 factory(require) 取 react。
// 我们只需要 factory 能执行完并返回 { inject, apply, __internals }；
// 组件函数只定义不渲染，因此 hook 均可用无害 stub（返回稳定形状）。
// 若宿主要求越界 API，stub 的兜底会返回占位组件，不会因缺符号抛错。

function makeReactStub() {
  const placeholder = () => null

  const react = {
    createElement(type, props, ...children) {
      return { $$typeof: 'react.element', type, props: props ?? {}, children }
    },
    cloneElement(el, props, ...children) {
      return { ...el, props: { ...(el?.props ?? {}), ...(props ?? {}) }, children }
    },
    isValidElement(v) {
      return Boolean(v && typeof v === 'object' && v.$$typeof === 'react.element')
    },
    Fragment: Symbol.for('react.fragment'),
    StrictMode: placeholder,
    Suspense: placeholder,
    memo(component) {
      return component
    },
    forwardRef(render) {
      return Object.assign((props) => render(props, { current: null }), { $$forwardRef: true })
    },
    createContext(defaultValue) {
      const context = {
        $$typeof: Symbol.for('react.context'),
        _currentValue: defaultValue,
        Provider: placeholder,
        Consumer: placeholder,
        displayName: 'StubContext',
      }
      return context
    },
    createRef() {
      return { current: null }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useReducer(reducer, initialArg, init) {
      const value = typeof init === 'function' ? init(initialArg) : initialArg
      return [value, () => {}]
    },
    useRef(initial) {
      return { current: initial }
    },
    useEffect() {},
    useLayoutEffect() {},
    useInsertionEffect() {},
    useMemo(factory) {
      return factory()
    },
    useCallback(fn) {
      return fn
    },
    useContext(context) {
      return context?._currentValue ?? null
    },
    useId() {
      return 'stub-id'
    },
    useTransition() {
      return [false, (fn) => (typeof fn === 'function' ? fn() : undefined)]
    },
    useDeferredValue(v) {
      return v
    },
    useSyncExternalStore(_subscribe, getSnapshot) {
      return getSnapshot()
    },
    useImperativeHandle() {},
    useDebugValue() {},
    startTransition(fn) {
      if (typeof fn === 'function') fn()
    },
    Children: {
      map(children, fn) {
        return Array.isArray(children) ? children.map(fn) : []
      },
      toArray(children) {
        return Array.isArray(children) ? children : [children]
      },
      count(children) {
        return Array.isArray(children) ? children.length : children == null ? 0 : 1
      },
      only(children) {
        return children
      },
    },
    PureComponent: class PureComponent {
      constructor(props) {
        this.props = props
      }
      render() {
        return null
      }
    },
    Component: class Component {
      constructor(props) {
        this.props = props
      }
      render() {
        return null
      }
      setState() {}
    },
  }

  // 未知 API → 占位组件（记录访问，便于诊断"实现引用了 stub 未覆盖的 API"）
  const accessed = new Set()
  return new Proxy(react, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      if (typeof prop === 'symbol') return undefined
      accessed.add(prop)
      const fallback = placeholder
      target[prop] = fallback
      return fallback
    },
    has(target, prop) {
      return prop in target
    },
  })
}

/** factory(require) 的 require 实现：只允许 'react'，其它按契约报错。 */
export function createRequire() {
  const react = makeReactStub()
  const calls = []
  function require(id) {
    calls.push(id)
    if (id === 'react') return react
    // 契约 §3.2/§12.5：client 半不得 require 相对路径或其它 Client 包。
    throw new Error(`client factory 非法 require('${id}')（契约 §3.2/§12.5：只允许 react）`)
  }
  require.calls = calls
  return require
}
