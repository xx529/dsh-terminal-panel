# dsh-terminal-panel · 架构与契约（v2 定稿）

> 状态：**v2 定稿**（已吸收 scout T1 取证结论 `docs/research/dsh-plugin-apis.md`；Lead 已对 5 项争议裁决）
> 设计基线：`docs/design/ui-spec.md`（v4）+ Figma A–F 六板（`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`）
> 读者：backend（T3）、frontend（T4）、tester（T5）、audit（T6）
> 标注口径：`[FACT]` 有可核对证据（附 asar 路径/行号、README 小节或 live inspect）；`[INF]` 由 Fact 推导并写明依据；`[ASSUMPTION]` 未证实，写明验证方式。
> **本文件是双端唯一契约来源**：host 与 client 各自照此实现，不再互相提问；实现与契约冲突时先回报 Lead，由 Lead 决定改实现还是升契约版本。

---

## ★ v2 变更摘要（给 backend / frontend / tester，10 行）

1. **传输不变**：exact HTTP 路由 `POST /terminal-panel/rpc`（同机 popout 先例成立）。`ctx.connection.rpc` 仅记为「备选/后续简化」；backend 不重做（Lead 裁决 1）。
2. **前台 bash 过程输出不可得**（无第三方持有 `ShellExecution` 句柄）→ 改三层：a) `ctx.shell.execute` 只读 tee 为 best-effort（`bashCapture`，失败即 `availability.bashLive` 降级）；b) 始终用 `tools/execute` 记录 Run（status/command，`exec.agent` 可选，缺失不猜）；c) `tools/result` 的终态输出补内容，`outputMode:'final-only'`，UI 标「仅终态」（Lead 裁决 2）。
3. **`terminals.read` 语义定案**：`offset` = 距最新多少行（0=尾页）；`end=totalLines-offset`、`start=max(0,end-count)`；`lineBegin/lineEnd` 同坐标系；绝对行号 = `totalLines - lineBegin`；增量按 `totalLines` 差值取尾页并去重；`truncated` = scrollback 裁剪/单页字节截断（不是「没取完」）。§12.6 的 ASSUMPTION 已替换为 FACT（Lead 裁决 3）。
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

**v2 对 v1 的事实核对结果**：§2 每张表带「scout 复核」列，逐条标 `已核对` / `修正` / `新增` / `无变化`。凡 v1 写错的地方（`host.call`、`styles.insert`、前台 bash 实时输出、`terminals.read` 字节游标、`immediately` 语义）均已在正文改正，不再保留 v1 表述。

---

## 1. 目标与非目标

### 1.1 目标（对应 ui-spec §1）

