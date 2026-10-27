# 终端 · DSH 插件 UI/UX 设计规格（v10.1）

> 设计稿：Figma 本地文档 “Untitled” → Page「命令实况 · UI/UX 设计」
> A `12:2` 主视图 · B `12:240` 会话范围筛选 · C `12:674` 状态与规则 · D `12:1005` Light · E `12:895` 边界状态
> 状态：**v10.1（微：浮层 fixed 定位，契约 v12.1 对应）** — v10（任务描述/角色名展示）之上新增：工具栏「会话范围」下拉与行菜单等浮层统一 **fixed 定位**，不再被父容器 `overflow:hidden` 裁剪。**v11.1（微）**：linger 滞留 10s→3s（`LINGER_DELAY_MS=3000`）。

## v10.1 相对 v10 的变更（微版本：浮层定位修复）

1. **浮层统一 fixed 定位**：工具栏「会话范围」下拉、卡片/已完成行的 `⋯` 菜单等**浮层**一律 `position:fixed`，**脱离父容器 `overflow:hidden`**（修复真机「下拉只露一条」缺陷）。
2. **会话范围下拉**：打开时按**触发按钮 `getBoundingClientRect()`** 计算位置（`top = bottom + 4`；右侧溢出则右对齐并向左夹取），`max-height = min(320, innerHeight - top - 8)`、下方空间不足翻到上方，**视口内夹取**并可内部滚动；**Esc / 外部点击关闭**；`resize` 与面板内滚动（capture）时**跟随锚点重算**，按钮跑出视口/空间不足则关闭；`z-index ≥ 60`。
3. **行菜单（既有 `tp-menu-fixed`）**：已 fixed、外部点击关闭、不被列表裁剪；其**视口翻转/Esc 统一**列为后续项（与下拉的完整规则存在差距，见 §3 规则 34 注）。
4. 纯展示层：无协议/数据变更，冻结表 53 键不变。

## v10 相对 v9 的变更（第十轮：展示字段，契约 v12 对应）

## v10 相对 v9 的变更（第十轮：展示字段，契约 v12 对应）

1. **标题优先 `Run.description`**：卡片/已完成行标题优先显示工具描述（bash/job 的 `exec.arguments.description`，单行 ≤200 字符）；无描述时回退命令第一条非空行；**完整命令仍在输入块与 `title` 悬浮**（tooltip = description + 完整 command）。
2. **`agent.roleName` 角色 chip**：chip 主标签显示角色名——主会话=`lead`、队友/子代理=各自名称、未知=`—`；会话标题（`agent.name`）仍用于会话 chip，`agent.role` 保持。
3. **搜索覆盖**：匹配 command + 输出 + 显示名 + **description + roleName**。
4. **历史口径保持**：linger=3s（v11.1）、2px 状态边框/统一卡宽/会话隔离等 v8/v9/v11 条目不变。

## v9 相对 v8 的变更（第九轮：P0 会话隔离，契约 v11 对应）

1. **会话互不可见**：会话 A 的面板只展示 A 的会话树（root + 子代理 + 队友）的 Run；B 的 Run/终端/removed **不得出现**（Host 帧隔离 + 客户端纵深防御）。
2. **切会话数据完整性**：A→B→A 后 A 的首屏数据完整；B 轮询**不得**消费 A 的未交付增量、不得 prune/removed 掉 A 的数据；切回 A 时清瞬时态（ghost/倒计时/undo/最大化等）并重建 view/游标。
3. **迟到帧丢弃**：异会话迟到帧（`frame.sessionId !== 当前`）**整帧丢弃**，界面**不闪**（保留当前内容 + 限流 warn 一次）；缓存按版本隔离，旧缓存不读。
4. **诊断可见**：`diagnostics.frameSessionId` / `droppedForeignRuns` / `removedSent` 可核对隔离是否生效。
5. **树外 owner 政策（v11 收紧）**：v9 的「树外 owner 升级 live」**作废**；树外 owner 的 terminal 不展示（A27 作废，见 §9 A34–A38）。

## v8 相对 v7 的变更（第八轮：视觉/结构，契约 v10 对应）

1. **状态边框 2px**：`.tp-col`/`.tp-row` **生效宽度 2px**（旧 1px 字符串保留仅供 v8/v9 测试断言兼容；验收以生效 2px 为准）；颜色 mix：进行中 warn 65%、linger/completed success 60%、失败 error 65%。
2. **hover/focus 视觉加粗不改尺寸**：`border-color` 92% + `box-shadow: inset 0 0 0 1px`（约 45% 透明）；**不得改 border-width/width/height/padding**（FLIP 测量/防抖）。
3. **统一卡宽 + CSS grid 铺满**：`repeat(auto-fill, minmax(min(100%, var(--tp-card-w,352px)), 1fr))` + gap 12（**auto-fill，禁 auto-fit**；旧 flex 字符串仅供旧测试断言、grid 下不生效）；所有卡等宽、整行铺满、**最后一行单卡保持同宽不拉伸**；拖右缘 = 统一列宽 280–640（会话级持久化），不再支持每卡独立宽；容器 <716px 单列单卡占满为已知边界。
4. **重排动效替换**：退场 ghost 改为**渲染期同步派生、插回原槽位**（不再晚一帧追加末尾）；180ms 淡出后其余卡 FLIP 200ms（仅 transform/opacity）；FLIP 测量含 ghost；`useLayoutEffect` 比较 signature=`activeKey|exitingKey`（不含 gridWidth）；同帧移除 >2 张跳过 fade；reduced-motion 瞬时。

