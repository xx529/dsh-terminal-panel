# dsh-terminal-panel · 终端

> DSH（DeepSeek Harness）插件：在会话头部新增「终端」View tab，把 **当前会话 + 子代理 + Agent Team 队友** 的
> bash 前台执行、后台任务（jobs）、持久终端（terminals）输出聚合成**只读**的横向列面板。

**状态：v0.1.0 交付候选（2026-10-26）** — 实现完成（Host 半端 + Client 半端）、`236` 条单测与 `72/72` mock 冒烟通过；**真机安装与视觉验收待做**（见 [`docs/install.md`](docs/install.md)）。

| 门 | 结果 | 命令 |
|---|---|---|
| 语法自检 | 通过 | `npm run check` |
| 单测 | **236 pass / 0 fail**（19 个测试文件，`node:test`，零依赖） | `npm test` |
| Host mock 冒烟 | **72/72 checks passed，exit 0** | `npm run smoke` |
| 一键全验 | check → test → smoke | `npm run verify` |

> T6 集成审计（commit `ad39516`）：**无 CRITICAL**；1 HIGH **H1**（Tier2 单 Run 超限 livelock，backend task-12 修复中）+ M1（菜单两项裁决不做）/M2（选择集一致）已裁决/排期；LOW L1–L5 见 contract §12.10。

## 快速验证

```bash
npm run check     # node --check lib/index.js && node --check lib/client.js
npm test          # node --test "tests/**/*.test.mjs"（236 用例）
npm run smoke     # node scripts/smoke-host.mjs（72 checks，exit 0）
# 或一次跑完：
npm run verify
```

> 本仓库**不安装依赖**（宿主包由 DSH profile 提供；Node 22.19+）。测试与冒烟均离线可跑。

## 链接

- 设计规格（v4，验收基线）：[`docs/design/ui-spec.md`](docs/design/ui-spec.md)
- 设计图（A–F 六板）：[`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`](.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/)
- 架构与接口契约：[`docs/architecture/contract.md`](docs/architecture/contract.md)（v4.1：v3 冻结 + v4 附录 + T6 H1/M1/M2 落字）
- 验收矩阵：[`docs/testing/acceptance-matrix.md`](docs/testing/acceptance-matrix.md)
- 测试报告：[`docs/testing/report.md`](docs/testing/report.md)
- 集成报告（T6）：[`docs/testing/integration-report.md`](docs/testing/integration-report.md)（已完成，commit `ad39516`；结论：无 CRITICAL、1 HIGH（H1 Tier2 livelock，修复中）、M1/M2 MEDIUM 已裁决/排期）
- 取证报告（scout T1）：[`docs/research/dsh-plugin-apis.md`](docs/research/dsh-plugin-apis.md)
- 安装 / 生效 / 验证 / 回滚：[`docs/install.md`](docs/install.md)
- 复盘（T4 结构性调整）：[`docs/retro/2026-10-26-bash-live-source.md`](docs/retro/2026-10-26-bash-live-source.md)

## 功能一览（验收基线 = ui-spec v4 + 本 README「已知限制」）

| 能力 | 说明 |
|---|---|
| 集成方式 | 客户端 Slot `conversation.view`（`id: terminal-panel`，`order: 30`），复用内建 tab 样式，不自绘 tab |
| 进行中列表 | 每个 Run 一列，横向排列；超出左右滚动（滚动条 + `›` + 剩余数角标） |
| 列宽 | 默认 352，可拖 280–640，双击右缘复位，按会话记忆 |
| agent 归属 | 列头 `类型标签 + agent chip`；子代理蓝、队友琥珀、当前会话无竖条 |
| 已完成 | 32px 紧凑行，分组默认折叠，10s 倒计时自动收起（悬停/聚焦暂停，失焦重新计时） |
| 跟随 | 默认贴底；输出区滚轮只滚自身；上翻暂停并提示「N 条新输出 ↓」，回底自动恢复 |
| 筛选 | 类型 chips（带全局计数）+ 会话范围多选（默认全部会话）+ 命令/输出即时搜索 |
| 最大化 | `⤢` 打开 980×600 只读弹窗（Esc/✕ 关闭，可停止/复制全部） |
| 只读 | 不注入键盘、不 `startSend`；唯一的写操作是「停止」（两击确认） |
| 数据源 | 后台任务 `ctx.jobs`（增量）、持久终端 `ctx.terminals.read`（行增量）、前台 bash `tools/execute` + `tools/result`（终态） |

