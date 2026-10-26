// Client 契约出口面（契约 §11.2）：__internals 必须导出全部纯函数与常量。
// 这是 frontend 与 tester 之间的硬契约：少一个即违例。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient } from '../helpers/load-client.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

// 契约 §11.2 列出的完整出口（20 个函数 + 4 个常量）
const FUNCTIONS = [
  'clampColumnWidth',
  'filterRuns',
  'countByKind',
  'searchMatch',
  'orderRunningColumns',
  'groupCompleted',
  'createFollowState',
  'onScrollFollow',
  'onOutputFollow',
  'createCollapseState',
  'armCollapse',
  'pauseCollapse',
  'resumeCollapse',
  'tickCollapse',
  'pinCollapse',
  'stripAnsi',
  'tailLines',
  'formatDuration',
  'formatCountdown',
  'mergePoll',
]
const CONSTANTS = ['DEFAULT_COLUMN_WIDTH', 'MIN_COLUMN_WIDTH', 'MAX_COLUMN_WIDTH']

test('lib/client.js 可被 factory(require) 加载且带 apply（契约 §11.2/F4）', { skip }, () => {
  if (client.status !== 'ok') assert.fail(client.reason)
  assert.equal(typeof client.mod.apply, 'function')
  assert.ok(Array.isArray(client.mod.inject) || client.mod.inject == null)
  assert.equal(client.spec.id, 'dsh-terminal-panel', 'load spec 的 id 必须是包名 dsh-terminal-panel')
})

test('load spec 只 require("react")，不碰其它 Client 包（§3.2/§12.5）', { skip }, () => {
  if (client.status !== 'ok') assert.fail(client.reason)
  for (const id of client.require.calls) {
    assert.equal(id, 'react', `client factory 非法 require('${id}')`)
  }
})

test('__internals 导出面完整（契约 §11.2）', { skip }, () => {
  if (client.status !== 'ok') assert.fail(client.reason)
  const absent = [...FUNCTIONS, ...CONSTANTS].filter((name) => !(name in client.internals))
  assert.deepEqual(absent, [], `__internals 缺少导出：${absent.join(', ')}（契约 §11.2 硬契约）`)
  for (const name of FUNCTIONS) {
    assert.equal(typeof client.internals[name], 'function', `__internals.${name} 必须是函数`)
  }
  for (const name of CONSTANTS) {
    assert.equal(typeof client.internals[name], 'number', `__internals.${name} 必须是数字常量`)
  }
})
