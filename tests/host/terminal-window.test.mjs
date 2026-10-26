// Host 纯逻辑：持久终端行窗口（契约 v2 §11.1 `computeTerminalDelta`，backend 2026-10-26 定稿）
//   terminals.read：offset = 距最新行数（0=尾页）；window end=totalLines-offset、start=max(0,end-count)
//   返回 lineBegin=offset、lineEnd=offset+返回行数（同坐标系）；绝对行号 = totalLines - lineBegin
//   增量模型：prev={totalLines, tail}；k=page.totalLines-prev.totalLines（>0 尾页+行尾重叠去重 / =0 probe / <0 lossy）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'

const m = await loadHostModule('terminal-window')
const skip = m.missing ? m.reason : false

const mod = () => {
  if (!m.ok) throw new Error(m.reason)
  return m.mod
}
const fn = (name) => fnOf(m, name)

test('exports: 常量与纯函数（契约 v2 §11.1）', { skip }, () => {
  const api = mod()
  assert.equal(api.TERMINAL_PAGE_LINES, 400, '默认单页 400 行（§9 terminalPageLines）')
  assert.equal(api.MAX_DELTA_LINES, 10_000, 'delta 单轮行数上限')
  assert.equal(api.DEFAULT_OVERLAP_LINES, 32, '尾重叠去重默认 32 行')
  for (const name of [
    'createTerminalWindow', 'lastLine', 'tailLinesOf', 'dedupeTailOverlap',
    'planTerminalRead', 'computeTerminalDelta', 'applyTerminalRead', 'windowCursor',
  ]) {
    assert.equal(typeof fn(name), 'function', `缺少导出 ${name}`)
  }
})

test('createTerminalWindow: 空基线 {totalLines:0, tail:""}', { skip }, () => {
  assert.deepEqual(fn('createTerminalWindow')(), { totalLines: 0, tail: '' })
})

/* ---------------- lastLine / tailLinesOf ---------------- */
test('lastLine: 取最后一行（不含换行）', { skip }, () => {
  const f = fn('lastLine')
  assert.equal(f('a\nb\nc'), 'c')
  assert.equal(f('single'), 'single')
  assert.equal(f('a\n'), '')
  assert.equal(f(''), '')
})

test('tailLinesOf: 取最后 n 行并可跨行（空文本安全）', { skip }, () => {
  const f = fn('tailLinesOf')
  assert.equal(f('a\nb\nc\nd', 2), 'c\nd')
  assert.equal(f('a\nb', 32), 'a\nb')
  assert.equal(f('', 2), '')
})

/* ---------------- dedupeTailOverlap ---------------- */
test('dedupeTailOverlap: 整行重叠剥掉；行内续写只取后缀', { skip }, () => {
  const f = fn('dedupeTailOverlap')
  assert.deepEqual(f('c', 'c\nd'), { text: 'd', overlapLines: 1 })
  assert.deepEqual(f('a\nb\nc', 'b\nc\nd'), { text: 'd', overlapLines: 2 })
  assert.deepEqual(f('d', 'd plus'), { text: ' plus', overlapLines: 0 })
  assert.deepEqual(f('x', 'y'), { text: 'y', overlapLines: 0 })
  assert.deepEqual(f('', 'abc'), { text: 'abc', overlapLines: 0 })
})

/* ---------------- planTerminalRead ---------------- */
const PLAN_CASES = [
  ['initial 短输出', { totalLines: 0, tail: '' }, 5, undefined, { offset: 0, count: 5, mode: 'initial' }],
  ['initial 空输出 count 至少 1', { totalLines: 0, tail: '' }, 0, undefined, { offset: 0, count: 1, mode: 'initial' }],
  ['initial 超一页', { totalLines: 0, tail: '' }, 500, undefined, { offset: 0, count: 400, mode: 'initial' }],
  ['delta 行数差', { totalLines: 100, tail: 'x' }, 150, undefined, { offset: 0, count: 50, mode: 'delta' }],
  ['delta 受 MAX_DELTA_LINES 限制', { totalLines: 1, tail: 'x' }, 20_000, undefined, { offset: 0, count: 10_000, mode: 'delta' }],
  ['probe 无增长', { totalLines: 100, tail: 'x' }, 100, undefined, { offset: 0, count: 1, mode: 'probe' }],
  ['reset scrollback 被裁剪', { totalLines: 100, tail: 'x' }, 80, undefined, { offset: 0, count: 80, mode: 'reset' }],
  ['reset 到空 count 至少 1', { totalLines: 100, tail: 'x' }, 0, undefined, { offset: 0, count: 1, mode: 'reset' }],
  ['自定义 pageLines 仅影响 initial', { totalLines: 0, tail: '' }, 25, 10, { offset: 0, count: 10, mode: 'initial' }],
]

