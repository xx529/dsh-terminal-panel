# dsh-terminal-panel · 架构与契约（v10）

> 状态：**v10（v9 + 视觉/结构增量）** — 真机反馈（边框太细、卡片宽窄不齐/最后一行被拉伸、点收起时卡片瞬移跳变）+ Lead 裁决；T52 Client 实现（纯客户端展示层）。v10 新增：状态边框**生效 2px**（hover/focus 用 inset shadow 视觉加粗、不改尺寸）、执行区改为 **CSS grid `auto-fill` 统一列宽**（**禁 auto-fit**；最后一行单卡保持同宽不拉伸；拖右缘 = 统一列宽 280–640）、重排动效改为**渲染期同步 ghost + 插回原槽位 FLIP**（替换 v8/v9 的晚一帧 ghost）；§11.2 **保持 53 键**；§12.12 R15/R16。
> 设计基线：`docs/design/ui-spec.md`（v4）+ Figma A–F 六板（`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`）
> 读者：backend（T3）、frontend（T4）、tester（T5）、audit（T6）
> 标注口径：`[FACT]` 有可核对证据（附 asar 路径/行号、README 小节或 live inspect）；`[INF]` 由 Fact 推导并写明依据；`[ASSUMPTION]` 未证实，写明验证方式。
> **本文件是双端唯一契约来源**：host 与 client 各自照此实现，不再互相提问；实现与契约冲突时先回报 Lead，由 Lead 决定改实现还是升契约版本。

---

## ★ v2 变更摘要（给 backend / frontend / tester，10 行）

1. **传输不变**：exact HTTP 路由 `POST /terminal-panel/rpc`（同机 popout 先例成立）。`ctx.connection.rpc` 仅记为「备选/后续简化」；backend 不重做（Lead 裁决 1）。
2. **前台 bash 过程输出不可得**（无第三方持有 `ShellExecution` 句柄）→ 改三层：a) `ctx.shell.execute` 只读 tee 为 best-effort（`bashCapture`，失败即 `availability.bashLive` 降级）；b) 始终用 `tools/execute` 记录 Run（status/command，`exec.agent` 可选，缺失不猜）；c) `tools/result` 的终态输出补内容，`outputMode:'final-only'`，UI 标「仅终态」（Lead 裁决 2）。
3. **`terminals.read` 语义定案**：`offset` = 距最新多少行（0=尾页）；`end=totalLines-offset`、`start=max(0,end-count)`；`lineBegin/lineEnd` 同坐标系；绝对行号 = `totalLines - lineBegin`；增量按 `totalLines` 差值取尾页并去重；`truncated` = scrollback 裁剪/单页字节截断（不是「没取完」）。§12.6 的 ASSUMPTION 已替换为 FACT（Lead 裁决 3）。**（v4 修正：terminal `truncated` 还包含「窗口未覆盖最旧行」= `page.truncated || lineEnd < totalLines`，见 §4.3/§5.2）**
4. **客户端没有 `host.call` / `styles.insert`**（那是动态 Cordis 包的闭包符号）；静态 bundle 只能 `require` 平台模块表 11 个键（含 `react`），样式自己 `document.head.appendChild(<style data-plugin-css>)` 并负责移除（Lead 裁决 4）。
5. **元数据补齐**：`icon.svg` + `locale/{zh,en}.json`（`meta.title/description`）；`package.json` 增 `exports["./icon"]`、`exports["./locale/*.json"]`、`files`、`dsh.manifestVersion: 1`。
6. **轮询自适应**：活跃 250ms / 空闲 1000–1500ms / 页面隐藏暂停（不再是恒定 250ms，空闲时降频）。
7. `immediately` = **启动期预取**，不是激活开关；`dsh.client.inject` 是**真实包名**，只控制客户端包加载顺序，不改运行时服务注入。
8. **tester 新增必测纯函数**：`computeTerminalDelta` / `parseToolResultText` / `mapToolResultStatus` / `dedupeTailOverlap`（见 §11）。
9. **tab 角标确定不做**（内建 tab 只渲染 `label`，无 badge API）；计数放工具栏。
10. 五处争议的最终裁决见 §12；已裁决限制见 §12.8；安装步骤升级为 scout 证据版（`docs/install.md` v2）。

---

## 0. 版本与变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-10-26 | 初稿：双端边界、HTTP RPC 契约、数据模型、状态机、降级矩阵、测试契约、脚手架。 |
| v2 | 2026-10-26 | 吸收 scout T1 全部结论：包清单修正（`manifestVersion`/`engines`/`exports ./icon`/`./locale`、`immediately` 语义、`dsh.client.inject` 语义）；客户端运行环境纠偏（平台表 11 键、无 `host.call`/`styles.insert`、样式自注入）；`terminals.read` 行坐标定案；前台 bash 改三层（过程输出不可得，`final-only`）；事件补充 `tools/post-execute` 与 `tools/result`；轮询自适应；`conversation.view` props/合并顺序精确化；元数据（icon/locale）交付；§12 五项裁决 + 已裁决限制；安装文档升级为证据版。 |
| v3 | 2026-10-26 | tester 审计驱动的一致化：①帧预算三级单一语义（§4.3）；②`removed` 语义二分（§4.2 语义 5）；③§11.1/§11.2 冻结导出表；附 HIGH/LOW 缺陷归属与 §9 配置漂移对齐。 |
| v4 | 2026-10-26 | 附录补丁（仅文档）：①`computeTerminalDelta` 的 **k<0** 才 lossy（k===0 是正常探尾，不标 lossy）；②terminal `truncated` = 输出未完整覆盖（`page.truncated \|\| lineEnd < totalLines`），不是分页未取完；③非 live root 会话返回**降级帧**而非 `session-not-found`（仅 sessionId 语法非法才 coded 错误）；④tester C1/C2/C5 定案，C3/C4 标 closed。 |
| v4.1 | 2026-10-26 | T6 集成审计落字（仅文档）：①H1 保底规则（单 Run 元信息截断 ≤4 KiB + `metaTruncated`；Tier2 至少保留 1 条 Run；`nextCursors` 只前移实际交付字节）；②M1 裁决「在对话中定位 / 在终端中打开（仅终端）」本期不做（§12.8）；③M2 实现约束「预算调度与选择集必须是同一集合」；④LOW L1–L5 已知差异表（§12.10）。 |
| v5 | 2026-10-26 | H1/M2 实现对齐（backend `4bc721e`）：§11.1 冻结表增补 4 个 additive 导出（`pickFallbackRun`/`runOutputTextBytes`/`trimRunOutput`/`splitDeltaAtBytes`）与 store 侧 additive 导出/方法（`META_MAX_BYTES`/`truncateMetaText`/`serializeRun`/`frameSelection`/`selectForFrame`/`commitCursorsFromFrame`）；`boundFrameDetailed` 补可选第 3 参 `{preferRunId}`；§4.3 对齐部分交付后缀回退、`bounded.nextCursors` 唯一提交来源、`dropStreak` 保底、`planReads` 公平分配。 |
| v6 | 2026-10-26 | Host 插件装载契约（H2/H2b，真机故障驱动）：ESM **只许具名导出 `name/inject/apply`，禁 `export default`**；`apply` **必须返回 `undefined`**（返回对象 → cordis `Invalid effect` → effects 回滚 → active 但路由不存在）；装配失败必须 `logger.error` + **rethrow**；§13.5 新增发布前自检项；docs/install.md 验证方式修正（无 cookie 裸 curl 不能判路由）。**冻结表未改动**。 |
| v7 | 2026-10-26 | 真机缺陷驱动增量（Lead 裁决；T31 Host / T32 Client 实现）：`Run.inputs?`（terminal 输入采集）、`Run.notice?`、`Run.outputMode:'meta-only'`、`PollResult.diagnostics`（每帧必带）；终端发现**三级链路**（terminals.list → terminalController.list(sessionId) → tools/execute 旁路事件）；修订 §4.2 语义 5「agent 缺失不再删 Run」；§11 冻结表 v7 增补（T31/T32 交接后核对）；§12.11 三条新裁决；ui-spec 升 v5（标题首行/输入块/倒计时时序/抖动约束/composer 隐藏）。 |
| v8 | 2026-10-26 | **客户端展示层增量（host 协议不变）**：客户端会话状态缓存（`SESSION_CACHE` LRU 4/TTL 30min）；Run 展示三态（running→linger→completed，**替换** v7「新终态自动展开分组」）；执行区网格自动换行 + 纵向滚动（**废弃** v5 横向滑动/滚动条/右侧溢出按钮）；fade+scale 180ms + FLIP 200ms 补位（仅 transform/opacity，reduced-motion 瞬时）；首帧前 skeleton 加载态；§11.2 冻结表 v8 增补；§12.12 R9/R10 两条新裁决；ui-spec 升 v6（A14–A20）；另含 **host 一致性补丁**（v8 追加）：`poll.resync`、`removed`/`runs` 同帧互斥 + `prune(protect)`、`revision` 回退=重建（§8.6/§12.12 R11/R12）；ui-spec 追加 A21/A22。 |
| v9 | 2026-10-26 | **真机可达性/视觉增量（替换关系）**：已完成行展开改由 `view.group.expandedIds` 驱动、已完成行**不再渲染** v7 倒计时/进度条（样式/词典暂留，测试兼容；替换 v7 collapse 复用）；执行区**按行等宽铺满**（CSS flex，基准 352、拖 280–640、窄容器单列、无横向滚动，**替换 v8 固定宽自动换行**）；状态色板（黄=进行中/绿=已完成/红=失败）；terminal tier1 Agent 解析扩为 `scopes ∪ store terminal ownerSessionId`（树外 owner 可 `meta-only→live`）；`diagnostics` 增 `agentsService`/`agentsProbe`/`terminalOwners`；§11.2 冻结表**不变（53 键）**；§12.12 R13/R14；ui-spec 升 v7（A23–A28）。 |
| v10 | 2026-10-26 | **视觉/结构增量（替换关系，纯客户端）**：`.tp-col`/`.tp-row` 状态边框**生效 2px**（running warn 65% / linger·completed success 60% / failed error 65%；hover/focus 用 `inset box-shadow` 视觉加粗、**不改盒尺寸**）；执行区 **CSS grid `repeat(auto-fill, minmax(min(100%, var(--tp-card-w,352px)), 1fr))` + gap:12px**（**禁 auto-fit**；所有卡等宽、整行铺满、**最后一行单卡不拉伸**；拖右缘 = 统一列宽 280–640 会话级持久化，不再支持每卡独立宽；容器 <716px 单列单卡占满为已知边界）；重排动效替换为**渲染期同步派生 ghost + 按原 orderIndex 插回槽位**，180ms 淡出后其余卡 FLIP 200ms；signature=`activeKey\|exitingKey`（不含 gridWidth），`useLayoutEffect` 比较 arm；同帧移除 >2 张跳过 fade；reduced-motion 瞬时；§11.2 **保持 53 键**；§12.12 R15/R16；ui-spec 升 v8（A29–A33）。 |

**v2 对 v1 的事实核对结果**：§2 每张表带「scout 复核」列，逐条标 `已核对` / `修正` / `新增` / `无变化`。凡 v1 写错的地方（`host.call`、`styles.insert`、前台 bash 实时输出、`terminals.read` 字节游标、`immediately` 语义）均已在正文改正，不再保留 v1 表述。

### v3 小修记录（2026-10-26，tester 审计驱动；只改文档，不改代码）

| # | 不一致 | v3 定案 | 落点 |
|---|---|---|---|
| 1 | 帧预算两套口径并存：§4.3 写「输出文本预算（不含 JSON 元信息）」，而实现 `buildPollFrame` 用输出文本口径、`boundFrame` 用整帧 JSON 体积 | **统一为三级预算、单一语义**：Tier1 = `maxFrameBytes` 的**输出文本字节**口径（主口径）；Tier2 = 同一 `maxFrameBytes` 的整帧 JSON 兜底（仅当 Tier1 通过但 JSON 仍超限时触发，属兜底而非第二口径）；Tier3 = 路由层 `maxResponseBytes`(262144) 整帧 JSON 硬上限。补 `truncated` 与 `nextCursors` 的一致性不变量（§4.3），并规定可选 `budgetMode` 字段 | §4.3、§4.5、§9 |
| 2 | `removed` 语义自相矛盾：§4.2 语义 5 说「保留 5 分钟」，§11.2 说「删除 run 与 column」 | **二分**：`removed` = 服务端保留窗口过期（`completedLimit` 条 / `completedRetainMs`）或会话结束 → client **立即**删除本地 Run/Column/游标（**以 §11.2 为准**）；`completedRetainMs` 只用于「服务端仍保留、但已终态」的 Run 在客户端的**本地兜底淘汰**，与 `removed` 无冲突 | §4.2 语义 5、§11.2 |
| 3 | 纯函数导出清单散落在两处、与实现漂移 | **冻结表**：§11.1 补「Host 纯模块导出冻结表」，§11.2 补「Client `__internals` 冻结表」；**此表冻结，改动需 Lead 批准**；与 `lib/host/*.mjs` 实际导出、`lib/client.js` 的 `__internals` 逐一核对一致 | §11.1、§11.2、§13.3 |

**缺陷修复归属（v3 记录，代码不在本任务范围）**：

| 级别 | 归属 | 缺陷 | 回归证据 |
|---|---|---|---|
| HIGH | backend | `lib/host/terminal-window.mjs` 行增量拼接/去重时**丢换行** | `tests/host/terminal-window.test.mjs` 增加「跨页拼接保留 `\n`」用例 |
| HIGH | frontend | `lib/client.js` `mergeRun` **终态非单调**（终态 Run 收到旧/重复帧可能回退为 running） | `tests/client/merge-poll.test.mjs` 增加「终态后再收 running 帧保持终态」用例 |
| LOW | backend | `lib/host/frame.mjs` `boundFrame` **1 字节边界**（`≤ limit` 放行 / `> limit` 裁剪的判定与 `headBytes` 不切半个码点的边界需一致） | `tests/host/frame.test.mjs` 增加 limit±1 与多字节码点边界用例 |

**v3 顺带对齐的实现-契约漂移（无行为变化）**：`hello.limits.idlePollHintMs` 当前实现未发（client 用常量 1000ms）→ 契约改标**可选**；`maxFrameBytes` 实际夹取范围 1024–1048576（契约原写上限 262144）→ 已按实现更正；`terminalTailOverlapLines`/`finalOutputBytes` 并非 Host 配置项（前者是 `DEFAULT_OVERLAP_LINES=32` 常量，后者是 `parseToolResultText` 的默认参数 32768）→ 已从 §9 配置表移到实现常量说明。

### v4 附录补丁（2026-10-26，backend 最终回执 + tester C1/C2/C5）

| # | 项 | v4 定案 | 落点 |
|---|---|---|---|
| A1 | `computeTerminalDelta` 的 k 分支 | **k < 0 才 lossy + 重置基线**（scrollback 裁剪/回退）；**k === 0 是每轮空闲都会发生的正常探尾行，不标 lossy、不改基线**（标 lossy 会让面板永久显示缺口）；k > 0 = 尾页增量 + 尾重叠去重 | §5.2、§11.1 |
| A2 | terminal `truncated` 语义（tester C2） | 实现为 `truncated = page.truncated \|\| lineEnd < totalLines`：**表示该会话输出未被完整覆盖**（scrollback 曾被裁剪，或本次窗口未覆盖到最旧行），**不是「本帧没发完 / 分页未取完」**；client **不得据此循环翻页**（历史阅读靠本地缓冲 + 手动上翻 `offset += count`） | §4.3、§5.1、§5.2、F18 |
| A3 | 非 live root 会话（tester C1） | **降级帧优先于 `session-not-found`**：sessionId 合法但无 live Agent → `ok:true` 降级帧（`sessions` 仅 root、`availability.tree.available=false`、`runs:[]`）；**只有 sessionId 语法非法/缺失**才返回 `bad-request` 类 coded 错误（`session-not-found` 保留给「语法合法但服务端无此会话」的极端情况，不作为常规路径） | §4.4、§8 |
| A4 | tester C5（`conversation.view` inject props） | **已核对一致**：v2 F28 已定 `inject` 返回 `{}`（或自定义字段），保留 props 由 renderer 以 owner props 注入且优先级最高；实现与契约一致，无需改动 | F28 |
| A5 | tester C3（`removed` 语义）/ C4（帧预算口径） | **closed**：v3 已分别定案（§4.2 语义 5、§4.3 三级预算），本轮无新增改动 | §4.2、§4.3 |

### v4.1 发布前裁决补丁（2026-10-26，T6 集成审计：H1 / M1 / M2 + LOW）

| # | 项 | 落字 | 归属 |
|---|---|---|---|
| H1 | Tier2 单 Run 超限 livelock（Run 永不显示、`truncated` 永真） | §4.3 新增三条保底规则：①**元信息截断**（`command/cwd/detail/title` 各 ≤4 KiB，Run 标 `metaTruncated:true`）；②**Tier2 至少保留 1 条 Run**（与 Tier1 首条放行对称；该帧允许超 `maxFrameBytes`，但必须 < 262144；若仍超 Tier3，则 Tier3 **截断该 Run 的 output** 而非丢弃整条）；③`nextCursors` **只前移到实际交付字节**，被丢/被截断 Run 绝不前移 | 修复 backend（task-12）；回归 tester（`tests/host/panel.test.mjs`、`tests/host/frame.test.mjs`） |
| M1 | ui-spec §3.7 的「在对话中定位」「在终端中打开（仅终端）」 | **裁决：本期不做**——Run 契约没有 `turn/message` 引用（无法可靠定位到对话节点），插件也不接管宿主终端面板；替代 = 复制命令 / 复制输出 / 固定展开。见 §12.8 | Lead 裁决；README「已知限制」同步 |
| M2 | `planReads` 与 `takeEntries` 选择集错配（running > `maxRuns` 时首帧可能全空） | §4.3 增实现约束：**预算调度与选择集必须是同一集合**（同一候选集、同一排序、同一 `maxRuns` 截断方向），禁止一个函数取最旧 32、另一个取最新 32 | 修复 backend（task-12）；回归 tester（40 running 首帧有输出的用例） |
| L1–L5 | 硬编码中文 / 行高与停止按钮像素偏差 / hello 未发 `idlePollHintMs`·`budgetMode` / `formatCountdown` 文案 / 测试桩 `ctx.on` | 见 §12.10「已知差异」表：L1 归 frontend 后续，L2/L3/L4 不修（可接受），L5 已修 | 见 §12.10 |

### v5 H1/M2 实现落地（backend commit `4bc721e`，2026-10-26）

| 项 | 实现要点 | 落点 |
|---|---|---|
| H1-元信息 | `store.serializeRun` 对 `title/command/cwd/detail` 逐字段 `truncateMetaText`（`META_MAX_BYTES=4096`，UTF-8 安全、末尾 `…`），任一被截断 → `Run.metaTruncated:true`；单 Run JSON 元信息从此有上界 | `lib/host/store.mjs`；§4.3、§5.1 |
| H1-保底 | `boundFrameDetailed(value, maxBytes, {preferRunId?})` 在整帧裁剪后**至少保留 1 条 Run**：`pickFallbackRun` 优先 `preferRunId` → 最新且 running → 最新；必要时用 `trimRunOutput` 二分最大可交付 output 文本（可为 0）并置 `truncated`，保留 status/元信息；返回 `{value, droppedRunIds, trimmedRunIds, deliveredBytes}` | `lib/host/frame.mjs`；§4.3 Tier2 |
| H1-部分交付 | `panel.poll` 对被**部分交付**的 Run 只用 `splitDeltaAtBytes(delta, deliveredBytes)` 退回**未交付后缀**；游标**只**按 `bounded.nextCursors` 提交（`store.commitCursorsFromFrame`），绝不按 Tier1 读取计划提交 | `lib/host/panel.mjs`；§4.3 |
| H1-dropStreak | 每 Run 记录「连续多少帧未出现在最终帧」：`>=2` 的 Run 下一帧被强制提到最前，并作为 Tier2 保底 `preferRunId`（消除「连续 3 帧被丢且零字节」的长尾） | `lib/host/panel.mjs`；§4.3 |
| M2 | `planReads` 接收 **`store.frameSelection` 的同一选择集**（focus → running startedAt 升序前 N → completed），预算按「剩余预算 / 剩余 Run 数」**公平分配**（focus 先拿 ≤16 KiB），40 running 不再出现「32 列零输出」 | `lib/host/cursors.mjs`/`store.mjs`；§4.3 |
| Tier3 | 修复后单 Run JSON 有硬上界，Tier2 已能保底交付，**Tier3 成为不可达的最后防线**（仅异常防御） | `lib/host/route.mjs`；§4.3 |

**v5 additive 导出（Lead 已批准扩冻结表，详见 §11.1/§11.1.1）**：`frame.mjs` 的 `pickFallbackRun`/`runOutputTextBytes`/`trimRunOutput`/`splitDeltaAtBytes`；`store.mjs` 的 `META_MAX_BYTES`/`truncateMetaText`/`serializeRun` 与 store 实例方法 `frameSelection`/`selectForFrame`/`commitCursorsFromFrame`（后三者为 `createRunStore()` 返回对象上的方法，不是模块顶层导出）。

### v6 Host 插件装载契约（H2/H2b，2026-10-26 真机故障驱动）

| # | 规则（违反即故障） | 违反后果 / 真机证据 |
|---|---|---|
| H2a | Host 半端 ESM **只允许具名导出** `name` / `inject` / `apply`；**禁止 `export default`** | loader 会把 ESM 默认导出（函数）当作插件本体 → `name`/`inject` 等具名元数据全部丢失 → `apply` 访问 `ctx.webServer` 抛 `cannot get property "webServer" without inject`。对照可用先例：`@local/dsh-popout-window` 同样只有 3 个具名导出 |
| H2b | **`apply` 必须返回 `undefined`**（本项目约定；cordis 只接受 `undefined`/清理函数/thenable/Iterator/AsyncIterator 作为 effect） | 返回普通对象 → cordis 4.0.5 抛 **`TypeError: Invalid effect`** → 该 fiber 的**全部 effects 回滚** → Plugin Manager 行仍显示 **active**，但 `POST /terminal-panel/rpc` **405 空 body**（路由从未注册，隔离复现 `route registered:false`） |
| H2c | 装配失败必须 **`logger.error` + `throw`**（禁止 `logger.warn` 后静默 `return`） | 静默失败会让 Plugin Manager 显示 active 而实际不可用，排障被误导；抛出后 fiber 进入 failed，Plugin Manager 可见 |
| H2d | 路由注册、依赖注入、capture 装配失败都必须让 fiber 可见失败；cleanup 仍要幂等 | 部分失败时已注册的 effect 需可清理，避免残留路由/监听 |

