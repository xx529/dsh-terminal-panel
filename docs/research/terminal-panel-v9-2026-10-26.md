# T42 取证 v9：为何拿不到 Agent（cordis/get/exec.agent/owner）+ 前端两条 bug 定位

> 角色：scout（只读取证）。仓库 `/Users/lzx/Documents/GitHub/dsh-terminal-panel`，`HEAD=0e81296`（工作树 clean，`lib/client.js` 3566 行）。
> **已核实部署一致性（FACT）**：profile 里 `~/.dsh/profiles/desktop/node_modules/dsh-terminal-panel` 是指向仓库的 symlink，`shasum lib/client.js` = `5d9f80015377804f6d5e299dad73fdaf46767546` 与仓库 HEAD 完全一致 ⇒ 真机跑的就是本仓库当前代码，不存在「装的是旧包」。
> 标注：**FACT** 有代码/实验证据；**INFERENCE** 由 FACT 推导；**ASSUMPTION** 未证实 + 验证方式。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| #1 会话在跑 turn，但 TERM 卡 meta-only | **不是 `ctx.get`/服务不可见问题**。cordis 4.0.5 下 `ctx.get('agents')` 无需 inject 且可用（实验证实）；`exec.agent` 是**真实 Agent 对象**、`terminals.list(exec.agent)` 与 `terminals.list(agents.get(id))` identity 一致。**最可能根因**：该 TERM Run 的 `ownerSessionId` **不在当前会话树（scopes）里**——tier1 只遍历树内 session（`capture-terminals.mjs:116-139`），而 tier3 事件旁路不按树过滤（`panel.mjs:368-380`）⇒ 树外 session 的终端永远只有 meta-only，即便其 Agent 实际 live。用户看到的「正在跑 turn」是 root 的 turn（root agent live），黄框说的是**另一个 owner 会话**。 |
| #2 已完成组/行点开展不开 | HEAD 代码已是 v9 纯布尔实现（`CompletedRow`/`CompletedSection`/`toggleRow`/`toggleGroup` 均在），**静态无「点不开」路径**；最可能是**浏览器仍在跑旧 client bundle**（v7 的 collapse 渲染）或把 linger 文案当 v7。给出真机 3 条判别命令 + 防御性清理建议（删除 v7 死代码，避免双轨）。 |
| #3 已完成行仍显示 v7「10s 后收起」 | HEAD 中 `collapse.in` 只剩词典与 `tp-countdown` CSS（`client.js:95,184,370-377`），**没有任何组件渲染它**；`mergeRun` 仍维护 v7 `column.collapse` 状态机（`1104-1132`，无渲染）。⇒ 同 #2，先判别是否旧 bundle；若是旧 bundle，清理死代码 + 强制刷新即可。 |

---

## A. Cordis 4.0.5 服务解析语义（FACT，含可复现实验）

### A.1 事实

- 版本：`asar:dsh/node_modules/@deepseek-ai/cordis/package.json` → `"version": "4.0.5"`。
- `ctx.get` 是 **mixin** 到每个上下文的反射访问器：`cordis/lib/index.js:736-742` `this.mixin("reflect", ["get","set","provide","accessor","mixin"])`。
- `ReflectService.get(name, strict=true)`（`:757-775`）JSDoc 原文：「Read a service from the store **without the inject requirement**」；实现 `_getImpl`：`key=this.ctx[symbols.isolate][name]; impl=store[key]; if (strict && impl.fiber.state !== 2) return;`（`state===2` 即 active）。**与调用方插件的 `inject` 声明无关**。
- 属性访问 `ctx.agents`：Context 是 Proxy，未命中 target 时走 `internal/get` waterfall（`:668-698`），最终抛 **`cannot get property "agents" without inject`**（`cordis/lib/index.js:676`）。
- **无 `inject: {optional:[...]}` 形态**：`Inject.resolve` 只接受 `string[]` 或 `{name: config|空}`（`:1470-1500`），语义全部为 required；官方「可选服务」写法就是 `ctx.get(name)`（inspect 的 Service access 标注也写 `optional: { expression: 'ctx.get("agents")', requiresUndefinedCheck: true }`）。

### A.2 实验（本机真实 cordis，复现脚本见 §附录）

```
plugin 只 inject:['dummy'] 时：
  hasGet=true, getAgents=true, getDummy=true
  propAgents="THROW: cannot get property \"agents\" without inject"
  propMissing="THROW: cannot get property \"nope\" without inject"
```