## v7 相对 v6 的变更（第七轮：可达性/视觉，契约 v9 对应）

1. **已完成行展开独立**：展开由 `view.group.expandedIds`（布尔集合）驱动，**不再复用 `column.collapse`**；已完成行**不再渲染** v7/v5 的 10s 倒计时 + 进度条（`collapse.in`/`tp-countdown`/`tp-progress` 不再渲染；样式/词典暂留，测试兼容）——行头/组头都可点击展开收起（契约 §6.9/§12.12；**替换 v5「终态后行内倒计时收起」**）。
2. **执行区按行铺满**：卡片**按行等宽拉伸铺满**（CSS flex，基准 352、拖右缘 280–640、窄容器单列、无横向滚动；不计算列数）——**替换 v6「固定宽自动换行」**（契约 §9.2）。
3. **状态色板**：进行中黄 `--dsw-alias-state-warn-primary`、已完成绿 `--dsw-alias-state-success-primary`、失败红 `--dsw-alias-state-error-primary`；hover/focus 只改不透明度/内描边、**不改布局尺寸**（契约 §9.3/§12.12 R13）。
4. **树外 owner terminal 可 live**：tier1 Agent 解析范围扩为 `scopes ∪ terminal ownerSessionId`，树外 owner 命中 live 即读实时输出并清 `notice`，不再永久 meta-only/黄框（契约 §9.4/§12.12 R14）。
5. **诊断可见**：`diagnostics` 增 `agentsService` / `agentsProbe` / `terminalOwners`，真机问题可定位（契约 §9.5）。

## v6 相对 v5 的变更（第六轮：展示层重构，契约 v8 对应）

1. **执行区改为网格**：固定宽卡片（默认 352，可拖 280–640）**自动换行**、整体**纵向滚动**；**取消**横向滑动/横向滚动条/右侧 `›` 溢出按钮/剩余列数角标/「可视 3 列」——**v5 §2.1 的「横向列 + 左右滚动」条款被本节取代**（契约 §8.1/§12.12 R9）。
2. **Run 三态**：`running` → 终态后 `linger`（滞留 3s；v6 原 10s，v11.1 起 3s；倒计时 + 「收起」按钮，hover/focus 暂停）→ `completed`（移入已完成分组）。**取代** v5 的「终态后行内倒计时收起 + v7 新终态自动展开分组」——自动展开分组行为**删除**（替换，不叠加；契约 §6.7/§12.12 R10）。
3. **会话状态缓存**：切走 tab 再切回**首屏不空**、游标续传（模块级缓存 LRU 4 / TTL 30min；`retryToken` 变化不清空）；契约 §6.8。
4. **动画**：离开执行区 fade+scale ≈180ms + 其余卡片 FLIP 补位 200ms（仅 transform/opacity，不改布局高度）；`prefers-reduced-motion: reduce` 瞬时。
5. **首帧 loading ≠ 空态**：首帧未到达显示 skeleton/加载态；空态只在「连接 ok 且首帧确认 0 条」显示。
6. **已完成区在执行区下方**，随整体纵向滚动；分组默认折叠、32px 紧凑行保留。

## v5 相对 v4 的变更（第五轮：真机反馈，契约 v7 对应）

1. **标题=命令第一条非空行**：列头命令行与已完成行只显示首条非空命令（折叠连续空白、超长截断 `…`、多行命令末尾 ` +N 行`）；完整原文保留 `title` 属性与输出面板。
2. **输出区含输入块**：输出区顶部先渲染输入——bash/job 完整 `command`（每行 `$ `）；terminal `$ <name>` + `inputs`（每行 `› `）——随后分隔线 + 输出；空输出也显示输入块 + 空文案；`notice` 在输入块上方（仅 terminal，次要色、不阻断阅读）。
3. **收起时序修正**：终态后**先展开 + 显示 Ns 倒计时（10s；**历史值，v8 起已被 linger 取代，不生效**）**，到点才真正折叠（`expanded:false` 且 `deadline:null`）；折叠后不再渲染倒计时徽标/进度条；hover/focus 暂停与恢复语义不变；「已完成分组默认折叠」是分组行为，与行收起无关。
4. **面板高度与抖动约束**：`tp-root` 填满可用高度；运行列区固定（342 容器）+ 已完成区 `flex:1 1 auto; min-height:0; overflow:auto`；工具栏单行不换行、计数 `tabular-nums` + 固定 min-width；入场动画只在**首次挂载**播放（`data-fresh`）；倒计时徽标固定占位；跟随滚动只用容器 `scrollTop=scrollHeight`（**禁 `scrollIntoView`**）。
5. **终端 tab 隐藏会话输入框（composer）**：终端 tab 激活且生效时隐藏 composer，切走/卸载恢复；优先官方能力，否则按 scout 方案 A 在 `[data-conversation-content]` 上 set/remove `data-tp-composer-hidden` + CSS 隐藏 `[data-composer-seat]`（找不到锚点静默降级，**不**用 body 全局属性）；失败绝不影响其它 tab。
6. **终端记录必须可见（数据层）**：发现链路 = `terminals.list(agent)`（agent PTY）→ `tools/execute` 事件兜底（默认有效）；`terminalController`（侧栏终端，`sidebarTerminals` 默认 false）开启时标 `sidebar` 来源，**与 agent PTY 不混排**；`meta-only` + `notice`，禁止静默 0 条（契约 §7.2/§12.11）。
7. **显示名不得是 sessionId（v7 FACT）**：agent/会话名按 `sessionTitle → sessions 标题 → team/subagent 名称 → 「当前会话」` 取；**空值显示 `—`**，禁止把 sessionId 长串当显示名（`Agent` 本身没有 `name` 字段）。
8. **meta-only 列不得误导**：有 `notice` 时必须显示降级提示行；**不得显示「运行中」动画/状态**（无实时输出）；可有 tier3 片段（`terminal_open.motd`/`terminal_send.viewport`/`terminal_read.text`），但必须标注「片段、非实时全量」。