真机证据（2026-10-26，修前/修后同一 `POST /terminal-panel/rpc`、无 cookie）：

| 状态 | 响应 | 含义 |
|---|---|---|
| 修复前 | **405，空 body** | 路由未注册（尽管 Plugin Manager 行 active）→ 即 H2a/H2b 故障表现 |
| 修复后 | **401** `{"ok":false,"error":{"code":"unauthorized","message":"request rejected by the host connection fence"}}` | 路由已存在，被 `connection` 认证栅栏拒绝（**不是** 405） |
| 隔离复现（cordis 4.0.5） | `TypeError: Invalid effect` + `route registered:false` | 确认 `apply` 返回对象是 H2b 的直接根因 |

代码位置与修复：`lib/index.js`（H2 修复 commit `32bbaf4`；H2b 修复 commit `d51ea5f`），入口注释已写明上述契约。发布前自检见 §13.5；安装侧验证方式见 `docs/install.md` §3.1 V5。

### v7 真机缺陷驱动增量（2026-10-26，Lead 裁决；T31 Host / T32 Client）

> 触发方：用户真机反馈 5 项缺陷（① terminal 记录恒 0 条 / ② 界面每帧抖动 / ③ 标题只见半截命令 + 输出不含输入 / ④ 收起时序错误 / ⑤ 终端 tab 仍显示 composer）。
> 实现者：Host = T31（`lib/index.js`/`lib/host/**`），Client = T32（`lib/client.js`）。**本节所有字段/导出以实现为准**，T31/T32 交接后逐条核对（见 §11 增补标注）。

#### 7.1 新数据模型字段（全部可选/后向兼容；旧客户端忽略即无影响）

| 字段 | 类型 | 适用 | 规则 |
|---|---|---|---|
| `Run.inputs?` | `string[]` | **仅 terminal** | 初始为 terminal 名称（`terminal_open` 的 name / snapshot.name），随后追加捕获的 `terminal_send` 文本；**保留最后 20 条、单条 ≤2 KiB、合计 ≤8 KiB**，超出丢最旧。bash/job **不新增**该字段（Client 从 `run.command` 推导输入块） |
| `Run.notice?` | `{ code: NoticeCode; message: string }` | 全部来源（当前仅 terminal 使用） | 降级提示；`NoticeCode = 'terminal-no-agent' \| 'terminal-read-failed' \| 'terminal-controller-unavailable'`（可扩展，Client 未知 code 按通用提示渲染）。**v7 实现口径**：实际只产出 `terminal-no-agent` / `terminal-read-failed`；`terminal-controller-unavailable` 为**保留值**（`sidebarTerminals` 默认关闭时不产生；开启且 controller 缺失时原因写在 `diagnostics.terminals.reason`）。UI 在输入块**上方**显示一行次要色提示，不阻断阅读 |
| `Run.outputMode` | 新值 `'meta-only'` | terminal | **v7 定义**：无 live Agent、**读不到连续实时输出**；但**可能有 tier3 事件片段输出**（`terminal_open.motd` / `terminal_send.viewport` / `terminal_read.text` 追加进 `output`）——这些片段**非实时全量**，UI/校验必须标注来源与「片段」语义，**不得**据此判定为实时流完整。UI 显示输入块 + notice + 片段/空输出文案 |
| `PollResult.diagnostics` | object（**每帧必带**） | 全部帧 | `{ rootSessionId, agentFound, agentCount, scopes, terminals{ candidates, source:'terminals'\|'sidebar'\|'events'\|'none', reason? }, agentsService:boolean, agentsProbe:{ getOk:boolean, identityOk:boolean, sampleIds:string[] }, terminalOwners:{ captured,alive,inScope,outOfScope } }`（v9 扩展；实现另含 agentsAccess/sessionIdMatchesAgent/terminalScopes/tier1Terminals/metaOnlyTerminals/owner* 等定位字段，见 §4.2 TS 定义）；`'sidebar'` 仅当显式开启 terminalController（默认关）时出现；体积小、必须发送（旧客户端忽略）。这是下一轮真机定位的唯一证据来源 |

#### 7.2 终端发现链路（v7 纠偏版；替换 §5.2 terminal 行的「发现」列，其余列语义不变）

> **FACT（scout T30 + Lead 裁决）**：`ctx.terminals`（agent PTY，owner = Agent 对象）与 `terminalController`（**侧栏/浏览器终端**注册表，sessionId 键）**互不相通**。`terminalController.list(sessionId)` **不是** `terminal_open`（agent PTY 工具）可见性的修复依据，不能把两者混排。

| 级 | 数据源 | 默认 | 命中行为 | 失败/降级 |
|---|---|---|---|---|
| 1（主） | `ctx.terminals.list(agent)` | **开** | v9：Agent 解析范围 = **会话树 `scopes` ∪ `store` 中 terminal Run 的 `ownerSessionId`**（树外 owner 命中 live → 正常登记、清 notice、`meta-only→live` 升级）；agent PTY 正常登记后 `outputMode:'live'`、可读连续输出 | 未命中 live Agent → 保持 meta-only + notice；异常 → 降级到级 3（或配置开启时级 2），reason 写进 `diagnostics.terminals.reason` |
| 2（可选，**非默认**） | `ctx.terminalController.list(sessionId)` | **关**（config 开关缺省 `false`） | 仅在显式开启时登记 Run，来源**仅在 `diagnostics.terminals.source:'sidebar'` 可辨**；**Run 级不区分**（本期裁决：不新增 `Run.source`，UI 不需区分），但不得与 agent PTY 混排混淆 | 服务/方法不存在或抛错 → 级 3；reason 进 diagnostics |
| 3（默认有效兜底） | `tools/execute` 旁路事件：`terminal_open` / `terminal_send` / `terminal_read` / `terminal_close` / `terminal_kill` | **开** | `terminal_open` 登记「仅元信息」Run（`source:'events'`）；`terminal_send` 追加 `inputs`；`terminal_read`/`terminal_send` 结果里的 `viewport`/`text` 可作为输出**片段**（见下）；`terminal_close`/`terminal_kill` 标终态（**不是删除**） | 无任何事件 → `diagnostics.terminals.source='none'`（此时「终端 0 条」有证据可查） |

**Tier3 输出语义（v7 新增，必须写清）**：

- 无 Agent 时，`terminal_open.motd`、`terminal_send` 的 `result.value.viewport` 与 `terminal_read` 的 `result.value.text` 是**唯一可得的真实终端文本**，可追加为 Run 输出（标来源 `tool-fragment` / 截断），作为 `meta-only` 列的补偿路径。
- 其语义是「**模型读写时看到的片段**」：**非连续、可能重复/跳跃、不是实时全量**；UI 必须标注来源，验收**不得**按「实时全量输出」判定。连续实时输出仍以 agent PTY `live` 为准。
- **行边界统一裁定**：事件片段（tier3）与真终端输出（tier1）混用同一 Run 时，行边界由 `terminal-window.mjs::composeTextAppend` 统一裁定（`continuesLine` 决定是否补换行），避免拼接处多/少换行——这是唯一的行边界规则来源（v7）。**合成前导分隔符不计入 terminal 行坐标**：片段（tier3）之后 tier1 真终端接管的首帧会插入一个合成分隔 `\n`，该字节**不计入** `totalLines/lineBegin/lineEnd`（因此 `lineEnd-lineBegin` = 真页行数，而 `text.split('\n').length` = 真页行数+1）；纯片段帧坐标一致。

waterfall 约束：`tools/execute` 监听器必须 `return await next()`，只记录、不改 `exec`。

#### 7.3 契约修订点

1. **§4.2 语义 5 的适用面**：**agent 缺失不再触发 terminal Run 的 `removed`**（旧实现 `collectTerminalRuns` 的 noAgent 分支直接删 Run 是缺陷 ① 根因）。`removed` 只由：`terminal_close`/`terminal_kill`、会话结束、终态保留窗口过期（`store.prune`：`completedLimit`/`completedRetainMs`）产生。
2. **新字段加入帧预算**：`inputs`/`notice`/`diagnostics`（以及 tier3 文本片段）计入 Tier2 整帧 JSON 体积；H1 保底规则不变（至少 1 条 Run 交付）。
3. **历史 terminal 不可回读**（v7 纠偏）：`ctx.terminals` 是进程内、owner-对象身份注册表，owner 卸载即清理；`terminalController.attach` 需要 Remote invocation，Host 插件不可用。→ **验收口径：terminal 可见性只对「部署后新发生」的 `terminal_*` 判定，历史/已卸载 owner 的 pty 一律不算缺陷。**
4. **显示名来源**（v7）：DSH `Agent` 无 `name` 字段（inspect `Agent { id }`），显示名按 §5.1 的四级链取；**rootAgent 缺失时也必须能列出队友**（用任一 live agent 调 `agentTeams.listMembers`，API 只要求 exact live member）。

#### 7.4 §12 新裁决（详见 §12.11）

1. `terminal_open` 记录**必须可见**（不可静默 0 条，必须有 diagnostics/notice 可查）。
2. **输入必须与输出同面板可见**：输出区顶部新增输入块（bash/job = 完整 `command`；terminal = name + `inputs`），空输出也要显示。
3. **终端 tab 激活时隐藏会话输入框（composer）**：优先官方能力；否则按 scout 方案 A 在 `el.closest('[data-conversation-content]')` 上 set/remove `data-tp-composer-hidden` + CSS 隐藏 `[data-composer-seat]`（找不到锚点静默降级，无 body 兜底）；失败必须**静默降级**、绝不影响其它 tab，卸载幂等恢复。

#### 7.5 §11 冻结表增补（v7，已按 T31/T32 实现核对）

**Host 新增纯模块 `terminal-events.mjs`（10 项导出，已列入 §11.1）**：`TERMINAL_INPUT_LIMITS`、`TERMINAL_NOTICE_MESSAGES`、`noticeFor`、`appendTerminalInput`、`terminalToolCall`、`parseTerminalOpenResult`、`parseTerminalSessionStatus`、`parseTerminalCloseResult`、`parseTerminalListResult`、`normalizeControllerTerminal`；`store.mjs` 新增 `normalizeNotice`（§11.1.1）。

**Client `__internals` 新增 3 键（共 41 键，已列入 §11.2）**：`collapseVisual(state, now)`、`firstCommandLine(command, maxLen)`、`applyComposerHidden(node, visible)`。

> `capture-terminals.mjs` 的新导出（`discoverTerminalCandidates` / `createTerminalEventCapture` 等）依赖 `ctx`，属集成模块，不进纯函数冻结表（由 `tests/host/*` 集成用例覆盖）。

### v8 客户端展示层增量（2026-10-26，Lead 裁决；T37 Client 实现）

> **范围**：纯客户端展示层；Host 协议（§4/§5 wire 契约、§9 config）**不变**。触发方：真机反馈 + Lead 裁决。详见 §6.7/§6.8 与 §12.12。

#### 8.1 执行区网格（v8，**已被 v9 §9.2「按行铺满」取代**）

- （v8 历史）执行区 = 固定宽卡片 + 自动换行，整体纵向滚动；**v9 起改为按行等宽铺满（见 §9.2），本节其余「固定 352」表述作废**。
- 窄容器（<360px）：卡片 `max-width:100%` 收缩为单列，**不出现横向滚动**；卡片高保持 342。
- **废弃**：横向滑动、横向滚动条、右侧 `›` 溢出按钮、剩余列数角标、「可视 3 列」概念（ui-spec v5 §2.1 的横向条款被 v6 取代，见 §12.12 R9）。
- 已完成区在执行区**下方**（随整体纵向滚动），分组默认折叠不变。

#### 8.2 会话状态缓存（`SESSION_CACHE`）

| 项 | 规则 |
|---|---|
| 结构 | 模块级 Map；**LRU 最多 4 个会话**、**TTL 30 分钟**；值 `{ view, cursors, revision, savedAt }` |
| 写入 | poll 成功应用帧后 / view 切走（卸载）时保存当前 view + cursors + revision + now |
| 恢复 | 切回 tab 时命中且未过期 → 先恢复 view（**首屏不空**）与 cursors/revision，再开始轮询（**游标续传**，不重拉） |
| 失效 | 超 TTL / LRU 淘汰 / 会话删除 或 `removed` 清空；**`retryToken` 变化不得清空 view**（只重连，不丢本地状态） |
| 清理 | React 卸载清定时器但保留缓存；插件卸载清整个 Map |

#### 8.3 Run 展示三态（**替换** v7「新终态自动展开分组」）

```text
running ──终态──► linger（10s 滞留：倒计时 + 「收起」按钮；hover/focus 暂停）
                     ├── 10s 到 ──► completed（移入已完成分组）
                     └── 点「收起」──► completed（立即、幂等）
```

- `RunPhase = 'running' | 'linger' | 'completed'`；纯函数 `runPhase()` / `lingerVisual()`（§11.2）。
- **替换关系（明确）**：v7 的「新终态自动展开已完成分组」行为**删除**（不再因终态自动展开分组）；分组保持用户折叠状态，终态卡片在 linger 结束后进入完成分组。
- `pinned` 卡片不 arm linger（保持展开，直到手动收起/取消 pin）。

#### 8.4 动画与加载态

- linger→completed 离开执行区：**fade + scale（≈180ms）**；其余卡片 **FLIP 补位（200ms）**，仅改 `transform`/`opacity`，不改布局高度；`prefers-reduced-motion: reduce` 全部瞬时。
- 入场动画仍仅首挂载播放（v5 约束保留）。
- **首帧前 loading**：首帧未到达显示 skeleton/加载态，**不是空态**；空态仅在「连接 ok 且首帧已确认 0 条」且**经过 600ms 稳定窗口**后显示（避免 job-only 场景空态/有数据闪跳）（§12.12）。

#### 8.5 §11.2 冻结表增补 & §12.12 新裁决

- 新增纯函数（**以 T37 交接为准**，见 §11.2）：`runPhase` / `lingerVisual` / `flipDeltas` / `isRevisionRollback` / `createSessionCache` / `SESSION_CACHE` / `LINGER_DELAY_MS` / `CARD_EXIT_MS` / `FLIP_MS` / `pauseLinger` / `resumeLinger` / `collapseLinger`；`__internals` 键数 53（v7 41 + v8 12）。
- §12.12：R9 横向滑动废弃；R10 linger 三态取代自动展开分组；R11 revision 回退=服务端重建→清 view + resync；R12 removed/runs 同帧互斥（runs 优先）。

#### 8.6 Host 一致性补丁（v8，向后兼容的协议增补）

> 真机①②（切 tab 后空/抖动、Host 重载后面板冻结）的独立根因在 host 侧（scout T36 A/B/C），由 T41 实现。**wire 契约仅新增可选参数与不变量，不改变既有字段语义**。

- **`panel.poll { resync?: true }`**：全量重同步（见 §4.2）；客户端 mount 缓存未命中 / revision 回退 / 手动重试时触发。
- **`removed` 与 `runs` 同帧互斥**：同一 runId 不得同帧既 removed 又出现于 runs；冲突以 runs 为准（§4.2 语义 9）；`store.prune(now,{protect})` 保护本帧 discovery 已见 Run。
- **`revision` 回退** = 服务端重建：客户端清空本地 view（保留筛选/分组用户态）+ 丢弃在途帧 + 一次 resync（§4.2 语义 6 / §6.8）。

---

### v9 真机可达性/视觉增量（2026-10-26，Lead 裁决；T43 Client / T44 Host 实现）

> 触发方：真机反馈（已完成行点不开并仍显示倒计时、卡片不铺满、状态色不清、TERM 全部 meta-only、诊断不足）+ Lead 裁决。范围：客户端展示 + host terminal Agent 解析范围 + diagnostics（向后兼容）。**替换关系见 §0 v9 行**。

#### 9.1 已完成行独立展开（**替换** v7 行内 collapse 倒计时）

- `view.group.expandedIds: string[]` = 已完成行展开集合（纯布尔，无 timer/deadline）；`toggleRow(runId)` 只增删 id，**不依赖 `view.columns[runId]`**。
- v7 真因（已定位）：`CompletedRow` 用 `collapseVisual(column.collapse)`，且 `toggleRow` 在 `view.columns[runId]` 缺失时直接 `return` → 行点不开 + 仍显示「10s 后收起」。
- 行头与组头（`toggleGroup`）均可点击展开/收起；`completedCollapsed`（组折叠）仍独立保留；组展开时每行按 `expandedIds` 决定是否展开。
- **已完成行不再渲染** 10s 倒计时/进度条（`collapse.in` / `tp-countdown` / `tp-progress`），也不再复用 `column.collapse`；对应**样式/词典暂留（测试兼容，不属于 v9 行为）**，`collapse.*` 仅作历史状态字段。
- `removed` / `clearCompleted` / 筛选变化后，`expandedIds` 必须裁剪为仍存在的已完成 runId（`mergePoll` 已处理 removed）。

#### 9.2 执行区网格：统一卡宽 + auto-fill 铺满（**替换** v8/v9 的 flex 方案）

- **实现口径（CSS grid，`auto-fill`）**：`.tp-strip-track { display:grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--tp-card-w,352px)), 1fr)); gap:12px; align-content:start; align-items:start }`；`.tp-cell { min-width:0; height:342px }`、`.tp-col { width:100% }`。**旧 `flex:1 1 …` / `min-width:min(280px,100%)` 字符串保留仅供 v8/v9 静态断言兼容，grid 下不生效**（后置 `min-width:0` 覆盖）。
- **统一列宽**：所有卡等宽，列数/列宽由容器宽度与基准宽决定；整行铺满；**最后一行单卡保持同宽，不拉伸**（`auto-fill` 保留空轨道；**禁止 `auto-fit`**——它会把最后一行的单卡拉满）。
- **拖右缘 = 调整统一列宽** `--tp-card-w`（clamp 280–640，会话级持久化；双击复位 352）；**不再支持每卡独立宽**（内层卡片 100% 填充单元格）。
- 已知边界（**不是缺陷**）：容器 < **716px**（2×352 + 12 gap）时单列、单卡占满。
- v8 的「固定 352 自动换行」、v9 的「CSS flex 每行拉伸」**作废**；横向滑动/滚动条/溢出按钮仍作废（R9 保留）。

#### 9.3 状态色板（新增，明暗主题可读）

| 状态 | 颜色令牌 |
|---|---|
| 进行中（执行区卡片边框） | `--dsw-alias-state-warn-primary`（黄） |
| 已完成（已完成行/卡片） | `--dsw-alias-state-success-primary`（绿） |
| 失败 | `--dsw-alias-state-error-primary`（红） |

- 令牌经 Client Theme inspect 确认存在；**禁止硬编码 hex**。
- **生效边框宽度 = 2px**（`.tp-col` / `.tp-row` 后置 `border-width:2px` 覆盖旧 1px；**旧 1px 字符串保留仅供 v8/v9 静态断言兼容**，文档/验收以「生效 2px」为准）。颜色 mix：running warn **65%**、linger/completed success **60%**、failed error **65%**（其余与 `--dsw-alias-border-l1` 混合）。
- hover/focus：`border-color` 提升至 **92%** + `box-shadow: inset 0 0 0 1px`（约 45% 透明）做**视觉加粗**；**不得改 `border-width`/`width`/`height`/`padding`**（`box-sizing:border-box` + 固定 342 高，FLIP 测量不抖）。

#### 9.4 terminal tier1 Agent 解析范围（host 语义变更，向后兼容）

- `ctx.terminals.list/read` 的 Agent 解析范围从「仅会话树 `scopes`」扩为 **`scopes ∪ store 中已有 terminal Run 的 ownerSessionId`**。
- 树外 owner 命中 `agents.get(owner)`（live Agent）→ 走 tier1 读输出、**清 `notice`**、`outputMode: 'meta-only' → 'live'` 升级；未命中保持 meta-only + notice（**仍显示，不删 Run**）。
- 背景：真机 TERM 全部 meta-only 的根因是 owner 在树外（scout T42 强 INFERENCE）；tier1 不再因「不在会话树内」排除。

#### 9.5 诊断扩展（`PollResult.diagnostics` 追加字段）

- `agentsService: boolean`：`ctx.agents` 服务是否可用；`agentsAccess`：service 访问结果；`sessionIdMatchesAgent`：sessionId 能否直接作 `agents.get` key。
- `agentsProbe: { getOk: boolean; identityOk: boolean; sampleIds: string[] }`：抽样验证 `agents.get` 可调用性 + 同引用校验（排查包装/旧引用）+ 样本 id。
- `terminalOwners: { captured: number; alive: number; inScope: number; outOfScope: number }`：terminal owner 身份缓存统计（captured=缓存数、alive=WeakRef 仍活、inScope=命中树内、outOfScope=树外）。
- 保留 `terminals: { candidates, source, reason? }`；全部向后兼容（旧客户端忽略）。

---

### v10 视觉/结构增量（2026-10-26，Lead 裁决；T52 Client 实现；纯客户端）

> 触发：真机反馈（边框太细、卡宽不齐/最后一行被拉伸、点收起时卡片瞬移跳变）+ Lead 裁决。**host 协议不变**（仅客户端 CSS/渲染）。

#### 10.1 状态边框（2px 生效）
- `.tp-col` / `.tp-row` 后置 `border-width:2px` 覆盖旧 1px；**旧 1px 字符串保留仅供 v8/v9 静态断言兼容**（文档/验收以生效 2px 为准）。
- 颜色 mix：running warn **65%** / linger·completed success **60%** / failed error **65%**；hover/focus 提升到 92% + `inset 0 0 0 1px` 视觉加粗，**不改盒尺寸**。

#### 10.2 统一卡宽 + CSS grid 铺满（替换 v9 flex）
- `display:grid; grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--tp-card-w,352px)),1fr)); gap:12px; align-content:start`；**auto-fill，禁 auto-fit**；旧 flex 字符串保留仅供旧测试断言（grid 下不生效）。
- 所有卡等宽、整行铺满；**最后一行单卡保持同宽不拉伸**；拖右缘 = 统一 `--tp-card-w`（clamp 280–640，会话级持久化、双击复位 352），不再支持每卡独立宽。
- 已知边界：容器 < **716px** 时单列单卡占满。

#### 10.3 重排动效（同步 ghost + FLIP，替换 v8/v9）
- 退场 ghost **渲染期同步派生**并按原 `orderIndex` 插回槽位（不再晚一帧 push 末尾）；180ms 淡出后移除，其余卡 FLIP 200ms（仅 transform/opacity）。
- FLIP 测量 `gridItems` 全量（含 ghost）；`layoutSignatureRef = activeKey|exitingKey`（不含 gridWidth），`useLayoutEffect` 比较 arm；同帧移除 >2 张跳过 fade；reduced-motion 瞬时。

