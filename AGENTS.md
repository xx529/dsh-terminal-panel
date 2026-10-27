# AGENTS.md · dsh-terminal-panel 项目指引

> 给未来会话 / 其他 agent 的项目级指引。**先读本文件，再读契约**；一切硬性接口以
> [`docs/architecture/contract.md`](docs/architecture/contract.md)（**v12**）为唯一契约来源。
> 本文件只描述仓库现状，不发明未实现的能力。仓库：<https://github.com/xx529/dsh-terminal-panel>

## 1. 项目定位

DSH（DeepSeek Harness）双端插件 `dsh-terminal-panel`（`package.json` version `0.1.0`，`private`）：
在会话头部 View 标签栏新增「终端」tab（`conversation.view`，`id: terminal-panel`，`order: 30`），把
**当前会话 + 子代理 + Agent Team 队友** 的 bash 前台执行、后台任务（`ctx.jobs`）、持久终端（`ctx.terminals`）
输出聚合成**只读**的卡片网格面板（v12：标题优先 description/角色名 chip/P0 会话隔离/统一卡宽 grid；详见 §4）。

- 代码侧已交付（见 §9）；**用户已确认整体可用（v0.1.0，2026-10-26，口头确认、未逐条留证）**。
- 双端形态：Host 半端 = ESM Cordis 插件；Client 半端 = 单文件 classic script（`window.__ModuleLoader__.load`）。
- 无运行时依赖、无构建步骤。

## 2. 目录地图

```
.
├── AGENTS.md                     # 本文件（项目级 agent 指引）
├── LICENSE                       # MIT（2026，xx529）
├── README.md                     # 交付说明 / 门禁 / 已知限制 / 链接
├── package.json                  # 双端 bundle 清单 + scripts（check/test/smoke/verify）
├── cordis.patch.yml              # Host 行走线（- insert: { id: terminal-panel, name: dsh-terminal-panel }）
├── icon.svg                     # Plugin Manager 图标（原创终端字形）
├── locale/{zh,en}.json           # Plugin Manager 展示元数据（meta.title/description）
├── lib/
│   ├── index.js                  # Host 半端入口（ESM：export { name, inject, apply }）
│   ├── host/*.mjs                # Host 半端 13 个模块（lib/index.js + 13 = 14 个 host 侧文件）
│   │   ├── panel.mjs             #   插件装配 / poll & kill 调度 / dropStreak / diagnostics
│   │   ├── route.mjs             #   exact HTTP 路由 + 认证 + 错误映射
│   │   ├── store.mjs             #   Run 注册表（选择集/游标/保留窗口/meta 截断/notice）
│   │   ├── frame.mjs             #   帧组装 + Tier1/Tier2 预算与 H1 保底
│   │   ├── cursors.mjs           #   字节增量 / planReads 公平分配
│   │   ├── terminal-window.mjs   #   行坐标增量（computeTerminalDelta 等）
│   │   ├── terminal-events.mjs   #   v7：terminal_* 事件旁路（三级发现级 3 + inputs 采集）
│   │   ├── status.mjs / tree.mjs / classify.mjs
│   │   └── capture-bash.mjs / capture-jobs.mjs / capture-terminals.mjs
│   └── client.js                 # Client 半端单文件 classic script（≈3.1k 行；无独立 lib/client 目录）
├── tests/                        # *.test.mjs（tests/{client,host,e2e}/ + helpers/）
│   ├── client/                   #   纯函数 + 装配 + 静态样式检查
│   ├── host/                     #   纯模块 + panel 集成
│   └── e2e/smoke.mjs             #   端到端冒烟脚本（可独立运行）
├── scripts/smoke-host.mjs        # Host mock ctx 冒烟（91 checks）
├── docs/
│   ├── design/ui-spec.md         # v10.1 设计规格（验收基线）
│   ├── architecture/contract.md  # **唯一契约来源（v12）**
│   ├── research/dsh-plugin-apis.md # scout T1 平台取证（事实来源）
│   ├── research/terminal-panel-followup-2026-10-26.md # v7 真机缺陷取证（若存在）
│   ├── testing/{acceptance-matrix,report,integration-report}.md
│   ├── retro/2026-10-26-bash-live-source.md
│   └── install.md                # 安装 / 生效 / 验证 / 回滚
└── deploy/                       # 发布+安装脚本目录（deploy/publish-and-install.sh，由发布脚本任务交付）
```

