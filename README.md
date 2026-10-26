# dsh-terminal-panel · 终端

> DSH（DeepSeek Harness）插件：在会话头部新增「终端」View tab，把 **当前会话 + 子代理 + Agent Team 队友** 的
> bash 前台执行、后台任务（jobs）、持久终端（terminals）输出聚合成**只读**的卡片网格面板（v8）。
>
> 仓库：<https://github.com/xx529/dsh-terminal-panel>

**状态：v0.1.0 代码侧已交付（2026-10-26，v9）** — Host 半端 + Client 半端实现完成、**真机安装与视觉验收待做**（见 [`docs/install.md`](docs/install.md)）。门禁：**338 tests / 338 pass / 0 fail / 0 skip / 0 todo；smoke 91/91；`npm run verify` exit 0**（tester T46 最终报告）。**v7 真机反馈 5 项已代码侧修复**（见下方「真机反馈修复（v7）」），真机复验待做。

| 门 | 结果 | 命令 |
|---|---|---|
| 语法自检 | 通过 | `npm run check` |
| 单测 | **338 tests / 338 pass / 0 fail / 0 skip / 0 todo**（`node:test` 零依赖；tester T46 最终报告） | `npm test` |
| Host mock 冒烟 | **PASS — 91/91 checks passed**，exit 0 | `npm run smoke` |
| 一键全验 | check → test → smoke，**exit 0** | `npm run verify` |
| 契约 | **v9**（可达性/视觉 + host terminal owner 解析） | [`docs/architecture/contract.md`](docs/architecture/contract.md) |

> T6 集成审计（commit `ad39516`）：**无 CRITICAL**；HIGH **H1**（Tier2 单 Run livelock）与 MEDIUM **M2**（选择集错配）已由 backend 修复（commit `4bc721e`，含 R1/R2 回归），M1（菜单两项）已裁决不做；LOW L1–L5 见 contract §12.10。

## 真机反馈修复（v7，代码侧已修 / 真机复验待做）

2026-10-26 用户真机反馈驱动（5 项缺陷 + scout 补充 2 项显示/状态），Lead 裁决契约 v6→v7（Host = T31，Client = T32）：

| # | 缺陷 | 修复（代码侧） |
|---|---|---|
| 1 | 轮次里有 `terminal_open/send/read`，面板「终端」恒 0 条 | Host **发现链路（v7 纠偏）**：`terminals.list(agent)`（agent PTY）→ `tools/execute` 事件兜底（默认有效）；`terminalController`（侧栏终端注册表）默认关闭、开启时标 `sidebar` 且不与 agent PTY 混排；agent 缺失不再删 Run（`meta-only` + `notice` + tier3 片段），`PollResult.diagnostics` 每帧可查 |
| 2 | 界面每 250ms 跳动 | 入场动画只首挂载播放；工具栏单行不换行；面板填满高度（运行列固定 + 已完成区自适应滚动）；倒计时徽标固定占位；跟随滚动只用容器 `scrollTop`（禁 `scrollIntoView`） |
| 3 | 标题只看得到半截命令 | 标题只显示命令**第一条非空行**（折叠空白、超长 `…`、多行 ` +N 行`），完整命令在 `title` 与输出面板 |
| 3b | 输出区看不到输入 | 输出区顶部新增**输入块**：bash/job 完整 `command`（`$ ` 前缀）；terminal `$ name` + `inputs`（`› ` 前缀）+ 分隔线；空输出仍显示；`notice` 提示行在输入块上方 |
| 4 | 命令结束立刻收起、收起后还在倒计时 | 终态后**先展开 + 倒计时 10s，到点才折叠**（`expanded:false` 且 `deadline:null`），折叠后不再显示倒计时/进度条；新增 `collapseVisual` 纯函数 |
| 5 | 终端 tab 仍显示会话输入框 | 终端 tab 激活时隐藏 composer（优先官方能力；否则 `[data-conversation-content]` + `data-tp-composer-hidden` + CSS 隐藏 `[data-composer-seat]`，找不到锚点静默降级）；失败不影响其它 tab，卸载幂等恢复 |
| 6 | 行内 agent/会话名显示 sessionId 长串 | 显示名按 `sessionTitle → sessions 标题 → team/subagent 名称 → 「当前会话」` 取，空值 `—`；rootAgent 缺失仍能列出队友（`Agent` 无 `name` 字段） |
| 7 | meta-only 列误导（看起来在运行） | 必须显示 `notice` 降级提示、**不显示「运行中」动画**；tier3 片段标注「非实时全量」 |

