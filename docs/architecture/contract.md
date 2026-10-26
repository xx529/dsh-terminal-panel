# dsh-terminal-panel · 架构与契约（v1 草案）

> 状态：**v1 接口草案**（等 scout 的 T1 取证结论后修订为 v2）
> 设计基线：`docs/design/ui-spec.md`（v4）+ Figma A–F 六板（`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`）
> 读者：backend（T3，`lib/index.js` + `lib/host/**`）、frontend（T4，`lib/client.js` + `lib/client/**`）、tester（T5）、audit（T6）
> 约定：每条结论标 `[FACT]`（有可核对证据）、`[INF]`（由事实推导，写明依据）、`[ASSUMPTION]`（未验证，写明验证方式）。
> **本文件是双端唯一契约来源**：host 与 client 各自照本文件实现，不再互相提问；实现与契约冲突时先回报 Lead，由 Lead 决定改实现还是升契约版本。

---

## 0. 版本与变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | 2026-10-26 | 初稿：双端边界、HTTP RPC 契约、数据模型、状态机、降级矩阵、测试契约、脚手架。待 scout 结论回来后出 v2（预计修订：`conversation.view` 标准 props 精确清单、`host.call` 是否适用于 profile bundle、`terminals.read` 的 offset 语义、安装方式细节）。 |

**v1 相对任务书的两处主动修正（需 Lead 知悉）**

1. **不用 `host.call` 做 RPC**：`host.call(method,args)` 只属于「动态 Cordis 包」的沙箱浏览器半（`dsh-cordis-client-runner` 求值器提供的符号面，与 `React`/`console`/`styles` 同组）。我们是 profile 里安装的双端 bundle，客户端半是页面里普通 Client 插件，没有该符号；其跨端通道在已安装的先例里是 **Host 注册 HTTP 路由 + Client `fetch`**（见 §5.1）。`[FACT]`
2. **Client 半是单文件 classic-script**：`./client` 由宿主以 lazy factory 形式下发（`window.__ModuleLoader__.load({id, factory})`），协议只支持自包含产物，不能同步 `require` 同包相对文件；因此 `lib/client.js` 必须是单个自包含文件，不能 `import './xxx.mjs'`（见 §3.2、§11.2）。`[FACT]`

---

## 1. 目标与非目标

### 1.1 目标（对应 ui-spec §1）

- 在会话头部 View 标签栏新增「终端」tab（`conversation.view` slot，`id: terminal-panel`，`order: 30`）。
- 聚合 **当前会话 + 子代理 + Agent Team 队友** 的 bash 前台执行、后台任务（jobs）、持久终端（terminals）实时输出，只读观看。
- 进行中按横向列展示（列宽可拖 280–640，默认 352）、已完成 32px 紧凑行 + 10s 自动收起、跟随滚动、筛选、搜索、最大化只读弹窗。

### 1.2 非目标

- 不接管终端输入（禁止 `terminals.startSend` / 键盘注入）。
- 不写入会话日志、不新增 Session 事件类型（`practices.md` 明确禁止）。
- 不改 host/上层插件（`tools/execute` 只做旁路观察，不改变工具结果；`ctx.shell.execute` 只做只读包装）。
- 不安装任何 npm 依赖，不引入构建工具链（无 xterm、无 TS/JSX、无打包器）。

### 1.3 硬约束

| 约束 | 依据 |
|---|---|
| 禁止 JSX / 只能用 `React.createElement` | 插件 Client 半是纯 JS factory，模板即如此 `[FACT]`（skill 模板 `templates/decoration/client.js`） |
| 禁止 `require('@deepseek-ai/dsh-client-ui-primitives')` 或其它 Client 包 | `practices.md` §UI（换了就崩，且无类型检查）`[FACT]` |
| 颜色只用 `--dsw-alias-*` 令牌，禁止硬编码 | `practices.md` §UI + ui-spec §2.4 `[FACT]` |
| 插件卸载必须清理定时器/监听/路由 | `practices.md` §Stability：一切注册走 `ctx.effect` `[FACT]` |
| 单条 RPC 响应体有上限并带截断标记 | 参照 `job-controller` 的 `observeMaxFrameBytes: 65,536` `[FACT]` |

---

## 2. 已核实事实（写实现前必读，带证据定位）

> 证据路径：`asar:` = `/Applications/DeepSeek Harness.app/Contents/Resources/app.asar` 内路径（该归档未压缩，可用脚本按 header offset 提取）；`~` = `/Users/lzx`。运行时 Inspect 证据见 §2.2。

### 2.1 包形态与加载

| # | 事实 | 证据 |
|---|---|---|
| F1 | 双端 bundle 的 `package.json` 用 `dsh.bundle.patch` 指向 patch，用 `dsh.client: { platform: 'web', immediately?, inject? }` 声明浏览器半；`exports` 必须有 `./client`；Host 半是包根入口 | `[FACT]` asar:`dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/package.json`；`[FACT]` `~/.dsh/profiles/desktop/node_modules/dsh-context/package.json`；`[FACT]` `~/.dsh/profiles/desktop/node_modules/@local/dsh-popout-window/package.json` |
| F2 | `cordis.patch.yml` 用 `- insert: [ { id, name, config? } ]` 插入 Host 行 | `[FACT]` 同上三处 `cordis.patch.yml` |
| F3 | Host 半导出 `{ name, inject, apply }`（或默认导出 Service 类），一切注册在 `apply` 内用 `ctx.effect` 返回清理函数 | `[FACT]` asar:…/references/host-plugin.md §Host plugin export forms；`@local/dsh-popout-window/index.js:29` |
| F4 | 浏览器半是 classic script：`window.__ModuleLoader__.load({ id: '<包名>', factory(require){…} })`；factory 返回 `{ inject, apply }`；`require('react')` 可用（平台 seed 表） | `[FACT]` 模板 `templates/decoration/client.js`；`[FACT]` `dsh-context/lib/client.js` 首行同形态、`factory:e=>…e("react")` |
| F5 | 插件 bundle 惰性执行：运行 bundle 只注册 factory，副作用在 materialize 时跑；模块系统是 CJS-style，入口与 chunk 不能同步 require 相对 `client*.js` | `[FACT]` asar:`dsh/node_modules/@deepseek-ai/dsh-client-modules/README.zh.md` §惰性 CJS 模型 |
| F6 | 本机 DSH 版本 `0.2.1-rc.2`，Node `v22.22.2`，pnpm `11.22.0` | `[FACT]` asar:`dsh/node_modules/@deepseek-ai/dsh/package.json`；本机 `node -v` / `pnpm -v` |
| F7 | profile 的 `package.json` 用 `dsh.profile.bundles` 列 bundle；`cordis.patch.yml` 是用户 patch 层；`patchReload: live` | `[FACT]` `~/.dsh/profiles/desktop/package.json`、`cordis.patch.yml` |

### 2.2 Host 服务与事件（Inspect 实测，2026-10-26）