- 在会话头部 View 标签栏新增「终端」tab（`conversation.view` slot，`id: terminal-panel`，`order: 30`）。
- 聚合 **当前会话 + 子代理 + Agent Team 队友** 的 bash 前台执行、后台任务（jobs）、持久终端（terminals）输出，只读观看。
- 进行中按横向列展示（列宽可拖 280–640，默认 352）、已完成 32px 紧凑行 + 10s 自动收起、跟随滚动、筛选、搜索、最大化只读弹窗。

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
| F18 | `ctx.terminals`：`list(owner: Agent)`、`read(owner,id,{offset?,count?})`、`kill(owner,id,reason?)`、`hasOwnerActivity(owner)`；**`read` 语义（逐行核实现）**：`offset` = 距最新行数（0=尾页），`totalLines` = 当前 scrollback 行数，`end = totalLines - offset`，`start = max(0, end - count)`，返回 `lineBegin = offset`、`lineEnd = offset + 实际返回行数`（同一坐标系），绝对行号 `absoluteBegin = totalLines - lineEnd`、`absoluteEnd = totalLines - lineBegin`；`truncated` = scrollback 曾被裁剪 或 单页被 `maxReadBytes` 截断（**不是**「没取完」），分页完整性看 `lineEnd >= totalLines`；默认 scrollback 10000 行 / 4 MiB | `[FACT]` live inspect `Service(terminals)`；asar:`dsh-terminal-bash/lib/index.js:582-611`；scout §4.4 | 修正（v1 §12.6 的「绝对行号」ASSUMPTION 作废，见 §12.6） |
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
  limits: { maxFrameBytes: number; maxRuns: number; pollHintMs: number; idlePollHintMs: number }
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
}
```

语义（**下游照此实现，不得各自发挥**）：

1. `runs` 只包含「元信息有变化」或「有新增输出」的 Run；同 runId 多帧之间增量累加，不整量重发。
2. `output.*.chunks[].text` 是**新增的连续文本**（bash/job = 字节增量；terminal = 行增量），client 按到达顺序 append；每列本地保留 `scrollbackLines`(600) 行，超出丢头并记 `droppedLines`。
3. 游标规则按来源分开（§5.2），**不得混用**：job 是绝对字节 `next`；terminal 是 `totalLines` 行基线；bash tee 是字节偏移。
4. `truncated:true` 时 client 必须立即用 `nextCursors` 续读（同 tick 最多 3 次，之后等下一轮）。
5. `removed` 中的 runId，client 保留「已完成」区 5 分钟（`completedRetainMs`）后丢弃；内存硬上限 200 条，超出按 finishedAt 淘汰最旧。
6. `revision <= 本地已应用 revision` 的帧直接丢弃（乱序/重试）。
7. `run.outputMode === 'final-only'` 的 Run 在终态前**没有输出块**；UI 在输出区显示「仅终态」占位（§12.7）。

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

### 4.3 帧预算与截断（服务端）

| 项 | 规则 |
|---|---|
| 输出文本预算 | 每帧 `≤ maxFrameBytes`（默认 65536）**输出文本字节约**；元信息 ≤ 8 KiB |
| 调度顺序 | `focusRunId` 优先 → `status==='running'` 优先 → `startedAt` 升序；每轮每 Run 最多取 `min(16 KiB, 剩余预算)` |
| 截断 | 预算耗尽即停；未读完的 Run 写进 `nextCursors`，`truncated:true` |
| 单 chunk 上限 | 单条 `text` ≤ 16 KiB；超出服务端切块 |
| 超长 Run 数 | running > `maxRuns`(32) 时只返回前 32 个 running + 最近 `completedLimit` 条终态（UI 显示「另有 N 个未显示」） |
| 标记语义 | `truncated` = 本帧没发完（可续读）；`lossy` = 数据已丢（不可恢复）。两者不可混用 |

### 4.4 错误码表

| code | HTTP | 触发 | Client 行为 |
|---|---|---|---|
| `unauthorized` | 401 | cookie 缺失/过期 | 停轮询，横幅「认证失效，请刷新页面」+ 重试按钮 |
| `forbidden` | 403 | Host/Origin 栅栏拒绝 | 同上（提示网络/代理异常） |
| `method` | 405 | 非 POST | 视为实现错误，控制台告警 |
| `too-large` | 413 | 请求体 >4 KiB | 同上（不应发生） |
| `bad-request` | 200 | params 校验失败 | 丢弃该帧，控制台告警一次，不打断面板 |
| `unknown-method` | 200 | 未实现方法 | 丢弃 |
| `session-not-found` | 200 | sessionId 无对应 live root | 空态「会话不可用」+ 重试 |
| `run-not-found` | 200 | kill 目标不在可见树/已移除 | toast「该任务已结束或不可见」 |
| `run-not-stoppable` | 200 | 来源不支持停止（前台 bash 无句柄） | toast「该来源不支持停止」 |
| `source-unavailable` | 200 | 指定来源服务缺失 | 对应 chip 置灰 + tooltip 原因 |
| `internal` | 500 | 未预期异常 | 退避重试；连续 3 次 → 断线横幅 |

网络层错误（fetch reject / 超时 / 非 JSON 响应）→ 连接状态机：第 1 次失败静默重试；连续 2 次 → `degraded` 横幅；退避 500/1000/2000/5000ms 封顶；恢复后写一条「已恢复」并清横幅（断线重连提示一次，ui-spec §6）。

### 4.5 轮询节奏（v2：自适应）

| 状态 | 间隔 | 依据 |
|---|---|---|
| 有 running Run（活跃） | `pollHintMs = 250`（硬上限 300，下限 150） | 任务书「≤300ms 合帧」；scout §2.5 建议 |
| 无 running Run（空闲） | `idlePollHintMs = 1000`（可调 1000–1500） | scout §2.5「空闲 1000–1500ms」 |
| 页面隐藏（`document.visibilityState === 'hidden'`） | 暂停（`visible` 后立即 poll） | 省电/省帧 |
| View 未激活 | 不轮询（slot 只渲染激活 view，F25） | 切 tab 自动停 |
| 合帧 | 收到帧先入缓冲，最多每 60ms 用 rAF 提交一次 UI | ui-spec §7 |
| 单飞 | 上一请求未结束不发下一个；`focusRunId` 用于放大弹窗所在列 | `[INF]` |
| 卸载 | abort 在途请求、清 interval/rAF/监听 | F25 + practices |
| 自限 | 单次响应 ≤ maxFrameBytes（65536），超长截断标记；不用宿主 300MiB 上限（F33） | F33 |

---

## 5. 数据模型（双端共用，JSON 线上形态）

### 5.1 服务端模型

```ts
type RunKind = 'bash' | 'job' | 'terminal'
type RunStatus = 'running' | 'completed' | 'failed' | 'killed'
type OutputMode = 'live' | 'final-only'   // final-only = 前台 bash（无过程输出，F17）
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
  truncated: boolean         // scrollback 被裁剪 或 单页被 maxReadBytes 截断
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
| **terminal** | 对可见会话逐个 `ctx.terminals.list(agent)`（owner 是 **Agent**，先 `ctx.agents.get(sessionId)`，F18/F20） | 每轮 `read(agent, id, { offset:0, count:max(k,1) })`，`k = totalLines_new - cursor_prev`（min 1：PTY 用 `\r` 重写当前行）；文本按行尾重叠去重；`lineEnd >= totalLines` 才是取完；上翻历史用 `offset += count`（服务端只给增量，历史由 client 本地缓冲） | `status.kind==='exited'` → exitCode 0 ? completed : failed（signal 记 detail） | `ctx.terminals.kill(agent, id, 'cancelled by the user')` |

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
| root Agent 不在 live registry | `ctx.agents.get(sessionId)` 空 | tools 侧 Run 仍可见 | terminals/jobs 聚合降级；`tree` 记原因 | 面板可用，终端/任务 chip 提示「该会话已不在活动注册表」 |
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

