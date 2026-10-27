# 终端面板 · 验收矩阵（acceptance matrix）

> 基线：`docs/design/ui-spec.md` **v4**（§1 五条集成需求 + §2–§6 交互与数据源条款）+ Figma A–F 六板（`.figma/assets/e7b0e68d-…/`）
> 契约：`docs/architecture/contract.md` v1（§11 测试契约；§5/§6/§8 行为）
> 读者：Lead、tester、audit（T6）
> 本文件只负责 **条款 → 验收手段** 的可追溯映射；**执行结果（pass/fail/skip 与缺陷）见 `docs/testing/report.md`**。

## 0. 怎么用

```bash
# 全量单测（Node v22.22.2：`node --test tests/` 会把目录当模块执行，不可用；用默认发现或 glob）
node --test
# 或显式：
node --test "tests/**/*.test.mjs"

# 端到端冒烟（独立脚本；依赖未就绪时打印 SKIP 且退出码 0）
node tests/e2e/smoke.mjs
```

- **auto**：有 node:test 用例覆盖，用例名 = 证据；命令退出码 0 且用例 pass 即通过。
- **manual**：无法在无 DOM/无 DSH 运行时的环境自动断言（视觉、真实宿主装配、真实 PTY、键盘/指针交互），必须按「人工步骤」在真实 DSH 页面验收；人工验收时以 Figma 对应板为视觉基线。
- **manual+限制**：产品当前有平台/契约限制，按「限制说明」验收预期行为（验收重点是**降级表现**，不是理想行为）。
- **N/A（裁决不实现）**：设计稿要求已被 Lead/契约裁决为不实现，验收点是「确认没有做、且替代方案到位」。
- 单元证据路径简写：`client/xxx.test.mjs` = `tests/client/xxx.test.mjs`；`host/xxx.test.mjs` = `tests/host/xxx.test.mjs`；`e2e/smoke.mjs` = `tests/e2e/smoke.mjs`。

## 1. 五条集成需求（ui-spec §1）

| ID | 需求 | 方式 | 证据（用例 / 人工步骤） | 预期证据 |
|---|---|---|---|---|
| R1 | 唯一集成点：注册 `conversation.view`，`{name:'conversation.view', id:'terminal-panel', order:30, label:()=>t('tab.terminal'), locale:NS}` | auto | `client/assembly.test.mjs::apply: 注册 conversation.view 一次，id/order/label/name 正确（§11.3）`；`client/assembly.test.mjs::apply: label 走 locale 注册…` | 注册恰好 1 次；name/id/order=30；`label()==='终端'` |
| R2 | Tab 出现在「对话 / 轨迹」之后，**复用内建 tab 样式**（禁止自绘 tab 条） | auto + manual | auto：R1 的 `order===30`；`client/assembly.test.mjs::apply: 无泄漏…`（只注册 slot，不自建 tab 容器）。manual：真实页面确认 tab 行为「对话 / 轨迹 / 终端」，样式与内建一致 | tab 由宿主渲染；页面无自定义 tab 条 DOM |
| R3 | 空会话不渲染该 slot（内建行为） | manual | 步骤：新建/打开一个**没有任何消息**的 blank session → 观察 tab 行不出现「终端」；发送一条消息后再切回 | blank session 无「终端」tab；有内容后出现 |
| R4 | Tab 角标 = 运行中数量 + 蓝点，为 0 时隐藏 | **N/A（裁决不实现）** | 裁决：`contract.md §12.1` / Lead 2026-10-26 结论——内建 tab 渲染器只读 id/label，无 badge 入参。替代：工具栏显示 `N 个进行中 · M 条记录 · K 个会话`（见 §2.3）。manual 验证替代方案 | 无角标；工具栏计数正确；「对话」tab 无侵入 |
| R5 | 视图选择按会话持久化（内建机制） | manual | 步骤：会话 A 选「终端」tab → 切到会话 B（应回到默认「对话」）→ 切回 A（仍是「终端」） | 按会话记忆；刷新页面后维持（宿主机制） |

## 2. 布局规格（ui-spec §2）

### 2.1 进行中（横向列）

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| L2.1-1 | 列宽 352 × 342、间距 12 | 默认列宽 352 | auto | `client/layout.test.mjs::列宽常量…`；`client/merge-poll.test.mjs::首帧新增 run → …`（新列 width=352） | DEFAULT=352；新建列 width 352 |
| L2.1-2 | 列宽可拖 280–640 | 夹取边界（含等号） | auto | `client/layout.test.mjs::clampColumnWidth(*)` 系列（280/640/越界/NaN/字符串） | 结果 ∈[280,640]；NaN/字符串回 352 |
| L2.1-3 | 拖动时显示像素值、松手写入会话偏好、双击复位 352 | 拖拽交互 | manual | 步骤：拖动列右缘 6px 命中区 → 观察宽度实时变化与 `NNNpx` 提示；松手后切走再切回；双击右缘 | 宽度持久到会话内存；双击回 352；指针变 `col-resize` |
| L2.1-4 | 3 列占满、超过则左右滚动 + 右侧 `›` + 剩余数角标 | 数据顺序与列数 | auto | `client/layout.test.mjs::orderRunningColumns: 只取 running，按 startedAt 升序…`；`e2e/smoke.mjs` 校验 3 列 | 最旧在左、最新在右；列序稳定 |
| L2.1-5 | 横向滚动/`›` 按钮/底部 3px 滚动条 | 视觉与交互 | manual | 步骤：制造 4+ 运行中 Run → 列带出现横向滚动条；点右侧 `›` 右移；滚到最右 `›` 消失 | 与 A/B 板一致 |
| L2.1-6 | 标题行：类型标签 + agent chip + 状态点 + 耗时 + 停止 | 数据字段齐备 | auto | `e2e/smoke.mjs::轮询#1：三列进行中，agent 名 lead/backend/scout 正确`；`e2e/smoke.mjs::最终视图：三类 Run 字段齐备…` | agent.name 非空；kind/status/durationMs 存在 |
| L2.1-7 | 类型标签文案 Bash / 后台任务 / 终端 | 映射 | auto + manual | auto：`host/classify.test.mjs`（kind 分类）；manifest 侧 Run.title 由 backend 填。manual：肉眼确认三种标签 | 三类各出现一次且文案正确 |
| L2.1-8 | 命令行 mono 11px、单行省略、tooltip 完整命令 | 视觉/交互 | manual | 步骤：长命令 `npm test -- --runInBand --watchAll` → 单行省略；hover 显示完整 | 省略号 + tooltip |
| L2.1-9 | 输出区终端底、圆角、纵向滚动、自动贴底 | 跟随状态机 | auto | `client/follow.test.mjs::createFollowState…` / `onScrollFollow: 贴底（distance=0）保持跟随` / `onOutputFollow…` 系列 | 默认 following；输出追加不抢滚动 |
| L2.1-10 | 脚注：pid / terminal id / job id + 「跟随中」 | 数据 + 视觉 | auto + manual | auto：`e2e/smoke.mjs` 断言 `handle` 字段存在；manual：观察脚注左侧 id、右侧「跟随中」蓝点 | 有 id；上翻后「跟随中」消失并出现 `N 条新输出 ↓` |
| L2.1-11 | 会话归属左 3px 竖条：子代理=蓝、队友=琥珀、当前会话=无 | 数据映射 | auto | `host/tree.test.mjs::mergeSessionTree: 子代理 accent…` / `队友 accent=teammate` / root accent=none | accent 三态正确 |
| L2.1-12 | ⤢ → 980×600 只读弹窗 | 弹窗交互 | manual | 步骤：点列头 ⤢ 或双击列头 → 弹窗 980×600、遮罩 65%、Esc/✕ 关闭、可停止/复制全部/独立滚动；不得能输入 | 与 F 板一致；无输入框/无键盘注入 |
| L2.1-13 | 列高 342、列内 30/22/264/22 结构 | 像素级视觉 | manual | 对比 A 板量取（浏览器 DevTools 量 padding/height） | 与图一致（允许 ±2px 渲染差异） |