## v4 相对 v3 的变更（第四轮评审）

1. **列内滚轮与跟随**：鼠标在某个终端/输出区域内时，滚轮只滚动该区域（不带动整页）；默认始终贴底看最新输出；手动上翻即暂停跟随；**滚回最底部自动恢复跟随**，无需点击任何按钮。
2. **已完成分组默认折叠**：只显示「已完成 N」一行，点击才展开 32px 紧凑行；进行中列因此获得更大高度（设计稿列高 500）。
3. **列宽定稿**：默认 352，可拖 280–640。
4. 边界态（E 板）新增：输出区细滚动条 + 「已暂停跟随」提示 + 「N 条新输出 ↓」浮层。

## v3 相对 v2 的变更（第三轮评审）

1. **列宽可拖动**：默认 3–4 列；拖列右缘调整宽度（352 ↔ 640，最小 280、最大 640），拖动时显示像素值，松手写入会话偏好，双击右缘恢复默认 352。
2. **⤢ 最大化弹窗**：每列标题右侧提供最大化按钮，打开 980×600 的只读弹窗（遮罩 65% 黑），弹窗内可停止运行、复制全部、滚动输出，Esc/✕ 关闭；弹窗不接管终端输入。
3. **已完成更紧凑**：摘要行 40 → **32px**；分组标题可折叠；整组最高 160px 后内部滚动，避免挤压进行中列。
4. **持久终端只读**：面板内不提供输入，避免与模型抢 PTY 输入。

## v2 相对 v1 的变更（第二轮评审）

1. **运行中的活动改为横向列排列**：每个 Run 一列（宽 352，固定高度），列内输出纵向滚动；3 列正好占满主区，超过 3 个则整条列带**左右滚动**（含滚动条 + 右侧 `›` 按钮 + 角标数字）。
2. **每列/每行的标题都直接显示 agent**：`类型标签 + agent chip（le ad / scout / backend）+ 状态 + 耗时 + 停止`，命令单独一行（mono 11px）。子代理/队友用左侧 3px 竖条与彩色 chip 区分，扫一眼就知道是谁在执行。
3. **Tab 更名「终端」**（`id: terminal-panel`，order 30）。
4. **自动收起（v7 历史机制，已废弃、不生效）**：固定 10s；鼠标悬停或键盘焦点在已完成项上时**暂停计时**，失焦/移出后**再等 10s** 才收起。
5. **默认会话范围**：全部（当前会话 + 子代理 + 队友）。
6. **渲染**：终端类用 xterm（屏幕帧），bash / 后台任务用增量纯文本 tail。

## 1. 集成座位（实现契约）

- 唯一集成点：客户端 Slot **`conversation.view`**（list, session 作用域）：
  `{ name: 'conversation.view', id: 'terminal-panel', order: 30, label: () => t('tab.terminal'), locale: NS }`
- Tab 自动出现在「对话 / 轨迹」之后，**复用内建 tab 样式**（内建渲染器读同一 Slot；禁止自绘 tab 条）。
- 空会话不渲染该 slot（内建行为）。
- Tab 角标 = 运行中数量 + 蓝点，为 0 时隐藏。
- 视图选择按会话持久化（内建机制）。

## 2. 布局规格

外壳沿用宿主：顶条 40 + Session 标题行 44 + Tab 行 36；内容区 = 工具栏 46 + 列表（自适应）+ Composer。

### 2.1 执行区（v8：统一卡宽 CSS grid 铺满，**取代** v7 flex 方案）

| 项 | 规格 |
|---|---|
| 布局 | **CSS grid auto-fill**：`.tp-strip-track{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--tp-card-w,352px)),1fr));gap:12px;align-content:start}`；所有卡等宽、整行铺满、**最后一行单卡保持同宽不拉伸**；整体纵向滚动；已完成区在下方；容器 <716px 单列单卡占满（已知边界）；窄容器**无横向滚动** |
| 卡片宽 / 高 | **统一列宽**基准 **352**、最小 **280**、最大 **640**；拖右缘调**统一** `--tp-card-w`（clamp 280–640，会话级持久化、双击复位 352），**不再支持每卡独立宽**；卡片高 342，列内结构 30/22/264/22 |
| 状态边框 | **生效 2px**：进行中 **黄** `--dsw-alias-state-warn-primary`（mix 65%）；已完成行/卡 **绿** `--dsw-alias-state-success-primary`（60%）；失败 **红** `--dsw-alias-state-error-primary`（65%）；旧 1px 字符串仅供旧测试断言兼容；明暗主题可读，禁止硬编码 hex |
| hover/focus | `border-color`→92% + `box-shadow: inset 0 0 0 1px` 视觉加粗；**不改 border-width/width/height/padding**（不改变布局尺寸/不抖动） |
| 溢出 | **作废**：横向滑动、横向滚动条、右侧 `›` 按钮与剩余列数角标、底部横向滚动条（v5 条款被取代；契约 §12.12 R9）；列多时换行到下一行，不横向滚 |
| 面板高度 | `tp-root` 填满可用高度；执行区 + 已完成区随整体纵向滚动；行数增减不改变面板外框、不顶动 composer |
| 标题行 | `类型标签` + **`agent chip`（主标签=roleName：主会话 `lead`/队友·子代理名/未知 `—`）** + 弹簧 + `状态` + `耗时` + `停止按钮 16×16`（linger 态额外「收起」按钮） |
| 命令行 | mono 11px；**标题优先级：`Run.description`（单行 ≤200 字符）→ 命令第一条非空行**（折叠空白、超长 `…`、多行末尾 ` +N 行`）；`title` 悬浮显示 description + 完整命令；完整命令始终在输入块中 |
| 输出区 | 圆角 8、终端底、内边距 8/9、行高 14.5、字号 10 mono、纵向滚动、自动贴底；**顶部输入块**（bash/job：完整 `command` 每行 `$ `；terminal：`$ <name>` + `inputs` 每行 `› `）+ 分隔线 + 输出；空输出仍显示输入块 + 空文案；`notice` 在输入块上方 |
| 脚注 | 左：pid / terminal id / job id；右：`跟随中`（蓝点）|
| 会话归属 | 左侧 3px 竖条：子代理=蓝、队友=琥珀、当前会话=无 |
| 最大化 | 卡片头 ⤢ → 980×600 只读弹窗（见 F 板） |

