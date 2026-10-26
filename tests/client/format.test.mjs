// Client 纯函数：文本与时间格式化（契约 §11.2 stripAnsi / tailLines / formatDuration / formatCountdown）
// 对应 ui-spec §2.1（终端纯文本渲染）、§2.2（倒计时）、§6（输出截断）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadClient, internalsFn } from '../helpers/load-client.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

/* ---------------- stripAnsi ---------------- */
test('stripAnsi: 剥离 SGR 颜色码，保留文本', { skip }, () => {
  const stripAnsi = internalsFn(client, 'stripAnsi')
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red')
  assert.equal(stripAnsi('\u001b[1;31mbold red\u001b[0m!'), 'bold red!')
})

test('stripAnsi: 剥离 CSI 光标控制码', { skip }, () => {
  const stripAnsi = internalsFn(client, 'stripAnsi')
  assert.equal(stripAnsi('\u001b[2K\u001b[1Aline'), 'line')
  assert.equal(stripAnsi('\u001b[?25lhidden\u001b[?25h'), 'hidden')
})

test('stripAnsi: 剥离 OSC 标题序列（BEL / ST 结尾）', { skip }, () => {
  const stripAnsi = internalsFn(client, 'stripAnsi')
  assert.equal(stripAnsi('\u001b]0;my title\u0007text'), 'text')
  assert.equal(stripAnsi('\u001b]8;;https://x\u001b\\link\u001b]8;;\u001b\\'), 'link')
})

test('stripAnsi: 纯文本原样返回、换行保留、无 ESC 序列不被误伤', { skip }, () => {
  const stripAnsi = internalsFn(client, 'stripAnsi')
  assert.equal(stripAnsi('hello world'), 'hello world')
  assert.equal(stripAnsi('line1\nline2'), 'line1\nline2')
  assert.equal(stripAnsi('[31m]'), '[31m]', '字面量 [31m] 没有 ESC 前缀，不得被剥离')
  assert.equal(stripAnsi(''), '')
})

test('stripAnsi: 孤立 \\r 不抛错（§10 控制字符防注入）', { skip }, () => {
  const stripAnsi = internalsFn(client, 'stripAnsi')
  let out
  assert.doesNotThrow(() => {
    out = stripAnsi('10%\r50%\r100%')
  })
  assert.equal(typeof out, 'string')
  assert.ok(out.includes('100%'))
})

/* ---------------- tailLines ---------------- */
const TEN_LINES = Array.from({ length: 10 }, (_, i) => `L${i + 1}`).join('\n')

test('tailLines: 超出行数时丢头保尾，dropped 计数正确', { skip }, () => {
  const tailLines = internalsFn(client, 'tailLines')
  const got = tailLines(TEN_LINES, 5)
  assert.equal(got.text, ['L6', 'L7', 'L8', 'L9', 'L10'].join('\n'))
  assert.equal(got.dropped, 5)
})

test('tailLines: 未超行数 → 原文不变、dropped=0', { skip }, () => {
  const tailLines = internalsFn(client, 'tailLines')
  const got = tailLines('a\nb\nc', 10)
  assert.equal(got.text, 'a\nb\nc')
  assert.equal(got.dropped, 0)
})

test('tailLines: 恰好等于上限 → 不丢行', { skip }, () => {
  const tailLines = internalsFn(client, 'tailLines')
  const got = tailLines('a\nb\nc', 3)
  assert.equal(got.text, 'a\nb\nc')
  assert.equal(got.dropped, 0)
})

test('tailLines: 尾部换行不产生空行误计', { skip }, () => {
  const tailLines = internalsFn(client, 'tailLines')
  const got = tailLines('a\nb\nc\n', 2)
  const lines = got.text.replace(/\n$/, '').split('\n')
  assert.deepEqual(lines, ['b', 'c'])
  assert.equal(got.dropped, 1)
})

test('tailLines: 空文本 / 非法上限不抛错', { skip }, () => {
  const tailLines = internalsFn(client, 'tailLines')
  assert.deepEqual(tailLines('', 5), { text: '', dropped: 0 })
  assert.doesNotThrow(() => tailLines('a\nb', 0))
  assert.doesNotThrow(() => tailLines('a\nb', -1))
})

/* ---------------- formatDuration ---------------- */
test('formatDuration: 契约示例 1.2s', { skip }, () => {
  const formatDuration = internalsFn(client, 'formatDuration')
  assert.equal(formatDuration(1_200), '1.2s')
})

test('formatDuration: 契约示例 "2m 03s"（分秒）', { skip }, () => {
  const formatDuration = internalsFn(client, 'formatDuration')
  assert.equal(formatDuration(123_000), '2m 03s')
})

test('formatDuration: 秒级整数与进位', { skip }, () => {
  const formatDuration = internalsFn(client, 'formatDuration')
  assert.match(formatDuration(1_000), /^1(\.0)?s$/)
  assert.match(formatDuration(65_000), /^1m 0?5s$/)
})

test('formatDuration: 0 / 负数不抛错且返回非空字符串', { skip }, () => {
  const formatDuration = internalsFn(client, 'formatDuration')
  for (const ms of [0, -5]) {
    const out = formatDuration(ms)
    assert.equal(typeof out, 'string')
    assert.ok(out.length > 0)
  }
})

/* ---------------- formatCountdown ---------------- */
test('formatCountdown: 契约示例 3000 → "3s 后收起"', { skip }, () => {
  const formatCountdown = internalsFn(client, 'formatCountdown')
  assert.equal(formatCountdown(3_000), '3s 后收起')
})

test('formatCountdown: 10s 初值', { skip }, () => {
  const formatCountdown = internalsFn(client, 'formatCountdown')
  assert.equal(formatCountdown(10_000), '10s 后收起')
})

test('formatCountdown: 非整秒取整但格式稳定', { skip }, () => {
  const formatCountdown = internalsFn(client, 'formatCountdown')
  const out = formatCountdown(2_500)
  assert.match(out, /^\d+s 后收起$/)
  const secs = Number(out.match(/^(\d+)s/)[1])
  assert.ok(secs === 2 || secs === 3, `2.5s 应显示 2s 或 3s（取整策略未定），实际 ${secs}s`)
})

test('formatCountdown: 0 / 负数不抛错且不显示负号', { skip }, () => {
  const formatCountdown = internalsFn(client, 'formatCountdown')
  for (const ms of [0, -1_000]) {
    const out = formatCountdown(ms)
    assert.equal(typeof out, 'string')
    assert.ok(out.length > 0)
    assert.ok(!out.includes('-'), `倒计时不得出现负号，实际 ${out}`)
  }
})