#### 10.4 §11.2 / §12.12
- §11.2 **保持 53 键**（v10 无新增纯函数导出，纯 CSS/渲染内部改动）。
- §12.12 新增 R15（auto-fill 统一列宽/单卡不拉伸）、R16（同步 ghost FLIP）。

---

## 1. 目标与非目标

### 1.1 目标（对应 ui-spec §1）

- 在会话头部 View 标签栏新增「终端」tab（`conversation.view` slot，`id: terminal-panel`，`order: 30`）。
- 聚合 **当前会话 + 子代理 + Agent Team 队友** 的 bash 前台执行、后台任务（jobs）、持久终端（terminals）输出，只读观看。
- 进行中按 **CSS grid 统一卡宽网格**展示（`auto-fill`、基准 352、拖 280–640、二维纵向滚动；v10 取代 v8/v9 的固定宽/flex 方案）、Run 三态（running→linger→completed，已完成为 32px 紧凑行分组）、跟随滚动、筛选、搜索、最大化只读弹窗。

### 1.2 非目标

- 不接管终端输入（禁止 `terminals.startSend` / 键盘注入）。
- 不写会话日志、不新增 Session 事件类型（`practices.md` 明确禁止）。
- 不改 host/上层插件：`tools/execute`、`tools/post-execute` 只做旁路观察（必须 `next()` 原样返回）；`ctx.shell.execute` 只做 best-effort 只读装饰且失败可退。
- 不安装任何 npm 依赖，不引入构建工具链（无 xterm、无 TS/JSX、无打包器）。

### 1.3 硬约束（v2 已按 scout 结论修正）

| 约束 | 依据 |
|---|---|
| 禁止 JSX / 只能用 `React.createElement` | 插件 Client 半是纯 JS factory（模板与所有真实三方双端包一致）`[FACT]` |
| 禁止 `require` 平台模块表以外的模块（11 键，见 §2.2） | `dsh-client-modules` 组合期会拒绝未声明的 external `[FACT]` |
| 禁止 `host.call` / `styles.insert` | 二者只属于动态 Cordis 包，静态 bundle 不存在 `host` 服务 `[FACT]` |
| 颜色只用 `--dsw-alias-*` 令牌（实测 55 个） | `practices.md` §UI + scout §7 `[FACT]` |
| 一切注册走 `ctx.effect`，卸载时归还（定时器/监听/路由/`<style>`） | `practices.md` §Stability + scout §8.3 `[FACT]` |
| 单帧响应有界并带截断标记 | 参照 `job-controller` 的 `observeMaxFrameBytes: 65,536` `[FACT]` |

---

## 2. 已核实事实（写实现前必读）

> 证据符号：`asar:` = `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内路径（未压缩，读法见 scout §9.1：`baseOffset = 8 + uint32@4`）；`~` = `/Users/lzx`；`scout §x` = `docs/research/dsh-plugin-apis.md` 对应小节；「live inspect」= 本机运行中 Host 的 `cordis_inspect_query` 返回（2026-10-26）。
> **scout 复核列**：`已核对` = v1 结论经 scout 证据确认；`修正` = v1 写错/不精确，正文已改；`新增` = scout 补充、v1 没有；`无变化` = 与 v1 相同。

### 2.1 包形态与加载

| # | 事实 | 证据 | scout 复核 |
|---|---|---|---|
| F1 | 双端 bundle 清单：`dsh.bundle.patch` 指向 patch；`dsh.client: { platform:'web', immediately?:boolean, inject?:string[], external?:string[] }`；`exports` 必须有 `./client`；Host 半 = 包根入口；`dsh.manifestVersion` 当前为 `1` | `[FACT]` asar:`dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:40-80`（逐字段校验文案）；asar:`.../cordis-plugin-development/templates/decoration/package.json`；`~/.dsh/profiles/desktop/node_modules/dsh-context/package.json` | 修正（补 `manifestVersion`/`external`/`exports ./icon`/`./locale`） |
| F2 | `cordis.patch.yml` = `- insert: [ { id, name, config? } ]`；同 id 覆盖会**整体替换 config**；`dsh.bundle.patch` 可为路径或有序路径数组 | `[FACT]` scout §1.2；`dsh-package-manifest/README.zh.md` | 已核对（补「可为数组」） |
| F3 | Host 半导出 `{ name, inject, apply }`（或默认导出 Service 类）；注册一律 `ctx.effect` 返回清理函数 | `[FACT]` asar:`.../references/host-plugin.md`；`@local/dsh-popout-window/index.js:29` | 无变化 |
| F4 | 客户端 bundle 是 classic script：`window.__ModuleLoader__.load({ id:'<包名>', factory(require){…} })`；factory 返回 `{ inject, apply }`；**无 import/export/JSX**；`id` 必须等于包名 | `[FACT]` asar:`templates/decoration/client.js`；`dsh-context/lib/client.js` 首行（`id:\`dsh-context\``）；scout §1.4 | 已核对（补充 id=包名、无 import） |
| F5 | 模块系统是 lazy CJS：运行 bundle 只注册 factory，副作用在 materialize 时跑；入口与 chunk **不能同步 require 相对 `client*.js`** | `[FACT]` asar:`dsh-client-modules/README.zh.md` §惰性 CJS 模型 | 已核对无变化 |
| F6 | `immediately` 真实语义 = **启动期预取**（`prefetchImmediateTier()`），不是激活开关；不设也能正常注册 slot（`dsh-context` 没设） | `[FACT]` asar:`dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（`prefetchImmediateTier`）；scout §1.1 | 修正（v1 当成「更早注册」的保险；保留 true 只是预取收益，非必需） |
| F7 | `dsh.client.inject` 必须是**真实包名**，语义 = 这些包的客户端半先于本包加载/注册（只控顺序）；**不改变运行时 `ctx` 服务注入**，服务可用性由插件对象 `inject` 决定 | `[FACT]` asar:`dsh-client-modules/README.zh.md`「让动态提供方先于其消费方加载」；`dsh-context` 实例；scout §1.1 | 修正（v1 未区分两者） |
| F8 | 本机 DSH `0.2.1-rc.2`、Node `v22.22.2`、pnpm `11.22.0`；`engines` 在安装/启动时检查（两处文档对「是否强制」有冲突，保守写正确范围） | `[FACT]` asar:`dsh/node_modules/@deepseek-ai/dsh/package.json`；`@deepseek-ai/dsh/README.zh.md:39`；scout §7 | 已核对（`engines.dsh` 收紧为 `>=0.2.1-rc.2 <0.3.0`） |
| F9 | 本地目录安装 = `plugin_manager` `install_bundle(target=绝对包目录)` → profile `package.json` 写 `link:` 依赖 + 选入 `dsh.profile.bundles` + 跑 pnpm；**不要手改 profile 的 package.json/patch，不要自己跑 pnpm** | `[FACT]` asar:`dsh-plugin-manager/README.zh.md:52,60,98-102`；skill `cordis-plugin-development` | 新增（v1 标 ASSUMPTION，现升级为 FACT） |
| F10 | profile 组合顺序：`dsh.profile.bundles`（含各自 patch）→ profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`；本 profile `patchReload: "live"`、`hmr` 服务在跑 | `[FACT]` `@deepseek-ai/dsh/README.zh.md:41-46`；`~/.dsh/profiles/desktop/package.json`；scout §1.3 | 新增 |

### 2.2 客户端运行环境（关键纠偏）

| # | 事实 | 证据 | scout 复核 |
|---|---|---|---|
| F11 | **平台模块表只有 11 个键**可 `require`：`react`、`react/jsx-runtime`、`react-dom`、`react-dom/client`、`@deepseek-ai/cordis`、`zod`、`@tanstack/react-virtual`、`@deepseek-ai/dsh-client-store`、`@deepseek-ai/dsh-client-ui-slots`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-dockkit`；其它请求必须进 `dsh.client.external`，否则组合期报错 | `[FACT]` asar:`dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 内 `function SZ(){return{…}}`；scout §1.4 | 新增 |
| F12 | **`host.call` / `styles.insert` 只属动态 Cordis 包**（agent 用 `cordis` 工具现场写的代码插件）：其浏览器半被求值为 async 函数体，闭包符号是 `React`/`console`/`styles`/`host`。静态 npm 双端包的 Client 半由 `dsh-client-modules` 装载，`factory(require)` + Cordis `ctx`，**没有 `host` 服务** | `[FACT]` asar:`dsh-cordis-client-runner/README.zh.md`；`dsh-cordis-client-runner/lib/client.js:54-68`；全 asar grep `host.call` 仅命中两个 cordis-runner 包；scout §2.1 | 修正（两种插件形态的符号面不同；v1 的方向对，理由重写） |
| F13 | 静态包的样式 = 自己往 `document.head` 插 `<style data-plugin-css>` 并在卸载时移除（`dsh-context` 先例） | `[FACT]` scout §12.4；`dsh-context/lib/client.js` | 修正（v1 写 `styles.insert`，删除） |
| F14 | 主题令牌实测 **55 个** `--dsw-alias-*`，暗/亮由 shell 根属性切换；字体令牌族亦有（`--dsw-*-font*`） | `[FACT]` scout §7；`dsh-web-frontend/dist/assets/index-BxpfOGf3.css` | 新增 |
| F15 | Client 半拿到的 `ctx` 服务：`slots`、`locale`、`sessions`、`uiSession`、`uiConversation` 等；本插件只声明 `['slots','locale']` 即可（sessionId 从 slot `inject(sessionId)` 得到） | `[FACT]` scout §3.4/§12；`dsh-client-ui-trajectory` inject 列表 | 已核对（精确化 props 后不再需要 `sessions`） |

### 2.3 Host 服务与事件（live inspect + scout 逐行核对）

| # | 事实 | 证据 | scout 复核 |
|---|---|---|---|
| F16 | `ctx.jobs`：`list(caller?)`、`get(id,caller?)`、`readAt(id, from, caller?)`、`kill(id,caller?,reason?)`、`wait`、`remove`；`JobView{ id, kind, label, owner?, status:'running'\|'stopping'\|'completed'\|'killed'\|'failed', progress?, detail?, startedAt, finishedAt?, output:{total,earliest,spillPaths?} }`；`readAt` 用**绝对字节偏移**，返回 `{ chunks, next, lossy }`，`next` 当不透明游标；`from` 落在 chunk 内会重发整 chunk；`caller` 是 **owner 围栏**（传目标 sessionId） | `[FACT]` live inspect `Service(jobs)`；scout §4.3 | 已核对（补 `next` 不透明、caller 围栏语义） |
| F17 | `ctx.shell`：`execute(spec)` → `ShellExecution`；`observed.stdout/stderr.readFrom(fromByte)` → `{text,nextOffset,lossy,spillPath?}`（字节）；`readOutput()` 是消费式；`status:'running'\|'completed'\|'killed'`。**shell 是「一个上下文一个实现，重复提供会 throw」的抽象服务**，第三方无法替换实现，也拿不到别的工具创建的句柄（前台 bash 句柄只存在于工具内部） | `[FACT]` live inspect `Service(shell)`；scout §4.2（含 `dsh-shell` 服务描述原文） | 修正（v1 的「包装 `ctx.shell.execute` 按字节 tail」降级为 best-effort，见 §5.2） |
| F18 | `ctx.terminals`：`list(owner: Agent)`、`read(owner,id,{offset?,count?})`、`kill(owner,id,reason?)`、`hasOwnerActivity(owner)`；**`read` 语义（逐行核实现）**：`offset` = 距最新行数（0=尾页），`totalLines` = 当前 scrollback 行数，`end = totalLines - offset`，`start = max(0, end - count)`，返回 `lineBegin = offset`、`lineEnd = offset + 实际返回行数`（同一坐标系），绝对行号 `absoluteBegin = totalLines - lineEnd`、`absoluteEnd = totalLines - lineBegin`；backend 实际 `truncated = page.truncated \|\| lineEnd < totalLines` → **表示输出未被完整覆盖**（scrollback 裁剪，或窗口未及最旧行），v4 定案见 §4.3/§5.2；默认 scrollback 10000 行 / 4 MiB | `[FACT]` live inspect `Service(terminals)`；asar:`dsh-terminal-bash/lib/index.js:582-611`；scout §4.4 | 修正（v1 §12.6 的「绝对行号」ASSUMPTION 作废，见 §12.6；v4 补 truncated 精确语义） |
| F19 | `ctx.subagents.listDescendants(rootSessionId)` → 每项 `{kind:'child', id, activity:'running'\|'inactive', mode, label?, hasChildren, parentId, depth}` 或 `{kind:'diagnostic', id, reason}`（diagnostic 行**没有** activity）；根读失败整体 reject；`ctx.agentTeams.listMembers(agent)` 需 **live Agent**，`tryMembership(agent)` 不抛异常 | `[FACT]` live inspect `Service(subagents/agentTeams)`；scout §4.5 | 已核对（补 diagnostic 无 activity、tryMembership） |
| F20 | `ctx.agents.get(id)`、`list()`、`roots()`；`ctx.sessions.get/list`；`terminals.*` 的 `owner` 是 **Agent 对象**（不是 SessionId）；`jobs.owner` 是 SessionId | `[FACT]` live inspect `Service(agents/sessions/terminals)`；scout §4.6/§11 | 新增（v1 只在映射表里提了一句） |
| F21 | 事件 `tools/execute` 是 **waterfall**：`(exec: ToolDispatchExecution, next) => Promise<ToolExecutionResult>`；`exec.agent` **可选**；无标签监听器（Host 根 ctx 注册）能收到**所有 agent** 的调用；监听器必须 `return await next()`，只允许改 `exec.signal` | `[FACT]` live inspect `Event(tools/execute)`；asar:`dsh-scope/README.zh.md:42,75`；scout §4.1 | 已核对（补 exec.agent 可选、必须 next） |
| F22 | 事件 `tools/post-execute` 是 **waterfall**：`(exec: ToolExecution, result: Readonly<ToolExecutionResult>, next) => Promise<PostToolDecision>`，必须 `next()` 接受原结果；`tools/result` 是 **emit**：`(exec, result: Readonly<ToolExecutionResult>) => undefined`，`result` 是 deep-frozen 的 **lossless JSON final outcome**，listener 失败被隔离，按 `exec.agent` 分派 → **终态输出来源优先用 `tools/result`**（不需要 next，不会污染工具链） | `[FACT]` live inspect `Event(tools/post-execute)`、`Event(tools/result)`；scout §10.2 | 新增 |
| F23 | `ShellExecution` 拿不到时，前台 bash 的终态文本只能来自 `ToolExecutionResult.content`（`ContentBlock[]`，取 `type:'text'`）或 `value`（`JsonValue`）；工具结果不一定含完整输出，需截断保护 | `[INF]` 依据 F22 的 `ToolExecutionResult` 类型 + `ToolFailure{message,info}` | 新增 |
| F24 | Host `ctx.connection`：`rpc.handle(channel,handler)`、`fetch.register(route)`、`requestRejection(request)`、`admit(request)`；`webServer.register({kind:'exact'\|'prefix', path, handler})`、`registerUpgrade`、`tapIndex` | `[FACT]` live inspect `Service(connection/webServer)`；asar:`dsh-client-connection/lib/index.js` | 已核对无变化 |

### 2.4 `conversation.view` slot（scout 逐行核对源码）

| # | 事实 | 证据 | scout 复核 |
|---|---|---|---|
| F25 | `conversation.view` 是 `conversation.session` 的子 slot，声明 `{ kind:'list', scope:'session' }`；**只渲染当前激活 view**：`renderSlot("conversation.view", {...}, { only: viewId })` → 切走即 unmount（轮询/定时器必须随 unmount 清理） | `[FACT]` asar:`dsh-client-ui-conversation/lib/client.js:17940-18060,19798`；scout §3.1/§3.3 | 已核对（补「切走卸载」） |
| F26 | 注册参数：`name`（必须）、`id`（tab 稳定 id，缺省不渲染，也是 view 偏好 key）、`order`、`locale`（词典 NS，声明则注入 `t`）、`label: string \| ()=>string`、`inject: (sessionId)=>props`、`children`（本 slot 不需要）。**内建 tab 只消费 `id` 与 `label`**，无 badge/角标 API | `[FACT]` asar:`dsh-client-ui-conversation/lib/client.js:19556-19568`；`dsh-client-ui-trajectory/lib/client.js:8205`；scout §3.2/§3.3 | 已核对（角标结论不变） |
| F27 | tab 条只在 `tabs.length > 1` 时出现；blank 会话不渲染 view 区；tab 按钮只渲染 `label` 文本 | `[FACT]` asar:`.../lib/client.js:17989,17943,18047-18057`；scout §3.3 | 已核对无变化 |
| F28 | View 组件 props = ①session 标准 props `sessionId`、`useSession`（selector hook）、`useProjection(key)`；②声明 `locale` 才有 `t`；③注册 `inject(sessionId)` 的返回对象（浅合并）；④owner props `inspectCall`、`viewRequest`、`openView`、`completeViewRequest`。合并顺序 `{...kit, ...injected, ...slotInjected.props, ...contextual, ...ownerProps}` → **owner props 优先级最高，不要同名覆盖保留字段** | `[FACT]` asar:`dsh-client-ui-renderer/lib/client.js:667-790`；`dsh-client-ui-session/lib/client.js:754-762`；scout §3.4 | 修正/精确化（v1 只写「标准 props 待证」） |
| F29 | `label` 由 `resolveSlotLabel` 解析，`ctx.locale.subscribe` 会触发 tab 重算 → label 里别做副作用；`t` 不是必有 prop（未声明 locale 时不存在） | `[FACT]` asar:`.../lib/client.js:19556-19620`；scout §3.5 A3-2 | 新增 |

### 2.5 传输通道（本契约选择）

| # | 事实 | 证据 | scout 复核 |
|---|---|---|---|
| F30 | **exact HTTP 路由 + 同源 fetch 是三方包的正规做法**（两个同机先例）：①`@local/dsh-popout-window`：Host `ctx.webServer.register({kind:'exact',path:'/popout/open'})` + `ctx.connection.requestRejection({headers})`；Client `fetch('popout/open', {method:'POST'})`；②`dsh-global-rules`：`ctx.connection.fetch.register({path:'/api/…', methods, requestBody:'buffered', fetch})` + 前端 `fetch('/api/…')` | `[FACT]` `~/.dsh/profiles/desktop/node_modules/@local/dsh-popout-window/index.js:355-393`、`client.js:139`；`dsh-global-rules/lib/index.js:114-123`；scout §2.4 | 已核对（v1 选择成立） |
| F31 | **备选通道 A**：`ctx.connection.rpc.handle('/terminal-panel', handler)`，Client `ctx.connection.rpc.call('/terminal-panel', endpoint, payload, signal)` → `{ok:true,value}\|{ok:false,error:{code,message,details}}`；信封 `{type:'client-request',rpcId,method,payload}`/`{type:'server-response',rpcId,result}`；channel 正则 `/^\/[A-Za-z0-9._~-]+$/` 且 ≠`/api`；只 POST+JSON；handler 抛异常 → HTTP 500 纯文本；**unary 无流式** | `[FACT]` scout §2.3；asar:`dsh-client-connection/lib/index.js:727,855-950`、`lib/client.browser.js:1232-1310` | 新增（本契约**不采用**，理由见 §4.1） |
| F32 | `ctx.connection.rpc` 自动过 Host/Origin 栅栏与浏览器 cookie 认证并带 rpcId；我们的自建 exact 路由要自己复刻 `requestRejection`，且没有 rpcId（用自生成 `reqId` 做日志关联即可） | `[FACT]` F30/F31 对比 | 新增 |
| F33 | 宿主对 unary 频率**未发现显式限流**（`maxRequestBodyBytes` 只限请求体；响应无明确上限）→ 轮询 250ms 安全，但应自适应降频并自限响应 ≤256 KiB | `[INF]` scout §2.5 + §11.14 | 新增 |

---

## 3. 双端模块边界与文件职责

### 3.1 目录与归属

```
dsh-terminal-panel/
├── package.json                # architect（v2：icon/locale/manifestVersion/engines）
├── cordis.patch.yml            # architect
├── .gitignore                  # architect
├── README.md                   # architect
├── icon.svg                    # architect（v2 新增）
├── locale/zh.json, locale/en.json  # architect（v2 新增：meta.title/description）
├── docs/
│   ├── design/ui-spec.md       # ux（已有）
│   ├── research/dsh-plugin-apis.md # scout（T1，v2 依据）
│   ├── architecture/contract.md# architect ← 本文件
│   ├── testing/acceptance-matrix.md # tester（验收基线）
│   └── install.md              # architect（v2 证据版）
├── lib/
│   ├── index.js                # backend：Host 半入口（ESM，export { name, inject, apply }）
│   ├── host/                    # backend：纯逻辑 + 采集器（ESM .mjs，可被 node:test 直接 import）
│   │   ├── classify.mjs        #   工具名/参数 → RunKind
│   │   ├── tree.mjs            #   root + descendants + team members → SessionScope[]
│   │   ├── status.mjs          #   来源状态 → RunStatus（含 tools/result 终态判定）
│   │   ├── cursors.mjs         #   job 字节游标 + terminal 行坐标增量（computeTerminalDelta）
│   │   ├── frame.mjs           #   PollResult 组装 + 截断
│   │   ├── capture-bash.mjs    #   tools/execute 记录 + tools/result 终态 + shell tee（best-effort）
│   │   ├── capture-jobs.mjs    #   ctx.jobs 聚合
│   │   ├── capture-terminals.mjs#  ctx.terminals 聚合（只读）
│   │   ├── route.mjs           #   HTTP 路由 + 认证 + 错误映射（唯一非纯逻辑）
│   │   └── store.mjs           #   进程内 Run 注册表（Map，含保留窗口）
│   ├── client.js               # frontend：Client 半（单文件 classic script，唯一浏览器产物）
│   └── client/                 # frontend：仅测试可 import 的纯函数（不 import React、不被 client.js 引用）
├── scripts/smoke-host.mjs      # backend：mock ctx 冒烟
└── tests/                      # tester：node:test
```

**写作用域**（任务板约定）：architect = `package.json` / `cordis.patch.yml` / `.gitignore` / `README.md` / `icon.svg` / `locale/**` / `docs/architecture/**` / `docs/install.md`；backend = `lib/index.js` / `lib/host/**` / `scripts/smoke-host.mjs`；frontend = `lib/client.js` / `lib/client/**`；tester = `tests/**` / `docs/testing/**`。

### 3.2 双端职责

