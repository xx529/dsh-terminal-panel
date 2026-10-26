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
          const left = asNumber(a.finishedAt, asNumber(a.lastOutputAt, asNumber(a.startedAt, 0)))
          const right = asNumber(b.finishedAt, asNumber(b.lastOutputAt, asNumber(b.startedAt, 0)))
          if (right !== left) return right - left
          return String(a.runId).localeCompare(String(b.runId))
        })
        .map((run) => run.runId)
    }

    /** Run 的通道累积文本（stdout → stderr → job → terminal）。 */
    function runText(run) {
      if (!run || !isObject(run.output)) return ''
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
      return { ...base, paused: false, deadline: asNumber(now, Date.now()) + COLLAPSE_DELAY_MS }
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

    /** 倒计时文案：剩余整秒向上取整（3s 后收起）。 */
    function formatCountdown(ms) {
      const value = typeof ms === 'number' && isFinite(ms) ? ms : 0
      return Math.max(0, Math.ceil(value / 1000)) + 's 后收起'
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
        'kind', 'status', 'stopping', 'ownerSessionId', 'agent', 'title', 'command', 'cwd',
        'startedAt', 'finishedAt', 'exitCode', 'signal', 'detail', 'handle', 'stoppable',
        'totals', 'lossy', 'truncated',
      ]
      for (const key of keys) {
        const value = frameRun[key]
        if (value === undefined) continue
        if ((key === 'agent' || key === 'handle' || key === 'totals') && isObject(value)) {
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
        : { runId, kind: 'bash', status: 'running', ownerSessionId: '', agent: { id: '', name: '', role: 'unknown' }, title: '', startedAt: now, stoppable: false, output: {}, streams: {}, totals: {}, lossy: false, truncated: false }
      mergeMeta(run, frameRun, previousRun)
      run.runId = runId
      if (typeof frameRun.status === 'string') run.status = frameRun.status
      if (typeof frameRun.stoppable === 'boolean') run.stoppable = frameRun.stoppable

      const frameOutput = isObject(frameRun.output) ? frameRun.output : {}
      let dropped = 0
      let sawOutput = false

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
            text += stripAnsi(chunk.text)
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
          text += stripAnsi(terminalDelta.text)
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
      if (!wasTerminal && nowTerminal) {
        column.collapse = armCollapse(column.collapse, now)
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
      if (frameRevision !== undefined) {
        const applied = asNumber(base.revision, 0)
        if (frameRevision <= applied) return state
      }
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
        pendingFrameRevision: frameRevision !== undefined ? frameRevision : base.pendingFrameRevision,
        serverTime: asNumber(frame.serverTime, now),
        lastFrameAt: now,
      }
      if (frameRevision !== undefined) next.revision = frameRevision
      if (typeof frame.sessionId === 'string' && frame.sessionId !== '') next.sessionId = frame.sessionId
      if (Array.isArray(frame.sessions)) next.sessions = frame.sessions.slice()
      if (isObject(frame.availability)) next.availability = frame.availability
      if (isObject(frame.nextCursors)) next.cursors = { ...next.cursors, ...frame.nextCursors }
      if (isObject(frame.limits)) next.limits = { ...frame.limits }
      if (isObject(frame.hostInfo)) next.hostInfo = { ...frame.hostInfo }

      const removed = Array.isArray(frame.removed) ? frame.removed : []
      for (const runId of removed) {
        if (typeof runId !== 'string' || next.runs[runId] === undefined) continue
        delete next.runs[runId]
        delete next.columns[runId]
        delete next.droppedLines[runId]
      }

      const incoming = Array.isArray(frame.runs) ? frame.runs : []
      for (const frameRun of incoming) {
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
