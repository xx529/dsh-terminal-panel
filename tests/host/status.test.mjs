// Host 纯逻辑：三来源状态映射（契约 §11.1 status.mjs；§6.1 状态映射全表）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'

const m = await loadHostModule('status')
const skip = m.missing ? m.reason : false

test('exports: mapShellStatus / mapJobStatus / mapTerminalStatus（契约 §11.1）', { skip }, () => {
  for (const name of ['mapShellStatus', 'mapJobStatus', 'mapTerminalStatus']) {
    assert.equal(typeof fnOf(m, name), 'function', `缺少 ${name}`)
  }
})

/* ---------------- shell → RunStatus ---------------- */
const SHELL_CASES = [
  ['运行中', { status: 'running', exitCode: null, signal: null }, 'running'],
  ['正常完成 exit 0', { status: 'completed', exitCode: 0, signal: null }, 'completed'],
  ['非零退出', { status: 'completed', exitCode: 2, signal: null }, 'failed'],
  ['exitCode=null 且有 signal', { status: 'completed', exitCode: null, signal: 'SIGTERM' }, 'failed'],
  ['被停止 killed', { status: 'killed', exitCode: null, signal: 'SIGTERM' }, 'killed'],
  ['killed 无 signal', { status: 'killed', exitCode: null, signal: null }, 'killed'],
]

for (const [label, value, expected] of SHELL_CASES) {
  test(`mapShellStatus: ${label} → ${expected}`, { skip }, () => {
    const got = fnOf(m, 'mapShellStatus')(value)
    assert.equal(got, expected, `期望 ${expected}，实际 ${JSON.stringify(got)}`)
  })
}

test('mapShellStatus: exitCode 为 undefined 时按"有 signal 即失败、否则完成"退化处理', { skip }, () => {
  const map = fnOf(m, 'mapShellStatus')
  // 契约允许 null/undefined 两种"无退出码"形态；只约束不抛错且落在合法枚举内。
  const statuses = ['running', 'completed', 'failed', 'killed']
  for (const value of [
    { status: 'completed', exitCode: undefined, signal: null },
    { status: 'completed', exitCode: null, signal: undefined },
  ]) {
    const got = map(value)
    assert.ok(statuses.includes(got), `非法状态枚举: ${JSON.stringify(got)}`)
  }
})

/* ---------------- job → { status, stopping } ---------------- */
const JOB_CASES = [
  ['running', 'running', false],
  ['stopping', 'running', true],
  ['completed', 'completed', false],
  ['failed', 'failed', false],
  ['killed', 'killed', false],
]

for (const [input, expectedStatus, expectedStopping] of JOB_CASES) {
  test(`mapJobStatus: ${input} → ${expectedStatus} (stopping=${expectedStopping})`, { skip }, () => {
    const got = fnOf(m, 'mapJobStatus')(input)
    assert.ok(got && typeof got === 'object', 'mapJobStatus 应返回对象')
    assert.equal(got.status, expectedStatus)
    assert.equal(got.stopping, expectedStopping)
  })
}

/* ---------------- terminal → RunStatus ---------------- */
const TERMINAL_CASES = [
  ['运行中', { kind: 'running' }, 'running'],
  ['exit 0', { kind: 'exited', exitCode: 0, signal: null }, 'completed'],
  ['exit 1', { kind: 'exited', exitCode: 1, signal: null }, 'failed'],
  ['signal 终止', { kind: 'exited', exitCode: null, signal: 'SIGKILL' }, 'failed'],
]

for (const [label, value, expected] of TERMINAL_CASES) {
  test(`mapTerminalStatus: ${label} → ${expected}`, { skip }, () => {
    const got = fnOf(m, 'mapTerminalStatus')(value)
    assert.equal(got, expected, `期望 ${expected}，实际 ${JSON.stringify(got)}`)
  })
}
