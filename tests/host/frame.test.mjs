// Host 纯逻辑：帧组装与截断（契约 §11.1 frame.mjs；§4.2/§4.3 帧预算/nextCursors 语义）
// 实现签名（backend 2026-10-26 定稿）：
//   buildPollFrame(input, cursors, budget) -> { value, nextCursors, dropped }
//     input = { revision, serverTime, sessionId, sessions, availability, removed,
//               entries: [{ run, output: { stdout?, stderr?, job?, terminal? } }] }
//   boundFrame(value, maxBytes) -> { value, droppedRunIds }   // 从尾部整 run 丢弃，不切 chunk
//   textBytes(s) -> number                                    // UTF-8 字节数（不经 Buffer）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'
import { makeChannelDelta, makeChunk, makeFrame, makeRun, makeScope } from '../helpers/fixtures.mjs'

const m = await loadHostModule('frame')
const skip = m.missing ? m.reason : false
const boundFrame = () => fnOf(m, 'boundFrame')
const boundFrameDetailed = () => fnOf(m, 'boundFrameDetailed')
const buildPollFrame = () => fnOf(m, 'buildPollFrame')
const textBytes = () => fnOf(m, 'textBytes')

const AVAIL_ALL_OK = {
  bash: { available: true },
  jobs: { available: true },
  terminals: { available: true },
  tree: { available: true },
}

test('exports: buildPollFrame / boundFrame / boundFrameDetailed / textBytes（契约 v2 §11.1）', { skip }, () => {
  for (const name of ['buildPollFrame', 'boundFrame', 'boundFrameDetailed', 'textBytes']) {
    assert.equal(typeof fnOf(m, name), 'function', `缺少 ${name}`)
  }
})

function outputTextBytes(frame) {
  let bytes = 0
  for (const run of frame.runs ?? []) {
    for (const key of ['stdout', 'stderr', 'job']) {
      for (const chunk of run.output?.[key]?.chunks ?? []) bytes += Buffer.byteLength(chunk.text ?? '', 'utf8')
    }
    if (run.output?.terminal?.text) bytes += Buffer.byteLength(run.output.terminal.text, 'utf8')
  }
  return bytes
}

function makeEntry(runId, { kind = 'bash', bytes = 100, cursor, channel = 'stdout' } = {}) {
  const run = makeRun({ runId, kind, startedAt: 100, title: kind === 'job' ? '后台任务' : 'Bash' })
  const delta = makeChannelDelta({ chunks: [makeChunk('x'.repeat(bytes), undefined, channel)], nextCursor: cursor ?? bytes })
  const output = { [channel]: delta }
  return { run, output }
}

/* ---------------- textBytes ---------------- */
test('textBytes: ASCII / 中文 / 空串的 UTF-8 字节数', { skip }, () => {
  const f = textBytes()
  assert.equal(f('abc'), 3)
  assert.equal(f('中文'), 6)
  assert.equal(f(''), 0)
  assert.equal(f('é'), 2)
})

/* ---------------- boundFrame ---------------- */
test('boundFrame: 未超预算 → 原样返回、droppedRunIds 为空（v2 形状：直接返回 PollResult）', { skip }, () => {
  const frame = makeFrame({ runs: [], revision: 1 })
  frame.runs = [
    makeRun({ runId: 'r1', output: { stdout: makeChannelDelta({ chunks: [makeChunk('a'.repeat(100))], nextCursor: 100 }) } }),
    makeRun({ runId: 'r2', output: { stdout: makeChannelDelta({ chunks: [makeChunk('b'.repeat(100))], nextCursor: 100 }) } }),
  ]
  const out = boundFrame()(frame, 65536)
  assert.equal(out.protocol, 1, 'boundFrame 必须直接返回 PollResult（契约 v2）')
  assert.equal(out.runs.length, 2)
  assert.equal(outputTextBytes(out), 200)
  assert.equal(out.truncated, false)
  const detailed = boundFrameDetailed()(frame, 65536)
  assert.deepEqual(detailed.droppedRunIds, [])
  assert.equal(detailed.value.runs.length, 2)
  // 空输入安全
  const empty = boundFrame()(makeFrame({ runs: [] }), 100)
  assert.equal(empty.runs.length, 0)
  assert.equal(empty.truncated, false)
})

