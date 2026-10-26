// Client v8 纯函数 + 静态回归（contract v8 §6.7/§6.8/§11.2；ui-spec v6 A14–A22）
// 覆盖：会话缓存 LRU/TTL、runPhase/lingerVisual 三态、收起/暂停/恢复、FLIP、
// 网格/加载态/动画静态断言、revision 回退判定、缓存命中不重置视图的数据层断言。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient, internalsFn, internalsValue } from '../helpers/load-client.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'
import { makeFrame, makeRun, makeViewState } from '../helpers/fixtures.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false
const fn = (name) => internalsFn(client, name)
const value = (name) => internalsValue(client, name)
const source = () => readFile(CLIENT_FILE, 'utf8')

/* ---------------- §11.2 冻结表 v8：41 → 53 键 ---------------- */
test('§11.2 v8 冻结表：__internals 53 键，新增 12 键全部存在，v7 键不丢失', { skip }, () => {
  if (client.status !== 'ok') assert.fail(client.reason)
  const internals = client.internals
  const keys = Object.keys(internals)
  assert.equal(keys.length, 53, `__internals 应为 53 键（v7 41 + v8 12），实际 ${keys.length}`)
  const v8Functions = [
    'isRevisionRollback', 'runPhase', 'lingerVisual', 'pauseLinger', 'resumeLinger',
    'collapseLinger', 'createSessionCache', 'flipDeltas',
  ]
  const v8Values = ['SESSION_CACHE', 'LINGER_DELAY_MS', 'CARD_EXIT_MS', 'FLIP_MS']
  for (const name of v8Functions) assert.equal(typeof internals[name], 'function', `缺少 v8 函数 ${name}`)
  for (const name of v8Values) assert.ok(name in internals, `缺少 v8 常量/实例 ${name}`)
  // v7 既有键（抽样关键 12 个）不得因 v8 增补而丢失/改名
  for (const name of [
    'mergePoll', 'createViewState', 'collapseVisual', 'firstCommandLine', 'applyComposerHidden',
    'clampColumnWidth', 'filterRuns', 'createCollapseState', 'armCollapse', 'tickCollapse',
    'stripAnsi', 'formatDuration',
  ]) {
    assert.ok(name in internals, `v7 键 ${name} 丢失`)
  }
})

test('v8 常量：LINGER_DELAY_MS=3000（v11.1 3s 滞留）/ CARD_EXIT_MS=180 / FLIP_MS=200；COLLAPSE_DELAY_MS 保持 10000', { skip }, () => {
  assert.equal(value('LINGER_DELAY_MS'), 3_000, 'linger 滞留时长 = 3s（v11.1 用户调整）')
  assert.equal(value('CARD_EXIT_MS'), 180)
  assert.equal(value('FLIP_MS'), 200)
  assert.equal(value('COLLAPSE_DELAY_MS'), 10_000, 'v7 废弃 collapse 状态机仍为 10s，不受 linger 调整影响')
  assert.equal(Object.keys(client.internals).length, 53, '__internals 仍 53 键')
})

/* ---------------- 会话缓存（v8 #1） ---------------- */
test('createSessionCache：形状 + set/get 往返 + savedAt + 覆盖写', { skip }, () => {
  let clock = 1_000
  const cache = fn('createSessionCache')({ max: 4, ttlMs: 1_000, now: () => clock })
  for (const name of ['get', 'set', 'delete', 'clear', 'size']) assert.equal(typeof cache[name], 'function', `缺少 ${name}`)
  const entry = { view: { runs: { a: 1 } }, cursors: { a: { job: 1 } }, revision: 3 }
  cache.set('s1', entry)
  const hit = cache.get('s1')
  assert.equal(hit.revision, 3)
  assert.deepEqual(hit.cursors, { a: { job: 1 } })
  assert.equal(hit.savedAt, 1_000)
  assert.equal(cache.size(), 1)
  // 覆盖写：新 savedAt / revision
  clock = 1_200
  cache.set('s1', { view: {}, cursors: {}, revision: 4 })
  assert.equal(cache.get('s1').revision, 4)
  assert.equal(cache.get('s1').savedAt, 1_200)
  assert.equal(cache.size(), 1)
})

