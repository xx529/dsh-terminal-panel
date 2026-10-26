// Host v9 回归（contract v9 §9.4/§9.5；ui-spec v7 A27/A28）
// 覆盖：树外 owner 的 terminal 命中 live Agent → meta-only→live、notice 清空；未命中保持 meta-only 且不删 Run；
// 树内行为不变；diagnostics 扩展字段（agentsService/agentsAccess/agentsProbe/terminalOwners/terminalScopes/tier1Terminals…）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule } from '../helpers/host-modules.mjs'
import { createFakeHostCtx, createFakeJobsService } from '../helpers/fakes.mjs'

const m = await loadHostModule('panel')
const skip = m.missing ? m.reason : false

/** 只认「对象身份」的 terminals 假服务（真实 ctx.terminals 按 Agent 身份校验 owner）。 */
function makeIdentityTerminals({ ownerAgent, id = 'pty-1', name = 'dev', lines = ['$ ls', 'a b c'] }) {
  const calls = { list: 0, read: 0, listOwners: [] }
  return {
    calls,
    list(agent) {
      calls.list += 1
      calls.listOwners.push(agent?.id)
      return agent === ownerAgent
        ? [{ sessionId: id, name, type: 'zsh', pid: 11, status: { kind: 'running' } }]
        : []
    },
    read(agent, terminalId, opts = {}) {
      calls.read += 1
      if (agent !== ownerAgent) throw new Error('terminal owner identity mismatch')
      const count = Math.min(opts.count ?? 400, 4000)
      const offset = Number.isFinite(opts.offset) ? Math.max(0, Math.min(opts.offset, lines.length)) : 0
      const end = Math.max(0, lines.length - offset)
      const start = Math.max(0, end - count)
      const slice = lines.slice(start, end)
      return {
        text: slice.join('\n'),
        totalLines: lines.length,
        lineBegin: offset,
        lineEnd: offset + slice.length,
        truncated: start > 0 || offset > 0,
      }
    },
    kill() {
      return 'requested'
    },
    hasOwnerActivity(agent) {
      return agent === ownerAgent
    },
  }
}

function makeAgents({ rootAgent, ownerAgent, wrapper }) {
  return {
    get: (id) => {
      if (id === rootAgent.id) return rootAgent
      if (ownerAgent !== undefined && id === ownerAgent.id) return ownerAgent
      return undefined
    },
    list: () => (ownerAgent === undefined ? [rootAgent] : [rootAgent, ownerAgent]),
    roots: () => [rootAgent],
    // 测试用：exec.agent 常见为包装对象（与 registry 不同引用）
    __wrapper: wrapper,
  }
}

function makePanel(services, config = {}) {
  const fake = createFakeHostCtx({ services, config })
  const panel = m.ok ? m.mod.createPanel({ ctx: fake.ctx, config, now: () => 1_700_000_000_000 }) : undefined
  return { panel, fake }
}

function startEvents(panel, fake) {
  panel.start()
  const execute = fake.listeners.find((entry) => entry.event === 'tools/execute')
  const result = fake.listeners.find((entry) => entry.event === 'tools/result')
  return {
    async open(exec, value) {
      await execute.handler(exec, async () => ({ isError: false }))
      result.handler(exec, { isError: false, value })
    },
  }
}

const baseServices = (extra = {}) => ({
  subagents: { listDescendants: () => [] },
  agentTeams: { listMembers: () => [], membership: () => undefined, tryMembership: () => undefined },
  jobs: createFakeJobsService(),
  ...extra,
})

async function poll(panel, params = {}) {
  const r = await panel.handleRpc('panel.poll', { sessionId: 'root-1', ...params })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  return r.value
}

const terminalOf = (frame, id) => (frame.runs ?? []).find((run) => run.runId === `terminal:${id}`)

