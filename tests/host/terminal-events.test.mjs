// Host v7 纯模块回归：terminal-events.mjs（契约 v7 §7.1 / §11.1 冻结表）
// 覆盖 inputs 边界、terminal_* 工具识别、open/send/read/close/list 解析、controller 归一化。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'
import { mapTerminalStatus } from '../../lib/host/status.mjs'

const m = await loadHostModule('terminal-events')
const skip = m.missing ? m.reason : false
const api = () => {
  if (!m.ok) throw new Error(m.reason)
  return m.mod
}
const fn = (name) => fnOf(m, name)
const bytes = (text) => Buffer.byteLength(text, 'utf8')

test('exports: 10 项冻结导出 + TERMINAL_INPUT_LIMITS/TERMINAL_NOTICE_MESSAGES 取值', { skip }, () => {
  const mod = api()
  for (const name of [
    'TERMINAL_INPUT_LIMITS', 'TERMINAL_NOTICE_MESSAGES', 'noticeFor', 'appendTerminalInput',
    'terminalToolCall', 'parseTerminalOpenResult', 'parseTerminalSessionStatus',
    'parseTerminalCloseResult', 'parseTerminalListResult', 'normalizeControllerTerminal',
  ]) {
    assert.ok(name in mod, `缺少冻结导出 ${name}`)
  }
  assert.deepEqual(mod.TERMINAL_INPUT_LIMITS, { maxEntries: 20, maxEntryBytes: 2048, maxTotalBytes: 8192 })
  for (const code of ['terminal-no-agent', 'terminal-read-failed', 'terminal-controller-unavailable']) {
    assert.equal(typeof mod.TERMINAL_NOTICE_MESSAGES[code], 'string')
    assert.ok(mod.TERMINAL_NOTICE_MESSAGES[code].length > 0)
  }
})

test('noticeFor: 默认文案 / 自定义 message / 未知 code 兜底', { skip }, () => {
  const noticeFor = fn('noticeFor')
  const mod = api()
  assert.deepEqual(noticeFor('terminal-no-agent'), {
    code: 'terminal-no-agent',
    message: mod.TERMINAL_NOTICE_MESSAGES['terminal-no-agent'],
  })
  assert.deepEqual(noticeFor('terminal-read-failed', 'read boom'), { code: 'terminal-read-failed', message: 'read boom' })
  const unknown = noticeFor('custom-code', '')
  assert.equal(unknown.code, 'custom-code')
  assert.equal(unknown.message, 'custom-code')
})

/* ---------------- appendTerminalInput：§7.1 边界 ---------------- */
test('appendTerminalInput: 初始 name 与追加顺序（inputs[0]=name）', { skip }, () => {
  const append = fn('appendTerminalInput')
  let out = append(undefined, 'dev')
  assert.deepEqual(out.inputs, ['dev'])
  out = append(out.inputs, 'ls')
  out = append(out.inputs, 'pwd')
  assert.deepEqual(out.inputs, ['dev', 'ls', 'pwd'])
  assert.equal(out.inputs[0], 'dev')
})

test('appendTerminalInput: 边界「正好 20 条」保留，第 21 条丢最旧', { skip }, () => {
  const append = fn('appendTerminalInput')
  let inputs = ['dev']
  for (let i = 1; i <= 19; i += 1) inputs = append(inputs, `cmd-${i}`).inputs
  assert.equal(inputs.length, 20, '正好 20 条必须全保留')
  assert.equal(inputs[0], 'dev')
  const out = append(inputs, 'cmd-20')
  assert.equal(out.inputs.length, 20, '第 21 条后仍为 20 条')
  assert.equal(out.dropped, 1)
  assert.equal(out.inputs[0], 'cmd-1', '应丢最旧（name 被淘汰）')
  assert.equal(out.inputs[19], 'cmd-20')
})

