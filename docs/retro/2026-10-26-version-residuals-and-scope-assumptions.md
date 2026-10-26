# 复盘 · 升版残留双轨 + 发现链路作用域假设（v8→v9）

> 触发条件：dsh-team-contract §12 的 **T2**（v8→v9 两轮真机缺陷暴露两类体系问题：升版残留双轨、发现链路作用域假设错误）。
> 字段格式严格按 `dsh-team-contract §12.3`（id / date / trigger / owner / symptom / root_cause / impact / fix / prevention / verified_by / status）。

```yaml
id: R-2026-10-26-version-residuals-and-scope-assumptions
date: 2026-10-26
trigger: T2
owner: architect（复盘撰写/载体核对）；载体 owner 逐条见 prevention 明细
symptom: |
  (1) 升版残留双轨：v7 的 `column.collapse` 状态机 + `collapse.in`/`tp-countdown` 在 v8 引入 linger 后仍被 `CompletedRow` 复用 → 真机「已完成区点不开 + 已完成行仍显示『10s 后收起』」。v8 HEAD（0e81296）`CompletedRow` 仍 `collapseVisual(column.collapse)` 并渲染 `tp-countdown`/`collapse.in`；`toggleRow` 在 `view.columns[runId]` 缺失时直接 `return`。同时 v7 测试仍断言旧 CSS，导致 v9 无法直接删死代码（只能「样式暂留但不再渲染」）。
  (2) 发现链路的作用域假设错误：v7 tier1 只遍历会话树 `scopes`，而 tier3 事件旁路不按树过滤 → 树外 owner 的 terminal 永久 `meta-only` + 永久黄框（真机全部 TERM 卡片命中）。根因不是服务注入/身份不匹配（scout 已证伪），而是「假设 owner 必在会话树」。
  (3) （流程教训）Lead 一度采纳「可能是页面跑旧 bundle」判断；实际 v8 HEAD 的 `CompletedRow` 仍在渲染 v7 倒计时（可由 `git show` 复现）。结论类判断必须附可复现命令与原始输出，不能只看行号摘要。
root_cause: |
  (1) 升版时没有「被替换/作废的旧状态机、旧文案、旧样式、旧测试断言」清单：v8 引入 linger 后，v7 的 `column.collapse` / `tp-countdown` 仍被 CompletedRow 读取；旧测试又把死样式断言成契约（v7.test.mjs:153 锁 `.tp-countdown{...min-width:74px}`），形成「实现不敢删、测试仍在锁」的双轨。
  (2) 发现链路只定义了「主路径的遍历入口」（会话树），没有定义「已知 owner/session 集合」这个下界；tier3 事件旁路登记了树外 owner，但 tier1 不遍历它 → 该 owner 永远解析不到 live Agent，只能 meta-only。
  (3) 结论取证没有强制「可复现命令 + 原始输出」；「旧 bundle」是合理怀疑但未经 HEAD 代码取证即被接受。
impact: |
  v8→v9 多消耗一轮结构修订（前端改展开状态机、后端扩 tier1 作用域）；死代码与旧测试断言形成技术债（`.tp-countdown`/`.tp-progress` 样式与 `collapse.in` 词典暂留）；真机根因一度被误判为「旧 bundle」，延误定位；v9 文档需同时记录「替换关系」与「样式暂留」以免误读。
fix: |
  v9（commit 052db85/0696982/0111165）：已完成行展开改 `view.group.expandedIds`（`lib/client.js:2609 CompletedRow`、`:3193 setRowExpanded`、`:3209 toggleRow` 不再依赖 columns），已完成行不再渲染倒计时/进度条（样式/词典暂留测试兼容）；tier1 Agent 解析扩为 `scopes ∪ store terminal ownerSessionId`（`lib/host/panel.mjs:735 terminalScopes`），命中即清 notice、`meta-only→live`；diagnostics 扩展（agentsService/agentsProbe/terminalOwners/terminalScopes 等）；测试新增 `tests/client/v9.test.mjs:80 A24`、`tests/host/v9-owner.test.mjs:96/134/216 A27`。
prevention: |
  四项可执行载体（a/c/d 已落地，b 部分落地 → status open，详见下方明细）：
  (a) 契约规则：每次升版在 §0 变更记录列「被替换/作废的旧状态机、旧文案、旧样式、旧测试断言」清单（owner: architect；载体：contract §0 v9 行已列替换关系 + AGENTS.md §8.1 升版清单规则）；
  (b) 测试载体：`tests/client/**` 增加「已作废渲染不得再出现」组件级断言模板（v9 已有 `tests/client/v9.test.mjs:80 A24`），并把「v7 死代码 + v7.test 断言锁定」标注为已知技术债（owner: tester；当前仅 v9.test.mjs:89 注释提及，未在 docs/testing 正式登记 → 需 tester 补登）；
  (c) 发现链路规则：任何 tier/来源发现必须以「store 中已知 owner/session 集合」为下界，不能只用会话树（owner: backend；载体：contract §5.2/§9.4 + `lib/host/panel.mjs:735` + `tests/host/v9-owner.test.mjs:96 A27`）；
  (d) 流程规则：teammate 报「可能是旧构建/旧 bundle」类结论必须附可复现验证命令与输出（owner: Lead；载体：AGENTS.md §8.1 第 3 条）。
verified_by: |
  见「prevention 明细」逐条命令；`npm run verify` 当前 338 tests / 338 pass + 91/91 smoke + exit 0（v9 基线，未回退）。
  技术债已登记 `docs/testing/report.md` §14「已知技术债」（tester，2026-10-26）；A24 模板 `tests/client/v9.test.mjs:80`；338/338 + 91/91 + verify exit 0。
status: closed   # P2（tester 技术债正式登记）已落地；a/b/c/d 全部落地（2026-10-26）
```

## 证据

| # | 证据 | 位置 / 命令 |
|---|---|---|
| E1 | v8 CompletedRow 仍复用 collapse 并渲染倒计时 | `git show 0e81296:lib/client.js \| sed -n '2467,2525p'` → `const collapse = …column.collapse`、`collapseVisual(collapse, now)`、`className: 'tp-countdown'`、`tpl(t, 'collapse.in', …)` |
| E2 | v8 toggleRow 在缺失 column 时直接 return | `git show 0e81296:lib/client.js \| sed -n '3072,3078p'` → `const column = view.columns[runId]; if (column === undefined) return` |
| E3 | v7 测试锁死旧 CSS（死代码无法删） | `grep -n "tp-countdown" tests/client/v7.test.mjs` → `:153` 断言 `.tp-countdown{...min-width:74px}` |
| E4 | v9 修复（展开独立 + 不渲染倒计时） | `lib/client.js:2609` `CompletedRow`、`:2669` `expandedIds`、`:3193` `setRowExpanded`、`:3209` `toggleRow`；`grep -n "tp-countdown" lib/client.js` 仅剩 CSS/媒体查询，无渲染点 |
| E5 | v9 组件级防回归模板 | `tests/client/v9.test.mjs:80` A24（断言已完成行不渲染 `collapse.in`/`tp-countdown`/`tp-progress` 与 `column.collapse`）；`:89` 注释记录「v7 死样式暂留（兼容旧断言）」 |
| E6 | v9 tier1 作用域修复 | `lib/host/panel.mjs:735` `const terminalScopes = [...sessions]` + 遍历 `store.all()` 补 ownerSessionId；`git show 0e81296:lib/host/panel.mjs \| grep -c terminalScopes` → **0**（v8 无此逻辑） |
| E7 | 树外 owner 测试 | `tests/host/v9-owner.test.mjs:96/134/216`（命中 live→live、未命中 meta-only 不删、失联保留） |
| E8 | 契约已写替换关系与作用域 | `docs/architecture/contract.md:3`（v9 状态）、`:39`（§0 v9 行「替换关系」）、`:132`（§7.2 行 1 作用域）、`:250`（§9.4） |
| E9 | 「旧 bundle」假设被证伪的取证读法 | `git show 0e81296:lib/client.js \| sed -n '2467,2525p'`（HEAD 旧代码确实在渲染倒计时）；App 内 bundle 是 asar 解包产物，不能作为「页面旧」的唯一证据 |

## prevention 明细（可执行载体与落地检查）

| # | 载体类型 | 载体位置 | 落地 owner | 当前状态 | 验证方式 |
|---|---|---|---|---|---|
| P1 | 契约规则：升版列「替换/作废清单」 | `docs/architecture/contract.md:39`（§0 v9 行已列替换关系）+ `AGENTS.md:152` §8.1「升版必须列替换/作废清单」 | architect | **已落地** | `grep -n "替换关系\|升版必须列" docs/architecture/contract.md AGENTS.md` → 命中；v9 行含「替换 v7 collapse 复用 / 替换 v8 固定宽」 |
| P2 | 测试载体：组件级「已作废渲染不得出现」模板 + 技术债登记 | 模板：`tests/client/v9.test.mjs:80` A24（已落地）；技术债登记：**缺**（当前仅 `tests/client/v9.test.mjs:89` 注释 + 本复盘，未见 `docs/testing/report.md` 技术债条目） | tester | **部分落地（open）** | `grep -n "A24" tests/client/v9.test.mjs` 命中；`grep -rn "技术债\|死代码" docs/testing/report.md` 无命中 → tester 需补登（v7 死样式 `.tp-countdown`/`.tp-progress`/`collapse.in` 与 `tests/client/v7.test.mjs:153` 锁定项） |
| P3 | 发现链路规则：tier 发现以已知 owner/session 集合为下界 | `docs/architecture/contract.md:132` §7.2 + `:250` §9.4；实现 `lib/host/panel.mjs:735`；测试 `tests/host/v9-owner.test.mjs:96` A27 | backend | **已落地** | `grep -n "terminalScopes" lib/host/panel.mjs` → `:735`；`node --test tests/host/v9-owner.test.mjs`（含在 338 全量）通过 |
| P4 | 流程规则：「旧构建/旧 bundle」结论必须可复现 | `AGENTS.md:151` §8.1 第 3 条（附命令与原始输出） | lead | **已落地** | `grep -n "旧构建" AGENTS.md` → 命中；本轮已用 `git show 0e81296:lib/client.js` 复现 v8 旧渲染，推翻旧 bundle 假设 |

## status 说明与解除条件

- `status: closed`（2026-10-26）：**P2 技术债登记已落地**（owner: **tester**，登记见 `docs/testing/report.md` §14）；P1/P2/P3/P4 全部落地。
- 解除条件（tester 执行后置 closed）：
  1. `docs/testing/report.md`（或 `docs/testing/acceptance-matrix.md`）新增「技术债」小节/条目，登记：v7 死样式 `.tp-countdown`/`.tp-progress`/`.collapse.in` 与 `tests/client/v7.test.mjs:153` 的锁定关系、计划（v10 删除时同步改 v7 用例或标注 deprecated）；
  2. 在 `tests/client/**` 保留 A24 模板作为「已作废渲染不得出现」通用断言范式（新增废弃项时复制该模板）；
  3. 全量回归不回退（`npm run verify` exit 0）。
- 后续升版：architect 在 §0 变更记录沿用「替换/作废清单」格式；任何「页面旧/构建旧」类判断先跑 `git show HEAD:<file> | sed -n '<range>p'` 并贴原始输出。