test('boundFrame: 超预算 → 从尾部整 run 丢弃、不切 chunk、标记 truncated', { skip }, () => {
  const makeRuns = () => ['r1', 'r2', 'r3'].map((id) =>
    makeRun({
      runId: id,
      output: { stdout: makeChannelDelta({ chunks: [makeChunk(id + 'x'.repeat(499))], nextCursor: 500 }) },
    }),
  )
  const frame = makeFrame({ runs: makeRuns() })
  // 预算取「保留 1 个 run 的整帧体积 + 1」：保证恰好只留 1 个（对两种预算口径都成立）
  const oneRunSize = textBytes()(JSON.stringify({ ...frame, runs: makeRuns().slice(0, 1) }))
  const detailed = boundFrameDetailed()(frame, oneRunSize + 1)
  const out = detailed.value
  assert.equal(out.runs.length, 1, `应只保留 1 个 run，实际 ${out.runs.length}`)
  assert.deepEqual(detailed.droppedRunIds, ['r3', 'r2'], '必须从尾部开始整 run 丢弃')
  assert.equal(out.truncated, true, '发生丢 run 时帧必须标 truncated（§4.3）')
  // 保留的 run 不得被切 chunk（与原始 chunk 逐字节一致）
  const original = new Map(frame.runs.map((run) => [run.runId, run.output.stdout.chunks[0].text]))
  for (const run of out.runs) {
    assert.equal(run.output.stdout.chunks.length, run.output.stdout.chunks.length)
    assert.equal(run.output.stdout.chunks[0].text, original.get(run.runId), 'boundFrame 不得切割 chunk')
  }
  // 被丢弃的 run 必须从 nextCursors 移除，避免客户端把游标推进到未交付内容（§4.2）
  for (const id of detailed.droppedRunIds) assert.ok(!(id in out.nextCursors), `dropped run 不应留在 nextCursors: ${id}`)
})

test('boundFrame: 预算边界（=帧体积不丢 / 少 1 字节丢尾部 run）', { skip }, () => {
  const frame = makeFrame({
    runs: [
      makeRun({ runId: 'a', output: { stdout: makeChannelDelta({ chunks: [makeChunk('a'.repeat(100))], nextCursor: 100 }) } }),
      makeRun({ runId: 'b', output: { stdout: makeChannelDelta({ chunks: [makeChunk('b'.repeat(100))], nextCursor: 100 }) } }),
    ],
  })
  const full = textBytes()(JSON.stringify(frame))
  const exact = boundFrameDetailed()(frame, full)
  assert.deepEqual(exact.droppedRunIds, [], '预算恰好等于帧体积时不得丢弃')
  assert.equal(exact.value.truncated, false)
  const short = boundFrameDetailed()(frame, full - 1)
  assert.ok(short.droppedRunIds.length >= 1, '少 1 字节必须触发尾部丢弃（缺陷 3 已修）')
  assert.equal(short.value.truncated, true)
  assert.ok(textBytes()(JSON.stringify(short.value)) <= full - 1, '返回帧体积必须落在预算内')
})

test('boundFrame: 极小预算下安全清空 runs（不抛错、不切 chunk）', { skip }, () => {
  const frame = makeFrame({
    runs: [makeRun({ runId: 'meta', command: 'x'.repeat(2000), output: {} })],
  })
  let out
  assert.doesNotThrow(() => {
    out = boundFrame()(frame, 100)
  })
  assert.ok(Array.isArray(out.runs))
  assert.ok(out.runs.length <= 1)
  assert.equal(out.truncated, true)
  for (const run of out.runs) {
    assert.equal(typeof run.runId, 'string')
  }
})

/* ---------------- buildPollFrame ---------------- */
function makeInput(entries, overrides = {}) {
  return {
    revision: 5,
    serverTime: 1_700_000_000_000,
    sessionId: 'root-1',
    sessions: [makeScope({ sessionId: 'root-1' })],
    availability: AVAIL_ALL_OK,
    removed: [],
    entries,
    ...overrides,
  }
}

test('buildPollFrame: 空 entries → 合法 PollResult + 空 nextCursors', { skip }, () => {
  const out = buildPollFrame()(makeInput([]), {}, { maxBytes: 65536 })
  assert.ok(out && typeof out === 'object')
  assert.equal(out.value.protocol, 1)
  assert.equal(out.value.sessionId, 'root-1')
  assert.equal(out.value.revision, 5)
  assert.equal(out.value.serverTime, 1_700_000_000_000)
  assert.deepEqual(out.value.runs, [])
  assert.deepEqual(out.value.removed, [])
  assert.deepEqual(out.nextCursors, {})
  assert.deepEqual(out.dropped, [])
})

