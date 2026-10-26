# 复盘 · 前台 bash 实时输出的平台假设被推翻

> 触发条件：dsh-team-contract §12 的 **T4**（卡点的解除方式是结构性调整：改 API 契约 / 数据源）。
> 字段格式严格按 `dsh-team-contract §12.3`（id / date / trigger / owner / symptom / root_cause / impact / fix / prevention / verified_by / status）。

```yaml
id: R-2026-10-26-bash-live-source
date: 2026-10-26
trigger: T4
owner: architect
symptom: 任务书与 contract v1（git 9d4803b）假设「包装 ctx.shell.execute 可拿到前台 bash 过程输出」（v1 §1.2 非目标写「ctx.shell.execute 只做只读包装」；v1 §5.2 bash 行标 [FACT] F9/F14「包装捕获 ShellExecution…observed.stdout.readFrom」）。scout T1 取证后判定不成立：shell 是「一个上下文一个实现，重复提供会 throw」的抽象服务，无第三方持有别的工具创建的 ShellExecution 句柄。contract 升 v2（git 597775c）改为三层：tools/execute 记录 Run + tools/result 终态输出 + shell tee best-effort；UI 降级为 final-only。
root_cause: 规则未定义 — 架构阶段缺少「平台能力先取证、再写成契约 Fact」的门禁；需求侧（ui-spec v4 §2.1 输出区「实时 tail」）在架构取证之前已被写成硬承诺，架构直接把它当 Fact 落进 v1 §5.2，而不是标 ASSUMPTION 并挂验证方式。
impact: backend 多实现一条降级链路（tools/result 终态、final-only Run、幽灵 Run 吸收、availability.bashLive）；frontend 增加「仅终态」徽标与禁用停止；验收矩阵把该能力标 manual+限制（矩阵 D5-1）。未造成返工式重写，但 final-only 语义定案延后（v1→v2），多消耗一轮跨角色对齐，且 client/service 两侧都要为「同一能力两种 outputMode」写分支。
fix: contract v2 三层数据源（tools/execute 记录 + tools/result 终态 + shell tee best-effort）+ availability.bashLive + outputMode:'final-only'；client 对 final-only 显示「仅终态」并禁用停止；tester 用 panel.test.mjs 的「来源缺失 → availability 标记、帧仍正常」用例与 smoke 的 bashLive 两态断言覆盖降级路径。
prevention: 三项可执行载体——(1) 契约规则：contract §2 中每个平台能力必须带证据或标 ASSUMPTION+验证方式，ASSUMPTION 不得作为 UI 硬承诺；每次升版逐条扫 §2 与 §12.9（owner: architect）；(2) 测试载体：tests/host/panel.test.mjs 增加「bashLive.available=false 时 panel.poll 仍返回完整帧」断言（owner: tester，当前缺失，见 status）；(3) 流程载体：任务拆解时「未验证平台能力」必须先派 scout 取证任务，contract 任务以 blocked_by 依赖该取证任务（owner: lead，本次已按此执行）。
verified_by: architect 在本轮升版时执行契约扫描（contract §2/§12.9 当前 ASSUMPTION 项均非 UI 硬承诺，扫描记录见下「prevention 明细」）；Lead 核对任务板 blocked_by（task-7 blocked_by task-1）；测试载体 (2) 尚未落地 → status 保持 open。
status: open
```

## 证据

| # | 证据 | 位置 / 命令 |
|---|---|---|
| E1 | contract v1 的错误 Fact 与「只读包装」表述 | `git show 9d4803b:docs/architecture/contract.md` → §1.2「`ctx.shell.execute` 只做只读包装」、§5.2 bash 行「包装 `ctx.shell.execute` 捕获返回的 `ShellExecution`…`[FACT]` F9/F14」 |
| E2 | scout T1 推翻该假设 | `docs/research/dsh-plugin-apis.md` §4.2（结论原文：「不要包装 shell.execute」；「一个上下文一个实现，重复加载会 throw」）；§10.4 D1 决策 |
| E3 | contract v1→v2 的结构性调整 | `git diff 9d4803b..597775c -- docs/architecture/contract.md`（§5.2 改为三层；§9 增 `bashCapture`/`finalOutputBytes`；§12.7 裁决） |
| E4 | 实现侧降级链路已存在 | backend：`lib/host/panel.mjs:271` 监听 `tools/execute`（waterfall，原样 `next()`）、`:281` 监听 `tools/result`（emit）；`lib/host/capture-bash.mjs`（幽灵 Run + `contentText`/`parseExitMarker` 终态提取 + tee best-effort）；`lib/host/frame.mjs` `parseToolResultText`。frontend：「仅终态」徽标 |
| E5 | 验收口径已按限制降级 | `docs/testing/report.md` §7「已知不可自动化验收项」第 4 条、§8 平台限制表（矩阵 D5-1） |
| E6 | bashLive 两态已有 mock 证据 | `node scripts/smoke-host.mjs` → 检查项 `bashLive becomes available after a handle was captured` 与 `bashLive = unavailable (no shell)`（72/72 PASS） |
| E7 | 缺口（测试载体未落地） | `grep -rn "bashLive" tests/` → **无命中**；`tests/host/panel.test.mjs:220` 仅覆盖「来源缺失 → availability 标记」，未覆盖 bashLive 在 poll 帧中的完整性 |

## prevention 明细（可执行载体与落地检查）

| # | 载体类型 | 载体位置 | 落地 owner | 当前状态 | 验证方式 |
|---|---|---|---|---|---|
| P1 | 契约规则 | `docs/architecture/contract.md` §0 标注口径 + §2「scout 复核」列 + §12.9 未确认项表；规则：平台能力必须带证据或标 `[ASSUMPTION]` + 验证方式，`[ASSUMPTION]` 不得作为 UI 硬承诺 | architect | **已落地** | 本轮升版执行扫描：`grep -n '\[ASSUMPTION\]' docs/architecture/contract.md` → 正文 2 项（页面 `baseURI`、Host `Config` schema；第 3 处命中是 §0 的定义句），逐条确认均非 UI 硬承诺；扫描动作已随 v4 附录执行 |
| P2 | 测试载体 | `tests/host/panel.test.mjs` 新增用例：`bashLive.available=false` 时 `panel.poll` 仍返回 `ok:true` 且帧完整（runs 按其它来源正常、`availability` 不因 bashLive 缺失而整体失败） | tester | **未落地（open）** | `grep -rn "bashLive" tests/` 无命中；落地后跑 `npm test` 应通过并由 tester 在本表更新状态 |
| P3 | 流程载体 | 任务板依赖：任何把「未验证平台能力」写入 contract 的任务，必须以 `blocked_by` 依赖 scout 取证任务 | lead | **已执行** | 核对任务板：`task-7 blocked_by [task-1, task-2]`（T1 scout 取证是契约 v2 的前置） |

## status 说明与解除条件

- `status: open` 的原因：**P2（测试载体）尚未落地**；P1/P3 已生效。
- 落地 owner：**tester**。
- 解除条件（全部满足后由 architect 把 status 改 `closed` 并补 `verified_by`）：
  1. `tests/host/panel.test.mjs` 存在断言 `availability.bashLive.available === false` 时 poll 帧仍完整；
  2. `node --test "tests/**/*.test.mjs"` 通过（当前 236 用例基线不回退）；
  3. 在本文件 `prevention 明细` P2 行更新为「已落地」并附用例名。