## 已知限制（已裁决，见 contract §12 + v4 附录）

1. **Tab 没有角标**：内建 tab 渲染只读 `label`，无 badge API。运行中数量显示在面板工具栏（「N 个进行中 · M 条记录 · K 个会话」）。
2. **持久终端不是 xterm 屏幕帧**：平台模块表不含 xterm 且禁止装依赖 → 终端以「剥离 ANSI 的等宽文本流」呈现；**全屏 TUI（vim / htop / less）会退化为文本流**，不是屏幕重绘。
3. **前台 bash 过程输出不可得（final-only）**：第三方拿不到 `ShellExecution` 句柄，该类 Run 标「仅终态」、停止按钮禁用；`availability.bashLive` 需真机安装后确认（mock 环境下 tee 不可用属预期）。需要实时输出时请让 agent 用后台 job（`ctx.jobs` 天然增量）。
4. **默认会话范围 = 全部会话**（ui-spec §4 与 A 板冲突，按 A 板裁决）。
5. **插件不接管输入**：不向 PTY 写任何输入；唯一写操作是用户点「停止」。
6. **跨会话聚合待真机验证**（scout U6）：服务语义允许按 owner 围栏读取，本机未实测；失败时按来源降级（chip 置灰 + 原因），不影响面板主体。
7. **`⋯` 菜单只有 3 项**（复制命令 / 复制输出 / 固定展开）：ui-spec §3.7 的「在对话中定位」「在终端中打开（仅终端）」**本期不做**（Run 契约无 `turn/message` 引用；插件不接管宿主终端面板），替代见 contract §12.8。已知差异 L1–L5 见 contract §12.10。
7. **非 live root 会话降级**：传入的 sessionId 无 live Agent 时返回**降级帧**（ok:true、树仅 root、`availability.tree.available=false`、空 runs），不是 `session-not-found`（仅语法非法才 coded 错误；contract v4 附录）。
8. **terminal 的 `truncated`** 表示「该会话输出未完整覆盖（scrollback 裁剪或窗口未及最旧行）」，**不是分页未取完**；client 不得据此循环翻页（contract v4 附录）。

## 目录结构

```
.
├── package.json                 # 双端 bundle 清单（dsh.bundle.patch + dsh.client + manifestVersion）+ 脚本
├── cordis.patch.yml             # Host 行走线（- insert: { id: terminal-panel, name: dsh-terminal-panel }）
├── icon.svg                     # Plugin Manager 图标（原创终端字形，16/24px 可读）
├── locale/{zh,en}.json          # Plugin Manager 展示元数据（meta.title / meta.description）
├── docs/
│   ├── design/ui-spec.md        # v4 设计规格（验收基线）
│   ├── architecture/contract.md # 双端契约（v3 冻结 + v4 附录）
│   ├── research/dsh-plugin-apis.md # scout T1 取证（契约事实来源）
│   ├── testing/acceptance-matrix.md # 验收矩阵
│   ├── testing/report.md        # 测试报告（236 用例 + 覆盖说明）
│   ├── testing/integration-report.md # 集成报告（T6，待生成）
│   ├── retro/2026-10-26-bash-live-source.md # T4 触发复盘
│   └── install.md               # 安装 / 生效 / 验证 / 回滚（证据版）
├── lib/
│   ├── index.js                 # [backend] Host 半端入口（ESM）
│   ├── host/*.mjs               # [backend] 采集器 + 纯逻辑（12 个模块，node:test 直接 import）
│   ├── client.js                # [frontend] Client 半端（单文件 classic script，≈2,795 行）
│   └── client/**                # [frontend] 可选纯函数（不 import React）
├── scripts/smoke-host.mjs       # [backend] mock ctx 冒烟（72 checks）
└── tests/                       # [tester] 19 个 *.test.mjs（host / client / e2e）+ helpers
```

## 许可

MIT（`license` 字段已声明；`LICENSE` 文件待补）。