| 端 | 入口 | 职责 | 禁止 |
|---|---|---|---|
| Host | `lib/index.js` | `inject:['webServer','connection']`（硬依赖）；可选服务 `jobs/shell/terminals/subagents/agentTeams/agents/sessions` 用 `ctx.get()` 探测；注册 HTTP 路由；装配采集器；`ctx.effect` 清理 | 不得改工具结果（`next()` 原样返回）、不得写 session、不得读模型上下文 |
| Client | `lib/client.js` | 注册 `conversation.view`；轮询 RPC；渲染列/行/筛选/弹窗；本地状态机；自注入 `<style data-plugin-css>` 并卸载移除 | 不得自绘 tab、不得 `require` 平台表以外的模块、不得 `host.call`/`styles.insert`、不得写 `document.body` |
| 纯逻辑 | `lib/host/*.mjs`、`lib/client/*.mjs`（或 `__internals`） | 无 DSH 运行时依赖，可被 `node:test` 直接 import；输入输出为普通 JSON | 不得 import React / cordis / DSH 包 |

### 3.3 Client 组件签名（v2 精确化）

```js
function TerminalPanel(props) {
  // props 由 slot renderer 合并（F28）：
  //   sessionId, useSession, useProjection?, t,
  //   inspectCall, viewRequest, openView, completeViewRequest,
  //   ...inject(sessionId) 的返回（本插件只注入自己的字段，避免覆盖保留名）
  // 订阅会话状态用 useSession(selector)，selector 必须模块级稳定（不要每次 render 造新函数）
}
```

`apply(ctx)` 注册（形态照抄 `dsh-client-ui-trajectory`，F26）：

```js
ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'terminal-panel: dicts')
ctx.effect(() => injectStyle(css), 'terminal-panel: style')   // document.head <style data-plugin-css>
ctx.slots.inject('conversation.view', () => ctx.slots.register({
  name: 'conversation.view',
  id: 'terminal-panel',
  order: 30,
  locale: NS,
  label: () => ctx.locale.bind(NS)('tab.label'),
  inject: (sessionId) => ({ panelSessionId: sessionId }), // 不改保留字段名
}, TerminalPanel))
```

### 3.4 运行时装配时序

```
Host 启动
  └─ Loader 读 cordis.patch.yml → insert 行 { id: terminal-panel, name: dsh-terminal-panel }
      └─ import('dsh-terminal-panel') → lib/index.js → apply(ctx, config)
          ├─ ctx.effect：注册 POST /terminal-panel/rpc（webServer.register，F30）
          ├─ ctx.effect：监听 tools/execute（记录 Run；waterfall 必须 next()，F21）
          ├─ ctx.effect：监听 tools/result（终态输出，F22）
          ├─ ctx.effect：尝试 shell tee（best-effort，失败只降级，F17）
          └─ dispose → 路由/监听/tee 全部撤掉

页面加载
  └─ 客户端模块系统 materialize dsh-terminal-panel/client（id=包名，F4）
      └─ factory(require) → { inject: ['slots','locale'], apply(ctx) }
          ├─ ctx.effect：locale 词典 + <style> 注入
          └─ ctx.slots.inject('conversation.view', () => ctx.slots.register(opts, TerminalPanel))
              └─ 用户切到「终端」tab → 组件 mount（只有激活 view 渲染，F25）
                  ├─ useEffect：panel.hello → 自适应 poll 循环（§4.5）
                  ├─ 用户操作 → 本地状态机
                  └─ unmount：abort in-flight、清定时器/rAF/滚动监听（切 tab 会 unmount，F25）
```

---

## 4. 传输层

### 4.1 端点（不变，Lead 裁决 1）

| 项 | 值 |
|---|---|
| 形态 | `ctx.webServer.register({ kind:'exact', path:'/terminal-panel/rpc', handler })`（F30） |
| 方法 | 仅 `POST`；其它 → `405`，头 `Allow: POST` |
| 请求头 | `content-type: application/json`（否则 `415`） |
| 请求体 | `{ "reqId": string, "method": string, "params"?: object }`，上限 **4 KiB**（超限 `413`）；`reqId` 用于日志关联（自建路由没有宿主 rpcId，F32） |
| 认证 | `ctx.connection.requestRejection({ headers: req.headers })`；401/403 原样返回，响应体 `{ok:false,error:{code:'unauthorized'\|'forbidden',…}}` |
| 响应 | `200 { ok:true, value }` 或 `200 { ok:false, error:{ code, message, details? } }`；handler 内部异常必须自己 catch 后返回 `internal`（**不要外抛**，外抛变 HTTP 500 纯文本，F31 同理） |
| 缓存 | `cache-control: no-store` |
| 连接 | Client `AbortController` 5s 超时；单飞（同一时刻最多 1 个在途请求） |

**为什么不用通道 A（`ctx.connection.rpc`）**（Lead 裁决：不改；记录备选）
- v1 已定、backend 已按 exact 路由实现，切换=返工；同机两个三方先例证明 exact 路由稳定（F30）。
- 通道 A 的优势（自动栅栏 + rpcId + 统一信封）可以用少量代码在自建路由里复刻；劣势（handler 外抛→500 纯文本、无流式）与自建路由相同。
- **后续简化路径**：若将来 backend 重构，可只改 `lib/host/route.mjs` 与 `lib/client.js` 的 `transport` 两层切到通道 A；信封差异：`{method,params}` → `{type:'client-request',rpcId,method:endpoint,payload}`，`{ok,value}` 形状不变。此切换**不影响本契约的 §4.2 方法语义、§5 数据模型、§6 状态机**。

Client 取址：

```js
const url = new URL('terminal-panel/rpc', document.baseURI) // 同 popout 先例的相对命中方式（F30）
```

`[ASSUMPTION]` 页面 `baseURI` 为宿主根目录。若首次请求 404，Client 回退绝对路径 `/terminal-panel/rpc` 一次并 `console.warn`。**验证方式**：T6 在真实页面 Network 面板确认首次请求 200（scout U4/A8-1）。

### 4.2 方法与信封

#### `panel.hello`

```ts
// params: {}（可省略）
interface HelloResult {
  protocol: 1
  hostTime: number                 // epoch ms，用于 client 计算服务端时钟偏移
  dshVersion?: string
  capabilities: { bash: boolean; jobs: boolean; terminals: boolean; tree: boolean }
  limits: { maxFrameBytes: number; maxRuns: number; pollHintMs: number; idlePollHintMs?: number }
  availability: Availability
}
```

#### `panel.poll`

```ts
interface PollParams {
  sessionId: string                      // 当前会话（slot inject 的 sessionId）
  cursors?: Record<string, RunCursor>    // runId → 各通道游标；缺省 run 视为首见（给保留窗口尾部）
  includeCompleted?: boolean             // 默认 true；服务端最多保留 completedLimit 条终态
  focusRunId?: string                    // 可选：优先续读该列（放大弹窗/活动列不被饿死）
  resync?: boolean                       // v8：全量重同步（忽略本地游标，把可见 Run 全部重发；不因 resync 发 removed）
  maxRuns?: number                       // 默认/上限 maxRuns（32）
  maxBytes?: number                      // 默认/上限 maxFrameBytes（65536）
}

interface RunCursor {
  stdout?: number     // bash tee 的字节偏移（仅 tee 成功时存在）
  stderr?: number
  job?: number        // jobs.readAt 的 next（绝对字节，不透明）
  terminal?: number   // 上次交付到的 totalLines 基线（行坐标）
}

interface PollResult {
  protocol: 1
  sessionId: string
  serverTime: number
  revision: number                  // 服务端单调递增帧号
  sessions: SessionScope[]          // 本次可见会话树（含 root）
  runs: Run[]                       // 新增/变化的 Run（含增量输出块），未变化的不出现
  removed: string[]                 // 已从注册表移除的 runId
  availability: Availability
  truncated: boolean                // 命中帧预算，client 应立即用 nextCursors 续读
  nextCursors: Record<string, RunCursor>
  diagnostics: PollDiagnostics      // v7：每帧必带（体积小；旧客户端忽略）
}

// v7
interface PollDiagnostics {
  rootSessionId: string
  agentFound: boolean               // ctx.agents.get(sessionId) 是否拿到 live Agent
  agentCount: number                // 可见会话树中的 agent 数
  scopes: number                    // 可见会话作用域数（sessions.length）
  terminals: {
    candidates: number              // 本轮候选 terminal Run 数
    source: 'terminals' | 'sidebar' | 'events' | 'none'  // 实际命中的发现级别
    // 'terminals' = ctx.terminals (agent PTY，主链路)
    // 'sidebar'   = terminalController（侧栏/浏览器终端注册表，**默认关闭**，需 config 开关；开启时 Run 必须标侧栏来源）
    // 'events'    = tools/execute 旁路事件（agent 缺失时的有效兜底）
    // 'none'      = 全部不可用
    reason?: string                 // 降级原因（无则缺省）
  }
  // ── v9 诊断扩展（实际实现当前发送字段；向后兼容，旧客户端忽略）──
  agentsService: boolean             // ctx.agents 服务是否存在
  agentsAccess: string               // service 访问结果（serviceAccess 快照）
  agentsCount?: number               // = agentCount 的别名（实现保留）
  sessionIdMatchesAgent: boolean     // sessionId 是否能直接作为 agents.get 的 key
  agentsProbe: {
    getOk: boolean                   // 抽样的 sampleIds 都能 agents.get() 取到
    identityOk: boolean              // 取到的实例与 list() 条目同引用（排查包装/旧引用）
    sampleIds: string[]              // 抽样 id（最多 5 个）
  }
  terminalOwners: { captured: number; alive: number; inScope: number; outOfScope: number }
  terminalScopes?: number            // tier1 实际解析范围大小 = scopes ∪ terminal owner
  tier1Terminals?: number            // store 中 outputMode==='live' 的 terminal 数
  metaOnlyTerminals?: number         // store 中 outputMode==='meta-only' 的 terminal 数
  ownerCached?: number; ownerResolved?: number; ownerFromCache?: number
  ownerIdentityMismatch?: number; ownerMissing?: number
  treeDegradation?: string           // 会话树降级原因（若有）
}
```

语义（**下游照此实现，不得各自发挥**）：

1. `runs` 只包含「元信息有变化」或「有新增输出」的 Run；同 runId 多帧之间增量累加，不整量重发。
2. `output.*.chunks[].text` 是**新增的连续文本**（bash/job = 字节增量；terminal = 行增量），client 按到达顺序 append；每列本地保留 `scrollbackLines`(600) 行，超出丢头并记 `droppedLines`。
3. 游标规则按来源分开（§5.2），**不得混用**：job 是绝对字节 `next`；terminal 是 `totalLines` 行基线；bash tee 是字节偏移。
4. `truncated:true` 时 client 必须立即用 `nextCursors` 续读（同 tick 最多 3 次，之后等下一轮）。
5. **`removed` 语义（v3 定案；v7 修订适用面）**：
   - `removed` = **服务端已从注册表移除**的 runId（来源：终态 Run 超出 `completedLimit`(50) 条或 `completedRetainMs`(300000ms) 保留窗口 → `store.prune()`；或会话结束/来源关闭）。**Client 收到后立即删除本地 `runs`/`columns`/`droppedLines`/游标**（以 §11.2 为准），**不做 5 分钟延时**，也不再进入「已完成」区展示。
   - **v7 修订**：**agent 缺失/解析失败不再触发 terminal Run 的 `removed`**（旧实现 noAgent 分支直接删 Run 是缺陷 ① 根因）；terminal 只在 `terminal_close`/`terminal_kill`、会话结束、保留窗口过期时移除（见 §7.2/§7.3）。
   - `completedRetainMs` **不用于** `removed`；它只用于 Client 的**本地兜底淘汰** `pruneRuns()`：对「服务端仍保留、且已终态」的 Run，超过 300000ms 或条数超过常量 `MAX_RETAINED_COMPLETED`(200) 时本地删除（用于长时间无帧 / 内存保护）。两者不冲突：收到 `removed` 优先立即删。
   - 服务端保留窗口参数：`completedLimit`=50 条、`completedRetainMs`=300000ms（`retainCompletedMs`，`store.prune` 的实现）。
   - **v8 修订**：`resync` **不产生 `removed`**（全量重同步只重发 runs，不删任何 Run）；`store.prune` v8 新增 `protect`（本帧 discovery 已见 runId）——被保护的 Run 本帧不得被 prune，避免「removed → 下一帧重新 upsert」抖动。
6. **`revision` 语义（v8 修订）**：`incoming > applied` 正常前进；`incoming === applied` 重复/乱序帧丢弃；**`incoming < applied` = 服务端重建（Host/插件重载后 `store.revision` 归 1）**——Client 必须**清空本地 `view`（保留筛选/分组用户态）+ 丢弃在途帧 + 发一次 `resync:true`**，不得直接丢弃（旧语义 `<=` 会让面板在重载后永久冻住）。
7. `run.outputMode === 'final-only'` 的 Run 在终态前**没有输出块**；UI 在输出区显示「仅终态」占位（§12.7）。`outputMode === 'meta-only'`（v7，仅 terminal）表示有元信息但读不到输出：UI 必须显示输入块 + `notice`（若有）+ 空输出文案，**不得**当作错误吞掉。
9. **同帧互斥不变量（v8）**：同一帧的 `removed` 与 `runs` **不得包含同一 runId**；若冲突，**以 `runs` 为准**（该 run 的 `removed` 延后一帧再发）。实现：`store.prune(now,{protect})` + 出帧前按本帧 `runs`/已尝试交付 entry 过滤 `removed`。
10. **`resync` 收敛**：`resync:true` 只把可见选择集内全部 Run 标为「有变化」并把各来源读游标回退到保留窗口起点（`metaDirty` + `nextReadCursor`）；**不得**改变 `removed`/`availability` 语义；重发仍受 Tier1/Tier2 预算与 H1「≥1 Run」保底约束，**可分多帧收敛**（`truncated:true` 时客户端继续轮询即可）。无法重读的 tier3 事件片段保留在 pending 中继续发。
8. `diagnostics`（v7）每帧必带且**不得省略**（旧客户端忽略）；它是终端三级发现链路的唯一可观测证据（`agentFound`/`terminals.source`/`reason`），排障时先看它。

#### `panel.poll` 的 `resync`（v8 可选参数）

```ts
interface PollParams { /* 同上；新增 */ resync?: boolean }
```

- 客户端触发时机：**mount 且会话缓存未命中** / 检测到 `revision` 回退 / 手动重试；同一次挂载成功发一次即可（Host 未实现时按 `bad-request`/`unknown-method` 静默降级为普通轮询）。
- 服务端行为：对本次可见选择集（`includeCompleted/maxRuns/focusRunId` 同 poll）内全部 Run `metaDirty=true`、清读游标/窗口、事件片段 pending 保留；**不产生 `removed`**；被重置的 runId 加入本帧 prune 保护集。
- `cursors: null` 作为等价「无状态」信号（兼容旧客户端）；`resync:true` 优先。
- 预算不变量不变（§4.3）：重发可分多帧，`truncated:true` + `nextCursors` 正常续读。

#### `panel.kill`

```ts
interface KillParams { sessionId: string; runId: string }
interface KillResult { outcome: 'requested' | 'already-finished' | 'unsupported' }
```

- 只允许终止可见会话树内的 Run；授权 = 可见树 + 各服务 owner 围栏；越权 → `run-not-found`（不泄漏存在性）。
- bash（无句柄可 kill）→ `unsupported`（UI 置灰停止按钮，提示「仅终态，无法从此面板停止」）；若 shell tee 成功拿到 `ShellExecution` 才允许 `kill()`。
- job → `ctx.jobs.kill(jobId, ownerSessionId, 'cancelled by the user')`（`caller` 传**目标 sessionId**，F16）。
- terminal → `ctx.terminals.kill(ownerAgent, terminalId, 'cancelled by the user')`（owner 是 **Agent**，F18/F20）。
- 用户 kill 与模型 kill 语义不同（沿用 job-controller 先例：模型完成通知照常送达）。

### 4.3 帧预算与截断（服务端，v3 统一口径）

**单一语义**：`maxFrameBytes` 是**一个**参数，主口径 = **输出文本字节**；整帧 JSON 只在两个兜底层使用，且都只是「同一帧的兜底裁剪」，不是第二套并行口径。三级管线按顺序执行，任一层裁剪都置 `truncated:true`：

| 层 | 实现 | 口径 | 触发 | 裁剪方式 |
|---|---|---|---|---|
| Tier1（主口径） | `planReads` → `buildPollFrame` | **输出文本字节**累计 ≤ `maxFrameBytes`（默认 65536，配置夹取 1024–1048576） | 每帧都跑 | 逐 Run 累加输出文本字节；超预算的 Run **整条跳过**（不半截），排在前面的小 Run 仍可进入；**第一条 Run 永远放行**（避免大输出饿死整帧）；被跳过的 Run 记入 `dropped`，不写 `nextCursors`。**v5 对齐（M2）**：`planReads` 必须接收 `store.frameSelection` 的**同一选择集**，并按「focus 先拿 ≤16 KiB，其余按剩余预算/剩余 Run 数公平分配」给每 Run 份额（`perRunBudget`），不得另算一套候选集 |
| Tier2（同参数兜底） | `boundFrameDetailed(value, maxFrameBytes, { preferRunId? })` | **整帧 JSON 字节** ≤ 同一 `maxFrameBytes` | 仅当 Tier1 通过、但 JSON 元信息使整帧仍超限 | 从尾部**整 Run 丢弃**直到 ≤ 上限，置 `truncated:true`，并删除被丢 Run 的 `nextCursors`；**H1 保底**：至少保留 1 条 Run —— `pickFallbackRun` 优先 `preferRunId`（dropStreak 指定）→ 最新且 running → 最新；该条必要时用 `trimRunOutput` 二分最大可交付 output（可为 0，只裁输出文本、status/元信息必保留），并返回 `trimmedRunIds` + `deliveredBytes`。**v5 对齐（部分交付）**：被部分交付的 Run 只用 `splitDeltaAtBytes(delta, deliveredBytes)` **退回未交付后缀**（不是整条退回）；游标**只按 `bounded.nextCursors` 提交**（`store.commitCursorsFromFrame`），绝不按 Tier1 读取计划提交 |
| Tier3（传输硬上限） | `route.boundResponseValue(value, maxResponseBytes = 262144, previousCursors)`（`maxResponseBytes` 是固定常量，不配置） | **整帧 JSON 字节** ≤ 262144 | 仅当 Tier2 后仍超限（异常大数据/元信息） | 从尾部整 Run 丢弃直到 ≤ 上限，置 `truncated:true`；被丢 Run 的 `nextCursors` **回退为客户端上一轮游标**（无上一轮则删除），保证客户端不跳过未交付字节。**H1 保底**：若仅剩的 1 条 Run 仍超限，**截断该 Run 的 `output` 文本**（按需置 `truncated`/`lossy`）而非丢弃整条元信息——绝不出现「单 Run 永远无法交付」的 livelock。**v5**：修复后单 Run JSON 已有硬上界（元信息 ≤4 KiB/字段 + 输出可裁到 0），Tier2 总能保底交付，**Tier3 成为不可达的防御性兜底** |

其余规则：

| 项 | 规则 |
|---|---|
| 调度顺序 | 选择集 = `store.frameSelection`（focusRunId 提到最前 → `status==='running'` 按 `startedAt` 升序取前 `maxRuns` → 终态按 `finishedAt` 降序取 `completedLimit`）；`planReads` 用**同一集合**分配预算：focus 先拿 `min(16384, 剩余)`，其余按 `剩余预算 / 剩余 Run 数` 公平分（v5/M2）；被跳过的 Run 不写 `nextCursors` |
| dropStreak（v5/H1） | 每 Run 记录「连续未出现在最终帧」的帧数（`dropStreak`）。**连续 ≥2 帧**未出现的 Run，下一帧被**强制提到最前**，并作为 Tier2 保底 `preferRunId`（`pickFallbackRun` 优先选它），确保不会出现「连续 3 帧被丢且零字节」的长尾；一旦出现在最终帧即清零 |
| 单 chunk 上限 | 单条 `text` ≤ 16384 字节（`splitChunks` 切块，不切半个码点）；`limitDelta` 负责单 Run 内截断 |
| 超长 Run 数 | running > `maxRuns`(32) 时只返回前 32 个 running + 最近 `completedLimit` 条终态（UI 显示「另有 N 个未显示」） |
| 标记语义 | `truncated`（bash tee / job 通道）= 本帧没发完（可续读，**不丢数据**）；`lossy` = 数据已丢（不可恢复）。两者不可混用。**terminal 专用（v4）**：`TerminalDelta.truncated = page.truncated \|\| lineEnd < totalLines`，表示**该会话输出未被完整覆盖**（scrollback 裁剪，或窗口未及最旧行），**不是「本帧没发完 / 分页未取完」；client 不得据此循环翻页**（历史靠本地缓冲 + 手动上翻） |
| `budgetMode?` | 可选字段 `'text' \| 'frame'`：`'text'`（缺省）= 本帧未触发整帧 JSON 兜底；`'frame'` = 本帧被 Tier2/3 按整帧 JSON 口径裁剪。**当前实现未发该字段（省略即 `'text'`），client 不得依赖；backend 可在 Tier2/3 裁剪时补发（v3 允许，向后兼容）** |
| `nextCursors` 一致性（硬不变量） | ① 只包含**本帧实际交付**的 Run；② 每个通道游标 ≤ 已交付字节数（terminal 为已交付 `totalLines` 基线），**不得前移到未交付位置**；③ 被 Tier1 跳过的 Run 不出现（client 沿用旧游标）；④ 被 Tier2 丢弃的 Run 不出现（且退回注册表，下轮重发）；⑤ 被 Tier3 丢弃的 Run 回退为客户端上一轮游标；⑥ `truncated:true` 时 client 必须立即用 `nextCursors` 续读（同 tick ≤3 次）。**H1 重申**：⑤/⑥ 同样适用于「Tier3 截断 output 而非丢 Run」的情况——游标只前移到实际交付的字节，**绝不因截断而越过未交付字节**。**v5 实现约束**：服务端游标**只**由 `store.commitCursorsFromFrame(bounded.nextCursors)` 提交（不做 Tier1 计划游标的提前提交），这是部分交付不丢字节/不重复的必要条件 |
| 元信息上限（H1） | `command`/`cwd`/`detail`/`title` 在序列化前各截断到 **≤ 4096 字节**（保留头部、不切半个码点），Run 置 `metaTruncated:true`；UI 单行省略 + tooltip 展示。目的：把单 Run 的 JSON 元信息控制在 Tier2 预算内（默认 65536 下即使超长 heredoc 命令也不会 livelock）。v3 冻结表不变（`metaTruncated` 为 Run 的新可选字段） |
| 选择集一致（M2） | **预算调度与选择集必须是同一集合**：`planReads` 的候选集合、排序、`maxRuns` 截断方向必须与 `takeEntries` 完全一致（同一集合、同一排序、同一端截断），禁止一个取最旧 32、另一个取最新 32。修复归 backend（task-12），回归归 tester：40 个 running 时首帧 32 列中必须有输出（不得交给下一帧补齐） |
| 饥饿保护 | Tier1 首条 Run 永远放行；Tier2 至少保留 1 条 Run（H1 保底）；`focusRunId` 在 `planReads` 中优先分配预算（放大弹窗/活动列不被饿死） |