> 说明：以上为**代码侧修复**；真机复验清单见 `docs/design/ui-spec.md` v5 §9 的 A1–A13（A7–A13 含 manual 项），**不得据此宣称已真机验收**。

## 展示层 v8（真机反馈修复，代码侧已修 / 真机复验待做）

2026-10-26 展示层重构（契约 v8 / ui-spec v6；Host 协议不变）：

| # | 变更 | 说明 |
|---|---|---|
| 1 | **执行区网格** | 固定宽卡片（默认 352，可拖 280–640）自动换行 + 整体纵向滚动；**横向滑动/横向滚动条/右侧 `›` 溢出按钮作废**（取代 v5 横向列） |
| 2 | **Run 三态** | `running → linger`（终态后滞留 10s：倒计时 + 「收起」按钮，hover/focus 暂停）` → completed`（移入已完成分组）；**v7「新终态自动展开分组」删除（替换）** |
| 3 | **会话状态缓存** | 模块级 `SESSION_CACHE`（LRU 4 / TTL 30min）保存 `{view,cursors,revision,savedAt}`；切 tab 回**首屏不空**、游标续传；`retryToken` 变化不清 view |
| 4 | **动画 + 加载态** | 离开执行区 fade+scale ≈180ms + 其余卡片 FLIP 200ms（仅 transform/opacity，`prefers-reduced-motion` 瞬时）；首帧前 skeleton，**loading ≠ 空态**（避免 job-only 抖动） |
| 5 | **Host 一致性补丁** | `panel.poll {resync:true}` 全量重同步（不发 removed）；`removed`/`runs` 同帧互斥（runs 优先，`prune(protect)` 防 job 抖动）；`revision` 回退=服务端重建 → 清 view + resync（不再冻住） |

> 以上为**代码侧修复**；真机复验清单见 `docs/design/ui-spec.md` v6 §9 A14–A22（均含 manual/Unverified），**不得据此宣称已真机验收**。

## 可达性 / 视觉 v9（真机修复，代码侧已修 / 真机复验待做）

2026-10-26 真机反馈驱动的可达性与视觉修订（契约 v9 / ui-spec v7）：

| # | 变更 | 说明 |
|---|---|---|
| 1 | **已完成行独立展开** | 展开由 `view.group.expandedIds` 布尔集合驱动，行头/组头均可点击；已完成行**不再渲染** 10s 倒计时/进度条（样式/词典暂留，测试兼容；修复「点不开 + 仍显示 10s 后收起」） |
| 2 | **执行区按行铺满** | CSS flex：`.tp-cell{flex:1 1 var(--tp-card-w,352px);min-width:min(280px,100%);max-width:100%}`，基准 352、拖右缘 280–640、窄容器单列，**无横向滚动**；不计算列数/不做 resize 重算；取代 v8 固定 352 自动换行 |
| 3 | **状态色板** | 进行中黄、已完成绿、失败红（`--dsw-alias-state-{warn,success,error}-primary`）；hover/focus 不改布局尺寸 |
| 4 | **树外 owner terminal 可 live** | tier1 Agent 解析范围扩为 `scopes ∪ terminal ownerSessionId`；树外 owner 命中 live 即读实时输出并清 `notice`（未命中仍 meta-only 可见） |
| 5 | **诊断扩展** | `diagnostics` 增 `agentsService` / `agentsProbe{getOk,sampleIds}` / `terminalOwners{captured,alive,inScope,outOfScope}`，便于真机定位 |

> 以上为**代码侧修复**；真机复验清单见 `docs/design/ui-spec.md` v7 §9 A23–A28（均含 manual/Unverified），**不得据此宣称已真机验收**。

## 快速验证

```bash
npm run check     # node --check lib/index.js && node --check lib/client.js
npm test          # node --test "tests/**/*.test.mjs"（338 用例）
npm run smoke     # node scripts/smoke-host.mjs（91 checks，exit 0）
# 或一次跑完：
npm run verify
```

> 本仓库**不安装依赖**（宿主包由 DSH profile 提供；Node 22.19+）。测试与冒烟均离线可跑。

## 安装 / 发布

一键脚本（推送 + 安装进 DSH profile；先 `--dry-run` 看计划，不改任何文件）：

```bash
./deploy/publish-and-install.sh --dry-run
./deploy/publish-and-install.sh --timeout 300   # 安装阶段联网 pnpm 默认 120s 超时，超时 exit 6；优先离线
```

