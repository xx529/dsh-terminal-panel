// Client v12 标题/角色 chip/搜索（contract v12 §12.1–§12.3；ui-spec v10 A39–A41 client 侧）
// 注意：`runTitle`/`runTitleTooltip` 为内部函数、**未导出**（Lead 已批准冻结表保持 53 键）。
// 因此 runTitle 行为用「源码级静态断言 + 渲染调用点 + mergePoll 数据通路」验证，不新增导出。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'
import { makeFrame, makeRun, makeViewState } from '../helpers/fixtures.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false
const fn = (name) => internalsFn(client, name)
const source = () => readFile(CLIENT_FILE, 'utf8')
const sliceBetween = (src, startMarker, endMarker) => {
  const start = src.indexOf(startMarker)
  assert.ok(start >= 0, `源码缺少标记：${startMarker}`)
  const end = src.indexOf(endMarker, start + startMarker.length)
  assert.ok(end > start, `源码缺少结束标记：${endMarker}`)
  return src.slice(start, end)
}

/* ---------------- 0) 冻结表：runTitle 不导出（Lead 批准） ---------------- */
test('v12 冻结表不变：__internals 53 键，runTitle/runTitleTooltip 不导出（内部函数）', { skip }, () => {
  if (client.status !== 'ok') assert.fail(client.reason)
  const keys = Object.keys(client.internals)
  assert.equal(keys.length, 53, '__internals 仍 53 键（v12 未新增导出）')
  assert.equal('runTitle' in client.internals, false, 'runTitle 不得导出（Lead 已批准内部实现）')
  assert.equal('runTitleTooltip' in client.internals, false, 'runTitleTooltip 不得导出')
  assert.equal('agentDisplayName' in client.internals, false, 'agentDisplayName 不得导出')
  assert.equal('agentName' in client.internals, false, 'agentName 不得导出')
})

/* ---------------- 1) runTitle 源码级行为 ---------------- */
test('A39 runTitle（内部函数，源码级）：description 优先、空白折叠、超长 …、回退 firstCommandLine、非对象空串', { skip }, async () => {
  const src = await source()
  const block = sliceBetween(src, 'function runTitle(run, maxLen) {', 'function runTitleTooltip(run) {')
  assert.match(block, /if \(!isObject\(run\)\) return ''/, '非对象必须返回空串')
  assert.match(block, /if \(typeof run\.description === 'string'\)/, 'description 优先分支必须存在')
  assert.match(block, /run\.description\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)/, 'description 必须折叠空白 + trim（单行化）')
  assert.match(block, /description\.length > limit \? description\.slice\(0, Math\.max\(0, limit - 1\)\) \+ '…'/, '超长必须截断并补 …')
  assert.match(block, /return firstCommandLine\(run\.command, limit\)/, '无 description 必须回退命令首行（firstCommandLine）')
  assert.match(block, /const limit = typeof maxLen === 'number' && isFinite\(maxLen\) && maxLen > 0 \? Math\.floor\(maxLen\) : 120/, '默认 maxLen=120')
})

test('A39 runTitleTooltip（内部函数，源码级）：description + 完整 command 各一行（空则省略）', { skip }, async () => {
  const src = await source()
  const block = sliceBetween(src, 'function runTitleTooltip(run) {', 'function formatCountdown(ms) {')
  assert.match(block, /if \(typeof run\.description === 'string' && run\.description\.trim\(\) !== ''\) lines\.push\(run\.description\.trim\(\)\)/, 'description 非空才加入 tooltip')
  assert.match(block, /if \(typeof run\.command === 'string' && run\.command !== ''\) lines\.push\(run\.command\)/, '完整 command 必须原样进入 tooltip')
  assert.match(block, /return lines\.join\('\\n'\)/, 'tooltip = description + 完整 command，换行分隔')
})

test('A39 渲染接线（静态）：卡头/已完成行/最大化弹窗标题均走 runTitle；title 属性=runTitleTooltip（含 description+完整 command）', { skip }, async () => {
  const src = await source()
  // 卡头（RunColumn）与已完成行（CompletedRow）
  assert.equal((src.match(/const titleText = runTitle\(run, 160\) \|\| t\('cmd\.none'\)/g) ?? []).length, 2, '卡头 + 已完成行必须都用 runTitle(run,160)')
  assert.equal((src.match(/const titleTooltip = runTitleTooltip\(run\) \|\| commandRaw/g) ?? []).length, 2, '卡头 + 已完成行 title 必须用 runTitleTooltip（回退完整 command）')
  assert.equal((src.match(/className: 'tp-cmd-text tp-col-title', title: titleTooltip/g) ?? []).length, 1, '卡头标题 span 的 title 属性必须为 tooltip')
  assert.equal((src.match(/className: 'tp-row-cmd tp-col-title', title: titleTooltip/g) ?? []).length, 1, '已完成行标题 span 的 title 属性必须为 tooltip')
  // 最大化弹窗
  assert.ok(src.includes("'aria-label': t('actions.maximize') + ' ' + (runTitle(run, 200) || run.command || run.runId)"), '弹窗 aria-label 必须走 runTitle(run,200)')
  assert.ok(src.includes("className: 'tp-modal-cmd', title: runTitleTooltip(run) || run.command || ''"), '弹窗标题 title 必须含 description+完整 command')
})

