// Host 纯逻辑：增量游标与读取计划（契约 §11.1 cursors.mjs；§4.2/§4.3 语义）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'
import { createFakeShellExecution } from '../helpers/fakes.mjs'
import { makeRun } from '../helpers/fixtures.mjs'

const m = await loadHostModule('cursors')
const skip = m.missing ? m.reason : false
const mergeChannel = () => fnOf(m, 'mergeChannel')
const planReads = () => fnOf(m, 'planReads')

test('exports: mergeChannel / planReads（契约 §11.1）', { skip }, () => {
  assert.equal(typeof mergeChannel(), 'function')
  assert.equal(typeof planReads(), 'function')
})

function textOf(delta) {
  return (delta.chunks ?? []).map((c) => c.text).join('')
}

/* ---------------- mergeChannel：基本形状 ---------------- */
test('mergeChannel: 首次读取返回增量块与 nextCursor（= nextOffset）', { skip }, () => {
  const delta = mergeChannel()(0, { text: 'hello', nextOffset: 5, lossy: false })
  assert.equal(textOf(delta), 'hello')
  assert.equal(delta.nextCursor, 5, '游标必须等于已交付字节数 nextOffset')
  assert.equal(delta.lossy, false)
  assert.equal(delta.gapBefore, false)
  assert.ok(Array.isArray(delta.chunks) && delta.chunks.length === 1)
  assert.equal(typeof delta.chunks[0].at, 'number', 'chunk 必须带 Host epoch ms 时间戳（§5.1）')
})

test('mergeChannel: 空读取 → 无 chunk 且游标不倒退', { skip }, () => {
  const delta = mergeChannel()(5, { text: '', nextOffset: 5, lossy: false })
  assert.equal(delta.chunks.length, 0)
  assert.equal(delta.nextCursor, 5)
})

/* ---------------- mergeChannel：不重复 / 不丢帧 ---------------- */
test('mergeChannel: 同一字节不被交付两次，增量拼接完整（假 ShellExecution 驱动）', { skip }, () => {
  const merge = mergeChannel()
  const exec = createFakeShellExecution({ stdout: '' })
  const received = []
  let cursor = 0

  exec.append('stdout', 'Hello')
  let read = exec.observed.stdout.readFrom(cursor)
  let delta = merge(cursor, read)
  received.push(textOf(delta))
  cursor = delta.nextCursor

  exec.append('stdout', ' world')
  read = exec.observed.stdout.readFrom(cursor)
  delta = merge(cursor, read)
  received.push(textOf(delta))
  cursor = delta.nextCursor

  exec.append('stdout', '!')
  read = exec.observed.stdout.readFrom(cursor)
  delta = merge(cursor, read)
  received.push(textOf(delta))
  cursor = delta.nextCursor

  assert.equal(received.join(''), 'Hello world!', '增量拼接必须与源字节完全一致，不重复不丢帧')
  assert.equal(cursor, exec.emittedBytes.stdout, '最终游标应等于源总字节数')
  // 再读一次必须是空增量（游标已到尾部）
  delta = merge(cursor, exec.observed.stdout.readFrom(cursor))
  assert.equal(textOf(delta), '')
  assert.equal(delta.nextCursor, cursor)
})

test('mergeChannel: 多字节 UTF-8 不重复不截断', { skip }, () => {
  const merge = mergeChannel()
  const exec = createFakeShellExecution({ stdout: '' })
  let cursor = 0
  const parts = []
  for (const chunk of ['中文', ' output', ' ✓']) {
    exec.append('stdout', chunk)
    const delta = merge(cursor, exec.observed.stdout.readFrom(cursor))
    parts.push(textOf(delta))
    cursor = delta.nextCursor
  }
  assert.equal(parts.join(''), '中文 output ✓')
  assert.equal(cursor, exec.emittedBytes.stdout)
})

test('mergeChannel: 游标落在保留窗口之外 → lossy=true 且 gapBefore=true，不抛错', { skip }, () => {
  const merge = mergeChannel()
  // 模拟环形缓冲淘汰：保留窗口从第 60 字节开始
  const execRef = createFakeShellExecution({ stdout: '' })
  execRef.append('stdout', 'A'.repeat(100))
  execRef.evict('stdout', 40) // 只保留尾部 40 字节
  const read = execRef.observed.stdout.readFrom(0) // 请求已淘汰区域
  assert.equal(read.lossy, true, '假句柄自检：请求淘汰区应为 lossy')
  let delta
  assert.doesNotThrow(() => {
    delta = merge(0, read)
  })
  assert.equal(delta.lossy, true)
  assert.equal(delta.gapBefore, true, 'lossy 时本帧第一块之前必须有缺口标记')
  assert.equal(delta.nextCursor, read.nextOffset)
  // 缺口之后继续读不应再报 lossy
  const next = merge(delta.nextCursor, execRef.observed.stdout.readFrom(delta.nextCursor))
  assert.equal(next.lossy, false)
})

