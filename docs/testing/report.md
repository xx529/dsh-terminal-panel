# 终端面板 · 测试报告（task-5）

> 日期：2026-10-26
> 角色：tester（独立验证者，未修改任何生产代码）
> 基线：`docs/design/ui-spec.md` v4 + `docs/architecture/contract.md`（v1 + v2 冻结清单，backend commit `e74894e`）
> 验收基线映射：`docs/testing/acceptance-matrix.md`
> 写作用域：本报告与 `tests/**` 只由 tester 维护；`lib/**` 的任何改动都来自 backend/frontend。

## 1. 结论

| 项 | 结果 |
|---|---|
| `node --test`（全量单测） | **PASS** — 236/236 pass，0 fail，0 skip，**exit 0** |
| `node tests/e2e/smoke.mjs`（独立 e2e 冒烟） | **PASS** — 17/17 断言通过，3 帧轮询序列，**exit 0** |
| 契约 §11 出口面 | 20 函数 + 4 常量 + 附加辅助全部存在（`client/internals-export.test.mjs`） |
| tester 发现的生产缺陷 | 3 个已报出：2 个 HIGH、1 个 LOW；**均已由实现方修复**，回归用例现全绿（见 §5） |
| 待 v2 裁决的契约/实现不一致 | 5 项（见 §6），不阻塞当前实现，但建议 architect 在 v2 落字 |
| 阻塞项 | 无 |

**task-5 done-when 核对**：`node --test` 全绿（236 pass / exit 0）✅；验收矩阵每行都指向具体用例名或人工验收步骤 ✅；报告记录命令/退出码/计数/跳过项/不可自动化项 ✅。

## 2. 执行环境

| 项 | 值 |
|---|---|
| Node | `v22.22.2`（`process.version`） |
| 包管理器 | 未使用；**未执行 `pnpm install`，未安装任何依赖** |
| 网络 | 测试全程离线；无 `fetch`/HTTP 请求 |
| React | 由 `tests/helpers/react-stub.mjs` 提供极简 stub（`factory(require)` 只允许 `'react'`） |
| 宿主 | 无 DSH 运行时；host 服务全部用 `tests/helpers/fakes.mjs` 的 mock ctx / 假 ShellExecution |

## 3. 执行命令、退出码与计数

```bash
# 全量（推荐；默认发现 tests/**/*.test.mjs）
node --test
# → # tests 236 / # pass 236 / # fail 0 / # skipped 0 ; exit 0

# 端到端冒烟（独立脚本，也可被 node --test 通过 smoke.test.mjs 纳入）
node tests/e2e/smoke.mjs
# → E2E SMOKE: 17 项断言全部通过（3 帧轮询序列）；exit 0
```

### 3.1 ⚠ Node 版本注意：`package.json` 的 `test` 脚本在本机不可用

`package.json` 现为 `"test": "node --test tests/"`，在 **Node v22.22.2** 下会报：

```
Error: Cannot find module '.../tests'
  code: 'MODULE_NOT_FOUND'
exit 1
```

即显式传入目录会被当作模块入口执行，而不会递归发现测试文件。**可用替代**：

```bash
node --test                     # 默认发现（已验证 exit 0）
node --test "tests/**/*.test.mjs"   # 显式 glob（已验证 exit 0）
```

建议 architect 把 `scripts.test` 改为 `node --test` 或 glob（属 architect 写作用域，tester 未改）。

### 3.2 用例分布（每文件独立跑，均 exit 0）

| 文件 | tests | pass | fail | skip |
|---|---|---|---|---|
| `tests/host/assembly.test.mjs` | 12 | 12 | 0 | 0 |
| `tests/host/classify.test.mjs` | 20 | 20 | 0 | 0 |
| `tests/host/cursors.test.mjs` | 13 | 13 | 0 | 0 |
| `tests/host/frame.test.mjs` | 13 | 13 | 0 | 0 |
| `tests/host/panel.test.mjs` | 11 | 11 | 0 | 0 |
| `tests/host/status.test.mjs` | 17 | 17 | 0 | 0 |
| `tests/host/terminal-window.test.mjs` | 28 | 28 | 0 | 0 |
| `tests/host/tree.test.mjs` | 11 | 11 | 0 | 0 |
| `tests/client/assembly.test.mjs` | 6 | 6 | 0 | 0 |
| `tests/client/collapse.test.mjs` | 12 | 12 | 0 | 0 |
| `tests/client/defaults.test.mjs` | 6 | 6 | 0 | 0 |
| `tests/client/filter.test.mjs` | 17 | 17 | 0 | 0 |
| `tests/client/follow.test.mjs` | 10 | 10 | 0 | 0 |
| `tests/client/format.test.mjs` | 18 | 18 | 0 | 0 |
| `tests/client/internals-export.test.mjs` | 3 | 3 | 0 | 0 |
| `tests/client/layout.test.mjs` | 19 | 19 | 0 | 0 |
| `tests/client/merge-poll.test.mjs` | 13 | 13 | 0 | 0 |
| `tests/client/static-style.test.mjs` | 6 | 6 | 0 | 0 |
| `tests/e2e/smoke.test.mjs` | 1 | 1 | 0 | 0 |
| **合计** | **236** | **236** | **0** | **0** |