### 2.2 已完成（摘要行）

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| L2.2-1 | 行高 32、圆角 8、与列同宽、整组最高 160px 内部滚动、分组可折叠 | 视觉 | manual | 步骤：制造 6+ 已完成 → 展开分组，测量行高与组高上限，滚动 | 行 32px；组 ≤160px 内滚 |
| L2.2-2 | 分组默认折叠（v4 变更 2） | 默认值 | auto | `client/defaults.test.mjs::createViewState: 已完成分组默认折叠（v4 变更 2 / §2.2）`；`client/collapse.test.mjs` 收起语义 | 初始 `group.completedCollapsed===true` |
| L2.2-3 | 行内字段：chevron/类型/agent chip/命令/状态(✓0 ✕1 ◼已停止)/耗时/倒计时/进度条/⋯ | 数据 + 视觉 | auto + manual | auto：`client/format.test.mjs::formatDuration…`、`formatCountdown…`、`e2e/smoke.mjs` countdown；manual：肉眼核对符号与文案 | ✓/✕/◼+文案双编码；倒计时 `Ns 后收起` |
| L2.2-4 | 10s 后折叠为摘要行 | 状态机 | auto | `client/collapse.test.mjs::armCollapse…` / `tickCollapse: 到 deadline 收起…` | deadline=now+10000；到点 expanded=false |
| L2.2-5 | 悬停/聚焦暂停，失焦后**重新等 10s** | 状态机 | auto | `client/collapse.test.mjs::pauseCollapse…` / `resumeCollapse: 失焦后重新等完整 10s…` | paused 时不收起；resume 重置完整 10s |
| L2.2-6 | 收起后又有输出 → 自动重新展开并重新计时 | 状态机 | auto | `client/collapse.test.mjs::收起态 + 新输出 → 重新展开并重新计时` | expanded=true 且 deadline 重新写入 |
| L2.2-7 | 失败项 1px 红边框（error 40%） | 视觉 | manual | 制造失败 Run（exit 1）→ 与 C 板对照 | 红边框且不闪烁 |
| L2.2-8 | 行可点开/收起、`⋯` 菜单 | 交互 | manual | 步骤：点行展开详情；`⋯` 菜单含定位/复制命令/复制输出/在终端中打开(仅终端)/固定展开 | 菜单项与行为符合 §3.7 |

### 2.3 工具栏

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| L2.3-1 | 左：`N 个进行中 · M 条记录 · K 个会话` | 计数正确 | auto + manual | auto：`client/filter.test.mjs::countByKind: 全局计数…`；manual：与列/行数交叉核对 | 计数与实际一致；K=会话树可见会话数 |
| L2.3-2 | 类型 chips：全部/Bash/后台任务/终端，带计数，单选 | 过滤逻辑 | auto | `client/filter.test.mjs::filterRuns: kind=* …` 系列；`countByKind: 全局计数…` | 单选生效；计数为全局值（不受会话/搜索影响） |
| L2.3-3 | 0 计数 chip 仍显示（置灰可点） | 视觉/边界 | manual | 仅有 bash 时观察 job/terminal chip | chip 可见、置灰、点击得空列表 + 空态 |
| L2.3-4 | 会话范围、搜索、`新任务自动展开` 开关、`清空已完成` | 控件存在与联动 | auto + manual | auto：`client/filter.test.mjs`（范围/搜索）；manual：开关默认开、清空+撤销（§3.8） | 控件齐全；默认开 |

### 2.4 颜色令牌与环境

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| L2.4-1 | 颜色只用 `--dsw-alias-*` 令牌，禁止硬编码 | 静态扫描 | auto | `client/static-style.test.mjs::颜色只用 --dsw-alias-* 令牌…`（禁止 `background:#`/`color:#` 直接硬编码） | 命中 ≥10 个 alias 令牌；无直接 hex 前景/背景 |
| L2.4-2 | 背景/文字/边框/状态/圆角/阴影/字体令牌映射 | 视觉 token 对照 | manual | 切换 D 板 Light 场景：明暗主题各看一遍；核对圆角/阴影/等宽数字 | 两主题可读，无生硬色块 |
| L2.4-3 | 图标用内联 SVG，禁 emoji/字符占位 | 静态扫描 | auto | `client/static-style.test.mjs::图标为内联 SVG…`；`client/assembly.test.mjs::静态: 样式自插…` | 存在 `h('svg')`，无 emoji 图标 |
| L2.4-4 | 圆角/阴影 token：`--dsw-radius-sm/md`、`--dsw-shadow-lv1/lv3` | 静态扫描 | auto | `client/static-style.test.mjs::圆角/阴影走 token…` | 两类 token 均出现 |