| # | 事实 | 证据 |
|---|---|---|
| F8 | `ctx.jobs`：`list(caller?)`、`get(id, caller?)`、`readAt(id, from, caller?)`、`kill(id, caller?, reason?)`；`JobView{ id, kind, label, owner?, status: 'running'\|'stopping'\|'completed'\|'killed'\|'failed', progress?, detail?, startedAt, finishedAt?, output:{total,earliest} }`；`JobOutputRead{ chunks: JobChunk[], next: number, lossy }`，`JobChunk{ at, text, channel?, gapBefore? }`；`cancel` 语义 `'requested'\|'already-finished'` | `[FACT]` Inspect `Service.listService {service:'jobs'}` |
| F9 | `ctx.shell`：`resolve(request)` / `execute(spec)` → `ShellExecution`；`ShellExecution extends ShellProcess{ status:'running'\|'completed'\|'killed', exitCode, signal, done, readOutput(), observed:{ stdout, stderr }, kill() }`；`observed.stdout.readFrom(fromByte)` → `{ text, nextOffset, lossy, spillPath? }`；`readOutput()` 是**消费式**，会推进进程内部游标 | `[FACT]` Inspect `Service.listService {service:'shell'}` |
| F10 | `ctx.terminals`：`list(owner: Agent)` → `TerminalSessionSnapshot[]`；`read(owner,id,{offset?,count?})` → `TerminalReadResult{ text, totalLines, lineBegin, lineEnd, truncated }`；`kill(owner,id,reason?)`；`hasOwnerActivity(owner)`；`TerminalSessionSnapshot{ sessionId, name?, type, pid?, status:{kind:'running'}\|{kind:'exited',exitCode,signal} }` | `[FACT]` Inspect `Service.listService {service:'terminals'}` |
| F11 | `ctx.subagents.listDescendants(rootSessionId)` → `SubagentDescendantListEntry[]`，每项 `{ kind:'child', id, activity:'running'\|'inactive', mode, label?, hasChildren, parentId, depth }` 或 `{ kind:'diagnostic', id, reason:'corrupt'\|'unsupported'\|'unavailable' }`；根不可读会 reject | `[FACT]` Inspect `Service.listService {service:'subagents'}` |
| F12 | `ctx.agentTeams.listMembers(agent)` → `TeamMemberView{ id, name, role:'lead'\|'teammate', status, description?, provider?, context?, model?, diagnostics[] }`；`membership(agent)` 返回 `{root, id, role, name}`；team 根 = Lead 会话 | `[FACT]` Inspect `Service.listService {service:'agentTeams'}` |
| F13 | `ctx.agents`：`get(sessionId)`、`list()`、`roots()` → live Agent（`Agent.id` 即 `SessionId`）；terminal/subagent 的 `owner` 形参都要 live `Agent` | `[FACT]` Inspect 目录 + `Service.listService {service:'terminals'}` 参数 |
| F14 | `tools/execute` 是 **waterfall**，签名 `('tools/execute')(exec: ToolDispatchExecution, next) => Promise<ToolExecutionResult>`；`exec` 含 `callId, name, arguments, agent?, signal` | `[FACT]` Inspect `Event.listEvents {event:'tools/execute'}` |
| F15 | Host `ctx.connection` 暴露 `rpc.handle(channel, handler)` 与 `fetch.register(route)`、`requestRejection(request)`、`admit(request)`；`webServer.register({kind:'exact'\|'prefix', path, handler})`；浏览器侧已有认证 cookie（`browserPeer` principal=owner） | `[FACT]` Inspect `Service.listService {service:'connection'}` + asar:`dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js`（`registerFetchRoute`/`register`/`admit`）+ `[FACT]` `@local/dsh-popout-window/index.js:355-393` |

### 2.3 `conversation.view` slot

