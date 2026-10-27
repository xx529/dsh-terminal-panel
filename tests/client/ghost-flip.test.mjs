// Client v10.2：ghost 绝对浮层 + 单次 FLIP（ui-spec A43/A44）
// 静态断言 + mini React 渲染行为：移除卡 ghost 浮层、恰好 1 次 FLIP、180ms 后移除无二次重排、
// 连续移除不回弹、同帧多卡阈值（≤8 淡出 / >8 直接移除）、reduced-motion 无 ghost/无 FLIP。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient } from '../helpers/load-client.mjs'
import { createMiniPanel } from '../helpers/mini-panel.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false
const source = () => readFile(CLIENT_FILE, 'utf8')

const SESSION_ID = 'root-1'
const FLIP_EFFECT_FILTER = (key, fn) => key.startsWith('Toolbar#')
  || /flipDeltas|readLayoutRect|CARD_EXIT_MS|forceExitRender/.test(fn.toString())

function makeRun(id, startedAt) {
  return {
    runId: `bash:${id}`,
    kind: 'bash',
    status: 'running',
    ownerSessionId: SESSION_ID,
    title: 'Bash',
    command: `echo ${id}`,
    startedAt,
    agent: { id: SESSION_ID, name: 'Root', role: 'lead', roleName: 'lead' },
    handle: {},
    stoppable: true,
    totals: { stdout: 0, stderr: 0 },
    output: {},
    lossy: false,
    truncated: false,
  }
}

function makeView(ids, revision = 1) {
  return {
    sessionId: SESSION_ID,
    status: 'ready',
    revision,
    sessions: [{ sessionId: SESSION_ID, role: 'root', displayName: 'Root', hasActivity: ids.length > 0, accent: 'none' }],
    runs: Object.fromEntries(ids.map((id, index) => [`bash:${id}`, makeRun(id, index + 1)])),
    order: { running: ids.map((id) => `bash:${id}`), completed: [] },
    columns: Object.fromEntries(ids.map((id) => [`bash:${id}`, {}])),
    group: { completedCollapsed: true, expandedIds: [] },
    filter: { kind: 'all', sessionIds: null, search: '', autoExpandNew: true, showCompleted: true },
    availability: { bash: { available: true }, jobs: { available: true }, terminals: { available: true }, tree: { available: true } },
    droppedLines: {},
    pendingFrameRevision: 0,
    hostOffset: 0,
  }
}

/** 一行卡片布局：第 index 张 left=index*364（352 宽 + 12 gap）。 */
function layoutFor(ids) {
  const map = new Map()
  ids.forEach((id, index) => map.set(`bash:${id}`, { left: index * 364, top: 0, width: 352, height: 342 }))
  return map
}

async function makeHarness(ids, options = {}) {
  const harness = await createMiniPanel(client, {
    sessionId: SESSION_ID,
    view: makeView(ids),
    effectFilter: FLIP_EFFECT_FILTER,
  })
  harness.rig.layout = layoutFor(ids)
  harness.settle() // 让 cardsRef 拿到 offset 布局 rect
  harness.rig.metrics.flipWrites = 0
  harness.rig.metrics.transformWrites.length = 0
  return harness
}

