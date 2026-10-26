# dsh-terminal-panel · 终端

> DSH（DeepSeek Harness）插件：在会话头部新增「终端」View tab，把 **当前会话 + 子代理 + Agent Team 队友** 的
> bash 前台执行、后台任务（jobs）、持久终端（terminals）输出聚合成**只读**的横向列面板。

**状态：v2 契约定稿（2026-10-26）** — 契约已吸收 scout T1 全部取证结论；`lib/**` 由 backend / frontend 并行实现，尚未安装到 profile。

- 设计规格（v4）：[`docs/design/ui-spec.md`](docs/design/ui-spec.md)
- 设计图（A–F 六板）：[`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`](.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/)
- 架构与接口契约（v2）：[`docs/architecture/contract.md`](docs/architecture/contract.md)
- 验收矩阵（正式版）：[`docs/testing/acceptance-matrix.md`](docs/testing/acceptance-matrix.md)
- 取证报告（T1，v2 依据）：[`docs/research/dsh-plugin-apis.md`](docs/research/dsh-plugin-apis.md)
- 安装 / 生效 / 验证 / 回滚：[`docs/install.md`](docs/install.md)

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

## 已知限制（已裁决，见 contract §12）

1. **Tab 没有角标**：内建 tab 渲染只读 `label`，无 badge API。运行中数量显示在面板工具栏（「N 个进行中 · M 条记录 · K 个会话」）。
2. **持久终端不是 xterm 屏幕帧**：平台模块表不含 xterm 且禁止装依赖 → 终端以「剥离 ANSI 的等宽文本流」呈现；**全屏 TUI（vim / htop / less）会退化为文本流**，不是屏幕重绘。
3. **前台 bash 只有终态输出**：第三方拿不到 `ShellExecution` 句柄，过程输出不可得；该类 Run 标「仅终态」，停止按钮禁用。需要实时输出时请让 agent 用后台 job（走 `ctx.jobs`，天然增量）。
4. **默认会话范围 = 全部会话**（ui-spec §4 与 A 板冲突，按 A 板裁决）。
5. **插件不接管输入**：不向 PTY 写任何输入；唯一写操作是用户点「停止」。
6. **跨会话聚合待真机验证**（scout U6）：服务语义允许按 owner 围栏读取，但本机未实测；失败时按来源降级（chip 置灰 + 原因），不影响面板主体。

## 目录结构

```
.
├── package.json                 # 双端 bundle 清单（dsh.bundle.patch + dsh.client + manifestVersion）
├── cordis.patch.yml             # Host 行走线（- insert: { id: terminal-panel, name: dsh-terminal-panel }）
├── icon.svg                     # Plugin Manager 图标（原创终端字形，16/24px 可读）
├── locale/{zh,en}.json          # Plugin Manager 展示元数据（meta.title / meta.description）
├── docs/
│   ├── design/ui-spec.md        # v4 设计规格（验收基线）
│   ├── architecture/contract.md # v2 双端契约（host / client 照此实现）
│   ├── research/dsh-plugin-apis.md # scout T1 取证（契约事实来源）
│   ├── testing/acceptance-matrix.md # tester 验收矩阵（正式版）
│   └── install.md               # 安装 / 生效 / 验证 / 回滚（证据版）
├── lib/
│   ├── index.js                 # [backend] Host 半端入口
│   ├── host/**                  # [backend] 采集器 + 纯逻辑（.mjs，可被 node:test 直接 import）
│   ├── client.js                # [frontend] Client 半端（单文件 classic script）
│   └── client/**                # [frontend] 可选纯函数（不 import React）
├── scripts/smoke-host.mjs       # [backend] mock ctx 冒烟
└── tests/                       # [tester] node:test 单测 + e2e 冒烟
```

## 开发与自检

本仓库**不安装依赖**（宿主包由 DSH profile 提供；Node 22.19+）：

```bash
node --check lib/index.js      # Host 半端语法
node --check lib/client.js     # Client 半端语法
node --test tests/             # tester 单测（不依赖网络 / 不装依赖）
node scripts/smoke-host.mjs    # Host mock 冒烟（退出码 0）
```

安装到本机 DSH profile 见 [`docs/install.md`](docs/install.md)（`plugin_manager` → `install_bundle`，本地目录 = `link:`）。

## 许可

MIT（`license` 字段已声明；`LICENSE` 文件待补）。