test('appendTerminalInput: 单条超 2KiB 截断（UTF-8 不切半码点，带省略号）', { skip }, () => {
  const append = fn('appendTerminalInput')
  const limit = api().TERMINAL_INPUT_LIMITS.maxEntryBytes
  const huge = '中'.repeat(1000) // 3000B
  const out = append([], huge)
  assert.equal(out.inputs.length, 1)
  const entry = out.inputs[0]
  assert.ok(bytes(entry) <= limit, `单条必须 ≤${limit}B，实际 ${bytes(entry)}B`)
  assert.ok(entry.endsWith('…'), '截断必须带省略号')
  assert.equal(entry.includes('\uFFFD'), false, '不得切坏 UTF-8 码点')
})

test('appendTerminalInput: 合计边界「正好 8192B」保留，超出丢最旧', { skip }, () => {
  const append = fn('appendTerminalInput')
  // 4 × 2048B = 8192B 正好在合计上限
  const chunk = 'x'.repeat(2048)
  let inputs = []
  for (let i = 0; i < 4; i += 1) inputs = append(inputs, chunk).inputs
  assert.equal(inputs.length, 4)
  assert.equal(inputs.reduce((n, item) => n + bytes(item), 0), 8192)
  const out = append(inputs, 'y'.repeat(1024))
  const total = out.inputs.reduce((n, item) => n + bytes(item), 0)
  assert.ok(total <= 8192, `合计必须 ≤8192B，实际 ${total}`)
  assert.ok(out.inputs.length < 5, '超合计时丢最旧')
  assert.equal(out.inputs[out.inputs.length - 1], 'y'.repeat(1024))
})

test('appendTerminalInput: CRLF 归一化、空串忽略、非字符串安全', { skip }, () => {
  const append = fn('appendTerminalInput')
  assert.deepEqual(append([], 'a\r\nb').inputs, ['a\nb'])
  assert.deepEqual(append(['dev'], '').inputs, ['dev'])
  assert.deepEqual(append(['dev'], undefined).inputs, ['dev'])
  assert.deepEqual(append(null, 'x').inputs, ['x'])
})

/* ---------------- terminalToolCall ---------------- */
test('terminalToolCall: terminal_* 六类识别 + 参数透传 + 非 terminal 返回 null', { skip }, () => {
  const call = fn('terminalToolCall')
  assert.equal(call('bash', {}), null)
  assert.deepEqual(call('terminal_open', { type: 'zsh', name: 'dev', cwd: '/repo' }), { kind: 'open', type: 'zsh', name: 'dev' })
  assert.deepEqual(call('terminal_send', { sessionId: 'pty-1', text: 'ls\n' }), { kind: 'send', terminalId: 'pty-1', text: 'ls\n' })
  assert.deepEqual(call('terminal_read', { terminalId: 'pty-1' }), { kind: 'read', terminalId: 'pty-1' })
  assert.deepEqual(call('terminal_close', { sessionId: 'pty-1' }), { kind: 'close', terminalId: 'pty-1' })
  assert.deepEqual(call('terminal_kill', { sessionId: 'pty-1' }), { kind: 'close', terminalId: 'pty-1' })
  assert.deepEqual(call('terminal_signal', { sessionId: 'pty-1' }), { kind: 'signal', terminalId: 'pty-1' })
  assert.deepEqual(call('terminal_list', {}), { kind: 'list' })
  assert.equal(call('other_tool', {}), null)
  assert.equal(call(null, {}), null)
})

/* ---------------- 解析函数 ---------------- */
test('parseTerminalOpenResult: 带 name/type、无 name、非法文本', { skip }, () => {
  const parse = fn('parseTerminalOpenResult')
  assert.deepEqual(parse('started terminal session pty-4 (dev) [type: zsh]'), { terminalId: 'pty-4', name: 'dev', type: 'zsh' })
  assert.deepEqual(parse('started terminal session pty-4 [type: bash]'), { terminalId: 'pty-4', type: 'bash' })
  assert.equal(parse('not a session line'), null)
  assert.equal(parse(null), null)
})