`--timeout <秒>`（默认 **120**，范围 **10–3600**）覆盖 `dsh plugin add/install` 与 `pnpm install` 调用（安装与回滚同路径）；无 GNU `timeout` 时依次降级 `gtimeout` → `perl alarm`，超时统一 **exit 6**（shell 可能打印一行 `Alarm clock: 14`，属正常）。完整选项/回滚见 [`docs/install.md`](docs/install.md) §1.3。

## 链接

- 设计规格（v7，验收基线）：[`docs/design/ui-spec.md`](docs/design/ui-spec.md)
- 设计图（A–F 六板）：[`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`](.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/)
- Figma 原型恢复指南：[`docs/design/figma-restore.md`](docs/design/figma-restore.md)（本地可导入资产见 [`docs/design/figma-export/`](docs/design/figma-export/)）
- 架构与接口契约（v9）：[`docs/architecture/contract.md`](docs/architecture/contract.md)
- 验收矩阵：[`docs/testing/acceptance-matrix.md`](docs/testing/acceptance-matrix.md)
- 测试报告（T5 基线 236；v9 回归后 338，tester T46 最终报告）：[`docs/testing/report.md`](docs/testing/report.md)
- 集成报告（T6，已完成）：[`docs/testing/integration-report.md`](docs/testing/integration-report.md)（commit `ad39516`；H1/M2 已修复于 `4bc721e`）
- 取证报告（scout T1）：[`docs/research/dsh-plugin-apis.md`](docs/research/dsh-plugin-apis.md)
- 安装 / 生效 / 验证 / 回滚：[`docs/install.md`](docs/install.md)
- 复盘（T4 结构性调整）：[`docs/retro/2026-10-26-bash-live-source.md`](docs/retro/2026-10-26-bash-live-source.md)
- 许可证：[`LICENSE`](LICENSE)（MIT）
- 项目级 agent 指引见 [`AGENTS.md`](AGENTS.md)；一键发布+安装见 [`deploy/publish-and-install.sh`](deploy/publish-and-install.sh)。

## 功能一览（验收基线 = ui-spec v5 + 本 README「已知限制」）

| 能力 | 说明 |
|---|---|
| 集成方式 | 客户端 Slot `conversation.view`（`id: terminal-panel`，`order: 30`），复用内建 tab 样式，不自绘 tab |
| 进行中列表 | 每个 Run 一列，横向排列；超出左右滚动（滚动条 + `›` + 剩余数角标） |
| 列宽 | 默认 352，可拖 280–640，双击右缘复位，按会话记忆 |
| agent 归属 | 列头 `类型标签 + agent chip`；子代理蓝、队友琥珀、当前会话无竖条 |
| 已完成 | 32px 紧凑行，分组默认折叠；展开由 `expandedIds` 驱动（无倒计时/进度条，样式暂留测试兼容） |
| 跟随 | 默认贴底；输出区滚轮只滚自身；上翻暂停并提示「N 条新输出 ↓」，回底自动恢复 |
| 筛选 | 类型 chips（带全局计数）+ 会话范围多选（默认全部会话）+ 命令/输出即时搜索 |
| 最大化 | `⤢` 打开 980×600 只读弹窗（Esc/✕ 关闭，可停止/复制全部） |
| 只读 | 不注入键盘、不 `startSend`；唯一的写操作是「停止」（两击确认） |
| 数据源 | 后台任务 `ctx.jobs`（增量）、持久终端**三级发现**（`terminals.list` → `terminalController.list` → `tools/execute` 事件；无 Agent 时 meta-only + notice）、前台 bash `tools/execute` + `tools/result`（终态） |

## 已知限制（已裁决，见 contract §12 + v4/v5 附录）