### 2.2 Run 展示三态与已完成（v6）

| 阶段 | 位置 | 规格 |
|---|---|---|
| `running` | 执行区卡片 | 正常运行卡片（标题/命令/输出/脚注/停止），不显示倒计时 |
| `linger`（终态后 **3s**） | 执行区卡片 | 保留卡片 + **倒计时徽标（琥珀点 + `Ns 后移入已完成`，固定占位 min-width 152）+「收起」按钮**；hover/focus 暂停倒计时（移出/失焦后重新计 **3s**）；`pinned` 不 arm；到点或点「收起」→ completed |
| `completed` | 已完成分组（执行区下方） | 32px 紧凑行（`chevron` + 类型 + agent 角色名 chip + **标题（description → 命令首行）** + 状态 + 耗时 + `⋯`）；**展开由 `view.group.expandedIds` 布尔集合驱动**（行头/组头均可点击），**不再渲染倒计时/进度条**（样式/词典暂留，测试兼容）；分组默认折叠、整组内滚；**边框生效 2px**（已完成=绿 success 60%、失败=红 error 65%；hover/focus 用 inset shadow 加粗不改尺寸） |

> **替换关系**：v5/v7 的「终态后行内按 10s 收起（**历史值，不生效**）+ 新终态自动展开已完成分组」被 v6 三态取代（linger=3s，v11.1 起）；**v7 再修订**：已完成行的 10s 倒计时/进度条**删除**，展开由 `expandedIds` 独立控制（契约 §6.9）。

### 2.3 工具栏

左：`N 个进行中 · M 条记录 · K 个会话`；中：类型 chips（全部/Bash/后台任务/终端，带计数，单选）；右：会话范围、搜索、`新任务自动展开` 开关、`清空已完成`。

### 2.4 颜色令牌（禁用硬编码）

`--dsw-alias-bg-base / -bg-layer-1 / -bg-layer-2`；`-label-primary / -secondary / -tertiary`；`-border-l1 / -l2`；运行中/成功/失败= `state-business-primary` / `state-success-primary` / `state-error-primary`，后台任务= `state-warn-primary`；圆角 `--dsw-radius-sm/md`；阴影 `--dsw-shadow-lv1`（亮色卡片）/`lv3`（浮层）。代码字体 `--ds-font-family-code`，中文 PingFang SC。

## 3. 交互规则