## 3. 常用命令与门禁

```bash
npm run check      # node --check lib/index.js && node --check lib/client.js
npm test           # node --test "tests/**/*.test.mjs" → 382 tests / 382 pass
npm run smoke      # node scripts/smoke-host.mjs → 91/91 checks，exit 0
npm run verify     # check → test → smoke（当前 exit 0）
node tests/e2e/smoke.mjs   # 端到端冒烟（独立脚本，exit 0）
```

**门禁：任何改动后必须跑 `npm run verify` 并通过（exit 0）。** 不依赖网络、不装依赖。
当前基线：**382 tests / 382 pass / 0 fail / 0 skip / 0 todo；smoke 91/91；`npm run verify` exit 0**（实测，2026-10-26）。

## 4. 硬约束（摘自 contract v12，违反即缺陷）

1. **唯一集成点**：客户端 Slot `conversation.view`（`name: 'conversation.view'`、`id: 'terminal-panel'`、`order: 30`、`locale` 词典 + `label` 函数）。禁止自绘 tab。
2. **Client 半端形态**：`lib/client.js` 是**单文件 classic script**：`window.__ModuleLoader__.load({ id: 'dsh-terminal-panel', factory(require) {…} })`；**无 JSX/TS/import**；只允许 `require('react')`（平台模块表）；样式自己注入 `<style data-plugin-css>` 并在卸载时移除。禁止 `host.call` / `styles.insert`（那是动态 Cordis 包的能力）。
3. **传输**：Host 用 `ctx.webServer.register({ kind:'exact', path:'/terminal-panel/rpc' })`，Client 用同源 `fetch` POST JSON；请求 `{ reqId, method, params }`，响应 `{ ok:true, value } | { ok:false, error:{ code, message, details? } }`；认证用 `ctx.connection.requestRejection({ headers })`。方法：`panel.hello` / `panel.poll` / `panel.kill`（contract §4.1/§4.2）。
4. **帧预算三级**（contract §4.3）：Tier1 `maxFrameBytes` = 输出文本字节；Tier2 同参数整帧 JSON 兜底且**至少保留 1 条 Run**（H1 保底，`pickFallbackRun`）；Tier3 262144 防御性上限。**`nextCursors` 只前移已实际交付的字节**，部分交付只退回未交付后缀（`splitDeltaAtBytes`），游标只按 `bounded.nextCursors` 提交（`commitCursorsFromFrame`）。
5. **`removed` 语义**：服务端保留窗口过期/会话结束 → Client **立即删除** run/column/游标；`completedRetainMs` 只用于 `pruneRuns` 本地兜底（contract §4.2 语义 5）。
6. **terminal 行坐标**：`offset` = 距最新行数（0=尾页）；增量按 `totalLines` 差值 + 尾重叠去重；**k<0 才 lossy + 重置基线**（k===0 是正常探尾，不标 lossy）；terminal `truncated` = 输出未完整覆盖（不是分页未取完），不得据此翻页（contract §5.2/§12.6）。
7. **终态单调**：Run 进入 `completed/failed/killed` 后不得回退为 `running`（`mergeRun`/状态机，contract §6.1）。
8. **冻结表**：§11.1（Host 纯模块导出）+ §11.2（Client `__internals`）已冻结；**增删改导出必须先获 maintainer（Lead）批准并同步契约版本记录（§0）**。
9. **样式**：颜色只用 `--dsw-alias-*` 令牌（禁止硬编码 hex 作为前景/背景）；图标用内联 SVG（禁 emoji 占位）；等宽数字用 `tabular-nums`；`prefers-reduced-motion` 下动画瞬时。
10. **禁止**：安装运行时依赖、引入构建步骤（Client 必须单文件）、改 `lib/**` 时假设未写进契约的平台 API、把 `tools/execute` 的结果改掉（旁路观察必须 `return next()`）。
11. **Host 导出形态（H2a）**：`lib/index.js` **只允许具名导出 `name` / `inject` / `apply`，禁止 `export default`**。loader 会拿 default 当插件本体 → 丢 `inject` → `cannot get property "webServer" without inject`，Plugin Manager 仍显示 active 但没有路由。
12. **`apply` 返回值与失败（H2b/H2c）**：`apply` **必须返回 `undefined`**（返回普通对象 → cordis `TypeError: Invalid effect` → 该 fiber 全部 effects 回滚 → active 但路由不存在）；装配失败必须 **`logger.error` + rethrow**，禁止静默 `return`。
13. **真机验证口径**：**不要用无 cookie 裸 curl 判路由** —— 非 `/api` POST 返回 **405 空 body = 路由缺失**；**401 JSON = 路由存在但缺 cookie**（正常）；唯一通过判据是页面内 fetch（`credentials:'include'`）拿到 **`200 {"ok":true,"value":{"protocol":1,…}}`**（或 Network 过滤 `terminal-panel`）。**Plugin Manager active ≠ 插件工作**。发布前自检见 contract §13.5、`docs/install.md` §3.1.1。
14. **terminal 发现链路（v7 纠偏）**：① `ctx.terminals.list(agent)`（agent PTY）→ ② `tools/execute` 事件（默认有效兜底）；`terminalController` 是**侧栏/浏览器终端注册表，与 `ctx.terminals` 互不相通**、**默认关闭**（config 开关缺省 false），开启时来源**仅在 `diagnostics.terminals.source:'sidebar'` 可辨**，**Run 级不区分**（本期裁决，不新增 `Run.source`；UI 不需区分），且不得与 agent PTY 混排。**agent 缺失不得删除 terminal Run**（`meta-only` + `notice`），`removed` 只由 close/会话结束/保留窗口过期产生；禁止静默 0 条，`diagnostics` 每帧必带。
15. **v7 新字段**：`Run.inputs?`（仅 terminal；初始 name + `terminal_send` 文本，末 20 条/单条 ≤2 KiB/合计 ≤8 KiB，丢最旧；bash/job 不加）、`Run.notice?`（**实际产出** `terminal-no-agent`/`terminal-read-failed`；`terminal-controller-unavailable` 为保留值）、`Run.outputMode:'meta-only'`（无 live Agent、读不到连续输出，但可有 tier3 片段：`terminal_open.motd`/`terminal_send.viewport`/`terminal_read.text`，片段非实时全量须标注）；新字段计入 Tier2 帧体积。`config.sidebarTerminals` 默认 false（§9）。
16. **收起与抖动（v7）**：终态后**先展开 + 倒计时 10s（v7 历史机制，v8 起由 linger 取代、不生效）**，到点才折叠（`expanded:false` 且 `deadline:null`，折叠后不渲染倒计时）；入场动画只在首挂载播放；工具栏单行不换行；面板填满高度（运行列固定 + 已完成区自适应滚动）；跟随滚动只用容器 `scrollTop=scrollHeight`（禁 `scrollIntoView`）；标题只显示命令第一条非空行（`firstCommandLine`）。
17. **composer 隐藏（v7）**：终端 tab 生效时隐藏会话输入框；优先官方能力，其次按 scout 方案 A 在 `[data-conversation-content]` set/remove `data-tp-composer-hidden` + CSS 隐藏 `[data-composer-seat]`（找不到锚点静默降级，无 body 兜底）；纯函数 `applyComposerHidden(node, visible)` 返回 boolean；绝不影响其它 tab；`useEffect` 副作用 + 幂等清理。
18. **显示名与状态（v7）**：`Agent` 无 `name` 字段，显示名按 `sessionTitle → sessions 标题 → team/subagent 名称 → 「当前会话」` 取，空值 `—`，**禁止显示 sessionId 长串**；rootAgent 缺失时也要用任一 live agent 列队友。`meta-only` 终端列必须显示 `notice`、**不得显示「运行中」动画**；tier3 片段须标注「非实时全量」。
19. **执行区网格（v8）**：固定宽卡片（默认 352，可拖 280–640）**自动换行** + 整体纵向滚动；**禁止**横向滑动/横向滚动条/右侧 `›` 溢出按钮/剩余角标（v5 横向列条款被 v6 取代，contract §8.1/§12.12 R9）。
20. **Run 三态（v8；v11.1 起 linger=3s）**：`running → linger(3s 滞留：倒计时 + 「收起」按钮，hover/focus 暂停) → completed`；**v7「新终态自动展开已完成分组」已删除（替换，非叠加）**，分组只由用户操作改变（contract §6.7/§12.12 R10）。
21. **会话状态缓存 + resync（v8）**：模块级 `SESSION_CACHE`（LRU 4 / TTL 30min，`{view,cursors,revision,savedAt}`）；切 tab 回首屏不空、游标续传；`retryToken` 变化不清 view。**缓存未命中 / `revision` 回退 / 手动重试时发一次 `panel.poll {resync:true}`**（不发 removed；Host 未实现时静默降级）（contract §6.8/§4.2）。
22. **动画与加载态（v8）**：离开执行区 fade+scale ≈180ms + FLIP 补位 200ms（仅 transform/opacity、不改布局高度）；reduced-motion 瞬时；**首帧前 skeleton ≠ 空态**（空态只在连接 ok 且确认 0 条时显示）。
23. **Host 一致性补丁（v8）**：`removed` 与 `runs` **同帧互斥**（冲突以 runs 为准，`removed` 延后一帧）；`store.prune(now,{protect})` 保护本帧 discovery 已见 Run（防 job 结算后 removed/re-upsert 抖动）；**`revision` 回退 = 服务端重建** → 客户端清本地 view（保留筛选/分组）+ 丢弃在途帧 + 一次 resync（禁止按 `<=` 直接丢弃导致重载后冻住）。
24. **已完成行独立展开（v9）**：`view.group.expandedIds`（布尔集合）驱动，**不复用 `column.collapse`**；行头/组头都可点击；**已完成行不再渲染倒计时/进度条**（`collapse.in`/`tp-countdown`/`tp-progress`；样式/词典暂留，测试兼容，不属于 v8 行为）；`removed`/清空/筛选后裁剪 id（contract §6.9）。
25. **统一卡宽 + CSS grid 铺满（v10）**：`display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--tp-card-w,352px)),1fr));gap:12px;align-content:start`（**auto-fill，禁 auto-fit**）；所有卡等宽、整行铺满、**最后一行单卡不拉伸**；容器 <716px 单列单卡占满为已知边界；v9 flex 方案作废（contract §9.2/§12.12 R15）。
26. **状态色板（v9）**：进行中黄 `--dsw-alias-state-warn-primary`、已完成绿 `--dsw-alias-state-success-primary`、失败红 `--dsw-alias-state-error-primary`；hover/focus 只改 opacity/内描边，**不改布局尺寸**（contract §9.3/§12.12 R13）。
27. **terminal owner 收紧（v11，替换 v9）**：tier1 Agent 解析**严格等于会话树 `scopes`**；**v9「树外 owner 升级 live」作废**；树外 owner 的 terminal 不展示/不解析（计 `diagnostics.droppedForeignRuns`），`knownSessionIds` 只清理「本 root 曾见并离开」的 terminal；`diagnostics.agentsService/agentsProbe/terminalOwners/terminalScopes` 每帧必带（contract §9.4/§14.4）。
28. **2px 状态边框（v10）**：`.tp-col`/`.tp-row` **生效 `border-width:2px`**（旧 1px 字符串仅供 v8/v9 测试断言，文档/验收以 2px 为准）；running warn 65%、linger/completed success 60%、failed error 65%。
29. **hover/focus 只视觉加粗（v10）**：`border-color`→92% + `box-shadow: inset 0 0 0 1px`，**不得改 `border-width`/`width`/`height`/`padding`**（FLIP 测量不抖）。
30. **同步 ghost + FLIP（v10）**：退场卡**渲染期同步派生**并按原 `orderIndex` 插回槽位（非 passive effect 晚一帧）；180ms 淡出后移除，其余卡 FLIP 200ms（仅 transform/opacity）；测量集合含 ghost；`layoutSignatureRef=activeKey|exitingKey`（不含 gridWidth）在 `useLayoutEffect` 比较；同帧移除 >2 张跳过 fade；reduced-motion 瞬时（contract §6.10/§12.12 R16）。
31. **会话隔离（v11，P0）**：**任何帧/存储操作必须 session-scoped，禁止全局选择**——帧选择/增量消费/removed/prune/resync/客户端游标一律传 `sessionIds`（会话树 root+子代理+队友）；`drainRemoved(sessionIds)` 按 owner 取且保留其它会话；`prune` 每会话配额、异会话全量跳过；`resync` 只重置本会话；客户端异会话帧整帧丢弃 + `mergePoll` 不跨会话改写 + 缓存 key 含 `v11-1` 且 sanitize + 切会话清瞬时态（contract §14/§6.11）。
32. **标题优先级（v12）**：卡片/已完成行标题 = `Run.description`（bash/job 工具描述，单行 ≤200 字符）→ 命令第一条非空行；**完整命令仍在输入块与 `title` 悬浮**（悬浮=description+完整 command）；禁止把完整命令塞进标题行。
33. **角色名 chip（v12）**：`agent.roleName` 用于 chip 主标签——root=`lead`、teammate/subagent=会话树 displayName、unknown=`—`；`agent.name`（会话标题）仍用于会话 chip；搜索覆盖 `description`+`roleName`（contract §5.1/§12.2/§12.3）。