1. **Tab 没有角标**：内建 tab 渲染只读 `label`，无 badge API。运行中数量显示在面板工具栏（「N 个进行中 · M 条记录 · K 个会话」）。
2. **持久终端不是 xterm 屏幕帧**：平台模块表不含 xterm 且禁止装依赖 → 终端以「剥离 ANSI 的等宽文本流」呈现；**全屏 TUI（vim / htop / less）会退化为文本流**，不是屏幕重绘。
3. **前台 bash 过程输出不可得（final-only）**：第三方拿不到 `ShellExecution` 句柄，该类 Run 标「仅终态」、停止按钮禁用；`availability.bashLive` 需真机安装后确认（mock 环境下 tee 不可用属预期）。需要实时输出时请让 agent 用后台 job（`ctx.jobs` 天然增量）。
4. **默认会话范围 = 全部会话**（ui-spec §4 与 A 板冲突，按 A 板裁决）。
5. **插件不接管输入**：不向 PTY 写任何输入；唯一写操作是用户点「停止」。
6. **跨会话聚合待真机验证**（scout U6）：服务语义允许按 owner 围栏读取，本机未实测；失败时按来源降级（chip 置灰 + 原因），不影响面板主体。
7. **`⋯` 菜单只有 3 项**（复制命令 / 复制输出 / 固定展开）：ui-spec §3.7 的「在对话中定位」「在终端中打开（仅终端）」**本期不做**（Run 契约无 `turn/message` 引用；插件不接管宿主终端面板），替代见 contract §12.8。已知差异 L1–L5 见 contract §12.10。
8. **非 live root 会话降级**：传入的 sessionId 无 live Agent 时返回**降级帧**（ok:true、树仅 root、`availability.tree.available=false`、空 runs），不是 `session-not-found`（仅语法非法才 coded 错误；contract v4 附录）。
9. **terminal 的 `truncated`** 表示「该会话输出未完整覆盖（scrollback 裁剪或窗口未及最旧行）」，**不是分页未取完**；client 不得据此循环翻页（contract v4 附录）。
10. **terminal 无 Agent 时只能看元信息（v7）**：默认走 `tools/execute` 事件兜底（`terminalController` 是侧栏终端注册表、默认关闭），`outputMode:'meta-only'` + `notice`，读不到连续实时输出（tier3 片段非全量）、停止不可用；但**不再静默 0 条**（诊断字段见 contract §7.2）。
11. **composer 隐藏是 best-effort（v7）**：优先官方能力，否则 `[data-conversation-content]` 标记 + CSS（找不到锚点才 body 兜底/静默降级）；宿主 DOM 变更可能失效（其它 tab 不受影响）。
12. **v7 真机 5 项修复仅代码侧完成，真机复验待做**；ui-spec §9 的 A1–A13 为验收条目（部分 manual）。
14. **v9 行为变更（不是缺陷）**：已完成行独立展开且无倒计时；执行区按行铺满；状态色黄/绿/红；树外 owner terminal 可升级 live。
15. **v8 行为变更（不是缺陷）**：横向滑动/溢出按钮已废弃（改网格换行）；终态不再自动展开已完成分组（改 linger 10s + 收起按钮）；切 tab 依赖 LRU 4/TTL 30min 会话缓存（第 5 个会话不保证首屏不空）。terminal 可见性只对**部署后新发生**的 `terminal_*` 判定（历史/已卸载 owner 的 pty 不可回读，不计缺陷）。

## 目录结构

```
.
├── LICENSE                      # MIT（2026，xx529）
├── package.json                 # 双端 bundle 清单（dsh.bundle.patch + dsh.client + manifestVersion）+ 脚本
├── cordis.patch.yml             # Host 行走线（- insert: { id: terminal-panel, name: dsh-terminal-panel }）
├── icon.svg                     # Plugin Manager 图标（原创终端字形，16/24px 可读）
├── locale/{zh,en}.json          # Plugin Manager 展示元数据（meta.title / meta.description）
├── docs/
│   ├── design/ui-spec.md        # v7 设计规格（验收基线 + A1–A28）
│   ├── architecture/contract.md # 双端契约（v9）
│   ├── research/dsh-plugin-apis.md # scout T1 取证（契约事实来源）
│   ├── research/terminal-panel-followup-2026-10-26.md # v7 真机缺陷取证（若存在）
│   ├── testing/acceptance-matrix.md # 验收矩阵
│   ├── testing/report.md        # 测试报告（T5 基线 236 → v9 338，覆盖说明）
│   ├── testing/integration-report.md # 集成报告（T6，已完成 ad39516）
│   ├── retro/2026-10-26-bash-live-source.md # T4 触发复盘（closed）
│   └── install.md               # 安装 / 生效 / 验证 / 回滚（证据版）
├── lib/
│   ├── index.js                 # [backend] Host 半端入口（ESM）
│   ├── host/*.mjs               # [backend] 采集器 + 纯逻辑（13 个模块，node:test 直接 import）
│   ├── client.js                # [frontend] Client 半端（单文件 classic script，≈3,000 行）
│   └── client/**                # [frontend] 可选纯函数（不 import React）
├── scripts/smoke-host.mjs       # [backend] mock ctx 冒烟（91 checks）
└── tests/                       # [tester] *.test.mjs（host / client / e2e）+ helpers
```

## 许可

MIT License，Copyright (c) 2026 **xx529** — 全文见 [`LICENSE`](LICENSE)。
