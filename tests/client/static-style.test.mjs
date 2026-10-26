// Client 样式/无障碍静态检查（ui-spec §2.4 颜色令牌、§3.9 动效、§7 无障碍）
// 说明：无 DOM 环境无法渲染，这里只做源码级白盒检查；视觉验收见 acceptance-matrix 的 manual 行。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadClient } from '../helpers/load-client.mjs'
import { CLIENT_FILE } from '../helpers/paths.mjs'

const client = await loadClient()
const skip = client.status === 'missing' ? client.reason : false

async function source() {
  return readFile(CLIENT_FILE, 'utf8')
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

test('颜色只用 --dsw-alias-* 令牌（ui-spec §2.4 / contract §1.3）', { skip }, async () => {
  const src = stripComments(await source())
  const tokens = new Set(src.match(/--dsw-alias-[a-z0-9-]+/g) ?? [])
  assert.ok(tokens.size >= 10, `--dsw-alias-* 令牌使用过少（${tokens.size} 个），疑似硬编码颜色`)
  // ui-spec §2.4 点名的核心令牌必须出现
  for (const token of [
    '--dsw-alias-bg-base',
    '--dsw-alias-bg-layer-1',
    '--dsw-alias-bg-layer-2',
    '--dsw-alias-label-primary',
    '--dsw-alias-label-secondary',
    '--dsw-alias-label-tertiary',
    '--dsw-alias-border-l1',
    '--dsw-alias-border-l2',
    '--dsw-alias-state-business-primary',
    '--dsw-alias-state-success-primary',
    '--dsw-alias-state-error-primary',
    '--dsw-alias-state-warn-primary',
  ]) {
    assert.ok(tokens.has(token), `缺少 ui-spec §2.4 点名的令牌：${token}`)
  }
})

test('禁止把硬编码 hex 直接用于 color/background（允许 var() fallback 与遮罩 color-mix）', { skip }, async () => {
  const src = stripComments(await source())
  const direct = src.match(/(?:^|[;{\s])(?:color|background|border-color|fill|stroke)\s*:\s*#[0-9a-fA-F]{3,8}/)
  assert.equal(direct, null, `发现硬编码颜色：${direct?.[0]}`)
  // 出现的 hex 必须位于 var(--token, fallback) 或 color-mix(...)（如 65% 黑遮罩），不得裸用
  const lines = src.split('\n')
  for (const line of lines) {
    if (!/#[0-9a-fA-F]{3,8}\b/.test(line)) continue
    assert.ok(
      /var\(--dsw-/.test(line) || /color-mix\(/.test(line),
      `硬编码颜色未走令牌/遮罩语法：${line.trim().slice(0, 120)}`,
    )
  }
})

test('圆角/阴影走 token：--dsw-radius-sm/md、--dsw-shadow-lv1/lv3（§2.4）', { skip }, async () => {
  const src = stripComments(await source())
  for (const token of ['--dsw-radius-sm', '--dsw-radius-md', '--dsw-shadow-lv1', '--dsw-shadow-lv3']) {
    assert.ok(src.includes(token), `缺少令牌：${token}`)
  }
})

test('图标为内联 SVG，不用 emoji（ui-spec §2.4/§7）', { skip }, async () => {
  const src = stripComments(await source())
  assert.ok(/h\(\s*'svg'/.test(src) || /createElement\(\s*'svg'/.test(src), '缺少内联 SVG 图标')
  // 只禁彩色 emoji 区块；✓/✕/◼ 是 ui-spec §2.2 要求的状态符号，不在此列
  assert.ok(!/[\u{1F000}-\u{1FAFF}\u{FE0F}]/u.test(src), '发现 emoji 图标（应使用内联 SVG）')
})

test('动效：入场 180ms / 收起 200ms + prefers-reduced-motion（§3.9）', { skip }, async () => {
  const src = await source()
  assert.ok(/180ms/.test(src), '缺少 180ms 入场动画')
  assert.ok(/200ms/.test(src), '缺少 200ms 收起过渡')
  assert.ok(/prefers-reduced-motion/.test(src), '缺少 prefers-reduced-motion 降级')
})

test('无障碍：aria-live + tabular-nums + aria-label（§7）', { skip }, async () => {
  const src = await source()
  assert.ok(/aria-live/.test(src), '终态变化需要 aria-live="polite"')
  assert.ok(/tabular-nums/.test(src), '计时/耗时需要 tabular-nums')
  assert.ok(/aria-label/.test(src), '停止/更多等图标按钮需要 aria-label')
  assert.ok(/aria-expanded/.test(src), '列/行需要 aria-expanded')
})
