// Host v12 展示字段回归（contract v12 §12.1；ui-spec v10 A39–A41 host 侧）
// 覆盖：classifyTool description 规范化/截断；Run.description 经 serializeRun 下发（空缺省、
// >200 截断 + metaTruncated、UTF-8 安全、小预算不破帧）；agent.roleName（lead/teammate/subagent）；
// 终端/job 不误采 description；v11 双会话隔离回归。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule } from '../helpers/host-modules.mjs'
import { createFakeHostCtx, createFakeJobsService } from '../helpers/fakes.mjs'

const classifyMod = await loadHostModule('classify')
const storeMod = await loadHostModule('store')
const panelMod = await loadHostModule('panel')
const skip = classifyMod.missing || storeMod.missing || panelMod.missing
  ? (classifyMod.reason ?? storeMod.reason ?? panelMod.reason)
  : false

const classifyTool = () => classifyMod.mod.classifyTool
const serializeRun = () => storeMod.mod.serializeRun

const baseServices = (extra = {}) => ({
  agents: { get: () => undefined, list: () => [], roots: () => [] },
  subagents: { listDescendants: () => [] },
  agentTeams: { listMembers: () => [], membership: () => undefined, tryMembership: () => undefined },
  jobs: createFakeJobsService(),
  ...extra,
})

function makePanel(services, config = {}) {
  const fake = createFakeHostCtx({ services, config })
  const panel = panelMod.mod.createPanel({ ctx: fake.ctx, config, now: () => 1_700_000_000_000 })
  return { panel, fake }
}

function startEvents(panel, fake) {
  panel.start()
  const execute = fake.listeners.find((entry) => entry.event === 'tools/execute')
  const result = fake.listeners.find((entry) => entry.event === 'tools/result')
  return {
    async run(exec, value) {
      await execute.handler(exec, async () => ({ isError: false }))
      result.handler(exec, { isError: false, value })
    },
  }
}

async function poll(panel, params = {}) {
  const r = await panel.handleRpc('panel.poll', { sessionId: 'root-1', ...params })
  assert.equal(r.ok, true, JSON.stringify(r.error))
  return r.value
}

/* ---------------- 1) classifyTool description ---------------- */
test('v12 classifyTool.description：trim + 连续空白/换行折叠为单行；空/非字符串缺省', { skip }, () => {
  const classify = classifyTool()
  const got = classify('bash', { command: 'npm test', description: '  Run   unit\n\ttests  ' })
  assert.equal(got.kind, 'bash')
  assert.equal(got.description, 'Run unit tests', '必须 trim + 空白折叠 + 单行化')
  assert.equal(got.command, 'npm test')
  for (const args of [{}, { description: '' }, { description: '   \n\t ' }, { description: null }, { description: 42 }, { description: ['x'] }]) {
    const out = classify('bash', args)
    assert.equal(out.description, undefined, `非字符串/空白 description 必须缺省：${JSON.stringify(args)}`)
  }
  assert.equal(classify('bash', undefined).description, undefined)
})

test('v12 classifyTool.description：≤200 代码点；201 截断到 200 且不切坏代理对', { skip }, () => {
  const classify = classifyTool()
  const exact = 'x'.repeat(200)
  assert.equal(classify('bash', { description: exact }).description, exact, '200 字符不截断')
  assert.equal([...classify('bash', { description: 'x'.repeat(201) }).description].length, 200, '201 → 200 代码点')
  // emoji（代理对）按代码点截断，不得产生孤立代理
  const emoji = '😀'.repeat(201)
  const truncated = classify('bash', { description: emoji }).description
  assert.equal([...truncated].length, 200, 'emoji 按代码点截断到 200')
  if (typeof truncated.isWellFormed === 'function') assert.equal(truncated.isWellFormed(), true, '不得切坏代理对')
})

/* ---------------- 2) serializeRun 下发 description ---------------- */
function record(over = {}) {
  return {
    runId: 'bash:1',
    kind: 'bash',
    title: 'Bash',
    command: 'npm test',
    startedAt: 1_000,
    status: 'completed',
    ...over,
  }
}

test('v12 serializeRun：description 空/缺省不出字段；正常值 trim + 单行下发', { skip }, () => {
  const serialize = serializeRun()
  const empty = serialize(record({ description: '' }), 2_000)
  assert.equal('description' in empty, false, '空 description 不得出现字段')
  const blank = serialize(record({ description: '   ' }), 2_000)
  assert.equal('description' in blank, false)
  const none = serialize(record(), 2_000)
  assert.equal('description' in none, false)
  const ok = serialize(record({ description: '  Run   unit\ntests  ' }), 2_000)
  assert.equal(ok.description, 'Run unit tests')
  assert.equal(ok.metaTruncated, undefined, '≤200 不得标 metaTruncated')
})