### 4.4 错误码表

| code | HTTP | 触发 | Client 行为 |
|---|---|---|---|
| `unauthorized` | 401 | cookie 缺失/过期 | 停轮询，横幅「认证失效，请刷新页面」+ 重试按钮 |
| `forbidden` | 403 | Host/Origin 栅栏拒绝 | 同上（提示网络/代理异常） |
| `method` | 405 | 非 POST | 视为实现错误，控制台告警 |
| `too-large` | 413 | 请求体 >4 KiB | 同上（不应发生） |
| `bad-request` | 200 | params 校验失败 | 丢弃该帧，控制台告警一次，不打断面板 |
| `unknown-method` | 200 | 未实现方法 | 丢弃 |
| `session-not-found` | 200 | **仅**「sessionId 语法合法但服务端确实无此会话」的极端情况（v4：常规「无 live root」不走此错误） | 空态「会话不可用」+ 重试 |
| （无错误，`ok:true`） | 200 | **非 live root 会话（v4 定案）**：sessionId 合法但 `ctx.agents.get(sessionId)` 无 live Agent → **降级帧**（`sessions` 仅 root、`availability.tree.available=false`、`runs:[]`），而不是 `session-not-found` | 面板显示空态/降级提示（「该会话已不在活动注册表」），其余来源照常 |
| `run-not-found` | 200 | kill 目标不在可见树/已移除 | toast「该任务已结束或不可见」 |
| `run-not-stoppable` | 200 | 来源不支持停止（前台 bash 无句柄） | toast「该来源不支持停止」 |
| `source-unavailable` | 200 | 指定来源服务缺失 | 对应 chip 置灰 + tooltip 原因 |
| `internal` | 500 | 未预期异常 | 退避重试；连续 3 次 → 断线横幅 |

网络层错误（fetch reject / 超时 / 非 JSON 响应）→ 连接状态机：第 1 次失败静默重试；连续 2 次 → `degraded` 横幅；退避 500/1000/2000/5000ms 封顶；恢复后写一条「已恢复」并清横幅（断线重连提示一次，ui-spec §6）。

### 4.5 轮询节奏（v2：自适应）

| 状态 | 间隔 | 依据 |
|---|---|---|
| 有 running Run（活跃） | `pollHintMs = 250`（硬上限 300，下限 150） | 任务书「≤300ms 合帧」；scout §2.5 建议 |
| 无 running Run（空闲） | Client 常量 `IDLE_POLL_DEFAULT_MS = 1000`（1000–1500）；若 `hello.limits.idlePollHintMs` 存在则优先 | scout §2.5「空闲 1000–1500ms」；实现当前未发该 limit |
| 页面隐藏（`document.visibilityState === 'hidden'`） | 暂停（`visible` 后立即 poll） | 省电/省帧 |
| View 未激活 | 不轮询（slot 只渲染激活 view，F25） | 切 tab 自动停 |
| 合帧 | 收到帧先入缓冲，最多每 60ms 用 rAF 提交一次 UI | ui-spec §7 |
| 单飞 | 上一请求未结束不发下一个；`focusRunId` 用于放大弹窗所在列 | `[INF]` |
| 卸载 | abort 在途请求、清 interval/rAF/监听 | F25 + practices |
| 自限 | 三级预算见 §4.3：Tier1 输出文本 ≤ `maxFrameBytes`(65536)，Tier2 整帧 JSON 兜底 ≤ 同一 `maxFrameBytes`，Tier3 传输硬上限 262144；不用宿主 300MiB 上限（F33） | F33 |

---

## 5. 数据模型（双端共用，JSON 线上形态）

### 5.1 服务端模型

```ts
type RunKind = 'bash' | 'job' | 'terminal'
type RunStatus = 'running' | 'completed' | 'failed' | 'killed'
type OutputMode = 'live' | 'final-only' | 'meta-only'
// final-only = 前台 bash（无过程输出，F17）
// meta-only  = v7：有元信息但读不到输出（仅 terminal；agent 缺失/读取失败），UI 显示输入块+notice+空输出
type AgentRole = 'lead' | 'subagent' | 'teammate' | 'unknown'
type Accent = 'none' | 'subagent' | 'teammate'

interface AgentRef {
  id: string                 // SessionId
  name: string               // 显示名（队友名 / 子代理 label / 'lead' / '当前会话'）
  role: AgentRole
}

interface SessionScope {
  sessionId: string
  displayName: string        // 队友用 name，子代理用 label，root 用「当前会话」
  role: 'root' | 'lead' | 'subagent' | 'teammate'
  parentSessionId?: string
  depth: number              // root=0
  accent: Accent
  hasActivity: boolean       // 是否有命令行活动（筛选列表是否显示；ui-spec §4 底部说明）
}

interface OutputChunk {
  at: number                 // Host epoch ms
  text: string               // 原始文本（含 ANSI；client 负责剥离/保留）
  channel?: 'stdout' | 'stderr' | 'job'
}

interface ChannelDelta {
  chunks: OutputChunk[]
  nextCursor: number         // 字节偏移（bash tee / job）
  lossy: boolean             // 保留窗口已淘汰，client 有缺口
  gapBefore?: boolean        // 本帧第一块之前有缺口
  truncated: boolean         // 本帧该通道没发完，可续读
}

interface TerminalDelta {
  text: string               // 本帧新增行（已去重）
  totalLines: number         // 该 scrollback 当前总行数（行坐标原点）
  lineBegin: number          // 本次片段在「距最新行数」坐标系中的起点（=offset）
  lineEnd: number            // 本次片段在该坐标系中的终点（=offset + 返回行数）
  absBegin: number           // totalLines - lineEnd（绝对行号，含）
  absEnd: number             // totalLines - lineBegin（绝对行号，不含）
  nextCursor: number         // = totalLines（下轮基线）
  truncated: boolean         // terminal 专用（v4）：page.truncated || lineEnd < totalLines = 输出未被完整覆盖（非「分页未取完」）
  lossy: boolean             // 基线回退/裁剪导致缺口
}

interface RunHandle {
  toolCallId?: string
  pid?: number
  jobId?: string
  terminalId?: string
  terminalType?: string
}

interface Run {
  runId: string              // `${kind}:${sourceId}`；bash= callId，job= JobId，terminal= TerminalSessionId
  kind: RunKind
  status: RunStatus
  stopping?: boolean
  outputMode: OutputMode
  ownerSessionId: string
  agent: AgentRef
  title: string              // 列头类型标签（Bash / 后台任务 / 终端）
  command?: string
  cwd?: string
  startedAt: number
  finishedAt?: number
  durationMs: number
  exitCode?: number | null
  signal?: string | null
  detail?: string            // 失败原因 / kill 原因 / 'final-only'
  metaTruncated?: boolean    // H1：command/cwd/detail/title 任一被截断到 ≤4096B 时为 true
  inputs?: string[]          // v7：仅 terminal。初始 name + 捕获的 terminal_send 文本；
                             //     最后 20 条 / 单条 ≤2KiB / 合计 ≤8KiB，超出丢最旧。bash/job 不新增
  notice?: RunNotice         // v7：降级提示（当前仅 terminal 使用），UI 在输入块上方以次要色显示
  handle: RunHandle
  stoppable: boolean
  totals: { stdout?: number; stderr?: number; job?: number; terminal?: number }
  output: {
    stdout?: ChannelDelta
    stderr?: ChannelDelta
    job?: ChannelDelta
    terminal?: TerminalDelta
  }
  lossy: boolean
  truncated: boolean
}

// v7
type NoticeCode = 'terminal-no-agent' | 'terminal-read-failed' | 'terminal-controller-unavailable'
interface RunNotice {
  code: NoticeCode
  message: string            // 给用户看的一行原因（中文或英文，UI 直接渲染）
}

// v7：displayName / AgentRef.name 的来源链（FACT：DSH Agent 没有 name 字段，inspect `Agent { id }`）
//   1) ctx.sessionTitle.get(session)?.title
//   2) ctx.sessions.get(sessionId) 的标题
//   3) Team member name / subagent label（team/subagent 目录）
//   4) 兜底「当前会话」
// 不得把 sessionId 长串作为显示名；空值 UI 显示「—」。
// 另：rootAgent 缺失时也必须能列出队友——用任一 live agent 调 agentTeams.listMembers（API 只要求 exact live member）。

type SourceState =
  | { available: true }
  | { available: false; reason: string; code: 'missing-service' | 'denied' | 'error' }

interface Availability {
  bash: SourceState          // 前台 bash 可见性（final-only 也算 available）
  bashLive: SourceState      // tee 是否成功（false → 过程输出不可见，UI 标「仅终态」）
  jobs: SourceState
  terminals: SourceState
  tree: SourceState
}
```

### 5.2 来源映射（v2：前台 bash 三层）

| RunKind | 发现（始终） | 过程输出（能拿才拿） | 终态输出 | 停止 |
|---|---|---|---|---|
| **bash 前台** | `tools/execute` waterfall 记录 `{callId,name,arguments,agent?}` → Run 立即以 `status:'running'` 出现，`outputMode:'final-only'`（F21；waterfall 必须 `next()`） | **best-effort tee**：`bashCapture=true` 时尝试装饰 `ctx.shell.execute` 拿到返回的 `ShellExecution`，按其 `observed.stdout.readFrom(cursor)` 增量；成功 → 该 Run 升级 `outputMode:'live'`，`availability.bashLive.available=true`；失败 → 只保留 final-only，`availability.bashLive={available:false,reason:'no-shell-handle',code:'error'}`（F17：服务是一个上下文一个实现，第三方通常拿不到，属预期降级） | `tools/result`（emit，deep-frozen，不污染链）或 `tools/post-execute`（waterfall）的 `ToolExecutionResult`：提取 `content` 中 `type:'text'` 块（无则 `value` 的 JSON 摘要，≤32 KiB）→ 一次性作为 `stdout` 块，`detail:'final-only'`（F22/F23） | `ShellExecution.kill()`（仅 tee 成功时）；否则 `run-not-stoppable` |
| **job** | 每个可见会话 `ctx.jobs.list(sessionId)`，按 jobId 去重合并（F16） | `ctx.jobs.readAt(jobId, cursor, ownerSessionId)`；`next` 不透明游标写回；`lossy` 透传；`from` 在 chunk 中间会重发整 chunk → 按 `chunk.at + 已知长度` 去重（F16/scout §11.4） | `status` 终态 + `detail`/`progress`；`output.total` 作 totals | `ctx.jobs.kill(jobId, ownerSessionId, 'cancelled by the user')` |
| **terminal** | **v9 发现链路（详见 §7.2/§9.4）**：① `ctx.terminals.list(agent)`（agent PTY，主；**v9 Agent 解析范围 = 会话树 scopes ∪ store 中 terminal Run 的 ownerSessionId**，树外 owner 也可读 live）；② `ctx.terminalController.list(sessionId)`（**侧栏/浏览器终端，默认关闭**、开启时标 `source:'sidebar'`，与 agent PTY 不混排）；③ `tools/execute` 旁路事件（**默认有效兜底**）。**agent 缺失不删 Run**（meta-only + notice；tier3 片段可作补偿输出） | 每轮 `read(agent, id, { offset:0, count:max(k,1) })`，`k = totalLines_new - cursor_prev`：**k > 0** → 尾页增量 + 尾重叠去重；**k === 0** → 正常「空闲探尾」（PTY 可能用 `\r` 重写当前行）：不追加、**不标 lossy**、基线不变；**k < 0** → scrollback 裁剪/回退：`lossy:true` + 重置基线并给当前尾页。历史阅读靠本地缓冲 + 手动上翻 `offset += count`（服务端只给增量）。**合成分隔符不计入 terminal 行坐标**（tier3→tier1 接管首帧会在 `text` 前插入合成 `\n`，不计入 `totalLines/lineBegin/lineEnd`；`lineEnd-lineBegin` = 真页行数，`text.split('\n').length` = 真页行数+1；纯片段帧一致）。无 Agent 时读不到连续输出 → `outputMode:'meta-only'` + `notice` + tier3 片段 | `status.kind==='exited'` → exitCode 0 ? completed : failed（signal 记 detail） | `ctx.terminals.kill(agent, id, 'cancelled by the user')`（无 Agent 时不可停止） |

归属与树：

- `tools/execute` 的 `exec.agent.id` = Run 的 `ownerSessionId`；**`exec.agent` 可选**，缺失时不猜归属（该 Run 丢弃或 `agent.role='unknown'`，不得归到当前会话）F21。
- 会话树 = `{root} ∪ subagents.listDescendants(root) ∪ agentTeams.listMembers(rootAgent)`，按 sessionId 合并；同 id 既是队友又是子代理时**队友优先**（F19）。
- 只有 live `Agent` 的会话能查 terminals/jobs 的 owner 围栏（F18/F20）；拿不到 → 该会话来源标记降级，不影响其它会话。
- root = Client 传入的 sessionId；`ctx.agents.get(sessionId)` 无 live Agent 时：仍可展示 tools 侧 Run（agent 可选），但 terminals/jobs 聚合降级，`tree` 状态记原因。

### 5.3 客户端派生视图模型（不进 RPC）

```ts
interface FilterState {
  kind: 'all' | 'bash' | 'job' | 'terminal'
  sessionIds: string[] | null                  // null = 全部（默认，见 §12.3）
  search: string
  autoExpandNew: boolean                       // 默认 true
  showCompleted: boolean                       // 默认 true
}

interface ColumnState {
  runId: string
  width: number                 // clamp(280, 640)，默认 352
  follow: FollowState
  collapse: CollapseState
  scrollTop: number
}

interface FollowState { following: boolean; pendingNewLines: number; lastTop: number; lastHeight: number }
interface CollapseState { expanded: boolean; pinned: boolean; paused: boolean; deadline: number | null }
interface GroupState { completedCollapsed: boolean; expandedIds: string[] } // completedCollapsed 默认 true

interface ViewState {
  sessionId: string
  status: 'loading' | 'ready' | 'degraded' | 'offline' | 'blocked'
  revision: number
  sessions: SessionScope[]
  runs: Record<string, Run>
  order: { running: string[]; completed: string[] }
  columns: Record<string, ColumnState>
  group: GroupState
  filter: FilterState
  availability: Availability
  banner?: { code: 'auth' | 'disconnected' | 'host-half-missing'; message: string; retried: boolean }
  droppedLines: Record<string, number>
}
```

---

## 6. 状态机（Client，纯函数化）

### 6.1 Run 生命周期

```
                ┌──────────┐  首次出现（带元信息）              ┌──────────────────┐
                │ unknown  │──────────────────────────────────►│ running          │
                └──────────┘                                   │ (final-only 时   │
                     ▲                                         │  无输出块)        │
                     │ 后台任务恢复输出                         └───────┬──────────┘
                     │                                     exitCode 0│ exit≠0 │ killed
                     │                                                 ▼        ▼        ▼
                     │                                          completed   failed   killed
                     └──────────────────────────────►（仅 job/terminal 可再出输出，status 不变）
```

来源状态映射（`lib/host/status.mjs`，tester 必测全表）：

| 来源 | 输入 | → RunStatus |
|---|---|---|
| shell（tee 成功） | `status:'running'` | running |
| shell | `status:'completed'`, `exitCode===0` | completed |
| shell | `status:'completed'`, `exitCode!==0` 或 signal | failed（detail 记 exitCode/signal） |
| shell | `status:'killed'` | killed |
| job | `'running' \| 'stopping'` | running（`stopping` 置位） |
| job | `'completed'` / `'failed'` / `'killed'` | completed / failed / killed |
| terminal | `{kind:'running'}` | running |
| terminal | `{kind:'exited', exitCode:0}` | completed |
| terminal | `{kind:'exited', exitCode≠0}` 或 signal≠null | failed |
| tools/result（final-only bash） | `isError===false` | completed |
| tools/result | `isError===true`，`error.info.code` 含 `abort`/`cancel` | killed |
| tools/result | `isError===true` 其它 | failed（detail 记 `error.message` 前 200 字） |

终态单调：进入终态后不再回 running；同一 runId 再有输出只更新 output/lastOutputAt，不改 status。

### 6.2 渲染顺序

- **进行中列**：`status==='running' && runningCount<=maxRuns`，按 `startedAt` 升序（最旧在左，最新在右）。
- **已完成行**：终态且未被「清空已完成」移除，按 `finishedAt` 降序（最新在上）。
- 顺序稳定：新增/删除不得重排已有列（避免横向滚动位置跳动）。
- 列数 > 3 时：容器 `overflow-x:auto`，右侧浮动 `›` + 剩余数角标；滚到最右隐藏 `›`（ui-spec §2.1）。

### 6.3 自动收起状态机（固定 10s）

```
        ┌────────────────────────┐
        │      expanded=true     │◄──────────────── 新输出（已收起后：重新展开并重新计时）
        └───────────┬────────────┘
                    │ 进入终态且 pinned=false → arm：deadline=now+10000
                    ▼
        ┌────────────────────────┐   now>=deadline 且 paused=false
        │ expanded=true, armed   │──────────────────────────────► collapsed（32px 行仍在列表）
        │ 琥珀点 + Ns + 2px 进度条│
        └───────────┬────────────┘
      hover/focus   │ 失焦/移出
        ┌───────────┘► paused=true ──► resume：deadline = now + 10000（完整 10s，§3.3）
```

实现契约（`CollapseState` 纯函数）：

- `armCollapse(state, now)`：`deadline = now + collapseDelayMs(10000)`；`pinned` 不 arm。
- `pauseCollapse(state)`：`paused=true`（deadline 冻结）。
- `resumeCollapse(state, now)`：`paused=false; deadline = now + 10000`（**重置为完整 10s**，ui-spec §3.3「失焦后再等 10s」）。
- `tickCollapse(state, now)`：`paused || pinned || deadline===null || now<deadline` 原样；否则 `expanded=false, deadline=null`。
- `pinCollapse(state)` / `unpinCollapse`：Shift+Enter 或 ⋯→固定展开；取消 pin 后若已终态重新 arm。
- 新输出到达且 `expanded===false` → `expanded=true` + 重新 arm（ui-spec §3.4）。
- 计时由一个 250ms tick 统一驱动（**不得每行一个 setTimeout**）；`prefers-reduced-motion` 下动画瞬时。

分组：

- 已完成区默认 `completedCollapsed=true`：折叠只显示「已完成 N」；展开显示 32px 行，整组最高 160px 后内部滚动（ui-spec §2.2）。
- 「清空已完成」只清当前筛选命中的终态项，3s 内可撤销；同时清对应 runs/columns（ui-spec §3.8）。

### 6.4 跟随（follow）状态机

```
        ┌──────────────┐  滚轮上翻（距底 >4px）   ┌────────────────┐
        │ following=true│────────────────────────►│ following=false │
        │ 贴底渲染       │◄────────────────────────│ pendingNewLines │
        └──────────────┘  滚回底部（距底 ≤4px）自动恢复│ 「N 条新输出 ↓」│
                ▲                                  └────────────────┘
                └── Esc 退出跟随（spec §3.10）；新输出不自动跳底
```

- `onScrollFollow(state, {scrollTop,scrollHeight,clientHeight})`：`distance = scrollHeight-clientHeight-scrollTop`；`distance<=4` → `following=true,pendingNewLines=0`；否则 `following=false`。
- `onOutputFollow(state, newLines)`：following 保持并滚底；否则 `pendingNewLines += newLines`。
- 恢复只由 onScroll 触发，**不得只在点击按钮时恢复**（ui-spec §3.5）。
- 滚轮隔离：输出区 `wheel` 监听 `preventDefault()` 只改自身 `scrollTop`；拖列宽期间不改 follow。
- `outputMode==='final-only'` 的 Run 仍遵循同一状态机（终态一次性输出的行数计入 pendingNewLines）。

### 6.5 停止（两击确认）

第 1 击 → `armed=true, disarmAt=now+3000`（「确认停止？」）；3s 内第 2 击 → `panel.kill`；超时/移出 → 解除。`kill` 返回前 loading，返回后由下一帧 poll 反映终态（不发乐观终态）。`stoppable=false`（final-only bash）→ 按钮禁用 + tooltip「仅终态，无法从此面板停止」。

### 6.6 最大化弹窗

- 触发：列头 `⤢` 或双击列头；内容 = 该 Run 输出区（同一份本地文本，只读）。
- 980×600、遮罩 65% 黑、Esc/✕ 关闭、可停止、可复制全部、独立滚动；不接管终端输入（ui-spec §2.2/§3.12）。
- 打开时取 `focusRunId = 该 Run` 让 RPC 优先续读；关闭恢复。
- 焦点：`role="dialog" aria-modal="true"`，打开 focus 容器，Esc 关闭，卸载恢复焦点到触发按钮。

### 6.7 Run 展示三态（v8，纯客户端；替换 v7「新终态自动展开分组」）

```
running ──终态──► linger ──(10s 到期 | 点「收起」)──► completed
                    │
                    ├─ hover/focus：暂停倒计时（移出/失焦后重新计 10s，同 v4 收起语义）
                    └─ pinned：不 arm linger（保持展开，直到手动收起）
```

- `RunPhase = 'running' | 'linger' | 'completed'`；`runPhase(run, column, now)` 判定；`lingerVisual(state, now)` 给渲染字段（倒计时/进度/暂停/可见性）。
- linger 仅用于**已终态**卡片；`running` 卡片不进入 linger；`completed` 卡片在已完成分组内（按 `finishedAt` 稳定排序）。
- 文案：倒计时 `Ns 后移入已完成`（`linger.in`），按钮 `收起`（`linger.collapse`）；倒计时槽固定占位（`min-width:152px`），不改变行内布局。
- 「收起」按钮把 linger 立即转 completed（幂等；重复点击无副作用）。
- **替换 v7 行为**：v7 的「新终态自动展开已完成分组」**删除**；分组展开状态仅由用户操作改变。

### 6.8 客户端会话状态保持（v8，`SESSION_CACHE`）

