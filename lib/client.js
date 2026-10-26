/**
 * dsh-terminal-panel · Client 半端（单文件自包含 classic script）
 *
 * 形态约束（contract §12.5 / F4/F5）：
 * - 本文件是宿主 `window.__ModuleLoader__` 的懒工厂注册脚本，id 必须等于包名。
 * - 不能 import / require 任何相对文件或其它 Client 包；只能 `require('react')`。
 * - 无 JSX：全部 `React.createElement`。
 * - 样式通过 `document.head.appendChild(<style data-plugin-css=...>)` 注入，
 *   在 `apply` 的 `ctx.effect` 清理函数里移除（无 `styles.insert` 内建可用）。
 *
 * 数据来源：Host 半端 HTTP 路由 `POST /terminal-panel/rpc`（contract §4）。
 */
window.__ModuleLoader__.load({
  id: 'dsh-terminal-panel',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'terminal-panel'

    /** 宿主主题令牌拼装用的常量（样式见 STYLE_CSS）。 */
    const CSS_MARK = 'dsh-terminal-panel/panel.css'

    const zh = {
      'tab.terminal': '终端',
      'panel.loading': '正在连接 Host 半端…',
      'panel.retry': '重试',
      'panel.empty.title': '本会话还没有命令行活动',
      'panel.empty.desc': '模型执行 bash、后台任务或持久终端时，命令与实时输出会出现在这里。',
    }
    const en = {
      'tab.terminal': 'Terminal',
      'panel.loading': 'Connecting to the Host half…',
      'panel.retry': 'Retry',
      'panel.empty.title': 'No command-line activity in this session yet',
      'panel.empty.desc': 'Commands and live output from bash, background jobs and persistent terminals appear here.',
    }

    /**
     * 最小样式表（骨架版）：只用 `--dsw-alias-*` 主题令牌，暗/亮主题自动适配。
     * 后续模块的类名统一以 `tp-` 前缀追加到本字符串。
     */
    const STYLE_CSS = [
      '.tp-root{box-sizing:border-box;display:flex;flex-direction:column;min-height:0;height:100%;width:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;overflow:hidden}',
      '.tp-banner{display:flex;align-items:center;gap:8px;padding:6px 12px;font-size:12px;line-height:18px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.tp-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1 1 auto;min-height:0;padding:32px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.tp-state-glyph{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:15px}',
      '.tp-state-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}',
      '.tp-state-desc{max-width:420px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      '.tp-btn{box-sizing:border-box;font:inherit;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm);padding:3px 10px;font-size:12px;line-height:18px;cursor:pointer}',
      '.tp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.tp-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.tp-num{font-variant-numeric:tabular-nums}',
    ].join('')

    /** 由 `apply` 的 effect 调用；重复 materialize 时去重，dispose 时移除。 */
    function insertStyle() {
      if (typeof document === 'undefined' || document.head === undefined) return () => {}
      const selector = 'style[data-plugin-css=' + JSON.stringify(CSS_MARK) + ']'
      const existing = document.querySelector(selector)
      if (existing !== null) return () => {}
      const el = document.createElement('style')
      el.dataset.plugin = 'dsh-terminal-panel'
      el.dataset.pluginCss = CSS_MARK
      el.textContent = STYLE_CSS
      document.head.appendChild(el)
      return () => {
        if (el.parentNode !== null) el.parentNode.removeChild(el)
      }
    }

    /** 等宽终端字形（内联 SVG，不用 emoji / 字符占位）。 */
    function TerminalGlyph() {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: 22,
        height: 22,
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block' },
      }, h('path', {
        d: 'M4 6.5h16M7 10.5l3 2.5-3 2.5M12.5 15.5H17',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /**
     * View 组件（骨架版）：只渲染加载/空态。
     * 正式数据流、列/行/筛选/弹窗在后续提交中补齐；本骨架用于尽早验证
     * 「tab 能注册出来 + 空态能渲染」。
     */
    function TerminalPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => (zh[key] !== undefined ? zh[key] : key)
      const sessionId = props.sessionId
      const loaded = sessionId !== undefined && sessionId !== null && sessionId !== ''

      if (!loaded) {
        return h('div', { className: 'tp-root', 'data-plugin': 'dsh-terminal-panel' },
          h('div', { className: 'tp-state' },
            h('div', { className: 'tp-state-glyph' }, h(TerminalGlyph)),
            h('div', { className: 'tp-state-title' }, t('panel.loading'))))
      }
      return h('div', { className: 'tp-root', 'data-plugin': 'dsh-terminal-panel' },
        h('div', { className: 'tp-state' },
          h('div', { className: 'tp-state-glyph' }, h(TerminalGlyph)),
          h('div', { className: 'tp-state-title' }, t('panel.empty.title')),
          h('div', { className: 'tp-state-desc' }, t('panel.empty.desc'))))
    }

    /**
     * 插件装配：一切注册都走 `ctx.effect`，卸载时全部撤销。
     * @param ctx 插件根上下文（inject: slots / locale）。
     */
    function apply(ctx) {
      ctx.effect(() => insertStyle(), 'terminal-panel: styles')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'terminal-panel: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'terminal-panel',
        order: 30,
        locale: NS,
        label: () => t('tab.terminal'),
        inject: (sessionId) => ({ t, sessionId }),
      }, TerminalPanel))
    }

    const inject = ['slots', 'locale']

    // 纯函数导出（contract §11.2）在后续提交中逐块补齐，tester 直接按签名取用。
    const __internals = {}

    return { inject, apply, __internals }
  },
})