test('mergeChannel: lossy 与 truncated 语义不混用（本函数只处理 lossy）', { skip }, () => {
  const delta = mergeChannel()(0, { text: 'abc', nextOffset: 3, lossy: false, truncated: true })
  assert.equal(delta.lossy, false)
  assert.ok(!('truncated' in delta) || delta.truncated === false || delta.truncated === undefined,
    'mergeChannel 不应伪造 truncated：truncated 由帧预算决定（§4.3）')
})

/* ---------------- planReads：调度顺序与预算 ---------------- */
const RUNS = [
  makeRun({ runId: 'done-old', status: 'completed', startedAt: 100, finishedAt: 500 }),
  makeRun({ runId: 'run-new', status: 'running', startedAt: 900 }),
  makeRun({ runId: 'run-old', status: 'running', startedAt: 300 }),
  makeRun({ runId: 'done-new', status: 'completed', startedAt: 200, finishedAt: 700 }),
]

test('planReads: running 优先、startedAt 升序（最旧在左）', { skip }, () => {
  const plan = planReads()(RUNS, {}, { maxBytes: 65536, maxRuns: 32 })
  assert.ok(Array.isArray(plan.order), 'order 必须是字符串数组')
  const runningIds = plan.order.filter((id) => id.startsWith('run-'))
  const runningOrder = ['run-old', 'run-new'].filter((id) => plan.order.includes(id))
  assert.deepEqual(runningIds, runningOrder, `running 应按 startedAt 升序，实际 ${plan.order.join(',')}`)
  // running 排在 completed 之前
  const firstCompleted = plan.order.findIndex((id) => id.startsWith('done-'))
  const lastRunning = Math.max(...runningOrder.map((id) => plan.order.indexOf(id)))
  if (firstCompleted !== -1) {
    assert.ok(lastRunning < firstCompleted, `running 必须先于 completed，实际 ${plan.order.join(',')}`)
  }
})

test('planReads: focusRunId 优先（不被其它列饿死，§4.2）', { skip }, () => {
  const plan = planReads()(RUNS, {}, { maxBytes: 65536, maxRuns: 32, focusRunId: 'done-old' })
  assert.equal(plan.order[0], 'done-old', `focusRunId 必须排第一，实际 ${plan.order.join(',')}`)
})

test('planReads: maxRuns 截断读取计划', { skip }, () => {
  const plan = planReads()(RUNS, {}, { maxBytes: 65536, maxRuns: 2 })
  assert.ok(plan.order.length <= 2, `maxRuns=2 时最多 2 个 Run，实际 ${plan.order.length}`)
})

test('planReads: 每 Run 预算 ≤ 16 KiB 且总和 ≤ maxBytes（§4.3）', { skip }, () => {
  const plan = planReads()(RUNS, {}, { maxBytes: 10_000, maxRuns: 32 })
  const budgets = Object.entries(plan.perRunBudget ?? {})
  assert.ok(budgets.length > 0, 'perRunBudget 不应为空')
  let sum = 0
  for (const [runId, value] of budgets) {
    assert.ok(typeof value === 'number' && value >= 0, `${runId} 预算非法: ${value}`)
    // 预算耗尽后，未调度的 run 可以以 0 预算出现（用于标记本轮不读）；正预算必须已在 order 中。
    if (value > 0) assert.ok(plan.order.includes(runId), `正预算的 Run 必须被调度: ${runId}`)
    assert.ok(value <= 16_384, `${runId} 单轮预算不得超过 16 KiB，实际 ${value}`)
    sum += value
  }
  assert.ok(sum <= 10_000, `预算总和不得超过 maxBytes，实际 ${sum}`)
})

test('planReads: 空 Run 列表 → 空计划', { skip }, () => {
  const plan = planReads()([], {}, { maxBytes: 65536, maxRuns: 32 })
  assert.deepEqual(plan.order, [])
})

test('planReads: focusRunId 不在列表中不抛错', { skip }, () => {
  const plan = planReads()(RUNS, {}, { maxBytes: 65536, maxRuns: 32, focusRunId: 'missing-run' })
  assert.ok(Array.isArray(plan.order))
})