test('createSessionCache：LRU 上限 4——第 5 个淘汰最久未使用；命中刷新顺序', { skip }, () => {
  let clock = 1_000
  const cache = fn('createSessionCache')({ max: 4, ttlMs: 100_000, now: () => clock })
  for (const id of ['s1', 's2', 's3', 's4']) {
    cache.set(id, { view: {}, cursors: {}, revision: 1 })
    clock += 1
  }
  assert.equal(cache.size(), 4)
  // 命中 s1 刷新为最近使用；此时最久未使用是 s2
  cache.get('s1')
  cache.set('s5', { view: {}, cursors: {}, revision: 1 })
  assert.equal(cache.size(), 4, 'LRU 上限 4')
  assert.equal(cache.get('s2'), undefined, '最久未使用的 s2 应被淘汰')
  assert.ok(cache.get('s1'), '命中过的 s1 应保留')
  assert.ok(cache.get('s5'))
})

test('createSessionCache：TTL 30min 边界（等于 TTL 仍有效，超 1ms 失效并删除）', { skip }, () => {
  const TTL = 30 * 60 * 1000
  let clock = 0
  const cache = fn('createSessionCache')({ now: () => clock })
  cache.set('s1', { view: {}, cursors: {}, revision: 1 })
  clock = TTL
  assert.ok(cache.get('s1') !== undefined, '恰好 30min 边界仍有效（> ttlMs 才失效）')
  clock = TTL + 1
  assert.equal(cache.get('s1'), undefined, '超过 TTL 必须失效')
  assert.equal(cache.size(), 0, '过期条目必须被删除')
})

test('createSessionCache：默认 max=4 / ttl=30min；自定义 max/ttl；delete/clear/size', { skip }, () => {
  let clock = 0
  const cache = fn('createSessionCache')({ now: () => clock })
  for (const id of ['a', 'b', 'c', 'd', 'e']) { cache.set(id, { view: {}, cursors: {} }); clock += 1 }
  assert.equal(cache.size(), 4, '默认 LRU 4')
  assert.equal(cache.get('a'), undefined, '默认上限下第 5 个淘汰最旧')
  clock = 30 * 60 * 1000 + 10
  assert.equal(cache.get('b'), undefined, '默认 TTL 30min')
  // 自定义
  const tiny = fn('createSessionCache')({ max: 1, ttlMs: 5, now: () => clock })
  tiny.set('x', { view: {}, cursors: {} })
  tiny.set('y', { view: {}, cursors: {} })
  assert.equal(tiny.size(), 1)
  assert.equal(tiny.get('x'), undefined)
  assert.equal(tiny.delete('y'), true)
  assert.equal(tiny.size(), 0)
  tiny.set('z', { view: {}, cursors: {} })
  tiny.clear()
  assert.equal(tiny.size(), 0)
})

test('createSessionCache：非法入参安全（空 sessionId / 非对象 entry / 无 map 泄漏）', { skip }, () => {
  const cache = fn('createSessionCache')({ max: 2, ttlMs: 1_000, now: () => 0 })
  cache.set('', { view: {} })
  cache.set(null, { view: {} })
  cache.set('s1', null)
  cache.set('s1', 'not-object')
  assert.equal(cache.size(), 0)
  assert.equal(cache.get(''), undefined)
  assert.equal(cache.get('missing'), undefined)
  assert.equal(cache.delete('missing'), false)
})