| # | 事实 | 证据 |
|---|---|---|
| F16 | `conversation.view` 是 `conversation.session` 的子 slot，声明为 `{ kind:'list', scope:'session' }`；内置渲染器从 `slots.entries('conversation.view')` 读取 `options.id` 与 `resolveSlotLabel(options.label)` 画 tab，**不读其它字段** | `[FACT]` asar:`dsh/node_modules/@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（`registerConversationSession`、`viewTabs`、`renderSlot("conversation.view", {inspectCall, viewRequest, openView, completeViewRequest}, {only: viewId})`） |
| F17 | 注册形态（可照抄）：`ctx.slots.inject('conversation.view', () => ctx.slots.register({ name:'conversation.view', id, order, locale, label: () => t(key), inject: (sessionId) => ({…props}) }, View))`；`inject(sessionId)` 的返回值作为 props 传给 View；组件另有标准 props（实测 trajectory 收到 `useSession, renderSlot, viewRequest, completeViewRequest, t`） | `[FACT]` asar:`dsh/node_modules/@deepseek-ai/dsh-client-ui-trajectory/lib/client.js`（`registerConversationView`/`TrajectoryView` 签名） |
| F18 | 「可用 View 少于两个时隐藏标签栏」「blank Session 不渲染 `conversation.view`」 | `[FACT]` asar:`dsh-client-ui-conversation/README.zh.md:74,88,92` |
| F19 | 内置 tab 渲染只按 id/label 画，**没有角标/徽标入参**；`viewTabs()` 只在 slot 注册表变化或 locale 变化时重算 | `[FACT]` F16 同一处代码；`[INF]` 因此「tab 角标 = 运行中数量」无法通过注册选项实现（详见 §12.1） |
| F20 | 客户端服务名：`slots`、`locale`、`sessions`、`uiSession`、`uiConversation`；`ctx.locale.register(NS,{zh,en})` + `ctx.locale.bind(NS)` 可在插件内联字典，不依赖 `locale/*.json` | `[FACT]` asar:`dsh-client-ui-trajectory/lib/client.js`（`inject` 列表 + `ctx.locale.register`） |

### 2.4 传输通道（本契约选择）

| # | 事实 | 证据 |
|---|---|---|
| F21 | profile bundle 的 Client 半可直接 `fetch()` 宿主路由（同源、带认证 cookie）；Host 半用 `ctx.webServer.register({kind:'exact', path, handler})` 注册，并用 `ctx.connection.requestRejection({headers:req.headers})` 做认证栅栏；已安装的 `@local/dsh-popout-window` 正是这样做的（Client `fetch('popout/open')` ↔ Host `path:'/popout/open'`） | `[FACT]` `~/.dsh/profiles/desktop/node_modules/@local/dsh-popout-window/index.js:355-393`、`client.js:139` |
| F22 | 通用 RPC channel（`ctx.connection.rpc.handle`）的信封是 `{type:'client-request', rpcId, method, payload}` → `{type:'server-response', rpcId, result:{ok:true,value}\|{ok:false,error:{code,message,details}}}`，只收 POST + `content-type: application/json`，错误码 `gateway/bad-request`、`gateway/internal`、`gateway/cancelled`；channel 形如 `/^\/[A-Za-z0-9._~-]+$/` 且不能是 `/api` | `[FACT]` asar:`dsh-client-connection/lib/index.js`（`rpcFetchHandler`、`clientRequestSchema`、`serverResponseSchema`、`assertChannel`） |
| F23 | 本契约采用「exact HTTP 路由 + 自家 JSON 信封」而不是 F22 的通用 channel：理由（a）有已安装先例（F21），（b）信封字段可裁剪、多方法合一次 POST 便于 ≤300ms 合帧，（c）服务端错误码可沿用 F22 的形状。v2 若 scout 证明通用 channel 更稳，可无缝切（信封适配层只在 `lib/host/route.mjs` 与 `lib/client/transport`） | `[INF]` 依据 F21、F22 |

---

## 3. 双端模块边界与文件职责

### 3.1 目录与归属

```
dsh-terminal-panel/
├── package.json                # architect（本机已交付）
├── cordis.patch.yml            # architect
├── .gitignore                  # architect
├── README.md                   # architect
├── docs/
│   ├── design/ui-spec.md       # ux（已有）
│   ├── architecture/contract.md# architect ← 本文件
│   └── install.md              # architect
├── lib/
│   ├── index.js                # backend：Host 半入口（ESM，export { name, inject, apply }）
│   ├── host/                    # backend：纯逻辑 + 采集器（ESM .mjs，可被 node:test 直接 import）
│   │   ├── classify.mjs        #   工具名/参数 → RunKind
│   │   ├── tree.mjs            #   root + descendants + team members → SessionScope[]
│   │   ├── status.mjs          #   三种来源状态 → RunStatus
│   │   ├── cursors.mjs         #   字节游标合并、读取计划
│   │   ├── frame.mjs           #   PollResult 组装 + 截断
│   │   ├── capture-bash.mjs    #   ctx.shell.execute 包装 + tools/execute 旁路
│   │   ├── capture-jobs.mjs    #   ctx.jobs 聚合
│   │   ├── capture-terminals.mjs#  ctx.terminals 聚合（只读）
│   │   ├── route.mjs           #   HTTP 路由 + 认证 + 错误映射（唯一非纯逻辑）
│   │   └── store.mjs           #   进程内 Run 注册表（Map，含保留窗口）
│   ├── client.js               # frontend：Client 半（单文件 classic script，唯一浏览器产物）
│   └── client/                 # frontend：**仅测试可 import 的纯函数（不 import React、不被 client.js 引用）**
│       └── *.mjs               #   或在 client.js 内定义并通过 __internals 暴露（见 §11.2，二选一由 frontend 定）
├── scripts/
│   └── smoke-host.mjs          # backend：mock ctx 冒烟
└── tests/                      # tester：node:test
```

**写作用域**（任务板约定）：architect = `package.json` / `cordis.patch.yml` / `.gitignore` / `README.md` / `docs/architecture/**` / `docs/install.md`；backend = `lib/index.js` / `lib/host/**` / `scripts/smoke-host.mjs`；frontend = `lib/client.js` / `lib/client/**`；tester = `tests/**` / `docs/testing/**`。

### 3.2 双端职责

| 端 | 入口 | 职责 | 禁止 |
|---|---|---|---|
| Host | `lib/index.js` | `inject:['webServer','connection']`（硬依赖）+ 可选服务 `jobs/shell/terminals/subagents/agentTeams/agents`；注册 HTTP 路由；装配采集器；`ctx.effect` 清理 | 不得改工具结果、不得写 session、不得读模型上下文 |
| Client | `lib/client.js` | 注册 `conversation.view`；轮询 RPC；渲染列/行/筛选/弹窗；本地状态机 | 不得自绘 tab、不得 require 其它 Client 包、不得全局 CSS 选择器、不得写 DOM 之外的 body 节点 |
| 纯逻辑 | `lib/host/*.mjs`、`lib/client/*.mjs`（或 `__internals`） | 无 DSH 运行时依赖，可被 `node:test` 直接 import；输入输出为普通 JSON | 不得 import React / cordis / DSH 包 |

### 3.3 运行时装配时序

```
Host 启动
  └─ Loader 读 cordis.patch.yml → insert 行 { id: terminal-panel, name: dsh-terminal-panel }
      └─ import('dsh-terminal-panel') → lib/index.js → apply(ctx, config)
          ├─ ctx.effect：注册 POST /terminal-panel/rpc（webServer.register）
          ├─ ctx.effect：包装 ctx.shell.execute（可选，失败则 bash 降级）
          ├─ ctx.effect：监听 tools/execute（记录 bash/terminal 工具调用 ↔ run）
          └─ ctx.effect：清理 → 路由/包装/监听全部撤掉

页面加载
  └─ 客户端模块系统 materialize dsh-terminal-panel/client
      └─ factory(require) → { inject: ['slots','locale'], apply(ctx) }
          ├─ ctx.effect：ctx.locale.register(NS, {zh,en})
          └─ ctx.slots.inject('conversation.view', () => ctx.slots.register(opts, View))
              └─ 用户切到「终端」tab → View mount
                  ├─ useEffect：panel.hello → panel.poll 循环（250ms，单飞）
                  ├─ 用户操作 → 本地状态机（列宽/收起/跟随/筛选）
                  └─ unmount：abort in-flight、清定时器、清订阅
```

---

## 4. 传输层

### 4.1 端点

| 项 | 值 |
|---|---|
| 形态 | `ctx.webServer.register({ kind: 'exact', path: '/terminal-panel/rpc', handler: async (req, res) => … })` `[FACT]` 路由 API 见 F15 |
| 方法 | 仅 `POST`；其它 → `405`，头 `Allow: POST` |
| 请求头 | `content-type: application/json`（否则 `415`） |
| 请求体 | `{ "method": string, "params"?: object }`，上限 **4 KiB**（超限 `413`） |
| 认证 | `ctx.connection.requestRejection({ headers: req.headers })`；返回 401/403 时原样返回，响应体 `{ok:false,error:{code:'unauthorized'\|'forbidden',…}}` `[FACT]` 同 popout |
| 响应 | `200 { ok:true, value: Value }` 或 `200 { ok:false, error:{ code, message, details? } }`；服务端内部异常 → `500 {ok:false,error:{code:'internal'}}`，**不泄漏堆栈** |
| 缓存 | `cache-control: no-store` |
| 连接 | Client 用 `AbortController` 5s 超时；单飞（同一时刻最多 1 个在途请求） |

Client 取址：

```js
// document.baseURI 为页面根；相对路径保证宿主若挂在子目录时也命中。
const url = new URL('terminal-panel/rpc', document.baseURI) // [INF] 依据 F21 先例
```

`[ASSUMPTION]` 页面 `baseURI` 为宿主根目录（`http://host:port/`）。若首次请求 404，Client 回退绝对路径 `/terminal-panel/rpc` 一次，并在控制台留一条 `console.warn`。**验证方式**：T6 在真实页面 Network 面板确认首次请求 200。

### 4.2 方法与信封

#### `panel.hello`

```ts
// params: {}（可省略）
interface HelloResult {
  protocol: 1
  hostTime: number                 // epoch ms，用于 client 计算服务端时钟偏移
  dshVersion?: string
  capabilities: { bash: boolean; jobs: boolean; terminals: boolean; tree: boolean }
  limits: { maxFrameBytes: number; maxRuns: number; pollHintMs: number }
  availability: Availability
}
```

Client 用途：首帧前确认 Host 半端在线、能力集与轮询参数；失败 → 空态「Host 半端未加载」。

#### `panel.poll`

```ts
interface PollParams {
  sessionId: string                      // 当前会话（slot inject 注入的 sessionId）
  cursors?: Record<string, RunCursor>    // runId → 各通道游标；缺省 run 视为首见（服务端给保留窗口尾部）
  includeCompleted?: boolean             // 默认 true；服务端最多保留 completedLimit 条终态
  focusRunId?: string                    // 可选：优先续读该列（保证放大弹窗/活动列不被其它列饿死）
  maxRuns?: number                       // 默认/上限 maxRuns（32）
  maxBytes?: number                      // 默认/上限 maxFrameBytes（65536）
}

interface RunCursor { stdout?: number; stderr?: number; job?: number; terminal?: number }
// 字节游标 = 该通道已交付字节数（UTF-8 byte offset）；terminal 游标 = 已交付到的绝对行号 lineEnd

interface PollResult {
  protocol: 1
  sessionId: string
  serverTime: number
  revision: number                  // 服务端单调递增帧号；用于 client 丢弃乱序帧
  sessions: SessionScope[]          // 本次可见会话树（含 root）
  runs: Run[]                       // 新增/变化的 Run（含增量输出块），未变化的 run 不出现
  removed: string[]                 // 已从注册表移除的 runId（保留窗口过期 / 会话结束）
  availability: Availability
  truncated: boolean                // 命中帧预算，client 应立即用 nextCursors 续读
  nextCursors: Record<string, RunCursor> // 下轮应提交的游标（截断时 > client 本地游标）
}
```

语义（**下游照此实现，不得各自发挥**）：

1. `runs` 只包含「元信息有变化」或「有新增输出」的 Run；同一 runId 多帧之间增量累加，不做整量重发。
2. 每个 Run 的 `output.*.chunks[].text` 是**新增的连续字节段**；client 按到达顺序 append 到本地文本缓冲（每列最大保留 `scrollbackLines` 行，超出丢弃头部并记 `droppedLines`）。
3. 游标单调递增；服务端**不得重复已交付字节**。若游标落入保留窗口之外（进程重启/环形缓冲淘汰）→ 该通道 `lossy:true`，从当前保留头开始重发并 `gap:true`，client 插入一条 `…（已丢失 N 字节）` 标记。
4. `truncated:true` 时 client 必须**立即**用 `nextCursors` 发下一次 poll（同一 tick 最多连续 3 次续读，之后等下一轮），保证大输出不积压。
5. `removed` 中的 runId，client 保留在「已完成」区 5 分钟（`completedRetainMs`）后丢弃；内存硬上限 200 条，超出按 finishedAt 淘汰最旧。
6. `revision <= 本地已应用 revision` 的帧直接丢弃（乱序/重试）。
7. 所有时间为 Host epoch ms；Client 用 `hostOffset = hello.hostTime - Date.now()` 校正耗时显示。

#### `panel.kill`

```ts
// params
interface KillParams { sessionId: string; runId: string }
// value
interface KillResult { outcome: 'requested' | 'already-finished' | 'unsupported' }
```

- 只允许终止**可见会话树内**的 Run：服务端以「run.ownerSessionId ∈ 当前 poll 可见树」+ 各服务自身 owner 围栏为授权边界；越权 → `run-not-found`（不泄漏存在性）。
- bash → `ShellProcess.kill()`；job → `ctx.jobs.kill(jobId, ownerSessionId, 'cancelled by the user')`；terminal → `ctx.terminals.kill(ownerAgent, terminalId, 'cancelled by the user')`。
- 用户 kill 与模型 `job_kill` 语义不同：不改模型可见的 job 结果以外行为（沿用 job-controller 先例：模型完成通知照常送达）`[FACT]` asar:`dsh-api-job-controller/README.zh.md:28`。

### 4.3 帧预算与截断（服务端）

| 项 | 规则 |
|---|---|
| 输出文本预算 | 每帧 `≤ maxFrameBytes`（默认 65536）**输出文本字节约**（不含 JSON 元信息开销）；元信息 ≤ 8 KiB |
| 调度顺序 | `focusRunId` 优先 → `status==='running'` 优先 → `startedAt` 升序；每轮每个 Run 最多取 `min(16 KiB, 剩余预算)` |
| 截断 | 预算耗尽即停；未读完的 Run 写进 `nextCursors`，`truncated:true` |
| 单 chunk 上限 | 单条 `text` ≤ 16 KiB；超出在服务端切块 |
| 超长 Run 数 | 同时进行列 > `maxRuns`(32) 时，只返回前 32 个 running + 最近 `completedLimit` 条终态，其余在 `availability` 不暴露（UI 显示「另有 N 个未显示」）`[INF]` 属实现约束，避免帧爆 |
| 截断标记 | 任何被裁剪的 Run 自身 `truncated:true`；`lossy` 与 `truncated` 语义不同：`truncated`=本次没发完（可续读），`lossy`=数据已丢（不可恢复） |

### 4.4 错误码表

| code | HTTP | 触发 | Client 行为 |
|---|---|---|---|
| `unauthorized` | 401 | cookie 缺失/过期 | 停轮询，横幅「认证失效，请刷新页面」+ 重试按钮 |
| `forbidden` | 403 | Host/Origin 栅栏拒绝 | 同上（提示网络/代理异常） |
| `method` | 405 | 非 POST | 视为实现错误，控制台告警 |
| `too-large` | 413 | 请求体超限 | 同上（不应发生） |
| `bad-request` | 200 | params 校验失败 | 丢弃该帧，控制台告警一次，不打断面板 |
| `unknown-method` | 200 | 未实现方法 | 丢弃 |
| `session-not-found` | 200 | 传入 sessionId 无对应 live root | 空态「会话不可用」+ 重试 |
| `run-not-found` | 200 | kill 目标不在可见树/已移除 | toast「该任务已结束或不可见」 |
| `run-not-stoppable` | 200 | 来源不支持停止 | toast「该来源不支持停止」 |
| `source-unavailable` | 200 | 指定来源服务缺失 | 对应 chip 置灰 + tooltip 原因 |
| `internal` | 500 | 未预期异常 | 退避重试；连续 3 次 → 断线横幅 |

网络层错误（fetch reject / 超时 / 非 JSON 响应）走「连接状态机」：第 1 次失败静默重试（250ms）；连续 2 次 → `degraded` 横幅；退避 500/1000/2000/5000ms 封顶；恢复后写一条「已恢复」提示并清横幅（**断线重连提示一次**，ui-spec §6）。

### 4.5 轮询节奏

| 项 | 值 | 依据 |
|---|---|---|
| 间隔 | `pollHintMs = 250`（配置可调，硬上限 300，下限 150） | 任务书「≤300ms 合帧」；`job-controller` 用 100ms 聚合，我们保守取 250 |
| 合帧 | 收到的帧先入缓冲，最多每 60ms 用 rAF 提交一次 UI（ui-spec §7） | ui-spec §7 |
| 单飞 | 上一请求未结束不发下一个；结束到下一次至少等 0ms（持续输出时等于连续轮询），无输出时按间隔 | `[INF]` |
| 页面隐藏 | `document.visibilityState === 'hidden'` → 停轮询；恢复可见 → 立即 poll（沿用游标） | `[INF]` 省电/省帧 |
| View 未激活 | slot 只在选中该 tab 时 mount（F16/F18）→ 不轮询 | `[FACT]` |
| 卸载 | abort 在途请求、清 interval、清 rAF | `[FACT]` practices 要求 |
| 节流保护 | Client 保证 ≤ 8 req/s；服务端对同一 Peer 超过 20 req/s 返回 `rate-limited`（可后置） | `[ASSUMPTION]` 需要时验证 |

---

## 5. 数据模型（双端共用，JSON 线上形态）

### 5.1 服务端模型

```ts
type RunKind = 'bash' | 'job' | 'terminal'
type RunStatus = 'running' | 'completed' | 'failed' | 'killed'
type AgentRole = 'lead' | 'subagent' | 'teammate' | 'unknown'
type Accent = 'none' | 'subagent' | 'teammate' // 对应 ui-spec §2.1 左侧 3px 竖条

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
  hasActivity: boolean       // 是否有命令行活动（决定筛选列表是否显示；ui-spec §4 底部说明）
}

interface OutputChunk {
  at: number                 // Host epoch ms
  text: string               // UTF-8 文本；不含 ANSI 处理（client 负责剥离/保留）
  channel?: 'stdout' | 'stderr' | 'job'
}

interface ChannelDelta {
  chunks: OutputChunk[]
  nextCursor: number         // 字节偏移（terminal 为绝对行号）
  lossy: boolean             // 服务端保留窗口已淘汰，client 有缺口
  gapBefore?: boolean        // 本帧第一块之前有缺口（配合 lossy）
  truncated: boolean         // 本帧该通道没发完，可续读
}

interface TerminalDelta {
  text: string               // 纯文本（服务端不做 ANSI 渲染）
  totalLines: number         // 该会话当前总行数（绝对）
  lineBegin: number          // 本次片段起始绝对行号（0-based）
  lineEnd: number            // 结束（不含）
  nextCursor: number         // = lineEnd
  truncated: boolean
}

interface RunHandle {
  toolCallId?: string
  pid?: number
  jobId?: string
  terminalId?: string
  terminalType?: string
}

interface Run {
  runId: string              // `${kind}:${sourceId}`；bash= callId 或 pid，job= JobId，terminal= TerminalSessionId
  kind: RunKind
  status: RunStatus
  stopping?: boolean         // job 的 'stopping' 映射为 running+stopping=true
  ownerSessionId: string
  agent: AgentRef
  title: string              // 列头类型标签（Bash / 后台任务 / 终端）
  command?: string           // 命令行单行完整文本（UI 省略显示 + tooltip）
  cwd?: string
  startedAt: number
  finishedAt?: number
  durationMs: number         // status==='running' 时为 serverTime-startedAt
  exitCode?: number | null
  signal?: string | null
  detail?: string            // 失败原因 / kill 原因 / job.detail
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
  bash: SourceState
  jobs: SourceState
  terminals: SourceState
  tree: SourceState
}
```

### 5.2 来源映射（服务端）

| RunKind | 发现方式 | 元信息 | 输出读取 | 终态 | 停止 |
|---|---|---|---|---|---|
| `bash` | 包装 `ctx.shell.execute` 捕获返回的 `ShellExecution`；`tools/execute` waterfall 拿 `exec.callId/name/arguments/agent` 做归属与命令绑定 `[FACT]` F9/F14 | `command`（spec.command）、`cwd`、pid、`startedAt` | `execution.observed.stdout.readFrom(cursor)` / `.stderr.readFrom(cursor)`（**只读旁路，不碰 `readOutput()` 消费式游标**）`[FACT]` F9 | `execution.done` 后读 `status/exitCode/signal` → 映射 | `execution.kill()` |
| `job` | `ctx.jobs.list(ownerSessionId)`（每个可见会话各查一次，按 jobId 去重合并）`[FACT]` F8 | `label`、`status`、`startedAt/finishedAt`、`progress`、`detail`、`output.total` | `ctx.jobs.readAt(jobId, cursor, ownerSessionId)`；`next` 写回游标；`lossy` 透传 | `status` 直接映射 | `ctx.jobs.kill` |
| `terminal` | 对可见会话逐个 `ctx.terminals.list(agent)` `[FACT]` F10/F13 | `name/type/pid/status` | `ctx.terminals.read(agent, id, {offset, count})`（只读；**绝不** `startSend`） | `status.kind==='exited'` → exitCode 0 ? completed : failed | `ctx.terminals.kill` |

归属规则：

- `tools/execute` 的 `exec.agent.id` = Run 的 `ownerSessionId`（**不按名字猜**）`[FACT]` F14。
- 会话树 = `{rootSessionId} ∪ subagents.listDescendants(root) ∪ agentTeams.listMembers(rootAgent)`，按 sessionId 合并；同 id 同时是队友与子代理时**队友优先**（Agent Team 的 teammate 本身就是 Lead 的子会话，前者信息更全）`[INF]` 依据 F11/F12 类型。
- 只能拿到 live `Agent` 的会话才能查 terminals（服务签名要 Agent）`[FACT]` F13；拿不到 → 该会话 terminals 不可见，`availability.terminals.reason` 记录。
- root = Client 传入的 sessionId；若 `ctx.agents.get(sessionId)` 无 live Agent → `session-not-found`（面板空态）。

### 5.3 客户端派生视图模型（不进 RPC）

```ts
interface FilterState {
  kind: 'all' | 'bash' | 'job' | 'terminal'   // 单选 chips，计数为全局值（不受其它筛选影响）
  sessionIds: string[] | null                  // null = 全部会话；默认见 §12.3 冲突项
  search: string                               // 匹配 command + 累积输出 + 会话显示名，本地即时过滤
  autoExpandNew: boolean                       // 默认 true（新任务自动展开）
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
  order: { running: string[]; completed: string[] } // 渲染顺序，见 §6.2
  columns: Record<string, ColumnState>
  group: GroupState
  filter: FilterState
  availability: Availability
  banner?: { code: 'auth' | 'disconnected' | 'host-half-missing'; message: string; retried: boolean }
  droppedLines: Record<string, number>
  pendingFrameRevision: number
}
```

---

## 6. 状态机（Client，纯函数化）

### 6.1 Run 生命周期

```
                ┌──────────┐  首次出现（带元信息）
                │ unknown  │──────────────┐
                └──────────┘              ▼
                                   ┌────────────┐   来源终态
        new output / repeat frame  │  running   │──────────────┬──────────────┬──────────────┐
                    ┌─────────────►│            │  exitCode=0  │ exitCode≠0   │ 被停止/信号   │
                    │              └────────────┘              ▼              ▼              ▼
                    │                                   ┌──────────┐   ┌────────┐   ┌────────┐
                    └───────────────────────────────────│completed │   │ failed │   │ killed │
                      （后台任务恢复输出）                 └──────────┘   └────────┘   └────────┘
                                                             │              │              │
                                                             └──────┬───────┴──────────────┘
                                                                    ▼
                                                         自动收起状态机（§6.3）
```

来源状态映射（`lib/host/status.mjs`，tester 单测覆盖）：

| 来源 | 输入 | → RunStatus |
|---|---|---|
| shell | `status:'running'` | running |
| shell | `status:'completed'`, `exitCode===0` | completed |
| shell | `status:'completed'`, `exitCode!==0`（含 null 且有 signal） | failed（`detail` 记 exitCode/signal） |
| shell | `status:'killed'` | killed（`detail` 优先 `aborted`/`timedOut`/signal） |
| job | `'running' \| 'stopping'` | running（`stopping` 置位） |
| job | `'completed'` | completed |
| job | `'failed'` | failed |
| job | `'killed'` | killed |
| terminal | `{kind:'running'}` | running |
| terminal | `{kind:'exited', exitCode:0}` | completed |
| terminal | `{kind:'exited', exitCode≠0}` 或 `signal!=null` | failed（signal 置 `detail`） |

终态是**单调**的：进入终态后不再回 running；若同一 runId 又出现输出（后台任务恢复），只更新 `output` 与 `lastOutputAt`，不改变 status（UI 允许「已完成后再有新输出 → 重新展开」，见 §6.3）。

### 6.2 渲染顺序

- **进行中列**：`status==='running' && runningCount<=maxRuns` 的全部 Run，按 `startedAt` 升序（**最旧在左，最新在右**；横向滚动右端 = 最新）`[INF]` 依据 A 板「3 列占满、超出右滚 + › 按钮」。
- **已完成行**：`status ∈ {completed,failed,killed}` 且未被「清空已完成」移除，按 `finishedAt` 降序（最新在上）。
- 同一会话内 Run 顺序稳定：新增/删除不得重排已有列（避免横向滚动位置跳动）`[INF]` 交互要求。
- 列数 `> 3` 时：容器 `overflow-x: auto`，右侧浮动 `›` 按钮 + 剩余数角标；滚到最右隐藏 `›` `[FACT]` ui-spec §2.1。

### 6.3 自动收起状态机（固定 10s）

```
        ┌────────────────────────┐
        │      expanded=true     │◄──────────────────────────── 新输出（已收起后）
        │  (32px row 展开成详情)  │                              （ui-spec §3.4 重新展开并重新计时）
        └───────────┬────────────┘
                    │ 进入终态（completed/failed/killed）且 pinned=false
                    ▼
        ┌────────────────────────┐   deadline=now+10000
        │ expanded=true, armed   │
        │ (倒计时: 琥珀点 + Ns    │
        │  + 2px 进度条)          │
        └───────────┬────────────┘
      hover/focus   │             │ now>=deadline 且 paused=false
        ┌───────────┘             ▼
        ▼                    ┌────────────┐
 ┌──────────────┐            │  collapsed │ 只剩 32px 行（内容折叠，行仍在列表里）
 │  paused=true │──失焦/移出─► 重新 deadline=now+10000（**重新等 10s**，ui-spec §3.3）
 └──────────────┘
```

实现契约（`CollapseState` 纯函数）：

- `armCollapse(state, now)`：`deadline = now + 10000`；已 `pinned` 则不 arm。
- `pauseCollapse(state, now)`：`paused=true`（deadline 冻结，不推进）。
- `resumeCollapse(state, now)`：`paused=false; deadline = now + 10000`（**重置为完整 10s**，不是恢复剩余时间——ui-spec §3.3 明确「失焦后再等 10s」）。
- `tickCollapse(state, now)`：`paused || pinned || deadline===null || now<deadline` → 原样；否则 `expanded=false, deadline=null`。
- `pin(state)`：`pinned=true`（Shift+Enter 或 ⋯→固定展开）；取消 pin → 若已终态则重新 arm。
- 新输出到达且 `expanded===false` → `expanded=true` + 重新 `armCollapse`。
- 计时器由 Client 用一个 `setInterval(250ms)` 或 rAF 节流 tick 驱动（**不得每行一个 setTimeout**，避免 200 行时 200 个定时器）；`prefers-reduced-motion` 下收起动画瞬时 `[FACT]` ui-spec §3.9。

分组：

- 已完成区默认 `completedCollapsed=true`（ui-spec v4 变更 2）：折叠时只显示「已完成 N」一行；展开后显示 32px 行，整组最高 160px 后内部滚动 `[FACT]` ui-spec §2.2。
- 「清空已完成」：仅清当前筛选命中的终态项；清后 3s 内可撤销（保存快照）；同时清掉对应 `runs`/`columns` 条目 `[FACT]` ui-spec §3.8。

### 6.4 跟随（follow）状态机

```
        ┌──────────────┐   滚轮上翻（输出区 scrollTop 离开底部 > 4px）   ┌────────────────┐
        │ following=true│──────────────────────────────────────────────►│ following=false │
        │ 贴底渲染       │◄──────────────────────────────────────────────│ pendingNewLines │
        └──────────────┘   滚回底部（距底 <= 4px）自动恢复                │ 「N 条新输出 ↓」│
                ▲                                                        └────────────────┘
                └──────────────────────── Esc 退出跟随（spec §3.10）；新输出时不自动跳底
```

实现契约（`FollowState` 纯函数，tester 覆盖边界 4px）：

- `onScroll(state, {scrollTop, scrollHeight, clientHeight})`：`distance = scrollHeight - clientHeight - scrollTop`；`distance <= 4` → `following=true, pendingNewLines=0`；否则 `following=false`（若此前为 true）。
- `onOutput(state, newLines)`：`following` → 保持并滚底；否则 `pendingNewLines += newLines`。
- `resumeAtBottom(state)`：仅由 onScroll 触发，**不得只在点击按钮时恢复**（ui-spec §3.5 硬要求）。
- 滚轮隔离：输出区 `wheel` 监听器在 `follow` 容器内调用 `preventDefault()` 并只改自身 `scrollTop`（页面骨架不滚）；到达区域顶部/底部且继续滚动时不冒泡带动整页 `[FACT]` ui-spec v4 变更 1。
- 列宽拖拽进行中不改变 `following`。

### 6.5 停止（两击确认）

`armed` 状态机：第 1 次点击 → `armed=true`，`disarmAt=now+3000`，按钮进入「确认停止？」态；3s 内第 2 次 → `panel.kill`；超时/移出 → `armed=false`。`panel.kill` 返回前按钮显示 loading，返回后该 Run 由下一帧 poll 反映终态（本地不发乐观终态，避免与真实状态冲突）`[INF]`。

### 6.6 最大化弹窗

- 触发：列头 `⤢` 或双击列头；内容 = 该 Run 的输出区（同一份本地文本，**只读**）。
- 尺寸 980×600、遮罩 65% 黑、Esc/✕ 关闭、可停止、可复制全部、独立滚动；不接管终端输入 `[FACT]` ui-spec §2.2/§3.12。
- 打开时暂停该列的自动滚动跟随（跟随状态沿用列的状态）；关闭后恢复。
- 焦点管理：打开时 focus 弹窗容器（`role="dialog" aria-modal="true"`），Esc 关闭；卸载恢复焦点到触发按钮。

---

## 7. 筛选

| 项 | 契约 |
|---|---|
| 类型 chips | 单选；计数**全局**（不受会话范围/搜索影响）：`全部 / Bash / 后台任务 / 终端`；0 计数的 chip 仍显示（置灰可点）`[FACT]` ui-spec §2.3/§4 |
| 会话范围多选 | 列出 `sessions`（root 恒在首、子代理缩进 + 蓝点、队友琥珀点）；默认见 §12.3 冲突项（v1 取「全部」）；底部说明「仅显示有命令行活动的会话」`[FACT]` ui-spec §4 |
| 搜索 | 匹配 `command` + 累积输出文本 + 显示名；**本地即时**（不触发 RPC）；命中高亮；清空即恢复 `[FACT]` ui-spec §4 |
| 筛选状态 | 仅会话内存（不跨重启）；View unmount 后保留到会话内存 store（再次进入 tab 仍生效）`[FACT]` ui-spec §4 |
| 与轮询关系 | 筛选**不减少轮询数据**（服务端返回整树，client 本地过滤）；避免筛选切换触发全量重取 |

---

## 8. 降级矩阵

| 场景 | 判定 | Host 行为 | RPC 表现 | UI 行为 |
|---|---|---|---|---|
| `webServer` 缺失 | 硬 inject 不满足 → 插件不激活 | — | 路由不存在 → fetch 404 | 空态「Host 半端未加载（缺少 webServer）」+ 重试 |
| `connection` 缺失 | 同上（与 popout 一致：硬依赖）| — | 同上 | 同上 |
| `jobs` 服务缺失 | `ctx.get('jobs') === undefined` | 不采集 jobs | `availability.jobs = {available:false, code:'missing-service', reason:'jobs service unavailable'}` | 「后台任务」chip 置灰 + tooltip 原因 |
| `shell` 服务缺失或包装失败 | 捕获器禁用 | 不采集 bash | `availability.bash = {available:false, …}` | 「Bash」chip 置灰 + 原因（「无法旁路读取 shell」） |
| `terminals` 服务缺失 | 不采集 | `availability.terminals=false` | 「终端」chip 置灰 |
| `subagents`/`agentTeams` 缺失或被拒 | 树发现失败 | 只返回 root 会话 | `availability.tree=false`；`sessions=[root]` | 会话范围只剩当前会话 + 提示「无法发现子会话」 |
| root Agent 不在 live 注册表 | `ctx.agents.get(sessionId)` 空 | — | `session-not-found` | 空态「会话不可用」+ 重试 |
| 某会话 terminals 查询抛错（无 Agent/权限） | 单会话失败 | 跳过该会话 | 该会话标记 reasons（不影响其它） | 该会话条目不显示终端 Run |
| job 已结算但输出窗口淘汰 | `readAt` 返回 `lossy` | 从保留头重发 | 通道 `lossy:true` | 输出中插「…（已丢失 N 字节）」，不弹错 |
| 帧预算耗尽 | `truncated:true` | 写 `nextCursors` | 帧内 `truncated` | 静默续读（≤3 次/tick），无需用户动作 |
| 断线（fetch 连续失败 ≥2） | client 状态机 | — | — | `degraded` 横幅「连接中断，重试中」；恢复后清横幅 + 一条「已恢复」 |
| 认证失效（401） | — | — | `unauthorized` | `blocked` 横幅「认证失效，请刷新页面」+ 重试按钮；停止轮询 |
| 页面隐藏 | — | — | — | 暂停轮询，恢复可见立即 poll |
| 输出超长 | 单列本地保留 `scrollbackLines`(600 行) | 服务端仍只给增量 | — | 区内滚动；顶部显示「已截断较早输出」`[FACT]` ui-spec §6 |
| 记录 >50 条 | — | — | — | 已完成列表虚拟化（只渲染可视 ±10 行）`[FACT]` ui-spec §6/§7 |

**总原则**：任何单一来源失败都只降级该来源，面板主体与其它来源照常工作（ui-spec §5「其余照常工作」）。

---

## 9. 配置（Host 半端 Config，`cordis.patch.yml` 可覆盖）

| key | 默认 | 含义 |
|---|---|---|
| `pollHintMs` | 250 | 建议轮询间隔（Client 读取 `hello.limits.pollHintMs`）；150–300 |
| `maxFrameBytes` | 65536 | 单帧输出文本预算 |
| `maxRuns` | 32 | 单帧最多 Run 数 |
| `completedLimit` | 50 | 服务端保留终态 Run 数 |
| `completedRetainMs` | 300000 | Client 丢弃已移除终态的保留时长 |
| `scrollbackLines` | 600 | Client 每列本地保留行数（超出丢头） |
| `terminalPageLines` | 400 | 单次 `terminals.read` 行数 |
| `initialTailBytes` | 32768 | 首次见到 Run（无游标）时给的尾部字节数 |
| `collapseDelayMs` | 10000 | 自动收起延迟（ui-spec 固定 10s，配置仅供测试缩短） |
| `bashCapture` | true | 是否包装 `ctx.shell.execute`（排障开关） |

`routePath` **不做配置**（固定 `/terminal-panel/rpc`），避免双端漂移。

`[ASSUMPTION]` Host 插件可以不导出 `Config` schema（模板允许），`apply(ctx, config)` 收到 patch 的 `config` 原样对象，插件内自行补默认值。验证方式：T6 装包后 `cordis_inspect_query` `Config.listConfigs` 确认条目；若 loader 拒绝未知 config，则改为 schemastery `Config`（v2 修订）。

---

## 10. 安全、权限与隐私

- 路由只接受 POST JSON，4 KiB 上限；所有入参白名单校验（sessionId/runId 为字符串且 ≤200 字符）。
- 授权两层：① `connection.requestRejection` 认证；② 服务自身 owner 围栏（jobs 的 caller、terminals 的 owner Agent）。面板**不新增**跨会话读取能力，只读遍历可见树。
- 只读保证：不调用 `terminals.startSend`/`signal`（除 kill 的 `terminals.kill`）、不写 session、不注入键盘。
- kill 是唯一的写操作，语义 = 人类停止，与模型工具 kill 区分（沿用 job-controller 先例）。
- 不在日志/输出中暴露路径以外的敏感信息；`console.warn` 只打错误码与来源名，不打输出内容。
- 输出文本可能含控制字符：Client 渲染前剥离 ANSI（`stripAnsi`）与孤立 `\r` 处理，防注入 DOM（全部经 React 文本节点渲染，禁止 `innerHTML`）。

---

## 11. 可测试性契约（tester 直接照此写用例）

### 11.1 Host 纯函数（`lib/host/*.mjs`，node:test 直接 import）

```ts
// classify.mjs
export function classifyTool(name: string, args: unknown):
  { kind: 'bash' | 'job' | 'terminal'; command?: string; cwd?: string } | null
// 规则（可实现为配置表）：name 含 'terminal' → terminal；name ∈ {'bash','pwsh','shell','exec'} → bash；
// 以 'job_' 开头 → job；其余 null。args.command/args.cwd 存在则透传。

// tree.mjs
export function mergeSessionTree(input: {
  rootSessionId: string
  rootName: string
  descendants: SubagentDescendantListEntry[]
  members: TeamMemberView[]
}): SessionScope[]
// 断言点：root 恒在首位 depth=0；队友优先于同 id 子代理；diagnostic 行跳过但保留 availability；
// 输出按 depth/创建顺序稳定排序；accent：root='none'，子代理='subagent'，队友='teammate'。

// status.mjs
export function mapShellStatus(v: { status: string; exitCode: number | null; signal: string | null }): RunStatus
export function mapJobStatus(v: string): { status: RunStatus; stopping: boolean }
export function mapTerminalStatus(v: { kind: string; exitCode?: number | null; signal?: string | null }): RunStatus

// cursors.mjs
export function mergeChannel(prevCursor: number, read: { text: string; nextOffset: number; lossy: boolean }):
  { chunks: OutputChunk[]; nextCursor: number; lossy: boolean; gapBefore: boolean }
export function planReads(runs, cursors, budget: { maxBytes: number; maxRuns: number; focusRunId?: string }):
  { order: string[]; perRunBudget: Record<string, number> }

// frame.mjs
export function buildPollFrame(input: PollInput, cursors: Record<string, RunCursor>, budget: Budget):
  { value: PollResult; nextCursors: Record<string, RunCursor> }
export function boundFrame(value: PollResult, maxBytes: number): PollResult

// 断言点（tester 必写）：
// 1) 同一字节不被发两次；nextCursor 单调递增。
// 2) lossy 时 gapBefore=true 且不抛错。
// 3) 预算耗尽 → truncated=true 且 nextCursors 前移。
// 4) 三来源状态映射全表。
// 5) 树归并（队友优先、diagnostic 跳过）。
// 6) 来源缺失 → availability 标记，帧仍可正常返回。
```

`scripts/smoke-host.mjs`（backend 负责）用 mock ctx 跑通两条路径：「bash 增量 → 完成 → 终态」「job 列表 → 终态」，退出码 0。

### 11.2 Client 纯函数（不得 import React）

两种满足方式（frontend 选其一，v1 推荐 B）：

- **A. 独立 `.mjs`**：`lib/client/*.mjs` 纯函数文件 + `lib/client.js` 通过构建脚本内联。**当前不可行**：frontend 写作用域不含 `scripts/**`，且禁止装打包器 `[INF]` 依据任务书 hard 边界。
- **B. 单文件 + `__internals`**：纯函数定义在 `lib/client.js` 的 factory 闭包内，factory 返回值额外挂 `__internals` 供测试取用：

```js
window.__ModuleLoader__.load({
  id: 'dsh-terminal-panel',
  factory(require) {
    const React = require('react')
    // … 纯函数与组件定义 …
    function apply(ctx) { /* 注册 slot + locale */ }
    const inject = ['slots', 'locale']
    return { inject, apply, __internals: { /* 见下 */ } }
  },
})
```

Tester 取用方式（写进 tests）：

```js
let captured
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec } } }
await import('../lib/client.js')
const mod = captured.factory((id) => {
  if (id === 'react') return { createElement: (...a) => ({ type: a[0], props: a[1] }) }
  throw new Error(`unexpected require(${id})`)
})
const { mergePoll, clampColumnWidth /* … */ } = mod.__internals
```

**`__internals` 必须导出（tester 按此写用例）**：

```ts
clampColumnWidth(w: number): number                    // 280–640，NaN/字符串→352
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
formatDuration(ms: number): string                      // 1.2s / 2m 03s
formatCountdown(ms: number): string                     // 3s 后收起
mergePoll(state: ViewState, frame: PollResult): ViewState   // 核心 reducer（边界/幂等/乱序）
```

`mergePoll` 必须满足（tester 重点）：

- `revision` 小于等于已应用 → 原样返回（引用相等）。
- 相同帧重复应用 → 输出等价（幂等）。
- `removed` 删除 run 与对应 column，未命中不抛错。
- `truncated` 不改变游标语义（游标只由 `nextCursors` 推进）。
- `chunks` 一律 append，不覆盖已累积文本。
- `availability` 变化只改标记，不清空已有数据。

### 11.3 装配测试（tester 可做）

- Host 路由：mock `webServer.register` 捕获 `route` 对象，断言 `kind==='exact'`、`path==='/terminal-panel/rpc'`；dispose 后路由被撤。
- Client apply：mock `ctx = { inject, effect, locale, slots }`，断言 `slots.register` 被调用一次且 `options.id==='terminal-panel'`、`order===30`、`label()` 返回「终端」、`inject(sessionId)` 返回 `{ t }`；`ctx.effect` 的清理函数被执行后无残留定时器。

---

## 12. 偏差与待 Lead 裁决项（v1 已按推荐实现，v2 按裁决修）

### 12.1 Tab 角标（运行中数量 + 蓝点）— **不可实现，建议放弃**

- `[FACT]` 内置 tab 渲染只读 `options.id` 与 `options.label`（F16/F19），无 badge 入参；`viewTabs()` 只在 slot 注册表/locale 变化时重算，把数量拼进 `label` 也不会随数据刷新（且会让 label 抖动）。
- **v1 方案**：不实现角标；计数显示在面板工具栏「N 个进行中 · M 条记录 · K 个会话」（ui-spec §2.3），并在「对话」tab 之外不做任何侵入。若必须角标 → 需要改 `dsh-client-ui-conversation`（上游）或另立 slot，超出本项目范围。

### 12.2 持久终端用 xterm 渲染 — **降级为纯文本 tail**

- `[FACT]` 禁止安装依赖（任务书）+ `lib/client.js` 必须单文件自包含（F5）→ 无法引入 `@xterm/xterm`。
- **v1 方案**：终端输出用 `ctx.terminals.read` 的滚动文本，Client 剥离 ANSI、等宽字体、终端底色渲染（视觉接近，但不做光标/全屏 TUI 重绘）。
- 风险：全屏 TUI（vim/htop）显示为文本流而非屏幕帧。若 ux 要求屏幕帧 → 必须允许装 xterm 或改由宿主 web-terminal 渲染，需 Lead 决策。

### 12.3 默认会话范围冲突 — 取「全部」

- ui-spec §4 写「当前会话（默认选中）」，而 v2 变更记录 §1.5 与 A 板标题都写「默认全部会话」。`[FACT]` 文档内自相矛盾。
- **v1 方案**：默认 `sessionIds = null`（全部）；根因是 A 板（v4 验收基线）标题即「默认全部会话」。若 Lead 裁决为「仅当前会话」，只改一个常量即可（`DEFAULT_SESSION_SCOPE`）。

### 12.4 插件显示元数据（locale / icon）未交付

- `[FACT]` Plugin Manager 的标题/描述读导出 locale JSON 的 `meta.title/description`，图标读 `./icon` 或 `package.json.icon`；缺失时回退 `package.json` 的 `name/description` 与默认图（…/references/host-plugin.md §Display metadata）。
- **v1 方案**：不声明 `icon`、不带 `locale/*.json`（不在 architect 写作用域内），Plugin Manager 里显示 `dsh-terminal-panel` + `description`；tab 文案由 Client 内联 `ctx.locale.register` 提供（F20）。v2 如需品牌图标/中文名，需 Lead 扩写作用域（architect 写 `icon.svg` + `locale/{zh,en}.json`）。

### 12.5 Client 单文件约束

- `[FACT]` F5。frontend 实现时**禁止**在 `lib/client.js` 里 `import`/`require` 相对路径文件。
- 若确需拆文件 → 需要构建脚本（`scripts/build-client.mjs`）+ Lead 扩 frontend 写作用域，v2 再议。

### 12.6 `terminals.read` 的 offset 语义待证

- `[FACT]` 签名 `read(owner,id,{offset?: number, count?: number})`，返回带 `lineBegin/lineEnd/totalLines`，但 README 只说「newest-relative offset and line count」，未明示正负号语义。
- `[ASSUMPTION]` `offset` 为绝对行号（0-based，从最旧计）。若实测为「从最新往回数」，服务端改用「总是取最新页 + 用 lineBegin/lineEnd 对齐」策略（`[INF]` 返回里带绝对行号，可无歧义对齐）。**验证方式**：T3 冒烟里跑一个 10 行输出的 PTY，读 `{offset:5}`，看 `lineBegin` 是否=5。

### 12.7 大白话风险清单（给 Lead 的决策摘要）

1. tab 角标做不了（内建渲染器不支持）→ 计数放工具栏。
2. xterm 用不了（禁止装依赖）→ 终端显示为文本流。
3. 默认会话范围文档自相矛盾 → 取「全部」。
4. 插件图标/中文显示名没有（不在写作用域）→ 用包名兜底。
5. RPC 走自建 HTTP 路由（有同机先例），不是 `host.call`（那是动态包的 API）。

---

## 13. 下游交接清单

### 13.1 backend（T3）照此实现

- [ ] `lib/index.js` ESM：`export const name = 'terminal-panel'`；`export const inject = ['webServer','connection']`；可选服务用 `ctx.get()` 探测并在 `availability` 记原因。
- [ ] `ctx.effect` 内：注册 `POST /terminal-panel/rpc`（exact）+ 包装 `ctx.shell.execute` + 监听 `tools/execute`；dispose 全撤。
- [ ] 实现 `panel.hello` / `panel.poll` / `panel.kill`，返回 §4.2 形状；错误码严格按 §4.4。
- [ ] 输出读取：bash 用 `observed.*.readFrom`（只读旁路）；job 用 `readAt`；terminal 用 `read`（只读，禁止 `startSend`）。
- [ ] 帧预算/截断/续读严格按 §4.3；任何来源异常降级不抛 500。
- [ ] 纯逻辑拆进 `lib/host/*.mjs`（签名见 §11.1），`scripts/smoke-host.mjs` 退出码 0。

### 13.2 frontend（T4）照此实现

- [ ] `lib/client.js` 单文件 classic script（F4/F5），`window.__ModuleLoader__.load({ id:'dsh-terminal-panel', factory })`，factory 返回 `{inject:['slots','locale'], apply, __internals}`。
- [ ] `apply(ctx)` 内 `ctx.locale.register(NS,{zh,en})` + `ctx.slots.inject('conversation.view', () => ctx.slots.register({name:'conversation.view', id:'terminal-panel', order:30, locale:NS, label:()=>t('tab.terminal'), inject:(sessionId)=>({t, sessionId})}, View))`；**不自绘 tab**。
- [ ] 视图渲染严格按 ui-spec §2/§3（列/行/工具栏/弹窗/边界态），颜色只用 `--dsw-alias-*`，图标用内联 SVG（禁 emoji）。
- [ ] 轮询按 §4.5：250ms、单飞、60ms 合帧、可见性暂停、unmount 全清。
- [ ] `__internals` 必须导出 §11.2 列出的全部函数（tester 依赖）。
- [ ] 禁止 `import`/`require` 相对文件；禁止 require 其它 Client 包（除 `react`）。

### 13.3 tester（T5）照此写用例

- 纯函数单测覆盖 §11.1 / §11.2 的每个断言点；装配测试按 §11.3；E2E 冒烟用 mock 帧序列断言 `mergePoll` 输出结构（列数/agent 名/状态/countdown）。

### 13.4 v2 修订触发条件

scout T1 结论到达后，逐条核对本文件 §2 的事实；如出现下列任一情况，出 v2 并同步 Lead/backend/frontend/tester：
- `conversation.view` 的注册选项或标准 props 与 F16/F17 不符；
- profile bundle 存在比 HTTP 路由更合适的跨端通道；
- `terminals.read` 语义与 §12.6 假设不符；
- 安装方式（plugin_manager install_bundle vs profile 依赖）与 `docs/install.md` 的 Assumption 不符。