## 3. 交互规则（ui-spec §3.1–§3.12）

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| I3-1 | 自动展开：开关默认开；新 Run 直接以列出现并贴底 | 默认值 + reducer | auto | `client/defaults.test.mjs::createViewState: FilterState 默认值（§5.3 / §3.1 / §12.3）`；`client/merge-poll.test.mjs::首帧新增 run → runs/columns/order.running 同步建立`；`client/collapse.test.mjs::createCollapseState…` | 新 run 进 running 列且 expanded、following |
| I3-2 | 完成收起：终态 → 摘要行 + 10s 倒计时（琥珀点 + Ns 后收起 + 2px 进度条） | 状态机 + 视觉 | auto + manual | auto：`client/merge-poll.test.mjs::mergePoll: 进入终态 → 进 completed 顺序并 arm 10s 倒计时（§6.3）`；`client/format.test.mjs::formatCountdown…`；manual：观察琥珀点/进度条 | deadline≈进终态时刻+10s；文案 `10s 后收起` |
| I3-3 | 悬停/键盘焦点暂停；移出/失焦后重新 10s | 状态机 | auto | `client/collapse.test.mjs::pauseCollapse…` / `resumeCollapse…` | 同 L2.2-5 |
| I3-4 | 收起后又有输出 → 自动展开并重新计时 | 状态机 | auto | `client/collapse.test.mjs::收起态 + 新输出…` | 同 L2.2-6 |
| I3-5 | 滚轮只在输出区内滚动；默认贴底；上翻暂停（`N 条新输出 ↓`）；**滚回底部自动恢复** | 状态机 | auto + manual | auto：`client/follow.test.mjs::4px 边界…` / `上翻后再滚回底部 → 自动恢复跟随` / `onOutputFollow: 暂停时累计…`；manual：真实滚轮确认页面骨架不动 | distance≤4 恢复；>4 暂停；pending 累计；滚轮不带动整页 |
| I3-6 | 停止：两击确认（3s 内二次点击） | 交互 | manual | 步骤：点停止 → 按钮变「确认停止？」；3s 内再点 → 停在下一帧反映终态；超 3s 自动还原 | 两击生效；无乐观终态；超时不误杀 |
| I3-7 | `⋯` 菜单：定位/复制命令/复制输出/在终端中打开(仅终端)/固定展开 | 交互 | manual | 逐项点击验证；非终端项不出现「在终端中打开」 | 5 项行为正确；固定展开后不自动收起（`client/collapse.test.mjs::pinCollapse…`） |
| I3-8 | 清空已完成：只清当前筛选命中项，3s 内可撤销 | 交互 | manual | 步骤：搜索 bash → 清空已完成 → 仅 bash 终态消失；3s 内点撤销恢复 | 只清命中项；撤销恢复 |
| I3-9 | 动效 180ms 入场 / 200ms 收起；`prefers-reduced-motion` 瞬时 | 静态 + manual | auto + manual | auto：`client/static-style.test.mjs::动效：入场 180ms / 收起 200ms + prefers-reduced-motion（§3.9）`；manual：系统开启“减弱动态效果”后复看 | CSS 含 180ms/200ms 与 reduced-motion 覆盖；动效可关 |
| I3-10 | 键盘：Tab 聚焦、Enter 展开收起、Shift+Enter 固定、Esc 退出跟随/关弹窗 | 交互 | manual | 纯键盘走一遍列/行/弹窗 | 焦点环可见；Esc 行为正确；无焦点陷阱 |
| I3-11 | 列宽拖曳 6px 命中区、实时像素、双击复位 | 交互 | manual + auto | manual：见 L2.1-3；auto：`clampColumnWidth` 系列 | 同 L2.1-3 |
| I3-12 | 最大化：⤢ / 双击列头；只读、保留停止与复制、Esc/✕ 关闭 | 交互 | manual | 见 L2.1-12 | 同 L2.1-12 |

## 4. 筛选（ui-spec §4）

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| F4-1 | 类型单选 chips，计数为全局值 | 过滤 + 计数 | auto | `client/filter.test.mjs::countByKind: 全局计数…`、`filterRuns: kind=*` 系列、`filterRuns: 类型 + 会话 + 搜索是 AND 关系` | 单选生效；计数不受其它筛选影响 |
| F4-2 | 会话范围多选：当前会话 / 子代理（缩进+蓝点）/ 队友（琥珀点） | 过滤 + 树 accent | auto | `client/filter.test.mjs::filterRuns: sessionIds 多选…`、`sessionIds 空数组 → 无命中`；`host/tree.test.mjs` accent | 多选并集；空数组=无命中（≠全部） |
| F4-3 | 默认会话范围 = 全部（§1.5 / A 板标题；v4 与 §4 正文「当前会话默认选中」冲突，按契约 §12.3 取全部） | 默认值 | auto | `client/defaults.test.mjs::createViewState: FilterState 默认值（§5.3 / §3.1 / §12.3）` | 默认 null；常量 `DEFAULT_SESSION_SCOPE` 可一处改 |
| F4-4 | 面板底部说明「仅显示有命令行活动的会话」 | 文案 + 数据 | auto + manual | auto：`host/tree.test.mjs::hasActivity 为布尔`；manual：查看底部说明 | 说明存在；无活动会话不出现 |
| F4-5 | 搜索匹配命令 + 输出文本 + 显示名，本地即时、命中高亮、清空即恢复 | 纯函数 | auto + manual | auto：`client/filter.test.mjs::搜索命中命令文本`、`::搜索命中输出文本（stdout/job 通道）`、`::搜索命中会话/agent 显示名（§7 显示名）`、`::searchMatch: 空查询恒真（清空即恢复）`；manual：输入即过滤、高亮、清空恢复 | 不触发 RPC；三类字段命中 |
| F4-6 | 筛选状态仅会话内存保留（不跨重启），切 tab 回来仍生效 | 交互 | manual | 步骤：设筛选 → 切「对话」→ 切回「终端」；刷新页面 | 切回保留；刷新丢失 |