- 结构：模块级 Map；**LRU 4 / TTL 30 分钟**；值 `{ view, cursors, revision, savedAt }`。
- 保存时机：poll 帧成功应用到 view 后；View 卸载（切走 tab）时兜底保存。
- 恢复时机：View 挂载时若命中未过期 → 用缓存的 view/cursors/revision 初始化（首屏不空），随后以缓存 cursors 续传轮询。
- `retryToken` 变化只触发重连，**不清空 view**；TTL/LRU/会话删除/`removed` 才会失效。
- 插件卸载清整个缓存；React 卸载不清（同会话内切 tab 需要）。
- **resync 兜底（v8 追加）**：缓存未命中（首次挂载/被 LRU 淘汰/TTL 过期）或检测到 `revision` 回退时，除恢复缓存外还必须发一次 `panel.poll {resync:true}`（`resync` 不产生 removed）；`retryToken` 手动重试同样触发一次 resync。Host 未实现 resync 时按 `bad-request`/`unknown-method` 静默降级为普通轮询。

---

### 6.9 已完成行展开（v9，替换 v7 行内 collapse 倒计时）

- 状态：`view.group.expandedIds: string[]`（已完成行展开集合，纯布尔）；`toggleRow(runId)` 增删 id，**不读/不依赖 `view.columns[runId]`**。
- 交互：行头点击切换该行；组头点击切换 `completedCollapsed`（组折叠）；组展开时行按 `expandedIds` 渲染。
- **已完成行不再渲染** 10s 倒计时/进度条（`collapse.in`/`tp-countdown`/`tp-progress`），不复用 `column.collapse`；样式/词典**暂留（测试兼容）**。`removed`/`clearCompleted`/筛选变化后 `expandedIds` 裁剪为仍存在的 runId。
- v7 真因（供回归断言）：旧 `CompletedRow` 用 `collapseVisual(column.collapse)`，`toggleRow` 在 column 缺失时 `return` → 点不开 + 仍显示「10s 后收起」。

### 6.10 重排动效：同步 ghost + FLIP（v10，替换 v8/v9 晚一帧 ghost）

- **ghost 同步派生**：退场卡在**同一 render 内**由 `previousActive` 与当前 `activeIds` 差集生成（不 `setState`、不依赖 passive effect），按移除前 `orderIndex` **插回原网格槽位**；`gridItems = active + ghosts`，同 id 去重且 **active 优先**。
- **移除**：ghost 保留 180ms（fade+scale）后从 `exitingRef` 删除并触发一次重渲染；其余卡片 FLIP 200ms（仅 `transform`/`opacity`）补位。
- **测量与触发**：FLIP 测量集合 = `gridItems` 全量（含 ghost 占位）；`render` 只写 `layoutSignatureRef = activeKey + '|' + exitingKey`，在 `useLayoutEffect` 内与 `lastSignatureRef` 比较（等价 pendingFlip arm）；**signature 不含 gridWidth** → 250ms 轮询/滚动条抖动不重复触发；宽度变化不触发 FLIP。
- **保护**：`dragRef` 拖动中不 arm FLIP；同帧移除 **>2 张**跳过 fade（多 ghost 同槽排序不稳）；`prefers-reduced-motion: reduce` 无 ghost 占位、无 FLIP（瞬时）。
- **已知边界**：ghost 只保留 180ms，多卡同时退场时超出 2 张不做 fade（避免长时间占位/排序抖动）。

---

## 7. 筛选

| 项 | 契约 |
|---|---|
| 类型 chips | 单选；计数**全局**：`全部 / Bash / 后台任务 / 终端`；0 计数仍显示（置灰可点） |
| 会话范围多选 | 列出 `sessions`（root 恒在首、子代理缩进 + 蓝点、队友琥珀点）；默认见 §12.3；底部说明「仅显示有命令行活动的会话」 |
| 搜索 | 匹配 `command` + 累积输出 + 显示名；**本地即时**，不触发 RPC；命中高亮 |
| 筛选状态 | 仅会话内存；View unmount 后保留到内存 store（再进 tab 仍生效） |
| 与轮询关系 | 筛选不减少轮询数据（服务端返回整树，client 本地过滤），避免筛选切换触发全量重取 |

---

## 8. 降级矩阵

| 场景 | 判定 | Host 行为 | RPC 表现 | UI 行为 |
|---|---|---|---|---|
| `webServer` 缺失 | 硬 inject 不满足 → 插件不激活 | — | 路由不存在 → fetch 404 | 空态「Host 半端未加载（缺少 webServer）」+ 重试 |
| `connection` 缺失 | 同上（硬依赖，F24/F30 先例） | — | 同上 | 同上 |
| `jobs` 缺失 | `ctx.get('jobs')===undefined` | 不采集 jobs | `availability.jobs={available:false,code:'missing-service',reason:'jobs service unavailable'}` | 「后台任务」chip 置灰 + tooltip 原因 |
| `terminals` 缺失 | 不采集 | `availability.terminals=false` | 「终端」chip 置灰 |
| `shell` 缺失 / tee 失败 | **预期降级**（F17） | 不 tee | `availability.bashLive={available:false, reason:'no-shell-handle'}`；`availability.bash` 仍 available（final-only 可用） | 前台 bash 列显示「仅终态」徽标；不影响列出现 |
| `subagents`/`agentTeams` 缺失或被拒 | 树发现失败 | 只返回 root | `availability.tree=false`；`sessions=[root]` | 会话范围只剩当前会话 + 提示「无法发现子会话」 |
| root Agent 不在 live registry | `ctx.agents.get(sessionId)` 空 | **v4：返回降级帧（`ok:true`，不报错）**：`sessions` 仅 root、`availability.tree.available=false`（reason 记「session has no live agent」）、`runs:[]`；**v7：terminal 不再因此消失**——走 §7.2 级 2/3 仍可登记 Run（`meta-only` + `notice.code:'terminal-no-agent'`），`diagnostics.agentFound=false` 可查 | 降级帧 + diagnostics | 面板显示降级提示；terminal 记录仍可见（输入块 + notice + 空输出） |
| terminal 发现降级（无 Agent / 侧栏未开启 / 无事件） | `diagnostics.terminals.source` = `events`/`sidebar`/`none`，`reason` 非空 | 按 §7.2 降级：级 2（默认关）开启时 → 侧栏来源标记；级 3 → 仍登记 Run（仅元信息 + tier3 片段）；全失败 → `source:'none'`（计数 0 但可诊断） | `PollResult.diagnostics` 每帧必带 | 面板：terminal Run 带 notice 行（次要色、不阻断阅读）；「终端 0 条」时可看 diagnostics 定位 |
| 隐藏 composer 失败（v7/T32 #5） | 官方能力/注入 CSS 均不可用或选择器不匹配 | 静默降级（不抛错、不改 DOM 结构、幂等清理） | — | 终端 tab 仍可用，只是 composer 未隐藏；其它 tab 不受影响 |
| 某会话 terminals/jobs 查询抛错 | 单会话失败 | 跳过该会话 | 该会话标记 reasons（不影响其它） | 该会话条目不显示对应来源 |
| job 输出窗口淘汰 | `readAt` 返回 `lossy` | 从保留头重发 | 通道 `lossy:true` | 输出插「…（已丢失 N 字节）」，不弹错 |
| terminal scrollback 裁剪 | `totalLines` 回退 / `truncated:true` | 重置基线并给当前尾页 | `TerminalDelta.lossy:true` | 插「…（较早输出已被终端 scrollback 裁剪）」，不弹错 |
| 帧预算耗尽 | `truncated:true` | 写 `nextCursors` | 帧内 `truncated` | 静默续读（≤3 次/tick） |
| 断线（fetch 连续失败 ≥2） | client 状态机 | — | — | `degraded` 横幅「连接中断，重试中」；恢复后清 + 「已恢复」 |
| 认证失效（401） | — | — | `unauthorized` | `blocked` 横幅「认证失效，请刷新页面」+ 重试；停轮询 |
| 页面隐藏 | — | — | — | 暂停轮询，恢复可见立即 poll |
| 输出超长 | 单列本地保留 `scrollbackLines`(600) | 服务端只给增量 | — | 区内滚动；顶部显示「已截断较早输出」 |
| 记录 >50 条 | — | — | — | 已完成列表虚拟化（可视 ±10 行） |

**总原则**：任何单一来源失败只降级该来源，面板主体与其它来源照常工作（ui-spec §5）。

---

## 9. 配置（Host 半端，`cordis.patch.yml` 可覆盖；v3 与 `lib/host/panel.mjs` `DEFAULT_CONFIG` 对齐）

| key | 默认 | 夹取范围（`resolveConfig`） | 含义 / 消费点 |
|---|---|---|---|
| `pollHintMs` | 250 | 150–300（整数） | 活跃轮询间隔（`hello.limits` 透出给 Client） |
| `maxFrameBytes` | 65536 | 1024–1048576（整数） | **Tier1 输出文本字节** + **Tier2 整帧 JSON 兜底**的共同上限（口径见 §4.3）；`hello.limits` 透出 |
| `maxRuns` | 32 | 1–64（整数） | 单帧最多 Run 数（`planReads` / `takeEntries` / `hello.limits`） |
| `completedLimit` | 50 | 1–200（整数） | **服务端**保留终态 Run 条数（`store.prune`） |
| `completedRetainMs` | 300000 | >0 的数字 | **服务端**终态保留时长（`store.prune`，映射 `retainCompletedMs`；**不用于 `removed` 的客户端展示语义**，见 §4.2 语义 5） |
| `terminalPageLines` | 400 | 1–2000（整数） | 单次 `terminals.read` 的 `count`（`planTerminalRead`） |
| `initialTailBytes` | 32768 | 0–1048576（整数） | 首见 Run（无游标）时给的尾部字节数（bash tee / job 首读） |
| `bashCapture` | true | boolean | 是否尝试 shell tee（best-effort；失败只降级，不影响 final-only） |
| `sidebarTerminals` | **false** | boolean（不做数值夹取） | **v7 新增**：默认 `false` = **不探测 `terminalController`**（侧栏/浏览器终端注册表，与 `ctx.terminals` 的 agent PTY 互不相通）；显式 `true` 才展示侧栏终端，此时 `diagnostics.terminals.source='sidebar'`（不是 `'controller'`）。默认关闭下侧栏终端不进入常规路径 |
| `scrollbackLines` | 600 | — | **预留**：当前 Host 不消费（Client 使用自身常量 `SCROLLBACK_LINES=600`）；保留供未来 UI 协商，改它不改变当前行为 |
| `collapseDelayMs` | 10000 | — | **预留**：当前 Host 不消费（Client 使用常量 `COLLAPSE_DELAY_MS=10000`，ui-spec 固定 10s）；保留供测试/未来协商 |

以下不是 Host 配置（避免再次漂移）：

| 常量 | 值 | 归属 | 说明 |
|---|---|---|---|
| `MAX_RESPONSE_BYTES` | 262144 | `lib/host/route.mjs` | Tier3 传输硬上限（整帧 JSON） |
| `PER_RUN_BUDGET_BYTES` | 16384 | `lib/host/cursors.mjs` | 每 Run 单轮读取预算 |
| `DEFAULT_OVERLAP_LINES` | 32 | `lib/host/terminal-window.mjs` | terminal 行增量尾重叠去重窗口 |
| `TERMINAL_PAGE_LINES` | 400 | `lib/host/terminal-window.mjs` | 行读取页大小的默认值（可被 `terminalPageLines` 覆盖） |
| `finalOutputBytes` | 32768 | `parseToolResultText(result, maxBytes=32768)` 的参数默认 | final-only 终态输出截断上限 |
| Client 端常量 | `IDLE_POLL_DEFAULT_MS=1000`、`RPC_TIMEOUT_MS=5000`、`FRAME_COMMIT_MS=60`、`BACKOFF_MS=[250,500,1000,2000,5000]`、`COMPLETED_RETAIN_MS=300000`、`MAX_RETAINED_COMPLETED=200`、`SCROLLBACK_LINES=600`、`COLLAPSE_DELAY_MS=10000`、`FOLLOW_TOLERANCE_PX=4`、`MAX_RUNS=32` | `lib/client.js` | Client 内部常量（Host 不配置；`hello.limits` 只透出 `maxFrameBytes`/`maxRuns`/`pollHintMs`） |

`routePath` **不做配置**（固定 `/terminal-panel/rpc`），避免双端漂移。

`[ASSUMPTION]` Host 插件可以不导出 `Config` schema，`apply(ctx, config)` 收 patch 的 config 原样对象，插件内补默认值。验证：T6 装包后跑 `cordis_inspect_query` `Config.listConfigs`，若 loader 拒绝未知 config 则改 schemastery `Config`（后续小修）。

---

## 10. 安全、权限与隐私

- 路由只接受 POST JSON，4 KiB 上限；入参白名单校验（sessionId/runId 为字符串 ≤200 字符）。
- 授权两层：① `connection.requestRejection` 认证；② 各服务 owner 围栏（jobs 的 `caller` = 目标 sessionId；terminals 的 `owner` = 该会话 Agent）。
- **跨会话聚合在服务语义上是允许的**（jobs 服务描述「authorization — not secrecy — is the boundary」；`readAt/list` 的 caller 是围栏不是身份）`[FACT]` F16；但**本机未实测跨 session 读**（scout U6）→ backend 冒烟必须用真实子会话跑一次 `jobs.list(childSessionId)` 与 `terminals.read(childAgent,…)`，失败则降级该来源并在 `availability` 记原因。
- 只读保证：不调用 `terminals.startSend`/`signal`；不写 session；不注入键盘。
- 唯一写操作 = 用户点「停止」（`jobs.kill` / `terminals.kill` / tee 成功时的 `ShellProcess.kill`），与模型工具 kill 语义区分。
- 日志只打错误码与来源名，不打输出内容；输出渲染走 React 文本节点，禁 `innerHTML`；`stripAnsi` 处理控制字符。
- `bashCapture` 的 tee 只读旁路：不得改 `exec.signal`、不得改工具结果、不得阻塞 `next()`。

---

## 11. 可测试性契约（tester 直接照此写用例）

### 11.1 Host 纯模块导出 **冻结表**（v3 冻结 + v5 增补 + v7 增补，改动需 Lead 批准）

> 冻结范围：`lib/host/{classify,tree,status,cursors,frame,terminal-window,terminal-events}.mjs`（纯逻辑、无 DSH/React 依赖，`node:test` 直接 `import`）；**v5 增补**：`frame.mjs` 的 H1/M2 4 个 additive 导出（Lead 批准）；**v7 增补**：新模块 `terminal-events.mjs`（终端事件旁路纯函数，见下表末段）。
> 不冻结：`panel.mjs` / `route.mjs`（集成）、`capture-*.mjs`（依赖 ctx，含 `capture-terminals.mjs` 的 `discoverTerminalCandidates`/`createTerminalEventCapture`/`collectTerminalRuns`/`killTerminalRun`）——由 `scripts/smoke-host.mjs` 与 `tests/host/{panel,assembly}.test.mjs` 覆盖；`store.mjs` 的 additive 导出与实例方法见 §11.1.1（v5 起冻结，v7 增补 `normalizeNotice`）。
> 本表已与 `lib/host/**` 工作树实际 `export` 逐条核对（2026-10-26，含 `4bc721e`；脚本核 missing=0）；tester 按「模块 → 导出名」对齐导出类用例。

| 模块 | 导出名 | 签名 / 返回 | 说明 |
|---|---|---|---|
| `classify.mjs` | `classifyTool` | `(name: string, args: unknown) => { kind:'bash'\|'job'\|'terminal'; command?: string; cwd?: string } \| null` | 规则：name 含 `terminal`→terminal；name ∈ `BASH_TOOL_NAMES`→bash；以 `job_` 开头→job；其余 null |
| | `isRunShapedTool` | `(name: string) => boolean` | 是否是会被面板承载的工具 |
| | `isBackgroundBash` | `(args: unknown) => boolean` | 是否是后台 bash（走 jobs） |
| | `BASH_TOOL_NAMES` | `readonly string[]`（冻结值 `['bash','pwsh','shell','exec']`） | bash 工具名集合 |
| | `RUN_TITLES` | `Record<RunKind, string>`（冻结对象） | 列头类型标签文案 |
| `tree.mjs` | `mergeSessionTree` | `(input: { rootSessionId: string; rootName: string; descendants: SubagentDescendantListEntry[]; members: TeamMemberView[] }) => SessionScope[]` | root 首位 depth=0；队友优先于同 id 子代理；diagnostic 行跳过（不读 activity） |
| | `scopeOf` | `(sessions: SessionScope[], sessionId: string) => SessionScope \| undefined` | 查会话作用域 |
| | `markActivity` | `(sessions: SessionScope[], ownerSessionIds: Iterable<string>) => SessionScope[]` | 标 `hasActivity` |
| | `treeHealth` | `(descendants: object[]) => { healthy: boolean; diagnostics: number }` | 树有 diagnostic 行 → 降级信号 |
| `status.mjs` | `mapShellStatus` | `(v: { status: string; exitCode: number \| null; signal: string \| null }) => RunStatus` | shell 三态映射 |
| | `shellDetail` | `(v: { exitCode?: number \| null; signal?: string \| null; timedOut?: boolean; aborted?: boolean }) => string \| undefined` | 失败/停止原因文本 |
| | `mapJobStatus` | `(raw: string) => { status: RunStatus; stopping: boolean }` | job 五态映射 |
| | `mapTerminalStatus` | `(v: { kind: string; exitCode?: number \| null; signal?: string \| null }) => RunStatus` | terminal 状态映射 |
| | `terminalDetail` | `(v: { exitCode?: number \| null; signal?: string \| null }) => string \| undefined` | terminal 退出原因 |
| | `isTerminalStatus` | `(status: string) => boolean` | `completed\|failed\|killed` |
| | `mapToolResultStatus` | `(v: { isError: boolean; error?: { message?: string; info?: { code?: string } } }) => RunStatus` | final-only 终态：成功→completed；code 含 abort/cancel→killed；否则 failed |
| `cursors.mjs` | `sliceFromBytes` | `(text: string, byteOffset: number) => string` | 按 UTF-8 字节偏移切片（不切半码点） |
| *（v7 增补）* | `headSliceByBytes` | `(text: string, maxBytes: number) => string` | 按 UTF-8 字节取头部、不切半码点（v7：事件片段合成/截断用） |
| | `tailBytes` | `(text: string, maxBytes: number) => { text: string; droppedBytes: number }` | 取尾部字节窗口 |
| | `mergeChannel` | `(prevCursor: number, read: { text?: string; nextOffset?: number; lossy?: boolean }, at?: number) => { chunks: object[]; nextCursor: number; lossy: boolean; gapBefore: boolean }` | bash/stderr 字节增量 |
| | `trimChunksFrom` | `(chunks: object[], from: number) => object[]` | 按 `byteStart` 去重（防 chunk 内重复） |
| | `mergeJobRead` | `(prevCursor: number \| undefined, read: { chunks?: object[]; next?: number; lossy?: boolean }, at?: number) => { chunks: object[]; nextCursor: number; lossy: boolean; gapBefore: boolean }` | job 绝对字节增量（`next` 不透明） |
| | `planReads` | `(runs: object[], cursors?: Record<string, object>, budget?: { maxBytes?: number; maxRuns?: number; focusRunId?: string }) => { order: string[]; perRunBudget: Record<string, number> }` | 本轮读哪些 Run、每 Run 字节预算（`PER_RUN_BUDGET_BYTES=16384`） |
| | `splitChunks` | `(chunks: object[], maxChunkBytes?: number) => object[]` | 单 chunk 切块（默认 16384） |
| | `limitDelta` | `(delta: object, maxBytes: number) => { delta: object; truncated: boolean }` | 单 Run 内截断，`truncated` 只在真截断时为 true |
| | `PER_RUN_BUDGET_BYTES` | `16384`（常量） | 每 Run 单轮预算 |
| | `TERMINAL_PAGE_LINES` / `DEFAULT_OVERLAP_LINES` / `createTerminalWindow` / `computeTerminalDelta` / `dedupeTailOverlap` / `lastLine` / `planTerminalRead` / `tailLinesOf` / `windowCursor` | 从 `terminal-window.mjs` re-export（见下） | 别名出口：`cursors.mjs` 也导出 terminal 行坐标工具 |
| `frame.mjs` | `outputTextBytes` | `(output: object) => number` | Tier1 口径：输出文本字节总和 |
| | `normalizeOutput` | `(output: object, fallbackAt?: number) => { stdout?, stderr?, job?, terminal? }` | 归一化增量块 |
| | `buildPollFrame` | `(input: object, cursors?: Record<string, object>, budget?: { maxBytes?: number; maxRuns?: number }) => { value: object; nextCursors: Record<string, object>; dropped: string[]; droppedEntries: object[] }` | Tier1 主口径裁剪（整 Run 跳过、首条放行） |
| | `boundFrame` | `(value: object, maxBytes: number) => object` | Tier2 兜底：整帧 JSON ≤ maxBytes，返回裁剪后的 `PollResult` |
| | `boundFrameDetailed` | `(value: object, maxBytes: number, options?: { preferRunId?: string }) => { value: object; droppedRunIds: string[]; trimmedRunIds: string[]; deliveredBytes: Record<string, Record<string, number>> }` | Tier2 兜底（H1）：至少保留 1 条 Run；`preferRunId` 指定保底优先项（dropStreak 用）；`trimmedRunIds` = 输出被裁剪的 Run；`deliveredBytes` = 各通道实际交付字节（panel 据此只退回未交付后缀） |
| | `headBytes` | `(text: string, maxBytes: number) => { text: string; truncated: boolean }` | 保留头部字节、不切半码点；`truncated` 仅真截断 |
| | `parseToolResultText` | `(result: { content?: Array<{ type?: string; text?: string }>; value?: unknown }, maxBytes?: number /* 默认 32768 */) => { text: string; truncated: boolean }` | final-only 终态文本：优先 text 块，否则 `value` JSON 摘要 |
| | `textBytes` | re-export `store.mjs` 的 `(text: string) => number` | UTF-8 字节数 |
| *（v5 增补，H1/M2）* | `pickFallbackRun` | `(runs: object[], preferRunId?: string) => object \| undefined` | Tier2 保底选择：`preferRunId` → 最新且 running → 最新 |
| *（v5 增补，H1/M2）* | `runOutputTextBytes` | `(run: object) => number` | 一条 Run 的输出文本总字节（Tier1 口径） |
| *（v5 增补，H1/M2）* | `trimRunOutput` | `(run: object, allowBytes: number, originalCursor?: object) => { run: object; cursors: object; deliveredBytes: Record<string, number>; trimmed: boolean }` | 只裁输出文本（status/元信息保留）；二分最大可交付字节，返回对应游标与实际交付字节 |
| *（v5 增补，H1/M2）* | `splitDeltaAtBytes` | `(delta: object, deliveredBytes: number) => { delivered: object \| undefined; remainder: object \| undefined }` | 把通道 delta 拆成已交付前缀 / 未交付后缀（部分交付后只退回后缀，绝不丢字节） |
| `terminal-window.mjs` | `createTerminalWindow` | `() => { totalLines: number; tail: string }` | terminal 行基线初值 |
| | `lastLine` | `(text: string) => string` | 取最后一行（PTY `\r` 重写用） |
| | `tailLinesOf` | `(text: string, lines?: number /* 默认 32 */) => string` | 取尾部 N 行 |
| | `dedupeTailOverlap` | `(prevTail: string, incoming: string, overlapLines?: number /* 默认 32 */) => { text: string; overlapLines: number }` | 行尾重叠去重；**必须保留行内 `\n`**（HIGH 缺陷回归点） |
| | `planTerminalRead` | `(prev: { totalLines: number } \| null, totalLines: number, pageLines?: number /* 默认 400 */) => { offset: number; count: number; mode: 'initial'\|'delta'\|'probe'\|'reset' }` | 行读取计划（`offset` = 距最新行数） |
| | `computeTerminalDelta` | `(prev: { totalLines: number; tail: string }, page: { text: string; totalLines: number; lineBegin: number; lineEnd: number; truncated: boolean }, overlapLines?: number /* 默认 32 */) => { delta: TerminalDelta; nextBaseline: { totalLines: number; tail: string } }` | k=totalLines 差；**k<0 → lossy + 重置基线**；**k===0 → 正常探尾，不标 lossy、基线不变**（v4）；k>0 → 尾页 + 尾重叠去重（调用 `composeTextAppend`） |
| | `composeTextAppend`（v7） | `(state: { tail?: string; hasPrevious?: boolean; endsWithNewline?: boolean }, incoming: string, overlapLines?: number /* 默认 32 */) => { text: string; overlapLines: number; continuesLine: boolean }` | **v7：唯一行边界规则来源**；`computeTerminalDelta` 的 k>0 分支已改为调用它（行为不变）；tier3 事件片段与真终端输出混用时行边界由此函数统一裁定。返回：`continuesLine=true` = 续写上一行（不补换行）；否则若上一段不以换行结尾，`text` 前会补一个合成 `\n` |
| | `applyTerminalRead` | `(window: { totalLines: number; tail: string }, page: object, overlapLines?: number) => { delta: TerminalDelta; window: object }` | compute + 推进窗口 |
| | `windowCursor` | `(window: { totalLines?: number }) => number` | 行基线游标 |
| | `TERMINAL_PAGE_LINES` / `MAX_DELTA_LINES` / `DEFAULT_OVERLAP_LINES` | `400` / `10000` / `32` | 常量（冻结值） |
| **`terminal-events.mjs`**（v7 新增模块） | `TERMINAL_INPUT_LIMITS` | `{ maxEntries: 20, maxEntryBytes: 2048, maxTotalBytes: 8192 }`（冻结对象） | `Run.inputs` 边界（契约 §7.1） |
| | `TERMINAL_NOTICE_MESSAGES` | `Record<NoticeCode, string>`（冻结对象） | 三种 notice code 的默认文案 |
| | `noticeFor` | `(code: string, message?: string) => { code: string; message: string }` | 构造 `Run.notice`；无 message 用默认文案 |
| | `appendTerminalInput` | `(inputs: string[] \| undefined, entry: string, limits?: typeof TERMINAL_INPUT_LIMITS) => { inputs: string[]; dropped: number }` | 追加一条输入并执行 20 条/2 KiB/8 KiB 裁剪（丢最旧）；UTF-8 安全 |
| | `terminalToolCall` | `(name: string, args: unknown) => { kind: 'open'\|'send'\|'read'\|'close'\|'signal'\|'list'; terminalId?: string; text?: string; type?: string; name?: string } \| null` | 从工具名+参数识别 terminal_* 调用（第三级发现） |
| | `parseTerminalOpenResult` | `(text: string) => { terminalId: string; name?: string; type?: string } \| null` | 解析 `terminal_open` 结果文本 |
| | `parseTerminalSessionStatus` | `(text: string) => { kind: 'running' } \| { kind: 'exited'; exitCode: number \| null; signal: string \| null } \| null` | 解析结果里的会话状态 |
| | `parseTerminalCloseResult` | `(text: string) => { terminalId: string; outcome: 'closed'\|'already-closing' } \| null` | 解析 `terminal_close` 结果 |
| | `parseTerminalListResult` | `(text: string) => Array<{ terminalId: string; name?: string; type?: string; pid?: number; status?: object }>` | 解析 `terminal_list` 多行结果 |
| | `normalizeControllerTerminal` | `(raw: object, fallbackSessionId?: string) => { terminalId: string; name?: string; type?: string; pid?: number; status?: object } \| null` | 归一化 `terminalController.list(sessionId)` 的条目 |

