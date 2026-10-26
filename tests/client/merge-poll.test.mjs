// Client 核心 reducer：mergePoll（契约 §11.2；§4.2 增量语义 + §6.1 终态单调 + §6.3 自动收起）
// 重点：revision 丢弃、幂等、removed、truncated 游标、chunks append、availability 只改标记。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'
import {
  collectStrings,
  makeChannelDelta,
  makeChunk,
  makeFrame,
  makeRun,
  makeScope,
  makeViewState,
} from '../helpers/fixtures.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false
const merge = () => internalsFn(client, 'mergePoll')

const RUN = makeRun({
  runId: 'bash:1',
  startedAt: 1_000,
  status: 'running',
  agent: { id: 'root', name: 'lead', role: 'lead' },
})

test('mergePoll: revision <= 已应用 → 原样返回（引用相等，契约 §11.2）', { skip }, () => {
  const state = makeViewState({ revision: 5 })
  assert.equal(merge()(state, makeFrame({ revision: 5 })), state, '同 revision 必须引用相等')
  assert.equal(merge()(state, makeFrame({ revision: 4 })), state, '更旧 revision 必须丢弃')
})

test('mergePoll: revision 前进 → 应用并记录 revision', { skip }, () => {
  const out = merge()(makeViewState(), makeFrame({ revision: 3 }))
  assert.equal(out.revision, 3)
})

test('mergePoll: 首帧新增 run → runs/columns/order.running 同步建立', { skip }, () => {
  const out = merge()(makeViewState(), makeFrame({ revision: 1, runs: [{ ...RUN }] }))
  assert.ok(out.runs['bash:1'], 'runs 必须收录新 run')
  assert.equal(out.runs['bash:1'].status, 'running')
  assert.deepEqual(out.order.running, ['bash:1'])
  assert.ok(out.columns['bash:1'], '新 run 必须建立列状态 ColumnState（§5.3）')
  assert.equal(out.columns['bash:1'].width, 352, '默认列宽 352（ui-spec §2.1）')
})

test('mergePoll: 多列按 startedAt 升序（最旧在左，§6.2）', { skip }, () => {
  const runs = [
    makeRun({ runId: 'b', startedAt: 200 }),
    makeRun({ runId: 'a', startedAt: 100 }),
    makeRun({ runId: 'c', startedAt: 300 }),
  ]
  const out = merge()(makeViewState(), makeFrame({ revision: 1, runs }))
  assert.deepEqual(out.order.running, ['a', 'b', 'c'])
})

test('mergePoll: chunks 一律 append（跨帧累积为连续文本，不覆盖不重复）', { skip }, () => {
  let state = merge()(
    makeViewState(),
    makeFrame({
      revision: 1,
      runs: [{ ...RUN, output: { stdout: makeChannelDelta({ chunks: [makeChunk('Hel')], nextCursor: 3 }) } }],
    }),
  )
  state = merge()(
    state,
    makeFrame({
      revision: 2,
      runs: [{ ...RUN, output: { stdout: makeChannelDelta({ chunks: [makeChunk('lo')], nextCursor: 5 }) } }],
    }),
  )
  const strings = collectStrings(state)
  assert.ok(
    strings.some((s) => s.includes('Hello')),
    `本地缓冲必须累积为 "Hello"（§4.2 语义 2：client append 到本地文本缓冲），实际字符串：${strings.filter(Boolean).slice(0, 8).join(' | ')}`,
  )
  assert.ok(!strings.some((s) => s.includes('HelHel')), '同一帧不得重复 append')
  assert.equal(state.runs['bash:1'].output?.stdout?.nextCursor ?? 5, 5)
})

test('mergePoll: 相同帧重复应用 → 幂等（引用相等 / 不重复 append）', { skip }, () => {
  const frame = makeFrame({ revision: 1, runs: [{ ...RUN }] })
  const once = merge()(makeViewState(), frame)
  const twice = merge()(once, frame)
  assert.equal(twice, once, '相同帧再次应用应为 no-op（revision 规则）')
})

test('mergePoll: removed 删除 run 与 column，未命中不抛错（§11.2）', { skip }, () => {
  let state = merge()(makeViewState(), makeFrame({ revision: 1, runs: [{ ...RUN }] }))
  assert.ok(state.runs['bash:1'])
  state = merge()(state, makeFrame({ revision: 2, removed: ['bash:1'] }))
  assert.equal(state.runs['bash:1'], undefined, 'removed 中的 runId 必须从 runs 删除')
  assert.equal(state.columns['bash:1'], undefined, 'removed 中的 runId 必须从 columns 删除')
  assert.ok(!state.order.running.includes('bash:1'))
  // 未命中不抛错
  assert.doesNotThrow(() => merge()(state, makeFrame({ revision: 3, removed: ['never-existed'] })))
})