## 5. 数据源与能力（ui-spec §5）

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| D5-1 | Bash（前台）：旁路 `readFrom(offset)` 增量文本 | **manual+限制** | 限制：平台不提供前台 bash 过程输出（Lead 2026-10-26 核实），backend 以 `detail:'final-only'` 的 Run 呈现终态输出。manual：跑一条 bash → 面板列出现、结束后显示终态输出 + 「仅终态」徽标；**不得**验收为实时流 | 列出现；终态后输出；「仅终态」徽标；无实时帧属预期 |
| D5-2 | 前台 bash 旁路读取不消费进程游标 | auto（单元） | `host/cursors.test.mjs::同一字节不被交付两次…`（假 ShellExecution 只暴露 `readFrom`，`readOutput()` 一调用即抛错，保证实现不误用消费式 API） | 增量拼接与源字节一致；无 readOutput 使用 |
| D5-3 | 后台任务：注册表 + follow 偏移续读，增量 + 终态 | auto | `host/panel.test.mjs::panel.poll: job running → stopping → completed 终态（§6.1 映射表）`、`job 输出增量不重复…`、`host/status.test.mjs::mapJobStatus…`；`host/cursors.test.mjs`（游标） | stopping→running+stopping；readAt 增量不重复；终态映射正确 |
| D5-4 | 持久终端：retention/attach 屏幕快照 + 增量帧（纯文本降级） | auto + manual+限制 | auto：`host/terminal-window.test.mjs`（行窗口全表）、`host/panel.test.mjs::持久终端增量…`；manual+限制：全屏 TUI（vim/htop）显示为文本流而非屏幕帧（契约 §12.2） | 尾页/翻页/增量/裁剪/空输出/单行超长正确；TUI 退化属预期 |
| D5-5 | 归属：`tools/execute` 的 `exec.agent.id` 决定 Run 所属会话；子代理/队友关系由 subagents/agentTeams 求得 | auto | `host/tree.test.mjs::mergeSessionTree…` 全系列；`host/panel.test.mjs::会话树含 root/子代理/队友`；`e2e/smoke.mjs` agent 名 | root 首位；队友优先；diagnostic 跳过；不按名字猜 |
| D5-6 | 降级：来源不可用时对应 chip 置灰并注明原因，其余照常 | auto + manual | auto：`host/panel.test.mjs::来源缺失 → availability 标记，帧仍正常`；`host/assembly.test.mjs::apply: 可选服务全部缺失…`；`client/merge-poll.test.mjs::availability 变化只改标记，不清已有数据`；manual：断开 jobs 服务时观察 chip 置灰 + tooltip | 单来源失败不影响面板主体；reason 可读 |

## 6. 边界状态（ui-spec §6）

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| B6-1 | 空态：终端字形 + 「本会话还没有命令行活动」 | 视觉 | manual | 新会话无命令 → 打开终端 tab | 空态文案与图形；不空白不报错 |
| B6-2 | 暂停跟随浮层 `N 条新输出 ↓` | 状态机 + 视觉 | auto + manual | auto：`client/follow.test.mjs::onOutputFollow: 暂停跟随时累计…`；manual：上翻后产生新输出 | 浮层出现且累计正确；回底消失 |
| B6-3 | 已完成全部收起 | 状态机 | auto | `client/collapse.test.mjs::tickCollapse: 到 deadline 收起…`、`client/defaults.test.mjs::createViewState: 已完成分组默认折叠（v4 变更 2 / §2.2）` | 全部收起后只留「已完成 N」行 |
| B6-4 | 输出超长：区内滚动 + 「已截断较早输出」提示 | auto + manual | auto：`client/format.test.mjs::tailLines…`（600 行上限逻辑）；`host/frame.test.mjs::boundFrame…`；manual：输出 >600 行观察顶部提示 | 本地保留 600 行；顶部提示；不卡顿 |
| B6-5 | 记录 >50 条虚拟化（只渲染可视 ±10 行） | manual | 步骤：制造 60+ 已完成记录 → 展开分组滚动；DevTools 检查 DOM 行数 | DOM 行数远小于记录数；滚动流畅 |
| B6-6 | 断线重连：游标续读、提示一次 | auto + manual | auto：`client/merge-poll.test.mjs::revision <= 已应用 → 原样返回（引用相等…）`（乱序/重试丢弃）、`truncated 帧仍正常应用，游标只由 nextCursors 推进`；manual：DevTools 断网 3s 再恢复 | 横幅一次；恢复后无重复/无缺口；提示「已恢复」 |
| B6-7 | 全部收起 + 暂停 + 空态 三边界互不影响 | manual | 依次触发三种边界组合 | 无错乱、无残留浮层 |

## 7. 无障碍与性能（ui-spec §7）

| ID | 条款 | 验收点 | 方式 | 证据 / 人工步骤 | 预期证据 |
|---|---|---|---|---|---|
| A7-1 | 状态不只靠颜色（✓/✕/◼ + 文案）；类型文字标签常显；agent chip 带文字名 | 数据 + 视觉 | auto + manual | auto：`e2e/smoke.mjs` 断言 agent.name/status；manual：灰度模式截图核对 | 去色仍可辨状态与类型 |
| A7-2 | 列/行是 button + `aria-expanded`；停止/更多独立按钮 + `aria-label` | 静态 + manual | manual | DevTools Accessibility 树检查 | 角色/名称/展开态正确 |
| A7-3 | 终态变化 `aria-live="polite"`；计时/耗时 tabular-nums | 静态 | auto | `client/static-style.test.mjs::无障碍：aria-live + tabular-nums + aria-label（§7）` | 两者均出现 |
| A7-4 | 输出 rAF 合帧（≥60ms）；只对可见列渲染 | 性能 | manual | Performance 面板录制 → 帧率/长任务；滚动与高频输出场景 | 无明显掉帧；无每 chunk 全量重渲 |
| A7-5 | 图标用内联 SVG；`› ▾ ✓ ✕ ⌕ ↑` 仅为占位 | 静态 | auto | `client/static-style.test.mjs::图标为内联 SVG…` | 见 L2.4-3 |

## 8. 契约测试契约（contract §11）追溯

