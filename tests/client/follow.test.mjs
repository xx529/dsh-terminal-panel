// Client 纯函数：跟随状态机（契约 §11.2 / §6.4；ui-spec §3.5 + v4 变更 1）
// 关键边界：距底 <= 4px 视为贴底；上翻暂停；滚回底部自动恢复；新输出只累计 pending，不自动恢复。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

function scroll(state, { top, height = 1000, clientHeight = 200 }) {
  return internalsFn(client, 'onScrollFollow')(state, {
    scrollTop: top,
    scrollHeight: height,
    clientHeight,
  })
}

test('createFollowState: 默认跟随、无待读新行', { skip }, () => {
  const state = internalsFn(client, 'createFollowState')()
  assert.equal(state.following, true)
  assert.equal(state.pendingNewLines, 0)
})

test('onScrollFollow: 贴底（distance=0）保持跟随', { skip }, () => {
  const state = scroll(internalsFn(client, 'createFollowState')(), { top: 800 })
  assert.equal(state.following, true)
  assert.equal(state.pendingNewLines, 0)
})

test('onScrollFollow: 4px 边界含等号 → 仍算贴底（ui-spec 底线）', { skip }, () => {
  // scrollHeight 1000 - clientHeight 200 - scrollTop 796 = 4px
  const state = scroll(internalsFn(client, 'createFollowState')(), { top: 796 })
  assert.equal(state.following, true, 'distance=4px 必须视为贴底（契约 §6.4 明文 <=4）')
})

test('onScrollFollow: 离开底部 > 4px → 暂停跟随', { skip }, () => {
  // distance = 1000 - 200 - 795.5 = 4.5px
  const state = scroll(internalsFn(client, 'createFollowState')(), { top: 795.5 })
  assert.equal(state.following, false)
})

test('onScrollFollow: 上翻后再滚回底部 → 自动恢复跟随（不依赖点击，§3.5 硬要求）', { skip }, () => {
  let state = internalsFn(client, 'createFollowState')()
  state = scroll(state, { top: 400 })
  assert.equal(state.following, false)
  state = scroll(state, { top: 800 })
  assert.equal(state.following, true)
  assert.equal(state.pendingNewLines, 0, '回底后待读新行必须清零')
})

test('onOutputFollow: 跟随时不累计 pending', { skip }, () => {
  const state = internalsFn(client, 'onOutputFollow')(internalsFn(client, 'createFollowState')(), 5)
  assert.equal(state.following, true)
  assert.equal(state.pendingNewLines, 0)
})

test('onOutputFollow: 暂停跟随时累计「N 条新输出」', { skip }, () => {
  let state = internalsFn(client, 'createFollowState')()
  state = scroll(state, { top: 400 })
  const onOutput = internalsFn(client, 'onOutputFollow')
  state = onOutput(state, 3)
  assert.equal(state.following, false)
  assert.equal(state.pendingNewLines, 3)
  state = onOutput(state, 2)
  assert.equal(state.pendingNewLines, 5, '多次输出必须累计')
})

test('onOutputFollow: 新输出本身绝不自动恢复跟随（避免抢滚动）', { skip }, () => {
  let state = internalsFn(client, 'createFollowState')()
  state = scroll(state, { top: 0 })
  for (let i = 0; i < 20; i += 1) {
    state = internalsFn(client, 'onOutputFollow')(state, 10)
  }
  assert.equal(state.following, false)
  assert.equal(state.pendingNewLines, 200)
})

test('onScrollFollow: 未跟随时再次上翻不改变 pending', { skip }, () => {
  let state = internalsFn(client, 'createFollowState')()
  state = scroll(state, { top: 400 })
  state = internalsFn(client, 'onOutputFollow')(state, 4)
  state = scroll(state, { top: 300 })
  assert.equal(state.following, false)
  assert.equal(state.pendingNewLines, 4)
})

test('onScrollFollow: 内容不足一屏（scrollHeight<=clientHeight）视为贴底', { skip }, () => {
  const state = scroll(internalsFn(client, 'createFollowState')(), { top: 0, height: 150, clientHeight: 200 })
  assert.equal(state.following, true)
})
