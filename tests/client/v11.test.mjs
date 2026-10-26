// Client v11 P0 会话隔离防御（contract v11 §6.8/§6.11；ui-spec v9 A36/A37 client 侧）
// 覆盖：跨会话帧整帧丢弃（mergePoll 纯函数）、帧内异会话 runs/sessions 过滤、
// 缓存版本/sanitize/写入校验、切会话清瞬时态、诊断与限流告警（源码级）。
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

/* ---------------- mergePoll：帧级隔离（纯函数） ---------------- */
test('A36 异会话帧：mergePoll 整帧丢弃并返回原 state 引用（sessionId/runs/cursors/revision 不变）', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const runA = makeRun({ runId: 'job:a', ownerSessionId: 'root-a', status: 'running' })
  const state = makeViewState({ sessionId: 'root-a', revision: 7, runs: { 'job:a': runA } })
  state.cursors = { 'job:a': { job: 42 } }
  const foreign = makeFrame({
    sessionId: 'root-b',
    revision: 99,
    runs: [makeRun({ runId: 'job:b', ownerSessionId: 'root-b', status: 'running' })],
    removed: ['job:a'],
    nextCursors: { 'job:b': { job: 1 } },
  })
  const out = mergePoll(state, foreign)
  assert.equal(out, state, '异会话帧必须返回原 state 引用（不消费任何字段）')
  assert.equal(out.sessionId, 'root-a')
  assert.equal(out.revision, 7, 'revision 不得被异会话帧推进')
  assert.deepEqual(Object.keys(out.runs), ['job:a'])
  assert.deepEqual(out.cursors, { 'job:a': { job: 42 } })
})

test('A36 帧内隔离：sessionId 正确但 runs/sessions 含异会话 owner → 过滤（root BFS 保留子代理）', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const base = makeViewState({
    sessionId: 'root-a',
    revision: 1,
    sessions: [
      { sessionId: 'root-a', role: 'root', displayName: 'A' },
      { sessionId: 'child-a', parentSessionId: 'root-a', role: 'subagent', displayName: 'child' },
    ],
  })
  const frame = makeFrame({
    sessionId: 'root-a',
    revision: 2,
    sessions: [
      { sessionId: 'root-a', role: 'root', displayName: 'A' },
      { sessionId: 'child-a', parentSessionId: 'root-a', role: 'subagent', displayName: 'child' },
      { sessionId: 'root-b', role: 'root', displayName: 'B' },
    ],
    runs: [
      makeRun({ runId: 'job:own', ownerSessionId: 'root-a', status: 'running' }),
      makeRun({ runId: 'job:child', ownerSessionId: 'child-a', status: 'running' }),
      makeRun({ runId: 'job:foreign', ownerSessionId: 'root-b', status: 'running' }),
    ],
  })
  const out = mergePoll(base, frame)
  assert.deepEqual(Object.keys(out.runs).sort(), ['job:child', 'job:own'], '只保留本会话树 owner 的 runs（含子代理）')
  assert.equal(out.runs['job:foreign'], undefined, '异会话 run 必须被丢弃')
  assert.deepEqual(out.sessions.map((entry) => entry.sessionId).sort(), ['child-a', 'root-a'], '异会话 sessions 必须被过滤')
  assert.equal(out.sessionId, 'root-a', '不得被帧 relabel')
})

test('A36 兼容旧 Host：frame 无 sessionId 时不 relabel、仍按本地会话树过滤异会话 run', { skip }, () => {
  const mergePoll = fn('mergePoll')
  const base = makeViewState({ sessionId: 'root-a', revision: 1 })
  const frame = makeFrame({
    sessionId: '', // 旧 Host 不带 sessionId
    revision: 2,
    runs: [
      makeRun({ runId: 'job:own', ownerSessionId: 'root-a', status: 'running' }),
      makeRun({ runId: 'job:foreign', ownerSessionId: 'root-b', status: 'running' }),
    ],
  })
  const out = mergePoll(base, frame)
  assert.equal(out.sessionId, 'root-a')
  assert.equal(out.runs['job:own'] !== undefined, true)
  assert.equal(out.runs['job:foreign'], undefined, '无 frame.sessionId 时也必须过滤异会话 run')
})