1. **自动展开**：开关默认开；新 Run 直接以列出现并贴底。
2. **完成收起（v5 修正时序）**：进入终态 → **保持展开**并显示摘要行 + 10s 倒计时（琥珀点 + `Ns 后收起` + 2px 进度条）；**到点才折叠**（`expanded:false` 且 `deadline:null`），折叠后不再渲染倒计时/进度条；未到点前不得提前折叠。
3. **悬停/聚焦豁免**：指针悬停、或键盘焦点在该项内 → 计时暂停；移出/失焦后重新等 10s。
4. **再次展开**：收起后若又有输出（后台任务恢复）→ 自动重新展开并重新计时。
5. **滚轮与跟随**：指针在输出区内时滚轮只滚该区域；默认贴底；上翻即暂停跟随（浮出 `N 条新输出 ↓`）；**滚回底部自动恢复跟随**。
6. **停止**：列标题右侧方形停止键，两击确认（3s 内二次点击）。
7. **更多菜单**：在对话中定位 / 复制命令 / 复制输出 / 在终端中打开（仅终端）/ 固定展开。
8. **清空已完成**：只清当前筛选下的终态项，3s 内可撤销。
9. **动效（v6）**：卡片入场 180ms fade+scale **只在首次挂载播放**（`data-fresh`，轮询重建不重放）；**离开执行区 fade+scale ≈180ms + 其余卡片 FLIP 补位 200ms**（仅 `transform`/`opacity`，不改布局高度）；已完成行高度过渡 200ms；`prefers-reduced-motion: reduce` 全部瞬时；工具栏单行不换行；跟随滚动只用容器 `scrollTop=scrollHeight`，**禁止 `scrollIntoView`**。
10. **键盘**：Tab 可聚焦列/行，`Enter` 展开收起，`Shift+Enter` 固定，`Esc` 退出跟随；弹窗内 `Esc` 关闭。
11. **列宽拖曳**：指针在列右缘 6px 命中区变为 `col-resize`；拖动实时改宽并显示 `384px`；松手写入会话偏好；双击复位 352。
12. **最大化**：列头 ⤢ / 双击列头进入弹窗；弹窗只读、不接管输入，保留停止与复制。
13. **面板高度与抖动（v5）**：`tp-root` 填满可用高度；运行列固定区 + 已完成区自适应滚动；数据更新（轮询 / 新 Run / 终态）不得改变面板外框高度、不得顶动 composer；已完成行顺序严格按 `finishedAt` 稳定，禁止按 `lastOutputAt` 抖动排序。
14. **隐藏 composer（v5）**：终端 tab 激活且隐藏生效时，隐藏会话输入框；切走/卸载恢复；优先官方能力，其次按 scout 方案 A 在 `[data-conversation-content]` set/remove `data-tp-composer-hidden` + CSS 隐藏 `[data-composer-seat]`（找不到锚点静默降级，无 body 兜底）；**绝不改写其它 DOM/影响其它 tab**；实现须幂等（`useEffect` 副作用 + 清理）。
15. **显示名与状态（v7）**：agent/会话名不得显示 sessionId 长串（空值 `—`）；`meta-only` 终端列必须显示 `notice` 提示行，且**不得显示「运行中」动画**；tier3 片段输出需标注「非实时全量」。
16. **切 tab 恢复（v6）**：切走再切回时，若会话缓存命中（LRU 4 / TTL 30min）→ **首屏不空**并用缓存 view + cursors + revision 初始化，随后**游标续传**；`retryToken` 变化（重连）**不得清空** view；缓存只在 TTL/LRU/会话删除/`removed` 时失效。
17. **resync 兜底（v6）**：缓存未命中 / `revision` 回退（Host 重载）/ 手动重试 → 发一次 `panel.poll {resync:true}`，服务端全量重发且**不产生 removed**；Host 未实现时静默降级为普通轮询（不得报错或卡死）。
18. **linger 与「收起」（v6；v11.1 起 3s）**：终态后卡片在执行区滞留 **3s**（倒计时 + 「收起」按钮）；hover/focus 暂停倒计时，移出/失焦重新计 **3s**；点「收起」立即移入已完成（幂等）；`pinned` 不 arm。**不**自动展开已完成分组。
19. **FLIP/fade（v6）**：离开执行区时 fade+scale，其余卡片 FLIP 补位；动画期间不得改变布局高度（不顶动 composer）；`prefers-reduced-motion` 瞬时。
20. **首帧加载态（v6）**：首帧未到达显示 skeleton/加载态（非空态）；空态仅在「连接 ok 且首帧确认 0 条」显示，避免 job-only 场景空/有数据跳动。
21. **已完成行展开（v7）**：行头点击切换 `expandedIds` 中该 runId；组头点击切换 `completedCollapsed`；展开后显示输出块（输入块 + 输出，复用卡片内容）；**不渲染任何倒计时/进度条**（v7 死样式/词典暂留，测试兼容）。
22. **状态色板（v7）**：黄=进行中、绿=已完成、红=失败；明暗主题均可读；hover/focus 只改不透明度/内描边，**不得改变尺寸**。
23. **铺满网格（v8）**：CSS grid `repeat(auto-fill,minmax(min(100%,var(--tp-card-w,352px)),1fr))` + gap 12（**禁 auto-fit**）；所有卡等宽、整行铺满、最后一行单卡不拉伸；容器 <716px 单列单卡占满。
24. **树外 owner（v9 host）**：树外 owner 的 terminal 只要 Agent live 即按实时输出展示（清除 notice/meta-only）；未命中才保留 notice，不得因「不在会话树」而永久 meta-only。
25. **统一卡宽（v8）**：拖右缘调整**统一** `--tp-card-w`（280–640，会话级持久化、双击复位 352），所有卡跟随；不再支持每卡独立宽。
26. **2px 边框 + hover 视觉加粗（v8）**：状态边框生效 2px；hover/focus 只加 `inset box-shadow`/提亮 border-color，**不得改盒尺寸**（FLIP 测量不抖）。
27. **同步 ghost + FLIP（v8）**：退场卡渲染期同步派生并插回原槽位（180ms 淡出），其余卡 FLIP 200ms（仅 transform/opacity）；同帧 >2 张跳过 fade；`prefers-reduced-motion` 瞬时。
28. **会话隔离（v9）**：面板只显示当前会话树的 Run；其它会话的卡片/输出/终端不得出现（Host 按会话过滤 + 客户端帧级校验）。
29. **切会话（v9）**：切走后原会话缓存保留；切回时清 ghost/timers/FLIP/undo/armed/drag/最大化并按缓存+resync 恢复（首屏不空）；不得沿用其它会话的缓存或游标。
30. **迟到异会话帧（v9）**：`frame.sessionId !== 当前` → 整帧丢弃（保留当前 UI、不闪、不重置 revision/游标）；控制台限流 warn 一次，供排障。
31. **标题优先级（v10）**：卡片/已完成行标题 = `Run.description`（若有）否则命令第一条非空行；完整命令保留在输入块与 `title` 悬浮（description 与 command 各占一行）。
32. **角色 chip（v10）**：chip 主标签 = `agent.roleName`（主会话 `lead`、队友/子代理显示各自名称、未知 `—`）；会话标题 `agent.name` 仍用于会话 chip；缺失 roleName 时回退 name。
33. **搜索（v10）**：除 command/输出/显示名外，额外匹配 `description` 与 `roleName`；命中高亮规则不变。
34. **浮层 fixed 定位（v10.1）**：会话范围下拉 / 行菜单等浮层统一 `position:fixed`（**不得**用 `absolute` 依赖父容器，父级 `overflow:hidden` 不得裁剪）。**会话范围下拉**：按锚点 `getBoundingClientRect()` 定位、**视口内夹取**（右/下越界翻转）、`max-height` 限视口内滚动、`Esc`/外部点击关闭、滚动/resize 跟随重算、`z-index ≥ 60`。**行菜单（既有）**：已 fixed + 外部点击关闭 + 右对齐简单夹取（`left ≥ 8`）；其 Esc 与视口翻转统一为后续项（当前不一致，见 A42 注）。

