# dsh-terminal-panel · 终端

> DSH（DeepSeek Harness）插件：在会话头部新增「终端」View tab，把 **当前会话 + 子代理 + Agent Team 队友** 的
> bash 前台执行、后台任务（jobs）、持久终端（terminals）的实时输出聚合成**只读**的横向列面板。

**状态：v1 脚手架（2026-10-26）** — 契约已定，`lib/**` 由 backend / frontend 两个任务并行实现，尚未安装到 profile。

- 设计规格（v4）：[`docs/design/ui-spec.md`](docs/design/ui-spec.md)
- 设计图（A–F 六板）：[`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`](.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/)
- 架构与接口契约：[`docs/architecture/contract.md`](docs/architecture/contract.md)
- 安装 / 生效 / 验证 / 回滚：[`docs/install.md`](docs/install.md)

## 功能一览（验收基线见 ui-spec v4）

| 能力 | 说明 |
|---|---|
| 集成方式 | 客户端 Slot `conversation.view`（`id: terminal-panel`，`order: 30`），复用内建 tab 样式，不自绘 tab |
| 进行中列表 | 每个 Run 一列，横向排列；超出左右滚动（滚动条 + `›` + 剩余数角标） |
| 列宽 | 默认 352，可拖 280–640，双击右缘复位，按会话记忆 |
| agent 归属 | 列头 `类型标签 + agent chip`；子代理蓝、队友琥珀、当前会话无竖条 |
| 已完成 | 32px 紧凑行，分组默认折叠，10s 倒计时自动收起（悬停/聚焦暂停，失焦重新计时） |
| 跟随 | 默认贴底；输出区滚轮只滚自身；上翻暂停并提示「N 条新输出 ↓」，回底自动恢复 |
| 筛选 | 类型 chips（带全局计数）+ 会话范围多选 + 命令/输出即时搜索 |
| 最大化 | `⤢` 打开 980×600 只读弹窗（Esc/✕ 关闭，可停止/复制全部） |
| 只读 | 不注入键盘、不 `startSend`；唯一的写操作是「停止」（两击确认） |

## 目录结构

```
.
├── package.json                 # 双端 bundle 清单（dsh.bundle.patch + dsh.client）
├── cordis.patch.yml             # Host 行走线（- insert: { id: terminal-panel, name: dsh-terminal-panel }）
├── docs/
│   ├── design/ui-spec.md        # v4 设计规格（验收基线）
│   ├── architecture/contract.md # 双端接口契约（host / client 照此实现）
│   └── install.md               # 安装 / 生效 / 验证 / 回滚
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

安装到本机 DSH profile 见 [`docs/install.md`](docs/install.md)。

## 已知偏差（v1，详见 contract §12）

1. **Tab 角标做不了**：内建 tab 渲染器只读 `id`/`label`，无 badge 入参 → 运行中计数改放面板工具栏。
2. **持久终端不用 xterm**：禁止安装依赖 + Client 单文件约束 → 终端显示为剥离 ANSI 的等宽文本流。
3. **默认会话范围取「全部」**：ui-spec §4 与 v2 变更记录/A 板自相矛盾，按 A 板（v4 基线）取全部。
4. **插件图标 / 中文显示名暂缺**：Plugin Manager 回退到包名+description（写作用域未包含 `icon.svg` 与 `locale/*.json`）。

## 许可

MIT（`license` 字段已声明；`LICENSE` 文件待补，不在 v1 写作用域内）。