test('SESSION_CACHE 实例存在且可用于 save/restore（缓存命中不重置 view 的数据层断言）', { skip }, () => {
  const CACHE = value('SESSION_CACHE')
  for (const name of ['get', 'set', 'delete', 'clear', 'size']) assert.equal(typeof CACHE[name], 'function', `SESSION_CACHE 缺少 ${name}`)
  const view = makeViewState({ revision: 7, runs: { 'job:1': makeRun({ runId: 'job:1', status: 'running' }) } })
  view.order.running = ['job:1']
  const cursors = { 'job:1': { job: 128 } }
  CACHE.set('v8-test-session', { view, cursors, revision: 7 }, Date.now())
  const hit = CACHE.get('v8-test-session', Date.now())
  assert.ok(hit, '缓存必须命中')
  assert.equal(hit.view, view, '命中必须返回同一 view 引用（不重建 createViewState）')
  assert.equal(Object.keys(hit.view.runs).length, 1, '恢复后 runs 不得被清空')
  assert.deepEqual(hit.cursors, cursors, 'cursors 必须与缓存一致（续传不归零）')
  assert.equal(hit.revision, 7)
  CACHE.delete('v8-test-session')
})

/* ---------------- revision 回退（v8 #2 / R11） ---------------- */
test('isRevisionRollback：incoming < applied 才是回退；=== / > / 非法一律 false', { skip }, () => {
  const check = fn('isRevisionRollback')
  assert.equal(check(10, 9), true, 'incoming < applied = 服务端重建')
  assert.equal(check(10, 10), false, '相同 = 重复帧（不是回退）')
  assert.equal(check(10, 11), false, '前进 = 正常')
  assert.equal(check(1, 0), true)
  assert.equal(check(0, 0), false)
  assert.equal(check(5, null), false)
  assert.equal(check(5, undefined), false)
  assert.equal(check(5, NaN), false)
  assert.equal(check('5', '3'), false, '非 number 入参不按数字字符串归一（asNumber 只接受 number）')
})

/* ---------------- 三态 runPhase（v8 #3 / A15） ---------------- */
const terminalRun = (over = {}) => makeRun({
  runId: 'terminal:1',
  kind: 'terminal',
  status: 'completed',
  finishedAt: 10_000,
  ...over,
})

test('runPhase：running 恒为 running；非终态按 running；终态无 linger → completed', { skip }, () => {
  const phase = fn('runPhase')
  const now = 12_000
  assert.equal(phase(makeRun({ status: 'running' }), undefined, now), 'running')
  assert.equal(phase(makeRun({ status: 'running' }), { linger: { deadline: now + 5_000 } }, now), 'running', 'running 不进入 linger')
  assert.equal(phase(terminalRun(), undefined, now), 'completed')
  assert.equal(phase(terminalRun(), { linger: null }, now), 'completed')
  assert.equal(phase(null, undefined, now), 'completed')
})

test('runPhase：终态 + 3s 内 → linger；到点 → completed；paused/pinned 保持在 linger', { skip }, () => {
  const phase = fn('runPhase')
  const run = terminalRun()
  const deadline = 20_000
  const column = { linger: { deadline, paused: false, pinned: false } }
  assert.equal(phase(run, column, deadline - 1), 'linger', '3s 内必须 linger')
  assert.equal(phase(run, column, deadline), 'completed', '到点进入 completed')
  const paused = { linger: { deadline, paused: true, pinned: false } }
  assert.equal(phase(run, paused, deadline + 999_999), 'linger', 'paused 冻结：超时仍 linger')
  const pinned = { linger: { deadline: null, paused: false, pinned: true } }
  assert.equal(phase(run, pinned, deadline + 999_999), 'linger', 'pinned 保持 linger')
  assert.equal(phase(run, { linger: { deadline: null, paused: false, pinned: false } }, deadline + 1), 'completed', 'deadline=null 且未 pinned → completed')
})