/* ---------------- 2) mergePoll 数据通路 ---------------- */
test('A39 mergePoll：description 透传 + trim、>200 client 兜底截断、空值不出现字段；roleName 保留', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const base = makeViewState({ sessionId: 'root-a', revision: 1 })
  const frame = makeFrame({
    sessionId: 'root-a',
    revision: 2,
    runs: [
      makeRun({ runId: 'job:1', ownerSessionId: 'root-a', kind: 'job', description: '  Run   unit tests  ', agent: { id: 'root-a', name: 'Boss', role: 'lead', roleName: 'lead' } }),
      makeRun({ runId: 'job:2', ownerSessionId: 'root-a', kind: 'job', description: 'D'.repeat(500) }),
      makeRun({ runId: 'job:3', ownerSessionId: 'root-a', kind: 'job', description: '   ' }),
    ],
  })
  const out = mergePoll(base, frame)
  assert.equal(out.runs['job:1'].description, 'Run   unit tests', 'client 侧 trim（host 已做空白折叠；这里不得丢失内容）')
  assert.equal(out.runs['job:2'].description.length, 200, 'client 兜底截断到 200')
  assert.equal(out.runs['job:3'].description, undefined, '空白 description 不得保留值（序列化时字段省略）')
  assert.equal(out.runs['job:1'].agent.roleName, 'lead', 'roleName 必须随 agent 透传')
  assert.equal(out.runs['job:1'].agent.name, 'Boss')
})

/* ---------------- 3) 搜索覆盖 description / roleName ---------------- */
test('A41 searchMatch/filterRuns：命中 description 与 roleName（大小写不敏感），未命中返回 false', { skip }, () => {
  const searchMatch = fn('searchMatch')
  const filterRuns = fn('filterRuns')
  const run = makeRun({
    runId: 'job:search',
    ownerSessionId: 'root-a',
    command: 'sleep 1',
    title: 'Bash',
    description: 'Run Unit Tests',
    agent: { id: 'root-a', name: 'Boss', role: 'lead', roleName: 'Boss' },
    output: {},
  })
  assert.equal(searchMatch(run, 'unit tests'), true, '必须命中 description（大小写不敏感）')
  assert.equal(searchMatch(run, 'boss'), true, '必须命中 roleName')
  assert.equal(searchMatch(run, 'sleep'), true, '既有 command 命中保持')
  assert.equal(searchMatch(run, 'not-present'), false)
  assert.equal(searchMatch(run, ''), true, '空 query 匹配全部')
  const runs = [run, makeRun({ runId: 'job:other', ownerSessionId: 'root-a', command: 'echo x', description: '', output: {} })]
  const filtered = filterRuns(runs, { kind: 'all', sessionIds: null, search: 'unit tests', showCompleted: true })
  assert.deepEqual(filtered.map((entry) => entry.runId), ['job:search'], 'filterRuns 搜索必须命中 description')
})

/* ---------------- 4) AgentChip / 角色名 ---------------- */
test('A40 AgentChip（静态）：主标签=roleName→agent.name→—；次级角色文本保留；不改尺寸类', { skip }, async () => {
  const src = await source()
  const displayName = sliceBetween(src, 'function agentDisplayName(agent) {', 'function AgentChip(props) {')
  assert.match(displayName, /typeof agent\.roleName === 'string' && agent\.roleName\.trim\(\) !== ''\) return agent\.roleName\.trim\(\)/, 'roleName 优先')
  assert.match(displayName, /return agentName\(agent\)/, 'roleName 缺失回退 agent.name')
  const chip = sliceBetween(src, 'function AgentChip(props) {', 'function StatusText(props) {')
  assert.match(chip, /const name = agentDisplayName\(agent\)/, 'chip 主标签必须用 agentDisplayName（roleName 优先）')
  assert.match(chip, /const roleText = name === '—' \? '' : roleLabel\(role, props\.t\)/, '主标签为 — 时不显示次级角色文本')
  assert.match(chip, /className: 'tp-agent' \+ accent/, 'chip className 只允许固定尺寸类 + role accent（不得新增尺寸类）')
  assert.match(chip, /title: roleText === '' \? name : name \+ ' · ' \+ roleText/, 'chip title = 名称 · 角色文本')
  // roleLabel 映射：lead 走「当前会话」，subagent/teammate 各自标签
  const roleLabel = sliceBetween(src, 'function roleLabel(role, t) {', 'function agentName(agent, t) {')
  assert.match(roleLabel, /if \(role === 'subagent'\) return t\('role\.subagent'\)/)
  assert.match(roleLabel, /if \(role === 'teammate'\) return t\('role\.teammate'\)/)
  assert.match(roleLabel, /return t\('role\.current'\)/)
})

test('v12 回归：linger=3000 与 __internals 53 键未回退', { skip }, () => {
  assert.equal(client.internals.LINGER_DELAY_MS, 3_000)
  assert.equal(client.internals.COLLAPSE_DELAY_MS, 10_000, 'v7 废弃 state machine 仍 10s')
  assert.equal(Object.keys(client.internals).length, 53)
})
