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
      'stats.summary': '{running} 个进行中 · {records} 条记录 · {sessions} 个会话',
      'kind.all': '全部',
      'kind.bash': 'Bash',
      'kind.job': '后台任务',
      'kind.terminal': '终端',
      'kind.short.bash': 'BASH',
      'kind.short.job': 'JOB',
      'kind.short.terminal': 'TERM',
      'role.current': '当前会话',
      'role.subagent': '子代理',
      'role.teammate': '队友',
      'status.running': '运行中',
      'status.stopping': '停止中',
      'status.completed': '完成',
      'status.failed': '失败',
      'status.killed': '已停止',
      'scope.all': '全部会话',
      'scope.count': '{n} 个会话',
      'scope.note': '仅显示有命令行活动的会话',
      'scope.current': '当前会话',
      'scope.empty': '没有可筛选的会话',
      'search.placeholder': '搜索命令 / 输出',
      'search.clear': '清除搜索',
      'filter.autoExpand': '新任务自动展开',
      'filter.clear': '清空已完成',
      'filter.clear.none': '没有可清空的已完成记录',
      'filter.cleared': '已清空 {n} 条已完成',
      'filter.undo': '撤销',
      'filter.reset': '清除筛选',
      'filter.empty': '当前筛选没有匹配的命令行活动',
      'group.completed': '已完成',
      'group.expand': '展开已完成',
      'group.collapse': '收起已完成',
      'running.title': '进行中',
      'running.hint': '卡片可拖右缘调整 · ⤢ 最大化 · 自动换行铺满',
      'running.more': '还有 {n} 列',
      'running.none': '没有进行中的任务',
      'cmd.none': '（无命令行）',
      'input.label': '输入',
      'input.terminalName': '终端',
      'output.empty': '等待输出…',
      'output.metaOnly': '该任务只提供元信息，读不到输出',
      'output.tier3': '非实时全量（模型读写时看到的片段）',
      'output.truncated': '已截断较早输出',
      'actions.stop': '停止',
      'actions.stopConfirm': '确认停止？',
      'actions.maximize': '最大化',
      'actions.copyAll': '复制全部',
      'actions.copyCommand': '复制命令',
      'actions.copyOutput': '复制输出',
      'actions.copied': '已复制',
      'actions.copyFailed': '复制失败',
      'actions.close': '关闭',
      'actions.more': '更多',
      'actions.pin': '固定展开',
      'actions.unpin': '取消固定',
      'actions.resize': '拖动调整列宽，双击复位',
      'linger.in': '{n}s 后移入已完成',
      'linger.collapse': '收起',
      'follow.following': '跟随中',
      'follow.paused': '已暂停跟随',
      'follow.newOutput': '{n} 条新输出 ↓',
      'follow.resume': '滚回底部恢复跟随',
      'finalOnly': '仅终态',
      'finalOnly.tip': '该来源只提供终态输出',
      'stopFinalOnly.tip': '仅终态，无法从此面板停止',
      'output.finalOnly': '该任务只提供终态输出，完成前没有过程输出',
      'foot.finalOnly': '仅终态',
      'foot.metaOnly': '仅元信息',
      'collapse.in': '{n}s 后收起',
      'banner.auth': '认证失效，请刷新页面',
      'banner.hostMissing': 'Host 半端未加载，请确认插件已启用',
      'banner.disconnected': '连接中断，重试中…',
      'banner.recovered': '连接已恢复',
      'banner.sessionMissing': '会话不可用',
      'banner.killFailed': '停止失败，请稍后重试',
      'banner.retry': '重试',
      'panel.loading': '正在连接 Host 半端…',
      'panel.retry': '重试',
      'panel.empty.title': '本会话还没有命令行活动',
      'panel.empty.desc': '模型执行 bash、后台任务或持久终端时，命令与输出会出现在这里。',
      'modal.readonly': '只读',
      'modal.hint': 'Esc 关闭 · 只读视图，弹窗内不接管终端输入',
      'modal.meta': '{cwd} · 开始于 {time} · 输出 {size}',
      'modal.following': '跟随中',
      'modal.paused': '已暂停跟随',
    }
    const en = {
      'tab.terminal': 'Terminal',
      'stats.summary': '{running} running · {records} records · {sessions} sessions',
      'kind.all': 'All',
      'kind.bash': 'Bash',
      'kind.job': 'Jobs',
      'kind.terminal': 'Terminal',
      'kind.short.bash': 'BASH',
      'kind.short.job': 'JOB',
      'kind.short.terminal': 'TERM',
      'role.current': 'this session',
      'role.subagent': 'subagent',
      'role.teammate': 'teammate',
      'status.running': 'Running',
      'status.stopping': 'Stopping',
      'status.completed': 'Done',
      'status.failed': 'Failed',
      'status.killed': 'Killed',
      'scope.all': 'All sessions',
      'scope.count': '{n} sessions',
      'scope.note': 'Only sessions with command-line activity are listed',
      'scope.current': 'This session',
      'scope.empty': 'No sessions to filter',
      'search.placeholder': 'Search command / output',
      'search.clear': 'Clear search',
      'filter.autoExpand': 'Auto-expand new tasks',
      'filter.clear': 'Clear completed',
      'filter.clear.none': 'No completed records to clear',
      'filter.cleared': 'Cleared {n} completed records',
      'filter.undo': 'Undo',
      'filter.reset': 'Reset filters',
      'filter.empty': 'No command-line activity matches the current filters',
      'group.completed': 'Completed',
      'group.expand': 'Expand completed',
      'group.collapse': 'Collapse completed',
      'running.title': 'Running',
      'running.hint': 'Drag a card edge to resize · ⤢ maximize · wraps to fill the row',
      'running.more': '{n} more columns',
      'running.none': 'Nothing is running',
      'cmd.none': '(no command line)',
      'input.label': 'Input',
      'input.terminalName': 'Terminal',
      'output.empty': 'Waiting for output…',
      'output.metaOnly': 'This run only exposes metadata; its output cannot be read',
      'output.tier3': 'Not a live/full stream (fragments the model read/wrote)',
      'output.truncated': 'Earlier output trimmed',
      'actions.stop': 'Stop',
      'actions.stopConfirm': 'Confirm stop?',
      'actions.maximize': 'Maximize',
      'actions.copyAll': 'Copy all',
      'actions.copyCommand': 'Copy command',
      'actions.copyOutput': 'Copy output',
      'actions.copied': 'Copied',
      'actions.copyFailed': 'Copy failed',
      'actions.close': 'Close',
      'actions.more': 'More',
      'actions.pin': 'Pin expanded',
      'actions.unpin': 'Unpin',
      'actions.resize': 'Drag to resize, double-click to reset',
      'linger.in': 'into completed in {n}s',
      'linger.collapse': 'Collapse',
      'follow.following': 'Following',
      'follow.paused': 'Follow paused',
      'follow.newOutput': '{n} new lines ↓',
      'follow.resume': 'Scroll back to bottom to resume',
      'finalOnly': 'final only',
      'finalOnly.tip': 'This source only exposes the final output',
      'stopFinalOnly.tip': 'Final-only source: stopping is not available from this panel',
      'output.finalOnly': 'This run only exposes its final output; no streamed output before it finishes',
      'foot.finalOnly': 'final only',
      'foot.metaOnly': 'meta only',
      'collapse.in': 'collapse in {n}s',
      'banner.auth': 'Authentication expired, please refresh the page',
      'banner.hostMissing': 'Host half is not loaded; check that the plugin is enabled',
      'banner.disconnected': 'Connection lost, retrying…',
      'banner.recovered': 'Connection restored',
      'banner.sessionMissing': 'Session unavailable',
      'banner.killFailed': 'Failed to stop, please retry',
      'banner.retry': 'Retry',
      'panel.loading': 'Connecting to the Host half…',
      'panel.retry': 'Retry',
      'panel.empty.title': 'No command-line activity in this session yet',
      'panel.empty.desc': 'Commands and output from bash, background jobs and persistent terminals appear here.',
      'modal.readonly': 'read-only',
      'modal.hint': 'Esc to close · read-only, the dialog never takes over terminal input',
      'modal.meta': '{cwd} · started {time} · output {size}',
      'modal.following': 'Following',
      'modal.paused': 'Follow paused',
    }

    /** 词典模板插值：`{name}` → params.name（缺失 key 时回退 key 本身）。 */
    function tpl(t, key, params) {
      const template = typeof t === 'function' ? t(key) : key
      if (typeof template !== 'string') return String(key)
      if (!isObject(params)) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (
        params[name] === undefined || params[name] === null ? match : String(params[name])
      ))
    }

    /**
     * 面板样式表：只用 `--dsw-alias-*` 主题令牌 + `--dsw-radius-*`，暗/亮主题自动适配。
     * 唯一注入方式：`document.head.appendChild(<style data-plugin-css=...>)`
     * （服务端静态插件可用的样式方案；`styles` 内建只属于动态 Cordis 包）。
     */
    const STYLE_CSS = [
      // 外壳
      '.tp-root{box-sizing:border-box;display:flex;flex-direction:column;flex:1 1 auto;min-height:0;height:100%;width:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;overflow:hidden;position:relative}',
      '.tp-num{font-variant-numeric:tabular-nums}',
      '.tp-mono{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.tp-btn{box-sizing:border-box;font:inherit;display:inline-flex;align-items:center;gap:5px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm);padding:3px 10px;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.tp-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.tp-btn:disabled{opacity:.5;cursor:default}',
      '.tp-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.tp-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}',
      '.tp-btn-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.tp-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)}',
      '.tp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;flex:none}',
      '.tp-icon-btn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.tp-icon-btn:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.tp-sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
      // 横幅 / 通知
      // 横幅是覆盖层：availability/banner 翻转不得引起列表区高度变化（v8 #2）
      '.tp-banner{position:absolute;left:12px;right:12px;top:8px;z-index:25;display:flex;align-items:center;gap:8px;padding:5px 12px;font-size:12px;line-height:18px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3,0 4px 16px #00000059)}',
      '.tp-banner-warn{border-left:3px solid var(--dsw-alias-state-warn-primary)}',
      '.tp-banner-error{border-left:3px solid var(--dsw-alias-state-error-primary)}',
      '.tp-banner-icon{display:inline-flex;color:var(--dsw-alias-state-warn-primary)}',
      '.tp-banner-error .tp-banner-icon{color:var(--dsw-alias-state-error-primary)}',
      '.tp-banner-spacer{flex:1 1 auto}',
      '.tp-toast{position:absolute;left:50%;bottom:16px;transform:translateX(-50%);z-index:30;display:flex;align-items:center;gap:10px;max-width:min(560px,90%);box-sizing:border-box;padding:6px 12px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);box-shadow:var(--dsw-shadow-lv3,0 4px 16px #00000059);font-size:12px;line-height:18px}',
      '.tp-toast-success{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-border-l2))}',
      '.tp-toast-warn{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, var(--dsw-alias-border-l2))}',
      '.tp-toast-error{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, var(--dsw-alias-border-l2))}',
      // 工具栏
      '.tp-toolbar{display:flex;align-items:center;flex-wrap:nowrap;gap:8px 12px;height:46px;min-height:46px;box-sizing:border-box;padding:6px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);flex:none;overflow:hidden}',
      '.tp-stats{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:12px;font-variant-numeric:tabular-nums}',
      '.tp-chips{display:flex;align-items:center;gap:4px;flex-wrap:nowrap;flex:0 1 auto;min-width:0;overflow:hidden}',
      '.tp-chip{display:inline-flex;align-items:center;gap:5px;box-sizing:border-box;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.tp-chip:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}',
      '.tp-chip-on,.tp-chip-on:hover{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-label-primary));color:var(--dsw-alias-label-primary-foreground,var(--dsw-alias-bg-base));border-color:transparent}',
      '.tp-chip:disabled{opacity:.45;cursor:default}',
      '.tp-chip:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}',
      '.tp-chip-count{min-width:2ch;text-align:right;font-variant-numeric:tabular-nums;font-size:11px;opacity:.8}',
      '.tp-toolbar-right{display:flex;align-items:center;gap:8px;margin-left:auto;flex:0 0 auto;flex-wrap:nowrap}',
      '.tp-scope-wrap,.tp-menu-wrap{position:relative}',
      '.tp-scope-btn{display:inline-flex;align-items:center;gap:5px}',
      '.tp-scope-menu,.tp-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:40;min-width:220px;max-width:min(340px,80vw);max-height:320px;overflow:auto;box-sizing:border-box;padding:6px;border-radius:var(--dsw-radius-md);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-shadow-lv3,0 4px 16px #00000059)}',
      '.tp-menu{min-width:160px;max-height:none}',
      '.tp-menu-fixed{position:fixed}',
      '.tp-scope-item{display:flex;align-items:center;gap:7px;width:100%;box-sizing:border-box;padding:4px 6px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;text-align:left;cursor:pointer}',
      '.tp-scope-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.tp-scope-item:disabled{opacity:.5;cursor:default}',
      '.tp-scope-item-sub{padding-left:20px}',
      '.tp-scope-name{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tp-dot{width:6px;height:6px;border-radius:50%;flex:none;display:inline-block;background:var(--dsw-alias-label-tertiary)}',
      '.tp-dot-subagent{background:var(--dsw-alias-state-business-primary)}',
      '.tp-dot-teammate{background:var(--dsw-alias-state-warn-primary)}',
      '.tp-dot-running{background:var(--dsw-alias-state-success-primary);box-shadow:0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent)}',
      '.tp-scope-note{padding:6px 6px 2px;border-top:1px solid var(--dsw-alias-border-l1);margin-top:4px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:1.5}',
      '.tp-search{position:relative;display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);border-radius:var(--dsw-radius-sm);padding:2px 6px;color:var(--dsw-alias-label-tertiary);min-width:150px}',
      '.tp-search:focus-within{border-color:var(--dsw-alias-label-secondary)}',
      '.tp-search input{box-sizing:border-box;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;padding:1px 0;min-width:0;flex:1 1 auto;outline:none}',
      '.tp-search input::placeholder{color:var(--dsw-alias-label-tertiary)}',
      '.tp-switch{display:inline-flex;align-items:center;gap:6px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;white-space:nowrap}',
      '.tp-switch-track{position:relative;width:24px;height:14px;border-radius:999px;background:var(--dsw-alias-border-l2);flex:none;transition:background-color 120ms ease-out}',
      '.tp-switch-knob{position:absolute;top:2px;left:2px;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:transform 120ms ease-out}',
      '.tp-switch-on .tp-switch-track{background:var(--dsw-alias-state-business-primary)}',
      '.tp-switch-on .tp-switch-knob{transform:translateX(10px)}',
      '.tp-switch:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:4px}',
      // 主区
      '.tp-main{display:flex;flex-direction:column;min-height:0;flex:1 1 auto;overflow:hidden}',
      '.tp-section-head{display:flex;align-items:center;gap:8px;padding:8px 12px 4px;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;flex:none}',
      '.tp-section-head .tp-hint{margin-left:auto;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      // v8 #4：固定宽卡片自动换行 + 整体纵向滚动（横向滑动/滚动条/溢出按钮已废弃，contract §8.1/R9）
      '.tp-strip{position:relative;flex:1 1 auto;min-height:0;min-width:0;box-sizing:border-box;overflow-x:hidden;overflow-y:auto;padding:0 12px 10px;scrollbar-width:thin}',
      '.tp-strip-track{display:flex;flex-wrap:wrap;align-content:flex-start;align-items:flex-start;gap:12px;box-sizing:border-box;min-height:0}',
      '.tp-strip-empty{display:flex;align-items:center;justify-content:center;width:100%;padding:40px 0;color:var(--dsw-alias-label-tertiary);font-size:12px}',
      '.tp-strip::-webkit-scrollbar{width:6px}',
      '.tp-strip::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,var(--dsw-alias-border-l2));border-radius:3px}',
      // 窄容器：卡片宽不超过容器（不横向滚动）
      '.tp-col{max-width:100%}',
      // 进行中列
      // v9 #B：外层 .tp-cell 作为 flex item 拉伸铺满一行（base 352 / 最小 280 / 拖拽改 flex-basis）；
      // 内层卡片保持固定宽（flex:none + width:100% of cell），卡片视觉/等高不变。
      '.tp-cell{display:flex;flex:1 1 var(--tp-card-w, 352px);min-width:min(280px,100%);max-width:100%;height:342px;box-sizing:border-box}',
      '.tp-cell[data-tp-fresh=\'playing\']{animation:tp-fade-in 180ms ease-out}',
      '.tp-col{position:relative;display:flex;flex-direction:column;flex:none;width:100%;box-sizing:border-box;height:342px;max-height:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1);overflow:hidden}',
      '.tp-col-accent{position:absolute;left:0;top:0;bottom:0;width:3px}',
      '.tp-accent-subagent{background:var(--dsw-alias-state-business-primary)}',
      '.tp-accent-teammate{background:var(--dsw-alias-state-warn-primary)}',
      '.tp-col-head{display:flex;align-items:center;gap:6px;height:30px;box-sizing:border-box;padding:0 6px 0 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:default}',
      '.tp-kind{flex:none;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;font-weight:700;letter-spacing:.02em;line-height:16px;padding:0 4px;border-radius:3px}',
      '.tp-kind-bash{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent)}',
      '.tp-kind-job{color:var(--dsw-alias-state-warn-primary);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 14%, transparent)}',
      '.tp-kind-terminal{color:var(--dsw-alias-state-success-primary);background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent)}',
      '.tp-agent{display:inline-flex;align-items:center;gap:4px;min-width:0;max-width:160px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);white-space:nowrap}',
      '.tp-agent-name{overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary)}',
      '.tp-agent-role{font-size:10px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis}',
      '.tp-agent-subagent .tp-agent-name{color:var(--dsw-alias-state-business-primary)}',
      '.tp-agent-teammate .tp-agent-name{color:var(--dsw-alias-state-warn-primary)}',
      '.tp-final{flex:none;font-size:9px;line-height:14px;padding:0 4px;border-radius:3px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);white-space:nowrap}',
      '.tp-spacer{flex:1 1 auto;min-width:4px}',
      '.tp-status{display:inline-flex;align-items:center;gap:4px;flex:none;font-size:10px;line-height:14px;color:var(--dsw-alias-state-success-primary);white-space:nowrap}',
      '.tp-status-failed{color:var(--dsw-alias-state-error-primary)}',
      '.tp-status-killed{color:var(--dsw-alias-label-secondary)}',
      '.tp-status-stopping{color:var(--dsw-alias-state-warn-primary)}',
      '.tp-status-meta{color:var(--dsw-alias-label-secondary)}',
      // v8 #3：滞留卡片头部的倒计时 + 收起按钮；槽位常驻固定宽，避免出现/消失改变卡头布局
      '.tp-linger-slot{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;flex:none;min-width:152px;height:20px}',
      '.tp-linger-count{font-size:9px;line-height:14px;color:var(--dsw-alias-state-warn-primary);white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.tp-linger-btn{font:inherit;font-size:9px;line-height:14px;padding:0 5px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap}',
      '.tp-linger-btn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}',
      // v9 #C：状态边框色只用 --dsw-alias-*；hover/focus 仅改边框色/内描边，不改尺寸（防抖动）
      '.tp-col[data-phase=\'running\']{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, var(--dsw-alias-border-l1))}',
      '.tp-col[data-phase=\'linger\'],.tp-col[data-phase=\'completed\']{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 50%, var(--dsw-alias-border-l1))}',
      '.tp-col[data-phase=\'running\']:hover,.tp-col[data-phase=\'running\']:focus-within{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 85%, var(--dsw-alias-border-l1))}',
      '.tp-col[data-phase=\'linger\']:hover,.tp-col[data-phase=\'linger\']:focus-within,.tp-col[data-phase=\'completed\']:hover,.tp-col[data-phase=\'completed\']:focus-within{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 85%, var(--dsw-alias-border-l1))}',
      // v8 #5：离开执行区先 fade+scale 淡出，其余卡片 FLIP 补位（只动 transform/opacity）
      '.tp-col-exit{pointer-events:none;animation:tp-card-out 180ms ease-out forwards}',
      '@keyframes tp-card-out{from{opacity:1;transform:none}to{opacity:0;transform:scale(.98)}}',
      '.tp-dur{flex:none;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.tp-stop{display:inline-flex;align-items:center;justify-content:center;gap:3px;height:18px;box-sizing:border-box;padding:0 4px;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-state-error-primary);cursor:pointer;flex:none;font:inherit;font-size:10px;line-height:16px}',
      '.tp-stop:hover{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent);border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)}',
      '.tp-stop-armed{background:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent;padding:0 6px}',
      '.tp-stop:disabled{opacity:.4;cursor:default;background:transparent;border-color:var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary)}',
      '.tp-col-cmd{display:flex;align-items:center;gap:4px;height:24px;box-sizing:border-box;padding:0 8px 0 10px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);min-width:0}',
      '.tp-cmd-text{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary)}',
      '.tp-out-wrap{position:relative;flex:1 1 auto;min-height:0;display:flex;flex-direction:column}',
      '.tp-out{box-sizing:border-box;flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;background:var(--dsw-alias-bg-base);padding:6px 9px 8px;scrollbar-width:thin;outline:none}',
      '.tp-out::-webkit-scrollbar{width:6px}',
      '.tp-out::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,var(--dsw-alias-border-l2));border-radius:3px}',
      '.tp-out:focus-visible{box-shadow:inset 0 0 0 1px var(--dsw-alias-state-business-primary)}',
      '.tp-out-pre{display:block;margin:0;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;line-height:14.5px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.tp-out-placeholder{font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;line-height:14.5px;color:var(--dsw-alias-label-tertiary)}',
      '.tp-out-trunc{font-size:9px;line-height:14px;color:var(--dsw-alias-label-tertiary);border-bottom:1px dashed var(--dsw-alias-border-l2);margin-bottom:4px;padding-bottom:2px;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.tp-pill{position:absolute;left:50%;bottom:8px;transform:translateX(-50%);z-index:3;display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:999px;border:1px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, transparent);background:color-mix(in srgb, var(--dsw-alias-bg-layer-2) 92%, transparent);color:var(--dsw-alias-state-business-primary);font:inherit;font-size:11px;line-height:18px;cursor:pointer;white-space:nowrap;box-shadow:var(--dsw-shadow-lv1,0 1px 4px #00000040)}',
      '.tp-pill:hover{background:var(--dsw-alias-bg-layer-2)}',
      '.tp-foot{display:flex;align-items:center;gap:8px;height:22px;box-sizing:border-box;padding:0 8px 0 10px;flex:none;border-top:1px solid var(--dsw-alias-border-l1);font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);min-width:0}',
      '.tp-foot-id{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace)}',
      '.tp-follow{display:inline-flex;align-items:center;gap:4px;flex:none;margin-left:auto;color:var(--dsw-alias-state-business-primary)}',
      '.tp-follow-paused{color:var(--dsw-alias-label-tertiary)}',
      '.tp-resizer{position:absolute;top:0;right:-4px;bottom:0;width:8px;cursor:col-resize;z-index:4;touch-action:none}',
      '.tp-resizer:hover{background:color-mix(in srgb, var(--dsw-alias-state-business-primary) 20%, transparent)}',
      '.tp-drag-badge{position:absolute;top:6px;right:8px;z-index:6;padding:1px 6px;border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;line-height:14px;font-variant-numeric:tabular-nums;pointer-events:none}',
      // 已完成
      '.tp-done{display:flex;flex-direction:column;flex:0 1 auto;min-height:0;max-height:50%;overflow:hidden;border-top:1px solid var(--dsw-alias-border-l1);padding:4px 12px 8px;min-width:0}',
      '.tp-done-head{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;height:28px;padding:0 2px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px}',
      '.tp-done-toggle{display:flex;align-items:center;gap:6px;flex:1 1 auto;min-width:0;height:24px;padding:0 2px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}',
      '.tp-done-toggle:hover{color:var(--dsw-alias-label-primary)}',
      '.tp-done-toggle:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      '.tp-chev{display:inline-flex;align-items:center;justify-content:center;width:12px;height:12px;color:var(--dsw-alias-label-tertiary);flex:none}',
      '.tp-done-count{font-variant-numeric:tabular-nums}',
      '.tp-done-list{flex:1 1 auto;min-height:0;max-height:none;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:4px;padding:2px 0 0;scrollbar-width:thin}',
      '.tp-done-list::-webkit-scrollbar{width:6px}',
      '.tp-done-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,var(--dsw-alias-border-l2));border-radius:3px}',
      '.tp-row{position:relative;display:flex;align-items:center;gap:8px;box-sizing:border-box;height:32px;flex:none;padding:0 8px;border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, var(--dsw-alias-border-l1));border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-layer-1);cursor:pointer;min-width:0}',
      '.tp-row:hover{background:var(--dsw-alias-bg-layer-2);border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 80%, var(--dsw-alias-border-l1))}',
      '.tp-row:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}',
      '.tp-row-failed{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 55%, var(--dsw-alias-border-l1))}',
      '.tp-row-failed:hover,.tp-row-failed:focus-visible{border-color:color-mix(in srgb, var(--dsw-alias-state-error-primary) 85%, var(--dsw-alias-border-l1))}',
      '.tp-row-main{display:flex;align-items:center;gap:8px;flex:1 1 auto;min-width:0;height:100%}',
      '.tp-row-cmd{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary)}',
      '.tp-row-status{display:inline-flex;align-items:center;gap:4px;flex:none;font-size:10px;line-height:14px;color:var(--dsw-alias-state-success-primary);white-space:nowrap}',
      '.tp-row-status-failed{color:var(--dsw-alias-state-error-primary)}',
      '.tp-row-status-killed{color:var(--dsw-alias-label-secondary)}',
      '.tp-countdown{display:inline-flex;align-items:center;justify-content:flex-end;gap:4px;flex:none;min-width:74px;font-size:10px;line-height:14px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}',
      '.tp-countdown-idle{visibility:hidden}',
      '.tp-countdown .tp-dot{background:var(--dsw-alias-state-warn-primary)}',
      '.tp-progress{position:absolute;left:0;right:0;bottom:0;height:2px;border-radius:0 0 var(--dsw-radius-sm) var(--dsw-radius-sm);background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 15%, transparent);overflow:hidden}',
      '.tp-progress-bar{height:100%;background:var(--dsw-alias-state-warn-primary);transition:width 200ms linear}',
      '.tp-row-body{border:1px solid var(--dsw-alias-border-l1);border-top:0;border-radius:0 0 var(--dsw-radius-sm) var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);max-height:min(50vh,420px);overflow:auto;overscroll-behavior:contain;scrollbar-width:thin}',
      '.tp-hit{background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 30%, transparent);border-radius:2px}',
      // 输入块（#3）：输出区顶部展示「输入是什么」
      '.tp-input{display:flex;flex-direction:column;gap:1px;margin:0 0 6px;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10px;line-height:14.5px;color:var(--dsw-alias-label-secondary)}',
      '.tp-input-notice{display:flex;align-items:center;gap:4px;margin:0 0 3px;padding:1px 4px;max-width:100%;min-width:0;box-sizing:border-box;border:1px dashed color-mix(in srgb, var(--dsw-alias-state-warn-primary) 42%, transparent);border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-state-warn-primary);font:inherit;font-family:inherit;font-size:10px;line-height:14px;text-align:left;cursor:pointer}',
      '.tp-input-notice:hover{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 70%, transparent)}',
      '.tp-input-notice:focus-visible{outline:1px solid var(--dsw-alias-state-warn-primary);outline-offset:1px}',
      '.tp-input-notice-label{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.tp-input-notice-open{align-items:flex-start}',
      '.tp-input-notice-open .tp-input-notice-label{white-space:normal;overflow:visible;text-overflow:clip;word-break:break-word}',
      '.tp-input-notice-detail{margin:1px 0 4px;padding:2px 4px;border-left:2px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:9px;line-height:1.45;white-space:pre-wrap;word-break:break-word}',
      '.tp-input-notice svg{flex:none;margin-top:1px}',
      '.tp-input-line{display:flex;gap:0;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-secondary)}',
      '.tp-input-name{color:var(--dsw-alias-label-primary)}',
      '.tp-input-prompt{flex:none;white-space:pre;color:var(--dsw-alias-state-business-primary);opacity:.9}',
      '.tp-input-divider{height:1px;margin:4px 0 5px;background:var(--dsw-alias-border-l1)}',
      // #5 composer 隐藏（best-effort，Lead 定案）：只在当前会话内容根 [data-conversation-content]
      // 上打标记，命中同级 [data-composer-seat]；禁止 document.body 全局属性（多窗口/popout 会串台）。
      '[data-conversation-content][data-tp-composer-hidden] [data-composer-seat]{display:none!important}',
      // 首帧前骨架屏（v8 #2：不得用空态冒充「无数据」）
      '.tp-skeleton{display:flex;flex-wrap:wrap;align-content:flex-start;gap:12px;padding:8px 12px 12px;flex:1 1 auto;min-height:0;overflow:hidden}',
      '.tp-skel-card{width:352px;height:342px;box-sizing:border-box;flex:none;display:flex;flex-direction:column;gap:8px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-1)}',
      '.tp-skel-line{height:10px;border-radius:4px;background:color-mix(in srgb, var(--dsw-alias-label-secondary) 14%, transparent)}',
      '.tp-skel-line-sm{width:40%}',
      '.tp-skel-line-lg{width:72%}',
      '.tp-skel-body{flex:1 1 auto;min-height:0;border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
      // 空态 / 加载
      '.tp-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;flex:1 1 auto;min-height:0;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.tp-state-glyph{display:flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:15px}',
      '.tp-state-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}',
      '.tp-state-desc{max-width:440px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary)}',
      // 最大化弹窗
      '.tp-mask{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb, #000 65%, transparent);padding:12px;box-sizing:border-box}',
      '.tp-modal{display:flex;flex-direction:column;width:980px;height:600px;max-width:92vw;max-height:92vh;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-shadow-lv3,0 12px 40px #00000080);outline:none;overflow:hidden}',
      '.tp-modal-head{display:flex;align-items:center;gap:8px;box-sizing:border-box;height:36px;padding:0 8px 0 12px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1)}',
      '.tp-modal-cmd{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;color:var(--dsw-alias-label-primary)}',
      '.tp-modal-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;box-sizing:border-box;padding:4px 12px;flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:14px}',
      '.tp-modal-out{flex:1 1 auto;min-height:0;overflow:auto;overscroll-behavior:contain;padding:8px 12px;scrollbar-width:thin}',
      '.tp-modal-out::-webkit-scrollbar{width:6px}',
      '.tp-modal-out::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2,var(--dsw-alias-border-l2));border-radius:3px}',
      '.tp-modal-pre{display:block;margin:0;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums}',
      '.tp-modal-foot{display:flex;align-items:center;gap:8px;box-sizing:border-box;padding:6px 12px;flex:none;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}',
      '.tp-modal-foot .tp-spacer{flex:1 1 auto}',
      '.tp-badge-readonly{flex:none;font-size:10px;line-height:14px;padding:0 5px;border-radius:3px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-tertiary)}',
      '@keyframes tp-fade-in{from{opacity:0;transform:scale(.99)}to{opacity:1;transform:none}}',
      // #2：入场动画只在节点首次挂载播放（React ref 打 data-tp-fresh=playing），重渲染不重放
      '.tp-col[data-tp-fresh=\'playing\'],.tp-row[data-tp-fresh=\'playing\']{animation:tp-fade-in 180ms ease-out}',
      '@media (prefers-reduced-motion: reduce){.tp-col,.tp-row,.tp-col-exit{animation:none}.tp-col-exit{display:none}.tp-progress-bar{transition:none}}',
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

    // ──────────────────────────────────────────────────────────────────────
    // 纯函数层（contract §11.2）：不依赖 React / DOM / 宿主服务，经 __internals
    // 导出给 tester 直接 import 断言。所有状态变换返回新对象，不原地修改入参。
    // ──────────────────────────────────────────────────────────────────────

    const DEFAULT_COLUMN_WIDTH = 352
    const MIN_COLUMN_WIDTH = 280
    const MAX_COLUMN_WIDTH = 640
    /** 距底部 ≤ 该像素视为「贴底」（contract §6.4）。 */
    const FOLLOW_TOLERANCE_PX = 4
    /** 已完成自动收起延迟（ui-spec §3 固定 10s）。 */
    const COLLAPSE_DELAY_MS = 10000
    /** 单列本地保留行数（contract §9 scrollbackLines）。 */
    const SCROLLBACK_LINES = 600
    /** 已移除终态在本地保留时长 / 条数硬上限（contract §4.2 语义 5）。 */
    const COMPLETED_RETAIN_MS = 300000
    const MAX_RETAINED_COMPLETED = 200
    /** 单帧最多 Run 数（contract §4.3）。 */
    const MAX_RUNS = 32

    const RUN_KINDS = ['bash', 'job', 'terminal']
    const TERMINAL_STATUSES = ['completed', 'failed', 'killed']

    function isObject(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function isTerminalStatus(status) {
      return TERMINAL_STATUSES.indexOf(status) >= 0
    }

    function asNumber(value, fallback) {
      return typeof value === 'number' && isFinite(value) ? value : fallback
    }

    function pad2(value) {
      return value < 10 ? '0' + value : String(value)
    }

    /** 列宽夹取：仅接受有限数字，其余（NaN / 字符串 / null）回退默认 352。 */
    function clampColumnWidth(width) {
      if (typeof width !== 'number' || !isFinite(width)) return DEFAULT_COLUMN_WIDTH
      return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)))
    }

    /** 全量类型计数（不受会话范围/搜索影响；0 计数的 chip 仍要显示）。 */
    function countByKind(runs) {
      const counts = { all: 0, bash: 0, job: 0, terminal: 0 }
      if (!Array.isArray(runs)) return counts
      for (const run of runs) {
        if (!run || typeof run !== 'object') continue
        counts.all += 1
        if (RUN_KINDS.indexOf(run.kind) >= 0) counts[run.kind] += 1
      }
      return counts
    }

    /** 运行中列顺序：startedAt 升序（最旧在左），同一时刻按 runId 稳定排序。 */
    function orderRunningColumns(runs) {
      if (!Array.isArray(runs)) return []
      return runs
        .filter((run) => run && run.status === 'running')
        .slice()
        .sort((a, b) => {
          const delta = asNumber(a.startedAt, 0) - asNumber(b.startedAt, 0)
          if (delta !== 0) return delta
          return String(a.runId).localeCompare(String(b.runId))
        })
        .map((run) => run.runId)
    }

    /** 已完成行顺序：finishedAt 降序（最新在上）。 */
    function groupCompleted(runs) {
      if (!Array.isArray(runs)) return []
      return runs
        .filter((run) => run && isTerminalStatus(run.status))
        .slice()
        .sort((a, b) => {
          // 排序键只用 finishedAt / startedAt：终态后追加输出会更新 lastOutputAt，
          // 若把它当回退键，job 恢复输出会让已完成行重排（#2 抖动源）。
          const left = asNumber(a.finishedAt, asNumber(a.startedAt, 0))
          const right = asNumber(b.finishedAt, asNumber(b.startedAt, 0))
          if (right !== left) return right - left
          return String(a.runId).localeCompare(String(b.runId))
        })
        .map((run) => run.runId)
    }

    /** Run 的通道累积文本（stdout → stderr → job → terminal）。 */
    function runText(run) {
      if (!run) return ''
      if (isObject(run.streams) && isObject(run.streams.merged) && typeof run.streams.merged.text === 'string') {
        return run.streams.merged.text
      }
      if (!isObject(run.output)) return ''
      const output = run.output
      const parts = []
      for (const channel of ['stdout', 'stderr', 'job', 'terminal']) {
        const stream = output[channel]
        if (stream && typeof stream.text === 'string' && stream.text !== '') parts.push(stream.text)
      }
      return parts.join('')
    }

    /** 搜索匹配：command + 累积输出 + 显示名（agent.name / title / detail），大小写不敏感。 */
    function searchMatch(run, query) {
      const needle = typeof query === 'string' ? query.trim().toLowerCase() : ''
      if (needle === '') return true
      if (!run || typeof run !== 'object') return false
      const haystacks = [
        run.command,
        run.title,
        run.detail,
        isObject(run.agent) ? run.agent.name : undefined,
        runText(run),
      ]
      for (const hay of haystacks) {
        if (typeof hay === 'string' && hay !== '' && hay.toLowerCase().indexOf(needle) >= 0) return true
      }
      return false
    }

    /**
     * 本地筛选：类型（单选）+ 会话范围（null=全部，数组=白名单）+ 搜索 + showCompleted。
     * 输入顺序保持不变（渲染侧再按 order 排序）。
     */
    function filterRuns(runs, filter) {
      const list = Array.isArray(runs) ? runs : []
      if (!isObject(filter)) return list.slice()
      const kind = typeof filter.kind === 'string' ? filter.kind : 'all'
      let scope = null
      if (Array.isArray(filter.sessionIds)) scope = new Set(filter.sessionIds)
      else if (typeof filter.sessionIds === 'string') scope = new Set([filter.sessionIds])
      const query = typeof filter.search === 'string' ? filter.search : ''
      const showCompleted = filter.showCompleted !== false
      return list.filter((run) => {
        if (!run || typeof run !== 'object') return false
        if (kind !== 'all' && run.kind !== kind) return false
        if (scope !== null && !scope.has(run.ownerSessionId)) return false
        if (!showCompleted && isTerminalStatus(run.status)) return false
        if (query !== '' && !searchMatch(run, query)) return false
        return true
      })
    }

    // ── 跟随状态机（contract §6.4）────────────────────────────────────────

    function createFollowState() {
      return { following: true, pendingNewLines: 0, lastTop: 0, lastHeight: 0 }
    }

    /** 滚到距底 ≤ 4px 自动恢复跟随；离开底部即暂停（contract §6.4 硬要求）。 */
    function onScrollFollow(state, measurement) {
      const base = state && typeof state === 'object' ? state : createFollowState()
      const scrollTop = asNumber(measurement && measurement.scrollTop, 0)
      const scrollHeight = asNumber(measurement && measurement.scrollHeight, 0)
      const clientHeight = asNumber(measurement && measurement.clientHeight, 0)
      const distance = scrollHeight - clientHeight - scrollTop
      const following = distance <= FOLLOW_TOLERANCE_PX
      if (following === base.following && following) {
        return {
          ...base,
          lastTop: scrollTop,
          lastHeight: scrollHeight,
          pendingNewLines: 0,
        }
      }
      return {
        ...base,
        following,
        pendingNewLines: following ? 0 : base.pendingNewLines,
        lastTop: scrollTop,
        lastHeight: scrollHeight,
      }
    }

    /** 新输出到达：跟随时保持贴底；暂停时累计「N 条新输出」。 */
    function onOutputFollow(state, lines) {
      const base = state && typeof state === 'object' ? state : createFollowState()
      if (base.following) return base
      const added = asNumber(lines, 0)
      if (added <= 0) return base
      return { ...base, pendingNewLines: base.pendingNewLines + added }
    }

    // ── 自动收起状态机（contract §6.3）────────────────────────────────────

    function createCollapseState() {
      return { expanded: true, pinned: false, paused: false, deadline: null }
    }

    /** 进入终态：deadline = now + 10s；pinned 不 arm（保持原引用）。 */
    function armCollapse(state, now) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      if (base.pinned) return base
      return { ...base, deadline: asNumber(now, Date.now()) + COLLAPSE_DELAY_MS }
    }

    /** hover / focus 进入：冻结倒计时（deadline 不推进）。 */
    function pauseCollapse(state) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      if (base.paused) return base
      return { ...base, paused: true }
    }

    /** hover / focus 离开：失焦后重新等完整 10s（不是恢复剩余时间）。 */
    function resumeCollapse(state, now) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      // 已折叠的行不 arm：否则出现「行已收起、deadline 仍在走」的隐藏倒计时（#4 成因）。
      if (base.expanded === false) return { ...base, paused: false, deadline: null }
      return { ...base, paused: false, deadline: asNumber(now, Date.now()) + COLLAPSE_DELAY_MS }
    }

    /**
     * 收起态的**视觉收敛**（#4）：把 CollapseState 归一成渲染所需字段。
     * 关键收敛：`expanded === false` 时一律 `countdown:false / progress:0 / armed:false`，
     * 即便状态里残留 deadline 也不再显示倒计时；`pinned` 永不倒计时。
     * @returns {{ expanded:boolean, visible:boolean, countdown:boolean, remaining:number,
     *            progress:number, pinned:boolean, paused:boolean, armed:boolean }}
     */
    function collapseVisual(state, now) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      const expanded = base.expanded !== false
      const pinned = base.pinned === true
      const paused = base.paused === true
      const deadline = asNumber(base.deadline, null)
      const remaining = expanded && deadline !== null ? Math.max(0, deadline - asNumber(now, Date.now())) : 0
      const countdown = expanded && !pinned && deadline !== null && remaining > 0
      const progress = countdown ? Math.max(0, Math.min(1, remaining / COLLAPSE_DELAY_MS)) : 0
      return {
        expanded,
        visible: expanded,
        countdown,
        remaining,
        progress,
        pinned,
        paused,
        armed: expanded && deadline !== null,
      }
    }

    /** 计时 tick：到点折叠；未到点 / 暂停 / pinned 原样返回（引用相等）。 */
    function tickCollapse(state, now) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      if (base.paused || base.pinned) return base
      if (base.deadline === null || base.deadline === undefined) return base
      if (asNumber(now, Date.now()) < base.deadline) return base
      return { ...base, expanded: false, deadline: null }
    }

    /** 固定展开（Shift+Enter / ⋯→固定展开）：pinned=true，停止倒计时。 */
    function pinCollapse(state) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      if (base.pinned) return base
      return { ...base, pinned: true, deadline: null }
    }

    /** 取消固定（UI 用，非 tester 契约）：已终态则重新 arm。 */
    function unpinCollapse(state, now) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      if (!base.pinned) return base
      const next = { ...base, pinned: false, deadline: null }
      if (!next.expanded) return next
      return armCollapse(next, now)
    }

    // ── 展示三态：running → linger（滞留 10s）→ completed（v8 #3）─────────

    const LINGER_DELAY_MS = 10000

    /** 终态后进入滞留态：deadline = min(now+10s, finishedAt+10s)（历史完成不滞留）。 */
    function createLingerState(now, finishedAt) {
      const at = asNumber(now, Date.now())
      const finished = asNumber(finishedAt, at)
      return { deadline: Math.min(at + LINGER_DELAY_MS, finished + LINGER_DELAY_MS), paused: false, pinned: false }
    }

    /**
     * Run 的展示阶段（v8 #3）：`running` | `linger` | `completed`。
     * 只依赖 Run + ColumnState，可注入 now，便于 tester 断言边界。
     */
    function runPhase(run, column, now) {
      if (!isObject(run)) return 'completed'
      if (run.status === 'running') return 'running'
      if (!isTerminalStatus(run.status)) return 'running'
      const linger = isObject(column) && isObject(column.linger) ? column.linger : null
      if (linger === null) return 'completed'
      const deadline = asNumber(linger.deadline, null)
      if (deadline === null) return linger.pinned === true ? 'linger' : 'completed'
      if (linger.paused === true || linger.pinned === true) return 'linger'
      return asNumber(now, Date.now()) < deadline ? 'linger' : 'completed'
    }

    /**
     * 滞留视觉（v8 #3）：`{visible, remaining, progress, armed}`。
     * paused 冻结 deadline（remaining 不前进）；到点 armed=false。prefers-reduced-motion 不影响倒计时。
     */
    function lingerVisual(state, now) {
      const base = isObject(state) ? state : null
      const deadline = base !== null ? asNumber(base.deadline, null) : null
      const paused = base !== null && base.paused === true
      const pinned = base !== null && base.pinned === true
      const frozen = base !== null ? asNumber(base.frozenRemainingMs, null) : null
      const at = asNumber(now, Date.now())
      const armed = deadline !== null && (paused || pinned || at < deadline)
      // DEF-1：paused 时使用暂停瞬间冻结的剩余毫秒（不随 now 递减）；
      // 兼容旧状态：paused 但无 frozen 值时退回 deadline 计算。
      const remaining = armed
        ? Math.max(0, paused && frozen !== null ? frozen : deadline - at)
        : 0
      const progress = armed ? Math.max(0, Math.min(1, remaining / LINGER_DELAY_MS)) : 0
      return { visible: armed, remaining, progress, armed }
    }

    /**
     * hover / focus 进入滞留卡片：冻结倒计时。
     * DEF-1：把「暂停瞬间的剩余毫秒」写进 frozenRemainingMs，lingerVisual 在 paused 时用它，
     * 因此悬停期间数字/进度条不再变化（幂等：已暂停则不再覆盖冻结值）。
     * @param state LingerState
     * @param now 可注入时钟（默认 Date.now()）
     */
    function pauseLinger(state, now) {
      if (!isObject(state)) return state
      if (state.paused === true) return state
      const deadline = asNumber(state.deadline, null)
      const frozen = deadline === null ? null : Math.max(0, deadline - asNumber(now, Date.now()))
      return { ...state, paused: true, frozenRemainingMs: frozen }
    }

    /** hover / focus 离开：重新等完整 10s（与收起状态机一致的语义，清除冻结值）。 */
    function resumeLinger(state, now) {
      if (!isObject(state)) return state
      return {
        ...state,
        paused: false,
        frozenRemainingMs: null,
        deadline: asNumber(now, Date.now()) + LINGER_DELAY_MS,
      }
    }

    /** 「收起」按钮：立即结束滞留（进入已完成），幂等。 */
    function collapseLinger(state) {
      if (state === null || state === undefined) return null
      return null
    }

    /** 收起后又有输出：自动重新展开并重新计时（ui-spec §3.4）。 */
    function expandCollapse(state, now) {
      const base = state && typeof state === 'object' ? state : createCollapseState()
      return armCollapse({ ...base, expanded: true, paused: false }, now)
    }

    // ── 文本处理（contract §10 / ui-spec §6）─────────────────────────────

    const OSC_SEQUENCE = /\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g
    const ANSI_SEQUENCE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g
    const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

    /** 行内 `\r` 覆盖模拟：后一段从第 0 列覆盖前一段。 */
    function applyCarriageReturn(line) {
      if (line.indexOf('\r') < 0) return line
      let out = ''
      for (const segment of line.split('\r')) {
        if (segment === '') continue
        out = segment + out.slice(segment.length)
      }
      return out
    }

    /** 剥离 ANSI / OSC / 其它控制字符，并按终端语义处理 `\r`（只保留可打印文本）。 */
    function stripAnsi(text) {
      if (typeof text !== 'string' || text === '') return ''
      const plain = text.replace(OSC_SEQUENCE, '').replace(ANSI_SEQUENCE, '')
      const lines = plain.split('\n')
      for (let index = 0; index < lines.length; index += 1) lines[index] = applyCarriageReturn(lines[index])
      return lines.join('\n').replace(CONTROL_CHARS, '')
    }

    /** 只保留最后 maxLines 行（不含行尾换行的空段），返回被丢弃的行数。 */
    function tailLines(text, maxLines) {
      const source = typeof text === 'string' ? text : text === null || text === undefined ? '' : String(text)
      const limit = typeof maxLines === 'number' && isFinite(maxLines) ? Math.max(0, Math.floor(maxLines)) : 0
      if (source === '') return { text: '', dropped: 0 }
      const trailingNewline = source.charAt(source.length - 1) === '\n'
      const lines = source.split('\n')
      if (trailingNewline) lines.pop()
      if (lines.length <= limit) return { text: source, dropped: 0 }
      const dropped = lines.length - limit
      if (limit === 0) return { text: '', dropped }
      const kept = lines.slice(dropped).join('\n')
      return { text: trailingNewline ? kept + '\n' : kept, dropped }
    }

    // ── 时间格式化（tabular-nums 展示用）─────────────────────────────────

    /** 耗时：<10s 一位小数（1.2s）、<60s 整秒（12s）、>=60s `2m 03s`、>=1h `1h 02m`。 */
    function formatDuration(ms) {
      const value = typeof ms === 'number' && isFinite(ms) && ms > 0 ? ms : 0
      if (value < 10000) return (Math.round(value / 100) / 10).toFixed(1) + 's'
      if (value < 60000) return Math.round(value / 1000) + 's'
      const totalSeconds = Math.floor(value / 1000)
      if (value < 3600000) {
        return Math.floor(totalSeconds / 60) + 'm ' + pad2(totalSeconds % 60) + 's'
      }
      const totalMinutes = Math.floor(totalSeconds / 60)
      return Math.floor(totalMinutes / 60) + 'h ' + pad2(totalMinutes % 60) + 'm'
    }

    /**
     * 标题用命令摘要（#3）：取第一条非空行、去首尾空白、折叠连续空白；
     * 超长截断并加 `…`；多行命令在末尾追加 ` +N 行` 提示。完整原文走 title 属性。
     * @param command 原始命令（可能多行）
     * @param maxLen 第一行最大显示字符数（默认 120，含省略号）
     */
    function firstCommandLine(command, maxLen) {
      const limit = typeof maxLen === 'number' && isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 120
      if (typeof command !== 'string' || command === '') return ''
      const lines = command.split('\n')
      let index = 0
      while (index < lines.length && lines[index].trim() === '') index += 1
      if (index >= lines.length) return ''
      const collapsed = lines[index].replace(/\s+/g, ' ').trim()
      let last = lines.length - 1
      while (last > index && lines[last].trim() === '') last -= 1
      const rest = Math.max(0, last - index)
      const line = collapsed.length > limit ? collapsed.slice(0, Math.max(0, limit - 1)) + '…' : collapsed
      return rest > 0 ? line + ' +' + rest + ' 行' : line
    }

    /** 倒计时文案：剩余整秒向上取整（3s 后收起）。 */
    function formatCountdown(ms) {
      const value = typeof ms === 'number' && isFinite(ms) ? ms : 0
      return Math.max(0, Math.ceil(value / 1000)) + 's 后收起'
    }

    /** 输出区展示文本（优先使用按到达时间合并的流）。 */
    function outputText(run) {
      if (!isObject(run)) return ''
      if (isObject(run.streams) && isObject(run.streams.merged) && typeof run.streams.merged.text === 'string') {
        return run.streams.merged.text
      }
      return runText(run)
    }

    /** 本地时钟 HH:MM:SS（弹窗元信息用）。 */
    function formatClock(epochMs) {
      const value = asNumber(epochMs, 0)
      if (value <= 0) return '--:--:--'
      const date = new Date(value)
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
    }

    /** 字节数人类可读（输出体积展示用）。 */
    function formatBytes(bytes) {
      const value = asNumber(bytes, 0)
      if (value < 1024) return value + ' B'
      if (value < 1024 * 1024) return (Math.round(value / 102.4) / 10).toFixed(1) + ' KB'
      return (Math.round(value / 104857.6) / 10).toFixed(1) + ' MB'
    }

    // ── 视图状态 reducer（contract §5.3 / §6）────────────────────────────

    /** 初始 ViewState（`mergePoll` 的输入基线；tester 也可直接用本函数造状态）。 */
    function createViewState(sessionId) {
      return {
        sessionId: typeof sessionId === 'string' ? sessionId : '',
        status: 'loading',
        revision: 0,
        serverTime: 0,
        hostOffset: 0,
        sessions: [],
        runs: {},
        order: { running: [], completed: [] },
        columns: {},
        group: { completedCollapsed: true, expandedIds: [] },
        filter: { kind: 'all', sessionIds: null, search: '', autoExpandNew: true, showCompleted: true },
        availability: null,
        banner: null,
        droppedLines: {},
        cursors: {},
        pendingFrameRevision: 0,
        lastFrameAt: 0,
      }
    }

    function createColumnState(runId, status, options) {
      const opts = isObject(options) ? options : {}
      const now = asNumber(opts.now, Date.now())
      const column = {
        runId,
        width: clampColumnWidth(opts.width),
        follow: createFollowState(),
        collapse: createCollapseState(),
        scrollTop: 0,
      }
      if (isTerminalStatus(status)) {
        if (opts.autoExpandNew === false) column.collapse = { ...column.collapse, expanded: false }
        else column.collapse = armCollapse(column.collapse, now)
      }
      return column
    }

    function emptyChannel() {
      return { chunks: [], text: '', nextCursor: 0, lossy: false, truncated: false }
    }

    function mergeMeta(target, frameRun, previous) {
      const keys = [
        'kind', 'ownerSessionId', 'agent', 'title', 'command', 'cwd',
        'startedAt', 'finishedAt', 'durationMs', 'exitCode', 'signal', 'detail', 'handle', 'stoppable',
        'totals', 'lossy', 'truncated', 'outputMode', 'inputs', 'notice',
      ]
      for (const key of keys) {
        const value = frameRun[key]
        if (value === undefined) continue
        if (key === 'inputs') {
          // terminal 输入条：host 保证 ≤20 条 / 单条 ≤2KiB / 合计 ≤8KiB；client 再兜底一次。
          if (!Array.isArray(value)) continue
          target.inputs = value.slice(-20).map((entry) => {
            const text = typeof entry === 'string' ? entry : String(entry === null || entry === undefined ? '' : entry)
            return text.length > 2048 ? text.slice(0, 2048) : text
          })
        } else if (key === 'notice') {
          target.notice = isObject(value) ? { code: String(value.code || ''), message: String(value.message || '') } : null
        } else if ((key === 'agent' || key === 'handle' || key === 'totals') && isObject(value)) {
          const prior = previous !== undefined && isObject(previous[key]) ? previous[key] : {}
          target[key] = { ...prior, ...value }
        } else {
          target[key] = value
        }
      }
    }

    /**
     * 合并单个 Run：元信息浅合并；输出增量一律 append（不覆盖已累积文本）；
     * 超过 scrollbackLines 丢头部并累计 dropped 行数。
     * @returns {{ run: object, column: object, dropped: number }}
     */
    function mergeRun(previous, frameRun, options) {
      const runId = frameRun.runId
      const previousRun = isObject(previous && previous.run) ? previous.run : undefined
      const previousColumn = isObject(previous && previous.column) ? previous.column : undefined
      const now = asNumber(options && options.now, Date.now())
      const run = previousRun !== undefined
        ? { ...previousRun, output: { ...(previousRun.output || {}) }, streams: { ...(previousRun.streams || {}) } }
        : { runId, kind: 'bash', status: 'running', outputMode: 'live', ownerSessionId: '', agent: { id: '', name: '', role: 'unknown' }, title: '', startedAt: now, stoppable: false, output: {}, streams: {}, totals: {}, lossy: false, truncated: false }
      mergeMeta(run, frameRun, previousRun)
      run.runId = runId
      // 终态单调（contract §6.1）：只允许 running → completed|failed|killed；
      // 已进入终态后忽略后续帧的 status 变更（输出仍可追加，见 §6.3 重新展开）。
      const previousStatus = previousRun !== undefined ? previousRun.status : undefined
      const incomingStatus = typeof frameRun.status === 'string' ? frameRun.status : undefined
      if (previousStatus !== undefined && isTerminalStatus(previousStatus)) {
        run.status = previousStatus
        run.stopping = false
      } else if (incomingStatus !== undefined) {
        run.status = incomingStatus
        run.stopping = frameRun.stopping === true
      } else if (frameRun.stopping !== undefined) {
        run.stopping = frameRun.stopping === true
      }
      if (typeof frameRun.stoppable === 'boolean') run.stoppable = frameRun.stoppable
      // v9 #D：live（tier1 接管）时不得残留旧 notice（host 未清也要按字段不显示）。
      if (run.outputMode === 'live') run.notice = null

      const frameOutput = isObject(frameRun.output) ? frameRun.output : {}
      let dropped = 0
      let sawOutput = false
      const mergedEntries = []

      for (const channel of ['stdout', 'stderr', 'job']) {
        const delta = frameOutput[channel]
        if (!isObject(delta)) {
          if (previousRun && isObject(previousRun.output[channel])) run.output[channel] = previousRun.output[channel]
          continue
        }
        const priorStream = isObject(run.streams[channel]) ? run.streams[channel] : emptyChannel()
        let text = priorStream.text
        if (delta.gapBefore) {
          const lost = asNumber(delta.gapBytes, 0)
          text += '\n…（已丢失 ' + lost + ' 字节）\n'
          sawOutput = true
        }
        if (Array.isArray(delta.chunks)) {
          for (const chunk of delta.chunks) {
            if (!isObject(chunk) || typeof chunk.text !== 'string' || chunk.text === '') continue
            const plain = stripAnsi(chunk.text)
            text += plain
            mergedEntries.push({ at: asNumber(chunk.at, now), text: plain })
            sawOutput = true
          }
        }
        const tail = tailLines(text, asNumber(options && options.scrollbackLines, SCROLLBACK_LINES))
        dropped += tail.dropped
        const stream = {
          text: tail.text,
          nextCursor: asNumber(delta.nextCursor, priorStream.nextCursor),
          lossy: delta.lossy === true || (delta.gapBefore === true && priorStream.lossy === true),
          truncated: delta.truncated === true,
        }
        run.streams[channel] = stream
        run.output[channel] = {
          chunks: [],
          text: stream.text,
          nextCursor: stream.nextCursor,
          lossy: stream.lossy,
          truncated: stream.truncated,
          gapBefore: delta.gapBefore === true,
        }
      }

      const terminalDelta = frameOutput.terminal
      if (isObject(terminalDelta)) {
        const priorStream = isObject(run.streams.terminal)
          ? run.streams.terminal
          : { text: '', nextCursor: 0, lineEnd: 0, totalLines: 0, lossy: false, truncated: false }
        let text = priorStream.text
        if (terminalDelta.gapBefore) text += '\n…（已丢失 ' + asNumber(terminalDelta.gapLines, 0) + ' 行）\n'
        if (typeof terminalDelta.text === 'string' && terminalDelta.text !== '') {
          const plain = stripAnsi(terminalDelta.text)
          text += plain
          mergedEntries.push({ at: now, text: plain })
          sawOutput = true
        }
        const tail = tailLines(text, asNumber(options && options.scrollbackLines, SCROLLBACK_LINES))
        dropped += tail.dropped
        const stream = {
          text: tail.text,
          nextCursor: asNumber(terminalDelta.nextCursor, priorStream.nextCursor),
          lineEnd: asNumber(terminalDelta.lineEnd, priorStream.lineEnd),
          totalLines: asNumber(terminalDelta.totalLines, priorStream.totalLines),
          lossy: terminalDelta.lossy === true,
          truncated: terminalDelta.truncated === true,
        }
        run.streams.terminal = stream
        run.output.terminal = {
          chunks: [],
          text: stream.text,
          totalLines: stream.totalLines,
          lineBegin: asNumber(terminalDelta.lineBegin, undefined),
          lineEnd: stream.lineEnd,
          nextCursor: stream.nextCursor,
          lossy: stream.lossy,
          truncated: stream.truncated,
        }
      } else if (previousRun && isObject(previousRun.output.terminal)) {
        run.output.terminal = previousRun.output.terminal
      }

      if (mergedEntries.length > 0) {
        mergedEntries.sort((a, b) => a.at - b.at)
        const priorMerged = isObject(run.streams.merged) ? run.streams.merged : { text: '' }
        let mergedText = typeof priorMerged.text === 'string' ? priorMerged.text : ''
        for (const entry of mergedEntries) mergedText += entry.text
        const mergedTail = tailLines(mergedText, asNumber(options && options.scrollbackLines, SCROLLBACK_LINES))
        run.streams.merged = { text: mergedTail.text, dropped: asNumber(priorMerged.dropped, 0) + mergedTail.dropped }
      }
      if (isObject(frameRun.totals)) run.totals = { ...(isObject(run.totals) ? run.totals : {}), ...frameRun.totals }
      if (sawOutput) run.lastOutputAt = now

      // 列状态：新建 / 保持宽度与滚动；终态转换与「收起后再出输出」驱动收起状态机。
      let column = previousColumn !== undefined
        ? { ...previousColumn, collapse: { ...previousColumn.collapse }, follow: { ...previousColumn.follow } }
        : createColumnState(runId, run.status, {
          now,
          width: options && options.defaultWidth,
          autoExpandNew: options && options.autoExpandNew,
        })
      const wasTerminal = previousRun !== undefined && isTerminalStatus(previousRun.status)
      const nowTerminal = isTerminalStatus(run.status)
      // v8 #3：running→终态进入 linger；终态后恢复输出也重新 linger（pinned 时保持）。
      const lingerPinned = isObject(column.linger) && column.linger.pinned === true
      const collapsePinned = isObject(column.collapse) && column.collapse.pinned === true
      if (previousRun !== undefined && !wasTerminal && nowTerminal) {
        const linger = createLingerState(now, run.finishedAt)
        column.linger = collapsePinned === true || linger.deadline <= now ? null : linger
      } else if (wasTerminal && sawOutput && !lingerPinned) {
        column.linger = createLingerState(now, asNumber(run.lastOutputAt, now))
      }
      if (!wasTerminal && nowTerminal) {
        // 终态后先保持/恢复展开并 arm 10s（#4）：折叠且未 pinned 时先展开，再倒计时。
        column.collapse = column.collapse.expanded === true || column.collapse.pinned === true
          ? armCollapse(column.collapse, now)
          : expandCollapse(column.collapse, now)
      } else if (wasTerminal && sawOutput && column.collapse.expanded === false && !column.collapse.pinned) {
        column.collapse = expandCollapse(column.collapse, now)
      }
      column.runId = runId
      return { run, column, dropped }
    }

    /**
     * 核心 reducer：把一帧 `panel.poll` 的结果合并进 ViewState。
     *
     * 契约保证（tester 重点，contract §11.2）：
     * - `frame.revision <= state.revision` → 原样返回（引用相等，用于丢弃乱序帧）；
     * - 同帧重复应用幂等；
     * - `removed` 删除 run 与 column，未命中不抛错；
     * - `chunks` 只 append，不覆盖已累积文本；
     * - 游标只由 `nextCursors` 推进（`truncated` 不改变语义）；
     * - `availability` 只改标记，不清空已有数据。
     *
     * @param state 现有 ViewState（缺失时用 createViewState() 兜底）。
     * @param frame PollResult（contract §4.2）。
     * @param options 仅 UI 用：{ defaultWidth, autoExpandNew, now, scrollbackLines }。
     */
    function mergePoll(state, frame, options) {
      if (!isObject(frame)) return state
      const base = isObject(state) ? state : createViewState(isObject(frame) ? frame.sessionId : '')
      const frameRevision = asNumber(frame.revision, undefined)
      if (frameRevision !== undefined && frameRevision <= asNumber(base.revision, 0)) return state
      const opts = isObject(options) ? options : {}
      const now = asNumber(opts.now, asNumber(frame.serverTime, Date.now()))

      const next = {
        ...base,
        runs: { ...(base.runs || {}) },
        columns: { ...(base.columns || {}) },
        order: {
          running: Array.isArray(base.order && base.order.running) ? base.order.running.slice() : [],
          completed: Array.isArray(base.order && base.order.completed) ? base.order.completed.slice() : [],
        },
        group: {
          completedCollapsed: base.group ? base.group.completedCollapsed !== false : true,
          expandedIds: base.group && Array.isArray(base.group.expandedIds) ? base.group.expandedIds.slice() : [],
        },
        filter: isObject(base.filter) ? { ...base.filter } : createViewState().filter,
        droppedLines: { ...(base.droppedLines || {}) },
        cursors: { ...(base.cursors || {}) },
        status: base.status === 'blocked' ? 'blocked' : 'ready',
        diagnostics: isObject(base.diagnostics) ? base.diagnostics : null,
        pendingFrameRevision: frameRevision !== undefined ? frameRevision : base.pendingFrameRevision,
        serverTime: asNumber(frame.serverTime, now),
        lastFrameAt: now,
      }
      if (frameRevision !== undefined) next.revision = frameRevision
      if (typeof frame.sessionId === 'string' && frame.sessionId !== '') next.sessionId = frame.sessionId
      if (Array.isArray(frame.sessions)) next.sessions = frame.sessions.slice()
      if (isObject(frame.availability)) next.availability = frame.availability
      if (isObject(frame.diagnostics)) next.diagnostics = frame.diagnostics
      if (isObject(frame.nextCursors)) next.cursors = { ...next.cursors, ...frame.nextCursors }
      if (isObject(frame.limits)) next.limits = { ...frame.limits }
      if (isObject(frame.hostInfo)) next.hostInfo = { ...frame.hostInfo }

      const removed = Array.isArray(frame.removed) ? frame.removed : []
      const incomingRuns = Array.isArray(frame.runs) ? frame.runs : []
      const incomingIds = new Set()
      for (const incomingRun of incomingRuns) {
        if (isObject(incomingRun) && typeof incomingRun.runId === 'string') incomingIds.add(incomingRun.runId)
      }
      for (const runId of removed) {
        // v8 #2：同帧既 removed 又 runs（host 每帧 prune 后又重新发现的终态 job）→ 保留 runs，
        // 否则 mergeRun 会以 previous=undefined 重建 column，导致 250ms 抖动。
        if (incomingIds.has(runId)) continue
        if (typeof runId !== 'string' || next.runs[runId] === undefined) continue
        delete next.runs[runId]
        delete next.columns[runId]
        delete next.droppedLines[runId]
        delete next.cursors[runId]
      }
      if (removed.length > 0 && Array.isArray(next.group.expandedIds)) {
        next.group = {
          ...next.group,
          expandedIds: next.group.expandedIds.filter((runId) => next.runs[runId] !== undefined),
        }
      }

      for (const frameRun of incomingRuns) {
        if (!isObject(frameRun) || typeof frameRun.runId !== 'string' || frameRun.runId === '') continue
        const previous = next.runs[frameRun.runId] !== undefined || next.columns[frameRun.runId] !== undefined
          ? { run: next.runs[frameRun.runId], column: next.columns[frameRun.runId] }
          : undefined
        const merged = mergeRun(previous, frameRun, {
          now,
          defaultWidth: opts.defaultWidth,
          autoExpandNew: opts.autoExpandNew,
          scrollbackLines: opts.scrollbackLines,
        })
        next.runs[frameRun.runId] = merged.run
        next.columns[frameRun.runId] = merged.column
        if (merged.dropped > 0) {
          next.droppedLines[frameRun.runId] = asNumber(next.droppedLines[frameRun.runId], 0) + merged.dropped
        }
      }

      const runs = Object.keys(next.runs).map((runId) => next.runs[runId])
      next.order = { running: orderRunningColumns(runs), completed: groupCompleted(runs) }
      return next
    }

    /**
     * v8 #2：Host/插件重载后 `store.revision` 归 1，客户端若按旧语义会永久丢帧。
     * 判定：`incoming < applied` = 服务端重建（需要清空本地 view + 发一次 resync）；
     * `incoming === applied` = 重复/旧帧（照旧忽略）；`incoming > applied` = 正常前进。
     */
    function isRevisionRollback(appliedRevision, incomingRevision) {
      const applied = asNumber(appliedRevision, 0)
      const incoming = asNumber(incomingRevision, null)
      if (incoming === null) return false
      return incoming < applied
    }

    /** 本地修剪：终态 Run 超过保留时长/条数后移除（component tick 调用）。 */
    function pruneRuns(state, now) {
      if (!isObject(state) || !isObject(state.runs)) return state
      const at = asNumber(now, Date.now())
      const terminalIds = []
      for (const runId of Object.keys(state.runs)) {
        const run = state.runs[runId]
        if (!isObject(run) || !isTerminalStatus(run.status)) continue
        terminalIds.push(runId)
      }
      if (terminalIds.length === 0) return state
      const doomed = new Set()
      for (const runId of terminalIds) {
        const run = state.runs[runId]
        const finishedAt = asNumber(run.finishedAt, asNumber(run.lastOutputAt, asNumber(run.startedAt, 0)))
        if (at - finishedAt > COMPLETED_RETAIN_MS) doomed.add(runId)
      }
      const ordered = groupCompleted(terminalIds.map((runId) => state.runs[runId]))
      if (ordered.length > MAX_RETAINED_COMPLETED) {
        for (const runId of ordered.slice(MAX_RETAINED_COMPLETED)) doomed.add(runId)
      }
      if (doomed.size === 0) return state
      const runs = { ...state.runs }
      const columns = { ...state.columns }
      const droppedLines = { ...state.droppedLines }
      for (const runId of doomed) {
        delete runs[runId]
        delete columns[runId]
        delete droppedLines[runId]
      }
      const remaining = Object.keys(runs).map((runId) => runs[runId])
      return {
        ...state,
        runs,
        columns,
        droppedLines,
        order: { running: orderRunningColumns(remaining), completed: groupCompleted(remaining) },
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // 传输层（contract §4）：POST JSON 到宿主路由，单飞 + 5s 超时 + 404 回退。
    // ──────────────────────────────────────────────────────────────────────

    const RPC_TIMEOUT_MS = 5000
    const RPC_PATH = 'terminal-panel/rpc'
    const RPC_FALLBACK_PATH = '/terminal-panel/rpc'
    const POLL_HINT_DEFAULT_MS = 250
    const POLL_HINT_MIN_MS = 150
    const POLL_HINT_MAX_MS = 300
    const IDLE_POLL_DEFAULT_MS = 1000
    const IDLE_POLL_MIN_MS = 1000
    const IDLE_POLL_MAX_MS = 1500
    const FRAME_COMMIT_MS = 60
    const BACKOFF_MS = [250, 500, 1000, 2000, 5000]

    /** 端点：相对 `document.baseURI`，宿主挂子目录也命中（contract §4.1）。 */
    function rpcEndpoint() {
      if (typeof document === 'undefined' || typeof document.baseURI !== 'string' || document.baseURI === '') {
        return RPC_FALLBACK_PATH
      }
      try {
        return new URL(RPC_PATH, document.baseURI).toString()
      } catch (error) {
        return RPC_FALLBACK_PATH
      }
    }

    /** 指数退避（封顶 5s）。 */
    function nextBackoff(attempt) {
      const index = Math.max(0, Math.min(BACKOFF_MS.length - 1, Math.floor(asNumber(attempt, 0))))
      return BACKOFF_MS[index]
    }

    function failure(kind, code, message) {
      return { ok: false, error: { kind, code, message } }
    }

    /**
     * RPC 客户端：所有请求串行（同一时刻最多 1 个在途，contract §4.5 单飞），
     * 每个请求 5s AbortController 超时；首次 404 时回退绝对路径并 console.warn 一次。
     */
    function createRpcClient() {
      let endpoint = rpcEndpoint()
      let fallbackTried = false
      let chain = Promise.resolve()
      let activeController = null
      let disposed = false

      async function post(method, params) {
        if (disposed) return failure('network', 'disposed', 'client disposed')
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        activeController = controller
        const timer = controller !== null ? setTimeout(() => controller.abort(), RPC_TIMEOUT_MS) : null
        let response
        try {
          response = await fetch(endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ method, params: params === undefined ? {} : params }),
            signal: controller !== null ? controller.signal : undefined,
          })
        } catch (error) {
          return failure('network', 'transport-failure', error && error.message ? error.message : 'network error')
        } finally {
          if (timer !== null) clearTimeout(timer)
          if (activeController === controller) activeController = null
        }
        if (response.status === 401) return failure('auth', 'unauthorized', 'HTTP 401')
        if (response.status === 403) return failure('auth', 'forbidden', 'HTTP 403')
        if (response.status === 404) return failure('missing', 'host-half-missing', 'HTTP 404')
        if (!response.ok) return failure('http', 'http-' + response.status, 'HTTP ' + response.status)
        let body
        try {
          body = await response.json()
        } catch (error) {
          return failure('malformed', 'malformed-response', 'response is not JSON')
        }
        if (!isObject(body)) return failure('malformed', 'malformed-response', 'response envelope is invalid')
        if (body.ok === true) return { ok: true, value: body.value }
        const error = isObject(body.error) ? body.error : {}
        return failure(
          'rpc',
          typeof error.code === 'string' ? error.code : 'internal',
          typeof error.message === 'string' ? error.message : 'request failed',
        )
      }

      function abort() {
        disposed = true
        if (activeController !== null) {
          try {
            activeController.abort()
          } catch (error) {
            /* 已中止/已结束：忽略 */
          }
          activeController = null
        }
      }

      function call(method, params) {
        if (disposed) return Promise.resolve(failure('network', 'disposed', 'client disposed'))
        const run = chain.then(async () => {
          const first = await post(method, params)
          if (first.ok === false && first.error.kind === 'missing' && !fallbackTried && endpoint !== RPC_FALLBACK_PATH) {
            fallbackTried = true
            endpoint = RPC_FALLBACK_PATH
            if (typeof console !== 'undefined' && typeof console.warn === 'function') {
              console.warn('[terminal-panel] relative RPC path returned 404, fallback to ' + RPC_FALLBACK_PATH)
            }
            return post(method, params)
          }
          return first
        })
        chain = run.then(() => undefined, () => undefined)
        return run
      }

      return { call, abort }
    }

    /** 统计一帧里新增的输出行数（用于「N 条新输出」浮层）。 */
    function countFrameLines(runFrame) {
      if (!isObject(runFrame) || !isObject(runFrame.output)) return 0
      let lines = 0
      for (const channel of ['stdout', 'stderr', 'job']) {
        const delta = runFrame.output[channel]
        if (!isObject(delta) || !Array.isArray(delta.chunks)) continue
        for (const chunk of delta.chunks) {
          if (isObject(chunk) && typeof chunk.text === 'string') lines += countNewlines(chunk.text)
        }
      }
      const terminal = runFrame.output.terminal
      if (isObject(terminal) && typeof terminal.text === 'string') lines += countNewlines(terminal.text)
      return lines
    }

    function countNewlines(text) {
      if (typeof text !== 'string' || text === '') return 0
      let count = 0
      for (let index = 0; index < text.length; index += 1) {
        if (text.charCodeAt(index) === 10) count += 1
      }
      return count
    }

    /** 每会话列宽偏好（会话内存，不跨重启；contract §5.3 ColumnState.width）。 */
    const widthPrefs = new Map()

    function widthPrefsFor(sessionId) {
      const key = typeof sessionId === 'string' ? sessionId : ''
      let prefs = widthPrefs.get(key)
      if (prefs === undefined) {
        prefs = { defaultWidth: DEFAULT_COLUMN_WIDTH, byRun: {} }
        widthPrefs.set(key, prefs)
      }
      return prefs
    }

    // ──────────────────────────────────────────────────────────────────────
    // 会话状态缓存（v8 #1）：切 tab 会 unmount view，重挂时直接从缓存恢复，
    // 避免「先空态再被轮询填满」的闪断 + 游标归零导致的全量重发。
    // ──────────────────────────────────────────────────────────────────────

    const SESSION_CACHE_MAX = 4
    const SESSION_CACHE_TTL_MS = 30 * 60 * 1000

    /**
     * 可注入时钟的 LRU + TTL 缓存（tester 可测 TTL 边界）。
     * @param {{max?: number, ttlMs?: number, now?: () => number}} [options]
     * @returns {{get(sessionId:string, now?:number):object|undefined, set(sessionId:string, entry:object, now?:number):void,
     *            delete(sessionId:string):boolean, clear():void, size():number}}
     */
    function createSessionCache(options) {
      const opts = isObject(options) ? options : {}
      const max = typeof opts.max === 'number' && isFinite(opts.max) && opts.max >= 1 ? Math.floor(opts.max) : SESSION_CACHE_MAX
      const ttlMs = typeof opts.ttlMs === 'number' && isFinite(opts.ttlMs) && opts.ttlMs >= 0 ? opts.ttlMs : SESSION_CACHE_TTL_MS
      const clock = typeof opts.now === 'function' ? opts.now : () => Date.now()
      const map = new Map()
      return {
        get(sessionId, now) {
          if (typeof sessionId !== 'string' || sessionId === '') return undefined
          const entry = map.get(sessionId)
          if (entry === undefined) return undefined
          const at = asNumber(now, clock())
          if (at - asNumber(entry.savedAt, 0) > ttlMs) {
            map.delete(sessionId)
            return undefined
          }
          // LRU：命中即刷新最近使用顺序
          map.delete(sessionId)
          map.set(sessionId, entry)
          return entry
        },
        set(sessionId, entry, now) {
          if (typeof sessionId !== 'string' || sessionId === '' || !isObject(entry)) return
          const at = asNumber(now, clock())
          map.delete(sessionId)
          map.set(sessionId, { ...entry, savedAt: at })
          while (map.size > max) {
            const oldest = map.keys().next()
            if (oldest.done === true) break
            map.delete(oldest.value)
          }
        },
        delete(sessionId) {
          return map.delete(sessionId)
        },
        clear() {
          map.clear()
        },
        size() {
          return map.size
        },
      }
    }

    const SESSION_CACHE = createSessionCache()

    // ── v9 #D：diagnostics 一次性打印 + notice 详情（便于真机定位 Agent 解析问题）──
    let LAST_DIAGNOSTICS = null
    let DIAGNOSTICS_LOGGED = false

    function diagnosticsOwners(diagnostics) {
      const owners = isObject(diagnostics) && isObject(diagnostics.terminalOwners) ? diagnostics.terminalOwners : {}
      return {
        captured: asNumber(owners.captured, 0),
        alive: asNumber(owners.alive, 0),
        inScope: asNumber(owners.inScope, 0),
        outOfScope: asNumber(owners.outOfScope, 0),
        identityMismatch: asNumber(owners.ownerIdentityMismatch, asNumber(diagnostics && diagnostics.ownerIdentityMismatch, 0)),
      }
    }

    /**
     * backend T44 最终 diagnostics 一行（console.info / notice title 用）：
     * agentsService agentsAccess agentsCount sessionMatch tier1 metaOnly owners source reason
     */
    function diagnosticsLine(diagnostics) {
      if (!isObject(diagnostics)) return 'diagnostics: none'
      const terminals = isObject(diagnostics.terminals) ? diagnostics.terminals : {}
      const owners = diagnosticsOwners(diagnostics)
      const agentsCount = asNumber(diagnostics.agentsCount, asNumber(diagnostics.agentCount, 0))
      return 'agentsService=' + (diagnostics.agentsService === true)
        + ' agentsAccess=' + (typeof diagnostics.agentsAccess === 'string' && diagnostics.agentsAccess !== '' ? diagnostics.agentsAccess : '-')
        + ' agentsCount=' + agentsCount
        + ' sessionMatch=' + (diagnostics.sessionIdMatchesAgent === true)
        + ' tier1=' + asNumber(diagnostics.tier1Terminals, 0)
        + ' metaOnly=' + asNumber(diagnostics.metaOnlyTerminals, 0)
        + ' owners=' + owners.captured + '/' + owners.alive + '/' + owners.inScope + '/' + owners.outOfScope
        + ' source=' + (typeof terminals.source === 'string' && terminals.source !== '' ? terminals.source : '-')
        + ' reason=' + (typeof terminals.reason === 'string' && terminals.reason !== '' ? JSON.stringify(terminals.reason) : '-')
    }

    /** notice 的一行根因提示（backend T44 优先级；选不中返回 ''，回落 notice.message）。 */
    function diagnosticsNoticeHint(diagnostics) {
      if (!isObject(diagnostics)) return ''
      const owners = diagnosticsOwners(diagnostics)
      if (diagnostics.agentsService === false) return 'Host 看不到 agents 服务'
      if (diagnostics.agentsService === true && diagnostics.sessionIdMatchesAgent === false) return '该会话当前没有 live Agent'
      if (owners.outOfScope > 0) return '该终端属于尚未进入会话树的会话（已尝试直接解析）'
      if (owners.identityMismatch > 0) return '终端 owner 引用已自动校正'
      return ''
    }

    /** 详情/兜底摘要（比 console 行多旧字段，便于人工比对）。 */
    function diagnosticsSummary(diagnostics) {
      if (!isObject(diagnostics)) return 'diagnostics: none'
      const owners = diagnosticsOwners(diagnostics)
      const parts = [diagnosticsLine(diagnostics)]
      parts.push('agentFound=' + (diagnostics.agentFound === true))
      parts.push('scopes=' + asNumber(diagnostics.scopes, 0))
      if (isObject(diagnostics.agentsProbe)) {
        // sampleIds 最多 5 个 id，仅用于排障，不在 UI 常驻展示
        parts.push('agentsProbe=' + (diagnostics.agentsProbe.getOk === true ? 'get-ok' : 'get-fail')
          + '/' + (diagnostics.agentsProbe.identityOk === true ? 'identity-ok' : 'identity-fail'))
      }
      if (diagnostics.terminalScopes !== undefined) parts.push('terminalScopes=' + asNumber(diagnostics.terminalScopes, 0))
      if (diagnostics.ownerCached !== undefined || diagnostics.ownerResolved !== undefined) {
        parts.push('ownerCached=' + asNumber(diagnostics.ownerCached, 0))
        parts.push('ownerResolved=' + asNumber(diagnostics.ownerResolved, 0))
        parts.push('ownerFromCache=' + asNumber(diagnostics.ownerFromCache, 0))
      }
      if (diagnostics.ownerMissing !== undefined) parts.push('ownerMissing=' + asNumber(diagnostics.ownerMissing, 0))
      if (owners.identityMismatch > 0) parts.push('ownerIdentityMismatch=' + owners.identityMismatch)
      if (diagnostics.treeDegradation !== undefined && diagnostics.treeDegradation !== null) {
        parts.push('treeDegradation=' + JSON.stringify(diagnostics.treeDegradation))
      }
      if (typeof diagnostics.rootSessionId === 'string' && diagnostics.rootSessionId !== '') {
        parts.push('root=' + diagnostics.rootSessionId.slice(0, 12))
      }
      return parts.join(' ')
    }

    /** 首次收到带 diagnostics 的帧时打印一次（用户可直接复制给 lead）。 */
    function noteDiagnostics(diagnostics) {
      if (!isObject(diagnostics) || DIAGNOSTICS_LOGGED === true) return
      DIAGNOSTICS_LOGGED = true
      LAST_DIAGNOSTICS = diagnostics
      if (typeof console !== 'undefined' && typeof console.info === 'function') {
        try {
          console.info('[terminal-panel] diagnostics ' + diagnosticsLine(diagnostics), diagnostics)
        } catch (error) {
          /* 控制台不可用：静默 */
        }
      }
    }

    function cacheSaveSession(sessionId, view, cursors, revision, now) {
      if (typeof sessionId !== 'string' || sessionId === '' || !isObject(view)) return
      SESSION_CACHE.set(sessionId, {
        view,
        cursors: isObject(cursors) ? cursors : {},
        revision: asNumber(revision, asNumber(view.revision, 0)),
      }, now)
    }

    // ──────────────────────────────────────────────────────────────────────
    // 数据 hook：hello → poll 循环（250ms、单飞、60ms 合帧、可见性暂停、卸载全清）
    // ──────────────────────────────────────────────────────────────────────

    /**
     * @param sessionId 当前会话（slot 注入；owner props 优先）。
     * @param t 词典函数。
     */
    function usePanelSession(sessionId, t, focusRunRef) {
      const initialCacheRef = React.useRef(null)
      if (initialCacheRef.current === null) {
        initialCacheRef.current = { sessionId, entry: SESSION_CACHE.get(sessionId, Date.now()) }
      }
      const initialEntry = initialCacheRef.current.sessionId === sessionId
        ? initialCacheRef.current.entry
        : SESSION_CACHE.get(sessionId, Date.now())
      const [view, setView] = React.useState(() => (
        initialEntry !== undefined && isObject(initialEntry.view) ? initialEntry.view : createViewState(sessionId || '')
      ))
      const viewRef = React.useRef(view)
      const tRef = React.useRef(t)
      tRef.current = t
      const clientRef = React.useRef(null)
      const [now, setNow] = React.useState(() => Date.now())
      const [connection, setConnection] = React.useState({ status: 'loading', banner: null, notice: null })
      const [retryToken, setRetryToken] = React.useState(0)
      const noticeTimer = React.useRef(null)

      const patchView = React.useCallback((updater) => {
        setView((previous) => {
          const next = typeof updater === 'function' ? updater(previous) : updater
          viewRef.current = next
          return next
        })
      }, [])

      const retry = React.useCallback(() => {
        setRetryToken((token) => token + 1)
      }, [])

      const showNotice = React.useCallback((text, kind) => {
        setConnection((previous) => ({ ...previous, notice: { text, kind: kind || 'info' } }))
        if (noticeTimer.current !== null) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => {
          noticeTimer.current = null
          setConnection((previous) => (previous.notice === null ? previous : { ...previous, notice: null }))
        }, 3000)
      }, [])

      const killRun = React.useCallback(async (runId) => {
        const client = clientRef.current
        if (client === null) return
        const result = await client.call('panel.kill', { sessionId, runId })
        if (result.ok) {
          showNotice('已请求停止', 'info')
          return
        }
        const code = result.error.code
        if (code === 'run-not-found') showNotice('该任务已结束或不可见', 'warn')
        else if (code === 'run-not-stoppable') showNotice('该来源不支持停止', 'warn')
        else if (result.error.kind === 'auth') {
          setConnection({ status: 'blocked', banner: { code: 'auth', message: tRef.current('banner.auth') }, notice: null })
        } else showNotice(tRef.current('banner.killFailed'), 'error')
      }, [sessionId, showNotice, t])

      React.useEffect(() => () => {
        if (noticeTimer.current !== null) {
          clearTimeout(noticeTimer.current)
          noticeTimer.current = null
        }
      }, [])

      React.useEffect(() => {
        if (typeof sessionId !== 'string' || sessionId === '') return undefined
        const rpc = createRpcClient()
        clientRef.current = rpc
        let disposed = false
        let pollTimer = null
        let commitTimer = null
        let rafHandle = null
        let lastCommitAt = 0
        let frames = []
        const cached = SESSION_CACHE.get(sessionId, Date.now())
        let revision = cached !== undefined ? asNumber(cached.revision, 0) : asNumber(viewRef.current.revision, 0)
        let cursors = cached !== undefined && isObject(cached.cursors) ? cached.cursors : {}
        // v8 #2 resync：①mount 无缓存 ②revision 回退 ③手动 retry —— 同一次挂载成功发一次即可。
        let resyncPending = cached === undefined || retryToken > 0
        let resyncSent = false
        let attempt = 0
        let pollHintMs = POLL_HINT_DEFAULT_MS
        let idlePollHintMs = IDLE_POLL_DEFAULT_MS
        let active = true
        let truncationBurst = 0
        let failures = 0
        let wasDegraded = false
        let paused = typeof document !== 'undefined' && document.visibilityState === 'hidden'
        // 卸载/重挂或 retryToken 变化都不得清空已显示的数据（v8 #1）：
        // 只有「当前 view 不属于这个 session」时才新建空状态。
        if (viewRef.current.sessionId !== sessionId) {
          const fresh = createViewState(sessionId)
          viewRef.current = fresh
          setView(fresh)
        }
        setConnection({ status: 'loading', banner: null, notice: null })

        const clearPoll = () => {
          if (pollTimer !== null) {
            clearTimeout(pollTimer)
            pollTimer = null
          }
        }

        const schedulePoll = (delay) => {
          clearPoll()
          if (disposed || paused) return
          pollTimer = setTimeout(() => {
            pollTimer = null
            poll()
          }, Math.max(0, delay))
        }

        const setBanner = (banner, status) => {
          setConnection((previous) => {
            if (previous.banner === banner && previous.status === status) return previous
            return { ...previous, banner, status }
          })
        }

        const scheduleCommit = () => {
          if (disposed || commitTimer !== null || rafHandle !== null) return
          const wait = Math.max(0, FRAME_COMMIT_MS - (Date.now() - lastCommitAt))
          commitTimer = setTimeout(() => {
            commitTimer = null
            const raf = typeof requestAnimationFrame === 'function'
              ? requestAnimationFrame
              : (callback) => setTimeout(callback, 16)
            rafHandle = raf(commit)
          }, wait)
        }

        const commit = () => {
          commitTimer = null
          rafHandle = null
          if (disposed) return
          const queued = frames
          frames = []
          if (queued.length === 0) return
          lastCommitAt = Date.now()
          let next = viewRef.current
          const newLines = {}
          for (const frame of queued) {
            if (isObject(frame.diagnostics)) {
              LAST_DIAGNOSTICS = frame.diagnostics
              noteDiagnostics(frame.diagnostics)
            }
            if (Array.isArray(frame.runs)) {
              for (const runFrame of frame.runs) {
                if (!isObject(runFrame) || typeof runFrame.runId !== 'string') continue
                const lines = countFrameLines(runFrame)
                if (lines > 0) newLines[runFrame.runId] = asNumber(newLines[runFrame.runId], 0) + lines
              }
            }
            next = mergePoll(next, frame, {
              defaultWidth: widthPrefsFor(sessionId).defaultWidth,
              autoExpandNew: next.filter.autoExpandNew,
              now: Date.now(),
            })
            const serverTime = asNumber(frame.serverTime, 0)
            if (serverTime > 0) next = { ...next, hostOffset: serverTime - Date.now() }
          }
          const columns = { ...next.columns }
          let columnsChanged = false
          for (const runId of Object.keys(newLines)) {
            const column = columns[runId]
            if (column === undefined) continue
            const follow = onOutputFollow(column.follow, newLines[runId])
            if (follow !== column.follow) {
              columns[runId] = { ...column, follow }
              columnsChanged = true
            }
          }
          next = columnsChanged ? { ...next, columns } : next
          active = Object.keys(next.runs).some((runId) => next.runs[runId].status === 'running')
          viewRef.current = next
          setView(next)
          cacheSaveSession(sessionId, next, cursors, revision, Date.now())
          if (wasDegraded) {
            wasDegraded = false
            showNotice(tRef.current('banner.recovered'), 'success')
          }
          setBanner(null, 'ready')
        }

        const applyAvailability = (availability) => {
          if (!isObject(availability)) return
          patchView((previous) => ({ ...previous, availability }))
        }

        const poll = async () => {
          if (disposed || paused) return
          const focusRunId = focusRunRef !== undefined && focusRunRef !== null && typeof focusRunRef.current === 'string'
            ? focusRunRef.current
            : undefined
          const wantsResync = resyncPending === true && resyncSent === false
          const params = {
            sessionId,
            cursors: wantsResync ? {} : cursors,
            includeCompleted: true,
            maxRuns: MAX_RUNS,
            focusRunId,
          }
          if (wantsResync) params.resync = true
          const result = await rpc.call('panel.poll', params)
          if (disposed) return
          if (result.ok) {
            failures = 0
            attempt = 0
            const frame = result.value
            if (!isObject(frame)) {
              schedulePoll(pollHintMs)
              return
            }
            if (wantsResync) {
              resyncPending = false
              resyncSent = true
              cursors = {}
            }
            if (isObject(frame.nextCursors)) cursors = frame.nextCursors
            if (isObject(frame.availability)) applyAvailability(frame.availability)
            if (frame.truncated === true) {
              truncationBurst += 1
            } else {
              truncationBurst = 0
            }
            const frameRevision = asNumber(frame.revision, undefined)
            if (frameRevision !== undefined && isRevisionRollback(revision, frameRevision)) {
              // Host/插件重载：清空本地 view（保留筛选用户态）+ 丢弃在途帧 + 触发一次 resync。
              const previousView = viewRef.current
              const reset = createViewState(sessionId)
              reset.filter = isObject(previousView.filter) ? { ...previousView.filter } : reset.filter
              reset.group = {
                ...reset.group,
                completedCollapsed: isObject(previousView.group) ? previousView.group.completedCollapsed !== false : true,
              }
              frames = []
              cursors = {}
              revision = frameRevision
              resyncPending = true
              resyncSent = false
              viewRef.current = reset
              setView(reset)
              cacheSaveSession(sessionId, reset, {}, frameRevision, Date.now())
            }
            if (frameRevision === undefined || frameRevision !== revision) {
              // 接受 >（正常前进）与 <（Host 重建后的回退）；=== 视为重复帧丢弃。
              if (frameRevision !== undefined) revision = frameRevision
              frames.push(frame)
              scheduleCommit()
            }
            const delay = frame.truncated === true && truncationBurst <= 3
              ? 0
              : active ? pollHintMs : idlePollHintMs
            schedulePoll(delay)
            return
          }
          const error = result.error
          if (wantsResync && (error.code === 'bad-request' || error.code === 'unknown-method')) {
            // Host 尚未实现 resync：静默降级为普通轮询（避免每轮重试 400）。
            resyncPending = false
            resyncSent = true
          }
          if (error.kind === 'auth') {
            setBanner({ code: 'auth', message: tRef.current('banner.auth') }, 'blocked')
            return
          }
          if (error.kind === 'missing') {
            setBanner({ code: 'host-half-missing', message: tRef.current('banner.hostMissing') }, 'offline')
            schedulePoll(nextBackoff(attempt))
            attempt += 1
            return
          }
          if (error.code === 'session-not-found') {
            setConnection((previous) => ({ ...previous, status: 'error', banner: { code: 'session-not-found', message: tRef.current('banner.sessionMissing') } }))
            schedulePoll(2000)
            attempt = Math.min(attempt + 1, BACKOFF_MS.length - 1)
            return
          }
          failures += 1
          attempt += 1
          if (failures >= 2) {
            wasDegraded = true
            setBanner({ code: 'disconnected', message: tRef.current('banner.disconnected') }, 'degraded')
          }
          schedulePoll(nextBackoff(attempt))
        }

        const start = async () => {
          const hello = await rpc.call('panel.hello', {})
          if (disposed) return
          if (!hello.ok) {
            const error = hello.error
            if (error.kind === 'missing') {
              setBanner({ code: 'host-half-missing', message: tRef.current('banner.hostMissing') }, 'offline')
              schedulePoll(nextBackoff(attempt))
              attempt += 1
              return
            }
            if (error.kind === 'auth') {
              setBanner({ code: 'auth', message: tRef.current('banner.auth') }, 'blocked')
              return
            }
            failures += 1
            wasDegraded = true
            setBanner({ code: 'disconnected', message: tRef.current('banner.disconnected') }, 'degraded')
            schedulePoll(nextBackoff(attempt))
            attempt += 1
            return
          }
          const value = isObject(hello.value) ? hello.value : {}
          const limits = isObject(value.limits) ? value.limits : {}
          const hint = asNumber(limits.pollHintMs, POLL_HINT_DEFAULT_MS)
          pollHintMs = Math.min(POLL_HINT_MAX_MS, Math.max(POLL_HINT_MIN_MS, hint))
          const idleHint = asNumber(limits.idlePollHintMs, IDLE_POLL_DEFAULT_MS)
          idlePollHintMs = Math.min(IDLE_POLL_MAX_MS, Math.max(IDLE_POLL_MIN_MS, idleHint))
          patchView((previous) => ({
            ...previous,
            status: 'ready',
            availability: isObject(value.availability) ? value.availability : previous.availability,
            limits,
            hostInfo: { protocol: value.protocol, dshVersion: value.dshVersion, hostTime: value.hostTime },
          }))
          poll()
        }

        const onVisibility = () => {
          if (typeof document === 'undefined') return
          const hidden = document.visibilityState === 'hidden'
          if (hidden === paused) return
          paused = hidden
          if (hidden) clearPoll()
          else if (!disposed) poll()
        }

        if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
          document.addEventListener('visibilitychange', onVisibility)
        }
        if (!paused) start()

        let pruneCounter = 0
        const tickTimer = setInterval(() => {
          if (disposed) return
          const at = Date.now()
          setNow(at)
          pruneCounter += 1
          const shouldPrune = pruneCounter % 4 === 0
          setView((previous) => {
            let changed = false
            const columns = {}
            for (const runId of Object.keys(previous.columns)) {
              const column = previous.columns[runId]
              const collapse = tickCollapse(column.collapse, at)
              let nextColumn = collapse === column.collapse ? column : { ...column, collapse }
              if (collapse !== column.collapse) changed = true
              // v8 #3：滞留到点 → 清空 linger + 移入已完成（行强制 32px 折叠）。
              const linger = isObject(column.linger) ? column.linger : null
              if (linger !== null) {
                const expired = linger.paused !== true && linger.pinned !== true && asNumber(linger.deadline, Infinity) <= at
                if (expired) {
                  nextColumn = {
                    ...nextColumn,
                    linger: null,
                    collapse: { ...(nextColumn.collapse || createCollapseState()), expanded: false, deadline: null },
                  }
                  changed = true
                }
              }
              columns[runId] = nextColumn
            }
            let next = changed ? { ...previous, columns } : previous
            if (shouldPrune) {
              const pruned = pruneRuns(next, at)
              if (pruned !== next) {
                next = pruned
                changed = true
              }
            }
            if (!changed) return previous
            viewRef.current = next
            cacheSaveSession(sessionId, next, cursors, revision, at)
            return next
          })
        }, 250)

        return () => {
          disposed = true
          clearPoll()
          if (commitTimer !== null) clearTimeout(commitTimer)
          if (rafHandle !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(rafHandle)
          clearInterval(tickTimer)
          if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
            document.removeEventListener('visibilitychange', onVisibility)
          }
          cacheSaveSession(sessionId, viewRef.current, cursors, revision, Date.now())
          rpc.abort()
          clientRef.current = null
        }
      }, [sessionId, retryToken, patchView, showNotice])

      return {
        view,
        now,
        connection,
        retry,
        killRun,
        patchView,
        showNotice,
      }
    }

    // ──────────────────────────────────────────────────────────────────────
    // UI 组件（全部 React.createElement；图标为内联 SVG，不用 emoji/字符占位）
    // ──────────────────────────────────────────────────────────────────────

    /** 内联 SVG 图标：统一 24×24 viewBox、currentColor 描边。 */
    function icon(children, size) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size || 14,
        height: size || 14,
        'aria-hidden': true,
        focusable: false,
        style: { display: 'block', flex: 'none', color: 'currentColor' },
      }, children)
    }

    function strokePath(d, key) {
      return h('path', {
        key,
        d,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      })
    }

    const Icons = {
      chevronRight: () => icon([strokePath('M9 6l6 6-6 6', 'a')]),
      chevronDown: () => icon([strokePath('M6 9l6 6 6-6', 'a')]),
      stop: () => icon([h('rect', { key: 'a', x: 7, y: 7, width: 10, height: 10, rx: 1.5, fill: 'currentColor' })], 12),
      maximize: () => icon([strokePath('M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5', 'a')]),
      close: () => icon([strokePath('M6 6l12 12M18 6L6 18', 'a')]),
      copy: () => icon([
        strokePath('M9 9h10v11H9z', 'a'),
        strokePath('M5 15H4V4h11v1', 'b'),
      ]),
      search: () => icon([
        h('circle', { key: 'a', cx: 11, cy: 11, r: 6.5, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 }),
        strokePath('M16 16l4.5 4.5', 'b'),
      ], 12),
      arrowRight: () => icon([strokePath('M9 6l6 6-6 6', 'a')]),
      arrowDown: () => icon([strokePath('M12 5v14M6 13l6 6 6-6', 'a')], 12),
      check: () => icon([strokePath('M5 13l4 4L19 7', 'a')], 12),
      x: () => icon([strokePath('M6 6l12 12M18 6L6 18', 'a')], 12),
      square: () => icon([h('rect', { key: 'a', x: 6, y: 6, width: 12, height: 12, rx: 1.5, fill: 'currentColor' })], 12),
      alert: () => icon([
        strokePath('M12 4l9 16H3z', 'a'),
        strokePath('M12 10v4M12 17h.01', 'b'),
      ]),
      refresh: () => icon([strokePath('M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4', 'a')]),
      pin: () => icon([strokePath('M9 4h6l-1 5 3 3H7l3-3zM12 12v8', 'a')]),
      more: () => icon([
        h('circle', { key: 'a', cx: 5, cy: 12, r: 1.4, fill: 'currentColor' }),
        h('circle', { key: 'b', cx: 12, cy: 12, r: 1.4, fill: 'currentColor' }),
        h('circle', { key: 'c', cx: 19, cy: 12, r: 1.4, fill: 'currentColor' }),
      ]),
    }

    /** 等宽终端字形（空态用）。 */
    function TerminalGlyph() {
      return icon([
        strokePath('M4 6.5h16', 'a'),
        strokePath('M7 10.5l3 2.5-3 2.5', 'b'),
        strokePath('M12.5 15.5H17', 'c'),
      ], 22)
    }

    /**
     * 一次性入场动画标记（#2 抖动根因）：把 ref 挂到节点上，仅首次挂载播放动画；
     * 250ms 轮询重渲染不会重放，节点真正重建时才会再播放一次。
     */
    function useFreshFlag() {
      return React.useCallback((el) => {
        if (el === null || el === undefined || typeof el.dataset === 'undefined') return
        if (el.dataset.tpFresh === 'playing' || el.dataset.tpFresh === 'played') return
        el.dataset.tpFresh = 'playing'
        const done = () => {
          el.dataset.tpFresh = 'played'
          el.removeEventListener('animationend', done)
        }
        el.addEventListener('animationend', done)
      }, [])
    }

    /**
     * composer 隐藏的 DOM 副作用（#5，Lead 定案）：在 `[data-conversation-content]` 节点上
     * set/remove `data-tp-composer-hidden`。幂等、失败静默降级（返回 false，不抛错）。
     * 抽成纯函数便于 tester 用 fake node 断言 set/remove 与幂等。
     * @param node 目标节点（任意带 setAttribute/removeAttribute 的对象；null 安全）
     * @param visible true=隐藏 composer，false=恢复
     * @returns {boolean} 是否成功写入/移除标记
     */
    function applyComposerHidden(node, visible) {
      if (!isObject(node)) return false
      try {
        if (visible === true) {
          if (typeof node.setAttribute !== 'function') return false
          node.setAttribute('data-tp-composer-hidden', '1')
          return true
        }
        if (typeof node.removeAttribute === 'function') node.removeAttribute('data-tp-composer-hidden')
        return true
      } catch (error) {
        return false
      }
    }

    const CARD_EXIT_MS = 180
    const FLIP_MS = 200

    /**
     * FLIP 位移计算（v8 #5）：入参为 `runId → {left, top, ...}`（getBoundingClientRect 形状）。
     * 返回 `runId → {dx, dy} | null`；新增/删除的 key 返回 null（无动画）。
     */
    function flipDeltas(prevRects, nextRects) {
      const prev = isObject(prevRects) ? prevRects : {}
      const next = isObject(nextRects) ? nextRects : {}
      const keys = new Set(Object.keys(prev).concat(Object.keys(next)))
      const result = {}
      for (const key of keys) {
        const before = prev[key]
        const after = next[key]
        if (!isObject(before) || !isObject(after)) {
          result[key] = null
          continue
        }
        const dx = asNumber(after.left, 0) - asNumber(before.left, 0)
        const dy = asNumber(after.top, 0) - asNumber(before.top, 0)
        result[key] = dx === 0 && dy === 0 ? null : { dx, dy }
      }
      return result
    }

    /** prefers-reduced-motion 探测（无 window/异常时按「不降级」处理）。 */
    function prefersReducedMotion() {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true
      } catch (error) {
        return false
      }
    }

    /** 终端显示名：优先 terminalId，其次标题。 */
    function terminalName(run, t) {
      const handle = isObject(run.handle) ? run.handle : {}
      if (typeof handle.terminalId === 'string' && handle.terminalId !== '') return handle.terminalId
      if (typeof run.title === 'string' && run.title !== '') return run.title
      return t('input.terminalName')
    }

    function escapeRegExp(text) {
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    /** 搜索命中高亮：命中段包 `<mark class="tp-hit">`（文本节点渲染，绝不 innerHTML）。 */
    function highlight(text, query) {
      const source = typeof text === 'string' ? text : ''
      const needle = typeof query === 'string' ? query.trim() : ''
      if (needle === '' || source === '') return source
      const parts = source.split(new RegExp('(' + escapeRegExp(needle) + ')', 'gi'))
      if (parts.length <= 1) return source
      return parts.map((part, index) => (
        index % 2 === 1 ? h('mark', { key: index, className: 'tp-hit' }, part) : part
      ))
    }

    function copyText(text, onDone, onFail) {
      const value = typeof text === 'string' ? text : ''
      const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined
      if (clipboard === undefined || typeof clipboard.writeText !== 'function') {
        onFail()
        return
      }
      clipboard.writeText(value).then(onDone, onFail)
    }

    function roleLabel(role, t) {
      if (role === 'subagent') return t('role.subagent')
      if (role === 'teammate') return t('role.teammate')
      return t('role.current')
    }

    function agentName(agent, t) {
      // host 可能拿不到 Agent 名（v7 根因：Agent 无 name 字段）；此时显示占位符，
      // 绝不把 sessionId 当名字拼出来（长 id 会撑坏 chip 布局）。
      if (isObject(agent) && typeof agent.name === 'string' && agent.name.trim() !== '') return agent.name
      return '—'
    }

    function runDuration(run, now, hostOffset) {
      if (!isObject(run)) return 0
      const started = asNumber(run.startedAt, 0)
      if (!isTerminalStatus(run.status)) {
        if (started <= 0) return asNumber(run.durationMs, 0)
        return Math.max(0, asNumber(now, 0) + asNumber(hostOffset, 0) - started)
      }
      const finished = asNumber(run.finishedAt, undefined)
      if (finished !== undefined && started > 0) return Math.max(0, finished - started)
      return Math.max(0, asNumber(run.durationMs, 0))
    }

    function isFinalOnly(run) {
      return isObject(run) && (run.outputMode === 'final-only' || run.detail === 'final-only')
    }

    function footerId(run) {
      const handle = isObject(run.handle) ? run.handle : {}
      if (run.kind === 'job') return typeof handle.jobId === 'string' && handle.jobId !== '' ? 'job ' + handle.jobId : run.runId
      if (run.kind === 'terminal') {
        const id = typeof handle.terminalId === 'string' && handle.terminalId !== '' ? handle.terminalId : run.runId
        const type = typeof handle.terminalType === 'string' ? handle.terminalType + ' · ' : ''
        return type + id
      }
      if (typeof handle.pid === 'number') return 'pid ' + handle.pid
      return run.runId
    }

    function KindLabel(props) {
      const kind = RUN_KINDS.indexOf(props.kind) >= 0 ? props.kind : 'bash'
      return h('span', { className: 'tp-kind tp-kind-' + kind }, props.t('kind.short.' + kind))
    }

    function AgentChip(props) {
      const agent = isObject(props.agent) ? props.agent : {}
      const role = typeof agent.role === 'string' ? agent.role : 'unknown'
      const accent = role === 'subagent' || role === 'teammate' ? ' tp-agent-' + role : ''
      const name = agentName(agent, props.t)
      const roleText = name === '—' ? '' : roleLabel(role, props.t)
      return h('span', {
        className: 'tp-agent' + accent,
        title: roleText === '' ? name : name + ' · ' + roleText,
      },
      h('span', { className: 'tp-agent-name' }, name),
      roleText === '' ? null : h('span', { className: 'tp-agent-role' }, roleText),
      )
    }

    function StatusText(props) {
      const status = props.status
      // AGENTS §4.18：meta-only 终端没有实时流 → 用中性点，不得显示「运行中」动画/绿色脉冲。
      const metaOnly = props.metaOnly === true
      const runningDot = metaOnly ? 'tp-dot' : 'tp-dot tp-dot-running'
      if (props.stopping === true) {
        return h('span', { className: 'tp-status tp-status-stopping' }, h('span', { className: 'tp-dot tp-dot-teammate' }), props.t('status.stopping'))
      }
      if (status === 'running') {
        return h('span', { className: metaOnly ? 'tp-status tp-status-meta' : 'tp-status' }, h('span', { className: runningDot }), props.t('status.running'))
      }
      return h('span', { className: 'tp-status tp-status-' + status }, props.t('status.' + status))
    }

    function RowStatusText(props) {
      const run = props.run
      const t = props.t
      if (run.status === 'completed') {
        return h('span', { className: 'tp-row-status' }, Icons.check(), '0')
      }
      if (run.status === 'failed') {
        const code = run.exitCode === null || run.exitCode === undefined ? '!' : String(run.exitCode)
        return h('span', { className: 'tp-row-status tp-row-status-failed' }, Icons.x(), code)
      }
      return h('span', { className: 'tp-row-status tp-row-status-killed' }, Icons.square(), t('status.killed'))
    }

    /**
     * 输出区顶部「输入块」（#3）：把「输入是什么」和输出放在同一面板。
     * - bash/job：完整命令按原换行渲染，首行 `$ `、续行两空格；
     * - terminal：名称行 `$ <name>` + `run.inputs` 逐条 `› <text>`；
     * - `run.notice` 存在时在输入块上方显示一行降级提示（不阻断阅读）。
     * 无输入时返回 null（不占高度）。
     */
    function InputBlock(props) {
      const [noticeOpen, setNoticeOpen] = React.useState(false)
      const run = props.run
      if (!isObject(run)) return null
      const t = props.t
      const query = typeof props.query === 'string' ? props.query : ''
      const rows = []
      // v9 #D：terminal 的降级 notice 保留，但默认单行、可点开看详情；live 时一律不显示。
      const notice = run.kind === 'terminal' && run.outputMode !== 'live' && isObject(run.notice) ? run.notice : null
      if (notice !== null && (notice.message !== '' || notice.code !== '')) {
        const diagnosticHint = diagnosticsNoticeHint(LAST_DIAGNOSTICS)
        const summary = diagnosticsSummary(LAST_DIAGNOSTICS)
        rows.push(h('button', {
          key: 'notice',
          type: 'button',
          className: 'tp-input-notice' + (noticeOpen ? ' tp-input-notice-open' : ''),
          title: diagnosticHint !== '' ? diagnosticHint + ' · ' + summary : summary,
          'aria-expanded': noticeOpen,
          onClick: (event) => {
            event.stopPropagation()
            setNoticeOpen((previous) => previous !== true)
          },
        },
        Icons.alert(),
        h('span', { className: 'tp-input-notice-label' }, notice.message || notice.code),
        noticeOpen ? Icons.chevronDown() : Icons.chevronRight()))
        if (noticeOpen) {
          rows.push(h('div', { key: 'notice-detail', className: 'tp-input-notice-detail' },
            (diagnosticHint !== '' ? 'hint: ' + diagnosticHint + '\n' : '')
            + 'code: ' + (notice.code || '—') + '\n' + summary))
        }
      }
      if (run.kind === 'terminal') {
        const rawInputs = Array.isArray(run.inputs)
          ? run.inputs.filter((entry) => typeof entry === 'string' && entry !== '')
          : []
        // host 契约 v7 §7.1：inputs[0] 是 terminal 名称（与 `$ <name>` 行同源），
        // 名称行直接用 inputs[0]，`›` 输入从 index 1 开始，避免名称显示两遍。
        const name = rawInputs.length > 0 ? rawInputs[0] : terminalName(run, t)
        rows.push(h('div', { key: 'name', className: 'tp-input-line tp-input-name' },
          h('span', { className: 'tp-input-prompt' }, '$ '),
          h('span', null, query !== '' ? highlight(name, query) : name)))
        for (let index = 1; index < rawInputs.length; index += 1) {
          const text = rawInputs[index]
          if (text === name) continue
          rows.push(h('div', { key: 'send' + index, className: 'tp-input-line tp-input-send' },
            h('span', { className: 'tp-input-prompt' }, '› '),
            h('span', null, query !== '' ? highlight(text, query) : text)))
        }
      } else {
        const command = typeof run.command === 'string' ? run.command : ''
        const shown = command === '' ? t('cmd.none') : command
        const lines = shown.split('\n')
        for (let index = 0; index < lines.length; index += 1) {
          rows.push(h('div', { key: 'cmd' + index, className: 'tp-input-line' },
            h('span', { className: 'tp-input-prompt' }, index === 0 ? '$ ' : '  '),
            h('span', null, query !== '' && command !== '' ? highlight(lines[index], query) : lines[index])))
        }
      }
      if (rows.length === 0) return null
      return h('div', { className: 'tp-input', 'aria-label': t('input.label') },
        rows,
        h('div', { className: 'tp-input-divider' }))
    }

    /**
     * 输出区：终端底色、纵向滚动、默认贴底；上翻暂停并浮出「N 条新输出 ↓」，
     * 滚回底部（≤4px）自动恢复；区内滚轮不带动整页（CSS overscroll-behavior + stopPropagation）。
     */
    function OutputArea(props) {
      const t = props.t
      const runId = props.runId
      const outRefs = props.outRefs
      const localRef = React.useRef(null)
      const following = props.follow.following
      React.useEffect(() => {
        if (outRefs === undefined) return undefined
        outRefs.current.set(runId, localRef.current)
        return () => {
          outRefs.current.delete(runId)
        }
      }, [runId, outRefs])
      React.useEffect(() => {
        if (!following) return
        const el = localRef.current
        if (el !== null) el.scrollTop = el.scrollHeight
      }, [following, props.text])
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          if (following) props.onExitFollow()
        }
      }
      const run = props.run
      const metaOnly = isObject(run) && run.outputMode === 'meta-only'
      const emptyText = props.emptyText || (metaOnly ? t('output.metaOnly') : t('output.empty'))
      return h('div', { className: 'tp-out-wrap' },
        h('div', {
          className: 'tp-out',
          ref: localRef,
          role: 'log',
          tabIndex: 0,
          'aria-label': props.ariaLabel,
          onScroll: props.onScroll,
          onWheel: (event) => event.stopPropagation(),
          onKeyDown,
        },
        h(InputBlock, { key: 'input', run, t, query: props.query }),
        metaOnly && props.text !== '' ? h('div', { className: 'tp-out-trunc' }, t('output.tier3')) : null,
        props.dropped > 0 ? h('div', { className: 'tp-out-trunc' }, t('output.truncated')) : null,
        props.text === ''
          ? h('div', { className: 'tp-out-placeholder' }, emptyText)
          : h('pre', { className: 'tp-out-pre' }, props.query !== '' ? highlight(props.text, props.query) : props.text),
        ),
        !following && props.follow.pendingNewLines > 0
          ? h('button', {
            className: 'tp-pill',
            type: 'button',
            title: t('follow.resume'),
            onClick: props.onResume,
          }, tpl(t, 'follow.newOutput', { n: props.follow.pendingNewLines }), Icons.arrowDown())
          : null,
      )
    }

    /** 进行中列：类型 + agent chip + 状态 + 耗时 + ⤢ + 停止；命令行；输出区；脚注；右缘拖宽。 */
    function RunColumn(props) {
      const { run, column, t, now, hostOffset, session, query, armed, dragWidth, outRefs } = props
      const phase = typeof props.phase === 'string' ? props.phase : (run.status === 'running' ? 'running' : 'completed')
      const linger = lingerVisual(isObject(column.linger) ? column.linger : null, now)
      const freshRef = useFreshFlag()
      const registerCard = props.registerCard
      const cardRef = React.useCallback((el) => {
        freshRef(el)
        if (typeof registerCard === 'function') registerCard(run.runId, el)
      }, [freshRef, registerCard, run.runId])
      const commandRaw = typeof run.command === 'string' ? run.command : ''
      const commandLine = firstCommandLine(commandRaw, 160) || t('cmd.none')
      const follow = isObject(column.follow) ? column.follow : createFollowState()
      const text = outputText(run)
      const role = isObject(run.agent) ? run.agent.role : 'unknown'
      const accent = isObject(session) && session.accent !== undefined
        ? session.accent
        : role === 'subagent' || role === 'teammate' ? role : 'none'
      const width = clampColumnWidth(column.width)
      const stopping = run.stopping === true
      return h('div', {
        className: 'tp-cell' + (props.exiting === true ? ' tp-col-exit' : ''),
        ref: cardRef,
        style: { '--tp-card-w': width + 'px', flexBasis: width + 'px' },
        'data-run-id': run.runId,
        onMouseEnter: phase === 'linger' ? props.onLingerPause : undefined,
        onMouseLeave: phase === 'linger' ? props.onLingerResume : undefined,
        onFocus: phase === 'linger' ? props.onLingerPause : undefined,
        onBlur: phase === 'linger' ? props.onLingerResume : undefined,
      },
      h('section', {
        className: 'tp-col' + (phase === 'linger' ? ' tp-col-linger' : ''),
        'data-phase': phase,
        'aria-label': run.title || '',
      },
      accent !== 'none' ? h('span', { className: 'tp-col-accent tp-accent-' + accent, 'aria-hidden': true }) : null,
      h('div', { className: 'tp-col-head', onDoubleClick: props.onMaximize },
        h(KindLabel, { kind: run.kind, t }),
        h(AgentChip, { agent: run.agent, t }),
        h('span', { className: 'tp-spacer' }),
        isFinalOnly(run) ? h('span', { className: 'tp-final', title: t('finalOnly.tip') }, t('finalOnly')) : null,
        h(StatusText, { status: run.status, stopping, t, metaOnly: run.outputMode === 'meta-only' }),
        h('span', { className: 'tp-dur tp-num' }, formatDuration(runDuration(run, now, hostOffset))),
        h('span', { className: 'tp-linger-slot' },
          phase === 'linger'
            ? [
              h('span', { key: 'count', className: 'tp-linger-count' }, tpl(t, 'linger.in', { n: Math.max(0, Math.ceil(linger.remaining / 1000)) })),
              h('button', {
                key: 'collapse',
                className: 'tp-linger-btn',
                type: 'button',
                title: t('linger.collapse'),
                'aria-label': t('linger.collapse'),
                onClick: (event) => {
                  event.stopPropagation()
                  props.onLingerCollapse()
                },
              }, t('linger.collapse')),
            ]
            : null),
        h('button', {
          className: 'tp-icon-btn',
          type: 'button',
          title: t('actions.maximize'),
          'aria-label': t('actions.maximize'),
          onClick: (event) => {
            event.stopPropagation()
            props.onMaximize()
          },
        }, Icons.maximize()),
        run.status === 'running'
          ? h('button', {
            className: 'tp-stop' + (armed ? ' tp-stop-armed' : ''),
            type: 'button',
            disabled: run.stoppable !== true || isFinalOnly(run),
            title: isFinalOnly(run) ? t('stopFinalOnly.tip') : (armed ? t('actions.stopConfirm') : t('actions.stop')),
            'aria-label': isFinalOnly(run) ? t('stopFinalOnly.tip') : (armed ? t('actions.stopConfirm') : t('actions.stop')),
            onClick: (event) => {
              event.stopPropagation()
              if (run.stoppable !== true || isFinalOnly(run)) return
              props.onStop()
            },
          }, armed ? t('actions.stopConfirm') : Icons.stop())
          : null,
      ),
      h('div', { className: 'tp-col-cmd' },
        h('span', { className: 'tp-cmd-text tp-col-title', title: commandRaw },
          query !== '' ? highlight(commandLine, query) : commandLine)),
      h(OutputArea, {
        runId: run.runId,
        run,
        outRefs,
        t,
        text,
        dropped: props.droppedLines,
        query,
        follow,
        ariaLabel: (run.title || '') + ' ' + (run.command || ''),
        emptyText: isFinalOnly(run) ? t('output.finalOnly') : undefined,
        onScroll: props.onScroll,
        onResume: props.onResume,
        onExitFollow: props.onExitFollow,
      }),
      h('div', { className: 'tp-foot' },
        h('span', { className: 'tp-foot-id', title: footerId(run) }, footerId(run)),
        isFinalOnly(run) ? h('span', { className: 'tp-final', title: t('finalOnly.tip') }, t('foot.finalOnly')) : null,
        run.outputMode === 'meta-only' ? h('span', { className: 'tp-final', title: t('output.metaOnly') }, t('foot.metaOnly')) : null,
        run.outputMode === 'meta-only'
          ? null
          : h('span', { className: 'tp-follow' + (follow.following ? '' : ' tp-follow-paused') },
            h('span', { className: 'tp-dot' + (follow.following ? ' tp-dot-running' : '') }),
            follow.following ? t('follow.following') : t('follow.paused'))),
      h('div', {
        className: 'tp-resizer',
        role: 'separator',
        'aria-orientation': 'vertical',
        'aria-label': t('actions.resize'),
        title: t('actions.resize'),
        onPointerDown: props.onResizeStart,
        onDoubleClick: props.onResizeReset,
      }),
      dragWidth !== null ? h('div', { className: 'tp-drag-badge' }, dragWidth + 'px') : null,
      ))
    }

    /** 已完成行的 ⋯ 菜单（fixed 定位，避免被列表滚动容器裁剪）。 */
    function RowMenu(props) {
      const [open, setOpen] = React.useState(false)
      const [position, setPosition] = React.useState({ top: 0, left: 0 })
      const buttonRef = React.useRef(null)
      React.useEffect(() => {
        if (!open) return undefined
        const onPointerDown = (event) => {
          const target = event.target
          if (buttonRef.current !== null && buttonRef.current.contains(target)) return
          if (target instanceof Node) {
            const menu = document.getElementById('tp-row-menu-' + props.runId)
            if (menu !== null && menu.contains(target)) return
          }
          setOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return () => document.removeEventListener('pointerdown', onPointerDown)
      }, [open, props.runId])
      const toggle = (event) => {
        event.stopPropagation()
        const rect = event.currentTarget.getBoundingClientRect()
        setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 168) })
        setOpen(!open)
      }
      return h('span', { className: 'tp-menu-wrap' },
        h('button', {
          ref: buttonRef,
          className: 'tp-icon-btn',
          type: 'button',
          title: props.t('actions.more'),
          'aria-label': props.t('actions.more'),
          'aria-haspopup': 'menu',
          'aria-expanded': open,
          onClick: toggle,
        }, Icons.more()),
        open ? h('div', {
          id: 'tp-row-menu-' + props.runId,
          className: 'tp-menu tp-menu-fixed',
          role: 'menu',
          style: { position: 'fixed', top: position.top + 'px', left: position.left + 'px', zIndex: 60 },
        },
        h('button', { className: 'tp-scope-item', role: 'menuitem', type: 'button', onClick: (event) => { event.stopPropagation(); setOpen(false); props.onCopyCommand() } }, props.t('actions.copyCommand')),
        h('button', { className: 'tp-scope-item', role: 'menuitem', type: 'button', onClick: (event) => { event.stopPropagation(); setOpen(false); props.onCopyOutput() } }, props.t('actions.copyOutput')),
        h('button', { className: 'tp-scope-item', role: 'menuitem', type: 'button', onClick: (event) => { event.stopPropagation(); setOpen(false); props.onPin() } },
          props.pinned ? props.t('actions.unpin') : props.t('actions.pin')),
        ) : null,
      )
    }

    /** 已完成 32px 紧凑行 + 展开详情 + 10s 倒计时（琥珀点 + Ns + 2px 进度条）。 */
    /**
     * 已完成 32px 紧凑行（v9）：展开状态由 `group.expandedIds` 控制（纯布尔切换），
     * **不再**沿用 v7 的 column.collapse / 10s 倒计时 / 进度条（那是 linger 之前的旧语义）。
     */
    function CompletedRow(props) {
      const { run, t, now, hostOffset, query, expanded } = props
      const freshRef = useFreshFlag()
      const isExpanded = expanded === true
      const text = outputText(run)
      const metaOnly = run.outputMode === 'meta-only'
      const emptyText = metaOnly ? t('output.metaOnly') : (isFinalOnly(run) ? t('output.finalOnly') : t('output.empty'))
      const commandRaw = typeof run.command === 'string' ? run.command : ''
      const commandLine = firstCommandLine(commandRaw, 160) || t('cmd.none')
      return h(React.Fragment, null,
        h('div', {
          className: 'tp-row' + (run.status === 'failed' ? ' tp-row-failed' : ''),
          ref: freshRef,
          role: 'button',
          tabIndex: 0,
          'aria-expanded': isExpanded,
          'aria-label': (run.title || '') + ' ' + (run.command || ''),
          onClick: (event) => {
            event.stopPropagation()
            props.onToggle()
          },
          onKeyDown: (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (event.shiftKey) props.onPin()
            else props.onToggle()
          },
        },
        h('span', { className: 'tp-chev', 'aria-hidden': true }, isExpanded ? Icons.chevronDown() : Icons.chevronRight()),
        h(KindLabel, { kind: run.kind, t }),
        h(AgentChip, { agent: run.agent, t }),
        h('span', { className: 'tp-row-cmd tp-col-title', title: commandRaw },
          query !== '' ? highlight(commandLine, query) : commandLine),
        isFinalOnly(run) ? h('span', { className: 'tp-final', title: t('finalOnly.tip') }, t('finalOnly')) : null,
        run.outputMode === 'meta-only' ? h('span', { className: 'tp-final', title: t('output.metaOnly') }, t('foot.metaOnly')) : null,
        h(RowStatusText, { run, t }),
        h('span', { className: 'tp-dur tp-num' }, formatDuration(runDuration(run, now, hostOffset))),
        h(RowMenu, {
          runId: run.runId,
          t,
          // 「固定展开」= 确保该行展开（v9 展开集合已持久）；不再复用 v7 pin 状态
          pinned: false,
          onCopyCommand: () => copyText(run.command || '', () => props.onCopied(), () => props.onCopyFailed()),
          onCopyOutput: () => copyText(text, () => props.onCopied(), () => props.onCopyFailed()),
          onPin: props.onPin,
        }),
        ),
        isExpanded
          ? h('div', { className: 'tp-row-body' },
            h(InputBlock, { key: 'input', run, t, query }),
            metaOnly && text !== '' ? h('div', { className: 'tp-out-trunc' }, t('output.tier3')) : null,
            h('pre', { className: 'tp-modal-pre' }, text === '' ? emptyText : (query !== '' ? highlight(text, query) : text)))
          : null,
      )
    }

    /** 已完成分组：默认折叠（只显示「已完成 N」一行）；>50 条时只渲染可视窗口。 */
    function CompletedSection(props) {
      const { view, runs, t, now, hostOffset, query, actions } = props
      const collapsed = view.group.completedCollapsed !== false
      const expandedIds = view.group && Array.isArray(view.group.expandedIds) ? view.group.expandedIds : []
      const [scrollTop, setScrollTop] = React.useState(0)
      const virtual = runs.length > 50
      const rowSize = 36
      const start = virtual ? Math.max(0, Math.floor(scrollTop / rowSize) - 5) : 0
      const end = virtual ? Math.min(runs.length, start + 20) : runs.length
      const visible = runs.slice(start, end)
      return h('section', { className: 'tp-done', 'aria-label': t('group.completed') },
        h('div', { className: 'tp-done-head' },
          h('button', {
            className: 'tp-done-toggle',
            type: 'button',
            'aria-expanded': !collapsed,
            title: collapsed ? t('group.expand') : t('group.collapse'),
            onClick: actions.toggleGroup,
          },
          h('span', { className: 'tp-chev', 'aria-hidden': true }, collapsed ? Icons.chevronRight() : Icons.chevronDown()),
          h('span', null, t('group.completed')),
          h('span', { className: 'tp-done-count' }, String(runs.length)),
          ),
          h('span', { className: 'tp-spacer' }),
          h('button', {
            className: 'tp-btn tp-btn-ghost',
            type: 'button',
            disabled: runs.length === 0,
            title: runs.length === 0 ? t('filter.clear.none') : t('filter.clear'),
            onClick: actions.clearCompleted,
          }, t('filter.clear')),
        ),
        collapsed ? null : h('div', {
          className: 'tp-done-list',
          onScroll: (event) => setScrollTop(event.currentTarget.scrollTop),
        },
        virtual && start > 0 ? h('div', { style: { height: (start * rowSize) + 'px' }, 'aria-hidden': true }) : null,
        visible.map((run) => h(CompletedRow, {
          key: run.runId,
          run,
          t,
          now,
          hostOffset,
          query,
          expanded: expandedIds.indexOf(run.runId) >= 0,
          onToggle: () => actions.toggleRow(run.runId),
          onPin: () => actions.pinRow(run.runId),
          onCopied: () => actions.copied(),
          onCopyFailed: () => actions.copyFailed(),
        })),
        virtual && end < runs.length ? h('div', { style: { height: ((runs.length - end) * rowSize) + 'px' }, 'aria-hidden': true }) : null,
        ),
      )
    }

    /** 首帧到达前的骨架屏（v8 #2）：形状与卡片一致、不承诺数据。 */
    function PanelSkeleton(props) {
      const cards = [0, 1, 2]
      return h('div', { className: 'tp-skeleton', 'aria-busy': 'true', 'aria-label': props.t('panel.loading') },
        cards.map((index) => h('div', { key: index, className: 'tp-skel-card', 'aria-hidden': true },
          h('div', { className: 'tp-skel-line tp-skel-line-sm' }),
          h('div', { className: 'tp-skel-line tp-skel-line-lg' }),
          h('div', { className: 'tp-skel-body' }))))
    }

    /** 工具栏：计数 · 类型 chips · 会话范围 · 搜索 · 自动展开 · 清空已完成。 */
    function Toolbar(props) {
      const { view, t, counts, runningCount, sessionCount } = props
      const filter = view.filter
      const availability = view.availability
      const kindChips = [
        { id: 'all', label: t('kind.all'), count: counts.all },
        { id: 'bash', label: t('kind.bash'), count: counts.bash },
        { id: 'job', label: t('kind.job'), count: counts.job },
        { id: 'terminal', label: t('kind.terminal'), count: counts.terminal },
      ]
      const kindReason = (kind) => {
        if (kind === 'all' || !isObject(availability)) return ''
        const state = availability[kind]
        if (!isObject(state) || state.available !== false) return ''
        return typeof state.reason === 'string' ? state.reason : t('banner.hostMissing')
      }
      const scopeSessions = (Array.isArray(view.sessions) ? view.sessions : []).filter((session) => (
        isObject(session) && (session.hasActivity !== false || session.role === 'root')
      ))
      const selected = filter.sessionIds
      const scopeIds = scopeSessions.map((session) => session.sessionId)
      const selectedIds = selected === null ? scopeIds : selected
      const scopeLabel = selected === null
        ? t('scope.all')
        : tpl(t, 'scope.count', { n: selectedIds.length })
      return h('div', { className: 'tp-toolbar' },
        h('span', { className: 'tp-stats tp-num', 'aria-live': 'polite' },
          tpl(t, 'stats.summary', {
            running: runningCount,
            records: counts.all,
            sessions: sessionCount,
          })),
        h('div', { className: 'tp-chips', role: 'group', 'aria-label': t('kind.all') },
          kindChips.map((chip) => {
            const reason = kindReason(chip.id)
            return h('button', {
              key: chip.id,
              className: 'tp-chip' + (filter.kind === chip.id ? ' tp-chip-on' : ''),
              type: 'button',
              'aria-pressed': filter.kind === chip.id,
              disabled: reason !== '',
              title: reason,
              onClick: () => props.onFilter({ kind: chip.id }),
            }, chip.label, h('span', { className: 'tp-chip-count' }, String(chip.count)))
          })),
        h('div', { className: 'tp-toolbar-right' },
          h('div', { className: 'tp-scope-wrap' },
            h('button', {
              className: 'tp-btn tp-scope-btn',
              type: 'button',
              'aria-haspopup': 'true',
              'aria-expanded': props.scopeOpen === true,
              title: t('scope.note'),
              onClick: props.onToggleScope,
            }, h('span', null, scopeLabel), Icons.chevronDown()),
            props.scopeOpen === true
              ? h('div', { className: 'tp-scope-menu', role: 'group', 'aria-label': t('scope.note') },
                scopeSessions.length === 0
                  ? h('div', { className: 'tp-scope-note' }, t('scope.empty'))
                  : scopeSessions.map((session) => {
                    const checked = selectedIds.indexOf(session.sessionId) >= 0
                    const accent = session.accent === 'subagent' || session.accent === 'teammate' ? ' tp-scope-item-sub' : ''
                    return h('button', {
                      key: session.sessionId,
                      className: 'tp-scope-item' + accent,
                      type: 'button',
                      role: 'checkbox',
                      'aria-checked': checked,
                      onClick: () => props.onToggleScopeSession(session.sessionId),
                    },
                    h('span', { className: 'tp-dot' + (session.accent === 'subagent' ? ' tp-dot-subagent' : session.accent === 'teammate' ? ' tp-dot-teammate' : '') }),
                    h('span', { className: 'tp-scope-name' }, session.displayName || '—'),
                    checked ? Icons.check() : null)
                  }),
                h('div', { className: 'tp-scope-note' }, t('scope.note')),
                )
              : null,
          ),
          h('span', { className: 'tp-search' },
            Icons.search(),
            h('input', {
              type: 'search',
              value: filter.search,
              placeholder: t('search.placeholder'),
              'aria-label': t('search.placeholder'),
              onChange: (event) => props.onFilter({ search: event.target.value }),
            }),
            filter.search !== ''
              ? h('button', {
                className: 'tp-icon-btn',
                type: 'button',
                title: t('search.clear'),
                'aria-label': t('search.clear'),
                onClick: () => props.onFilter({ search: '' }),
              }, Icons.close())
              : null,
          ),
          h('button', {
            className: 'tp-switch' + (filter.autoExpandNew !== false ? ' tp-switch-on' : ''),
            type: 'button',
            role: 'switch',
            'aria-checked': filter.autoExpandNew !== false,
            onClick: () => props.onFilter({ autoExpandNew: filter.autoExpandNew === false }),
          }, h('span', { className: 'tp-switch-track' }, h('span', { className: 'tp-switch-knob' })), h('span', null, t('filter.autoExpand'))),
        ),
      )
    }

    /** 最大化只读弹窗：980×600、65% 黑遮罩、独立滚动、Esc/✕ 关闭、可停止/复制全部。 */
    function MaximizedDialog(props) {
      const { run, t, now, hostOffset, armed } = props
      const outRef = React.useRef(null)
      const dialogRef = React.useRef(null)
      const [follow, setFollow] = React.useState(createFollowState)
      const text = outputText(run)
      const meta = tpl(t, 'modal.meta', {
        cwd: run.cwd || '—',
        time: formatClock(run.startedAt),
        size: formatBytes(text.length),
      })
      React.useEffect(() => {
        const previous = typeof document !== 'undefined' ? document.activeElement : null
        if (dialogRef.current !== null && typeof dialogRef.current.focus === 'function') dialogRef.current.focus()
        return () => {
          if (previous !== null && previous !== undefined && typeof previous.focus === 'function') previous.focus()
        }
      }, [])
      React.useEffect(() => {
        const el = outRef.current
        if (el !== null) el.scrollTop = el.scrollHeight
      }, [])
      React.useEffect(() => {
        if (!follow.following) return
        const el = outRef.current
        if (el !== null) el.scrollTop = el.scrollHeight
      }, [text, follow.following])
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          event.preventDefault()
          props.onClose()
        }
      }
      return h('div', {
        className: 'tp-mask',
        onMouseDown: (event) => {
          if (event.target === event.currentTarget) props.onClose()
        },
        onKeyDown,
      },
      h('div', {
        className: 'tp-modal',
        ref: dialogRef,
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': t('actions.maximize') + ' ' + (run.command || run.runId),
        tabIndex: -1,
      },
      h('div', { className: 'tp-modal-head' },
        h(KindLabel, { kind: run.kind, t }),
        h(AgentChip, { agent: run.agent, t }),
        h('span', { className: 'tp-modal-cmd', title: run.command || '' }, run.command || t('cmd.none')),
        h('span', { className: 'tp-spacer' }),
        h(StatusText, { status: run.status, stopping: run.stopping === true, t, metaOnly: run.outputMode === 'meta-only' }),
        h('span', { className: 'tp-dur tp-num' }, formatDuration(runDuration(run, now, hostOffset))),
        h('span', { className: 'tp-badge-readonly' }, t('modal.readonly')),
        h('button', {
          className: 'tp-btn',
          type: 'button',
          onClick: () => copyText(text, props.onCopied, props.onCopyFailed),
        }, Icons.copy(), t('actions.copyAll')),
        h('button', {
          className: 'tp-icon-btn',
          type: 'button',
          title: t('actions.close'),
          'aria-label': t('actions.close'),
          onClick: props.onClose,
        }, Icons.close()),
      ),
      h('div', { className: 'tp-modal-meta' },
        h('span', null, meta),
        h('span', { className: 'tp-spacer' }),
        h('span', { className: 'tp-follow' + (follow.following ? '' : ' tp-follow-paused') },
          h('span', { className: 'tp-dot' + (follow.following ? ' tp-dot-running' : '') }),
          follow.following ? t('modal.following') : t('modal.paused'))),
      h('div', {
        className: 'tp-modal-out',
        ref: outRef,
        onScroll: (event) => {
          const el = event.currentTarget
          setFollow(onScrollFollow(follow, {
            scrollTop: el.scrollTop,
            scrollHeight: el.scrollHeight,
            clientHeight: el.clientHeight,
          }))
        },
        onWheel: (event) => event.stopPropagation(),
      },
      h(InputBlock, { key: 'input', run, t, query: '' }),
      run.outputMode === 'meta-only' && text !== '' ? h('div', { className: 'tp-out-trunc' }, t('output.tier3')) : null,
      text === ''
        ? h('div', { className: 'tp-out-placeholder' }, run.outputMode === 'meta-only' ? t('output.metaOnly') : t('output.empty'))
        : h('pre', { className: 'tp-modal-pre' }, text)),
      h('div', { className: 'tp-modal-foot' },
        h('span', null, t('modal.hint')),
        h('span', { className: 'tp-spacer' }),
        run.status === 'running'
          ? h('button', {
            className: 'tp-btn' + (armed ? ' tp-btn-danger' : ''),
            type: 'button',
            disabled: run.stoppable !== true || isFinalOnly(run),
            title: isFinalOnly(run) ? t('stopFinalOnly.tip') : (armed ? t('actions.stopConfirm') : t('actions.stop')),
            onClick: props.onStop,
          }, armed ? t('actions.stopConfirm') : t('actions.stop'))
          : null,
        h('button', { className: 'tp-btn', type: 'button', onClick: props.onClose }, t('actions.close'))),
      ))
    }

    /**
     * 会话「终端」tab 主视图。props 由宿主 renderer 注入：
     * `{ sessionId, useSession, t, inspectCall, viewRequest, openView, completeViewRequest }`
     * （owner props 最后覆盖，同名字段以宿主为准）。只有当前激活的 view 会挂载。
     */
    function TerminalPanel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => (zh[key] !== undefined ? zh[key] : key)
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const focusRunRef = React.useRef(null)
      const panel = usePanelSession(sessionId, t, focusRunRef)
      const { view, now, connection, retry, killRun, patchView, showNotice } = panel
      const [scopeOpen, setScopeOpen] = React.useState(false)
      const [maxRunId, setMaxRunId] = React.useState(null)
      const [armedRunId, setArmedRunId] = React.useState(null)
      const [drag, setDrag] = React.useState(null)
      const [undo, setUndo] = React.useState(null)
      const [exiting, setExiting] = React.useState([])
      const [gridWidth, setGridWidth] = React.useState(0)
      const [emptySettled, setEmptySettled] = React.useState(false)
      const gridRef = React.useRef(null)
      const cardsRef = React.useRef(new Map())
      const prevRectsRef = React.useRef({})
      const pendingFlipRef = React.useRef(false)
      const previousCardsRef = React.useRef(new Map())
      const previousActiveRef = React.useRef([])
      const lastSignatureRef = React.useRef('')
      const exitTimersRef = React.useRef(new Map())
      const dragRef = React.useRef(false)
      const scopeRef = React.useRef(null)
      const outRefs = React.useRef(new Map())
      const dragCleanup = React.useRef(null)
      const undoRef = React.useRef(null)

      const useLayoutEffect = typeof React.useLayoutEffect === 'function' ? React.useLayoutEffect : React.useEffect

      // v8 #5：FLIP 后的位移应用（仅集合增删/换行触发；拖列宽与 reduced-motion 跳过）
      useLayoutEffect(() => {
        const previous = prevRectsRef.current
        const next = {}
        for (const runId of activeIds) {
          const el = cardsRef.current.get(runId)
          if (el === null || el === undefined || typeof el.getBoundingClientRect !== 'function') continue
          const rect = el.getBoundingClientRect()
          next[runId] = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
        }
        const shouldAnimate = pendingFlipRef.current === true && dragRef.current !== true && prefersReducedMotion() === false
        pendingFlipRef.current = false
        if (shouldAnimate) {
          const deltas = flipDeltas(previous, next)
          for (const runId of Object.keys(deltas)) {
            const delta = deltas[runId]
            if (delta === null) continue
            const el = cardsRef.current.get(runId)
            if (el === null || el === undefined || !el.style) continue
            el.style.transition = 'none'
            el.style.transform = 'translate(' + delta.dx + 'px,' + delta.dy + 'px)'
            if (typeof el.getBoundingClientRect === 'function') el.getBoundingClientRect()
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => {
                el.style.transition = 'transform ' + FLIP_MS + 'ms ease-out'
                el.style.transform = ''
                setTimeout(() => { el.style.transition = '' }, FLIP_MS + 20)
              })
            } else {
              el.style.transform = ''
            }
          }
        }
        prevRectsRef.current = next
      })


      // 卸载：清理离场定时器（缓存由数据 hook 的 cleanup 保存）
      React.useEffect(() => () => {
        for (const timer of exitTimersRef.current.values()) clearTimeout(timer)
        exitTimersRef.current.clear()
      }, [])

      // 卸载时撤销未完成的拖拽监听（定时器由各自 effect 清理）。
      React.useEffect(() => () => {
        if (dragCleanup.current !== null) dragCleanup.current()
      }, [])

      React.useEffect(() => {
        if (armedRunId === null) return undefined
        const timer = setTimeout(() => setArmedRunId(null), 3000)
        return () => clearTimeout(timer)
      }, [armedRunId])

      React.useEffect(() => {
        if (undo === null) return undefined
        const timer = setTimeout(() => {
          undoRef.current = null
          setUndo(null)
        }, 3000)
        return () => clearTimeout(timer)
      }, [undo])

      // #5：终端 tab 激活时隐藏会话输入框（composer，Lead 定案）。
      // 锚点：会话内容根 `[data-conversation-content]`（composerSeat 与 view 同级），
      // 只在该节点打标记（禁止 body 全局属性）；closest 为 null → 静默降级；
      // 切走 view 即 unmount → cleanup 幂等移除标记。失败不影响其它 tab。
      React.useEffect(() => {
        const rootEl = rootRef.current
        if (rootEl === null || rootEl === undefined || typeof rootEl.closest !== 'function') return undefined
        let scope = null
        try {
          scope = rootEl.closest('[data-conversation-content]')
        } catch (error) {
          scope = null
        }
        if (scope === null || scope === undefined) return undefined
        applyComposerHidden(scope, true)
        return () => {
          applyComposerHidden(scope, false)
        }
      }, [])

      React.useEffect(() => {
        if (!scopeOpen) return undefined
        const onPointerDown = (event) => {
          if (scopeRef.current !== null && scopeRef.current.contains(event.target)) return
          setScopeOpen(false)
        }
        document.addEventListener('pointerdown', onPointerDown)
        return () => document.removeEventListener('pointerdown', onPointerDown)
      }, [scopeOpen])


      const runs = Object.keys(view.runs).map((runId) => view.runs[runId])
      const counts = countByKind(runs)
      const filtered = filterRuns(runs, view.filter)
      const filteredIds = new Set(filtered.map((run) => run.runId))
      const runningIds = view.order.running.filter((runId) => filteredIds.has(runId))
      const phaseById = new Map()
      const lingerIds = []
      for (const runId of runningIds) phaseById.set(runId, 'running')
      for (const runId of view.order.completed) {
        if (!filteredIds.has(runId)) continue
        const phase = runPhase(view.runs[runId], view.columns[runId], now)
        phaseById.set(runId, phase)
        if (phase === 'linger') lingerIds.push(runId)
      }
      // v8 #3：滞留卡片留在执行网格原位置（按 startedAt 稳定排序，新卡片排在后面）。
      const activeIds = runningIds.concat(lingerIds).sort((left, right) => {
        const delta = asNumber(view.runs[left] && view.runs[left].startedAt, 0) - asNumber(view.runs[right] && view.runs[right].startedAt, 0)
        if (delta !== 0) return delta
        return String(left).localeCompare(String(right))
      })
      const completedIds = view.order.completed.filter((runId) => filteredIds.has(runId) && phaseById.get(runId) === 'completed')
      const activeRuns = activeIds.map((runId) => view.runs[runId])
      const completedRuns = completedIds.map((runId) => view.runs[runId])
      const activeKey = activeIds.join('|')
      const gridSignature = activeKey + '#' + gridWidth
      if (lastSignatureRef.current !== gridSignature) {
        lastSignatureRef.current = gridSignature
        pendingFlipRef.current = true
      }

      // v8 #5：离开执行区的卡片先 fade+scale 180ms（占位），结束后再 FLIP 补位
      React.useEffect(() => {
        const previousIds = previousActiveRef.current
        const snapshot = previousCardsRef.current
        const removed = previousIds.filter((runId) => activeIds.indexOf(runId) < 0)
        if (removed.length > 0 && prefersReducedMotion() === false) {
          const entries = []
          for (const runId of removed) {
            const saved = snapshot.get(runId)
            if (saved === undefined) continue
            entries.push({ id: runId, run: saved.run, column: saved.column, index: saved.index })
          }
          if (entries.length > 0) {
            setExiting((previous) => {
              const known = new Set(previous.map((entry) => entry.id))
              return previous.concat(entries.filter((entry) => !known.has(entry.id)))
            })
            for (const entry of entries) {
              const existing = exitTimersRef.current.get(entry.id)
              if (existing !== undefined) clearTimeout(existing)
              const timer = setTimeout(() => {
                exitTimersRef.current.delete(entry.id)
                pendingFlipRef.current = true
                setExiting((previous) => previous.filter((item) => item.id !== entry.id))
              }, CARD_EXIT_MS)
              exitTimersRef.current.set(entry.id, timer)
            }
          }
        }
        const nextSnapshot = new Map()
        activeIds.forEach((runId, index) => nextSnapshot.set(runId, { run: view.runs[runId], column: view.columns[runId], index }))
        previousCardsRef.current = nextSnapshot
        previousActiveRef.current = activeIds.slice()
      }, [activeKey])

      // v8 #2：空态稳定窗口——首帧后若 0 条，先保持 skeleton 600ms，避免 job-only 场景空态闪
      React.useEffect(() => {
        if (view.revision === 0 || runs.length > 0) {
          setEmptySettled(false)
          return undefined
        }
        const timer = setTimeout(() => setEmptySettled(true), 600)
        return () => clearTimeout(timer)
      }, [view.revision, runs.length])

      // 渲染列表：执行区活动卡片 + 正在淡出的卡片（保持原位，占位到动画结束）
      const gridItems = []
      activeIds.forEach((runId, index) => {
        gridItems.push({ id: runId, run: view.runs[runId], column: view.columns[runId], index, exiting: false })
      })
      for (const entry of exiting) {
        gridItems.push({ id: entry.id, run: entry.run, column: entry.column, index: entry.index - 0.5, exiting: true })
      }
      gridItems.sort((left, right) => left.index - right.index)
      const sessionById = new Map((Array.isArray(view.sessions) ? view.sessions : []).map((session) => [session.sessionId, session]))
      const query = typeof view.filter.search === 'string' ? view.filter.search.trim() : ''

      const patchColumn = (runId, patch) => {
        patchView((previous) => {
          const column = previous.columns[runId]
          if (column === undefined) return previous
          return { ...previous, columns: { ...previous.columns, [runId]: { ...column, ...patch } } }
        })
      }

      const setFilter = (patch) => {
        patchView((previous) => ({ ...previous, filter: { ...previous.filter, ...patch } }))
      }

      const toggleScopeSession = (sid) => {
        const sessions = (Array.isArray(view.sessions) ? view.sessions : []).filter((session) => (
          isObject(session) && (session.hasActivity !== false || session.role === 'root')
        ))
        const allIds = sessions.map((session) => session.sessionId)
        const current = view.filter.sessionIds === null ? allIds : view.filter.sessionIds
        const next = current.indexOf(sid) >= 0
          ? current.filter((id) => id !== sid)
          : current.concat([sid])
        const normalized = allIds.every((id) => next.indexOf(id) >= 0) ? null : next
        setFilter({ sessionIds: normalized })
      }

      /** v9：已完成行的展开是纯布尔（group.expandedIds），不再走 v7 collapse 倒计时。 */
      const setRowExpanded = (runId, expanded) => {
        patchView((previous) => {
          const group = isObject(previous.group) ? previous.group : { completedCollapsed: true, expandedIds: [] }
          const ids = Array.isArray(group.expandedIds) ? group.expandedIds : []
          const has = ids.indexOf(runId) >= 0
          if (expanded === has) return previous
          return {
            ...previous,
            group: {
              ...group,
              expandedIds: expanded ? ids.concat([runId]) : ids.filter((id) => id !== runId),
            },
          }
        })
      }

      const toggleRow = (runId) => {
        const group = isObject(view.group) ? view.group : { expandedIds: [] }
        const ids = Array.isArray(group.expandedIds) ? group.expandedIds : []
        setRowExpanded(runId, ids.indexOf(runId) < 0)
      }

      const clearCompleted = () => {
        if (completedIds.length === 0) {
          showNotice(t('filter.clear.none'), 'warn')
          return
        }
        const snapshot = {
          runs: {},
          columns: {},
          order: view.order,
        }
        for (const runId of completedIds) {
          snapshot.runs[runId] = view.runs[runId]
          snapshot.columns[runId] = view.columns[runId]
        }
        undoRef.current = snapshot
        setUndo({ count: completedIds.length })
        patchView((previous) => {
          const nextRuns = { ...previous.runs }
          const nextColumns = { ...previous.columns }
          for (const runId of completedIds) {
            delete nextRuns[runId]
            delete nextColumns[runId]
          }
          const group = isObject(previous.group) ? previous.group : { completedCollapsed: true, expandedIds: [] }
          return {
            ...previous,
            runs: nextRuns,
            columns: nextColumns,
            group: {
              ...group,
              expandedIds: (Array.isArray(group.expandedIds) ? group.expandedIds : []).filter((runId) => nextRuns[runId] !== undefined),
            },
            order: {
              running: previous.order.running.filter((runId) => nextRuns[runId] !== undefined),
              completed: previous.order.completed.filter((runId) => nextRuns[runId] !== undefined),
            },
          }
        })
      }

      const undoClear = () => {
        const snapshot = undoRef.current
        if (snapshot === null) return
        undoRef.current = null
        setUndo(null)
        patchView((previous) => {
          const nextRuns = { ...previous.runs, ...snapshot.runs }
          const nextColumns = { ...previous.columns, ...snapshot.columns }
          const all = Object.keys(nextRuns).map((runId) => nextRuns[runId])
          return {
            ...previous,
            runs: nextRuns,
            columns: nextColumns,
            order: { running: orderRunningColumns(all), completed: groupCompleted(all) },
          }
        })
      }

      const handleStop = (runId) => {
        if (armedRunId === runId) {
          setArmedRunId(null)
          killRun(runId)
          return
        }
        setArmedRunId(runId)
      }

      const beginResize = (event, runId) => {
        event.preventDefault()
        event.stopPropagation()
        dragRef.current = true
        const column = view.columns[runId]
        const startWidth = column === undefined ? DEFAULT_COLUMN_WIDTH : clampColumnWidth(column.width)
        const startX = event.clientX
        let latest = startWidth
        const onMove = (moveEvent) => {
          latest = clampColumnWidth(startWidth + (moveEvent.clientX - startX))
          setDrag({ runId, width: latest })
          patchColumn(runId, { width: latest })
        }
        const cleanup = () => {
          if (typeof window !== 'undefined') {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', finish)
            window.removeEventListener('pointercancel', finish)
          }
          dragCleanup.current = null
          dragRef.current = false
        }
        function finish() {
          cleanup()
          setDrag(null)
          const prefs = widthPrefsFor(sessionId)
          prefs.byRun[runId] = latest
          prefs.defaultWidth = latest
        }
        dragCleanup.current = cleanup
        if (typeof window !== 'undefined') {
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', finish)
          window.addEventListener('pointercancel', finish)
        }
      }

      const resetWidth = (runId) => {
        patchColumn(runId, { width: DEFAULT_COLUMN_WIDTH })
        const prefs = widthPrefsFor(sessionId)
        prefs.byRun[runId] = DEFAULT_COLUMN_WIDTH
        prefs.defaultWidth = DEFAULT_COLUMN_WIDTH
      }

      const scrollOutputToBottom = (runId) => {
        const el = outRefs.current.get(runId)
        if (el === null || el === undefined) return
        el.scrollTop = el.scrollHeight
        patchColumn(runId, { follow: { ...onScrollFollow((view.columns[runId] || {}).follow, { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight, clientHeight: el.clientHeight }) } })
      }

      const copy = (text) => {
        copyText(text, () => showNotice(t('actions.copied'), 'success'), () => showNotice(t('actions.copyFailed'), 'error'))
      }

      /** v8 #5：卡片 DOM 注册（FLIP 测量用，卸载/离场时删除）。 */
      const registerCard = React.useCallback((runId, el) => {
        if (el === null || el === undefined) cardsRef.current.delete(runId)
        else cardsRef.current.set(runId, el)
      }, [])

      const maxRun = maxRunId === null ? null : view.runs[maxRunId]

      const rootRef = React.useRef(null)
      const root = (...children) => h('div', { className: 'tp-root', ref: rootRef, 'data-plugin': 'dsh-terminal-panel' }, children)

      const bannerView = connection.banner === null || connection.banner === undefined
        ? null
        : h('div', { className: 'tp-banner ' + (connection.banner.code === 'disconnected' || connection.banner.code === 'host-half-missing' ? 'tp-banner-warn' : 'tp-banner-error'), role: 'status' },
          h('span', { className: 'tp-banner-icon' }, Icons.alert()),
          h('span', null, connection.banner.message),
          h('span', { className: 'tp-banner-spacer' }),
          connection.banner.code === 'disconnected' || connection.banner.code === 'host-half-missing'
            ? h('span', { className: 'tp-num', style: { color: 'var(--dsw-alias-label-tertiary)' } }, '…')
            : null,
          h('button', { className: 'tp-btn', type: 'button', onClick: retry }, Icons.refresh(), t('banner.retry')))

      // v8 #2：首帧未到达 = 骨架屏；空态只在「已有帧且确认 0 条」时出现，
      // 避免 job-only / 切 tab 场景在「空 ↔ 有数据」之间跳。
      const hasFrame = view.revision > 0
      const awaitingFirstFrame = !hasFrame || (hasFrame && runs.length === 0 && emptySettled !== true)
      const empty = hasFrame && runs.length === 0 && emptySettled === true
      const filteredEmpty = hasFrame && runs.length > 0 && activeRuns.length === 0 && completedRuns.length === 0

      // v8 #4：网格宽度变化（换行）也要触发 FLIP；guard 相等避免 ResizeObserver 自激
      React.useEffect(() => {
        const grid = gridRef.current
        if (grid === null || grid === undefined) return undefined
        const read = () => {
          const width = asNumber(grid.clientWidth, 0)
          setGridWidth((previous) => (previous === width ? previous : width))
        }
        read()
        if (typeof ResizeObserver !== 'function') return undefined
        const observer = new ResizeObserver(read)
        observer.observe(grid)
        return () => observer.disconnect()
      }, [hasFrame, empty, filteredEmpty])

      const toolbarView = h(Toolbar, {
        view,
        t,
        counts,
        runningCount: activeIds.length,
        sessionCount: Array.isArray(view.sessions) ? view.sessions.length : 0,
        scopeOpen,
        onToggleScope: () => setScopeOpen(!scopeOpen),
        onToggleScopeSession: toggleScopeSession,
        onFilter: setFilter,
      })

      const mainView = h('div', { className: 'tp-main' },
        awaitingFirstFrame
          ? h(PanelSkeleton, { t })
          : empty
            ? h('div', { className: 'tp-state' },
              h('div', { className: 'tp-state-glyph' }, h(TerminalGlyph)),
              h('div', { className: 'tp-state-title' }, t('panel.empty.title')),
              h('div', { className: 'tp-state-desc' }, t('panel.empty.desc')))
            : filteredEmpty
              ? h('div', { className: 'tp-state' },
                h('div', { className: 'tp-state-title' }, t('filter.empty')),
                h('button', {
                  className: 'tp-btn',
                  type: 'button',
                  onClick: () => setFilter({ kind: 'all', sessionIds: null, search: '', showCompleted: true }),
                }, t('filter.reset')))
              : h(React.Fragment, null,
                h('div', { className: 'tp-section-head' },
                  h('span', null, t('running.title')),
                  h('span', { className: 'tp-num' }, String(activeRuns.length)),
                  h('span', { className: 'tp-hint' }, t('running.hint'))),
                h('div', { className: 'tp-strip', ref: gridRef },
                  h('div', { className: 'tp-strip-track' },
                    gridItems.length === 0
                      ? h('div', { key: 'running-empty', className: 'tp-strip-empty' }, t('running.none'))
                      : gridItems.map((item) => {
                        const run = item.run
                        const column = item.column || createColumnState(run.runId, run.status, { now: 0, autoExpandNew: false })
                        return h(RunColumn, {
                          key: item.id,
                          run,
                          column,
                          exiting: item.exiting === true,
                          registerCard: item.exiting === true ? undefined : registerCard,
                          t,
                          now,
                          hostOffset: view.hostOffset,
                          session: sessionById.get(run.ownerSessionId),
                          query,
                          armed: armedRunId === run.runId,
                          phase: item.exiting === true ? 'completed' : (phaseById.get(item.id) || 'running'),
                          onLingerPause: () => patchColumn(item.id, { linger: pauseLinger((view.columns[item.id] || {}).linger, Date.now()) }),
                          onLingerResume: () => patchColumn(item.id, { linger: resumeLinger((view.columns[item.id] || {}).linger, Date.now()) }),
                          onLingerCollapse: () => patchColumn(item.id, {
                            linger: collapseLinger((view.columns[item.id] || {}).linger),
                            collapse: { ...((view.columns[item.id] || {}).collapse || createCollapseState()), expanded: false, deadline: null },
                          }),
                          dragWidth: drag !== null && drag.runId === run.runId ? drag.width : null,
                          outRefs,
                          droppedLines: asNumber(view.droppedLines[run.runId], 0),
                          onMaximize: () => {
                            focusRunRef.current = run.runId
                            setMaxRunId(run.runId)
                          },
                          onStop: () => handleStop(run.runId),
                          onResizeStart: (event) => beginResize(event, run.runId),
                          onResizeReset: () => resetWidth(run.runId),
                          onScroll: (event) => {
                            const el = event.currentTarget
                            patchColumn(run.runId, {
                              follow: onScrollFollow(column.follow, {
                                scrollTop: el.scrollTop,
                                scrollHeight: el.scrollHeight,
                                clientHeight: el.clientHeight,
                              }),
                              scrollTop: el.scrollTop,
                            })
                          },
                          onResume: () => scrollOutputToBottom(run.runId),
                          onExitFollow: () => patchColumn(run.runId, { follow: { ...column.follow, following: false } }),
                        })
                      }))),
                completedRuns.length > 0
                  ? h(CompletedSection, {
                    view,
                    runs: completedRuns,
                    t,
                    now,
                    hostOffset: view.hostOffset,
                    query,
                    actions: {
                      toggleGroup: () => patchView((previous) => ({ ...previous, group: { ...previous.group, completedCollapsed: previous.group.completedCollapsed === false } })),
                      clearCompleted,
                      toggleRow,
                      // 「固定展开」在 v9 等价于保持该行展开（group.expandedIds 持久到本次挂载/缓存）
                      pinRow: (runId) => setRowExpanded(runId, true),
                      copied: () => showNotice(t('actions.copied'), 'success'),
                      copyFailed: () => showNotice(t('actions.copyFailed'), 'error'),
                    },
                  })
                  : null,
                ),
      )

      const toast = undo !== null
        ? h('div', { className: 'tp-toast tp-toast-warn', role: 'status' },
          h('span', null, tpl(t, 'filter.cleared', { n: undo.count })),
          h('button', { className: 'tp-btn', type: 'button', onClick: undoClear }, t('filter.undo')))
        : connection.notice !== null && connection.notice !== undefined
          ? h('div', { className: 'tp-toast tp-toast-' + (connection.notice.kind || 'info'), role: 'status' }, connection.notice.text)
          : null

      const dialog = maxRun === null || maxRun === undefined
        ? null
        : h(MaximizedDialog, {
          run: maxRun,
          t,
          now,
          hostOffset: view.hostOffset,
          armed: armedRunId === maxRun.runId,
          onClose: () => {
            focusRunRef.current = null
            setMaxRunId(null)
          },
          onStop: () => handleStop(maxRun.runId),
          onCopied: () => showNotice(t('actions.copied'), 'success'),
          onCopyFailed: () => showNotice(t('actions.copyFailed'), 'error'),
        })

      if (sessionId === '') {
        return root(h('div', { className: 'tp-state' },
          h('div', { className: 'tp-state-glyph' }, h(TerminalGlyph)),
          h('div', { className: 'tp-state-title' }, t('panel.loading'))))
      }
      return root(bannerView, toolbarView, mainView, toast, dialog)
    }

    /**
     * 插件装配：一切注册都走 `ctx.effect`，卸载时全部撤销。
     * @param ctx 插件根上下文（inject: slots / locale）。
     */
    function apply(ctx) {
      ctx.effect(() => insertStyle(), 'terminal-panel: styles')
      // v8 #1：插件卸载清空会话缓存（React 卸载不清，切 tab 需要保留）。
      ctx.effect(() => () => SESSION_CACHE.clear(), 'terminal-panel: session cache')
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'terminal-panel: dictionaries')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: 'terminal-panel',
        order: 30,
        locale: NS,
        label: () => t('tab.terminal'),
        // 不返回 t / sessionId 等保留名：owner props 已由 renderer 合并且优先级最高（contract F28）。
        inject: () => ({}),
      }, TerminalPanel))
    }

    const inject = ['slots', 'locale']

    // 纯函数导出（contract §11.2 的全部签名 + UI 内部使用的辅助函数），
    // tester 直接从 `mod.__internals` 取用，无需 React 环境。
    const __internals = {
      // 列宽（280–640，默认 352）
      clampColumnWidth,
      DEFAULT_COLUMN_WIDTH,
      MIN_COLUMN_WIDTH,
      MAX_COLUMN_WIDTH,
      // 筛选与排序
      filterRuns,
      countByKind,
      searchMatch,
      orderRunningColumns,
      groupCompleted,
      // 跟随
      createFollowState,
      onScrollFollow,
      onOutputFollow,
      collapseVisual,
      firstCommandLine,
      applyComposerHidden,
      isRevisionRollback,
      runPhase,
      lingerVisual,
      pauseLinger,
      resumeLinger,
      collapseLinger,
      createSessionCache,
      SESSION_CACHE,
      LINGER_DELAY_MS,
      CARD_EXIT_MS,
      FLIP_MS,
      flipDeltas,
      // 自动收起
      createCollapseState,
      armCollapse,
      pauseCollapse,
      resumeCollapse,
      tickCollapse,
      pinCollapse,
      // 文本与时间
      stripAnsi,
      tailLines,
      formatDuration,
      formatCountdown,
      // 核心 reducer
      mergePoll,
      // 额外辅助（非 tester 契约，UI 与集成测试可用）
      createViewState,
      createColumnState,
      pruneRuns,
      expandCollapse,
      unpinCollapse,
      runText,
      outputText,
      formatClock,
      formatBytes,
      isTerminalStatus,
      FOLLOW_TOLERANCE_PX,
      COLLAPSE_DELAY_MS,
      SCROLLBACK_LINES,
      COMPLETED_RETAIN_MS,
      MAX_RUNS,
    }

    return { inject, apply, __internals }
  },
})
