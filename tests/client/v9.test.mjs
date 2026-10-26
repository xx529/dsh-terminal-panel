// Client v9 纯/静态回归（contract v9 §6.9/§9.2/§9.3；ui-spec v7 A23–A26）
// 覆盖：group.expandedIds（保留/裁剪/不依赖 columns）、已完成行无倒计时渲染、
// 按行铺满网格、黄/绿/红状态色板与 hover/focus 不改尺寸。
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

const sliceBetween = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, `源码缺少标记：${startMarker}`)
  const end = src.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `源码缺少结束标记：${endMarker}`)
  return src.slice(start, end)
}

/* ---------------- A23 group.expandedIds ---------------- */
test('A23 createViewState：group.expandedIds 默认空数组（纯布尔集合，无 deadline）', { skip }, () => {
  const state = fn('createViewState')('sess')
  assert.deepEqual(state.group.expandedIds, [])
  assert.equal(state.group.completedCollapsed, true)
  assert.equal('collapse' in state.group, false)
})

test('A23 mergePoll：预置 expandedIds 跨帧保留（数组拷贝、不共享引用）', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const state = makeViewState({ group: { completedCollapsed: true, expandedIds: ['job:1'] } })
  const out = mergePoll(state, makeFrame({ revision: 1 }))
  assert.deepEqual(out.group.expandedIds, ['job:1'])
  assert.notEqual(out.group.expandedIds, state.group.expandedIds, '不得共享同一数组引用（reducer 不可变）')
  out.group.expandedIds.push('job:2')
  assert.deepEqual(state.group.expandedIds, ['job:1'], '外部修改不得影响入参 state')
})

test('A23 mergePoll removed：expandedIds 裁剪为仍存在的 runId（A23 硬要求）', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const a = makeRun({ runId: 'job:a', status: 'completed', finishedAt: 1_000 })
  const b = makeRun({ runId: 'job:b', status: 'completed', finishedAt: 2_000 })
  let state = mergePoll(makeViewState(), makeFrame({ revision: 1, runs: [a, b] }))
  state = { ...state, group: { ...state.group, expandedIds: ['job:a', 'job:b'] } }
  const out = mergePoll(state, makeFrame({ revision: 2, removed: ['job:a'] }))
  assert.deepEqual(out.group.expandedIds, ['job:b'], 'removed 后必须裁剪对应 id')
  assert.equal(out.runs['job:a'], undefined)
  // 未命中 removed 不影响其它 id
  const out2 = mergePoll(out, makeFrame({ revision: 3, removed: ['never'] }))
  assert.deepEqual(out2.group.expandedIds, ['job:b'])
})

