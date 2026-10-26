// Client v10 纯/静态回归（T54；ui-spec v8 A29–A33 的代码侧断言）
// 覆盖：2px 状态边框（后置覆盖）、CSS grid auto-fill 统一卡宽、拖拽统一列宽、
// 同步 ghost 插入原位、FLIP 测量/签名/去重/reduced-motion。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'

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

/* ---------------- A29 2px 状态边框 ---------------- */
test('A29 2px 边框：`.tp-col`/`.tp-row` 均存在 border-width:2px 覆盖串，且保留旧 1px 基线（兼容断言）', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes('.tp-col{border-width:2px}'), '必须存在 .tp-col 的 2px 覆盖串')
  assert.ok(src.includes('.tp-row{border-width:2px}'), '必须存在 .tp-row 的 2px 覆盖串')
  assert.ok(src.includes('border:1px solid'), '旧 1px 基线字符串保留（兼容旧断言），不应删除')
  assert.ok(!/\.tp-col\{border:2px/.test(src), '不得用简写 border:2px（会覆盖状态色）；必须只覆盖 border-width')
})

test('A29 2px 边框（级联顺序 = 生效 2px）：border-width:2px 规则在 1px shorthand 之后', { skip }, async () => {
  // CSS 级联：同特异性、同 origin → 后出现的规则胜出。
  // 生效条件：`.tp-col`/`.tp-row` 的 border-width:2px 覆盖串必须出现在其 border:1px 基线之后，
  // 且其后不得再有同选择器的 border:1px 简写（否则宽度又被重置回 1px）。
  const src = await source()
  const colBase = src.indexOf('.tp-col{position:relative;display:flex')
  const colTwoPx = src.indexOf('.tp-col{border-width:2px}')
  const rowBase = src.indexOf('.tp-row{position:relative;display:flex')
  const rowTwoPx = src.indexOf('.tp-row{border-width:2px}')
  assert.ok(colBase >= 0 && colTwoPx > colBase, '`.tp-col{border-width:2px}` 必须在 `.tp-col` 1px 基线之后（级联才生效 2px）')
  assert.ok(rowBase >= 0 && rowTwoPx > rowBase, '`.tp-row{border-width:2px}` 必须在 `.tp-row` 1px 基线之后（级联才生效 2px）')
  const afterCol = src.slice(colTwoPx)
  const afterRow = src.slice(rowTwoPx)
  assert.ok(!/\.tp-col\{[^}]*border:\s*1px/.test(afterCol), '2px 覆盖之后不得再有 .tp-col 的 border:1px 简写（否则覆盖失效）')
  assert.ok(!/\.tp-row\{[^}]*border:\s*1px/.test(afterRow), '2px 覆盖之后不得再有 .tp-row 的 border:1px 简写（否则覆盖失效）')
  // 生效值的静态推导：最后一条对 .tp-col/.tp-row 的 border(-width) 声明应为 2px
  const lastColBorder = [...src.matchAll(/\.tp-col\{([^}]*)\}/g)].map((match) => match[1]).filter((body) => /border(-width)?\s*:/.test(body)).pop()
  const lastRowBorder = [...src.matchAll(/\.tp-row\{([^}]*)\}/g)].map((match) => match[1]).filter((body) => /border(-width)?\s*:/.test(body)).pop()
  assert.match(lastColBorder ?? '', /border-width:2px/, '.tp-col 最后一条 border 声明必须使生效宽度为 2px')
  assert.match(lastRowBorder ?? '', /border-width:2px/, '.tp-row 最后一条 border 声明必须使生效宽度为 2px')
})

test('A29 状态色板：running 65% / linger+completed 60% / failed 65%（v10 加深）', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes("data-phase=\\'running\\']{border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 65%, var(--dsw-alias-border-l1))}"), 'running 边框 65% warn')
  assert.ok(src.includes("data-phase=\\'linger\\'],.tp-col[data-phase=\\'completed\\']{border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-border-l1))}"), 'linger/completed 边框 60% success')
  assert.ok(src.includes('65%, var(--dsw-alias-border-l1))'), 'failed 行 65% error')
  assert.ok(src.includes('border:1px solid color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%'), '已完成行基线绿边框保留')
})