## 4. 筛选

- **类型**：单选 chips，计数为全局值。
- **会话范围（多选）**：当前会话（默认选中）/ 每个子代理（缩进 + 蓝点）/ 每个队友（琥珀点）；面板底部说明「仅显示有命令行活动的会话」。
- **搜索**：匹配命令与输出文本 + `Run.description` + `agent.roleName`（v10），本地即时过滤并高亮。
- 筛选状态仅在会话内存中保留（不跨重启）。

## 5. 数据源与能力

| 类型 | 来源 | 实时 | 渲染 | 操作 |
|---|---|---|---|---|
| Bash（前台） | Host 半端旁路读取 shell 句柄 stdout/stderr（`readFrom(offset)`） | 增量文本 tail | 纯文本；**输入块 = 完整 `command`（`$ ` 前缀）** | 停止/复制/定位 |
| 后台任务 | `jobs` 注册表 + `follow` 偏移续读 | 增量帧 + 终态 | 纯文本；**输入块 = job label/命令** | 停止/复制/定位 |
| 持久终端 | **v7 发现链路（纠偏）**：`terminals.list(agent)`（agent PTY）→ `tools/execute` 事件（默认兜底）；`terminalController`（侧栏终端）默认关闭、开启时标 `sidebar` 且不与 agent PTY 混排；只读 | 行增量；无 Agent 时 `meta-only`（tier3 片段标注非实时全量） | 文本流；**输入块 = `$ name` + `inputs`（`› ` 前缀）** | 只读观看/复制；无 Agent 时不可停止 |

- 归属：`tools/execute` 的 `exec.agent.id` 决定 Run 所属会话；子代理/队友关系由 `subagents.listDescendants` 与 `agentTeams.listMembers` 求得。
- 降级：来源不可用时对应 chip 置灰并注明原因；终端发现降级时 Run 仍可见（`notice` + `diagnostics`），**不得静默 0 条**（契约 §7.2/§12.11）。

## 6. 边界状态

空态（终端字形 + 本会话还没有命令行活动）、暂停跟随浮层、已完成全部收起、输出超长（区内滚动 + 截断提示）、记录 >50 条虚拟化、断线重连游标续读；
**v5 新增**：terminal 仅元信息态（输入块 + `notice` + 空输出文案 + 可选 tier3 片段「非实时全量」标注，不假装有实时流）、终端发现降级（可看 diagnostics 定位，不静默 0 条）、composer 已隐藏态。
**v6 新增**：首帧加载态（skeleton；与空态区分）、切 tab 恢复态（缓存命中时首屏即有内容）、linger 滞留态（3s 倒计时 + 收起按钮；v6 原 10s，v11.1 起 3s）。
**v6 追加（host 一致性）**：job-only 场景不抖动（`removed`/`runs` 同帧互斥、本帧已见 Run 不被 prune）；Host 重载后 revision 回退自动恢复（清 view + resync，不冻住）。
**v9 新增**：异会话迟到帧（整帧丢弃、不闪）、跨会话缓存隔离（旧版本/异会话缓存不读）、切会话瞬时态清理。

## 7. 无障碍与性能

- 状态不只靠颜色（✓/✕/◼ + 文案）；类型文字标签常显；agent chip 带文字名。
- 列/行为 button + `aria-expanded`；停止/更多独立按钮 + `aria-label`。
- 终态变化 `aria-live="polite"`；计时/耗时用 tabular-nums。
- 输出按 rAF 合帧（≥60ms）提交，避免每帧 reflow；只渲染可见列的文本（**v5：不引入 xterm**）。
- 图标用宿主 SVG 图标组件；设计稿中 `› ▾ ✓ ✕ ⌕ ↑` 仅为占位。

## 8. 已确定 vs 仍需确认

已确定：Tab 名「终端」、默认全部会话、混合渲染（终端 xterm / bash·job 纯文本）、只读终端、固定 10s 收起（v7 历史值，已废弃、不生效；当前为 linger 3s）、列宽默认 352（可拖 280–640）、⤢ 最大化弹窗、已完成 32px 紧凑行且分组默认折叠、输出区滚轮独立滚动且在回底时自动恢复跟随。
**v5 追加已确定**：标题只显示命令第一条非空行；输出区顶部含输入块（`$ `/`› ` 前缀）+ 分隔线；倒计时仅展开态可见且固定占位；**到点才折叠**；面板填满高度（运行列固定区 + 已完成区自适应滚动，工具栏单行）；数据更新不重放动画、禁止 `scrollIntoView`；终端 tab 隐藏 composer（失败静默降级）；terminal 记录不得静默 0 条。
**v6 追加已确定**：执行区固定宽卡片网格自动换行 + 纵向滚动（**横向滑动彻底作废**）；Run 三态 running→linger→completed（自动展开分组行为删除）；会话缓存（LRU 4/TTL 30min）切 tab 首屏不空 + 游标续传；FLIP/fade 动画 + reduced-motion 瞬时；首帧 loading ≠ 空态。
**v6 追加（host）**：`poll {resync:true}` 全量重同步（不发 removed、可多帧收敛）；`removed`/`runs` 同帧互斥（runs 优先）+ prune protect；`revision` 回退=服务端重建→清 view + resync。
**v9 追加**：P0 会话隔离——会话 A/B 互不可见；切会话数据完整（不偷增量/不跨会话 prune/removed）；异会话迟到帧整帧丢弃不闪；树外 owner 不再展示（v9 A27 作废）。