## 9. 配置（Host 半端，`cordis.patch.yml` 可覆盖）

| key | 默认 | 含义 |
|---|---|---|
| `pollHintMs` | 250 | 活跃轮询间隔（Client 读 `hello.limits`）；150–300 |
| `idlePollHintMs` | 1000 | 无 running Run 时的空闲间隔；1000–1500 |
| `maxFrameBytes` | 65536 | 单帧输出文本预算（上限 262144） |
| `maxRuns` | 32 | 单帧最多 Run 数 |
| `completedLimit` | 50 | 服务端保留终态 Run 数 |
| `completedRetainMs` | 300000 | Client 丢弃已移除终态的保留时长 |
| `scrollbackLines` | 600 | Client 每列本地保留行数 |
| `terminalPageLines` | 400 | 单次 `terminals.read` 行数（`count`） |
| `terminalTailOverlapLines` | 32 | 行增量去重时的尾部重叠窗口 |
| `initialTailBytes` | 32768 | 首见 Run（无游标）时给的尾部字节数 |
| `collapseDelayMs` | 10000 | 自动收起延迟（ui-spec 固定 10s，配置仅供测试缩短） |
| `bashCapture` | true | 是否尝试 shell tee（best-effort；失败只降级，不影响 final-only） |
| `finalOutputBytes` | 32768 | final-only 终态输出截断上限 |

`routePath` **不做配置**（固定 `/terminal-panel/rpc`），避免双端漂移。

`[ASSUMPTION]` Host 插件可以不导出 `Config` schema，`apply(ctx, config)` 收 patch 的 config 原样对象，插件内补默认值。验证：T6 装包后跑 `cordis_inspect_query` `Config.listConfigs`，若 loader 拒绝未知 config 则改 schemastery `Config`（v3 小修）。

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

### 11.1 Host 纯函数（`lib/host/*.mjs`，node:test 直接 import）