test('v12 serializeRun：>200 代码点 → 截断到 200（含 …）+ metaTruncated:true；UTF-8 安全', { skip }, () => {
  const serialize = serializeRun()
  const exact = serialize(record({ description: 'x'.repeat(200) }), 2_000)
  assert.equal(exact.description.length, 200)
  assert.equal(exact.metaTruncated, undefined)
  const over = serialize(record({ description: 'x'.repeat(201) }), 2_000)
  assert.equal([...over.description].length, 200, '截断后仍为 200 代码点（199 + …）')
  assert.equal(over.description.endsWith('…'), true)
  assert.equal(over.metaTruncated, true, 'description 截断必须标 metaTruncated')
  const emoji = serialize(record({ description: '😀'.repeat(201) }), 2_000)
  assert.equal([...emoji.description].length, 200)
  assert.equal(emoji.metaTruncated, true)
  if (typeof emoji.description.isWellFormed === 'function') assert.equal(emoji.description.isWellFormed(), true)
})

/* ---------------- 3) 仅 bash 采集 description（terminal/job 不误采） ---------------- */
test('v12 采集范围：bash tools/execute 采 description；terminal_open / job 不误采', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const services = baseServices({
    agents: { get: (id) => (id === 'root-1' ? rootAgent : undefined), list: () => [rootAgent], roots: () => [rootAgent] },
    jobs: createFakeJobsService([
      { id: 'job-1', owner: 'root-1', status: 'running', output: 'job\n', startedAt: 1_000, description: '不应被采集' },
    ]),
  })
  const { panel, fake } = makePanel(services)
  const events = startEvents(panel, fake)
  // bash：应采 description
  await events.run(
    { callId: 'bash-1', name: 'bash', arguments: { command: 'npm test', description: '  Run   unit tests ' }, agent: rootAgent },
    { output: 'ok\n' },
  )
  // terminal_open：即使 args.description 存在也不得写入 Run.description
  await events.run(
    { callId: 'term-1', name: 'terminal_open', arguments: { name: 'dev', description: 'terminal 描述' }, agent: rootAgent },
    { sessionId: 'pty-1', name: 'dev', type: 'zsh', motd: 'hi\n' },
  )
  const frame = await poll(panel)
  const bashRun = frame.runs.find((run) => run.runId === 'bash:bash-1')
  const terminalRun = frame.runs.find((run) => run.runId === 'terminal:pty-1')
  assert.ok(bashRun, 'bash Run 必须可见')
  assert.equal(bashRun.description, 'Run unit tests', 'bash 必须采集并规范化 description')
  assert.ok(terminalRun, 'terminal Run 必须可见')
  assert.equal('description' in terminalRun, false, 'terminal 不得误采 description（契约仅 bash/job）')
  const jobRun = frame.runs.find((run) => run.runId === 'job:job-1')
  if (jobRun !== undefined) assert.equal('description' in jobRun, false, 'job 描述字段（jobs API 无此语义）不得透传')
  await panel.dispose?.()
})

