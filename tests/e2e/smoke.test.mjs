// node:test 包装：把 tests/e2e/smoke.mjs 纳入 `node --test` 质量门。
// 独立运行冒烟仍是 `node tests/e2e/smoke.mjs`（task-5 要求）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { run } from './smoke.mjs'

test('e2e smoke: host 纯逻辑 + 模拟 client 轮询 → 最终视图帧', async (t) => {
  const result = await run()
  if (result.status === 'skipped') {
    t.skip(`依赖未就绪：${result.reasons.join('；')}`)
    return
  }
  assert.equal(result.status, 'passed')
  assert.ok(result.checks.length >= 10, `冒烟断言数过少：${result.checks.length}`)
  assert.equal(result.frames, 3, '必须是 3 帧轮询序列')
  for (const check of result.checks) assert.equal(check.ok, true, `断言失败：${check.label}`)
})
