// Client v7 纯函数 + 静态结构回归（ui-spec v5 A1–A13 / 契约 v7 §6/§10/§11.2）
// 覆盖：firstCommandLine（A1）、collapseVisual（A5/A6）、applyComposerHidden（A10 纯函数部分）、
// mergePoll 对 v7 新字段（inputs/notice/outputMode:'meta-only'）的归一化、以及
// 输入块/抖动约束/composer 的源码级静态断言。
//
// 说明：InputBlock/OutputArea 等组件在 factory 闭包内、未进入 __internals 冻结表，
// 无法在无 DOM 环境做真正的浅渲染 → 输入块结构用**源码静态断言**（A2/A3/A4/A13 的渲染级仍需真机 manual）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'
import { makeFrame, makeRun, makeViewState } from '../helpers/fixtures.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false
const fn = (name) => internalsFn(client, name)
const source = () => readFile(CLIENT_FILE, 'utf8')

/* ---------------- A1 firstCommandLine ---------------- */
test('A1 firstCommandLine：单行/多行/前导空行/空白折叠', { skip }, () => {
  const f = fn('firstCommandLine')
  assert.equal(f('npm test'), 'npm test')
  assert.equal(f('\n\n  npm test  \n echo hi'), 'npm test +1 行')
  assert.equal(f('  git   status   --short  '), 'git status --short')
  assert.equal(f('\n   \n'), '', '全空命令返回空串')
  assert.equal(f(''), '')
  assert.equal(f(null), '')
  assert.equal(f(123), '')
  assert.equal(f('a\n\n\n'), 'a', '尾部空行不计入 +N 行')
  assert.equal(f('a\nb\nc'), 'a +2 行')
})

test('A1 firstCommandLine：超长截断加省略号且保留 maxLen 语义', { skip }, () => {
  const f = fn('firstCommandLine')
  const long = 'x'.repeat(200)
  const out = f(long, 20)
  assert.equal(out, 'x'.repeat(19) + '…')
  assert.equal(out.length, 20)
  const custom = f(long, 10)
  assert.equal(custom, 'x'.repeat(9) + '…')
  assert.equal(f('short', 0), 'short', '非法 maxLen 回默认 120')
})

/* ---------------- A5/A6 collapseVisual + tick ---------------- */
test('A5 collapseVisual：仅展开态显示倒计时；到点 tick 折叠并清 deadline；10s 前不折叠', { skip }, () => {
  const create = fn('createCollapseState')
  const arm = fn('armCollapse')
  const visual = fn('collapseVisual')
  const tick = fn('tickCollapse')
  const now = 1_000
  const armed = arm(create(), now)

  const before = visual(armed, now + 5_000)
  assert.equal(before.expanded, true)
  assert.equal(before.visible, true)
  assert.equal(before.countdown, true, '展开且未到点 → 倒计时可见')
  assert.ok(before.remaining > 0 && before.remaining <= 10_000)
  assert.ok(before.progress > 0 && before.progress <= 1)

  const notYet = tick(armed, now + 9_999)
  assert.equal(notYet.expanded, true, '10s 前不得折叠（#4 缺陷回归）')
  assert.equal(visual(notYet, now + 9_999).countdown, true)

  const folded = tick(armed, now + 10_000)
  assert.equal(folded.expanded, false)
  assert.equal(folded.deadline, null, '到点折叠必须清 deadline（避免折叠后仍倒计时）')
  const foldedVisual = visual(folded, now + 10_000)
  assert.equal(foldedVisual.expanded, false)
  assert.equal(foldedVisual.countdown, false, '折叠后不得再显示倒计时')
  assert.equal(foldedVisual.progress, 0, '折叠后不得显示进度条')
})