| 契约条款 | 要求 | 覆盖用例 |
|---|---|---|
| §11.1 classify | `classifyTool` 名称表 + command/cwd 透传 | `host/classify.test.mjs`（20 用例） |
| §11.1 tree | root 首位/队友优先/diagnostic 跳过/accent 三态/稳定排序 | `host/tree.test.mjs`（11 用例） |
| §11.1 status | shell/job/terminal 三来源状态映射全表 | `host/status.test.mjs`（17 用例） |
| §11.1 cursors | 不重复不丢帧/lossy+gap/调度顺序/预算 | `host/cursors.test.mjs`（13 用例） |
| §11.1 frame | 帧信封/nextCursors/截断 dropped/预算边界/textBytes + boundFrameDetailed | `host/frame.test.mjs`（13 用例） |
| §11.1 terminal-window（v2 冻结 API） | 行窗口/plan 四模式/重叠去重/行边界换行/空输出/单行超长 | `host/terminal-window.test.mjs`（28 用例） |
| §11.2 panel（backend 补） | hello/poll/kill/availability/树/job 生命周期/终端增量 | `host/panel.test.mjs`（11 用例） |
| §11.2 client 出口面 | 20 函数 + 4 常量全部存在 | `client/internals-export.test.mjs` |
| §11.2 filter/count/search | 类型/会话/搜索 AND、全局计数 | `client/filter.test.mjs`（17 用例） |
| §11.2 列宽/排序 | clamp 全边界、running 升序、completed 降序 | `client/layout.test.mjs`（19 用例） |
| §11.2 follow | 4px 边界、上翻暂停、回底恢复、output 不抢滚动 | `client/follow.test.mjs`（10 用例） |
| §11.2 collapse | arm/pause/resume/tick/pin/重新展开；10s | `client/collapse.test.mjs`（12 用例） |
| 默认值（§2.2/§3.1/§4/§6.4） | createViewState/createColumnState 默认 + 常量 4px/10s/600/32/5min | `client/defaults.test.mjs`（6 用例） |
| §11.2 文本/时间 | ANSI/OSC/CR、tailLines、duration、countdown | `client/format.test.mjs`（18 用例） |
| §11.2 mergePoll | revision 丢弃/幂等/removed/truncated/chunks append/availability/终态单调 | `client/merge-poll.test.mjs`（13 用例） |
| §11.3 host 装配 | route exact+path、dispose 撤销、信封 405/415/413/401、hello/poll 错误码 | `host/assembly.test.mjs`（12 用例） |
| §11.3 client 装配 | 注册一次/id/order/label/inject(F28)/dispose 无泄漏 | `client/assembly.test.mjs`（6 用例） |
| §2.4/§3.9/§7 静态 | 颜色令牌/圆角阴影/内联 SVG/动效/aria | `client/static-style.test.mjs`（6 用例） |
| §13.3 e2e | host 纯逻辑 + 模拟轮询 → 最终视图帧（17 断言/3 帧） | `e2e/smoke.mjs` + `e2e/smoke.test.mjs` |

## 9. 契约 §8 降级矩阵逐项

| 场景 | 方式 | 证据 |
|---|---|---|
| webServer/connection 缺失 → 插件不激活、前端空白态 | manual（真实宿主） | 步骤：profile 中禁用依赖后重启；页面空态「Host 半端未加载」 |
| jobs 缺失 → chip 置灰 + reason | auto + manual | `host/panel.test.mjs::来源缺失 → availability 标记…`；`client/merge-poll.test.mjs::availability 变化只改标记` |
| shell 缺失 → bash chip 置灰 | auto + manual | 同上（bash 分支）；manual 看 chip tooltip |
| terminals 缺失 → 终端 chip 置灰 | auto + manual | 同上 |
| subagents/agentTeams 缺失 → 只 root + 提示 | auto | `host/tree.test.mjs::空 descendants/members → 只有 root`、`缺失字段不抛错` |
| root 非 live → `session-not-found` 空态 | auto + manual | `host/panel.test.mjs::panel.poll: 未知/非 live root 会话 → 明确诊断（session-not-found 或降级帧，v2 待裁决）`；`host/assembly.test.mjs::panel.poll: 未知 sessionId → 200 且给出明确诊断（v1 session-not-found / v2 降级帧，待裁决）` |
| 单会话 terminals 抛错 → 跳过该会话 | auto | `host/panel.test.mjs`（来源缺失分支）+ 假服务抛错路径 |
| job 输出窗口淘汰 → lossy 插入丢失标记 | auto | `host/cursors.test.mjs::游标落在保留窗口之外…`；`host/terminal-window.test.mjs::computeTerminalDelta: reset（totalLines 倒退）→ lossy，从头重发保留页` |
| 帧预算耗尽 → 静默续读 | auto | `host/frame.test.mjs::截断时用 dropped…`、`cursors 前移…` |
| 断线 ≥2 次 → degraded 横幅 | manual | DevTools 断网 |
| 401 → blocked 横幅 + 停止轮询 | manual | 清除 cookie 后观察 |
| 页面隐藏 → 停轮询、恢复立即 poll | manual | 切 tab/最小化后回看 Network |
| 输出超长 → 本地 600 行 + 提示 | auto + manual | `client/format.test.mjs::tailLines…`；视觉见 B6-4 |
| 记录 >50 → 虚拟化 | manual | 见 B6-5 |

## 10. 已裁决偏差（不按设计稿验收的部分）

| 设计稿条款 | 裁决 | 验收改为 |
|---|---|---|
| §1 Tab 角标（运行中数量+蓝点） | 不实现（内建 tab 渲染器无 badge 入参，contract §12.1） | R4：确认无角标 + 工具栏计数正确 |
| §5 持久终端用 xterm 屏幕帧 | 降级纯文本 tail（禁止装依赖 + client 单文件，contract §12.2） | D5-4：文本可读、ANSI 剥离、TUI 退化可接受 |
| §4 会话范围默认「当前会话」 | v4 正文与 A 板/B 板冲突，取「全部」（contract §12.3） | F4-3：默认全部；常量一处可改 |
| §2.1 Bash 实时增量 | 平台限制：前台 bash 过程输出不可得（Lead 2026-10-26） | D5-1 标 manual+限制：终态 + 「仅终态」徽标 |
| 插件 icon/locale 显示元数据 | v1 未交付（不在写作用域；T7 补） | manual：Plugin Manager 显示包名兜底；T7 后复验中文名/图标 |

## 11. ui-spec v5 A1–A13 映射（真机反馈修复，contract v7）

