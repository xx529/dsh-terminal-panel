// Client 纯函数：过滤 / 计数 / 搜索（契约 §11.2；ui-spec §2.3 工具栏 + §4 筛选）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'
import { makeChunk, makeChannelDelta, makeRun } from '../helpers/fixtures.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

const RUNS = [
  makeRun({
    runId: 'bash:1',
    kind: 'bash',
    ownerSessionId: 'root',
    agent: { id: 'root', name: 'lead', role: 'lead' },
    command: 'npm test',
    output: { stdout: makeChannelDelta({ chunks: [makeChunk('all tests passed')], nextCursor: 16 }) },
  }),
  makeRun({
    runId: 'bash:2',
    kind: 'bash',
    ownerSessionId: 'sub-1',
    agent: { id: 'sub-1', name: 'scout', role: 'subagent' },
    command: 'rg TODO',
    output: {},
  }),
  makeRun({
    runId: 'job:1',
    kind: 'job',
    title: '后台任务',
    ownerSessionId: 'root',
    command: 'pnpm dev',
    output: { job: makeChannelDelta({ chunks: [makeChunk('server listening', undefined, 'job')], nextCursor: 17 }) },
  }),
  makeRun({
    runId: 'terminal:1',
    kind: 'terminal',
    title: '终端',
    ownerSessionId: 'team-1',
    agent: { id: 'team-1', name: 'backend', role: 'teammate' },
    command: undefined,
    output: {},
  }),
]

const FILTER_BASE = {
  kind: 'all',
  sessionIds: null,
  search: '',
  autoExpandNew: true,
  showCompleted: true,
}

const ids = (runs) => runs.map((r) => r.runId)

/* ---------------- countByKind：全局计数 ---------------- */
test('countByKind: 全局计数（all/bash/job/terminal，不受筛选影响）', { skip }, () => {
  const count = internalsFn(client, 'countByKind')(RUNS)
  assert.equal(count.all, 4)
  assert.equal(count.bash, 2)
  assert.equal(count.job, 1)
  assert.equal(count.terminal, 1)
})

test('countByKind: 空列表各计数为 0', { skip }, () => {
  assert.deepEqual(internalsFn(client, 'countByKind')([]), { all: 0, bash: 0, job: 0, terminal: 0 })
})

/* ---------------- filterRuns：类型单选 ---------------- */
test('filterRuns: kind=all 返回全部', { skip }, () => {
  const got = internalsFn(client, 'filterRuns')(RUNS, FILTER_BASE)
  assert.equal(got.length, 4)
})

for (const kind of ['bash', 'job', 'terminal']) {
  test(`filterRuns: kind=${kind} 只保留该类型`, { skip }, () => {
    const got = internalsFn(client, 'filterRuns')(RUNS, { ...FILTER_BASE, kind })
    assert.ok(got.length > 0, `${kind} 应有命中`)
    for (const run of got) assert.equal(run.kind, kind)
  })
}

/* ---------------- filterRuns：会话范围多选 ---------------- */
test('filterRuns: sessionIds=null 视为全部会话', { skip }, () => {
  const got = internalsFn(client, 'filterRuns')(RUNS, { ...FILTER_BASE, sessionIds: null })
  assert.equal(got.length, 4)
})

test('filterRuns: sessionIds 多选按 ownerSessionId 过滤', { skip }, () => {
  const filter = internalsFn(client, 'filterRuns')
  assert.deepEqual(ids(filter(RUNS, { ...FILTER_BASE, sessionIds: ['root'] })), ['bash:1', 'job:1'])
  assert.deepEqual(ids(filter(RUNS, { ...FILTER_BASE, sessionIds: ['root', 'team-1'] })), ['bash:1', 'job:1', 'terminal:1'])
})

test('filterRuns: sessionIds 空数组 → 无命中（不当作全部）', { skip }, () => {
  const got = internalsFn(client, 'filterRuns')(RUNS, { ...FILTER_BASE, sessionIds: [] })
  assert.deepEqual(got, [])
})

/* ---------------- filterRuns：搜索 ---------------- */
test('filterRuns: 搜索命中命令文本', { skip }, () => {
  const got = internalsFn(client, 'filterRuns')(RUNS, { ...FILTER_BASE, search: 'npm test' })
  assert.deepEqual(ids(got), ['bash:1'])
})

test('filterRuns: 搜索命中输出文本（stdout/job 通道）', { skip }, () => {
  const filter = internalsFn(client, 'filterRuns')
  assert.deepEqual(ids(filter(RUNS, { ...FILTER_BASE, search: 'all tests passed' })), ['bash:1'])
  assert.deepEqual(ids(filter(RUNS, { ...FILTER_BASE, search: 'listening' })), ['job:1'])
})

test('filterRuns: 搜索命中会话/agent 显示名（§7 显示名）', { skip }, () => {
  const got = internalsFn(client, 'filterRuns')(RUNS, { ...FILTER_BASE, search: 'backend' })
  assert.deepEqual(ids(got), ['terminal:1'])
})

test('filterRuns: 搜索无命中 → []', { skip }, () => {
  assert.deepEqual(internalsFn(client, 'filterRuns')(RUNS, { ...FILTER_BASE, search: '绝对不存在的字符串' }), [])
})

test('filterRuns: 类型 + 会话 + 搜索是 AND 关系', { skip }, () => {
  const filter = internalsFn(client, 'filterRuns')
  assert.deepEqual(ids(filter(RUNS, { ...FILTER_BASE, kind: 'bash', sessionIds: ['root'], search: 'npm' })), ['bash:1'])
  assert.deepEqual(ids(filter(RUNS, { ...FILTER_BASE, kind: 'job', sessionIds: ['root'], search: 'npm test' })), [])
})

/* ---------------- searchMatch ---------------- */
test('searchMatch: 空查询恒真（清空即恢复）', { skip }, () => {
  const match = internalsFn(client, 'searchMatch')
  assert.equal(match(RUNS[0], ''), true)
  assert.equal(match(RUNS[0], '   '), true, '仅空白查询应视为空查询')
})

test('searchMatch: 命令命中 true / 无关查询 false', { skip }, () => {
  const match = internalsFn(client, 'searchMatch')
  assert.equal(match(RUNS[0], 'npm'), true)
  assert.equal(match(RUNS[0], 'cargo build'), false)
})

test('searchMatch: 输出文本命中', { skip }, () => {
  const match = internalsFn(client, 'searchMatch')
  assert.equal(match(RUNS[0], 'tests passed'), true)
  // 累积输出可能以 chunk 形式存在，纯函数应能穿透到文本
  assert.equal(match(RUNS[2], 'listening'), true)
})