⇒ **A 结论**：`lib/host/panel.mjs:127-134` 的 `service()`（`ctx.get(name)` + try/catch）是**正确写法**；`jobs/terminals/subagents/agentTeams/sessionTitle/sessions/terminalController` 同样适用。若 `ctx.get('agents')` 真返回 undefined，只可能是：①该服务在本 Host 树未 provide，②provider fiber 非 active（`state!==2`），③`ctx.get` 自身被宿主拦截（未见证据）。**#1 不是这一类**（见 C 的树外 owner 假说）。

---

## B. `tools/execute` 的 `exec.agent` 是真实 Agent 对象（FACT）

唯一构造点：`asar:dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js:508-522`

```js
async function executeToolCalls(ctx, turn, step, toolCalls, signal, acceptContext) {
  const agent = ctx.agents.requireInitiator();      // ← live registry 里的 initiator（ReactLoopAgent 实例）
  const { session } = agent;
  const planned = toolCalls.map((block) => ({
    block,
    exec: { callId: block.id, name: block.name, arguments: parseArguments(block.arguments), agent, signal },
  }))
```

- 该函数 JSDoc（`:496-500`）原文：「The committed step's AgentLoop driver boundary supplies the initiating Agent that becomes each explicit `ToolExecutionInput.agent`.」
- `agents.requireInitiator()` 来自扫描/上下文注入的同一个 Agent 实例；`agents.get(id)` 返回 `store.get(id)?.agent`（`dsh-agent/lib/index.js:596-597`）→ **同一引用**。
- `dsh-tools` 全程透传（`dsh-tools/lib/index.js:1266,1374,3552`），不做 clone/包装。
- `terminals` 侧按对象身份比较：`record.owner === owner`（`dsh-terminal/lib/index.js:227-228`）、`isLiveOwner = ctx.get("agents")?.get(owner.id) === owner`（`:233-234`）。

⇒ **B 结论**：`terminals.list(exec.agent)` **必然匹配**（同一 sessionId 下）；`exec.agent` 不是 `{id}` 轻量引用。**不要**基于「identity 不匹配」重构 owner 逻辑（现有 `terminalOwners` WeakRef 缓存原对象，`panel.mjs:113,373,581`，是正确的）。

---

## C. `terminal_open` 的 owner 与「为什么仍 meta-only」

### C.1 owner 事实（FACT）

`dsh-tool-terminal/lib/index.js:228-230,302-309`：`requireAgent(exec.agent)` → `ctx.terminals.spawn(owner, {...})`；owner 即 exec.agent 原对象。`terminal_open` 也可在**任何会话**的工具循环里被调用（子代理、队友各自是 Agent）。

### C.2 最可能根因：所有权会话不在「面板会话树」内（INFERENCE，强）

- `discoverTerminalCandidates` 的 tier1 **只遍历 `scopes`**：`lib/host/capture-terminals.mjs:116-139`（`for (const scope of scopes) { sessionId = scope.sessionId; agent = agents.get(sessionId) ... }`）。
- tier3 事件旁路**不按树过滤**：`lib/host/panel.mjs:368-380` 的 `recordToolCall` 对任何 `terminal_*` 都 `terminalCapture.noteToolCall(exec)`，`terminal-events.mjs:ensureRun` 直接按 `exec.agent.id` 建 Run（`outputMode:'meta-only'` + `notice:'terminal-no-agent'`）。
- ⇒ 若 TERM 的 `ownerSessionId` **不在 scopes**（另一会话 / 未被 `listMembers` 列入的队友 / 已结束 subagent 分支），tier1 永远不会为它解析 agent，黄框永久保留；而用户看到「正在跑 turn」的是 root 会话（root agent live）。
- 叠加因素：`resolveSessions` 有 1.5s 缓存（`panel.mjs:109-110,248-250`）；`agentTeams.listMembers` 失败/非 Team 会 members=[]（`panel.mjs:277-299`），`subagents.listDescendants` 失败会只保留 root（`panel.mjs:262-276`）——任一都会让 owner 不在树。
- 与 v7 真机现象一致：v7 反馈里「agent 标签退化成 sessionId」正是**树外 Run** 的特征（`panel.mjs:349-353` 的 `enrichAgent` 兜底 `name: run.ownerSessionId`）。v9 截图若卡片 agent chip 显示 sessionId/「—」，可直接印证。

### C.3 次可能（INFERENCE）

- 事件 Run 先建（agent 未 live 时 `terminal_open` 不可能发生，所以创建时 owner 一定 live）；随后 owner 会话结束（subagent/teammate inactive → Agent 卸载）→ tier1 永久不可用。**这是 v7 已裁决的已知限制**（契约 §5.6：无 Agent 只 meta-only），但在「用户正在跑 turn」的观感下应给出更准确的文案（区分「本会话」vs「其它会话」）。
- `notice` 清理时序：v9 若在 tier1 命中后没有把 `notice` 置空/`outputMode` 升回 live，也会残留黄框——需 T44 自检（`collectTerminalRuns` 是否每帧以 `canRead` 重算 notice；HEAD 是重算的，falsy 清空路径 OK，`capture-terminals.mjs` 的 upsert 分支需确认 `notice:null` 真清空）。