test('A29 hover/focus：只改 border-color + inset box-shadow，绝不含尺寸属性', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes('box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent)'), 'running hover/focus 必须有 inset box-shadow')
  assert.ok(src.includes('box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-success-primary) 45%, transparent)'), 'linger/completed hover/focus 必须有 inset box-shadow')
  assert.ok(src.includes('box-shadow:inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-error-primary) 45%, transparent)'), 'failed hover/focus 必须有 inset box-shadow')
  assert.ok(src.includes('92%'), 'hover/focus 加深到 92%（边框色）')
  const hoverRules = [...src.matchAll(/([^{}]+:(?:hover|focus-within|focus-visible)[^{}]*)\{([^}]*)\}/g)]
    .filter(([, selector]) => selector.includes('.tp-col') || selector.includes('.tp-row'))
  assert.ok(hoverRules.length >= 6, `状态 hover/focus 规则数量不足：${hoverRules.length}`)
  for (const [, selector, body] of hoverRules) {
    assert.ok(!/(^|;)\s*(border-width|width|height|min-width|max-width|padding|margin|border-style)\s*:/.test(body), `hover/focus 不得改尺寸：${selector.trim()} → ${body.trim()}`)
    assert.match(body, /border-color|box-shadow|outline|opacity|background/, `hover/focus 只能改颜色/阴影类属性：${selector.trim()}`)
  }
})

/* ---------------- A30 统一卡宽网格 ---------------- */
test('A30 网格：display:grid + auto-fill minmax(min(100%,var(--tp-card-w,352px)),1fr)、gap:12px、align-content:start', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes("'.tp-strip-track{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--tp-card-w,352px)),1fr));gap:12px;align-content:start;"), '必须使用 grid + auto-fill 统一列宽（最后一行单卡不拉长）')
  assert.equal(src.includes('auto-fit'), false, '不得出现 auto-fit（会让单卡拉满整行）')
  assert.ok(src.includes('minmax(min(100%,var(--tp-card-w,352px)),1fr)'), '窄容器 min(100%, …) 保证单列不横向溢出')
  assert.ok(src.includes('.tp-cell{min-width:0}'), 'grid 下必须后置 min-width:0，避免旧 min(280px,100%) 撑出横滚')
  const track = sliceBetween(src, "h('div', { className: 'tp-strip-track'", 'gridItems.length === 0')
  assert.match(track, /style: \{ '--tp-card-w': cardWidth \+ 'px' \}/, '统一列宽必须由容器 --tp-card-w 驱动')
})

test('A30 拖拽语义：统一列宽 clamp 280–640、写 prefs.defaultWidth、双击复位 352', { skip }, async () => {
  const src = await source()
  const resize = sliceBetween(src, 'const beginResize = (event, runId) => {', 'const resetWidth = (runId) => {')
  assert.match(resize, /const startWidth = clampColumnWidth\(cardWidth\)/, '拖拽起点必须取统一 cardWidth')
  assert.match(resize, /latest = clampColumnWidth\(startWidth \+ \(moveEvent\.clientX - startX\)\)/, '拖拽必须 clamp 280–640')
  assert.match(resize, /setCardWidth\(latest\)/, '拖拽必须更新统一 cardWidth（不是只改单卡）')
  assert.match(resize, /prefs\.defaultWidth = latest/, '松手必须把统一宽度写入会话偏好')
  const reset = sliceBetween(src, 'const resetWidth = (runId) => {', 'const scrollOutputToBottom = (runId) => {')
  assert.match(reset, /setCardWidth\(DEFAULT_COLUMN_WIDTH\)/, '双击复位必须把统一宽度设回 352')
  assert.match(reset, /prefs\.defaultWidth = DEFAULT_COLUMN_WIDTH/)
  // 夹取边界（垂类纯函数已在 v8 用例覆盖，这里补 v10 语义：前后端一致 280/640/复位 352）
  const clamp = fn('clampColumnWidth')
  assert.equal(clamp(279), 280)
  assert.equal(clamp(641), 640)
  assert.equal(clamp(352), 352)
})

test('A30 兼容残留（INFO）：旧 flex:1 1 / inline flexBasis 字符串仍在，但 grid 下不参与列宽计算', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes('.tp-cell{display:flex;flex:1 1 var(--tp-card-w, 352px)'), '旧 flex 基线保留（兼容旧静态断言；T54 交接提过兼容）')
  assert.ok(src.includes("style: { '--tp-card-w': width + 'px', flexBasis: width + 'px' }"), '旧单卡 inline flexBasis 保留（grid 下无效）')
  // 生效布局由 grid 容器决定：flex 属性是 grid 容器里的 item 属性，不影响列宽
  assert.ok(src.includes('grid-template-columns:repeat(auto-fill'), 'grid 容器才是列宽来源')
})