#### 11.1.1 `store.mjs` additive 导出与 Store 实例方法（v5 增补，H1/M2 修复；改动需 Lead 批准）

> `store.mjs` 整体仍是**有状态模块**（集成由 `tests/host/panel.test.mjs` 覆盖）；下表只冻结 H1/M2 修复新增的 **additive** 面，避免下游按旧表误判「导出缺失」。

| 形态 | 导出名 | 签名 / 返回 | 说明 |
|---|---|---|---|
| 模块导出（新增常量） | `META_MAX_BYTES` | `4096` | 元信息单字段 UTF-8 字节上限（H1） |
| 模块导出（新增纯函数） | `truncateMetaText` | `(text: string, maxBytes?: number /* 默认 4096 */) => { text: string; truncated: boolean }` | UTF-8 安全截断 + 末尾 `…`（不切半码点） |
| 模块导出（既有，H1 起承担截断职责） | `serializeRun` | `(record: object, now: number) => object` | 记录 → 线上 `Run`；对 `title/command/cwd/detail` 逐字段截断并置 `metaTruncated` |
| 模块导出（既有） | `createRunStore` | `(options?: { completedLimit?: number; retainCompletedMs?: number; now?: () => number }) => StoreApi` | 创建 Run 注册表 |
| 模块导出（既有） | `textBytes` | `(text: string) => number` | UTF-8 字节数（多处 re-export） |
| 模块导出（既有） | `kindWeight` | `(kind: string) => number` | Run 类型排序权重 |
| Store 实例方法（新增，M2） | `frameSelection` | `(options?: { includeCompleted?: boolean; maxRuns?: number; focusRunId?: string }) => object[]` | **唯一选择集**（focus → running startedAt 升序前 N → completed）；`planReads` 必须用同一集合 |
| Store 实例方法（新增，M2） | `selectForFrame` | 同 `frameSelection`（**别名**） | 语义等价，供调用方按可读性选用 |
| Store 实例方法（新增，H1） | `commitCursorsFromFrame` | `(nextCursors?: Record<string, object>) => void` | 只按**本帧实际交付**的 `nextCursors` 提交游标（Tier2/3 裁剪后唯一可信来源） |
| 模块导出（v7 新增纯函数） | `normalizeNotice` | `(notice: unknown) => { code: string; message: string } \| undefined` | 归一化 `Run.notice`（只保留 code/message 字符串；code 空 → undefined） |
| Store 实例方法（v8 新增） | `prune` | `(now?: number, options?: { protect?: Set<string>\|string[] }) => string[]` | 淘汰过期终态；**`protect` = 本帧 discovery 已见 runId，不得 prune**（防 removed/re-upsert 抖动）；返回本次移除的 runId |
| Store 实例方法（v8 新增） | `resync` | `(options?: { includeCompleted?: boolean; maxRuns?: number; focusRunId?: string }) => string[]` | 全量重同步：可见选择集 Run `metaDirty` + 读游标回退保留窗口起点；**不产生 removed**；返回被重置 runId（供 prune 保护） |

#### 11.1.2 `capture-terminals.mjs` v7 新签名（集成模块，**不冻结**但列全供集成用例对齐）

> 依赖 `ctx`（terminals/agents/terminalController/store），不进纯函数冻结表；签名以 `lib/host/capture-terminals.mjs` 为准。

| 导出名 | 签名 / 返回 | 说明 |
|---|---|---|
| `terminalRunId` | `(terminalId: string) => string` | runId 构造（既有） |
| `discoverTerminalCandidates` | `(options: object) => Promise<{ candidates: object[]; readAgents: Map<string, object>; source: 'terminals'\|'sidebar'\|'events'\|'none'; reason?: string; degradedSessions: string[]; sidebarEnabled: boolean }>` | v7 发现：agent PTY →（`sidebarTerminals:true` 时）侧栏终端 → events；默认 sidebar 关闭 |
| `collectTerminalRuns` | `(options: object) => { available: boolean; reason?: string; readFailures: number; candidates: number }` | 登记/更新 terminal Run（meta-only、inputs、tier3 片段） |
| `createTerminalEventCapture` | `(options: { store: any; now?: () => number; logger?: any }) => { noteToolCall: Function; noteToolResult: Function; dispose: Function }` | `tools/execute`/`tools/result` 旁路：terminal_* 事件 → Run/inputs/片段/终态 |
| `killTerminalRun` | `(options: { terminals: any; run: object; agent: any; logger?: any }) => Promise<'requested'\|'already-finished'\|'unsupported'>` | 用户停止；无 live Agent 时 `unsupported` |

`scripts/smoke-host.mjs`（backend）用 mock ctx 跑通路径：「bash 增量/终态（tee 可用与不可用两种）」与「job 列表 → 终态」，另加「terminal 行增量→去重→裁剪」；退出码 0。

### 11.2 Client 纯函数（不得 import React）与 `__internals` **冻结表**（v9/v10 不变：53 键；两版客户端改动均为纯 CSS/渲染内部实现，未新增导出）