test('lingerVisual：倒计时/进度/暂停/到点；progress 按 3s 归一分母；null 安全', { skip }, () => {
  const visual = fn('lingerVisual')
  const empty = visual(null, 1_000)
  assert.deepEqual(empty, { visible: false, remaining: 0, progress: 0, armed: false })
  const deadline = 4_000 // now=1000 + 3000
  const running = visual({ deadline, paused: false, pinned: false }, 1_000)
  assert.equal(running.visible, true)
  assert.equal(running.armed, true)
  assert.equal(running.remaining, 3_000)
  assert.equal(running.progress, 1, '剩余 3s / 3000ms 分母 = 1')
  const half = visual({ deadline, paused: false, pinned: false }, 2_500)
  assert.equal(half.remaining, 1_500)
  assert.equal(half.progress, 0.5, '剩余 1.5s / 3s = 0.5（分母 3000）')
  // paused/pinned 的语义：deadline 不会被重算，因此到点后仍 armed（停留 linger），
  // remaining 按 now 递减（到点后为 0），不会自动 collapse。
  const paused = visual({ deadline, paused: true, pinned: false }, 3_500)
  assert.equal(paused.armed, true)
  assert.equal(paused.remaining, 500, 'paused 不重置 deadline（剩余时间按冻结的 deadline 计算）')
  assert.equal(visual({ deadline, paused: true, pinned: false }, deadline).armed, true, 'paused 到点后仍停留 linger')
  const pinned = visual({ deadline, paused: false, pinned: true }, 9_999)
  assert.equal(pinned.visible, true)
  assert.equal(pinned.armed, true)
  const expired = visual({ deadline, paused: false, pinned: false }, deadline)
  assert.deepEqual(expired, { visible: false, remaining: 0, progress: 0, armed: false })
})

test('pauseLinger / resumeLinger：「收起」collapseLinger 立即完成且幂等', { skip }, () => {
  const pause = fn('pauseLinger')
  const resume = fn('resumeLinger')
  const collapse = fn('collapseLinger')
  const state = { deadline: 5_000, paused: false, pinned: false }
  const paused = pause(state)
  assert.equal(paused.paused, true)
  assert.equal(pause(paused), paused, '重复 pause 幂等（引用相等）')
  assert.equal(pause(null), null, 'null 安全')
  const resumed = resume(paused, 2_000)
  assert.equal(resumed.paused, false)
  assert.equal(resumed.deadline, 5_000, 'resume 重新计完整 3s（now 2000 + 3000）')
  assert.equal(resume(null), null)
  // 「收起」立即完成：返回 null = 结束 linger
  assert.equal(collapse(state), null)
  assert.equal(collapse(null), null)
  assert.equal(collapse(undefined), null)
  assert.equal(collapse(collapse(state)), null, '幂等')
})

