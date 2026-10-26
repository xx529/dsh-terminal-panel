# T30 取证：terminal_open 不显示 + agent 解析失败 + 隐藏输入框可行方案

> 角色：scout（只读取证，未改任何 `lib/**`）。
> 仓库：`/Users/lzx/Documents/GitHub/dsh-terminal-panel`，`HEAD=187cc42`，**工作树含 T31 未提交改动**（`M lib/host/*`、`?? lib/host/terminal-events.mjs`）。
> 平台：安装版 DSH Desktop `0.2.1-rc.2`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`，实现目录 `asar:dsh/`）。
> 标注：**FACT** = 有代码位置/命令输出；**INFERENCE** = 由 FACT 推导并写明依据；**ASSUMPTION** = 未证实 + 验证方式。
> 取证时间：2026-10-26 16:0x–16:2x（Asia/Shanghai）。官方检查器：host 侧 `Service/Event/Tool` 可用；**client 侧 `Slots/Builtin` 本次仍 10s 超时**（页面 inspect 通道未连上，见 §8.3）。

---

## 0. TL;DR：根因结论

**缺陷①（终端恒 0）的根因链**：`ctx.terminals` 的 owner 是 **Agent 对象身份**，而 Agent 只在「被 create/resume 过」时存在于 live registry；**GUI 打开会话不会激活 Agent**，队友/子代理更可能是「仅存储、未加载」状态 → `agents.get(sessionId)` 返回 `undefined` → 旧版 `collectTerminalRuns` 的 noAgent 分支**直接 `store.remove`** 掉 terminal Run，且不报错 → 用户看到「终端 0、无提示」。（FACT：两级代码位置见 §1.1/§1.3）

**缺陷②（agent 标签变 sessionId + 会话名变「当前会话」）的真实根因有两条，其中一条此前未被识别**：

1. **`Agent` 没有 `name` 字段**（FACT）：`ReactLoopAgent` 的实例字段只有 `id/options/session/inbox/phase/scope/ctx/...`，`tool` 侧 `Agent` 类型也只声明 `{ id }`。→ `lib/host/panel.mjs:193` 的 `rootAgent?.name` **永远 undefined**，`rootName` 永远退化成 `'当前会话'`——**与 agent 是否 live 无关**。
2. 队友/子代理不在可见会话树里（rootAgent 缺失 → `listMembers` 根本不会被调用），它们的 Run 只能按 `ownerSessionId` 兜底显示成 sessionId（FACT：`panel.mjs:191` 的 `rootAgent !== undefined` 守卫 + `panel.mjs:239` 的 `name: run.ownerSessionId`）。

**关于「历史上已经跑过的 pty-4/pty-5」**：即使修好，也**不可能**补显示。`ctx.terminals` 是进程内 owner-身份注册表，owner 被 dispose 时会清理（FACT：`dsh-terminal/lib/index.js:233-236`、`:227-228`），历史 terminal 输出没有任何可回读通道（§3）。修复只对**部署之后新发生**的 `terminal_open/send` 生效。

---

## 1. A 节：`agents.get(id)` 的生命周期

### 1.1 注册表以 sessionId 为 key（FACT）

- `asar:dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js:512-513`：`enter(agent, owner)` 第一行 `const id = agent.id; if (id !== agent.session.id) throw ...` → **agent id 恒等于 session id**，store 以该 id 为 key。
- 同文件 `:596-597`：`get(id) { return this.store.get(id)?.agent }` → 纯内存查表，不触发任何“解析/恢复”。
- 同文件 `:614-615` / `:623`：`list()` 返回所有 live agent；`roots()` 返回 owner 为 undefined 的顶层 agent。
- 同文件 `:429-437`：`setFactory(factory)` 由 `dsh-agent-loop` 注册工厂；`create/resume`（`:453-470`）都走工厂。

### 1.2 Agent 何时在、何时不在（FACT）

- **生命周期绑 owner Context 的 effect，不绑 turn**：`dsh-agent-loop/lib/index.js:1777` `unfollowOwner = ownerCtx.effect(function* () { … const created = machine = new ReactLoopAgent(...); … })`，`:1791` `detachAgent = loopCtx.agents.enter(agent, parentAgent)`；`dsh-agent-loop/README.zh.md:61` 明确「`create()`/`resume()` 都返回 `AgentHandle`，其 `dispose()` 负责精确拆除对应的 agent」。
- **谁调用 create/resume**：`ctx.sessionController` 的**按需操作**才会解析/恢复 Agent。`dsh-api-session-controller/README.zh.md:34` 原文：
  - 「搜索、附件、历史页、日志跟随、skill 发现和工作区路径打开**可以在不激活 Agent 的情况下**检查 persistence」
  - 「队列变更、模型、重命名、prompt 和文件引用操作**可以解析或恢复**普通 Session」
  - 「只有 create 与 fork 会直接创建新 Agent」
  → **打开/浏览一个已存在的会话（含看历史轮次）不会创建 Agent**。重启 DSH 后打开历史会话，`agents.get(sessionId)` 必为 `undefined`。
- **队友可以是「仅存储」状态（未加载）**：`dsh-experimental-agent-team/README.zh.md:62`——「`inactive`（当前没有执行轮次，**包括已加载和仅存储的成员**）」；代码侧 `dsh-experimental-agent-team/lib/index.js:970`：`const live = this.ctx.agents.get(target.id); if (live === void 0) return { previousStatus: "inactive" }`，`availability()` 注释「Turn availability is independent of whether the Agent is loaded.」（`:1188-1189`）。
- **会话列表本身携带 `agentAvailable`**（可作为旁证）：`dsh-api-session-controller/lib/index.js:1946`：`agentAvailable: this.ctx.agents.get(session.id)?.session === session`。

### 1.3 对面板的直接后果（FACT + INFERENCE）

- FACT：`lib/host/panel.mjs:161-169` 每 1.5s 缓存一次 `resolveSessions`；`:168` `rootAgent = agents.get(rootSessionId)`。
- FACT：`lib/host/panel.mjs:191` 只有 `rootAgent !== undefined` 才调用 `agentTeams.listMembers(rootAgent)` → rootAgent 缺失时**队友永远进不了会话树**。
- FACT（旧版，HEAD）：`lib/host/capture-terminals.mjs` 旧 noAgent 分支把该会话 terminal Run 全部 `store.remove` → 「终端 0、无提示」。**T31 工作树已改成不删**（见 §6）。
- INFERENCE：因此真机现象（terminal 0 + 队友行显示 sessionId + root 显示「当前会话」）与「rootAgent 为 undefined」完全自洽；但这**不足以区分**启动时就是 undefined（冷会话）还是运行期变 undefined（队友转 inactive）。⇒ 下一轮用 v7 `diagnostics.agentFound/agentCount/scopes` 定位。

### 1.4 ASSUMPTION / 未查清

- **A-1（未查清）**：真机那一刻 `agents.get(rootSessionId)` 具体为什么 undefined——冷会话（未发过 prompt）？队友 inactive 被卸载？还是其它？**验证**：v7 已加 `diagnostics {agentFound, agentCount, scopes, terminals.source}`，真机复测一次即可判定（`agentFound:false, agentCount>0` ⇒ 只是这个会话没加载；`agentCount:0` ⇒ 整个 Host 没有 live agent，多半刚重启）。
- **A-2（未查清）**：队友 inactive 后 Agent 是否立刻卸载、还是保留到某超时。代码里没有 idle reaper（在 `dsh-agent*`、`dsh-api-session-controller`、`dsh-web-app` 中 grep `idleTimeout|reap|evict` 无回收逻辑），卸载点来自 create/resume 的 owner ctx 生命周期；队友是通过 `subagents.startActivation` 的 `dispose()` 释放（`dsh-subagent/README.zh.md:61`）。**验证**：真机对一个已完成队友会话调 `panel.poll` 看 `agentFound`。

---

## 2. B 节：`terminals` 与 `terminalController` 是两个**互不相通**的注册表

### 2.1 内置 `terminal_*` 工具调用的是 `ctx.terminals`，owner = `exec.agent`（FACT）

`asar:dsh/node_modules/@deepseek-ai/dsh-tool-terminal/lib/index.js`：

| 工具 | 位置 | 参数（schema 原文） | 结果（value） |
|---|---|---|---|
| `terminal_open` | `:265`，execute `:299-309` | `{ type(必填), name?, cwd? }` | `TerminalSpawnResult`：`{sessionId,name?,type,pid?,status,motd}` |
| `terminal_send` | `:320`，`:389/:414/:433` | `{ sessionId(必填), text(必填), submit?, run_in_background? }` | `{viewport,waitReason,sessionStatus,truncated}` |
| `terminal_read` | `:467`，`:518` | `{ sessionId(必填), offset?, count? }` | `{text,totalLines,lineBegin,lineEnd,truncated}` |
| `terminal_signal` | `:532`，`:576` | `{ sessionId, signal }` | `{delivered,targetPgid}` |
| `terminal_close` | `:586`，`:619` | `{ sessionId }` | `{sessionId,outcome:'closed'|'already-closing'}` |
| `terminal_list` | `:629`，`:644` | `{}` | `TerminalSessionSnapshot[]` |

- `:228-230`：`function requireAgent(agent) { if (agent === undefined) throw new Error("terminal tools require an initiating agent"); return agent }`；`:302-304`：`const owner = requireAgent(exec.agent); await ctx.terminals.spawn(owner, {...})`。
- ⇒ owner 是 **exec.agent 这个确切对象**（工具调用期间它一定 live；空闲后可能被卸载）。

### 2.2 `terminals.list(owner)` 覆盖性：只覆盖「同一个 Agent 对象」的 PTY（FACT）

`asar:dsh/node_modules/@deepseek-ai/dsh-terminal/lib/index.js`：

- `:227-228`：`list(owner) { return [...this.sessions.values()].filter((record) => record.owner === owner).map(...) }` → **严格对象身份比较**。
- `:185-186`：`read(owner,id,request)` → `expectOwned(owner,id).session.read(request)`；`:155-156`、`:233-236`：`hasOwnerActivity`/`isLiveOwner` 用 `record.owner === owner`、`this.ctx.get("agents")?.get(owner.id) === owner`。
- ⇒ **伪造 `{id: sessionId}` 无效**（identity 不等）；⇒ 只有 `agents.get(sessionId)` 拿到的那个对象才行。

### 2.3 `terminalController` 是**另一套**浏览器/侧栏终端（FACT，关键纠偏）

`asar:dsh/node_modules/@deepseek-ai/dsh-api-terminal-controller/lib/index.js`：

- 构造：`:775` `super(ctx, "terminalController", { namespace: "terminal" })`，自己维护 `owners = new Map()`（`:765`）。
- `list(sessionId)`：`:808-815`，注释原文「**List retained terminals without resolving or activating an Agent**」，实现 `this.owners.get(sessionId)` → 返回 **它自己 spawn 的** terminal `info`。
- `create(agent, …)`：`:823-848` 走 `this.owner(agent)`（`:923`，以 `agent.id` 为 key 的 owners 表），`spawn(...)`（`:981`）经 `execution(agent).subprocess` **直接 spawn 一个 PTY**。
- **全文件没有出现 `ctx.terminals`**（grep 0 命中）→ 与 `dsh-terminal` 注册表完全独立。
- `README.zh.md:28/64`：这是「Web/侧栏的终端」，`retain` 是窗口持有流，与 agent 工具的 PTY 无关。
- `WebTerminalInfo`（inspect `terminalController` 精确返回，FACT）：

```ts
interface WebTerminalInfo {
  readonly id: WebTerminalId           // ← 就是 terminalController 自己的 id（不是 pty-4 这类）
  readonly title: string
  readonly shell: { path: string; args: readonly string[]; name: string }
  readonly cwd: string
  readonly cols: number; readonly rows: number
  readonly state: 'running' | 'exited' | 'failed'    // ← 字段名是 state，不是 status
  readonly exitCode: number | null
  readonly error?: string
}
```

- **对 T31 的直接后果**：`terminalController.list(sessionId)` **不会**返回 `terminal_open` 创建的 `pty-4/pty-5`（那不是它 spawn 的）。
  - 因此 v7 的「兜底 b」对用户报告的失败场景基本是**空转**（返回 `[]`），不是修复；真正的修复只来自 tier3（事件）或 tier1（agent 仍 live）。
  - 若仍保留 tier b，**必须修字段映射**（见 §6.2）：真实字段是 `state`/`title`/`shell`，**没有** `status`/`type`/`pid`；当前 `normalizeControllerTerminal` 只认 `status/type/backend/pid` → 会把 `exited/failed` 的侧栏终端**永远显示成 running**。

---

## 3. C 节：有没有「免 Agent」拿某 session 终端输出的路径？

### 3.1 结论（FACT + INFERENCE）

**没有**。三条可能路径逐一排除：

1. `ctx.terminals.read(owner, id)`：必须 **同一 Agent 对象**（§2.2）。`read`/`list`/`kill` 全是 identity 比较，伪造对象无效；owner 被 dispose 时注册表清理（`dsh-terminal/lib/index.js:233-236` 的 `isLiveOwner` + owner cleanup），历史 PTY 也随之不可访问。
2. `terminalController.retain/attach`：作用于**另一套**侧栏终端（§2.3），且 `attach` 需要 Remote invocation（`:887-890` `const invocation = this.ctx.invocation; if (invocation === undefined) throw new Error("Terminal attachment requires a Remote invocation")`）→ **Host 插件在进程内不能直接调用**，只能通过 Gateway 的 Remote 面（需要 client 侧走 remote；而我们 Host 半端无此通道）。
3. 读 Session 日志/历史：`terminal_read` 的**结果**确实以 `tool/result` 会话事件持久化（`SessionEventMap['tool/result']`），但那是「模型读过的某一页」，不是连续输出；且需要 `sessionQuery`/`sessionProjections` 读冷日志，成本高、语义不同。

### 3.2 可用的补偿（FACT + INFERENCE）

- **事件旁路能看到 `terminal_open/send/read/close` 的调用与结果**（§5），可在**调用发生的当下**登记元信息、输入文本、以及 `terminal_read` 返回的那一页文本。
- **`tools/result` 的 `result.value` 是结构化对象**（§5.2），比解析渲染文本可靠；建议 T31 优先用它。
- 若 owner Agent 仍 live（即使 `agents.get` 因 id 不匹配等异常拿不到）：可以在 `tools/execute` 里把 `exec.agent` **对象本身**存进 `WeakMap/Map`，后续用它做 `terminals.read` 的 owner。**注意**：这只对 live 期间有意义（注册表按 owner 身份），并且 `exec.agent` 必须原样保存、不得克隆（clone 会破坏 identity）。

### 3.3 风险

- 把 `exec.agent` 长期强引用会**阻止 Agent 被 GC**（Cordis effect 之外的内存泄漏）。若要缓存，应用 `WeakRef` 或随会话树刷新及时清理；且 identity 校验失败时静默跳过。
- 不要尝试 `terminals.list` 之外的调用（`startSend/signal/kill`）来“探活”，`kill` 有副作用。

---

## 4. D 节：隐藏会话输入框（composer）

### 4.1 官方能力：**没有**（FACT）

- `conversation.view` 的 owner props 只有 `{inspectCall, viewRequest, openView, completeViewRequest}`（`dsh-client-ui-conversation/lib/client.js:17943-17952`），不含「隐藏 chrome/composer」。
- 会话体内 `hideChrome` 是**内建私有 prop**，只由 blank 会话传给 `conversation.session.header`（`:17908`），不是插件可用的开关。
- composer 是 `conversation.composer` **chain slot**（`:19742-19745`），渲染请求为 `{sessionId, session, pendingInteraction}`（`:17846-17850`）——**不含「当前激活 view」信息**，所以 chain 变体无法“只在终端 tab 激活时隐藏”，硬做会影响该会话所有 view。

### 4.2 稳定 DOM 锚点（FACT，源码里显式写死的 data 属性）

`dsh-client-ui-conversation/lib/client.js:17855-17872`：

```jsx
<div data-conversation-content data-conversation-session={sessionId} data-conversation-region="chat" data-content-phase={phase}>
  <div data-conversation-scroll>
      <Views/>                                    {/* ← conversation.view 的宿主（我们面板在里面） */}
      <div data-composer-seat data-conversation-region="composer">…composer…</div>
  </div>