## 4. 跳过项与原因（当前 0 skip；记录历史阶段）

最终一轮 **没有任何 skip**。开发过程中曾有 skip，全部已随实现就绪自动转绿；机制保留以便后续回归：

| skip 机制 | 位置 | 触发条件 | 当前状态 |
|---|---|---|---|
| lib 模块缺失 | `tests/helpers/host-modules.mjs::gate`、`tests/helpers/load-client.mjs::clientGate` | `lib/host/*.mjs` / `lib/client.js` 不存在 | 已全部落地，0 skip |
| lib 存在但坏掉 | 同上（`missing:false` 分支） | 导入/工厂抛错、`__internals` 缺失 | 设计为 **fail 而非 skip**（真实契约违例不得静默） |
| panel 采集器未接入 | `tests/host/panel.test.mjs::probeCollectors` | `panel.poll` 返回空 runs（batch1） | backend batch2 已接入，0 skip |
| e2e 依赖未就绪 | `tests/e2e/smoke.mjs` | host/client 模块缺失时打印 `SKIP` 并 exit 0 | 当前全量执行，17/17 通过 |

## 5. tester 发现的生产缺陷（已报 Lead/backend，均已修复并有回归用例）

> 以下缺陷由 tester 在实现中途发现；tester **未修改 lib/**，修复均来自实现方（backend/frontend）。

| # | 严重度 | 位置 | 现象 | 复现用例 | 修复验证 |
|---|---|---|---|---|---|
| 1 | HIGH | `lib/host/terminal-window.mjs`（旧 `stripTailOverlap`/`computeTerminalDelta`） | 终端增量丢行边界：`'a\nb\nc' + 'd'` → `'a\nb\ncd'`（两行粘连），文本流语义错误 | `host/terminal-window.test.mjs::computeTerminalDelta: delta 尾页重叠 → 剥重叠并保留行边界换行（不粘行）`、`plan/apply 组合：首见 → probe → 新增行…` | backend commit `e74894e` 修复；用例现 PASS（另有空行/多行场景覆盖） |
| 2 | HIGH | `lib/client.js::mergeRun`（约 449 行） | `run.status` 被帧状态无条件覆盖，违反 contract §6.1「终态单调」：已完成任务可被后续帧打回 running | `client/merge-poll.test.mjs::mergePoll: 终态单调，不会被后续帧降级回 running（§6.1）` | frontend 已改为终态后忽略 status 变更（`lib/client.js:793` 注释与实现）；用例 PASS |
| 3 | LOW | `lib/host/frame.mjs::boundFrame`（旧实现） | 1 字节边界：candidate 因 `truncated:true` 少 1 字节而提前 break，返回帧实际超预算 1 字节且 `truncated=false` | `host/frame.test.mjs::boundFrame: 预算边界（=帧体积不丢 / 少 1 字节丢尾部 run）` | backend 改为按“最终返回帧体积”精确判定，并拆出 `boundFrameDetailed`；用例 PASS |

过程中另有 2 次测试自身的夹具/桩缺陷（非生产缺陷），已修：DOM stub 缺 `parentNode.removeChild`；`makeChannelDelta` 未提供客户端本地累积 `text` 字段。

## 6. 契约与实现不一致（待 architect v2 落字，不阻塞）

| # | 主题 | 契约 v1 表述 | 实际实现（backend/frontend 冻结语义） | tester 处理 | 建议 |
|---|---|---|---|---|---|
| C1 | 非 live root 会话 | §4.4/§13.1：`ctx.agents.get(sessionId)` 无 live Agent → `session-not-found` | batch2 返回**降级帧**（ok:true；`availability.tree={available:false, code:'denied'}`、仅 root 作用域、空 runs） | 用例接受两种行为并断言降级帧的关键不变量 | v2 明确选降级帧（错误码保留给极端情况）或恢复错误 |
| C2 | terminal `truncated` 语义 | §4.3：`truncated` = 本次没发完（可续读） | 冻结实现：`truncated = page.truncated || lineEnd < totalLines` —— 即“窗口未覆盖最旧行”，正常 delta 也会 true | 用例编码冻结语义并在同文件注明；补充「覆盖到最旧行时 false」 | v2 改写 §4.3 措辞（terminal 专用语义），或拆 `historyTruncated` 字段 |
| C3 | `removed` 的本地保留 | §4.2 语义 5：removed 的 run 在已完成区保留 5 分钟；§11.2：removed **删除** run 与 column（自相矛盾） | mergePoll 按 §11.2 立即删除，5 分钟保留用于“服务端仍保留但已终态”的记录 | 用例按 §11.2 断言 | v2 明确两套语义各自的触发条件 |
| C4 | 帧预算口径 | §4.3：输出文本预算（不含 JSON 元信息 ≤8 KiB） | `buildPollFrame`=输出文本预算；`boundFrame`=**整帧 JSON 体积**兜底（两套口径） | 用例按“预算边界中立”断言（各自边界内不超限） | v2 说明 boundFrame 是最后兜底且口径为整帧 |
| C5 | `conversation.view` inject props | v1 §13.2：`inject:(sessionId)=>({t,sessionId})` | v2 F28：inject 返回 `{}`，保留 props 由 renderer 以 owner props 注入且优先级最高 | 用例改为断言「inject 返回对象且不覆盖保留名」 | v2 已含 F28；本报告记录以提示 T6 审计 |

此外：`availability` 新增 `bashLive` 字段（契约 v1 §8 只有 bash/jobs/terminals/tree）。用例未断言字段全集，不构成破坏；v2 应补文档（对应「前台 bash 过程输出不可得」的限制）。

## 7. 已知不可自动化的验收项（必须人工在真实 DSH 页面执行）

以下项目已在 `acceptance-matrix.md` 标为 `manual` / `manual+限制`，并附可操作步骤与对应 Figma 板号。摘要：

1. **视觉与像素级布局**（列 352×342、已完成 32px、弹窗 980×600、主题 D 板、进度条 2px、1px 失败红边）——无 DOM 渲染环境。
2. **指针/键盘交互**（列宽拖拽 + 双击复位、滚轮隔离、停止两击 3s、Tab/Enter/Shift+Enter/Esc、`⋯` 菜单 5 项、清空撤销 3s）。
3. **宿主集成行为**（tab 只在内建 tab 行出现、blank session 不渲染、视图选择按会话持久化、tab 角标裁决不实现）。
4. **平台限制项**（`manual+限制`）：前台 bash 过程输出不可得 → 只验收终态 + 「仅终态」徽标；全屏 TUI 退化为文本流。
5. **网络/权限异常**（断网横幅与恢复、401 blocked 横幅、页面隐藏停轮询）。
6. **性能**（rAF 合帧、>60 条已完成虚拟化只渲染可视 ±10 行）——需真实浏览器 Performance 面板。

## 8. 已知产品限制（实现/设计共同确认，验收按降级预期）

| 限制 | 依据 | 验收预期 |
|---|---|---|
| 前台 bash 无实时过程输出（`detail:'final-only'`，client 显示「仅终态」徽标） | 平台限制；Lead 2026-10-26 核实 | 验收终态输出 + 徽标，不验收实时流（矩阵 D5-1） |
| 持久终端为纯文本 tail（非 xterm 屏幕帧） | 禁装依赖 + client 单文件（contract §12.2） | 文本可读、ANSI 剥离；TUI 退化为流（矩阵 D5-4） |
| 无 tab 角标 | 内建 tab 渲染器无 badge 入参（§12.1，Lead 裁决） | 计数在工具栏（矩阵 R4） |
| 插件 icon/locale 元数据 v1 未交付 | 不在写作用域；T7 补 | Plugin Manager 先显示包名兜底（矩阵 §10） |
| 默认会话范围“全部”（与 ui-spec §4 正文“当前会话默认”冲突） | §12.3 取 A 板 / v2 §1.5 | 默认全部；常量一处可改（矩阵 F4-3） |

## 9. 测试资产清单

```
tests/
├── helpers/                    # 测试基础设施（非测试文件，不被 node --test 发现为用例）
│   ├── paths.mjs               # 仓库/lib 路径
│   ├── host-modules.mjs        # host 纯模块加载 + missing/error 分流 gate
│   ├── load-client.mjs         # classic-script factory 捕获 + require stub + __internals 取值
│   ├── react-stub.mjs          # React 极简 stub（只允许 require('react')）
│   ├── fakes.mjs               # 假 ShellExecution/jobs/terminals/ctx/webServer/req/res
│   └── fixtures.mjs            # §5 数据模型夹具（Run/ChannelDelta/PollResult/ViewState）
├── host/                       # 契约 §11.1 纯逻辑：classify/status/cursors/tree/frame/terminal-window/panel/assembly
├── client/                     # 契约 §11.2/§11.3：22+ 出口面、筛选、跟随、收起、格式化、mergePoll、装配、静态样式
└── e2e/
    ├── smoke.mjs               # 独立冒烟：host 纯逻辑 + 模拟轮询 → mergePoll → 最终视图帧
    └── smoke.test.mjs          # node:test 包装（纳入质量门）
```

## 10. 复跑与移交 T6

- 复跑：`node --test`（exit 0）与 `node tests/e2e/smoke.mjs`（exit 0）；改动 `lib/**` 后必须两者都跑。
- T6（集成验证与契约一致性审计）建议重点：
  1. 复核 §6 的 C1–C5 是否已在 contract v2 落字；
  2. 用真实 DSH 页面跑矩阵中 manual 项 + Network 面板确认 `fetch` 路径/401/404 行为；
  3. `node --check lib/**/*.js`、`node --check lib/host/*.mjs`；确认 `scripts/smoke-host.mjs` exit 0（backend 自报 65/65，tester 未参与其断言设计）；
  4. 检查 `lib/index.js` 的 `apply` 在宿主缺 `webServer/connection` 时的激活/回滚行为（矩阵 §9 manual）；
  5. 校验 §6 C5（inject 保留 props）在真实渲染器中确由 owner props 覆盖。
