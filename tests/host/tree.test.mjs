// Host 纯逻辑：会话树归并（契约 §11.1 tree.mjs；§5.2 归属规则）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'

const m = await loadHostModule('tree')
const skip = m.missing ? m.reason : false
const merge = () => fnOf(m, 'mergeSessionTree')

const ROOT = 'root-1'

const ROOT_MEMBER = { id: ROOT, name: 'lead', role: 'lead', status: 'running' }
const DESCENDANTS = [
  { kind: 'child', id: 'sub-1', activity: 'running', mode: 'spawn', label: 'scout', parentId: ROOT, hasChildren: false, depth: 1 },
  { kind: 'child', id: 'sub-2', activity: 'inactive', mode: 'spawn', label: 'audit', parentId: ROOT, hasChildren: false, depth: 1 },
  { kind: 'diagnostic', id: 'bad-1', reason: 'corrupt' },
]
const MEMBERS = [
  ROOT_MEMBER,
  { id: 'team-1', name: 'backend', role: 'teammate', status: 'running' },
  // 同 id 既在 descendants 又在 members：队友优先（§5.2 归属规则）
  { id: 'sub-1', name: 'scout', role: 'teammate', status: 'running' },
]

function build(input = {}) {
  return merge()({
    rootSessionId: ROOT,
    rootName: '当前会话',
    descendants: DESCENDANTS,
    members: MEMBERS,
    ...input,
  })
}

test('exports: mergeSessionTree（契约 §11.1）', { skip }, () => {
  assert.equal(typeof merge(), 'function')
})

test('mergeSessionTree: root 恒在首位 depth=0 accent=none', { skip }, () => {
  const tree = build()
  assert.ok(Array.isArray(tree) && tree.length > 0)
  const root = tree[0]
  assert.equal(root.sessionId, ROOT)
  assert.equal(root.depth, 0)
  assert.equal(root.accent, 'none')
  assert.ok(root.role === 'root' || root.role === 'lead', `root 角色应为 root/lead，实际 ${root.role}`)
  assert.equal(typeof root.displayName, 'string')
  assert.ok(root.displayName.length > 0)
})

test('mergeSessionTree: 子代理与队友都进入树，且无重复 sessionId', { skip }, () => {
  const tree = build()
  const ids = tree.map((s) => s.sessionId)
  assert.equal(new Set(ids).size, ids.length, `sessionId 不得重复：${ids.join(',')}`)
  assert.ok(ids.includes('sub-2'), '普通子代理必须在树中')
  assert.ok(ids.includes('team-1'), '队友必须在树中')
  assert.ok(ids.includes('sub-1'), '同时是子代理与队友的会话必须在树中')
  assert.ok(!ids.includes('bad-1'), 'diagnostic 行必须跳过（没有真实会话）')
})

test('mergeSessionTree: 队友优先于同 id 子代理（§5.2）', { skip }, () => {
  const tree = build()
  const sub1 = tree.find((s) => s.sessionId === 'sub-1')
  assert.equal(sub1.role, 'teammate', '同 id 同时是队友与子代理时，队友信息优先')
  assert.equal(sub1.accent, 'teammate')
  assert.ok(sub1.displayName === 'scout' || typeof sub1.displayName === 'string')
})

test('mergeSessionTree: 子代理 accent/role/parentSessionId 正确', { skip }, () => {
  const tree = build()
  const sub2 = tree.find((s) => s.sessionId === 'sub-2')
  assert.equal(sub2.role, 'subagent')
  assert.equal(sub2.accent, 'subagent')
  assert.equal(sub2.parentSessionId, ROOT)
  assert.ok(sub2.depth >= 1)
})

test('mergeSessionTree: 队友 accent=teammate、depth>=1', { skip }, () => {
  const tree = build()
  const team = tree.find((s) => s.sessionId === 'team-1')
  assert.equal(team.role, 'teammate')
  assert.equal(team.accent, 'teammate')
  assert.ok(team.depth >= 1)
})

test('mergeSessionTree: hasActivity 为布尔（由 Run 采集后回填）', { skip }, () => {
  const tree = build()
  for (const scope of tree) {
    assert.equal(typeof scope.hasActivity, 'boolean', `${scope.sessionId}.hasActivity 应为布尔`)
  }
})

test('mergeSessionTree: 输出稳定（重复调用结果一致，按 depth/创建顺序）', { skip }, () => {
  const a = build().map((s) => [s.sessionId, s.depth])
  const b = build().map((s) => [s.sessionId, s.depth])
  assert.deepEqual(a, b)
  // depth 非递减（root 0 在前，子层级在后）
  const depths = a.map(([, d]) => d)
  for (let i = 1; i < depths.length; i += 1) {
    assert.ok(depths[i] >= depths[i - 1], `depth 应非递减，实际 ${depths.join(',')}`)
  }
})

test('mergeSessionTree: 空 descendants/members → 只有 root', { skip }, () => {
  const tree = build({ descendants: [], members: [] })
  assert.equal(tree.length, 1)
  assert.equal(tree[0].sessionId, ROOT)
})

test('mergeSessionTree: 队友列表里重复出现 root（Lead 自己）不产生重复条目', { skip }, () => {
  const tree = build({
    members: [ROOT_MEMBER, ROOT_MEMBER, { id: 'team-1', name: 'backend', role: 'teammate', status: 'running' }],
  })
  const ids = tree.map((s) => s.sessionId)
  assert.equal(ids.filter((id) => id === ROOT).length, 1, `root 只能出现一次：${ids.join(',')}`)
  assert.equal(ids[0], ROOT)
})

test('mergeSessionTree: 缺失 descendants/members 字段不抛错', { skip }, () => {
  assert.doesNotThrow(() => merge()({ rootSessionId: ROOT, rootName: '当前会话' }))
})
