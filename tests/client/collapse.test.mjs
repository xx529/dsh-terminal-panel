// Client 纯函数：自动收起状态机（契约 §11.2 / §6.3；ui-spec §3.2–§3.4、§3.10）
// 固定 10s；hover/focus 暂停；失焦后**重新等完整 10s**；pin 永不收起；新输出重新展开并重新计时。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

const DELAY = 10_000
const create = () => internalsFn(client, 'createCollapseState')()

test('createCollapseState: 默认展开、未固定、未暂停、无 deadline', { skip }, () => {
  const state = create()
  assert.equal(state.expanded, true)
  assert.equal(state.pinned, false)
  assert.equal(state.paused, false)
  assert.equal(state.deadline, null)
})

test('armCollapse: deadline = now + 10000（固定 10s）', { skip }, () => {
  const state = internalsFn(client, 'armCollapse')(create(), 1_000)
  assert.equal(state.deadline, 1_000 + DELAY)
  assert.equal(state.expanded, true)
})

test('tickCollapse: 未到 deadline 保持展开', { skip }, () => {
  const armed = internalsFn(client, 'armCollapse')(create(), 1_000)
  const tick = internalsFn(client, 'tickCollapse')
  const at9999 = tick(armed, 1_000 + DELAY - 1)
  assert.equal(at9999.expanded, true)
  assert.equal(at9999.deadline, 1_000 + DELAY)
})

test('tickCollapse: 到 deadline 收起并清空 deadline', { skip }, () => {
  const armed = internalsFn(client, 'armCollapse')(create(), 1_000)
  const out = internalsFn(client, 'tickCollapse')(armed, 1_000 + DELAY)
  assert.equal(out.expanded, false)
  assert.equal(out.deadline, null)
})

test('tickCollapse: 无 deadline / 未 arm 时永不收起', { skip }, () => {
  const tick = internalsFn(client, 'tickCollapse')
  const out = tick(create(), Date.now() + 999_999)
  assert.equal(out.expanded, true)
})

test('pauseCollapse: 悬停/聚焦暂停，超时也不收起（§3.3）', { skip }, () => {
  const armed = internalsFn(client, 'armCollapse')(create(), 0)
  const paused = internalsFn(client, 'pauseCollapse')(armed)
  assert.equal(paused.paused, true)
  const ticked = internalsFn(client, 'tickCollapse')(paused, DELAY * 10)
  assert.equal(ticked.expanded, true, '暂停期间不得收起')
})

test('resumeCollapse: 失焦后重新等完整 10s（不是恢复剩余时间，§3.3 明文）', { skip }, () => {
  const armed = internalsFn(client, 'armCollapse')(create(), 0)
  const paused = internalsFn(client, 'pauseCollapse')(armed)
  const resumed = internalsFn(client, 'resumeCollapse')(paused, 5_000)
  assert.equal(resumed.paused, false)
  assert.equal(resumed.deadline, 5_000 + DELAY, '失焦后必须重置为完整 10s')
  // 原 deadline 是 10000，若"恢复剩余时间"则 deadline 仍是 10000
  assert.notEqual(resumed.deadline, 0 + DELAY)
})

test('resumeCollapse: 重置后到点仍会收起', { skip }, () => {
  const resumed = internalsFn(client, 'resumeCollapse')(
    internalsFn(client, 'pauseCollapse')(internalsFn(client, 'armCollapse')(create(), 0)),
    5_000,
  )
  const out = internalsFn(client, 'tickCollapse')(resumed, 15_000)
  assert.equal(out.expanded, false)
})

test('pinCollapse: 固定后 tick 永不收起（Shift+Enter / ⋯→固定展开）', { skip }, () => {
  const pinned = internalsFn(client, 'pinCollapse')(create())
  assert.equal(pinned.pinned, true)
  const armed = internalsFn(client, 'armCollapse')(pinned, 0)
  const out = internalsFn(client, 'tickCollapse')(armed, DELAY * 100)
  assert.equal(out.expanded, true, 'pinned 项不得自动收起')
})

test('armCollapse: 已 pinned 时不 arm（不写 deadline）', { skip }, () => {
  const pinned = internalsFn(client, 'pinCollapse')(create())
  const armed = internalsFn(client, 'armCollapse')(pinned, 1_000)
  assert.ok(armed.deadline == null, `pinned 状态不应写入 deadline，实际 ${armed.deadline}`)
})

test('armCollapse: 重复 arm 以最后一次为准（重新计时）', { skip }, () => {
  const arm = internalsFn(client, 'armCollapse')
  const once = arm(create(), 1_000)
  const twice = arm(once, 2_000)
  assert.equal(twice.deadline, 2_000 + DELAY)
})

test('收起态 + 新输出 → 重新展开并重新计时（§3.4，由 mergePoll 驱动）', { skip }, async () => {
  const { makeViewState, makeFrame, makeRun, makeChunk, makeChannelDelta } = await import('../helpers/fixtures.mjs')
  const mergePoll = internalsFn(client, 'mergePoll')
  const run = makeRun({ runId: 'bash:x', status: 'completed', finishedAt: 1_000 })
  // 先应用一帧让 run 进入 state
  let state = mergePoll(makeViewState(), makeFrame({ revision: 1, runs: [{ ...run }] }))
  // 人为把它置为"已收起"
  assert.ok(state.columns?.['bash:x'], '新 run 应创建列状态（§5.3）')
  state = {
    ...state,
    columns: {
      ...state.columns,
      'bash:x': {
        ...state.columns['bash:x'],
        collapse: { expanded: false, pinned: false, paused: false, deadline: null },
      },
    },
  }
  // 再来一帧带新增输出（后台任务恢复）
  const frame = makeFrame({
    revision: 2,
    runs: [
      {
        ...run,
        output: { stdout: makeChannelDelta({ chunks: [makeChunk('late output')], nextCursor: 11 }) },
      },
    ],
  })
  const out = mergePoll(state, frame)
  const collapse = out.columns['bash:x'].collapse
  assert.equal(collapse.expanded, true, '收起后又有输出必须自动重新展开（§3.4）')
  assert.ok(
    typeof collapse.deadline === 'number' && collapse.deadline > Date.now() - 1_000,
    `重新展开后必须重新 arm 倒计时，实际 deadline=${collapse.deadline}`,
  )
})