</div>
```

- composer 座位 = `[data-composer-seat]`，与我们的 view **同级**（都在 `[data-conversation-scroll]` 里），且其祖先 `[data-conversation-content]` 上有 `data-conversation-session`。
- 这些是**显式 data 属性**（不是 CSS Modules hash 类名），是本插件可用的最稳锚点；`data-conversation-session` 还用于内建自己的事件委托（`:19385-19391`），短期不会消失。

### 4.3 候选方案

**方案 A（推荐）：view 挂载时给最近祖先打标记 + 注入 CSS**

```js
// lib/client.js（示意，非实现代码）
ctx.effect(() => { /* 样式注入保持现有 data-plugin-css 机制 */ })
// 组件内：
React.useEffect(() => {
  const node = hostRef.current && hostRef.current.closest('[data-conversation-content]')
  if (!node) return undefined
  node.setAttribute('data-tp-composer-hidden', '1')
  return () => node.removeAttribute('data-tp-composer-hidden')
}, [sessionId])
CSS: [data-conversation-content][data-tp-composer-hidden] [data-composer-seat] { display: none !important; }
```

- 优点：只影响**当前这个会话实例**；view 切走即卸载（`only: viewId`，`:17951`）→ effect 清理自动恢复；多窗口/popout 不串。
- 风险：依赖非契约 data 属性 `data-composer-seat`（平台升级可能改）；`display:none` 会让该座位不占高，面板应自己 `flex:1` 填满（正好符合 ui-spec v5「面板填满高度」）；composer 失焦后键盘快捷键仍生效（我们只读，不抢键）。
- 降级：`closest()` 找不到或属性缺失 → **什么都不做**（静默降级），并在 `__internals` 暴露一个 `composerHidden` 诊断布尔供测试。

**方案 B（不推荐）：`conversation.composer` chain 变体**

- 做法：注册一个 chain variant，`select` 命中时渲染 `null`，fallback 用原 composer。
- 否决理由（FACT）：渲染请求只有 `{sessionId, session, pendingInteraction}`，没有“当前 view”；要按“我们的 tab 是否激活”选择，只能自建全局状态 + 依赖 composer 在 view 切换时重渲（无保证）。风险：可能把整个会话的 composer 永久隐藏 → 用户无法发消息；侵入提交链路。

**方案 C（更不推荐）：`document.body` 打属性 + 全局 CSS**

- 多会话/多窗口布局会串（同页多个 `[data-conversation-content]`），且 popout 窗口各有自己的 body；排障困难。

### 4.4 ASSUMPTION / 未查清

- **D-1**：真机 DOM 是否与源码一致（是否有 portal 把 composer 移出 `[data-conversation-content]`）。本次 client inspect 不可用，无法用 `Slots`/真实 DOM 复核。**验证**：真机 Console 执行 `document.querySelectorAll('[data-conversation-content] [data-composer-seat]').length`，以及在我们面板内 `el.closest('[data-conversation-content]')` 是否非空。
- **D-2**：隐藏后是否影响键盘（Enter 提交、Esc、快捷键）。**验证**：真机切到终端 tab 后按 Enter/⌘K，确认无输入丢失、无报错。

---

## 5. E 节：`tools/execute` / `tools/result` 能否看到 `terminal_*`

### 5.1 `tools/execute`（waterfall）字段（FACT，inspect `Event.listEvents('tools/execute')`）

```ts
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution,
                next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>

interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> { signal: AbortSignal }
interface ToolExecution extends ToolExecutionInput {
  readonly callId: ToolCallId
  readonly rootCallId: ToolCallId
  readonly token: ToolExecutionToken
}
interface ToolExecutionInput {
  readonly callId: ToolCallId
  readonly rootCallId?: ToolCallId
  readonly name: string            // ← 'terminal_open' / 'terminal_send' / ...
  readonly schema?: ToolSchema
  readonly arguments: unknown      // ← 已按 schema 解析的对象：{type,name,cwd} / {sessionId,text,...}
  readonly agent?: Agent           // ← 可选！工具调用时通常有
  readonly signal: AbortSignal
}
```

- **能看到** `terminal_open/send/read/close/list`：它们都是 `ctx.tools.register(...)` 注册的普通工具（`dsh-tool-terminal/lib/index.js:266/321/468/533/587/630`），dispatch 必经 `tools/execute`。
- 观察者必须 `const r = await next(); return r`（契约 v6 §4/§12；本仓库 `panel.mjs:299-307` 已如此）。
- `exec.agent` 在工具执行路径上通常存在（`requireAgent(exec.agent)` 会抛错否则），但**类型上可选**，缺失时不要猜归属。

### 5.2 `tools/result`（emit）能拿到结构化结果（FACT）

```ts
'tools/result'(this: Scoped<ToolRuntime>, exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>): undefined
type ToolExecutionResult = { isError: false; value: JsonValue; content: ContentBlock[]; … }
                        | { isError: true;  error: ToolFailure; content: ContentBlock[]; … }