/* ---------------- 缓存版本 / sanitize / 写入校验（源码级） ---------------- */
test('A37 缓存隔离：key 带 CACHE_VERSION、restore sanitize、save 拒绝异会话 view', { skip }, async () => {
  const src = await source()
  assert.match(src, /const SESSION_CACHE_VERSION = 'v11-1'/, '缓存版本必须 bump（旧缓存不读）')
  assert.match(src, /return sessionId \+ '@v' \+ SESSION_CACHE_VERSION/, 'cache key 必须拼版本后缀')
  assert.match(src, /SESSION_CACHE\.get\(sessionCacheKey\(sessionId\)/, '所有缓存读必须走 sessionCacheKey')
  assert.match(src, /SESSION_CACHE\.set\(sessionCacheKey\(sessionId\)/, '所有缓存写必须走 sessionCacheKey')
  assert.match(src, /function sanitizeCachedView\(sessionId, view, options\)/, '必须有缓存消毒函数')
  assert.match(src, /sanitizeCachedView\(sessionId, rawInitialEntry\.view/, 'mount 恢复必须 sanitize')
  assert.match(src, /sanitizeCachedView\(sessionId, cachedRaw\.view\)/, '轮询重建恢复必须 sanitize')
  // save 拒绝异会话 view（只 warn 一次）
  const saveBlock = src.slice(src.indexOf('function cacheSaveSession('), src.indexOf('function cacheSaveSession(') + 900)
  assert.match(saveBlock, /view\.sessionId !== sessionId/, 'save 必须校验 view.sessionId === sessionId')
  assert.match(saveBlock, /refuse to cache cross-session view/, '拒绝写入时必须 warn（限流一次）')
  assert.match(saveBlock, /return\s*\n/, '拒绝时必须提前 return（不写缓存）')
})

/* ---------------- 切会话清瞬时态 / effectiveView ---------------- */
test('A37 切会话：effectiveView 不返回异会话 view；切换 effect 清理 ghost/timers/signature/undo/armed', { skip }, async () => {
  const src = await source()
  assert.match(src, /const effectiveView = isObject\(view\) && view\.sessionId === sessionId \? view : createViewState\(sessionId \|\| ''\)/, 'effectiveView 对异会话 view 必须返回空 view')
  const block = src.slice(src.indexOf('v11 #P0：会话切换（slot 复用组件）时清空所有瞬时 UI 状态'), src.indexOf('v11 #P0：会话切换（slot 复用组件）时清空所有瞬时 UI 状态') + 1600)
  for (const key of ['exitingRef.current.clear()', 'exitingIdsRef.current = new Set()', "layoutSignatureRef.current = ''", 'prevRectsRef.current = {}', 'previousOrderRef.current = []', 'setUndo(null)', 'setArmedRunId(null)', 'cardsRef.current.clear()']) {
    assert.ok(block.includes(key), `切会话必须清理瞬时态：${key}`)
  }
})

/* ---------------- 帧入口防御 / 诊断 / 限流告警 ---------------- */
test('A36 帧入口防御：poll 先 noteCrossSessionFrame 再 merge；连续多帧只 warn 一次', { skip }, async () => {
  const src = await source()
  assert.match(src, /function noteCrossSessionFrame\(frameSessionId, expectedSessionId\)/, '必须有限流告警函数')
  assert.match(src, /CROSS_SESSION_WARNED = true/, '跨会话帧告警必须只打一次')
  assert.match(src, /console\.warn\('\[terminal-panel\] Dropped foreign frame 丢弃跨会话帧'/, '必须 warn 一次（含中文说明）')
  assert.ok(src.includes("if (noteCrossSessionFrame(typeof frame.sessionId === 'string' ? frame.sessionId : null, sessionId))"), '普通 poll 帧到达必须走会话校验')
  assert.ok(src.includes('Dropped foreign runs 丢弃跨会话 runs'), '帧内异会话 runs 必须过滤并 warn 一次')
  assert.ok(src.includes('丢弃跨会话帧（Host 未按会话隔离）'), '发生丢弃时 notice 必须给出明确提示')
})

test('A38 诊断摘要：包含 frameSessionId/droppedForeignRuns/scopedRuns/removedSent/allowedSessions', { skip }, async () => {
  const src = await source()
  for (const key of ['frameSessionId', 'droppedForeignRuns', 'scopedRuns', 'removedSent', 'allowedSessions']) {
    assert.ok(src.includes(key), `诊断摘要必须包含 ${key}`)
  }
  assert.match(src, /frameSessionId=/, 'diag 行必须打印 frameSessionId')
  assert.match(src, /crossSessionDropped=/, '发生跨会话丢弃时 diag 必须标记')
})