test('mergePoll: truncated 帧仍正常应用，游标只由 nextCursors 推进（§11.2）', { skip }, () => {
  const nextCursors = { 'bash:1': { stdout: 8 } }
  const frame = makeFrame({
    revision: 1,
    truncated: true,
    nextCursors,
    runs: [{ ...RUN, truncated: true, output: { stdout: makeChannelDelta({ chunks: [makeChunk('ABCDEFGH')], nextCursor: 8 }) } }],
  })
  const out = merge()(makeViewState(), frame)
  assert.equal(out.runs['bash:1'].status, 'running')
  assert.equal(out.revision, 1, 'truncated 帧不得跳过 revision')
  if (out.cursors && typeof out.cursors === 'object') {
    assert.deepEqual(out.cursors['bash:1'], { stdout: 8 }, '游标必须来自 nextCursors（§11.2）')
  }
  // 无 state.cursors 时也要保证不丢输出
  assert.ok(collectStrings(out).some((s) => s.includes('ABCDEFGH')), 'truncated 帧的输出仍必须 append')
})

test('mergePoll: availability 变化只改标记，不清已有数据（§11.2 / §8）', { skip }, () => {
  let state = merge()(makeViewState(), makeFrame({ revision: 1, runs: [{ ...RUN }] }))
  state = merge()(
    state,
    makeFrame({
      revision: 2,
      runs: [],
      availability: {
        bash: { available: false, reason: 'shell service unavailable', code: 'missing-service' },
        jobs: { available: true },
        terminals: { available: true },
        tree: { available: true },
      },
    }),
  )
  assert.equal(state.availability.bash.available, false)
  assert.ok(state.runs['bash:1'], '来源降级不得清空已采集的 Run（§8 总原则）')
})

test('mergePoll: 进入终态 → 进 completed 顺序并 arm 10s 倒计时（§6.3）', { skip }, () => {
  let state = merge()(makeViewState(), makeFrame({ revision: 1, runs: [{ ...RUN }] }))
  const now = Date.now()
  state = merge()(
    state,
    makeFrame({ revision: 2, serverTime: now, runs: [{ ...RUN, status: 'completed', finishedAt: now, durationMs: 500 }] }),
  )
  assert.deepEqual(state.order.completed, ['bash:1'])
  assert.deepEqual(state.order.running, [])
  const collapse = state.columns['bash:1'].collapse
  assert.ok(typeof collapse.deadline === 'number', '终态必须写入收起 deadline（countdown 字段）')
  assert.ok(Math.abs(collapse.deadline - (now + 10_000)) <= 2_000, `deadline 应约为 now+10000，实际 ${collapse.deadline}`)
  assert.equal(collapse.paused, false)
})

test('mergePoll: 终态单调，不会被后续帧降级回 running（§6.1）', { skip }, () => {
  const now = Date.now()
  let state = merge()(
    makeViewState(),
    makeFrame({ revision: 1, runs: [{ ...RUN, status: 'completed', finishedAt: now }] }),
  )
  state = merge()(
    state,
    makeFrame({
      revision: 2,
      runs: [{ ...RUN, status: 'running', output: { stdout: makeChannelDelta({ chunks: [makeChunk('late')], nextCursor: 4 }) } }],
    }),
  )
  assert.equal(state.runs['bash:1'].status, 'completed', '终态是单调的，不得回退为 running')
  assert.ok(collectStrings(state).some((s) => s.includes('late')), '终态后新输出仍要 append')
})

test('mergePoll: sessions 树随帧更新（root 恒在首位）', { skip }, () => {
  const sessions = [
    makeScope({ sessionId: 'root', depth: 0 }),
    makeScope({ sessionId: 'sub-1', role: 'subagent', accent: 'subagent', depth: 1, parentSessionId: 'root' }),
  ]
  const out = merge()(makeViewState(), makeFrame({ revision: 1, sessions }))
  assert.equal(out.sessions[0].sessionId, 'root')
  assert.ok(out.sessions.some((s) => s.sessionId === 'sub-1'))
})

test('mergePoll: 未变化的 run 不出现在帧里也不会被清掉（§4.2 语义 1）', { skip }, () => {
  let state = merge()(makeViewState(), makeFrame({ revision: 1, runs: [{ ...RUN }] }))
  state = merge()(state, makeFrame({ revision: 2, runs: [] }))
  assert.ok(state.runs['bash:1'], '未变化的 run 必须保留')
})