test('A23 源码：setRowExpanded/toggleRow 只操作 group.expandedIds，不依赖 view.columns[runId]', { skip }, async () => {
  const src = await source()
  const block = sliceBetween(src, 'const setRowExpanded = (runId, expanded) =>', 'const clearCompleted = () => {')
  assert.match(block, /group\.expandedIds/, '必须增删 group.expandedIds')
  assert.ok(!/columns\s*\[/.test(block), 'toggleRow/setRowExpanded 不得依赖 view.columns[runId]（A23）')
  assert.ok(!/collapse\b/.test(block), '不得复用 column.collapse（v7 旧语义已删除）')
  // 行头/组头都可点击：CompletedRow onClick/onKeyDown → onToggle；组头 onClick → actions.toggleGroup
  const rowBlock = sliceBetween(src, 'function CompletedRow(props)', 'function CompletedSection(props)')
  assert.match(rowBlock, /onClick: \(event\) => \{[\s\S]*props\.onToggle\(\)/, '行头点击必须切换该行展开（onToggle）')
  assert.match(rowBlock, /'aria-expanded': isExpanded/, '行必须暴露 aria-expanded')
  const sectionBlock = sliceBetween(src, 'function CompletedSection(props)', 'function PanelSkeleton(props)')
  assert.match(sectionBlock, /onClick: actions\.toggleGroup/, '组头点击必须切换组折叠（toggleGroup）')
  assert.match(sectionBlock, /expandedIds\.indexOf\(run\.runId\) >= 0/, '行展开状态必须由 group.expandedIds 驱动')
})

test('A23 源码：clearCompleted 同时裁剪 expandedIds 与 order/runs/columns', { skip }, async () => {
  const src = await source()
  const block = sliceBetween(src, 'const clearCompleted = () => {', 'const undoClear = () => {')
  assert.match(block, /expandedIds: .*filter\(\(runId\) => nextRuns\[runId\] !== undefined\)/, '清空已完成必须裁剪 expandedIds')
  assert.match(block, /delete nextRuns\[runId\]/)
  assert.match(block, /delete nextColumns\[runId\]/)
})

/* ---------------- A24 已完成行无倒计时 ---------------- */
test('A24 已完成行（组件级静态）：不渲染 collapse.in / tp-countdown / tp-progress 与 column.collapse', { skip }, async () => {
  const src = await source()
  const rowBlock = sliceBetween(src, 'function CompletedRow(props)', 'function CompletedSection(props)')
  for (const dead of ['collapse.in', 'tp-countdown', 'tp-progress', 'collapseProgress', 'deadline']) {
    assert.ok(!rowBlock.includes(dead), `已完成行不得渲染 v7 倒计时元素：${dead}`)
  }
  assert.ok(!/collapse\b/.test(rowBlock), '已完成行不得读取 column.collapse')
  assert.match(rowBlock, /const isExpanded = expanded === true/, '展开态只由 group.expandedIds 传入的 expanded 布尔决定')
  // 区分「样式仍存在但未使用」：CSS 仍在（v7 测试仍在断言），但渲染层不得再有 className/t('collapse.in')
  assert.ok(src.includes("'.tp-countdown{"), 'v7 死样式暂留（frontend 说明：为兼容现有 v7 用例断言）')
  assert.ok(!/className: 'tp-countdown/.test(src), '整个 client 不得再渲染 .tp-countdown')
  assert.ok(!/className: 'tp-progress/.test(src), '整个 client 不得再渲染 .tp-progress')
  assert.ok(!/t\('collapse\.in'\)/.test(src), "不得再使用 collapse.in 文案（已完成行无倒计时）")
})

/* ---------------- A25/A26 网格与色板（静态） ---------------- */
test('A26 网格铺满：.tp-cell 行内拉伸 + 内层 .tp-col width:100%，无横向滚动/固定 352 锁死', { skip }, async () => {
  const src = await source()
  assert.match(src, /\.tp-cell\{[^}]*flex:1 1 var\(--tp-card-w, 352px\)/, '.tp-cell 必须 flex:1 1 拉伸铺满一行')
  assert.match(src, /\.tp-cell\{[^}]*min-width:min\(280px,100%\)/, '窄容器单列下限（不横向滚动）')
  assert.match(src, /\.tp-cell\{[^}]*max-width:100%/, '卡片不得超出容器')
  assert.match(src, /\.tp-cell\{[^}]*height:342px/, '行内卡片等高')
  assert.ok(src.includes('.tp-col{position:relative;display:flex;flex-direction:column;flex:none;width:100%;'), '内层 .tp-col 必须填满 .tp-cell（width:100%）')
  assert.ok(!/\.tp-col\{[^}]*width:352px/.test(src), '卡片不得锁死 352px（v8 固定宽已作废；skeleton 占位宽除外）')
  assert.match(src, /\.tp-strip\{[^}]*overflow-x:hidden/, '执行区不得横向滚动')
  assert.ok(!src.includes('overflow-x:auto'), '不得出现 overflow-x:auto')
  for (const remnant of ['scrollLeft', 'tp-more', 'visibleIds']) assert.ok(!src.includes(remnant), `横向遗留必须移除：${remnant}`)
  // 宽度通过内联 CSS 变量 + flex-basis 写入（拖拽改宽仍走 clampColumnWidth 280–640）
  assert.match(src, /'--tp-card-w': width \+ 'px', flexBasis: width \+ 'px'/, '卡片宽度必须由 --tp-card-w/flexBasis 驱动')
  assert.match(src, /const width = clampColumnWidth\(column\.width\)/, '拖拽宽度必须经 clampColumnWidth 夹取')
})

test('A25 状态色板：running 黄 / linger+completed 绿 / failed 红；hover/focus 只改颜色类属性', { skip }, async () => {
  const src = await source()
  // 注意：CSS 在源码字符串中写作 \'running\'（单引号被转义）
  assert.ok(src.includes("data-phase=\\'running\\']{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary)"), '进行中卡片边框必须为 warn（黄）')
  assert.ok(src.includes("data-phase=\\'linger\\'],.tp-col[data-phase=\\'completed\\']{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary)"), 'linger/completed 卡片边框必须为 success（绿）')
  assert.ok(src.includes("data-phase=\\'running\\']:hover,.tp-col[data-phase=\\'running\\']:focus-within{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary)"), 'running hover/focus 只改 border-color')
  assert.ok(src.includes("data-phase=\\'linger\\']:hover,.tp-col[data-phase=\\'linger\\']:focus-within,.tp-col[data-phase=\\'completed\\']:hover,.tp-col[data-phase=\\'completed\\']:focus-within{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary)"), 'linger/completed hover/focus 只改 border-color')
  assert.match(src, /\.tp-row\{[^}]*border:1px solid color-mix\(in srgb, var\(--dsw-alias-state-success-primary\)/, '已完成行默认绿边框')
  assert.match(src, /\.tp-row-failed\{border-color:color-mix\(in srgb, var\(--dsw-alias-state-error-primary\)/, '失败行红边框')
  // hover/focus 规则不得改变尺寸/布局
  const hoverRules = [...src.matchAll(/([^{}]+:(?:hover|focus-within)[^{}]*)\{([^}]*)\}/g)]
  const stateRules = hoverRules.filter(([, selector]) => selector.includes('.tp-col') || selector.includes('.tp-row'))
  assert.ok(stateRules.length >= 3, `应至少 3 条状态 hover/focus 规则，实际 ${stateRules.length}`)
  for (const [, selector, body] of stateRules) {
    assert.ok(!/(^|;)(width|height|min-width|max-width|padding|margin|border-width)\s*:/.test(body), `hover/focus 不得改布局尺寸：${selector.trim()} → ${body.trim()}`)
    assert.match(body, /border-color|opacity|box-shadow|outline|background/, `hover/focus 只能改颜色/阴影类属性：${selector.trim()}`)
  }
})