/* ---------------- mergePoll 产生 linger（终态自动进入滞留，不自动展开分组） ---------------- */
test('mergePoll：running→终态进入 linger；历史完成不滞留；pinned 不 arm linger', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const phase = fn('runPhase')
  const now = 100_000
  const running = terminalRun({ status: 'running', finishedAt: undefined })
  // 1) running 帧 → 2) 终态帧（3s 内）→ linger
  let state = mergePoll(makeViewState(), makeFrame({ revision: 1, runs: [{ ...running }] }), { now })
  const done = terminalRun({ finishedAt: now })
  state = mergePoll(state, makeFrame({ revision: 2, runs: [{ ...done }] }), { now })
  const linger = state.columns['terminal:1'].linger
  assert.ok(linger && typeof linger === 'object', 'running→终态必须进入 linger（v8 #3）')
  assert.equal(linger.deadline, Math.min(now + 3_000, done.finishedAt + 3_000))
  assert.equal(phase(state.runs['terminal:1'], state.columns['terminal:1'], now), 'linger')
  assert.equal(phase(state.runs['terminal:1'], state.columns['terminal:1'], linger.deadline), 'completed', '到点进入 completed')

  // 历史完成（>3s）：另一 Run 的 running→终态转换发生时 finishedAt 已在过去 → 不 arm linger
  const oldDone = terminalRun({ runId: 'terminal:old', finishedAt: now - 60_000 })
  let state2 = mergePoll(makeViewState(), makeFrame({ revision: 1, runs: [{ ...oldDone, status: 'running', finishedAt: undefined }] }), { now })
  state2 = mergePoll(state2, makeFrame({ revision: 2, runs: [{ ...oldDone }] }), { now })
  assert.ok(!state2.columns['terminal:old'].linger, '历史完成不得滞留')
  assert.equal(phase(state2.runs['terminal:old'], state2.columns['terminal:old'], now), 'completed')

  // pinned：终态转换前 collapse.pinned=true → 不 arm linger（保持展开、不进 linger）
  const pinnedRun = terminalRun({ runId: 'terminal:pinned', finishedAt: now })
  let state3 = mergePoll(makeViewState(), makeFrame({ revision: 1, runs: [{ ...pinnedRun, status: 'running', finishedAt: undefined }] }), { now })
  state3 = { ...state3, columns: { ...state3.columns, 'terminal:pinned': { ...state3.columns['terminal:pinned'], collapse: { ...state3.columns['terminal:pinned'].collapse, pinned: true } } } }
  state3 = mergePoll(state3, makeFrame({ revision: 2, runs: [{ ...pinnedRun }] }), { now })
  assert.ok(!state3.columns['terminal:pinned'].linger, 'pinned 不 arm linger')
  assert.equal(state3.columns['terminal:pinned'].collapse.pinned, true, 'pinned 状态保留')
  assert.equal(phase(state3.runs['terminal:pinned'], state3.columns['terminal:pinned'], now), 'completed')
})

/* ---------------- linger 3s 边界（v11.1） ---------------- */
test('linger 3s 边界：deadline=finishedAt+3000；3999 仍 linger / 4000 completed；progress 分母 3000', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const phase = fn('runPhase')
  const visual = fn('lingerVisual')
  const pause = fn('pauseLinger')
  const resume = fn('resumeLinger')
  const now = 1_000
  const running = terminalRun({ status: 'running', finishedAt: undefined })
  let state = mergePoll(makeViewState(), makeFrame({ revision: 1, runs: [{ ...running }] }), { now })
  const done = terminalRun({ finishedAt: now })
  state = mergePoll(state, makeFrame({ revision: 2, runs: [{ ...done }] }), { now })
  const column = state.columns['terminal:1']
  assert.equal(column.linger.deadline, 4_000, 'deadline = finishedAt(1000) + 3000')
  const run = state.runs['terminal:1']
  assert.equal(phase(run, column, 3_999), 'linger', '3999ms（<3s）仍 linger')
  assert.equal(phase(run, column, 4_000), 'completed', '4000ms（到点）进入 completed')
  const visualAtStart = visual(column.linger, now)
  assert.equal(visualAtStart.remaining, 3_000)
  assert.equal(visualAtStart.progress, 1)
  const visualNearEnd = visual(column.linger, 3_999)
  assert.equal(visualNearEnd.remaining, 1)
  assert.ok(visualNearEnd.progress > 0 && visualNearEnd.progress < 0.001)
  const expired = visual(column.linger, 4_000)
  assert.deepEqual(expired, { visible: false, remaining: 0, progress: 0, armed: false }, '到点后 countdown 不可见（armed=false）')
  // pause 冻结剩余；resume 重新计 3000
  const paused = pause(column.linger, 2_000)
  assert.equal(visual(paused, 3_500).remaining, 2_000, '暂停时冻结在 2000ms 剩余（不随 now 递减）')
  const resumed = resume(paused, 5_000)
  assert.equal(resumed.deadline, 8_000, 'resume 后 deadline = now 5000 + 3000')
  assert.equal(visual(resumed, 5_000).remaining, 3_000)
  assert.equal(visual(resumed, 6_000).remaining, 2_000)
})