---

## D. 诊断字段（给 backend，可直接加）

在 `panel.poll.diagnostics` 现有 `{rootSessionId, agentFound, agentCount, scopes, terminals{candidates,source,reason}}` 上**最少**补 3 个（O(1)，体积可忽略，不破 Tier2）：

1. `agentsService: boolean` —— `service('agents') !== undefined`（区分「ctx.get 拿不到服务」vs「服务在、但 id 不在 registry」）。
2. `agentsProbe: { getOk: boolean, sampleIds: string[] }` —— `sampleIds = agents.list().slice(0,5).map(a => a.id)`；`getOk = sampleIds.every(id => agents.get(id) !== undefined)`。用于对账「rootSessionId 是否在 live 集里」。
3. `terminalOwners: { captured: number, alive: number, inScope: number, outOfScope: number }` —— `terminalOwners` 的 WeakRef 数量 / deref 存活数 / 其中 ownerSessionId 在 scopes 内 vs 树外数量。**直接验证 C.2 假说**。
   可选：`terminalScopes: number`（tier1 实际遍历数）、`treeDegradation?: string`（把 `degradation` 透出）。

**后端建议（owner 收敛，最小改动）**：把 tier1 的遍历集合从 `scopes` 扩为 **`scopes ∪ store 中 terminal Run 的 ownerSessionId`**（对每个 owner 都尝试 `agents.get(owner)` + `terminals.list(agent)`），命中即升级 live 并清 notice；若产品裁决「只显示树内会话」，则应在渲染/过滤阶段隐藏树外 Run（不要留永久修不好的黄框），并在 diagnostics 里给出 `outOfScope` 计数。

---

## E. 前端两条 bug 定位（HEAD 0e81296 快照；frontend 正在改，行号可能漂）

### E.1 先做判别（真机 Console，3 条命令）

真机部署与 HEAD 文件哈希一致（见开头），所以先排除「旧 bundle 缓存」：
```js
document.querySelectorAll('.tp-countdown').length            // v7 倒计时徽标；应为 0
document.querySelectorAll('.tp-linger-slot').length           // v8 滞留槽；>0 才正常
document.querySelector('.tp-done-toggle')?.getAttribute('aria-expanded')  // 点组头应 true/false 变化
```
- 若 `.tp-countdown` > 0 → 页面跑的是 v7 旧 bundle（需刷新/重开窗口；client-modules 按 mtime rev，不会自动替换已加载页面），**代码无需改**。
- 若 `.tp-countdown` = 0 且组头点击无变化 → 真 bug，按 E.2 排查。

### E.2 代码现状与可疑点（FACT 行号）

| 位置 | 现状 | 说明 |
|---|---|---|
| `client.js:2551-2604` `CompletedSection` | 组头 `button.tp-done-toggle` `onClick: actions.toggleGroup`，`aria-expanded={!collapsed}`，list 只在 `collapsed ? null : …` 渲染 | 组开关接线正确 |
| `client.js:2495-2549` `CompletedRow` | 行 `role=button` `onClick: event.stopPropagation(); props.onToggle()`；展开体 `tp-row-body` 在行后渲染 | 行开关接线正确 |
| `client.js:3077-3098` `setRowExpanded/toggleRow` | 纯布尔 `group.expandedIds` 增删；`patchView` 用 latest `previous` | v9 语义正确 |
| `client.js:3359` 渲染站点 | `actions: { toggleGroup: () => patchView(... completedCollapsed: previous.group.completedCollapsed === false), … }` | 接线正确 |
| `client.js:1104-1132` `mergeRun` | **仍在维护 v7 `column.collapse`**（`armCollapse`/`expandCollapse`/deadline 10s） | **死代码双轨**：v8/v9 已不渲染 collapse，但每帧仍改它；建议删除（连同 `collapse.*` 纯函数仅留 `__internals` 兼容或加 deprecated 包装），避免未来再次混用 |
| `client.js:95,184` 词典 `'collapse.in': '{n}s 后收起'` | 只剩文本，无引用 | 建议删除（保留 `linger.in`） |
| `client.js:370-377` CSS `.tp-countdown/.tp-countdown-idle` | 无引用 | 建议删除（防真机误判） |
| `client.js:2321,2358-2374` `RunColumn` | 滞留态渲染 `.tp-linger-slot`（`linger.in` = `{n}s 后移入已完成` + 「收起」按钮） | 若用户看到的「10s 后…」是这条，那是 **v8 设计**（linger），不是 bug；文案与 v7「后收起」近似，易误判 |