test('A6 collapseVisual：paused 冻结、pinned 不 arm/不显示倒计时', { skip }, () => {
  const create = fn('createCollapseState')
  const arm = fn('armCollapse')
  const pause = fn('pauseCollapse')
  const visual = fn('collapseVisual')
  const tick = fn('tickCollapse')
  const pin = fn('pinCollapse')

  const armed = arm(create(), 1_000)
  const paused = pause(armed)
  assert.equal(visual(paused, 9_000).countdown, true, '暂停时倒计时冻结但仍在展示')
  assert.equal(tick(paused, 999_999).expanded, true, '暂停期间永不折叠')

  const pinned = pin(armed)
  assert.equal(pinned.deadline, null, 'pinned 不 arm')
  const pinnedVisual = visual(pinned, 5_000)
  assert.equal(pinnedVisual.countdown, false, 'pinned 不显示倒计时')
  assert.equal(pinnedVisual.pinned, true)
  assert.equal(tick(pinned, 999_999).expanded, true)
})

/* ---------------- A10 applyComposerHidden（DOM 副作用纯函数） ---------------- */
test('A10 applyComposerHidden：set/remove、幂等、null 安全、失败静默（不写 document.body）', { skip }, () => {
  const apply = fn('applyComposerHidden')
  const attrs = new Map()
  const node = {
    setAttribute(name, value) {
      attrs.set(name, value)
    },
    removeAttribute(name) {
      attrs.delete(name)
    },
  }
  assert.equal(apply(node, true), true)
  assert.equal(attrs.get('data-tp-composer-hidden'), '1')
  assert.equal(apply(node, true), true, '重复设置幂等')
  assert.equal(attrs.get('data-tp-composer-hidden'), '1')
  assert.equal(apply(node, false), true)
  assert.equal(attrs.has('data-tp-composer-hidden'), false)
  assert.equal(apply(node, false), true, '重复移除幂等')

  assert.equal(apply(null, true), false, 'null 节点安全返回 false')
  assert.equal(apply(undefined, false), false)
  assert.equal(apply({}, true), false, '无 setAttribute 返回 false（静默降级）')
  const throwing = {
    setAttribute() {
      throw new Error('boom')
    },
  }
  assert.equal(apply(throwing, true), false, '抛错必须静默降级返回 false，不得影响其它 tab')
})

/* ---------------- mergePoll：v7 新字段归一化 ---------------- */
test('mergePoll：Run.inputs 只保留末 20 条、notice 归一化、outputMode meta-only 保留', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const run = makeRun({
    runId: 'terminal:t-1',
    kind: 'terminal',
    title: '终端',
    outputMode: 'meta-only',
    notice: { code: 'terminal-no-agent', message: 'no agent', extra: 'ignored' },
    inputs: Array.from({ length: 25 }, (_, i) => `line-${i}`),
    handle: { terminalId: 't-1' },
  })
  const state = mergePoll(makeViewState(), makeFrame({ revision: 1, runs: [run] }))
  const merged = state.runs['terminal:t-1']
  assert.equal(merged.outputMode, 'meta-only')
  assert.equal(merged.notice.code, 'terminal-no-agent')
  assert.equal(merged.notice.message, 'no agent')
  assert.equal(merged.notice.extra, undefined, 'notice 只保留 code/message')
  assert.equal(merged.inputs.length, 20, '客户端同样只保留末 20 条')
  assert.equal(merged.inputs[19], 'line-24')
})

/* ---------------- 静态断言：抖动/输入块/composer（§A2/A3/A4/A7/A8/A9/A13） ---------------- */
test('A7 抖动约束（静态）：工具栏 nowrap、已完成区 flex 吃剩余高度、倒计时固定占位', { skip }, async () => {
  const src = await source()
  assert.match(src, /\.tp-toolbar\{[^}]*flex-wrap:nowrap/, '工具栏必须单行不换行')
  assert.match(src, /\.tp-toolbar\{[^}]*height:46px/, '工具栏固定高度（不随计数变化）')
  assert.match(src, /\.tp-countdown\{[^}]*min-width:74px/, '倒计时必须固定占位宽（出现/消失不改变布局）')
  assert.match(src, /\.tp-done-list\{[^}]*flex:1 1 auto/, '已完成区必须 flex 吃剩余高度')
  assert.match(src, /\.tp-done-list\{[^}]*max-height:none/, '已完成区不得再用 max-height:160px 固定高度（v7）')
})