test('buildPollFrame: Run 元信息与 output delta 原样入帧', { skip }, () => {
  const entry = makeEntry('bash:1', { bytes: 5, cursor: 5 })
  const out = buildPollFrame()(makeInput([entry]), {}, { maxBytes: 65536 })
  assert.equal(out.value.runs.length, 1)
  const run = out.value.runs[0]
  assert.equal(run.runId, 'bash:1')
  assert.equal(run.agent && typeof run.agent.name, 'string') // 元信息保留
  assert.equal(run.output.stdout.chunks[0].text, 'xxxxx')
})

test('buildPollFrame: nextCursors 只含本帧出现的 run，通道取 delta.nextCursor、缺席通道回显旧游标', { skip }, () => {
  const entry = makeEntry('bash:1', { bytes: 5, cursor: 5 })
  const entry2 = makeEntry('bash:2', { bytes: 3, cursor: 3 })
  const out = buildPollFrame()(makeInput([entry, entry2]), { 'bash:1': { stdout: 2, stderr: 4 } }, { maxBytes: 65536 })
  // 出现的 run：bash:1 stdout 前进到 5；stderr 未出现 → 回显 4
  assert.equal(out.nextCursors['bash:1'].stdout, 5, '通道游标 = delta.nextCursor')
  assert.equal(out.nextCursors['bash:1'].stderr, 4, '缺席通道必须回显上一轮游标')
  assert.equal(out.nextCursors['bash:2'].stdout, 3)
})

test('buildPollFrame: 截断时用 dropped 报告被挤掉的 run，且 nextCursors 不含未出现在最终帧的 run（§4.3）', { skip }, () => {
  const entries = [
    makeEntry('r1', { bytes: 500, cursor: 500 }),
    makeEntry('r2', { bytes: 500, cursor: 500 }),
    makeEntry('r3', { bytes: 500, cursor: 500 }),
  ]
  const out = buildPollFrame()(makeInput(entries), {}, { maxBytes: 900 })
  assert.equal(out.value.truncated, true, '预算耗尽必须置 truncated=true')
  assert.ok(Array.isArray(out.dropped) && out.dropped.length > 0, '必须报告 dropped runId 以便 UI/日志定位')
  const frameRunIds = new Set(out.value.runs.map((r) => r.runId))
  for (const id of Object.keys(out.nextCursors)) {
    assert.ok(frameRunIds.has(id), `nextCursors 不得包含未出现在最终帧的 run: ${id}`)
  }
  assert.ok(outputTextBytes(out.value) <= 900)
})

test('buildPollFrame: cursors 前移（截断续读的关键：nextCursors > 上轮游标）', { skip }, () => {
  const entry = makeEntry('bash:1', { bytes: 16, cursor: 16 })
  const out = buildPollFrame()(makeInput([entry]), { 'bash:1': { stdout: 4 } }, { maxBytes: 65536 })
  assert.ok(out.nextCursors['bash:1'].stdout > 4, 'nextCursors 必须前移到已交付末尾（不允许原地不动导致重复读）')
})

test('buildPollFrame: removed / availability 透传', { skip }, () => {
  const availability = { ...AVAIL_ALL_OK, jobs: { available: false, reason: 'jobs service unavailable', code: 'missing-service' } }
  const out = buildPollFrame()(makeInput([], { removed: ['bash:gone'], availability }), {}, {})
  assert.deepEqual(out.value.removed, ['bash:gone'])
  assert.equal(out.value.availability.jobs.available, false)
})

test('buildPollFrame: 默认预算 65536（§9）在多 run 时触发丢弃', { skip }, () => {
  const entries = [
    makeEntry('big1', { bytes: 30_000, cursor: 30_000 }),
    makeEntry('big2', { bytes: 30_000, cursor: 30_000 }),
    makeEntry('big3', { bytes: 30_000, cursor: 30_000 }),
  ]
  const out = buildPollFrame()(makeInput(entries), {}, {})
  assert.equal(out.value.truncated, true, '不传 budget 时按默认 65536 截断')
  assert.ok(out.dropped.length >= 1, `应有 run 被丢弃，实际 dropped=${JSON.stringify(out.dropped)}`)
  const delivered = outputTextBytes(out.value)
  assert.ok(delivered <= 65_536, `已交付输出 ${delivered} 字节超过默认预算`)
  for (const id of out.dropped) assert.ok(!(id in out.nextCursors), 'dropped run 不得出现在 nextCursors')
})