## 5. 已知限制（已裁决，不要当 bug 修）

1. **Tab 无角标**：内建 tab 渲染只读 `label`，无 badge API；运行中计数放面板工具栏（contract §12.1）。
2. **持久终端是文本流，不是 xterm 屏幕帧**：平台表无 xterm + 禁装依赖；全屏 TUI 会退化为文本流（§12.2）。
3. **前台 bash 只有终态输出（final-only）**：拿不到 `ShellExecution` 句柄；该类 Run 标「仅终态」、停止禁用（§12.7）。
4. **`⋯` 菜单仅 3 项**：ui-spec §3.7 的「在对话中定位」「在终端中打开（仅终端）」**本期不做**，替代 = 复制命令/复制输出/固定展开（§12.8）。
5. **跨会话聚合待真机验证**（scout U6）；失败时按来源降级（chip 置灰 + 原因），不影响面板主体。
6. **terminal 无 Agent 时只能看元信息（v7）**：`agents.get(sessionId)` 拿不到 live Agent 时默认走 `tools/execute` 事件兜底（`terminalController` 是侧栏终端注册表、默认关闭），`outputMode:'meta-only'` + `notice`，读不到连续实时输出（tier3 片段非全量）；此时停止按钮不可用（该降级仍优于静默 0 条）。
7. **composer 隐藏是 best-effort（v7）**：优先官方能力，否则在 `[data-conversation-content]` set/remove `data-tp-composer-hidden` + CSS 隐藏 `[data-composer-seat]`（找不到锚点静默降级，无 body 兜底）；宿主 DOM 变更可能失效（终端 tab 仍可用，只是输入框未隐藏，其它 tab 不受影响）。
8. **真机 5 项缺陷已代码侧修复，并随 v0.1.0 由用户口头确认整体可用**（2026-10-26；逐条 manual 证据仍缺，对外宣称前需补证）。
9. **v8 展示层行为变更（不是缺陷）**：执行区横向滑动/溢出按钮已废弃（改网格换行）；终态不再自动展开已完成分组（改 linger 3s + 收起按钮；v8 原 10s，v11.1 起 3s）；切 tab 依赖会话缓存（LRU 4/TTL 30min，第 5 个会话不保证首屏不空）。
10. **v9 行为变更（不是缺陷）**：已完成行改为独立展开且**无倒计时**；执行区改为按行铺满（不再固定 352）；状态色为黄/绿/红；树外 owner 的 terminal 可升级 live（未命中仍 meta-only + notice）。
11. **v10 行为变更（不是缺陷）**：状态边框生效 2px；执行区改 CSS grid 统一列宽（**最后一行单卡不拉伸**；容器 <716px 单列单卡占满）；拖右缘只调统一列宽、不再支持每卡独立宽；重排改为同步 ghost + FLIP。
12. **树外 owner 不展示（v11 收紧）**：非本会话树的 terminal owner 不再展示/解析（v9 的「升级 live」作废）；可靠血缘放开（parentSession/agentTeams membership）为 v12 未来项，当前未实现。跨会话数据由 Host 隔离兜底，客户端另有帧级校验。