```

- `result.value` 就是工具 execute 的返回值：
  - `terminal_open` → `{sessionId, name?, type, pid?, status, motd}`（`dsh-tool-terminal/lib/index.js:288-296` + `TerminalSpawnResult`）
  - `terminal_send` → `{viewport,waitReason,sessionStatus,truncated}`
  - `terminal_read` → `{text,totalLines,lineBegin,lineEnd,truncated}`
  - `terminal_close` → `{sessionId,outcome}`
  - `terminal_list` → `TerminalSessionSnapshot[]`
- `result.content` 是渲染后的文本（`finalizeContent` 已处理），**文本格式存在但属于展示层**。
- **建议（重要）**：tier3 提取 terminalId / 状态时**优先读 `result.value`**，`content` 文本解析只做兜底。当前 T31 工作树**只解析文本**（§6.3），而文本可被 `maxResultBytes` 截断（`renderSpawn` 的 prefix 会保留，但 `renderList`/`renderSend` 的尾部会被切），属于可避免的脆弱点。

---

## 6. 对 T31 工作树（未提交，2026-10-26 16:1x 快照）的核对

> 行号是**读取时快照**，backend 仍在改；结论按文件/函数定位。

### 6.1 已正确的部分（FACT）

- `panel.mjs:438-452`：`discoverTerminalCandidates` 三级发现（terminals → controller → events）。
- `capture-terminals.mjs:296-304`：会话结束清理加了 `allowSessionCleanup` 门；**agent 缺失不再删 Run**。
- `capture-terminals.mjs:246-255`：读不到输出时 `outputMode:'meta-only'` + `notice:'terminal-no-agent'`，不再假装有输出。
- `panel.mjs:519-545`：`diagnostics` 已带 `rootSessionId/agentFound/agentCount/scopes/terminals {candidates,source,reason}`。
- `terminal-events.mjs`：`terminal_*` 文本解析与我读到的真实渲染格式**逐条对得上**：`renderSpawn`（`:55-58`，`started terminal session <id>[ (<name>)] [type: <type>]`）、`renderSend`（`:67-72`，`[session: running]` / `[session: exited code=0 signal=null]`）、`renderClose`（`:610-613`，`closed terminal session <id>` / `terminal session <id> was already closing`）、`renderList`（`:97-107`，`<id>[ (<name>)] [<type>] <status>[ pid=<n>]`）。

### 6.2 发现的问题 / 风险（需 backend 处理）

1. **HIGH — `terminalController` 字段映射错**：真实 `WebTerminalInfo` 是 `{id,title,shell,cwd,cols,rows,state,exitCode,error?}`（§2.3），但 `terminal-events.mjs:normalizeControllerTerminal` 只认 `status/type/backend/pid`。
   - 后果：侧栏终端 `state:'exited'/'failed'` 被当成 `undefined` → `capture-terminals.mjs:265` 回退 `record?.status ?? 'running'` → **永远显示运行中**。
   - 修法：`state === 'running' → {kind:'running'}`；`'exited' → {kind:'exited', exitCode: raw.exitCode ?? null, signal: null}`；`'failed' → {kind:'exited', exitCode: raw.exitCode ?? 1, signal: null}`（配合 `status.mjs:65-70` 的 `mapTerminalStatus`）。`title` 当 name、`shell.name` 当 type 更贴切。
2. **HIGH — tier b 对用户报告的场景是空转**：`terminalController.list` 不含 agent PTY（§2.3）。若面板把侧栏终端也当 Run 显示，会与 ui-spec 的“Run 列”语义冲突（用户会看到自己开的侧栏终端）。**建议**：要么去掉 tier b，要么在 `diagnostics.terminals.source='controller'` 时明确降级为「侧栏终端（非 agent 终端）」并在 UI 区分；**不要**把它算作缺陷①的修复。
3. **MEDIUM — `Agent` 没有 `name`（§0/§1.3）**：`panel.mjs:191-193` 的 `rootAgent?.name` 永远 undefined。建议：
   - root 名优先 `ctx.sessionTitle?.get(rootSession)?.title`（inspect 精确签名：`sessionTitle.get(session: Session): SessionTitleSnapshot | undefined`，`SessionTitleSnapshot.title`；来源可以是 user/provider/fallback，FACT）；
   - rootAgent 缺失时，用 `ctx.sessions.get(rootSessionId)` 取 live Session（`sessions` 服务：`get(id)`），仍取不到再兜底「当前会话」；
   - 队友名：`TeamMemberView.name`（已有）+ 兜底用 `agents.list()` 里 `agent.session.header.parentSession === rootSessionId` 的成员；**拿不到 rootAgent 时用“任一 live 队友 Agent”去调用 `agentTeams.listMembers(thatAgent)`**（API 要求「exact live Team member」，任一成员都合法）→ 可修「rootAgent 缺失 ⇒ 队友全部缺席」。
4. **MEDIUM — tier3 的归属依赖 `exec.agent.id`**：这本身正确（`terminal_open` 的 owner 就是它），但**若 GUI 打开的会话 id ≠ 执行工具的 agent id**（例如用户在 teammates 的会话之间切换），事件 Run 会归到真正执行的会话，不会出现在当前 tab。这是**语义正确但用户预期可能不符**的点：面板是「全局活动聚合」还是「当前会话 + 其后代」？建议 Lead 明确（ui-spec 说的是「当前会话 + 子代理 + 队友」，所以跨会话 Run 应只显示在树内会话；不在树内的会显示 sessionId 标签——与真机现象吻合）。
5. **LOW — `terminal_read` 的结果文本未利用**：tier3 只拿元信息/输入，可顺带把 `result.value.text` 作为该 Run 的一段输出（相当于“模型读到的内容”），让 meta-only 的列不至于全空；注意不要与 `outputMode:'live'` 冲突。

### 6.3 建议的加固（低风险）

- `noteToolResult` 优先 `result.value`（§5.2），文本解析降为兜底；对 `terminal_open` 用 `value.sessionId`，`terminal_close` 用 `value.outcome`，`terminal_send` 用 `value.sessionStatus`。
- `terminal_open` 若 `isError:true`，不要登记 Run（`terminal-events.mjs` 已提前 return，确认无副作用）。
- 记录 `exec.agent` 的 `WeakRef` 供 tier1 之外的重试（§3.2），并在 diagnostics 里区分 `agentFound:false` 与 `agentFound:true` 但 `readFailures>0`。

---

## 7. 给下游的建议（可直接抄进 T31/T32/T33）

### T31（host）

1. 修 `normalizeControllerTerminal` 的 `state/exitCode/title/shell` 映射（§6.2-1）；并把 tier b 的语义在 `diagnostics.terminals.source` 里说清（`'controller'` ≠ agent 终端）。
2. `noteToolResult` 优先用 `result.value`（结构化）提取 terminalId/status；文本解析保底。
3. 名字解析不要再用 `rootAgent.name`：`sessionTitle.get(session)?.title` → `sessions.get(id)` → 「当前会话」；rootAgent 缺失时用任一 live 队员 Agent 调 `agentTeams.listMembers` 补队友树。

### T32（client）

1. composer 隐藏用**方案 A**：`useEffect` 里 `el.closest('[data-conversation-content]')` 打 `data-tp-composer-hidden`，CSS `[data-conversation-content][data-tp-composer-hidden] [data-composer-seat]{display:none!important}`，卸载移除；找不到锚点静默降级。**不要**用 body 全局属性（多窗口串）或 composer chain（无 view 信息）。
2. meta-only 列：输出区显示 `run.notice.message` + 输入块（`$ name` / `› text`），禁止"假输出"。
3. 收到 `removed` 才删除 Run（v7 已定），不要因为本帧没有输出就抖。

### T33（architect）

1. 契约 §12 增补两条裁定：①`terminalController` 是**侧栏终端**、不是 agent PTY，不能作为缺陷①的修复依据（若展示需区分来源）；②**历史/已卸载 owner 的 terminal 输出不可回读**，面板只能展示「事件发生后」的终端，文案/验收要按此基线。
2. §5.1 的 `SessionScope.displayName` 语义补一句：`Agent` 无 `name`，名字只能来自 `sessionTitle`/Team member name/subagent label/兜底。

---

## 8. 取证命令与证据索引

### 8.1 读安装版实现（asar 解包，可复现）

```bash
python3 - <<'PY'
import json, struct
P="/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
with open(P,'rb') as f:
    h=f.read(8); size=struct.unpack('<I',h[4:8])[0]; body=f.read(size)
    jl=struct.unpack('<I',body[4:8])[0]; HEAD=json.loads(body[8:8+jl].decode())