```ts
// classify.mjs
export function classifyTool(name: string, args: unknown):
  { kind: 'bash' | 'job' | 'terminal'; command?: string; cwd?: string } | null
// 规则：name 含 'terminal' → terminal；name ∈ {'bash','pwsh','shell','exec'} → bash；
// 以 'job_' 开头 → job；其余 null。args.command/cwd 存在则透传。

// tree.mjs
export function mergeSessionTree(input: {
  rootSessionId: string
  rootName: string
  descendants: SubagentDescendantListEntry[]
  members: TeamMemberView[]
}): SessionScope[]
// 断言：root 首位 depth=0；队友优先于同 id 子代理；diagnostic 行跳过（不读 activity）；
// depth/创建顺序稳定；accent: root='none'，subagent='subagent'，teammate='teammate'。

// status.mjs
export function mapShellStatus(v: { status: string; exitCode: number | null; signal: string | null }): RunStatus
export function mapJobStatus(v: string): { status: RunStatus; stopping: boolean }
export function mapTerminalStatus(v: { kind: string; exitCode?: number | null; signal?: string | null }): RunStatus
export function mapToolResultStatus(v: { isError: boolean; error?: { message: string; info?: { code?: string } } }): RunStatus
// mapToolResultStatus：isError=false → completed；isError=true 且 code 含 abort/cancel → killed；否则 failed。

// cursors.mjs
export function mergeChannel(prevCursor: number, read: { text: string; nextOffset: number; lossy: boolean }):
  { chunks: OutputChunk[]; nextCursor: number; lossy: boolean; gapBefore: boolean }
export function planReads(runs, cursors, budget: { maxBytes: number; maxRuns: number; focusRunId?: string }):
  { order: string[]; perRunBudget: Record<string, number> }
export function dedupeTailOverlap(prevTail: string, incoming: string, overlapLines?: number):
  { text: string; overlapLines: number }
// 断言：按行尾重叠去重（默认 32 行），不丢非重叠新行，空输入安全。
// terminal 增量（v2 新增，必测）：
export function computeTerminalDelta(prev: { totalLines: number; tail: string },
  page: { text: string; totalLines: number; lineBegin: number; lineEnd: number; truncated: boolean },
  overlapLines?: number): { delta: TerminalDelta; nextBaseline: { totalLines: number; tail: string } }
// 断言：k=totalLines-prev.totalLines；k<=0（裁剪）→ lossy+重置基线；k>0 取尾页
// 并用尾重叠去重；lineEnd<totalLines 才算「没取完」。

// frame.mjs
export function buildPollFrame(input: PollInput, cursors: Record<string, RunCursor>, budget: Budget):
  { value: PollResult; nextCursors: Record<string, RunCursor> }
export function boundFrame(value: PollResult, maxBytes: number): PollResult
// bash final-only（v2 新增，必测）：
export function parseToolResultText(result: { content?: { type: string; text?: string }[]; value?: unknown }):
  { text: string; truncated: boolean }
```

`scripts/smoke-host.mjs`（backend）用 mock ctx 跑通路径：「bash 增量/终态（tee 可用与不可用两种）」与「job 列表 → 终态」，另加「terminal 行增量→去重→裁剪」；退出码 0。

### 11.2 Client 纯函数（不得 import React）

**仍然采用 v1 的单文件 + `__internals` 方案**（frontend 写作用域不含 `scripts/**`，禁止装打包器）：