## 6. 安装与发布

- 官方安装路径（plugin_manager `install_bundle`、生效/验证/回滚）：[`docs/install.md`](docs/install.md)。
- 一键发布 + 安装脚本：`deploy/publish-and-install.sh`（push 到 GitHub + 安装进 DSH profile；支持 `--dry-run`、`--rollback`、`--no-push`、`--no-install`、`--yes`、`--skip-tests` 等；脚本由发布任务交付，若目录尚未生成以 `docs/install.md` 为准）。
  - **`--timeout <秒>`**（默认 **120**，范围 **10–3600**，越界 exit 2）：覆盖 `dsh plugin add/install` 与 `pnpm install`（安装+回滚同路径）的调用；超时统一 **exit 6**。超时实现三路降级 GNU `timeout` → `gtimeout` → `perl alarm` → 无保护（会 warn）；perl 终止时 shell 打印的 `Alarm clock: 14` 属正常。安装优先离线（`pnpm install --offline`），失败才联网且同受超时保护。详见 `docs/install.md` §1.3。
- 生效事实：配置层/启停可 live reload；**替换已安装包代码需重启 DSH 桌面版 + 刷新页面**（contract §0 / install.md §2）。

## 7. 文档索引

| 文档 | 用途 |
|---|---|
| [`docs/design/ui-spec.md`](docs/design/ui-spec.md) | v10.1 设计规格（验收基线，A–F 六板 + 可验收条目 A1–A42） |
| [`docs/architecture/contract.md`](docs/architecture/contract.md) | **唯一契约来源（v12）**：集成/传输/数据模型/状态机/预算/冻结表/会话隔离/展示字段/裁决 |
| [`docs/research/dsh-plugin-apis.md`](docs/research/dsh-plugin-apis.md) | scout T1 平台取证（FACT/INF/ASSUMPTION 事实来源） |
| [`docs/research/terminal-panel-followup-2026-10-26.md`](docs/research/terminal-panel-followup-2026-10-26.md) | v7 真机缺陷取证（terminal 可见性/agent 解析/composer 方案；若文件存在） |
| [`docs/testing/acceptance-matrix.md`](docs/testing/acceptance-matrix.md) | 验收矩阵（ui-spec ↔ 用例） |
| [`docs/testing/report.md`](docs/testing/report.md) | 测试报告（T5 基线 236；最新数字以 tester 报告为准） |
| [`docs/testing/integration-report.md`](docs/testing/integration-report.md) | T6 集成审计（H1/M2 已修，§10 真机清单） |
| [`docs/retro/2026-10-26-bash-live-source.md`](docs/retro/2026-10-26-bash-live-source.md) | T4 触发复盘（closed） |
| [`docs/install.md`](docs/install.md) | 安装/生效/验证/回滚（证据版） |