仍需确认：无（进入开发）。开发以本规格 + Figma A–F 六张板为验收基线。

## 9. v5/v6 可验收条目（代码侧可验；真机项标 manual/Unverified）

| # | 条目 | 判定标准 | 验证方式 |
|---|---|---|---|
| A1 | 标题首行 | 列头/已完成行只显示首条非空命令；超长 `…`；多行末尾 ` +N 行`；`title` 含完整命令 | 纯函数 `firstCommandLine` 单测 + 视觉 |
| A2 | 输入块 | bash/job 显示完整 command（每行 `$ `）；terminal 显示 `$ name` + `inputs`（每行 `› `）；分隔线 | 浅渲染 / 视觉 |
| A3 | 空输出仍有输入块 | 无输出时显示输入块 + 空文案，不显示空白区 | 浅渲染 |
| A4 | notice | terminal 降级时输入块上方一行次要色提示，不阻断阅读 | 浅渲染 + 真机（manual） |
| A5 | 收起时序（**v7 历史机制，已废弃、不生效**） | 终态后仍展开且倒计时可见；10s 到点才折叠并清 deadline；折叠后无倒计时/进度条 | 纯函数 `collapseVisual` 单测（历史断言） |
| A6 | 暂停语义（**v7 历史机制，已废弃、不生效**） | hover/focus 暂停；移出/失焦重新计 10s；pinned 不 arm | 纯函数单测（历史断言） |
| A7 | 高度稳定 | 新 Run/终态/行数变化时面板外框高度不变、composer 不被顶动；工具栏单行 | 纯函数（排序/counts）+ 真机目视（manual） |
| A8 | 动画不重放 | 轮询重建不重放入场动画；`prefers-reduced-motion` 无动画 | 静态断言 + 真机（manual） |
| A9 | 跟随滚动 | 仅容器 `scrollTop=scrollHeight`，页面不滚动；无 `scrollIntoView` | 静态断言 + 真机（manual） |
| A10 | composer 隐藏 | 终端 tab 激活隐藏、切走恢复、失败静默降级且不影响其它 tab | 交互（manual） |
| A11 | terminal 可见性 | 真机有 `terminal_open` 时面板必须有记录（meta-only 亦算），不得静默 0 条 | 真机（manual）+ Host 用例 |
| A12 | 显示名 | agent/会话名不显示 sessionId 长串；空值显示 `—`；rootAgent 缺失仍能列出队友 | 纯函数/集成 + 真机（manual） |
| A13 | meta-only 不误导 | 显示 `notice` 降级提示；无「运行中」动画；tier3 片段标注「非实时全量」；`notice.code` 实际为 no-agent/read-failed（controller-unavailable 保留） | 浅渲染 + 真机（manual） |
| A14 | 网格按行铺满（v8） | CSS grid `auto-fill`（基准 352/min 280/拖 280–640）；所有卡等宽、整行铺满；无横向滚动条/`overflow-x:auto`/`›` 溢出按钮/`scrollLeft`；窄容器单列 | 静态样式断言 + 真机目视（manual） |
| A15 | Run 三态（v6；v11.1 起 3s） | 终态后进入 linger（卡片仍在执行区 + **3s** 倒计时），到点才进 completed 分组；`running` 不显示倒计时 | 纯函数 `runPhase`/`lingerVisual` 单测 + 真机（manual） |
| A16 | 「收起」按钮（v6） | linger 卡片显示「收起」；点击立即进 completed 且幂等；`pinned` 不 arm | 纯函数 + 真机（manual） |
| A17 | hover/focus 暂停（v6；v11.1 起 3s） | linger 倒计时在 hover/focus 暂停，移出/失焦后重新计 **3s** | 纯函数 `lingerVisual` + 真机（manual） |
| A18 | 切 tab 恢复（v6） | 切走再切回首屏不空、游标续传；`retryToken` 变化不清空 view；LRU 4/TTL 30min 边界正确 | 纯函数/缓存单测 + 真机（manual） |
| A19 | FLIP/fade（v6） | 离开执行区 fade+scale + 其余卡片 FLIP 200ms；仅 transform/opacity、不改布局高度；reduced-motion 瞬时 | 静态/逻辑断言 + 真机（manual） |
| A20 | 首帧 loading（v6） | 首帧前显示 skeleton/加载态而非空态；空态仅在连接 ok 且确认 0 条并经过 **600ms 稳定窗口**后出现（job-only 不闪） | 组件分支断言 + 真机（manual） |
| A21 | 切 tab 回来首屏不空（缓存 + resync 兜底） | 缓存命中 → 首屏直接有内容且游标续传；缓存未命中 / revision 回退 → 发一次 `resync:true`，服务端全量重发、**无 removed 抖动**；Host 未实现时静默降级 | 缓存/revision 纯函数单测 + Host resync 用例 + 真机（manual） |
| A22 | job-only 场景不抖动（v6 追加） | 仅后台 job 时首帧不出现「空态→有数据」跳变；`removed`/`runs` 同帧互斥（runs 优先）；本帧已见 Run 不被 prune | Host 帧不变量用例 + 真机（manual） |
| A23 | 已完成行独立展开（v7） | 行头点击/组头点击均可展开收起；`expandedIds` 纯布尔、不依赖 `view.columns[runId]`；`removed`/清空已完成/筛选后 id 裁剪 | 纯函数/reducer 单测 + 真机（manual） |
| A24 | 已完成行无倒计时（v7） | 已完成行**不渲染** `collapse.in`/`tp-countdown`/`tp-progress`（样式/词典暂留，测试兼容），不显示「Ns 后收起」 | 源码静态断言 + 真机（manual） |
| A25 | 黄/绿/红状态色（v7） | 进行中卡片边框黄、已完成行/卡绿、失败红（生效 2px，mix 65/60/65%）；hover/focus 不改布局尺寸 | 静态样式断言 + 真机（manual） |
| A26 | 铺满网格无横向滚动（v8） | 静态断言 `display:grid` + `repeat(auto-fill,minmax(min(100%,var(--tp-card-w,352px)),1fr))` + `gap:12px` + `align-content:start`，**无 auto-fit**；窄容器单列、无横向滚动 | 静态样式断言 + 真机（manual） |
| A27 | ~~树外 owner 升级 live（v9 host）~~ **v11 作废** | v11 收紧：树外 owner 不再展示/解析（R17）；由 A34–A38 会话隔离条目替代 | —（测试已按 v11 改写，report §16.2） |
| A28 | 诊断可见（v9 host） | `diagnostics.agentsService/agentsProbe{getOk,sampleIds}/terminalOwners{captured,alive,inScope,outOfScope}` 形状与取值正确 | Host 用例断言 + 真机 Network/Console（manual） |
| A29 | 2px 状态边框（v8） | `.tp-col`/`.tp-row` 生效 `border-width:2px`（旧 1px 仅供旧测试断言）；running warn 65%、linger/completed success 60%、failed error 65% | 静态样式断言 + 真机目视（manual/Unverified） |
| A30 | hover 视觉加粗不改尺寸（v8） | hover/focus 只含 `box-shadow: inset 0 0 0 1px`/border-color，**不含** border-width/width/height/padding；FLIP 测量无抖动 | 静态断言 + 真机（manual/Unverified） |
| A31 | 统一卡宽/单卡不拉伸（v8） | grid `auto-fill` 所有卡等宽；最后一行单卡保持列宽、不拉伸；拖右缘改统一 `--tp-card-w`（280–640）；容器 <716px 单列单卡占满 | 静态断言 + 真机（manual/Unverified） |
| A32 | 收起只发生一次 layout shift + 平滑滑动（v8） | 点「收起」后退场卡原位淡出（180ms），其余卡 FLIP 200ms 平滑补位；无二次反向重排/卡片瞬移；同帧 >2 张跳过 fade | 交互（manual/Unverified） |
| A33 | reduced-motion 瞬时（v8） | `prefers-reduced-motion: reduce` 下无 ghost 占位、无 FLIP/fade（瞬时） | 静态/逻辑断言 + 真机（manual/Unverified） |
| A34 | 会话互不可见（v9 P0） | 会话 A 面板不出现 B 的 Run/terminal/removed；A 帧 `scopedRuns` 只含 A 树、`droppedForeignRuns` 不含 B 内容 | Host 用例 `v11-isolation` + 真机双会话（manual/Unverified） |
| A35 | 切回 A 数据完整（v9 P0） | A→B→A 后 A 首屏完整；B 不消费 A 增量、不 prune/removed A 数据；切回清瞬时态后恢复缓存+resync | 缓存/隔离用例 + 真机（manual/Unverified） |
| A36 | 异会话迟到帧丢弃且不闪（v9 P0） | 迟到 B 帧到达 A：整帧丢弃、当前 UI 不闪、revision/游标不变、限流 warn 一次 | 客户端用例 + 真机（manual/Unverified） |
| A37 | removed/prune/resync 不跨会话（v9 P0） | A 帧 removed 不含 B；B 的 prune/resync 不影响 A；`removedSent === frame.removed.length` | Host 用例 + 真机（manual/Unverified） |
| A38 | 隔离诊断可见（v9 P0） | 帧带 `frameSessionId/allowedSessions/scopedRuns/droppedForeignRuns/removedSent`，取值与双会话场景一致 | Host 用例 + 真机 Network/Console（manual/Unverified） |
| A39 | 标题优先 description（v10） | 有 `Run.description` 时卡片/已完成行标题显示描述（单行 ≤200）；无描述回退命令首行；完整命令在输入块 + `title` 悬浮 | 纯函数 `runTitle`/静态断言 + 真机（manual/Unverified） |
| A40 | 角色 chip（v10） | 主会话 chip 主标签=`lead`；队友/子代理显示各自名称；未知=`—`；会话标题仍用于会话 chip | Host/client 用例 + 真机（manual/Unverified） |
| A41 | 搜索命中 description/角色名（v10） | 搜索词可命中 `description` 与 `agent.roleName`（高亮、即时过滤） | 纯函数搜索用例 + 真机（manual/Unverified） |
| A42 | 浮层 fixed 定位不裁剪（v10.1） | **会话范围下拉**：打开后完整可见、可逐项勾选、不被工具栏/列表裁剪；靠右/靠下/窄窗口不越界（翻转/夹取）；滚动/resize 不跑飞；Esc/外部点击关闭。**行菜单**：fixed 不裁剪 + 外部点击关闭（Esc/视口翻转未覆盖，后续项） | 真机（manual/Unverified）：窗口拉窄/贴边/滚动时打开下拉 |