const ghostsOf = (harness) => harness.findAll((node) => typeof node.className === 'string' && node.className.includes('tp-ghost'))
const activeCards = (harness) => harness.findAll((node) => {
  if (typeof node.className !== 'string' || !node.className.startsWith('tp-cell')) return false
  return !node.className.includes('tp-ghost')
})
const translateWrites = (harness) => harness.rig.metrics.transformWrites.filter((value) => /^translate\(/.test(value))

/* ---------------- 静态 ---------------- */
test('A43 静态：.tp-strip-track position:relative；.tp-ghost absolute/pointer-events:none/z-index:5；FLIP 用 offset 布局坐标且签名不含 exitingKey', { skip }, async () => {
  const src = await source()
  assert.ok(src.includes('.tp-strip-track{position:relative}'), '轨道必须为定位上下文')
  assert.ok(src.includes('.tp-ghost{position:absolute;margin:0;flex:none;pointer-events:none;z-index:5;'), 'ghost 必须 absolute + pointer-events:none + z-index:5')
  // readLayoutRect 使用 offset 系列
  const rectFn = src.slice(src.indexOf('function readLayoutRect(el)'), src.indexOf('function readTranslate(el)'))
  for (const key of ['offsetLeft', 'offsetTop', 'offsetWidth', 'offsetHeight']) assert.ok(rectFn.includes(key), `readLayoutRect 必须用 ${key}`)
  // FLIP 测量路径：用 readLayoutRect，不再用 getBoundingClientRect 计算 rect（只保留强制 reflow 调用）
  const flipBlock = src.slice(src.indexOf('// v10 #C：FLIP 位移（v13 改造'), src.indexOf('prevRectsRef.current = next'))
  assert.ok(flipBlock.includes('readLayoutRect(el)'), 'FLIP 测量必须用 readLayoutRect')
  assert.ok(!/const rect = .*getBoundingClientRect\(\)/.test(flipBlock), 'FLIP 测量不得再用 getBoundingClientRect')
  // 签名 = activeKey@gridWidth@cardWidth，不含 exitingKey（排除注释里的旧写法）
  // 取匹配所在的整行，排除注释行（注释里保留了 v10 旧签名说明）
  const realAssignments = [...src.matchAll(/layoutSignatureRef\.current = [^\n]+/g)]
    .map((match) => {
      const lineStart = src.lastIndexOf('\n', match.index) + 1
      const lineEnd = src.indexOf('\n', match.index)
      return src.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
    })
    .filter((line) => !line.trimStart().startsWith('//'))
  assert.ok(realAssignments.some((line) => line.includes("activeKey + '@' + gridWidth + '@' + cardWidth")), '签名必须为 activeKey@gridWidth@cardWidth')
  assert.ok(!realAssignments.some((line) => line.includes('exitingKey')), '签名不得含 exitingKey')
  // 阈值 8 / reduced-motion 短路
  assert.ok(src.includes('if (newlyRemoved.length > 8)'), '同帧 >8 直接移除（≤8 淡出）')
  assert.ok(src.includes('if (prefersReducedMotion()) return undefined'), 'reduced-motion 无 ghost 定时器')
})

/* ---------------- 单次移除 ---------------- */
test('A43 移除中间卡：ghost 首帧 absolute + 移除前 rect + aria-hidden；FLIP 恰好 1 次', { skip }, async () => {
  const harness = await makeHarness(['a', 'b', 'c'])
  try {
    assert.equal(activeCards(harness).length, 3)
    assert.equal(harness.rig.metrics.flipWrites, 0, '初始渲染无 FLIP')
    harness.rig.layout = layoutFor(['a', 'c'])
    harness.setView(makeView(['a', 'c'], 2))
    harness.settle()
    const ghosts = ghostsOf(harness)
    assert.equal(ghosts.length, 1, '移除 b → 1 个 ghost')
    const ghost = ghosts[0]
    assert.equal(ghost.style.position, 'absolute')
    assert.equal(ghost.style.left, '364px', 'left 来自移除前 b 的布局 left')
    assert.equal(ghost.style.top, '0px')
    assert.equal(ghost.style.width, '352px')
    assert.equal(ghost.style.height, '342px')
    assert.equal(ghost.style.zIndex, 5)
    assert.equal(ghost.props['aria-hidden'], 'true', 'ghost 必须 aria-hidden')
    assert.equal(harness.rig.metrics.flipWrites, 1, '一次移除恰好 1 次 FLIP arm')
    assert.deepEqual(translateWrites(harness), ['translate(-364px,0px)'], 'c 从 728 移到 364 → 位移 -364')
    assert.equal(activeCards(harness).length, 2, 'active 卡 2 张（ghost 不占 grid 槽位）')
  } finally {
    harness.dispose()
  }
})

test('A43 180ms 后 ghost 移除：FLIP 增量=0、active 布局 rect 不变（无第二次重排）', { skip }, async () => {
  const harness = await makeHarness(['a', 'b', 'c'])
  try {
    harness.rig.layout = layoutFor(['a', 'c'])
    harness.setView(makeView(['a', 'c'], 2))
    harness.settle()
    const flipsAfterRemoval = harness.rig.metrics.flipWrites
    const rectsBefore = activeCards(harness).map((node) => ({ id: node.props['data-run-id'], left: node.offsetLeft, top: node.offsetTop }))
    assert.equal(ghostsOf(harness).length, 1)
    harness.advance(180)
    harness.settle()
    assert.equal(ghostsOf(harness).length, 0, '180ms 后 ghost 必须移除')
    assert.equal(harness.rig.metrics.flipWrites, flipsAfterRemoval, 'ghost 移除不得触发第二次 FLIP')
    assert.equal(translateWrites(harness).length, flipsAfterRemoval, '不得新增 translate 写入')
    const rectsAfter = activeCards(harness).map((node) => ({ id: node.props['data-run-id'], left: node.offsetLeft, top: node.offsetTop }))
    assert.deepEqual(rectsAfter, rectsBefore, 'active 卡布局 rect 不变')
  } finally {
    harness.dispose()
  }
})

/* ---------------- 连续移除不回弹 ---------------- */
test('A44 连续移除（<200ms）：ghost 叠加、无「回到旧位置」的正向大 delta', { skip }, async () => {
  const harness = await makeHarness(['a', 'b', 'c'])
  try {
    // 第一次移除 b
    harness.rig.layout = layoutFor(['a', 'c'])
    harness.setView(makeView(['a', 'c'], 2))
    harness.settle()
    // 第二次移除 c（首动画窗口内）
    harness.rig.layout = layoutFor(['a'])
    harness.setView(makeView(['a'], 3))
    harness.settle()
    assert.equal(ghostsOf(harness).length, 2, '连续移除 → b/c 两个 ghost 并存')
    assert.equal(activeCards(harness).length, 1)
    const translates = translateWrites(harness)
    assert.ok(translates.length >= 1)
    for (const value of translates) {
      const match = /^translate\((-?[0-9.]+)px/.exec(value)
      assert.ok(match, `transform 格式可解析：${value}`)
      assert.ok(Number.parseFloat(match[1]) <= 0, `不得回弹到右侧旧位置（正 delta）：${value}`)
    }
    // 第二次移除不应产生新的正向位移：检查 c 的 ghost 坐标仍为移除前布局（364）
    const ghostLefts = ghostsOf(harness).map((node) => node.style.left)
    assert.ok(ghostLefts.includes('364px'), `ghost 使用移除前布局坐标：${ghostLefts.join(',')}`)
  } finally {
    harness.dispose()
  }
})

/* ---------------- 同帧 4 / 9 张 ---------------- */
test('A44 同帧移除 4 张：4 个 ghost 同帧淡出、active 布局一次变化', { skip }, async () => {
  const harness = await makeHarness(['a', 'b', 'c', 'd', 'e'])
  try {
    harness.rig.layout = layoutFor(['a'])
    harness.setView(makeView(['a'], 2))
    harness.settle()
    const ghosts = ghostsOf(harness)
    assert.equal(ghosts.length, 4, '4 张移除 → 4 个 ghost（≤8）')
    assert.deepEqual(ghosts.map((node) => node.style.left).sort(), ['1092px', '1456px', '364px', '728px'], '各 ghost 保留移除前 left')
    assert.equal(harness.rig.metrics.flipWrites, 0, 'a 位置未变 → 无 FLIP 写入（布局仅一次变化）')
    assert.equal(activeCards(harness).length, 1)
  } finally {
    harness.dispose()
  }
})

test('A44 同帧移除 9 张：ghost ≤8（直接移除，不淡出）且布局一次变化', { skip }, async () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
  const harness = await makeHarness(ids)
  try {
    harness.rig.layout = layoutFor(['a'])
    harness.setView(makeView(['a'], 2))
    harness.settle()
    assert.equal(ghostsOf(harness).length, 0, '同帧 >8 移除 → 直接移除（0 ghost，≤8 上限）')
    assert.equal(activeCards(harness).length, 1)
    assert.equal(harness.rig.metrics.flipWrites, 0, 'a 未移动 → 无 FLIP 写入')
  } finally {
    harness.dispose()
  }
})

/* ---------------- reduced-motion ---------------- */
test('A44 reduced-motion：ghost=0、FLIP=0', { skip }, async () => {
  const harness = await makeHarness(['a', 'b', 'c'])
  try {
    harness.rig.reducedMotion = true
    harness.rig.layout = layoutFor(['a', 'c'])
    harness.setView(makeView(['a', 'c'], 2))
    harness.settle()
    assert.equal(ghostsOf(harness).length, 0, 'reduced-motion 不得渲染 ghost')
    assert.equal(harness.rig.metrics.flipWrites, 0, 'reduced-motion 不得 FLIP')
    assert.equal(activeCards(harness).length, 2)
  } finally {
    harness.dispose()
  }
})