## 8. 协作约定

- 分支：`main`（发布前不要自行改分支名/强推）。
- 提交信息类型：`feat:` / `fix:` / `test:` / `docs:` / `chore:`（必要时 `feat(deploy):` 这类 scope）。
- **改动前先读契约**（`docs/architecture/contract.md`，尤其 §4/§11/§12）；实现与契约冲突先停下确认，不要静默改行为。
- **契约变更**：必须同步 §0「版本与变更记录」（当前 v12），并说明触发方（Lead 裁决/审计/实现偏差）。
- **测试不得「顺手改绿」**：禁止为了让用例通过而放宽断言或改 `tests/**` 的期望值；实现错就修实现，用例错需先说明理由并获批准。
- 冻结表改动需 maintainer 批准；低风险文案/像素级差异见 contract §12.10（L1–L5）。
- 文档写作用域各归其主（architect=契约/docs；backend=lib/host；frontend=lib/client.js；tester=tests/docs/testing；devops=deploy），改动不要越界。

### 8.1 长步骤、成员失败与结论取证（复盘沉淀，2026-10-26）

> 来源：`docs/retro/2026-10-26-install-pnpm-hang-and-teammate-failure.md`（task-23）与 `docs/retro/2026-10-26-version-residuals-and-scope-assumptions.md`（task-48）。