```js
window.__ModuleLoader__.load({
  id: 'dsh-terminal-panel',
  factory(require) {
    const React = require('react')
    // …纯函数与组件…
    function apply(ctx) { /* 注册 slot + locale + style */ }
    return { inject: ['slots', 'locale'], apply, __internals: { /* 见下 */ } }
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

**`__internals` 必须导出**（tester 按此写用例）：

```ts
clampColumnWidth(w: number): number                    // 280–640；NaN/字符串→352
DEFAULT_COLUMN_WIDTH: 352; MIN_COLUMN_WIDTH: 280; MAX_COLUMN_WIDTH: 640
filterRuns(runs: Run[], filter: FilterState): Run[]
countByKind(runs: Run[]): { all: number; bash: number; job: number; terminal: number }
searchMatch(run: Run, query: string): boolean
orderRunningColumns(runs: Run[]): string[]
groupCompleted(runs: Run[]): string[]
createFollowState(): FollowState
onScrollFollow(state: FollowState, m: { scrollTop: number; scrollHeight: number; clientHeight: number }): FollowState
onOutputFollow(state: FollowState, lines: number): FollowState
createCollapseState(): CollapseState
armCollapse(state: CollapseState, now: number): CollapseState
pauseCollapse(state: CollapseState): CollapseState
resumeCollapse(state: CollapseState, now: number): CollapseState
tickCollapse(state: CollapseState, now: number): CollapseState
pinCollapse(state: CollapseState): CollapseState
stripAnsi(text: string): string
tailLines(text: string, maxLines: number): { text: string; dropped: number }
formatDuration(ms: number): string
formatCountdown(ms: number): string
mergePoll(state: ViewState, frame: PollResult): ViewState
```

`mergePoll` 必须满足（tester 重点）：

- `revision <= 已应用` → 原样返回（引用相等）。
- 相同帧重复应用 → 等价（幂等）。
- `removed` 删除 run 与 column，未命中不抛错。
- `truncated` 不改变游标语义（游标只由 `nextCursors` 推进）。
- `chunks` 一律 append；`terminal` 行增量同样 append，`lossy` 插入缺口标记。
- `availability` 变化只改标记，不清空已有数据。
- `outputMode:'final-only'` 的 Run 在 running 阶段无输出块也不报错。

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

### 12.8 已裁决限制汇总（写进 README/验收）

1. tab 无角标（计数在工具栏）。
2. 终端非 xterm 屏幕帧，全屏 TUI 退化为文本流。
3. 前台 bash 默认只有终态输出（`final-only`），过程输出不可得。
4. 默认会话范围 = 全部会话。
5. 插件不接管输入；唯一写操作是「停止」。
6. 跨会话聚合的实测验证列在 backend 冒烟（scout U6）。

### 12.9 仍未确认项（scout U2/U4/U6/U8，不阻塞 v2）

| # | 项 | 影响 | 归属/验证 |
|---|---|---|---|
| U4 | `link:` 安装 + 手写 `lib/client.js` 能否被 `/plugins` 服务 | 开发循环 | devops/integration：安装后看 `window.__DSH_BOOT__` 与 Network 200 |
| U6 | 跨 session 读 jobs/terminals 是否真被允许 | 多会话聚合核心 | backend 冒烟用真实子会话验证 |
| U8 | Desktop 重启/生效路径与 watcher 覆盖 workspace | 迭代成本 | 首次安装后记录到 install.md |
| U2 | `label` 返回 ReactNode 能否做角标 | 仅角标 | 低优先级，不改 v2 |

---

## 13. 下游交接清单

### 13.1 backend（T3）v2 增补

- [ ] `tools/execute` 只读记录（**必须 `return await next()`**）；`exec.agent` 可选，缺失不猜归属。
- [ ] `tools/result`（emit）取终态输出 → `parseToolResultText`；Run 标 `outputMode:'final-only'` + `detail:'final-only'`。
- [ ] `bashCapture` 的 shell tee 为 **best-effort**：失败只设 `availability.bashLive={available:false, reason:'no-shell-handle'}`，**不得**让插件加载失败或影响工具链。
- [ ] terminal 用行坐标：`computeTerminalDelta` + 尾重叠去重 + `totalLines` 回退置 lossy。
- [ ] `jobs.readAt` 用 `next` 不透明游标；`caller` 传**目标** sessionId。
- [ ] 路由 handler 自己 try/catch，不外抛（外抛=HTTP 500 纯文本）。
- [ ] 跨会话聚合冒烟（U6）；任一来源异常降级不 500。

### 13.2 frontend（T4）v2 增补

- [ ] 组件 props 只需用 `sessionId`、`useSession`、`t`（F28）；不要同名覆盖 `viewRequest`/`openView` 等保留 prop。
- [ ] 样式自注入 `<style data-plugin-css>` 并在卸载移除（无 `styles.insert`，F13）。
- [ ] 只能 `require('react')`（平台表 11 键，F11）；禁止其它 require。
- [ ] 自适应轮询：活跃 250ms / 空闲 1000ms / 隐藏暂停（§4.5）。
- [ ] `final-only` Run 的「仅终态」徽标与禁用停止；终端缺口/裁剪提示。
- [ ] 切 tab 即 unmount → 必须清理轮询/rAF/监听/滚动（F25）。
- [ ] `__internals` 必须导出 §11.2 全部函数。

### 13.3 tester（T5）v2 增补

- 新增必测：`parseToolResultText`、`mapToolResultStatus`、`computeTerminalDelta`（k>0/k<=0/lineEnd<totalLines/overlap 去重）、`dedupeTailOverlap`、`mergePoll` 的 final-only 与 terminal 缺口场景。
- 装配测试：断言 client `apply` 注入的 `<style>` 在 dispose 后被移除；断言 `label()` 返回「终端」。

### 13.4 audit（T6）对照点

- 本文件 §2 的每个 F 编号都能指到 `docs/research/dsh-plugin-apis.md` 或 live inspect/asar 证据；
- §12 六项裁决在实现中可观察到（无角标/无 xterm/`final-only`/默认全部/HTTP 路由/元数据文件存在）；
- docs/install.md 的安装步骤与 §8/§12.9 一致。