test('A8 动画不重放（静态）：入场动画只在 [data-tp-fresh=playing] 上', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes('data-tp-fresh'), '必须使用一次性 fresh 标记')
  assert.ok(src.includes('animation:tp-fade-in 180ms'), '入场动画存在')
  assert.ok(/data-tp-fresh[^}\n]*\{animation:tp-fade-in/.test(src), '动画必须限定在 data-tp-fresh 选择器上')
  const colBase = /\.tp-col\{([^}]*)\}/.exec(src)?.[1] ?? ''
  const rowBase = /\.tp-row\{([^}]*)\}/.exec(src)?.[1] ?? ''
  assert.ok(colBase.length > 0 && !colBase.includes('animation:tp-fade-in'), '.tp-col 基础样式不得自带入场动画（否则轮询重建重放）')
  assert.ok(rowBase.length > 0 && !rowBase.includes('animation:tp-fade-in'), '.tp-row 基础样式不得自带入场动画')
  assert.match(src, /@media \(prefers-reduced-motion: reduce\)/, 'reduced-motion 必须覆盖动画')
})

test('A9 跟随滚动（静态）：只用容器 scrollTop=scrollHeight，无 scrollIntoView', { skip }, async () => {
  const src = await source()
  assert.equal((src.match(/scrollIntoView/g) ?? []).length, 0, '禁止 scrollIntoView（会滚动外层会话页面）')
  assert.match(src, /scrollTop\s*=\s*[^;\n]*scrollHeight/, '跟随必须用容器 scrollTop=scrollHeight')
})

test('A10 composer 隐藏（静态）：只对 [data-conversation-content] 打标记，无 document.body 写入', { skip }, async () => {
  const src = await source()
  assert.match(src, /closest\('\[data-conversation-content\]'\)/, '必须在 [data-conversation-content] 上打标记')
  assert.match(src, /data-tp-composer-hidden/, '必须有 marker 属性')
  assert.match(src, /\[data-conversation-content\]\[data-tp-composer-hidden\] \[data-composer-seat\]/, '必须有 CSS 隐藏规则')
  assert.ok(!/document\.body\.(setAttribute|dataset)/.test(src), '禁止在 document.body 上写标记（不得影响其它 tab）')
})

test('A2/A3/A4 输入块（源码级静态）：$ / › 前缀、inputs[0]=name 去重、notice 行、空输出仍渲染', { skip }, async () => {
  const src = await source()
  // 前缀
  assert.ok(src.includes("'$ '"), 'bash/job 输入块使用 "$ " 前缀')
  assert.ok(src.includes("'› '"), 'terminal inputs 使用 "› " 前缀')
  // terminal：inputs[0] 即 name 行；index 1 起渲染 send，且与 name 相同则跳过（frontend 小修）
  assert.match(src, /rawInputs\.length > 0 \? rawInputs\[0\]/, 'name 行必须取 inputs[0]')
  assert.match(src, /for \(let index = 1; index < rawInputs\.length/, '› 输入从 index 1 开始（不得重复打印 name）')
  assert.match(src, /text === name\) continue/, 'inputs[0] 与 name 重复时必须跳过一次')
  // notice 行
  assert.match(src, /className: 'tp-input-notice'/, 'notice 必须渲染为输入块上方一行提示')
  assert.match(src, /Icons\.alert\(\)/, 'notice 使用告警图标（非 emoji）')
  // 空输出仍有输入块：OutputArea 在输出前无条件渲染 InputBlock；空输出用 placeholder 文案
  assert.match(src, /h\(InputBlock, \{ key: 'input'/, '输出区必须渲染输入块')
  assert.match(src, /output\.empty|output\.finalOnly|output\.metaOnly/, '空输出必须有明确文案（不显示空白区）')
  assert.match(src, /tp-input-divider/, '输入块与输出之间必须有分隔线')
})

test('A13 meta-only 不误导（静态）：状态点不用运行中脉冲 + tier3 片段标注非实时全量', { skip }, async () => {
  const src = await source()
  assert.match(src, /metaOnly \? 'tp-dot' : 'tp-dot tp-dot-running'/, 'meta-only 不得使用运行中动画点')
  assert.match(src, /tp-status-meta/, 'meta-only 状态使用次要色（不显示运行中）')
  assert.match(src, /output\.tier3/, 'tier3 片段必须有「非实时全量」标注')
})