/* 1) v11 改写（原「树外 owner 命中 live 升级」）：树外 owner 不展示/不解析 */
// 期望变更（已获 Lead 批准）：v11 P0 会话隔离取消 v9「树外 owner 升级 live」。
// 旧断言：树外 owner 命中 live → meta-only→live + tier1Terminals=1 + terminalScopes=2。
// 新断言：树外 owner 的 Run 不进入本会话帧；不 list/read 该 owner；droppedForeignRuns>0；removed 为空。
test('A27(v11) 树外 owner 命中 live 也不展示/不解析：runs 无该 Run、droppedForeignRuns>0、不 list/read', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const ownerAgent = { id: 'owner-x' }
  const wrapper = { id: 'owner-x' } // tools/execute 里的包装对象（不同引用）
  const terminals = makeIdentityTerminals({ ownerAgent, id: 'pty-out' })
  const services = baseServices({
    agents: makeAgents({ rootAgent, ownerAgent, wrapper }),
    terminals,
  })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)
  const exec = { callId: 'open-out', name: 'terminal_open', arguments: { name: 'dev', type: 'zsh' }, agent: wrapper }
  await events.open(exec, { sessionId: 'pty-out', name: 'dev', type: 'zsh', motd: 'Welcome\n' })

  const frame = await poll(panel)
  assert.equal(terminalOf(frame, 'pty-out'), undefined, 'v11：树外 owner 的 terminal Run 不得出现在本会话帧')
  assert.ok(frame.diagnostics.droppedForeignRuns >= 1, '被隔离的树外 Run 必须计入 droppedForeignRuns')
  assert.equal(frame.diagnostics.scopedRuns, 0, '本会话没有自己的 Run')
  assert.equal(frame.diagnostics.frameSessionId, 'root-1')
  assert.equal(frame.diagnostics.allowedSessions, 1, 'allowedSessions 只含本会话树')
  assert.equal(frame.diagnostics.terminalScopes, 1, 'terminalScopes = 会话树（不含树外 owner）')
  assert.equal(frame.diagnostics.tier1Terminals, 0, 'tier1Terminals 只数本会话 owner')
  assert.equal(frame.diagnostics.metaOnlyTerminals, 0)
  assert.deepEqual(frame.removed, [], '隔离不等于删除（removed 为空）')
  assert.ok(!terminals.calls.listOwners.includes('owner-x'), '不得对树外 owner 调 terminals.list')
  assert.equal(terminals.calls.read, 0, '不得对树外 owner 调 terminals.read')
  assert.ok(panel.store.get('terminal:pty-out') !== undefined, 'Run 仍在全局 store（由 A 自己的 poll 管理）')
  await panel.dispose?.()
})

/* 2) v11 改写（原「树外 owner 未命中 agent 保持 meta-only」）：树外 owner 一律不展示 */
// 旧断言：可见 meta-only + notice terminal-no-agent。
// 新断言：不展示（即使无 agent）；不误删；removed 为空；droppedForeignRuns>0。
test('A27(v11) 树外 owner 无 live agent：不展示、不误删、removed 为空', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const wrapper = { id: 'owner-y' }
  const terminals = makeIdentityTerminals({ ownerAgent: { id: 'someone-else' }, id: 'pty-y' })
  const services = baseServices({
    agents: makeAgents({ rootAgent, ownerAgent: undefined, wrapper }),
    terminals,
  })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)
  const exec = { callId: 'open-y', name: 'terminal_open', arguments: { name: 'dev' }, agent: wrapper }
  await events.open(exec, { sessionId: 'pty-y', name: 'dev', motd: 'Welcome\n' })

  let frame = await poll(panel)
  assert.equal(terminalOf(frame, 'pty-y'), undefined, 'v11：树外 owner 即使无 agent 也不展示')
  assert.ok(frame.diagnostics.droppedForeignRuns >= 1)
  assert.deepEqual(frame.removed, [], '隔离不是 remove 条件')
  assert.ok(panel.store.get('terminal:pty-y') !== undefined, 'Run 必须保留在全局注册表')
  assert.ok(!terminals.calls.listOwners.includes('owner-y'), '不得对树外 owner 调 terminals.list')
  // 第二帧仍不得删/展示
  frame = await poll(panel, { cursors: frame.nextCursors })
  assert.equal(terminalOf(frame, 'pty-y'), undefined)
  assert.deepEqual(frame.removed, [])
  assert.ok(panel.store.get('terminal:pty-y') !== undefined)
  await panel.dispose?.()
})

/* 3) 树内 owner 行为不变：三计数与 live 升级照旧 */
test('树内 owner 行为不变：live Agent + terminals.list 命中 → live、inScope=1/outOfScope=0', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const terminals = makeIdentityTerminals({ ownerAgent: rootAgent, id: 'pty-in' })
  const services = baseServices({
    agents: makeAgents({ rootAgent, ownerAgent: undefined }),
    terminals,
  })
  const { panel } = makePanel(services)
  const frame = await poll(panel)
  const run = terminalOf(frame, 'pty-in')
  assert.ok(run, '树内 terminal 必须被主链路发现')
  assert.equal(run.outputMode, 'live')
  assert.equal(frame.diagnostics.terminalOwners.inScope, 0, '树内 owner 来自 scopes 而非缓存 → captured/inScope 为 0')
  assert.equal(frame.diagnostics.terminalOwners.outOfScope, 0)
  assert.equal(frame.diagnostics.tier1Terminals, 1)
  assert.equal(frame.diagnostics.terminalScopes, 1)
  await panel.dispose?.()
})

