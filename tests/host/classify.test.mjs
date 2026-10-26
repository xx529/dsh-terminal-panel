// Host 纯逻辑：工具分类（契约 §11.1 classify.mjs；§5.2 来源映射）
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHostModule, fnOf } from '../helpers/host-modules.mjs'

const m = await loadHostModule('classify')
const skip = m.missing ? m.reason : false
const classify = () => fnOf(m, 'classifyTool')

test('exports: classifyTool 是函数（契约 §11.1）', { skip }, () => {
  assert.equal(typeof classify(), 'function')
})

const KINDS = [
  // name 含 'terminal' → terminal
  ['terminal_start', { command: 'zsh' }, 'terminal'],
  ['terminal_send', { input: 'ls\n' }, 'terminal'],
  ['terminal_read', {}, 'terminal'],
  ['terminal', {}, 'terminal'],
  // 精确集合 → bash
  ['bash', { command: 'npm test' }, 'bash'],
  ['pwsh', {}, 'bash'],
  ['shell', { command: 'ls -la' }, 'bash'],
  ['exec', {}, 'bash'],
  // job_ 前缀 → job
  ['job_list', {}, 'job'],
  ['job_output', { jobId: 'j1' }, 'job'],
  ['job_kill', { jobId: 'j1' }, 'job'],
  // 其余 → null
  ['read_file', { path: 'a' }, null],
  ['write_file', {}, null],
  ['edit', {}, null],
  ['', {}, null],
  ['WEB_SEARCH', {}, null],
]

for (const [name, args, expected] of KINDS) {
  test(`classifyTool(${JSON.stringify(name)}) → ${expected ?? 'null'}`, { skip }, () => {
    const classifyTool = classify()
    const got = classifyTool(name, args)
    if (expected === null) {
      assert.equal(got, null, `未匹配的工具名应返回 null，实际 ${JSON.stringify(got)}`)
    } else {
      assert.ok(got && typeof got === 'object', `应返回对象，实际 ${JSON.stringify(got)}`)
      assert.equal(got.kind, expected)
    }
  })
}

test('classifyTool 透传 args.command / args.cwd（契约 §11.1）', { skip }, () => {
  const classifyTool = classify()
  const got = classifyTool('bash', { command: 'npm test --watch', cwd: '/repo/sub' })
  assert.equal(got.kind, 'bash')
  assert.equal(got.command, 'npm test --watch')
  assert.equal(got.cwd, '/repo/sub')
})

test('classifyTool 对空/缺失 args 不抛错', { skip }, () => {
  const classifyTool = classify()
  for (const args of [undefined, null, {}, 'not-an-object', 42]) {
    assert.doesNotThrow(() => classifyTool('bash', args), `args=${String(args)} 不应抛错`)
  }
})

test('classifyTool 只映射 kind，不做命令拼接（command 缺省时为空）', { skip }, () => {
  const classifyTool = classify()
  const got = classifyTool('bash', {})
  assert.equal(got.kind, 'bash')
  assert.ok(got.command === undefined || got.command === '', '无 command 时不得凭空生成命令')
})
