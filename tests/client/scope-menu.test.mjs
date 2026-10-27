// Client v10.1：会话范围下拉 fixed 定位 / 视口夹取 / 交互（ui-spec v10.1 A42）
// 说明：frontend 未新增可导出纯函数（__internals 仍 53 键），定位逻辑在 Toolbar effect 内。
// 因此用「源码级静态断言 + mini React 渲染」验证实际渲染出的 inline style 与交互行为。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient } from '../helpers/load-client.mjs'
import { createMiniPanel } from '../helpers/mini-panel.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false
const source = () => readFile(CLIENT_FILE, 'utf8')

const normalRect = { left: 100, top: 100, right: 200, bottom: 130, width: 100, height: 30 }

async function openHarness(overrides = {}) {
  const harness = await createMiniPanel(client, overrides)
  harness.rig.buttonRect = { ...(overrides.buttonRect ?? normalRect) }
  harness.rig.innerWidth = overrides.innerWidth ?? 800
  harness.rig.innerHeight = overrides.innerHeight ?? 600
  return harness
}

const menuOf = (harness) => harness.byClass('tp-scope-menu')[0]

/* ---------------- 静态：fixed + toolbar 保留裁剪 + 行菜单未回归 ---------------- */
test('A42 静态样式：.tp-scope-menu fixed + z-index:60；toolbar 仍 overflow:hidden/46px；行菜单 tp-menu-fixed 未回归', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes('.tp-scope-menu{position:fixed;z-index:60;'), '会话范围下拉必须 fixed 且 z-index:60')
  const toolbar = /\.tp-toolbar\{([^}]*)\}/.exec(src)?.[1] ?? ''
  assert.match(toolbar, /overflow:hidden/, 'toolbar 的 overflow:hidden 必须保留（防单行换行约束回退）')
  assert.match(toolbar, /height:46px/, 'toolbar 仍 46px 单行')
  assert.match(toolbar, /flex-wrap:nowrap/, 'toolbar 仍不换行')
  assert.ok(src.includes('.tp-menu-fixed{position:fixed}'), '行菜单 fixed 类不得回归删除')
  assert.ok(src.includes('.tp-menu{position:absolute;right:0;top:calc(100% + 4px);z-index:40;'), '行菜单仍为 absolute（未误改）')
  // 渲染菜单必须是 inline fixed + zIndex 60（而不是依赖父级 absolute）
  const harness = await openHarness()
  try {
    const { menu } = harness.openScope()
    assert.ok(menu, '打开后必须渲染 .tp-scope-menu')
    assert.equal(menu.style.position, 'fixed')
    assert.equal(menu.style.zIndex, 60)
  } finally {
    harness.dispose()
  }
})

/* ---------------- 源码级定位规则（与渲染断言互补） ---------------- */
test('A42 定位规则（源码级）：rect.bottom+4、maxHeight=min(320,innerHeight-top-8)、右侧右对齐、空间不足翻转/关闭', { skip }, async () => {
  const src = await source()
  const block = src.slice(src.indexOf('v13：fixed 下拉定位'), src.indexOf('const kindChips = ['))
  assert.ok(block.includes('let top = rect.bottom + 4'), '正常位置 = 锚点下方 4px')
  assert.ok(block.includes('Math.min(320, viewportHeight - top - 8)'), 'maxHeight 受视口限制（min 320）')
  assert.ok(block.includes('if (left + menuWidth > viewportWidth - 8) left = Math.max(8, rect.right - menuWidth)'), '右侧溢出 → 右对齐并夹取')
  assert.ok(block.includes('if (maxHeight < 120)'), '下方空间不足 → 翻转')
  assert.ok(block.includes('maxHeight < 40'), '可用高度 <40 → 关闭')
  assert.ok(block.includes('window.addEventListener(\'resize\', update)'), 'resize 重算')
  assert.ok(block.includes('window.addEventListener(\'scroll\', update, true)'), 'scroll（capture）重算')
  assert.ok(block.includes('event.key !== \'Escape\''), 'Esc 关闭')
  assert.ok(block.includes('document.addEventListener(\'pointerdown\', onPointerDown, true)'), '外部 pointerdown 关闭（capture）')
})

/* ---------------- 迷你渲染：正常定位 ---------------- */
test('A42 渲染：正常位置 = 按钮下方 4px、宽度 340、maxHeight=min(320,视口余量)、fixed', { skip }, async () => {
  const harness = await openHarness()
  try {
    const { button, menu } = harness.openScope()
    assert.equal(button.props['aria-expanded'], true, '打开后 aria-expanded=true')
    assert.ok(menu)
    assert.equal(menu.style.position, 'fixed')
    assert.equal(menu.style.top, '134px', 'top = rect.bottom(130) + 4')
    assert.equal(menu.style.left, '100px')
    assert.equal(menu.style.width, '340px', 'menuWidth = min(340, max(220, 800*0.8))')
    assert.equal(menu.style.maxHeight, '320px', 'maxHeight = min(320, 600-134-8)')
    // 非 absolute：不参与 toolbar 的 absolute 流程（fixed 不受 overflow:hidden 裁剪）
    assert.notEqual(menu.style.position, 'absolute')
  } finally {
    harness.dispose()
  }
})

/* ---------------- 右侧溢出 ---------------- */
test('A42 渲染：右侧溢出 → 右对齐（left=rect.right-menuWidth）且不越界', { skip }, async () => {
  const harness = await openHarness({ buttonRect: { left: 700, top: 100, right: 760, bottom: 130 } })
  try {
    const { menu } = harness.openScope()
    assert.equal(menu.style.width, '340px')
    assert.equal(menu.style.left, '420px', 'left = max(8, 760-340) = 420')
    assert.equal(menu.style.top, '134px')
  } finally {
    harness.dispose()
  }
})