for (const [label, prev, totalLines, pageLines, expected] of PLAN_CASES) {
  test(`planTerminalRead: ${label}`, { skip }, () => {
    const plan = fn('planTerminalRead')(prev, totalLines, pageLines)
    assert.equal(plan.offset, expected.offset, 'offset 恒 0：读尾页，窗口起点由 count 反推')
    assert.equal(plan.count, expected.count, `count 期望 ${expected.count}，实际 ${plan.count}`)
    assert.equal(plan.mode, expected.mode, `mode 期望 ${expected.mode}，实际 ${plan.mode}`)
  })
}

/* ---------------- computeTerminalDelta ---------------- */
function page(text, { totalLines, lineBegin = 0, lineEnd, truncated = false }) {
  return { text, totalLines, lineBegin, lineEnd: lineEnd ?? lineBegin + text.split('\n').length, truncated }
}

test('computeTerminalDelta: 首见完整页 → 原文、nextCursor=totalLines、无 lossy', { skip }, () => {
  const { delta, nextBaseline } = fn('computeTerminalDelta')(
    fn('createTerminalWindow')(),
    page('a\nb\nc', { totalLines: 3, lineEnd: 3 }),
  )
  assert.equal(delta.text, 'a\nb\nc')
  assert.equal(delta.nextCursor, 3)
  assert.equal(delta.totalLines, 3)
  assert.equal(delta.absBegin, 0, '绝对起点 = totalLines - lineEnd')
  assert.equal(delta.absEnd, 3)
  assert.equal(delta.lossy, false)
  assert.equal(delta.truncated, false)
  assert.equal(nextBaseline.totalLines, 3)
})

test('computeTerminalDelta: 首见被 scrollback 裁剪 → lossy（有缺口）+ truncated（可续读）', { skip }, () => {
  const { delta, nextBaseline } = fn('computeTerminalDelta')(
    fn('createTerminalWindow')(),
    page('L600\nL601', { totalLines: 1_000, lineEnd: 400, truncated: true }),
  )
  assert.equal(delta.lossy, true, '页起点晚于已交付基线（absBegin>0）→ 缺口不可恢复')
  assert.equal(delta.truncated, true)
  assert.equal(delta.nextCursor, 1_000)
  assert.equal(nextBaseline.totalLines, 1_000)
})

test('computeTerminalDelta: delta 尾页重叠 → 剥重叠并保留行边界换行（不粘行）', { skip }, () => {
  const prev = { totalLines: 3, tail: 'c' }
  const { delta, nextBaseline } = fn('computeTerminalDelta')(
    prev,
    page('c\nd', { totalLines: 4, lineEnd: 2 }),
  )
  assert.equal(delta.text, '\nd', `增量必须带前导换行，否则 'a\\nb\\nc'+'d' 会粘成一行，实际 ${JSON.stringify(delta.text)}`)
  assert.equal(delta.nextCursor, 4, 'nextCursor = totalLines（已交付行数）')
  assert.equal(delta.lossy, false)
  assert.equal(nextBaseline.totalLines, 4)
  assert.ok(nextBaseline.tail.endsWith('d'))
})

test('computeTerminalDelta: delta 无重叠（跳到新行）→ 前导换行 + 原文', { skip }, () => {
  const prev = { totalLines: 3, tail: 'c' }
  const { delta } = fn('computeTerminalDelta')(prev, page('d\ne', { totalLines: 5, lineEnd: 2 }))
  assert.equal(delta.text, '\nd\ne')
  assert.equal(delta.nextCursor, 5)
})

test('computeTerminalDelta: probe 且无增长 → 空增量、游标不变（PTY 未换行刷新不产生假输出）', { skip }, () => {
  const prev = { totalLines: 4, tail: 'd' }
  const { delta, nextBaseline } = fn('computeTerminalDelta')(prev, page('d', { totalLines: 4, lineEnd: 1 }))
  assert.equal(delta.text, '')
  assert.equal(delta.nextCursor, 4, 'probe 游标不得前进')
  assert.equal(nextBaseline.totalLines, 4)
})

test('computeTerminalDelta: probe 期间无换行续写 → 只交付新增字符', { skip }, () => {
  const prev = { totalLines: 4, tail: 'd' }
  const { delta } = fn('computeTerminalDelta')(prev, page('d plus', { totalLines: 4, lineEnd: 1 }))
  assert.equal(delta.text, ' plus')
  assert.equal(delta.nextCursor, 4, 'probe 不推进行游标')
})