| # | 条目 | 方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| A1 | 标题首行 | auto | `client/v7.test.mjs::A1 firstCommandLine…`（单行/多行/前导空行/空白折叠/超长…+N 行/非字符串） | 纯函数 **PASS**；视觉核对 manual |
| A2 | 输入块（`$ `/`› ` + 分隔线） | auto（源码级静态）+ manual | `client/v7.test.mjs::A2/A3/A4 输入块（源码级静态）`：`'$ '`/`'› '` 前缀、`inputs[0]`=name、index1 起去重、分隔线 | 结构 **PASS**；渲染级 **Unverified**（InputBlock 未进冻结表，无法浅渲染） |
| A3 | 空输出仍有输入块 + 空文案 | auto（静态）+ manual | 同上（OutputArea 无条件渲染 InputBlock + `output.empty/metaOnly/finalOnly` 文案） | 结构 **PASS**；视觉 **Unverified** |
| A4 | notice 一行次要色提示 | auto（静态）+ manual | 同上 + `host/terminals-v7.test.mjs`（`notice.code:'terminal-no-agent'` 产出） | 数据/结构 **PASS**；视觉 **Unverified** |
| A5 | 收起时序（先展开倒计时→到点折叠） | auto | `client/v7.test.mjs::A5 collapseVisual…`（10s 前不折叠、到点 `expanded:false,deadline:null`、折叠后无倒计时/进度条） | **PASS**；视觉 manual |
| A6 | 暂停语义（hover/focus、失焦重计、pinned 不 arm） | auto | `client/v7.test.mjs::A6 collapseVisual：paused 冻结、pinned 不 arm` + `collapse.test.mjs` | **PASS**；交互 manual |
| A7 | 高度稳定/工具栏单行 | auto（静态）+ manual | `client/v7.test.mjs::A7 抖动约束`（toolbar nowrap/46px、`.tp-done-list` flex、countdown 固定宽） | 结构 **PASS**；目视 **Unverified** |
| A8 | 动画不重放/reduced-motion | auto（静态）+ manual | `client/v7.test.mjs::A8`（仅 `[data-tp-fresh]` 上 animation、基础样式无 animation、reduced-motion） | 结构 **PASS**；目视 **Unverified** |
| A9 | 跟随滚动仅容器 scrollTop | auto（静态）+ manual | `client/v7.test.mjs::A9`（无 `scrollIntoView`、`scrollTop=scrollHeight`） | 结构 **PASS**；页面不滚 **Unverified** |
| A10 | composer 隐藏/恢复/降级 | auto（纯函数+静态）+ manual | `client/v7.test.mjs::A10 applyComposerHidden…`（set/remove/幂等/null/抛错降级）+ 静态（`closest('[data-conversation-content]')`、无 `document.body` 写） | 纯函数 **PASS**；真实隐藏/切 tab **Unverified** |
| A11 | terminal 可见性（不得静默 0 条） | auto（host 集成）+ manual | `host/terminals-v7.test.mjs`：默认 sidebar 关闭不误用、开启后 2 条、agent 缺失 2 条 meta-only 不删、events 兜底登记、diagnostics 每帧必带 | 集成 **PASS**；真机部署后新 `terminal_*` **Unverified** |
| A12 | 显示名（不暴露 sessionId，空 `—`；rootAgent 缺失仍列队友） | auto（集成）+ manual | `host/terminals-v7.test.mjs`（diagnostics agentFound/agentCount、team anchor、display name 兜底）；见 §12 D1 | 集成 **PASS**；真机名 **Unverified** |
| A13 | meta-only 不误导 | auto（静态/数据）+ manual | `client/v7.test.mjs::A13`（`metaOnly` 不用运行中脉冲、`tp-status-meta`、`output.tier3` 标注）+ host notice 断言 | 结构 **PASS**；视觉 **Unverified** |

## 12. v7 真机 5 项缺陷 ↔ 用例映射

| 缺陷 | 症状 | 对应用例 | 仍只能真机验证 |
|---|---|---|---|
| D1 terminal 记录不可见 | 真机跑过 `terminal_open` 但面板 0 条 | `host/terminals-v7.test.mjs`（sidebar 默认关/开启映射、agent 缺失不删、events 兜底、diagnostics 形状）；A11 | 部署后新 `terminal_open` 是否真机可见（历史 pty 不可回读，不计缺陷） |
| D2 界面抖动 | 轮询重建整页跳动 | `client/v7.test.mjs` A7/A8（工具栏 nowrap、动画仅 fresh、done-list flex、countdown 固定宽）+ `defaults/layout` 排序稳定性 | 真机目视：新 Run/终态/行数变化外框高度、composer 不被顶动 |
| D3 标题半截命令 | 多行命令只显示半截 | `client/v7.test.mjs` A1（首条非空行、` +N 行`、超长 `…`、完整原文 title） | 列头/行视觉截断观感 |
| D4 输出不含输入 | 输出区看不到输入内容 | `client/v7.test.mjs` A2/A3/A4（输入块结构/notice/空输出）+ mergePoll inputs 归一化 | 输入块实际排版、`›` 行可读性 |
| D5 收起时序 | 结束即收起/收起后仍倒计时 | `client/v7.test.mjs` A5/A6（10s 前不折叠、到点清 deadline、折叠后无倒计时、paused/pinned） | 倒计时视觉与进度条 |
| D6 composer 未隐藏 | 终端 tab 仍显示输入框 | `client/v7.test.mjs` A10（`applyComposerHidden` 纯函数 + 静态注入/CSS/无 body 写） | 终端 tab 激活隐藏、切走恢复、失败静默且不影响其它 tab |

## 13. ui-spec v6 A14–A22 映射（v8 展示层 + host 一致性补丁）