/* ---------------- FLIP（v8 #5 / A19） ---------------- */
test('flipDeltas：同 key 位移向量、无位移 null、新增/删除 null、空输入', { skip }, () => {
  const flip = fn('flipDeltas')
  const prev = { a: { left: 10, top: 20, width: 100, height: 50 }, b: { left: 0, top: 0 }, gone: { left: 5, top: 5 } }
  const next = { a: { left: 30, top: 10, width: 100, height: 50 }, b: { left: 0, top: 0 }, fresh: { left: 1, top: 1 } }
  const deltas = flip(prev, next)
  assert.deepEqual(deltas.a, { dx: 20, dy: -10 }, '同 key 位移向量正确')
  assert.equal(deltas.b, null, '无位移返回 null（不播动画）')
  assert.equal(deltas.fresh, null, '新增 key 返回 null（无 FLIP）')
  assert.equal(deltas.gone, null, '删除 key 返回 null')
  assert.deepEqual(flip({}, {}), {})
  assert.deepEqual(flip(null, null), {})
  assert.deepEqual(flip({ a: 'bad' }, { a: { left: 1, top: 1 } }).a, null, '非对象 rect 安全返回 null')
})

/* ---------------- 静态断言：网格/加载态/动画（A14/A19/A20） ---------------- */
test('A14 网格（静态）：flex-wrap:wrap + 纵向滚动；无横向滚动/x 轴 auto/溢出按钮/scrollLeft', { skip }, async () => {
  const src = await source()
  assert.match(src, /\.tp-strip-track\{[^}]*flex-wrap:wrap/, '.tp-strip-track 必须 flex-wrap:wrap')
  assert.match(src, /\.tp-strip\{[^}]*overflow-y:auto/, '执行区必须整体纵向滚动')
  assert.match(src, /\.tp-strip\{[^}]*overflow-x:hidden/, '执行区不得横向滚动')
  assert.ok(!src.includes('overflow-x:auto'), '不得存在 overflow-x:auto')
  for (const remnant of ['scrollLeft', 'tp-more', 'visibleIds']) {
    assert.ok(!src.includes(remnant), `横向列遗留代码必须移除：${remnant}`)
  }
  // 固定宽卡片 + 等高：flex:none + 固定 height
  assert.match(src, /\.tp-col\{[^}]*flex:none/, '卡片必须 flex:none（固定宽，不随容器伸缩）')
  assert.match(src, /\.tp-col\{[^}]*height:342px/, '卡片必须固定高度（等高）')
  assert.match(src, /\.tp-col\{[^}]*max-width:100%/, '窄容器下卡片不超宽（不横向滚动）')
})

test('A19 FLIP/fade（静态）：fade 180ms + FLIP 200ms、仅 transform/opacity、reduced-motion 瞬时', { skip }, async () => {
  const src = await source()
  assert.match(src, /\.tp-col-exit\{[^}]*animation:tp-card-out 180ms/, '离开执行区必须 180ms fade')
  assert.ok(src.includes('@keyframes tp-card-out'), '必须存在 fade 动画')
  assert.ok(src.includes('opacity:0;transform:scale(.98)'), 'fade 只能改 opacity/transform（不改布局）')
  assert.ok(src.includes("el.style.transition = 'transform ' + FLIP_MS + 'ms ease-out'"), 'FLIP 200ms 只能改 transform')
  assert.match(src, /@media \(prefers-reduced-motion: reduce\)/, 'reduced-motion 必须覆盖')
  assert.match(src, /prefersReducedMotion\(\) === false/, 'FLIP/fade 在 reduced-motion 下必须跳过')
})

