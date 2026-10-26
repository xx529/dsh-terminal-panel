// Client 纯函数：列宽与排序（契约 §11.2 clampColumnWidth / 常量 / orderRunningColumns / groupCompleted）
// 对应 ui-spec §2.1（列宽 280–640、默认 352）、§2.2（已完成 newest-first）、§6.2 渲染顺序。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, internalsFn, internalsValue } from '../helpers/load-client.mjs'
import { makeRun } from '../helpers/fixtures.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

/* ---------------- 常量 ---------------- */
test('列宽常量：DEFAULT=352, MIN=280, MAX=640（ui-spec §2.1 定稿）', { skip }, () => {
  assert.equal(internalsValue(client, 'DEFAULT_COLUMN_WIDTH'), 352)
  assert.equal(internalsValue(client, 'MIN_COLUMN_WIDTH'), 280)
  assert.equal(internalsValue(client, 'MAX_COLUMN_WIDTH'), 640)
})

/* ---------------- clampColumnWidth ---------------- */
const CLAMP_CASES = [
  [352, 352, '默认值原样'],
  [300, 300, '区间内原样'],
  [280, 280, '下限含等号'],
  [640, 640, '上限含等号'],
  [279, 280, '低于下限夹到 280'],
  [641, 640, '高于上限夹到 640'],
  [100, 280, '极小值夹到 280'],
  [9_999, 640, '极大值夹到 640'],
  [NaN, 352, 'NaN 回默认 352（契约 §11.2 明文）'],
  ['480', 352, '字符串回默认 352（契约 §11.2 明文）'],
]

for (const [input, expected, label] of CLAMP_CASES) {
  test(`clampColumnWidth(${String(input)}) → ${expected}（${label}）`, { skip }, () => {
    const clamp = internalsFn(client, 'clampColumnWidth')
    assert.equal(clamp(input), expected)
  })
}

test('clampColumnWidth: 结果恒为区间内有限数（任意脏输入）', { skip }, () => {
  const clamp = internalsFn(client, 'clampColumnWidth')
  for (const input of [undefined, null, {}, [], Infinity, -Infinity, 0, -100, 1e12]) {
    const out = clamp(input)
    assert.equal(typeof out, 'number', `输入 ${String(input)} 返回非数字`)
    assert.ok(Number.isFinite(out), `输入 ${String(input)} 返回非有限数 ${out}`)
    assert.ok(out >= 280 && out <= 640, `输入 ${String(input)} 返回越界值 ${out}`)
  }
})

/* ---------------- orderRunningColumns ---------------- */
function running(id, startedAt) {
  return makeRun({ runId: id, status: 'running', startedAt, finishedAt: undefined })
}
function done(id, startedAt, finishedAt) {
  return makeRun({ runId: id, status: 'completed', startedAt, finishedAt })
}

test('orderRunningColumns: 只取 running，按 startedAt 升序（最旧在左）', { skip }, () => {
  const order = internalsFn(client, 'orderRunningColumns')
  const runs = [running('b', 200), done('x', 100, 900), running('a', 100), running('c', 300)]
  assert.deepEqual(order(runs), ['a', 'b', 'c'])
})

test('orderRunningColumns: 已完成/失败/停止都不进列', { skip }, () => {
  const order = internalsFn(client, 'orderRunningColumns')
  const runs = [
    makeRun({ runId: 'f', status: 'failed', finishedAt: 1 }),
    makeRun({ runId: 'k', status: 'killed', finishedAt: 2 }),
    makeRun({ runId: 'r', status: 'running' }),
  ]
  assert.deepEqual(order(runs), ['r'])
})

test('orderRunningColumns: 空数组 → []', { skip }, () => {
  assert.deepEqual(internalsFn(client, 'orderRunningColumns')([]), [])
})

test('orderRunningColumns: 已有列顺序稳定（新增 run 不重排旧列）', { skip }, () => {
  const order = internalsFn(client, 'orderRunningColumns')
  const base = [running('a', 100), running('b', 200)]
  const first = order(base)
  const second = order([...base, running('c', 300)])
  assert.deepEqual(second.slice(0, first.length), first, '新增最右列不得打乱已有列顺序')
})

/* ---------------- groupCompleted ---------------- */
test('groupCompleted: 只取终态，按 finishedAt 降序（最新在上）', { skip }, () => {
  const group = internalsFn(client, 'groupCompleted')
  const runs = [
    done('old', 100, 500),
    done('newest', 200, 900),
    running('live', 300),
    done('mid', 150, 700),
  ]
  assert.deepEqual(group(runs), ['newest', 'mid', 'old'])
})

test('groupCompleted: failed / killed 也属于已完成分组', { skip }, () => {
  const group = internalsFn(client, 'groupCompleted')
  const runs = [
    makeRun({ runId: 'c', status: 'completed', finishedAt: 100 }),
    makeRun({ runId: 'f', status: 'failed', finishedAt: 200 }),
    makeRun({ runId: 'k', status: 'killed', finishedAt: 300 }),
  ]
  assert.deepEqual(group(runs), ['k', 'f', 'c'])
})

test('groupCompleted: 空数组 → []', { skip }, () => {
  assert.deepEqual(internalsFn(client, 'groupCompleted')([]), [])
})