| # | 条目 | 方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| A14 | 网格换行（无横向滚动/溢出按钮） | auto（静态）+ manual | `client/v8.test.mjs::A14 网格（静态）`：`.tp-strip-track{flex-wrap:wrap}`、`.tp-strip{overflow-y:auto;overflow-x:hidden}`、无 `overflow-x:auto`/`scrollLeft`/`tp-more`/`visibleIds`、`.tp-col{flex:none;height:342px}` | 结构 **PASS**；真机目视 **Unverified** |
| A15 | Run 三态（running→linger→completed；**v11.1 起 linger=3s**，原 10s） | auto | `client/v8.test.mjs::runPhase…`、`lingerVisual…`、`mergePoll：running→终态进入 linger…`、`linger 3s 边界…`（3999ms 仍 linger / 4000ms completed、deadline=finishedAt+3000、progress 分母 3000） | 纯函数 **PASS**；视觉/计时器 **Unverified** |
| A16 | 「收起」立即完成 + 幂等；pinned 不 arm（**v11.1 起 linger 窗口=3s**） | auto | `client/v8.test.mjs::pauseLinger / resumeLinger：「收起」collapseLinger 立即完成且幂等`、`mergePoll…pinned 不 arm linger`（pinned 在 3s 窗口内始终不 arm） | 纯函数 **PASS**；真实按钮点击 **Unverified** |
| A17 | hover/focus 暂停倒计时、移出重计 **3s**（v11.1；原 10s） | auto + manual | `client/v8.test.mjs::DEF-1 回归：hover/focus 暂停期间 linger 倒计时/进度冻结，resume 后回到契约语义`（暂停期间不同 now 的 remaining/progress 必须相等；resume 重计 3s 后正常递减）＋`linger 3s 边界…`（pause 冻结/resume=+3000） | 纯函数 **PASS**（DEF-1 已修）；真机悬停 **Unverified** |
| A18 | 切 tab 恢复（缓存命中/游标续传/LRU4/TTL30min） | auto（缓存纯函数 + 静态接线）+ manual | `client/v8.test.mjs::createSessionCache…`（LRU4/TTL 边界/命中刷新/缓存不重建 view）、`A18/A21 缓存接线（静态）` | 纯函数 **PASS**；真实切 tab 时序 **Unverified** |
| A19 | FLIP/fade（180/200ms、仅 transform/opacity、reduced-motion） | auto（静态/逻辑）+ manual | `client/v8.test.mjs::A19`（card-out 180ms、`FLIP_MS=200`、keyframes 仅 opacity/transform、reduced-motion 跳过）+ `flipDeltas` 位移/新增/删除 | 逻辑 **PASS**；观感 **Unverified** |
| A20 | 首帧 loading ≠ 空态（600ms 稳定窗口） | auto（静态）+ manual | `client/v8.test.mjs::A20`（skeleton 分支先于空态、`awaitingFirstFrame`、`setEmptySettled(true), 600`） | 结构 **PASS**；真机过渡 **Unverified** |
| A21 | 缓存未命中/revision 回退 → resync，无 removed 抖动 | auto（缓存/revision + host resync） | `client/v8.test.mjs::isRevisionRollback` + `A18/A21 静态`；`host/v8-consistency.test.mjs::resync…`、`cursors:null 等价…` | 纯函数/Host **PASS**；真机重载 **Unverified** |
| A22 | job-only 不抖动；removed/runs 互斥；本帧已见 Run 不被 prune | auto（Host 帧不变量） | `host/v8-consistency.test.mjs::removed/runs 同帧互斥`、`removed 正常路径`、`prune(now,{protect})`、`A22 job-only 相邻帧稳定` | Host **PASS**；真机首帧 **Unverified** |

## 14. ui-spec v7 A23–A28 映射（v9 展示可达性 + host 树外 owner/诊断）

| # | 条目 | 方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| A23 | 已完成行独立展开（expandedIds 纯布尔、不依赖 columns、removed/清空裁剪） | auto（reducer+静态）+ manual | `client/v9.test.mjs::A23 createViewState…`、`mergePoll：预置 expandedIds 跨帧保留`、`mergePoll removed：expandedIds 裁剪`、`setRowExpanded/toggleRow 只操作 group.expandedIds…`、`clearCompleted 裁剪…` | reducer/静态 **PASS**；真机点击 **Unverified** |
| A24 | 已完成行无倒计时（不渲染 collapse.in/tp-countdown/tp-progress） | auto（组件级静态）+ manual | `client/v9.test.mjs::A24 已完成行（组件级静态）…`（CompletedRow 无相关渲染/无 column.collapse；死 CSS 仍存在但解耦） | **PASS**；视觉 **Unverified** |
| A25 | 黄/绿/红状态色；hover/focus 不改布局尺寸 | auto（静态）+ manual | `client/v9.test.mjs::A25 状态色板…`（running=warn、linger/completed=success、failed=error；hover/focus 仅颜色类属性） | 静态 **PASS**；明暗主题 **Unverified** |
| A26 | 铺满网格、无横向滚动 | auto（静态）+ manual | `client/v9.test.mjs::A26 网格铺满…`（`.tp-cell{flex:1 1 var(--tp-card-w,352px)}`、内层 `.tp-col width:100%`、等高 342、窄容器单列、无 overflow-x/scrollLeft/tp-more、拖拽 clamp 280–640）；**注**：contract §9.2 的「列数按基准宽取整/320–352 自适应」无对应纯函数（V9-C2） | 结构 **PASS**；真实 resize **Unverified** |
| A27 | 树外 owner 升级 live（命中清 notice、meta-only→live；未命中保持 meta-only） | auto（Host 集成）+ manual | `host/v9-owner.test.mjs::A27 树外 owner 命中 live…`、`未命中 agent…`、`树内 owner 行为不变…`、`升级 live 后失联不误删` | Host **PASS**；真机队友/subagent terminal **Unverified** |
| A28 | 诊断可见（agentsService/agentsProbe/terminalOwners 形状与取值） | auto（Host）+ manual | `host/v9-owner.test.mjs::A28 diagnostics 形状…`、`agentsAccess=property`、`agentsProbe getOk/identityOk` | Host **PASS**；真机 Network/Console **Unverified** |

## 15. ui-spec v8 A29–A33 映射（v10 视觉/结构增量：2px 边框 / 统一卡宽 grid / 同步 ghost+FLIP）

