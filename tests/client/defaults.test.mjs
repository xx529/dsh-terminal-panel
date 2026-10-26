// Client 默认值与可配置常量（ui-spec §2.2/§3.1/§4 + contract §6.4/§6.3/§8/§9）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, internalsFn, internalsValue } from '../helpers/load-client.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

function call(name, ...args) {
  return internalsFn(client, name)(...args)
}

test('createViewState: 初始视图状态默认值（§5.3）', { skip }, () => {
  const state = call('createViewState', 'sess-1')
  assert.equal(state.sessionId, 'sess-1')
  assert.equal(state.revision, 0)
  assert.deepEqual(state.runs, {})
  assert.deepEqual(state.order, { running: [], completed: [] })
  assert.deepEqual(state.columns, {})
  assert.equal(state.status, 'loading')
})

test('createViewState: 已完成分组默认折叠（v4 变更 2 / §2.2）', { skip }, () => {
  const state = call('createViewState', 'sess-1')
  assert.equal(state.group.completedCollapsed, true, '分组默认折叠')
  assert.deepEqual(state.group.expandedIds, [])
})

test('createViewState: FilterState 默认值（§5.3 / §3.1 / §12.3）', { skip }, () => {
  const filter = call('createViewState', 'sess-1').filter
  assert.equal(filter.kind, 'all', '类型 chips 默认全部')
  assert.equal(filter.sessionIds, null, '默认全部会话（§12.3 裁决）')
  assert.equal(filter.search, '')
  assert.equal(filter.autoExpandNew, true, '新任务自动展开默认开（§3.1）')
  assert.equal(filter.showCompleted, true)
})

test('createColumnState: 新列默认宽 352、贴底跟随、展开（§2.1/§3.1）', { skip }, () => {
  const column = call('createColumnState', 'bash:1', 'running')
  assert.equal(column.width, 352)
  assert.equal(column.follow.following, true)
  assert.equal(column.collapse.expanded, true)
  assert.equal(column.scrollTop, 0)
})

test('createColumnState: 终态新列进入即 arm 10s 收起（§6.3）', { skip }, () => {
  const now = 5_000
  const column = call('createColumnState', 'bash:1', 'completed', { now })
  assert.equal(typeof column.collapse.deadline, 'number')
  assert.ok(Math.abs(column.collapse.deadline - (now + 10_000)) <= 1, `deadline 应为 now+10000，实际 ${column.collapse.deadline}`)
})

test('常量：跟随 4px 容差 / 收起 10s / scrollback 600 / maxRuns 32 / 已完成保留 5min', { skip }, () => {
  assert.equal(internalsValue(client, 'FOLLOW_TOLERANCE_PX'), 4, '§6.4 距底 <= 4px 视为贴底')
  assert.equal(internalsValue(client, 'COLLAPSE_DELAY_MS'), 10_000, '§3.2 固定 10s')
  assert.equal(internalsValue(client, 'SCROLLBACK_LINES'), 600, '§9 scrollbackLines')
  assert.equal(internalsValue(client, 'MAX_RUNS'), 32, '§9 maxRuns')
  assert.equal(internalsValue(client, 'COMPLETED_RETAIN_MS'), 300_000, '§9 completedRetainMs = 5min')
})