test('A20 首帧 loading（静态）：skeleton 分支在空态之前；空态需 600ms 稳定窗口', { skip }, async () => {
  const src = await source()
  assert.match(src, /function PanelSkeleton/, '必须存在骨架屏组件')
  assert.match(src, /panel\.loading/, '必须使用加载态文案')
  const skeletonBranch = src.indexOf('awaitingFirstFrame\n          ? h(PanelSkeleton')
  const emptyBranch = src.indexOf(': empty\n            ? h(\'div\', { className: \'tp-state\' }', skeletonBranch)
  assert.ok(skeletonBranch > 0, '必须存在 awaitingFirstFrame ? PanelSkeleton 分支')
  assert.ok(emptyBranch > skeletonBranch, '空态分支必须在 skeleton 之后（首帧前显示 loading 而非空态）')
  assert.match(src, /const awaitingFirstFrame = !hasFrame \|\| \(hasFrame && runs\.length === 0 && emptySettled !== true\)/, '首帧前/稳定窗口内必须 loading')
  assert.match(src, /setTimeout\(\(\) => setEmptySettled\(true\), 600\)/, '空态必须经过 600ms 稳定窗口（job-only 不闪）')
})

test('A18/A21 缓存接线（静态）：SESSION_CACHE.get / cacheSaveSession / 重挂不重置 view / 需 resync 信号', { skip }, async () => {
  const src = await source()
  assert.match(src, /SESSION_CACHE\.get\(sessionId/, '挂载必须读取会话缓存')
  assert.match(src, /function cacheSaveSession/, '必须保存 view/cursors/revision 到缓存')
  assert.match(src, /let resyncPending = cached === undefined \|\| retryToken > 0/, '缓存未命中或手动重试必须触发一次 resync')
  assert.match(src, /if \(viewRef\.current\.sessionId !== sessionId\)/, '重挂/retryToken 变化不得重置同 session 的 view')
  assert.match(src, /isRevisionRollback\(/, 'revision 回退必须走重建判定')
  assert.match(src, /params\.resync = true/, 'resync 必须以 poll 参数发出')
  assert.match(src, /reset\.filter =/, 'revision 回退清 view 时必须保留筛选用户态')
})

/* ---------------- DEF-1 回归：hover/focus 暂停时倒计时冻结（Lead 裁决本轮修复） ---------------- */
test('DEF-1 回归：hover/focus 暂停期间 linger 倒计时/进度冻结，resume 后回到契约语义', { skip }, () => {
  // 契约 §6.7 / ui-spec A17：hover/focus 暂停倒计时（remaining/progress 不随 now 前进）；
  // 移出/失焦后 resume：deadline=now+3s，remaining 回到 3s 并在之后正常递减。
  const visual = fn('lingerVisual')
  const pause = fn('pauseLinger')
  const resume = fn('resumeLinger')
  const armed = { deadline: 4_000, paused: false, pinned: false }
  const paused = pause(armed)
  assert.equal(paused.paused, true)

  const early = visual(paused, 1_000)
  const later = visual(paused, 5_000)
  assert.equal(early.remaining, later.remaining, '暂停期间 remaining 不得随 now 变化（必须冻结）')
  assert.equal(early.progress, later.progress, '暂停期间 progress 不得继续走')
  assert.equal(early.armed, true, '暂停期间仍展示倒计时（只是不前进）')

  const resumed = resume(paused, 9_000)
  assert.equal(resumed.paused, false)
  assert.equal(resumed.deadline, 12_000, 'resume 重新计完整 3s（now 9000 + 3000）')
  const atResume = visual(resumed, 9_000)
  assert.equal(atResume.remaining, 3_000, 'resume 瞬间 remaining 回到 3s')
  assert.equal(atResume.armed, true)
  const oneSecondLater = visual(resumed, 10_000)
  assert.equal(oneSecondLater.remaining, 2_000, 'resume 后 remaining 正常递减（3s - 1s）')
  assert.ok(oneSecondLater.progress < atResume.progress)
})