| # | 条目 | 方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| A29 | 2px 状态边框（生效）+ running warn 65% / linger·completed success 60% / failed error 65% | auto（静态）+ manual | `client/v10.test.mjs::状态色板…`；`A29 2px 边框（级联顺序 = 生效 2px）：border-width:2px 规则在 1px shorthand 之后`（同特异性后者胜出 + 最后一条 border 声明为 2px）；`lib/client.js:303/:374`（1px 基线）→ `:383/:384`（2px 覆盖） | 静态 **PASS**（DEF-V10-1 已修）；真机 **Unverified** |
| A30 | hover/focus 视觉加粗不改尺寸（inset shadow + border-color 92%，无 border-width/width/height/padding） | auto（静态） | `client/v10.test.mjs::A29 hover/focus…`（≥6 条状态 hover/focus 规则逐条校验属性白名单） | 静态 **PASS**；真机悬停 **Unverified** |
| A31 | 统一卡宽/单卡不拉伸（grid `auto-fill` 等宽、最后一行单卡保持列宽、拖统一 `--tp-card-w` 280–640、容器 <716px 单列） | auto（静态 + clamp 纯函数）+ manual | `client/v10.test.mjs::A30 网格…`、`A30 拖拽语义…`、兼容残留 INFO | 静态 **PASS**；真实 resize/目视 **Unverified** |
| A32 | 收起只发生一次 layout shift + 平滑滑动（ghost 原位 180ms + 其余 FLIP 200ms，无二次反向重排；同帧 >2 跳过 fade） | auto（静态/逻辑）+ manual（交互） | `client/v10.test.mjs::A31 同步 ghost…`、`FLIP：测量集合含 ghost…`、`多卡同帧移除 >2…`、`ghost 定时清理…` | 逻辑 **PASS**；真机交互 **Unverified** |
| A33 | reduced-motion 瞬时（无 ghost 占位、无 FLIP/fade） | auto（静态）+ manual | `client/v10.test.mjs::A31 FLIP…reduced-motion 瞬时`（`prefersReducedMotion() return` + CSS 关动画 + render 期清 ghost） | 静态 **PASS**；真机 **Unverified** |

## 16. ui-spec v9 A34–A38 映射（v11 P0 会话隔离；待 T59 落稿后核对条目文字）

> 说明：T59（契约 v11 + ui-spec v9）尚未完成，当前 `docs/design/ui-spec.md` 仍为 v8。本表按 Lead T60 任务单与 scout §E 先行映射；T59 落稿后如条目措辞变化需同步本表。

| # | 条目 | 方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| A34 | A/B 会话互不可见 | auto（Host 集成 + 客户端纯函数）+ manual | `host/v11-isolation.test.mjs::A34 帧隔离…`（B 帧不含 A 的 job/terminal run、owner 全 ∈ B 树、诊断计数）、`A34/A35 terminal 隔离…`；`client/v11.test.mjs::A36 帧内隔离…`（mergePoll 过滤异会话 runs/sessions） | Host/Client **PASS**；真机 **Unverified** |
| A35 | 切回 A 数据完整且不被 B 偷增量/删数据 | auto（Host）+ manual | `host/v11-isolation.test.mjs::A35 A 的未交付增量不被 B 偷取…`（B poll 后 A 续收 6000B）、`A36 removed 不跨会话…` | Host **PASS**；真机切回 **Unverified** |
| A36 | 异会话迟到帧被丢弃且界面不闪 | auto（mergePoll/静态）+ manual | `client/v11.test.mjs::A36 异会话帧：mergePoll 整帧丢弃并返回原 state 引用…`、`A36 兼容旧 Host…`、`A36 帧入口防御…`（noteCrossSessionFrame + warn 一次 + notice） | 纯函数/静态 **PASS**；真机迟到帧 **Unverified** |
| A37 | removed/prune/resync 不跨会话 | auto（Host + 缓存静态）+ manual | `host/v11-isolation.test.mjs::A36 removed…`、`A37 prune…`、`A37 resync 隔离…`；`client/v11.test.mjs::A37 缓存隔离…`（CACHE_VERSION/sanitize/save 拒绝）、`A37 切会话…` | Host/缓存 **PASS**；真机时序 **Unverified** |
| A38 | 诊断可见（frameSessionId/droppedForeignRuns 等） | auto（Host + 静态）+ manual | `host/v11-isolation.test.mjs::A34 帧隔离…`（frameSessionId/allowedSessions/scopedRuns/droppedForeignRuns/removedSent）；`client/v11.test.mjs::A38 诊断摘要…` | Host/静态 **PASS**；真机 Network/Console **Unverified**（步骤见 report §16.4） |

## 17. ui-spec v10 A39–A41 映射（v12 展示字段：description / roleName / 搜索）

| # | 条目 | 方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| A39 | 标题优先 description（单行 ≤200；无描述回退命令首行；完整命令在输入块+`title` 悬浮） | auto（Host 采集/序列化 + client mergePoll/静态）+ manual | `host/v12.test.mjs::classifyTool.description…`、`serializeRun…`、`采集范围…`；`client/v12.test.mjs::runTitle（内部函数，源码级）…`、`runTitleTooltip…`、`渲染接线（静态）…`、`mergePoll description…` | Host/Client **PASS**；真机标题/tooltip **Unverified** |
| A40 | 角色 chip：主会话=`lead`；队友/子代理=displayName；未知=`—`；会话标题仍用于 chip | auto（Host roleName + client 静态）+ manual | `host/v12.test.mjs::agent.roleName…`、`roleName 源码兜底…`；`client/v12.test.mjs::AgentChip（静态）…` | Host/Client **PASS**；真机 chip 观感 **Unverified** |
| A41 | 搜索命中 `description` + `agent.roleName`（高亮、即时过滤） | auto（纯函数）+ manual | `client/v12.test.mjs::searchMatch/filterRuns：命中 description 与 roleName…`（大小写不敏感/空 query/未命中断言） | 纯函数 **PASS**；真机高亮 **Unverified** |

## 18. ui-spec v10.1 A42 映射（会话范围下拉 fixed 定位）

| # | 条目 | 方式 | 用例/证据 | 状态 |
|---|---|---|---|---|
| A42 | 浮层 fixed 定位不裁剪：完整可见/可勾选/不越界（翻转·夹取）/滚动·resize 不跑飞/Esc·外点关闭；行菜单 fixed 未回归 | auto（静态 + mini 渲染）+ manual | `client/scope-menu.test.mjs`：静态样式/源码级定位规则；mini 渲染 `top/left/width/maxHeight`、右侧溢出右对齐、窄视口左夹 8px、近底部翻转、矮视口 maxHeight、无空间关闭、Esc/外点/内部点击、resize·scroll 重算、`aria-checked` 立即更新；行菜单 `.tp-menu-fixed`/`.tp-menu` 静态未回归 | 静态/渲染 **PASS**；真机窗口拉窄/贴边/滚动 **Unverified** |