- **长步骤先报预计耗时**：预计 **>2 分钟**的命令（安装 / 联网 pnpm / 构建 / 全量回归等）开始前用 `send_message` 报「即将执行 X，预计 N 分钟」；执行中至少给一次进度或完成回执，不得长时间静默。
- **成员中途 failed = Lead 立即接手**：teammate `failed` 或无收尾回执时，Lead 立即 `team_task_update` reassign，并**先核对现场**（进程 / 文件 / 安装状态 / 日志 / 任务板 owner）再继续；不得等 owner 自愈或只看任务板状态。
- **「旧构建 / 旧 bundle / 旧页面」类结论必须可复现**：必须附命令与原始输出（如 `git show HEAD:lib/client.js | sed -n '2550,2570p'`、`grep -n`、页面 Network/Console 截图），**不能只给行号摘要或二手判断**；被证伪的假设写进复盘。
- **升版必须列「替换 / 作废清单」**：契约 §0 每次升版列明被替换 / 作废的旧状态机、旧文案、旧样式、旧测试断言（owner: architect）；仍被旧断言锁定的死代码由 tester 登记技术债（owner: tester）。

## 9. 验收基线

- **代码侧已交付**：`382 tests / 382 pass / 0 fail / 0 skip / 0 todo`；`smoke 91/91`；`npm run verify` exit 0（实测，2026-10-26）。
- **v10.1（ui-spec 微）**：浮层 fixed 定位（会话范围下拉完整可见/视口夹取/Esc；A42）——代码侧已修（T74），真机复验待做。
- **v12**：`Run.description?`（bash/job，单行 ≤200）/ `agent.roleName`（chip 主标签）/ 标题 description→命令首行 / 搜索覆盖 description+roleName——代码侧已修（T66/T67），随 v0.1.0 由用户口头确认整体可用；ui-spec v10 新增 A39–A41（manual 证据仍缺）。
- **v11**：P0 会话隔离（帧/增量/removed/prune/resync/游标按会话树隔离）/ terminal owner 收紧（树外不展示）/ 客户端纵深防御——代码侧已交付（T57/T58）。
- **v10**：2px 状态边框 / 统一卡宽 CSS grid（auto-fill、单卡不拉伸）/ 同步 ghost+FLIP——代码侧已交付（T52）。
- **v9**：已完成行独立展开（无倒计时）/ 按行铺满 / 状态色板 / 树外 terminal owner 升级 live / 诊断扩展——代码侧已交付（T43/T44）。
- **v8**：展示层（网格换行 / Run 三态 linger / 会话缓存 / FLIP+fade / 首帧 loading）+ host 一致性补丁（resync / removed-runs 互斥 / revision 回退恢复）——代码侧已交付（T37/T41）。
- **v7 真机反馈 5 项**：terminal 记录可见 / 界面抖动 / 标题首行 / 输出含输入 / 收起时序 / composer 隐藏——代码侧已修（T31/T32），随 v0.1.0 由用户口头确认整体可用；ui-spec v5 新增 A1–A13 可验收条目（其中 A7/A8/A9/A10/A11/A12/A13 含真机/manual 项）；terminal 可见性只对**部署后新发生**的 `terminal_*` 判定（历史 pty 不可回读，不计缺陷）。
- **v0.1.0 验收状态（2026-10-26）**：用户已**确认整体验收通过**（v12 / `fbe8586` / tag `v0.1.0`；**口头确认整体可用、未逐条提供截图/Console/Network 证据**）。ui-spec A1–A42 的逐条真机证据仍缺失（含 19 项 Unverified/manual），**对外宣称验收前需补证据**。详见 `docs/testing/integration-report.md` §15。
- 发布前最小集合（集成报告 §9）：H1/M2 已修；真机 19 项 + `docs/retro` P2 已关闭；新增回归不得让 `npm run verify` 回退。