/* ---------------- A31 同步 ghost + FLIP ---------------- */
test('A31 同步 ghost：render 期派生（无 setExiting/passive setState）、按 orderIndex 插回原位', { skip }, async () => {
  const src = await source()
  assert.equal(src.includes('setExiting'), false, '不得再走 passive setExiting 路径（v10 闪烁根因）')
  assert.equal(src.includes('exitTimersRef'), false, '旧 exitTimersRef 路径必须移除')
  const renderBlock = sliceBetween(src, 'const activeSet = new Set(activeIds)', '// v8 #2：空态稳定窗口')
  assert.match(renderBlock, /const newlyRemoved = \[\]/, 'ghost 必须在 render 期同步收集')
  assert.match(renderBlock, /orderIndex: position < 0 \? previousOrderRef\.current\.length : position/, 'ghost 必须记录移除前 orderIndex')
  assert.match(renderBlock, /gridItems\.splice\(Math\.min\(entry\.orderIndex, gridItems\.length\), 0, \{/, 'ghost 必须插到原槽位（splice），不得 push 末尾')
  assert.match(renderBlock, /\.filter\(\(entry\) => !activeSet\.has\(entry\.id\)\)/, '同 id 必须去重（active 优先）')
  assert.match(renderBlock, /\.sort\(\(left, right\) => left\.orderIndex - right\.orderIndex\)/, '多 ghost 必须按 orderIndex 排序')
})

test('A31 FLIP：测量集合含 ghost、签名 activeKey|exitingKey（不含 gridWidth）、layout effect 比较', { skip }, async () => {
  const src = await source()
  assert.equal(src.includes('pendingFlipRef'), false, '不得再用 pendingFlipRef（v10 改为签名比较）')
  assert.ok(src.includes("layoutSignatureRef.current = activeKey + '|' + exitingKey"), '签名 = activeKey|exitingKey')
  assert.ok(!/activeKey \+ '#' \+ gridWidth/.test(src), '签名不得再含 gridWidth')
  const layoutEffect = sliceBetween(src, '// v10 #C：FLIP 位移', '// v10 #C：ghost 定时清理')
  assert.match(layoutEffect, /const signature = layoutSignatureRef\.current/, 'FLIP 必须在 layout effect 里读签名')
  assert.match(layoutEffect, /lastSignatureRef\.current = signature/, 'layout effect 负责更新上一次签名')
  assert.match(layoutEffect, /for \(const runId of previousOrderRef\.current\)/, '测量集合必须来自 previousOrderRef（含 ghost 槽位）')
  assert.match(src, /previousOrderRef\.current = gridItems\.map\(\(item\) => item\.id\)/, 'previousOrderRef 必须由 gridItems（active+ghost）派生')
  assert.match(layoutEffect, /exitingIdsRef\.current\.has\(runId\)/, 'ghost 参与测量但不位移（跳过 FLIP transform）')
})

test('A31 FLIP：ghost 也注册卡片 ref（可测量）、清理残留 transform、reduced-motion 瞬时', { skip }, async () => {
  const src = await source()
  assert.ok(!src.includes('registerCard: item.exiting === true ? undefined : registerCard'), 'ghost 必须注册 ref（否则无法测量，FLIP 断档）')
  assert.match(src, /registerCard,\s*\n\s*t,/, 'RunColumn 必须统一收到 registerCard')
  assert.match(src, /dataset\.tpFlip = '1'/, 'FLIP 动画必须打临时标记以便下轮清理')
  assert.match(src, /if \(el\.dataset\.tpFlip === '1'\)/, 'layout effect 必须先清理上一轮残留 transform/transition')
  assert.match(src, /if \(prefersReducedMotion\(\)\) return undefined/, 'reduced-motion 下 ghost 定时器必须跳过（瞬时退场）')
  assert.match(src, /@media \(prefers-reduced-motion: reduce\)\{\.tp-col,\.tp-row,\.tp-col-exit\{animation:none\}/, 'CSS reduced-motion 必须关闭退场动画')
  assert.match(src, /if \(reducedMotion\) \{/, 'render 期 reduced-motion 必须清空 ghost（不占位）')
})

test('A31 多卡同帧移除 >2 → 跳过 fade（避免多 ghost 同槽抖动）', { skip }, async () => {
  const src = await source()
  assert.match(src, /if \(newlyRemoved\.length > 2\) \{/, '同帧 >2 移除必须跳过 fade')
  assert.match(src, /exitingRef\.current\.delete\(entry\.id\)/, '跳过时不得留下 ghost')
})

test('A31 ghost 定时清理：CARD_EXIT_MS 后删除并触发下一帧', { skip }, async () => {
  const src = await source()
  assert.match(src, /entry\.timer = setTimeout\(\(\) => \{[\s\S]*?exitingRef\.current\.delete\(entry\.id\)[\s\S]*?forceExitRender\(\(value\) => value \+ 1\)/, 'ghost 必须 180ms 后清理并触发重渲染')
  assert.match(src, /CARD_EXIT_MS\)/, '清理计时必须用 CARD_EXIT_MS（180ms）')
})