/* 4) diagnostics 必发且形状正确（agents 服务整体缺失） */
test('A28 diagnostics 形状：agents 服务缺失时 agentsService=false/agentsAccess=missing/agentsProbe 默认值', { skip }, async () => {
  const { panel } = makePanel(baseServices({ agents: undefined, terminals: undefined }))
  const frame = await poll(panel)
  const diag = frame.diagnostics
  for (const key of ['rootSessionId', 'agentFound', 'agentCount', 'scopes', 'agentsService', 'agentsAccess', 'agentsProbe', 'terminalOwners', 'terminalScopes', 'tier1Terminals', 'metaOnlyTerminals']) {
    assert.ok(key in diag, `diagnostics 缺少字段 ${key}（每帧必带）`)
  }
  assert.equal(diag.agentsService, false)
  assert.equal(diag.agentsAccess, 'missing')
  assert.deepEqual(diag.agentsProbe, { getOk: false, identityOk: false, sampleIds: [] })
  assert.deepEqual(diag.terminalOwners, { captured: 0, alive: 0, inScope: 0, outOfScope: 0 })
  assert.equal(typeof diag.terminalScopes, 'number')
  assert.equal(diag.tier1Terminals, 0)
  assert.equal(diag.metaOnlyTerminals, 0)
  await panel.dispose?.()
})

/* 5) agents 服务经属性访问可见（ctx.get 无 → ctx.agents 有）→ agentsAccess='property' */
test('A28 diagnostics：ctx.get 拿不到 agents 但 ctx.agents 属性可用 → agentsAccess=property', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const services = baseServices({ agents: makeAgents({ rootAgent, ownerAgent: undefined }), terminals: undefined })
  const { panel, fake } = makePanel(services)
  // 模拟 Cordis：get('agents') 返回 undefined，但 ctx.agents 属性可读
  const realGet = fake.ctx.get.bind(fake.ctx)
  fake.ctx.get = (name) => (name === 'agents' ? undefined : realGet(name))
  const frame = await poll(panel)
  assert.equal(frame.diagnostics.agentsService, true)
  assert.equal(frame.diagnostics.agentsAccess, 'property')
  assert.equal(frame.diagnostics.agentFound, true)
  await panel.dispose?.()
})

/* 6) v11 改写（原「树外 owner 升级 live 后失联仍保留」）：隔离优先，始终不展示 */
// 旧断言：先 live、失联后 Run 保留。
// 新断言：命中 live 也不展示；owner 失联后仍不展示；removed 为空；全局 store 保留由 A 自己管理。
test('A27(v11) 树外 owner 升级 live 后失联：全程不展示、removed 为空', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const ownerAgent = { id: 'owner-z' }
  const wrapper = { id: 'owner-z' }
  const services = baseServices({
    agents: makeAgents({ rootAgent, ownerAgent, wrapper }),
    terminals: makeIdentityTerminals({ ownerAgent, id: 'pty-z' }),
  })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)
  await events.open(
    { callId: 'open-z', name: 'terminal_open', arguments: { name: 'dev' }, agent: wrapper },
    { sessionId: 'pty-z', name: 'dev', motd: 'Welcome\n' },
  )
  let frame = await poll(panel)
  assert.equal(terminalOf(frame, 'pty-z'), undefined, 'v11：树外 owner 即使能解析 live agent 也不展示')
  assert.ok(frame.diagnostics.droppedForeignRuns >= 1)
  // owner agent 从 registry 消失（terminals 也不再认它）
  services.agents.get = () => undefined
  services.agents.list = () => []
  frame = await poll(panel, { cursors: frame.nextCursors })
  assert.equal(terminalOf(frame, 'pty-z'), undefined, 'owner 失联后仍不展示')
  assert.deepEqual(frame.removed, [], 'owner 失联不得触发 removed（隔离优先）')
  assert.ok(panel.store.get('terminal:pty-z') !== undefined, 'Run 仍在全局 store')
  await panel.dispose?.()
})

/* 7) agentsProbe.identityOk：list 里的对象与 get(id) 不同引用 → false（getOk 仍可 true） */
test('A28 agentsProbe：get 可调用但返回不同引用 → getOk=true / identityOk=false', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const listWrapper = { id: 'root-1' }
  const agents = {
    get: (id) => (id === 'root-1' ? rootAgent : undefined),
    list: () => [listWrapper],
    roots: () => [rootAgent],
  }
  const { panel } = makePanel(baseServices({ agents, terminals: undefined }))
  const frame = await poll(panel)
  assert.equal(frame.diagnostics.agentsProbe.getOk, true)
  assert.equal(frame.diagnostics.agentsProbe.identityOk, false, 'list 与 get 不同引用必须被识别')
  assert.equal(frame.diagnostics.sessionIdMatchesAgent, true)
  await panel.dispose?.()
})