BASE=8+size
def read(path):
    n=HEAD
    for p in path.strip('/').split('/'): n=n['files'][p]
    with open(P,'rb') as f: f.seek(BASE+int(n['offset'])); return f.read(n['size'])
print(read('dsh/node_modules/@deepseek-ai/dsh-tool-terminal/lib/index.js')[:200])
PY
```

### 8.2 证据索引（文件:行）

| 结论 | 位置 |
|---|---|
| agents 以 sessionId 为 key / get 是纯查表 | `asar:dsh/node_modules/@deepseek-ai/dsh-agent/lib/index.js:512,596,614,623` |
| Agent 生命周期 = ownerCtx effect | `asar:.../dsh-agent-loop/lib/index.js:1777,1791`；`dsh-agent-loop/README.zh.md:61` |
| 浏览历史不激活 Agent | `asar:.../dsh-api-session-controller/README.zh.md:34`；`lib/index.js:1946` |
| teammate 可“仅存储”（无 live Agent） | `asar:.../dsh-experimental-agent-team/README.zh.md:62`；`lib/index.js:970,1188` |
| `Agent` 无 name 字段 | `asar:.../dsh-agent-loop/lib/index.js:747-790`（ReactLoopAgent 字段表）；inspect `Agent { id }` |
| terminal 工具走 ctx.terminals、owner=exec.agent | `asar:.../dsh-tool-terminal/lib/index.js:228,265,302,518,644` |
| terminals 按 owner 对象身份 | `asar:.../dsh-terminal/lib/index.js:155,185,227,233` |
| terminalController 独立注册表 + `list(sessionId)` 免 Agent | `asar:.../dsh-api-terminal-controller/lib/index.js:765,808-815,923,981`；`README.zh.md:28,64` |
| WebTerminalInfo 字段（含 `state`） | inspect `terminalController`（2026-10-26 16:1x） |
| composer 结构/锚点 | `asar:.../dsh-client-ui-conversation/lib/client.js:17846-17872,17908,17943-17952,19742` |
| tools/execute / tools/result 契约 | inspect `Event.listEvents('tools/execute')`、`'tools/result'`（2026-10-26 16:1x） |
| 工具真实渲染文本格式 | `asar:.../dsh-tool-terminal/lib/index.js:55-58,67-72,97-107,610-613` |
| 本仓库缺陷点 | `lib/host/panel.mjs:161,168,191-193,236-239,299-320,519-545`；`lib/host/capture-terminals.mjs:120-260,296-304`（工作树快照） |

### 8.3 官方检查器使用情况

- `cordis_inspect_query(platform=host, provider=Service, input={service:'terminalController'})` ✅（返回上方 `WebTerminalInfo` 精确声明）。
- `cordis_inspect_query(platform=host, provider=Service, input={service:'sessionTitle'})` ✅（`get/rename/refresh`）。
- `cordis_inspect_query(platform=host, provider=Tool, method=listTools)` ✅（确认本 profile 注册了 `terminal_open/send/read/...`）。
- `cordis_inspect_query(platform=host, provider=Event, input={event:'tools/execute'})` ✅。
- **`platform=client` 的 `Slots.listSubTree` / `Builtin.listBuiltins` 连续 2 次 10s 超时**（`Open or reconnect the Harness page`）→ DOM/slot 的真机复核未做，D 节以源码为证据（§4.4 已列验证方式）。

---

## 9. 未查清项（明确列出）

| # | 未查清 | 影响 | 验证方式 |
|---|---|---|---|
| U1 | 真机那一刻 `agents.get(rootSessionId)` 为何 undefined（冷会话 / 队友卸载 / 其它） | 决定 §1 修复优先级 | 部署 v7 后看 `panel.poll.diagnostics`（`agentFound/agentCount/scopes`） |
| U2 | 队友 inactive 后 Agent 是否立即卸载、何时卸载 | 影响面板能否看到非活跃队友的终端 | 真机对一个已完成队友会话观察 `agentFound`；或读 `dsh-subagent` activation dispose 时机 |
| U3 | tier b（terminalController）是否应展示、如何与 agent 终端区分 | 影响 UI 语义 | Lead 决策；真机看 `diagnostics.terminals.source` |
| U4 | `[data-composer-seat]` 在真机 DOM 是否如源码（无 portal 移位） | 决定方案 A 成败 | 真机 Console `document.querySelectorAll('[data-conversation-content] [data-composer-seat]').length` |
| U5 | 历史 pty 输出能否从 session 日志重建（作为「历史回放」功能是否值得） | 仅影响长期规划 | 读 `sessionQuery`/`sessionProjections` 冷日志中 `tool/result` 事件；成本高，不建议本期 |

---

## 10. 硬边界声明

- 本次只写本文件（`docs/research/terminal-panel-followup-2026-10-26.md`）；未改 `lib/**`、未改 tests/docs 其它文件、未 git 操作、未安装依赖、未重启 DSH。
- 工作树里 T31 的未提交改动由 backend 所有；本文对其核对基于 16:1x 快照，行号可能随其继续编辑而变化。