test('parseTerminalSessionStatus: running / exited(code,signal) / 非法', { skip }, () => {
  const parse = fn('parseTerminalSessionStatus')
  assert.deepEqual(parse('[session: running]'), { kind: 'running' })
  assert.deepEqual(parse('[session: exited code=0 signal=null]'), { kind: 'exited', exitCode: 0, signal: null })
  assert.deepEqual(parse('[session: exited code=1 signal=SIGTERM]'), { kind: 'exited', exitCode: 1, signal: 'SIGTERM' })
  assert.equal(parse('[session: exited code=null signal=SIGKILL]').exitCode, null)
  assert.equal(parse('no status here'), null)
})

test('parseTerminalCloseResult: closed / already-closing / 非法', { skip }, () => {
  const parse = fn('parseTerminalCloseResult')
  assert.deepEqual(parse('closed terminal session pty-4'), { terminalId: 'pty-4', outcome: 'closed' })
  assert.deepEqual(parse('terminal session pty-4 was already closing'), { terminalId: 'pty-4', outcome: 'already-closing' })
  assert.equal(parse('oops'), null)
})

test('parseTerminalListResult: 空标记 / 多行（name、type、pid、exited）', { skip }, () => {
  const parse = fn('parseTerminalListResult')
  assert.deepEqual(parse('(no terminal sessions)'), [])
  const text = [
    'pty-1 (dev) [zsh] running pid=123',
    'pty-2 [bash] exited code=0 signal=null',
  ].join('\n')
  const rows = parse(text)
  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0], { terminalId: 'pty-1', name: 'dev', type: 'zsh', pid: 123, status: { kind: 'running' } })
  assert.equal(rows[1].terminalId, 'pty-2')
  assert.deepEqual(rows[1].status, { kind: 'exited', exitCode: 0, signal: null })
  assert.deepEqual(parse('garbage line'), [])
})

test('normalizeControllerTerminal: WebTerminalInfo 映射 title→name / shell.name→type / state→status', { skip }, () => {
  const normalize = fn('normalizeControllerTerminal')
  const running = normalize({
    id: 'web-1',
    title: 'dev',
    shell: { path: '/bin/zsh', args: [], name: 'zsh' },
    cwd: '/repo',
    cols: 120,
    rows: 30,
    state: 'running',
    exitCode: null,
  })
  assert.equal(running.terminalId, 'web-1')
  assert.equal(running.name, 'dev', 'title 映射到 name')
  assert.equal(running.type, 'zsh', 'shell.name 映射到 type')
  assert.equal(running.cwd, '/repo')
  assert.deepEqual(running.status, { kind: 'running' })
  assert.equal(mapTerminalStatus(running.status), 'running')

  const exited0 = normalize({ id: 'web-2', state: 'exited', exitCode: 0 })
  assert.equal(mapTerminalStatus(exited0.status), 'completed', 'state exited + exitCode 0 → completed（不得显示 running）')
  const exited1 = normalize({ id: 'web-3', state: 'exited', exitCode: 2 })
  assert.equal(mapTerminalStatus(exited1.status), 'failed')
  const failed = normalize({ id: 'web-4', state: 'failed', exitCode: null, error: 'boom' })
  assert.equal(mapTerminalStatus(failed.status), 'failed', 'state failed（exitCode null）也必须 failed，不得 running')
  assert.equal(failed.status.exitCode, 1)
  assert.equal(failed.error, 'boom')
})

test('normalizeControllerTerminal: 旧形状兼容（sessionId/terminalId、name/type/status）与非法输入', { skip }, () => {
  const normalize = fn('normalizeControllerTerminal')
  assert.equal(normalize(null), null)
  assert.equal(normalize({}), null)
  const legacy = normalize({ sessionId: 't-1', name: 'legacy', type: 'fish', status: 'running' }, 'sess-1')
  assert.equal(legacy.terminalId, 't-1')
  assert.equal(legacy.name, 'legacy')
  assert.equal(legacy.type, 'fish')
  assert.deepEqual(legacy.status, { kind: 'running' })
  assert.equal(legacy.fallbackSessionId, 'sess-1')
  const exitedStatus = normalize({ terminalId: 't-2', status: { kind: 'exited', exitCode: 0, signal: null } })
  assert.deepEqual(exitedStatus.status, { kind: 'exited', exitCode: 0, signal: null })
})