test('computeTerminalDelta: reset（totalLines 倒退）→ lossy，从头重发保留页', { skip }, () => {
  const prev = { totalLines: 100, tail: 'x' }
  const { delta, nextBaseline } = fn('computeTerminalDelta')(prev, page('a\nb', { totalLines: 2, lineEnd: 2 }))
  assert.equal(delta.lossy, true)
  assert.equal(delta.text, 'a\nb')
  assert.equal(delta.nextCursor, 2)
  assert.equal(nextBaseline.totalLines, 2)
})

test('computeTerminalDelta: 页窗口起点晚于已交付基线 → lossy（中间丢行）', { skip }, () => {
  const prev = { totalLines: 3, tail: 'c' }
  // total=6、lineEnd=2 → absBegin=4 > 3 → 缺口
  const { delta } = fn('computeTerminalDelta')(prev, page('e\nf', { totalLines: 6, lineEnd: 2 }))
  assert.equal(delta.lossy, true)
  assert.equal(delta.nextCursor, 6)
})

test('computeTerminalDelta: 空输出不抛错、不产生假行', { skip }, () => {
  const { delta, nextBaseline } = fn('computeTerminalDelta')(
    fn('createTerminalWindow')(),
    page('', { totalLines: 0, lineEnd: 0 }),
  )
  assert.equal(delta.text, '')
  assert.equal(delta.nextCursor, 0)
  assert.equal(delta.lossy, false)
  assert.equal(nextBaseline.tail, '')
})

test('computeTerminalDelta: 单行超长被服务端截断 → truncated=true 且文本保留', { skip }, () => {
  const huge = 'x'.repeat(20_000)
  const { delta } = fn('computeTerminalDelta')(
    fn('createTerminalWindow')(),
    page(huge, { totalLines: 1, lineEnd: 1, truncated: true }),
  )
  assert.equal(delta.truncated, true)
  assert.equal(delta.text.length, 20_000)
  assert.equal(delta.nextCursor, 1)
})

test('computeTerminalDelta: truncated = page.truncated || lineEnd<totalLines（冻结实现；v2 待裁决语义）', { skip }, () => {
  const prev = { totalLines: 3, tail: 'c' }
  // 尾页只含新增 1 行：lineEnd=1 < totalLines=4 → 冻结实现标 truncated（表示窗口未覆盖最旧行）
  const { delta } = fn('computeTerminalDelta')(prev, page('d', { totalLines: 4, lineEnd: 1 }))
  assert.equal(delta.text, '\nd')
  assert.equal(delta.truncated, true)
  // 覆盖到最旧行时（lineEnd === totalLines）不标 truncated
  const full = fn('computeTerminalDelta')(fn('createTerminalWindow')(), page('a\nb', { totalLines: 2, lineEnd: 2 }))
  assert.equal(full.delta.truncated, false)
})

test('applyTerminalRead: 便捷封装返回 {delta, window} 且 window=nextBaseline', { skip }, () => {
  const api = mod()
  const out = api.applyTerminalRead(api.createTerminalWindow(), page('a\nb', { totalLines: 2, lineEnd: 2 }))
  assert.ok(out.delta && out.window)
  assert.equal(out.delta.text, 'a\nb')
  assert.deepEqual(out.window, { totalLines: 2, tail: 'a\nb' })
})

test('windowCursor: 返回已交付行数（基线 totalLines）', { skip }, () => {
  const f = fn('windowCursor')
  assert.equal(f(fn('createTerminalWindow')()), 0)
  assert.equal(f({ totalLines: 42, tail: 'x' }), 42)
})

test('plan/apply 组合：首见 → probe → 新增行，只交付一次且行边界完整', { skip }, () => {
  const api = mod()
  let win = api.createTerminalWindow()
  let delivered = ''

  // 1) 首见 3 行
  let out = api.applyTerminalRead(win, page('a\nb\nc', { totalLines: 3, lineEnd: 3 }))
  win = out.window
  delivered += out.delta.text

  // 2) 无变化 → probe，只读尾行，无增量
  assert.equal(api.planTerminalRead(win, 3).mode, 'probe')
  out = api.applyTerminalRead(win, page('c', { totalLines: 3, lineEnd: 1 }))
  win = out.window
  delivered += out.delta.text
  assert.equal(out.delta.text, '')

  // 3) 新增一行 → delta，重叠去重后只交付 "\nd"
  const plan = api.planTerminalRead(win, 4)
  assert.equal(plan.mode, 'delta')
  assert.equal(plan.count, 1)
  out = api.applyTerminalRead(win, page('c\nd', { totalLines: 4, lineEnd: 2 }))
  win = out.window
  delivered += out.delta.text

  assert.equal(delivered, 'a\nb\nc\nd', `组合后交付文本必须完整且无重复，实际 ${JSON.stringify(delivered)}`)
  assert.equal(api.windowCursor(win), 4)
})