### E.3 「点不开」若真复现，优先排查顺序

1. `.tp-done` 的 `overflow:hidden; max-height:50%`（`client.js:355`）与 `.tp-done-list{flex:1 1 auto; overflow-y:auto}`（`:362`）：若面板剩余高度不足，展开行只会在列表内滚动（观感像「没打开」）→ 用 `getBoundingClientRect()` 对比展开前后 `.tp-row-body` 高度。
2. `expandedIds` 是否被后续帧/`removed` 过滤掉：`mergePoll` 会保留 `base.group.expandedIds`（`:1160-1165`），但 `:1196-1200` 会在 `removed` 时过滤；若该 run 在 `removed` 里（v8 job 抖动补丁后应已互斥）会被静默移出。
3. 事件被上层拦截：`RowMenu` 按钮/`tp-chev` 冒泡正常；确认没有 `pointer-events:none` 祖先（`.tp-col[data-tp-exit]` 动画期间可能有，检查 `client.js` 的 exit 动画类）。

---

## F. 事实索引

| 结论 | 证据 |
|---|---|
| cordis 4.0.5；`ctx.get` 无需 inject；`ctx.agents` 抛 without inject；无 inject.optional | `asar:.../cordis/package.json`；`cordis/lib/index.js:676,736-742,757-775,1470-1500`；本机实验（§附录） |
| `exec.agent` = 真实 Agent 实例 | `asar:.../dsh-agent-loop/lib/index.js:496-522`；`dsh-agent/lib/index.js:596-597`；`dsh-tools/lib/index.js:1266,1374,3552` |
| terminals 按对象身份 | `asar:.../dsh-terminal/lib/index.js:227-228,233-234` |
| terminal_open owner = exec.agent | `asar:.../dsh-tool-terminal/lib/index.js:228-230,302-309` |
| tier1 只遍历树内 scopes | `lib/host/capture-terminals.mjs:116-139` |
| tier3 事件不按树过滤 | `lib/host/panel.mjs:368-380`；`lib/host/terminal-events.mjs:ensureRun` |
| 树外 Run 的 agent chip 兜底成 sessionId | `lib/host/panel.mjs:349-353` |
| 已部署 = HEAD（对称链一致） | `shasum lib/client.js` 两处相同 `5d9f80…`；profile dep `link:…dsh-terminal-panel` |
| v9 已完成区布尔展开 | `lib/client.js:2495-2604,3077-3098,3359` |
| v7 collapse 死代码残留 | `lib/client.js:1104-1132,95,184,370-377` |

## 附录：cordis 服务解析复现脚本

```js
import { Context, Service } from '<asar解包>/cordis/lib/index.js'
const root = new Context()
class Agents extends Service { constructor(ctx){ super(ctx,'agents') } get(id){ return { id } } }
class Dummy  extends Service { constructor(ctx){ super(ctx,'dummy') } }
await root.plugin(Agents); await root.plugin(Dummy)
const probe = Object.assign((ctx) => {
  console.log('get', typeof ctx.get, 'agents', ctx.get('agents') !== undefined, 'dummy', ctx.get('dummy') !== undefined)
  try { ctx.agents } catch (e) { console.log('prop throws:', e.message) }
}, { inject: ['dummy'] })
await root.plugin(probe); process.exit(0)
// 实测输出：get function agents true dummy true / prop throws: cannot get property "agents" without inject
```

## G. 未查清项

| # | 未查清 | 影响 | 验证方式 |
|---|---|---|---|
| U1 | 真机 TERM 的 `ownerSessionId` 是否在 scopes（C.2 假说成立与否） | 决定 D 的 owner 收敛是否为正确修法 | 加 `diagnostics.terminalOwners{inScope,outOfScope}` + `agentsProbe.sampleIds`，真机看一帧即可 |
| U2 | 真机页面是否在跑旧 client bundle（v7 DOM 残留） | 决定 E 是「无需改码」还是「真 bug」 | §E.1 的 3 条 Console 命令 |
| U3 | `notice` 在 tier1 命中后是否每帧清空（T44 自检） | 若不清空会长期挂黄框 | 单测/真机：先无 agent 建 Run，再让 agent live，看 notice 是否消失 |
| U4 | 若真机确为旧 bundle：为何未被 client-modules 的 rev 机制替换（页面未刷新/桌面窗口未重载） | 影响发布后生效口径 | 对比页面加载的 `/plugins?...rev=` 与磁盘文件 mtime |