/* ---------------- 4) agent.roleName ---------------- */
test('v12 agent.roleName：root=lead、subagent/teammate=displayName；agent.name 仍为会话标题；role 保留', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const childAgent = { id: 'child-1' }
  const teammateAgent = { id: 'tm-1' }
  const services = baseServices({
    agents: {
      get: (id) => ({ 'root-1': rootAgent, 'child-1': childAgent, 'tm-1': teammateAgent })[id],
      list: () => [rootAgent, childAgent, teammateAgent],
      roots: () => [rootAgent],
    },
    subagents: {
      listDescendants: (rootId) => (rootId === 'root-1'
        ? [{ kind: 'child', id: 'child-1', parentId: 'root-1', depth: 1, label: 'worker', activity: 'running' }]
        : []),
    },
    agentTeams: {
      listMembers: (anchor) => (anchor?.id === 'root-1'
        ? [{ id: 'root-1', name: 'Boss', role: 'lead' }, { id: 'tm-1', name: '队长', role: 'teammate' }]
        : []),
      membership: () => undefined,
      tryMembership: () => undefined,
    },
  })
  const { panel } = makePanel(services)
  const upsert = (runId, ownerSessionId) => panel.store.upsert({
    runId,
    kind: 'job',
    ownerSessionId,
    title: 'job',
    command: 'sleep 1',
    startedAt: 1_000,
    status: 'running',
  })
  upsert('job:root', 'root-1')
  upsert('job:child', 'child-1')
  upsert('job:tm', 'tm-1')
  const frame = await poll(panel)
  const byId = new Map((frame.runs ?? []).map((run) => [run.runId, run]))
  const root = byId.get('job:root')
  const child = byId.get('job:child')
  const teammate = byId.get('job:tm')
  assert.equal(root.agent.roleName, 'lead', 'root 主标签 = lead')
  assert.equal(root.agent.role, 'lead')
  assert.equal(child.agent.roleName, 'worker', 'subagent roleName = displayName')
  assert.equal(child.agent.role, 'subagent')
  assert.equal(teammate.agent.roleName, '队长', 'teammate roleName = displayName')
  assert.equal(teammate.agent.role, 'teammate')
  // agent.name 仍为会话标题（不是 roleName 覆盖）
  for (const run of [root, child, teammate]) {
    assert.equal(typeof run.agent.name, 'string')
    assert.ok(run.agent.name.length > 0)
    assert.notEqual(run.agent.name, undefined)
  }
  assert.equal(root.agent.name, 'Boss', 'agent.name 仍为会话标题（Team lead 名），不被 roleName 覆盖')
  assert.notEqual(root.agent.name, root.agent.roleName, 'agent.name 与 roleName 分离')
  await panel.dispose?.()
})

test('v12 agent.roleName 源码兜底：unknown / 树外 owner → 「—」（v11 隔离下树外 Run 不进入帧，故静态断言兜底分支）', { skip }, async () => {
  const { readFile } = await import('node:fs/promises')
  const src = await readFile(new URL('../../lib/host/panel.mjs', import.meta.url), 'utf8')
  assert.match(src, /roleName: '—'/, '树外/unknown owner 的兜底 roleName 必须为 —')
  assert.match(src, /role === 'lead'\s*\?\s*'lead'/, 'root/lead 固定 lead')
  assert.match(src, /scope\.role === 'teammate' \|\| scope\.role === 'subagent'/, 'teammate/subagent 取 displayName')
})

/* ---------------- 5) 小预算下 description 不破帧 ---------------- */
test('v12 小 maxFrameBytes：长 description 经 meta 截断后帧仍合法、Run 可见', { skip }, async () => {
  const rootAgent = { id: 'root-1' }
  const services = baseServices({
    agents: { get: () => rootAgent, list: () => [rootAgent], roots: () => [rootAgent] },
  })
  const { panel } = makePanel(services, { maxFrameBytes: 4_096 })
  panel.store.upsert({
    runId: 'job:big-desc',
    kind: 'job',
    ownerSessionId: 'root-1',
    title: 'job',
    command: 'sleep 1',
    description: 'D'.repeat(5_000),
    startedAt: 1_000,
    status: 'running',
  })
  const frame = await poll(panel)
  const run = frame.runs.find((entry) => entry.runId === 'job:big-desc')
  assert.ok(run, 'H1 保底：预算小也至少保留 1 条 Run')
  assert.equal([...run.description].length, 200, 'description 必须被 meta 截断到 200 代码点')
  assert.equal(run.metaTruncated, true)
  const size = Buffer.byteLength(JSON.stringify(frame), 'utf8')
  assert.ok(size <= 262_144, `帧 JSON 不得超 Tier3 上限（实际 ${size}）`)
  await panel.dispose?.()
})

/* ---------------- 6) v11 隔离回归（v12 未回退） ---------------- */
test('v12 回归：双会话隔离仍生效（B 帧不含 A 的 run、droppedForeignRuns>0）', { skip }, async () => {
  const agents = { get: (id) => ({ id }), list: () => [], roots: () => [] }
  const services = baseServices({ agents })
  const { panel } = makePanel(services)
  panel.store.upsert({ runId: 'job:a', kind: 'job', ownerSessionId: 'root-a', title: 'a', command: 'a', startedAt: 1_000, status: 'running' })
  const b = await poll(panel, { sessionId: 'root-b' })
  assert.ok(!(b.runs ?? []).some((run) => run.runId === 'job:a'), 'B 帧不得含 A 的 Run')
  assert.ok(b.diagnostics.droppedForeignRuns >= 1)
  assert.equal(b.diagnostics.frameSessionId, 'root-b')
  await panel.dispose?.()
})