**仍然采用 v1 的单文件 + `__internals` 方案**（frontend 写作用域不含 `scripts/**`，禁止装打包器）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-terminal-panel',
  factory(require) {
    const React = require('react')
    // …纯函数与组件…
    function apply(ctx) { /* 注册 slot + locale + style */ }
    return { inject: ['slots', 'locale'], apply, __internals: { /* 见冻结表 */ } }
  },
})
```

Tester 取用（写进 tests）：

```js
let captured
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec } } }
await import('../lib/client.js')
const mod = captured.factory((id) => {
  if (id === 'react') return { createElement: (...a) => ({ type: a[0], props: a[1] }) }
  throw new Error(`unexpected require(${id})`)
})
const { mergePoll, clampColumnWidth } = mod.__internals
```

**`__internals` 冻结表（v3 冻结，改动需 Lead 批准；与 `lib/client.js` 实际返回对象逐键核对）**

| 分类 | 导出名 | 签名 / 返回 |
|---|---|---|
| 列宽 | `clampColumnWidth(width)` | → `number`（280–640；NaN/字符串→352） |
| | `DEFAULT_COLUMN_WIDTH` / `MIN_COLUMN_WIDTH` / `MAX_COLUMN_WIDTH` | `352` / `280` / `640` |
| 筛选与排序 | `filterRuns(runs, filter)` | → `Run[]` |
| | `countByKind(runs)` | → `{ all:number; bash:number; job:number; terminal:number }` |
| | `searchMatch(run, query)` | → `boolean` |
| | `orderRunningColumns(runs)` | → `string[]`（runId，startedAt 升序） |
| | `groupCompleted(runs)` | → `string[]`（runId，finishedAt 降序） |
| 跟随 | `createFollowState()` | → `FollowState` |
| | `onScrollFollow(state, m: { scrollTop:number; scrollHeight:number; clientHeight:number })` | → `FollowState`（距底 ≤4px 恢复） |
| | `onOutputFollow(state, lines: number)` | → `FollowState`（累积 pendingNewLines） |
| (v7) | `collapseVisual(state, now)` | → `{ expanded:boolean; visible:boolean; countdown:boolean; remaining:number; progress:number; pinned:boolean; paused:boolean; armed:boolean }`（#4 收敛：`expanded===false` 一律 `countdown:false/progress:0`，pinned 永不倒计时） |
| (v7) | `firstCommandLine(command, maxLen?)` | → `string`（首条非空行、折叠空白、超长 `…`、多行末尾 ` +N 行`；默认 maxLen=120） |
| (v7) | `applyComposerHidden(node, visible)` | → `boolean`（在 `[data-conversation-content]` 节点上 set/remove `data-tp-composer-hidden`；幂等、失败静默返回 false 不抛错） |
| (v8) | `isRevisionRollback(appliedRevision, incomingRevision)` | → `boolean`（`incoming < applied` = 服务端重建；`===` 重复帧/`>` 前进不算回退） |
| (v8) | `runPhase(run, column, now?)` | → `'running' \| 'linger' \| 'completed'`（终态且 linger state 有 deadline 未到/暂停/pinned → linger） |
| (v8) | `lingerVisual(state, now?)` | → `{ visible:boolean; remaining:number; progress:number; armed:boolean }`（paused 冻结 remaining；到点 armed=false） |
| (v8) | `pauseLinger(state, now?)` | → `state`（`paused:true`，冻结倒计时并记录 `frozenRemainingMs`；**`now?` 为可选注入时钟，缺省 `Date.now()`**） |
| (v8) | `resumeLinger(state, now?)` | → `state`（`paused:false`，`deadline=now+10s`，重新计满 10s） |
| (v8) | `collapseLinger(state)` | → `null`（「收起」按钮：立即结束滞留；幂等，空输入安全） |
| (v8) | `createSessionCache(options?)` | `({ max?, ttlMs?, now? }) => { get(sessionId, now?): entry\|undefined; set(sessionId, entry, now?): void; delete(sessionId): boolean; clear(): void; size(): number }`（LRU 4 / TTL 30min，命中刷新最近使用） |
| (v8) | `SESSION_CACHE` | 模块级单例缓存（`createSessionCache()`，跨 View 挂载保留、插件卸载清） |
| (v8) | `LINGER_DELAY_MS` | `10000`（滞留时长常量） |
| (v8) | `CARD_EXIT_MS` / `FLIP_MS` | `180` / `200`（淡出时长 / FLIP 补位时长） |
| (v8) | `flipDeltas(prevRects, nextRects)` | → `Record<runId, { dx:number; dy:number } \| null>`（新增/删除/无位移 → null；仅返回有位移项） |
| 自动收起 | `createCollapseState()` | → `CollapseState` |
| | `armCollapse(state, now)` | → `CollapseState` |
| | `pauseCollapse(state)` | → `CollapseState` |
| | `resumeCollapse(state, now)` | → `CollapseState`（重置完整 10s） |
| | `tickCollapse(state, now)` | → `CollapseState` |
| | `pinCollapse(state)` | → `CollapseState` |
| 文本与时间 | `stripAnsi(text)` | → `string` |
| | `tailLines(text, maxLines)` | → `{ text:string; dropped:number }` |
| | `formatDuration(ms)` | → `string` |
| | `formatCountdown(ms)` | → `string` |
| 核心 reducer | `mergePoll(state, frame, options?)` | → `ViewState`（`options: { defaultWidth?, autoExpandNew?, now?, scrollbackLines? }`） |
| 辅助（同样冻结） | `createViewState(sessionId)` | → `ViewState` |
| | `createColumnState(runId, status, options?)` | → `ColumnState` |
| | `pruneRuns(state, now)` | → `ViewState`（本地兜底淘汰，见 §4.2 语义 5） |
| | `expandCollapse(state, now)` | → `CollapseState` |
| | `unpinCollapse(state, now)` | → `CollapseState` |
| | `runText(run)` | → `string`（命令/标题文本） |
| | `outputText(run)` | → `string`（累积输出文本） |
| | `formatClock(epochMs)` | → `string` |
| | `formatBytes(bytes)` | → `string` |
| | `isTerminalStatus(status)` | → `boolean` |
| 常量 | `FOLLOW_TOLERANCE_PX` / `COLLAPSE_DELAY_MS` / `SCROLLBACK_LINES` / `COMPLETED_RETAIN_MS` / `MAX_RUNS` | `4` / `10000` / `600` / `300000` / `32` |

`mergePoll` 必须满足（tester 重点）：

- `revision <= 已应用` → 原样返回（引用相等）。
- 相同帧重复应用 → 等价（幂等）。
- **`removed`：立即删除 run 与 column（以及 droppedLines/游标），未命中不抛错；不做延时保留**（v3 定案，见 §4.2 语义 5）。
- `truncated` 不改变游标语义（游标只由 `nextCursors` 推进）。
- `chunks` 一律 append；`terminal` 行增量同样 append，`lossy` 插入缺口标记。
- `availability` 变化只改标记，不清空已有数据。
- `outputMode:'final-only'` 的 Run 在 running 阶段无输出块也不报错。
- **终态单调（HIGH 缺陷回归点）**：已终态 Run 收到 running/旧帧不得回退为 running；`mergeRun` 的 status 合并必须保持单调。

### 11.3 装配测试（tester 可做）

- Host 路由：mock `webServer.register` 捕获 `route`，断言 `kind==='exact'`、`path==='/terminal-panel/rpc'`；dispose 后路由被撤。
- Client apply：mock `ctx = { inject, effect, locale, slots }`，断言 `slots.register` 调用一次且 `options.id==='terminal-panel'`、`order===30`、`label()` 返回「终端」、`inject(sessionId)` 返回对象；`ctx.effect` 清理执行后无残留定时器/监听/`<style>`。
- **真实加载验证（U4/A8-1，安装后做）**：`window.__DSH_BOOT__` 含 `dsh-terminal-panel` 行、`/plugins?…` 200（见 docs/install.md §3）。

---

## 12. 裁决结果与已裁决限制（Lead 2026-10-26 定稿）

### 12.1 Tab 角标（运行中数量 + 蓝点）— **裁决：不实现**

- `[FACT]` 内建 tab 渲染只读 `options.id`/`options.label`（F26）；`viewTabs()` 只在 slot 注册表/locale 变化时重算；无 badge API。
- 结论：不做角标；运行中数量显示在面板工具栏「N 个进行中 · M 条记录 · K 个会话」（ui-spec §2.3）。scout 的 A3-1（label 返回 ReactNode）列为**低优先级试验**，不作为 v2 依赖。

### 12.2 持久终端用 xterm 渲染 — **裁决：降级为纯文本流**

- `[FACT]` 平台表 11 键无 xterm（F11）；`dsh.client.external` 只能解析到「已启用客户端包 row」或「完全相等的静态表键」，`@xterm/xterm` 不在其中；禁止装依赖（任务约束）。
- 结论：终端输出 = `ctx.terminals.read` 的行文本 + `stripAnsi` + 等宽字体 + 终端底色；**全屏 TUI（vim/htop）退化为文本流**，UI 需接受。`dsh-better-sidebar` 的 xterm 方案不可复用（需自带打包）。

### 12.3 默认会话范围 — **裁决：默认「全部会话」**

- `[FACT]` 文档内冲突：ui-spec §4「当前会话（默认选中）」vs v2 变更 §1.5 + A 板标题「默认全部会话」。
- 结论：`DEFAULT_SESSION_SCOPE = 'all'`（`sessionIds=null`）；改回「仅当前会话」只改一个常量。此项已由 Lead 确认。

### 12.4 插件显示元数据 — **裁决：v2 补齐**

- 已交付 `icon.svg`（24×24 终端字形，16/24px 可读，原创 artwork）与 `locale/{zh,en}.json`（`meta.title/description`，结构对齐 `dsh-context`）。
- `package.json`：`exports["./icon"]`、`exports["./locale/*.json"]`、`files` 含 `icon.svg`/`locale/*.json`、`dsh.manifestVersion: 1`（F1、F9）。
- tab 文案仍由 Client 内联 `ctx.locale.register`（tab 的 `label` 不能跨包读 JSON，F26/F29）；`locale/*.json` 只服务 Plugin Manager 的展示元数据（宿主读取无需激活）。

### 12.5 传输通道 — **裁决：保留 exact HTTP 路由**

- 保留 v1 `POST /terminal-panel/rpc`（backend 已按此实现）；`ctx.connection.rpc` 见 §4.1「备选/后续简化」，不要求 backend 重做。

### 12.6 `terminals.read` offset 语义 — **裁决：FACT 定案（v1 ASSUMPTION 作废）**

- v1 §12.6 的「offset 为绝对行号」假设**错误**。FACT：`offset` = 距最新行数（0=尾页）；`lineBegin=offset`、`lineEnd=offset+返回行数`、`end=totalLines-offset`、`start=max(0,end-count)`；绝对行号 = `totalLines - lineBegin/lineEnd`。
- 分页：下一次 `offset = 上次 lineEnd`；增量：`k=totalLines 差`，拉 `{offset:0,count:max(k,1)}` 并去重；`truncated` 含义见 F18。

### 12.7 前台 bash 过程输出 — **裁决：三层降级（见 §5.2）**

- 接受限制：无 `ShellExecution` 句柄 → 过程输出默认不可得。UI 对 `outputMode:'final-only'` 的 Run 显示「仅终态」徽标，终态输出一次性出现；停止按钮禁用。
- 若用户需要实时输出 → 引导用后台 job（`run_in_background`）走 `ctx.jobs`（天然增量）；`bashCapture` tee 保留为 best-effort，未来若 harness 提供句柄回调可无缝升级为 live。

### 12.8 已裁决限制与「不做」项汇总（写进 README/验收）

1. tab 无角标（计数在工具栏）。
2. 终端非 xterm 屏幕帧，全屏 TUI 退化为文本流。
3. 前台 bash 默认只有终态输出（`final-only`），过程输出不可得。
4. 默认会话范围 = 全部会话。
5. 插件不接管输入；唯一写操作是「停止」。
6. 跨会话聚合的实测验证列在 backend 冒烟（scout U6）。

**已裁决不做的 UI 项（M1，2026-10-26）**：

| UI 项（ui-spec §3.7 `⋯` 菜单） | 裁决 | 原因 | 替代 |
|---|---|---|---|
| 「在对话中定位」 | **本期不做** | `Run` 契约没有 `turn/message` 引用（无法可靠跳回对话节点）；补引用需改数据源契约，超出本期范围 | 「复制命令」/「复制输出」/「固定展开」（已实现）+ 面板筛选/搜索可近似定位 |
| 「在终端中打开（仅终端）」 | **本期不做** | 插件只读、不接管宿主终端面板；复用宿主终端需要跨插件 API（不在平台模块表/本契约内） | 「复制输出」后在宿主侧边栏终端自行查看 |

### 12.9 仍未确认项（scout U2/U4/U6/U8，不阻塞 v2）

| # | 项 | 影响 | 归属/验证 |
|---|---|---|---|
| U4 | `link:` 安装 + 手写 `lib/client.js` 能否被 `/plugins` 服务 | 开发循环 | devops/integration：安装后看 `window.__DSH_BOOT__` 与 Network 200 |
| U6 | 跨 session 读 jobs/terminals 是否真被允许 | 多会话聚合核心 | backend 冒烟用真实子会话验证 |
| U8 | Desktop 重启/生效路径与 watcher 覆盖 workspace | 迭代成本 | 首次安装后记录到 install.md |
| U2 | `label` 返回 ReactNode 能否做角标 | 仅角标 | 低优先级，不改 v2 |

### 12.10 已知差异（LOW，T6 集成审计 L1–L5；v4.1 落字）

> 本表是 LOW 差异的唯一登记处。处置口径：**不修（可接受）** = 本期不做、已知风险可接受；**后续** = 归 owner 排期；**已修** = 已随前面 commit 关闭。

| ID | 差异 | 处置 | 依据 / 备注 |
|---|---|---|---|
| L1 | 部分 UI 文案硬编码中文未走 locale：停止相关 toast（`已请求停止/该任务已结束或不可见/该来源不支持停止`）、lossy 缺口标记（`（已丢失 N 字节/行）`） | **后续（owner: frontend）** | en 界面会显示中文；不影响功能。非阻塞，可在下一次 frontend 改动时顺手 locale 化 |
| L2 | 像素偏差：命令行高度 24px vs 规格 22px；停止按钮 18px vs 规格 16×16 | **不修（可接受）** | 视觉差 2px，待真机与 Figma A 板叠图后确认；如不通过由 frontend 调 CSS（不属于契约/逻辑缺陷） |
| L3 | `hello.limits` 未发 `idlePollHintMs`；`budgetMode` 未发 | **不修（可接受）** | 契约 §4.3/§4.5 已标注可选，client 有常量兜底；无功能影响 |
| L4 | `formatCountdown` 纯函数硬编码 `'s 后收起'` | **不修（可接受）** | 纯函数契约输出（tester 依赖）；UI 实际使用 locale `collapse.in`，非 UI 缺陷 |
| L5 | T5 测试桩 `ctx.on` 曾返回 `{dispose}` 对象（真实 cordis 为函数） | **已修** | `tests/helpers/fakes.mjs` 已修正；仅测试夹具，不影响生产 |

### 12.11 真机缺陷驱动裁决（v7，2026-10-26 Lead 裁决）

> 触发：用户真机 5 项反馈（terminal 不可见 / 抖动 / 标题半截命令 / 输出不含输入 / 收起时序 / composer）。实现：T31（Host）、T32（Client）。

| # | 裁决 | 理由（真机证据） | 验收载体 |
|---|---|---|---|
| R1 | **`terminal_open` 记录必须可见，不可静默 0 条** | 真机轮次里有 `terminal_open`（pty-4/pty-5）/`terminal_send`/`terminal_read`，面板却恒显示「终端 0」；旧实现 agent 缺失时 noAgent 分支直接删 Run、且只标 denied 不报错 | §7.2 三级发现链路 + `Run.notice` + `PollResult.diagnostics`；tester 用例（T34）：agent 缺失仍出 Run、source/reason 正确、close 才结束 |
| R2 | **输入必须与输出同面板可见** | 只显示输出无法判断执行了什么（多行/heredoc 更甚），是 #3 的一半 | Client 输出区顶部输入块：bash/job 完整 `command`（每行 `$ ` 前缀）；terminal 名称 + `inputs`（`› ` 前缀）；空输出仍显示输入块 + `output.empty`；ui-spec v5 §2.1/§9 可验收条目 |
| R3 | **终端 tab 激活时隐藏会话输入框（composer）** | 终端版面需要垂直空间，插件只读、composer 在该 tab 无意义（#5） | 优先官方能力；否则按 scout 方案 A：在面板根 `el.closest('[data-conversation-content]')` 上 set/remove **`data-tp-composer-hidden`**，CSS 隐藏 `[data-composer-seat]`（找不到锚点静默降级，无 body 兜底）；失败**静默降级**、不影响其它 tab，卸载幂等恢复 |
| R4 | **`terminalController` = 侧栏/浏览器终端注册表，与 `ctx.terminals`（agent PTY）互不相通**；`terminalController.list(sessionId)` **不能**作为 `terminal_open` 可见性的修复依据 | scout T30 FACT：两者是不同注册表/不同 owner 身份；把侧栏终端混进 agent PTY 列表会误导用户 | v7 起 **`sidebarTerminals` 默认 false**（§9）：默认不探测 controller；显式 true 才展示，`diagnostics.terminals.source:'sidebar'` 且 Run 必须标侧栏来源，**不得与 agent PTY 混排混淆**（§7.2） |
| R5 | **历史/已卸载 owner 的 terminal 输出不可回读** | `ctx.terminals` 是进程内 owner-对象身份注册表，owner 卸载即清理；`terminalController.attach` 需 Remote invocation，Host 插件不可用 | 验收口径：terminal 可见性只对**部署后新发生**的 `terminal_*` 判定；历史 pty 一律不计缺陷 |
| R6 | **tier3 文本片段语义**：`terminal_send` 的 `result.value.viewport` / `terminal_read` 的 `result.value.text` / `terminal_open.motd` 是唯一可得的真实终端文本，可追加为 Run 输出（标来源/截断） | 无 Agent 时没有连续流；这是 `meta-only` 列的补偿路径 | 语义 = 「模型读写时看到的片段」：**非连续、可能重复/跳跃、不是实时全量**；UI 标注来源，验收不得按实时全量判定（§7.1/§7.2） |
| R7 | **`notice.code` 生产集合**：实际只产出 `terminal-no-agent` / `terminal-read-failed`；`terminal-controller-unavailable` 为**保留值** | 默认 `sidebarTerminals=false` 下不会产生 controller 相关 notice；开启且 controller 缺失时原因写在 `diagnostics.terminals.reason` | §7.1 NoticeCode 说明 + Host 用例断言实际 code 集合 |
| R8 | **侧栏终端本期不做 UI 区分** | 默认关闭因而不进入常规路径；开启时也只有 `diagnostics.terminals.source='sidebar'` 一个标识 | 仅在契约/diagnostics 层记录；UI 不做侧栏专属视觉（避免与 agent PTY 混淆即可） |

### 12.12 客户端展示层裁决（v8，2026-10-26 Lead 裁决 + 真机反馈）

| # | 裁决 | 理由 | 验收载体 |
|---|---|---|---|
| R9 | **执行区横向滑动/横向滚动条/右侧 `›` 溢出按钮废弃**，改为固定宽卡片自动换行 + 纵向滚动 | 真机反馈：列多时横向滑动难用、找不到溢出列；纵向网格更自然 | ui-spec v6 §2.1/§9 A14；tester 静态断言无 `overflow-x`/`scrollLeft`/`›` 溢出按钮/横向滚动条伪元素 |
| R10 | **Run 三态 linger 取代 v7「新终态自动展开分组」**（替换，非叠加） | 真机反馈：终态瞬间跳入已完成导致跳动、刚结束的任务难找；10s 滞留 + 「收起」按钮更可控 | ui-spec v6 §2.2/§9 A15–A17；tester 断言 `runPhase`/`lingerVisual`/收起 reducer |
| R11 | **`revision` 回退 = 服务端重建**：客户端清本地 view + 发一次 `resync:true`（旧语义 `<=` 丢弃会让 Host/插件重载后面板永久冻住） | 真机②：重载后面板停止更新，需刷新页面 | §4.2 语义 6 / §6.8；tester 断言 `isRevisionRollback` + 组件清 view + resync 只发一次 |
| R12 | **`removed` 与 `runs` 同帧互斥，冲突以 runs 为准**；`store.prune` 增加「本帧已见」保护 | 真机①：job 结算后同帧 removed+重新 upsert 造成列表抖动 | §4.2 语义 5/9；tester 断言同帧互斥、protect 不 prune |
| R13 | **状态色板**：进行中=黄 `--dsw-alias-state-warn-primary`、已完成=绿 `--dsw-alias-state-success-primary`、失败=红 `--dsw-alias-state-error-primary`；hover/focus 不改布局尺寸 | 真机：状态靠颜色不可辨、hover 抖动 | ui-spec v7 §2.1/§2.2 + §9 A24；tester 静态断言边框色令牌 + 无尺寸变化 |
| R14 | **树外 owner 不由 tier1 排除**：Agent 解析 = `scopes ∪ store terminal ownerSessionId`；命中即清 notice、`meta-only→live` | 真机 TERM 全部 meta-only，根因 owner 在树外（scout T42） | §5.2/§7.2/§9.4；tester mock 树外 owner live 用例 + diagnostics.terminalOwners |
| R15 | **网格 `auto-fill` 统一列宽**：所有卡等宽、整行铺满、**最后一行单卡不拉伸**；拖右缘 = 统一 `--tp-card-w`（280–640），不再支持每卡独立宽；**禁 auto-fit** | 真机：卡片宽窄不齐、最后一行被拉满；每卡独立宽难对齐 | ui-spec v8 §2.1/§9 A31；tester 静态断言 grid/auto-fill/gap/align-content + 拖拽写统一值 |
| R16 | **重排动效 = 渲染期同步 ghost + 插回原槽位**（替换 v8/v9 晚一帧 ghost） | 真机：点收起卡片瞬移/二次反向重排；晚一帧 ghost 把退场卡推末尾 | ui-spec v8 §3/§9 A32；tester 断言 ghost 同步派生/原 index/FLIP 含 ghost/signature 不含 gridWidth |

---

## 13. 下游交接清单

### 13.1 backend（T3）v2/v3 增补

- [ ] `tools/execute` 只读记录（**必须 `return await next()`**）；`exec.agent` 可选，缺失不猜归属。
- [ ] `tools/result`（emit）取终态输出 → `parseToolResultText`；Run 标 `outputMode:'final-only'` + `detail:'final-only'`。
- [ ] `bashCapture` 的 shell tee 为 **best-effort**：失败只设 `availability.bashLive={available:false, reason:'no-shell-handle'}`，**不得**让插件加载失败或影响工具链。
- [ ] terminal 用行坐标：`computeTerminalDelta` + 尾重叠去重 + `totalLines` 回退置 lossy；**HIGH 回归**：跨页拼接保留 `\n`（`tests/host/terminal-window.test.mjs`）。
- [ ] `jobs.readAt` 用 `next` 不透明游标；`caller` 传**目标** sessionId。
- [ ] 路由 handler 自己 try/catch，不外抛（外抛=HTTP 500 纯文本）。
- [ ] **v3 预算三级**（§4.3）：Tier1 `buildPollFrame`（输出文本口径）→ Tier2 `boundFrameDetailed`（整帧 JSON 兜底，被丢 Run 退回 `store.restore` 且不提交游标）→ Tier3 `route.boundResponseValue`（262144 硬上限，被丢 Run 游标回退上一轮）。**`truncated` 与 `nextCursors` 必须满足 §4.3 不变量**。
- [ ] **LOW 回归**：`boundFrame` 的 1 字节边界（`≤ limit` 放行 / `> limit` 裁剪；`headBytes` 不切半码点）→ `tests/host/frame.test.mjs`。
- [ ] 跨会话聚合冒烟（U6）；任一来源异常降级不 500。
- [ ] **v7 terminal 三级发现**（§7.2）：①`terminals.list(agent)` → ②`terminalController.list(sessionId)`（免 Agent）→ ③`tools/execute` 事件（`terminal_open`/`terminal_send`/`terminal_close`）；每级失败只降级并记 `diagnostics.terminals.reason`，**不得抛异常**。
- [ ] **v7 agent 缺失不删 Run**：noAgent 不再 `store.remove` terminal Run；改为 `outputMode:'meta-only'` + `notice.code:'terminal-no-agent'`。
- [ ] **v7 `Run.inputs` 采集**：仅 terminal；初始 name + `terminal_send` 文本；最后 20 条、单条 ≤2 KiB、合计 ≤8 KiB，超出丢最旧；bash/job 不加字段。
- [ ] **v7 `Run.notice` + `outputMode:'meta-only'`**：notice code 至少三种；meta-only 与 live/final-only 并列。
- [ ] **v7 `PollResult.diagnostics` 每帧必带**（`rootSessionId/agentFound/agentCount/scopes/terminals{candidates,source,reason?}`），不许省略；`source` 取值 `'terminals'|'sidebar'|'events'|'none'`（**不是 'controller'**）；新字段计入 Tier2 帧体积。
- [ ] **v7 `sidebarTerminals` 配置**（§9）：默认 `false` 不探测 `terminalController`；显式 `true` 才展示侧栏终端、`diagnostics.terminals.source='sidebar'`，且不得与 agent PTY 混排。
- [ ] **v7 tier3 片段输出**：`terminal_open.motd` / `terminal_send.viewport` / `terminal_read.text` 可追加为 Run 输出，标注「片段、非实时全量」；`notice.code` 实际只产出 `terminal-no-agent` / `terminal-read-failed`（`terminal-controller-unavailable` 保留）。
- [ ] **v8 `resync`**：`panel.poll.resync:true`（或 `cursors:null`）→ 可见选择集 Run 全部 metaDirty + 读游标回退；**不发 removed**；预算/≥1 Run 保底不变，可多帧收敛；被重置 runId 进本帧 prune 保护。
- [ ] **v8 `removed`/`runs` 互斥**：同帧不得同 runId 双发，冲突以 runs 为准；`store.prune(now,{protect})` 保护本帧 discovery 已见 Run。
- [ ] **v8 `revision` 回退**：客户端 `incoming < applied` 清 view（保留筛选/分组）+ 发一次 resync；`===` 丢弃；`>` 前进。
- [ ] **v9 已完成行展开**：`view.group.expandedIds` 纯布尔；`toggleRow` 不依赖 `view.columns`；已完成行不渲染 `collapse.in`/倒计时/进度条；`removed`/`clearCompleted` 后裁剪 id。
- [ ] **v9 tier1 树外 owner**：Agent 解析 = `scopes ∪ store terminal ownerSessionId`；命中清 notice + `meta-only→live`；未命中保持 meta-only；`diagnostics.agentsService/agentsProbe/terminalOwners` 必发。
- [ ] **v9 执行区铺满**：CSS flex（`.tp-cell{flex:1 1 var(--tp-card-w,352px);min-width:min(280px,100%);max-width:100%}`、`.tp-col{width:100%}`），基准 352/拖 280–640、窄容器单列、无横向滚动；**不计算列数/不做 resize 重算**（仅 FLIP 用 ResizeObserver）。
- [ ] **v10 2px 边框**：`.tp-col`/`.tp-row` 生效 `border-width:2px`（旧 1px 仅测试兼容）；running warn 65%、linger/completed success 60%、failed error 65%；hover/focus 只加 `box-shadow: inset 0 0 0 1px`、不改尺寸。
- [ ] **v10 grid auto-fill**：`repeat(auto-fill,minmax(min(100%,var(--tp-card-w,352px)),1fr))` + gap 12 + align-content:start；**禁 auto-fit**；最后一行单卡不拉伸；拖右缘写统一 `--tp-card-w`（280–640）；容器 <716px 单列。
- [ ] **v10 同步 ghost**：ghost 渲染期派生并插回原槽位；FLIP 测量含 ghost；`layoutSignatureRef=activeKey|exitingKey` 在 `useLayoutEffect` 比较；同帧 >2 张跳过 fade；reduced-motion 无 ghost/无 FLIP。

### 13.2 frontend（T4）v2/v3 增补

- [ ] 组件 props 只需用 `sessionId`、`useSession`、`t`（F28）；不要同名覆盖 `viewRequest`/`openView` 等保留 prop。
- [ ] 样式自注入 `<style data-plugin-css>` 并在卸载移除（无 `styles.insert`，F13）。
- [ ] 只能 `require('react')`（平台表 11 键，F11）；禁止其它 require。
- [ ] 自适应轮询：活跃 250ms / 空闲 1000ms / 隐藏暂停（§4.5）。
- [ ] `final-only` Run 的「仅终态」徽标与禁用停止；终端缺口/裁剪提示。
- [ ] 切 tab 即 unmount → 必须清理轮询/rAF/监听/滚动（F25）。
- [ ] `__internals` 必须与 §11.2 冻结表**逐键一致**（增删改需 Lead 批准）。
- [ ] **v3 `removed` 语义**：收到即删 run/column/droppedLines/游标，不做延时；`completedRetainMs` 只用于 `pruneRuns` 本地兜底。
- [ ] **HIGH 回归**：`mergeRun` 终态单调（终态后收到 running/旧帧不得回退）→ `tests/client/merge-poll.test.mjs`。
- [ ] **v7 标题首行**：列头/已完成行的命令只显示**第一条非空行**（折叠空白、超长截断 `…`、多行附 ` +N 行`），完整命令保留在 `title` 属性与输出面板；新增纯函数 `firstCommandLine(command, maxLen)` 并由 `__internals` 暴露。
- [ ] **v7 输入块**：输出区顶部渲染输入（bash/job 完整 `command` 每行 `$ `；terminal `$ name` + `inputs` 每行 `› `）+ 分隔线 + 输出；空输出仍显示输入块 + `output.empty`；`notice` 在输入块上方（仅 terminal）以次要色显示。
- [ ] **v7 收起时序**：终态后先保持展开 + 倒计时（10s），到点才 `expanded:false` 且 `deadline:null`；折叠后不再渲染倒计时/进度条；新增纯函数 `collapseVisual(state, now)` 返回 `{visible,countdown,progress}` 供 tester 断言；hover/focus 暂停语义不变。
- [ ] **v7 抖动约束**：入场动画只在首次挂载播放（`data-fresh` 一次性）；工具栏单行不换行 + 计数 tabular-nums/固定 min-width；面板填满高度、运行列固定区 + 已完成区 `flex:1 1 auto; min-height:0; overflow:auto`；倒计时徽标固定占位；跟随滚动只用容器 `scrollTop=scrollHeight`（禁 `scrollIntoView`）。
- [ ] **v7 composer 隐藏**：终端 tab 激活且生效时隐藏会话输入框；用 `useEffect` 做副作用、幂等、卸载恢复；失败静默降级、绝不影响其它 tab；DOM 副作用抽成 `applyComposerHidden(node, visible)`（操作 `[data-conversation-content]` 的 `data-tp-composer-hidden`，找不到锚点返回 false 不抛错）。

### 13.3 tester（T5）v2/v3 增补

- 按 **§11.1 / §11.2 冻结表**对齐导出类用例（模块→导出名→签名）；表外实现内部函数不测。
- 新增必测：`parseToolResultText`、`mapToolResultStatus`、`computeTerminalDelta`（**k>0 / k===0 不 lossy / k<0 lossy+重置** / overlap 去重 / terminal `truncated = page.truncated || lineEnd < totalLines` 语义）、`dedupeTailOverlap`、`planTerminalRead`（mode 四态）、`mergePoll` 的 final-only 与 terminal 缺口场景。
- **v4 新增**：非 live root 会话应断言返回**降级帧**（`ok:true`、`sessions` 仅 root、`availability.tree.available=false`、`runs:[]`）而非 `session-not-found`；terminal 缺口用 `lossy`（k<0）而**不是** `truncated` 触发翻页。
- **v3 预算用例**：Tier1 整 Run 跳过且首条放行；Tier2 兜底后被丢 Run 无 `nextCursors`；Tier3 被丢 Run 游标回退；`truncated:true` 时 `nextCursors` 不越过已交付字节（§4.3 六条不变量）。
- **v3 removed 用例**：`removed` 立即删除；同一 run 随后到达不影响其它 run；`pruneRuns` 独立于 `removed`。
- **HIGH/LOW 回归**：`terminal-window` 换行、`mergeRun` 终态单调、`boundFrame` 边界。
- 装配测试：断言 client `apply` 注入的 `<style>` 在 dispose 后被移除；断言 `label()` 返回「终端」。
- **v7 Host 用例**：agent 缺失 + `terminalController.list` 返回 2 条 → 2 个 terminal Run（`meta-only` + notice，且**不被删**）；仅 `terminal_open` 事件 → 仍登记（source='events'）；controller 缺失/抛错 → 静默降级 + reason；`terminal_send` → inputs 追加与 20 条/2 KiB/8 KiB 上限；`terminal_close` → 终态（不是静默删除）；`diagnostics` 形状与取值；带 inputs/notice 的大帧仍满足 Tier1/Tier2 + ≥1 Run 保底。
- **v7 Client 用例**：`firstCommandLine`（单行/多行/前导空行/超长 `…` + ` +N 行`/非字符串）；`collapseVisual`（仅展开态可见倒计时、到点 expanded=false+deadline=null、paused 冻结、pinned 不 arm、10s 前不折叠）；输入块渲染（`$ ` / `› ` 前缀、空输出仍有输入块、notice 行存在）。

### 13.4 audit（T6）对照点

- 本文件 §2 的每个 F 编号都能指到 `docs/research/dsh-plugin-apis.md` 或 live inspect/asar 证据；
- §12 六项裁决在实现中可观察到（无角标/无 xterm/`final-only`/默认全部/HTTP 路由/元数据文件存在）；
- **v3 三项一致化**：§4.3 三级预算与 `lib/host/{frame,route}.mjs` 一致、§4.2 语义 5 与 `lib/client.js` `mergePoll` 一致、§11.1/§11.2 冻结表与 `lib/host/*.mjs` 导出 / `lib/client.js` `__internals` 逐项一致；
- docs/install.md 的安装步骤与 §8/§12.9 一致。

### 13.5 Host 插件形态自检（发布前必查，v6）

> 起因：H2/H2b 导致「Plugin Manager active 但路由不存在」，静态检查 + 真机 200 才能闭环。

- [ ] `grep -n "export default" lib/index.js` → **无输出**（H2a）
- [ ] `grep -n "export const name\|export const inject\|export function apply" lib/index.js` → 三个具名导出齐全
- [ ] `apply` 末尾为 `return undefined`（或不存在会被 cordis 当作 effect 的返回对象）（H2b）
- [ ] 每条装配失败路径都有 `logger.error`（或 `logger.warn` 降级日志）+ `throw`，无静默 return（H2c）
- [ ] 安装后按 `docs/install.md` §3.1 V5 用**页面内 fetch（credentials 默认 same-origin）**验证：`200 {"ok":true,"value":{"protocol":1,…}}`；**不得用无 cookie 裸 curl 的 405/401 当作「通过」判据**
- [ ] 记住：**Plugin Manager active ≠ 插件工作**；唯一的通过判据是 RPC 200 + 「终端」tab 渲染