/* ---------------- 窄视口夹取 ---------------- */
test('A42 渲染：窄视口（300px）→ 菜单宽 240、left 夹到 8，不产生负坐标', { skip }, async () => {
  const harness = await openHarness({ innerWidth: 300 })
  try {
    const { menu } = harness.openScope()
    assert.equal(menu.style.width, '240px', 'min(340,max(220,300*0.8=240))')
    assert.equal(menu.style.left, '8px', '溢出后夹到左边 8px')
    assert.ok(!String(menu.style.left).startsWith('-'), '不得产生负坐标')
  } finally {
    harness.dispose()
  }
})

/* ---------------- 底部翻转 ---------------- */
test('A42 渲染：按钮近底部 → 翻到上方并夹在视口内', { skip }, async () => {
  const harness = await openHarness({ buttonRect: { left: 100, top: 500, right: 200, bottom: 530 } })
  try {
    const { menu } = harness.openScope()
    assert.equal(menu.style.maxHeight, '320px', '翻转后 maxHeight=min(320, above)')
    assert.equal(menu.style.top, '176px', 'top = max(8, rect.top(500)-4-320)')
    assert.ok(Number.parseInt(menu.style.top, 10) >= 8, 'top 不得越出视口上沿')
  } finally {
    harness.dispose()
  }
})

/* ---------------- 视口余量限制 maxHeight ---------------- */
test('A42 渲染：视口较矮 → maxHeight = 视口余量（<320）', { skip }, async () => {
  const harness = await openHarness({ innerHeight: 400 })
  try {
    const { menu } = harness.openScope()
    assert.equal(menu.style.top, '134px')
    assert.equal(menu.style.maxHeight, '258px', '400-134-8=258 < 320')
  } finally {
    harness.dispose()
  }
})

/* ---------------- 无空间关闭 ---------------- */
test('A42 渲染：下方与上方空间都不足（maxHeight<40）→ 关闭菜单、aria-expanded=false', { skip }, async () => {
  const harness = await openHarness({ buttonRect: { left: 100, top: 20, right: 200, bottom: 590 }, innerHeight: 600 })
  try {
    harness.scopeButton().props.onClick()
    harness.settle()
    assert.equal(menuOf(harness), undefined, '空间不足必须关闭（不渲染菜单）')
    assert.equal(harness.scopeButton().props['aria-expanded'], false)
  } finally {
    harness.dispose()
  }
})

/* ---------------- Esc / 外部点击 / 内部点击 ---------------- */
test('A42 交互：Esc 关闭；外部 pointerdown 关闭；内部 pointerdown 不关闭', { skip }, async () => {
  const harness = await openHarness()
  try {
    harness.openScope()
    assert.ok(menuOf(harness), '先打开')
    harness.fireDocument('keydown', { key: 'Escape' })
    harness.settle()
    assert.equal(menuOf(harness), undefined, 'Esc 必须关闭')
    assert.equal(harness.scopeButton().props['aria-expanded'], false)

    harness.openScope()
    harness.rig.wrapContains = false
    harness.fireDocument('pointerdown', { target: {} })
    harness.settle()
    assert.equal(menuOf(harness), undefined, '外部 pointerdown 必须关闭')

    harness.openScope()
    harness.rig.wrapContains = true
    harness.fireDocument('pointerdown', { target: { __inScopeWrap: true } })
    harness.settle()
    assert.ok(menuOf(harness), '点击下拉内部不得关闭')
  } finally {
    harness.dispose()
  }
})

/* ---------------- resize / scroll 重算 ---------------- */
test('A42 交互：resize / 面板内 scroll 触发重算（maxHeight/top 更新）', { skip }, async () => {
  const harness = await openHarness()
  try {
    harness.openScope()
    assert.equal(menuOf(harness).style.maxHeight, '320px')
    harness.rig.innerHeight = 400
    harness.fireWindow('resize')
    harness.settle()
    assert.equal(menuOf(harness).style.maxHeight, '258px', 'resize 后 maxHeight 必须重算')
    // scroll（capture）也重算：改变锚点 rect
    harness.rig.buttonRect = { left: 100, top: 200, right: 200, bottom: 230 }
    harness.fireWindow('scroll')
    harness.settle()
    assert.equal(menuOf(harness).style.top, '234px', 'scroll 后 top 必须按新 rect 重算')
  } finally {
    harness.dispose()
  }
})

/* ---------------- aria-checked 立即更新 ---------------- */
test('A42 交互：勾选项 aria-checked 点击后立即更新（root/子代理）', { skip }, async () => {
  const harness = await openHarness()
  try {
    harness.openScope()
    let items = harness.findAll((node) => typeof node.className === 'string' && node.className.startsWith('tp-scope-item'))
    assert.equal(items.length, 2, '应渲染 root + 子代理两项')
    assert.deepEqual(items.map((item) => item.props['aria-checked']), [true, true], '默认全部选中')
    // 点击子代理项取消勾选
    items[1].props.onClick()
    harness.settle()
    items = harness.findAll((node) => typeof node.className === 'string' && node.className.startsWith('tp-scope-item'))
    assert.deepEqual(items.map((item) => item.props['aria-checked']), [true, false], 'aria-checked 必须立即更新')
    assert.ok(menuOf(harness), '勾选操作不得关闭菜单')
  } finally {
    harness.dispose()
  }
})
