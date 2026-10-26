# T56 取证 v11：跨会话泄漏路径 + 最小隔离方案（P0）

> 角色：scout（只读取证）。仓库 `/Users/lzx/Documents/GitHub/dsh-terminal-panel`，`HEAD=d50bb87`（v10，工作树 clean；`lib/host/panel.mjs` 1081 行 / `store.mjs` 732 行 / `frame.mjs` 560 行）。
> 标注：**FACT** = 代码位置/可复现推理；**INFERENCE**；**ASSUMPTION**（未真机验证 + 验证方式）。
> 真机缺陷：A session 打开过终端面板，切到 B session 打开同一面板，**看到 A 的终端内容** = 跨会话数据泄漏（P0）。

---

## 0. 结论速览

| 结论 | 摘要 |
|---|---|
| 根因 | Host 半端是**单实例 + 单 store + 全链路无会话分区**：`frameSelection` 不过滤 owner（`store.mjs:416-444`）、`takeEntries` 全局消费 pending（`:445-458`）、`removed` 全局 drain（`:561-565`）、`prune` 全局配额（`:507-530`）、`resync` 全局标脏（`:536-556`）；`buildPollFrame` 不做二次过滤（`frame.mjs:119-150`）。B 的 poll 帧必然带 A 的 Run（bash/job/terminal 三类）。 |
| 放大点 | `panel.mjs:733-753` v9 把「store 里所有 terminal ownerSessionId」并入 `terminalScopes`，B 的 tier1 主动解析 A 的 owner；`:774` `visibleSessionIds` 含跨会话 alive owner；`:833-846` bash 增量读取遍历全局 store。 |
| removed/prune | `removed` 全局 drain：B 的 poll 会把 A 的 removed 一起取走 → A 永远收不到、UI 残留；`prune` 用全局配额（50 条/5min）→ B 的轮询可淘汰 A 的终态 Run；`resync` 全局 → B 的 resync 会把 A 标脏/清游标（A 重读重复）。 |
| 修复 | host：store 四件套加 `allowedSessionIds` 过滤 + removed 按会话 + prune/resync 只本会话 + terminalScopes 只允许会话树（血缘判定替代 union）+ 调用点传参 + diagnostics；client：帧 sessionId 不匹配丢弃 + mergePoll 守卫 + 清缓存污染 + 保存断言。 |

---

## A. 帧内容泄漏路径（FACT）

### A.1 Host 单实例（前提）

- `lib/index.js:75`：`panel = createPanel({ ctx, config, logger })` 在 `apply` 内执行，而插件行在 profile 只有一行 → **整个 Host 进程只有一份 panel/store/cursors/revision/removed**，所有 session 的 `panel.poll` 共用。
- `store` 只按 `runId` 存（`store.mjs` 的 `records` Map），**没有 ownerSessionId 索引/分区**。

### A.2 选择集无过滤（泄漏的直接原因）

- `lib/host/store.mjs:416-444`：

```js
function frameSelection(options = {}) {
  const visible = [...records.values()].filter((record) => record.absorbedBy === undefined)
  const running = visible.filter(r => !isTerminalStatus(r.status)).sort(...).slice(0, maxRuns)
  const completed = includeCompleted ? visible.filter(r => isTerminalStatus(r.status)).sort(...).slice(0, completedLimit) : []
  ...
}
```

没有任何 `ownerSessionId` 条件；store 导出别名 `selectForFrame: frameSelection`（同文件返回对象）。
- `lib/host/panel.mjs:796`：`const selection = store.selectForFrame({ includeCompleted, maxRuns, focusRunId })` —— 不传任何 session。
- `store.takeEntries`（`:445-458`）内部同样调用 `frameSelection(options)` 且**对命中记录 `pending.delete(runId)`、`metaDirty=false`** ⇒ B 的帧不仅**带回** A 的 Run，还会**消费掉** A 尚未交付的增量（A 永久丢失这段输出）。这是比「看到」更严重的二次伤害。

### A.3 帧组装无过滤

- `lib/host/frame.mjs:119-172` `buildPollFrame(input, cursors, budget)`：只遍历 `input.entries` 逐条序列化（`:135-150`），`sessionId` 只是 `input?.sessionId ?? ''` 原样写入帧（`:172`）。⇒ 帧里 `sessionId=B`，`runs` 却是全局选择结果。

### A.4 三类来源分别怎么进来（都会泄漏）

| 来源 | 进入 store 的路径 | 是否泄漏 | 证据 |
|---|---|---|---|
| **terminal** | tier3 事件旁路**全局监听**（根 ctx `ctx.on('tools/execute')`），`recordToolCall` 不看 session 就 `terminalCapture.noteToolCall(exec)`；`terminal_open/send/read` 事件会为**任意会话**建 meta-only Run 并进全局 store | ✅ | `panel.mjs:368-380`（`sessionId = exec.agent?.id` 仅用于归属，不过滤）；`terminal-events.mjs` 的 `ensureRun` |
| **bash** | 同上，`bashCapture.noteToolCall({sessionId, ...})` 为任意会话建 bash Run；随后 `panel.mjs:833-846` 的读取循环 `for (const record of store.all()) if kind==='bash'` **无 session 过滤**去读增量/推进游标 | ✅（含游标被 B 推进） | `panel.mjs:368-395`、`:833-846` |
| **job** | `capture-jobs.mjs:collectJobRuns` 是按 `sessionIds`（会话树）list 的**scoped 采集**，但产出的 job Run 写进同一个全局 store；下一帧 `frameSelection` 仍会选中别的会话的 job | ✅（采集 scoped，选择不 scoped） | `capture-jobs.mjs` 循环 `for (const sessionId of sessionIds)`；`panel.mjs:796` |
| 放大 | `panel.mjs:733-753` `terminalScopes = sessions ∪ store 中所有 terminal ownerSessionId` → B 的 tier1 主动 `agents.get(A.owner)` + `terminals.list(A.agent)`，把 A 的 terminal 状态/输出**主动拉进 B 的候选**；`:774` `visibleSessionIds = new Set([...sessionIds, ...aliveTerminalOwnerIds()])` | ✅ | 同左 |

### A.5 其它跨会话共享状态（次要，不直接泄漏内容）

- `availabilityOverride` / `availability()` 是 panel 级全局（`panel.mjs` `service`/`availability` 范围）→ A/B 的 host/jobs/terminals 可用性互相覆盖（状态串，不泄漏内容）。
- `store.bumpRevision()` 全局递增：本身可接受（每 session 客户端只接受单调 revision）。
- `dropStreak` / `tee` / `terminalOwners`（WeakRef map）/ `sessionNameCache` / `treeCache` 全局 Map（树缓存 keyed by sessionId 是对的，其余只是诊断/优化，不泄漏内容）。
- `panel.kill` 有 `scopeOf(sessions, record.ownerSessionId)` 守卫（panel ~`:1010`）→ 跨会话 kill 返回 `run-not-found`（FACT，已正确）。

---

## B. `removed` 与 `prune` 的跨会话风险（FACT）

### B.1 removed 全局 drain

- `store.mjs:561-565`：`drainRemoved() { const drained = removed; removed = []; return drained }` —— 全局数组，任何 session 的 poll 都会清空。
- `panel.mjs:1000-1004`：`removedMerged = [...new Set([...(bounded.value.removed ?? []), ...store.drainRemoved()])]`，只与本帧的 `frameRunIds`/`entriesRunIds` 互斥，**不按 owner 过滤**。
- 结果：
  1. B 的帧会包含 A 的 runId 的 `removed`（B 客户端对未知 id 直接忽略，不显示，但被**消费掉**）；
  2. **A 永远收不到自己的 removed** → A 的 UI 残留陈旧 Run，直到缓存 TTL/刷新；
  3. 与 v8「removed/runs 同帧互斥」补丁叠加时，drain 时机更不可控。

### B.2 prune 全局配额

- `store.mjs:507-530`：`terminalRecords = [...records.values()].filter(isTerminalStatus).sort(...)`，`if (prunableIndex >= completedLimit || expired) victims.push(...)` —— `completedLimit=50`（`DEFAULT_CONFIG`）与 `retainCompletedMs=300000` 都是**全局**口径。
- `panel.mjs:1030` 附近 `store.prune(now(), { protect: seenRunIds })`：`protect` 只保护本帧 discovery 见过的 id，**A 的 Run 不在 B 的 seen 集合里** → B 的轮询可以把 A 的终态 Run 淘汰掉（`remove()` → 进全局 removed → 又被下一次任意 poll drain）。⇒ **B 的活动会删除 A 的数据**。
- `resync`（`store.mjs:536-556`，B 端 `resync:true` 触发，`panel.mjs:701-709`）：对**全局** frameSelection 每条 `metaDirty=true`、`cursors.delete(runId)`、`windows.delete`，并视 terminal 合成片段决定是否保留 pending ⇒ B 的 resync 会把 A 标脏、清 A 的读游标（A 之后从保留窗口起点重读 → 重复输出/乱序），并把 A 的 Run 塞进 B 下一帧（泄漏放大）。

⇒ **B 不只是「看到」，还会「偷增量 + 删数据 + 踩游标」**。隔离必须同时修这几个面。

---

## C. 实例与会话语义（FACT）

- **插件实例**：单例（一个 Host 进程一份 panel/store）；不是每 session 一份。`lib/index.js:75`。
- **cursor 存储**：`store.cursors` 是 `Map<runId, {stdout,stderr,job,terminal}>`（全局 keyed by runId）；`mergeClientCursors` 允许客户端覆盖（`store.mjs:386-401`）——**注意**：A 的客户端游标不会自动作用到 B（B 不发送 A 的 runId），但 B 的 `takeEntries`/`resync` 会动 A 的 cursor（见 B）。`nextReadCursor`（`:349-354`）全局。
- **runId 唯一性**：`terminal:<pty-N>`，其中 N 来自 `dsh-terminal` 服务的**全局 `nextId`**（`asar:.../dsh-terminal/lib/index.js:101` `TerminalSessionId(\`pty-${++this.nextId}\`)`）⇒ 同一 Host 生命周期内跨会话**不会撞 id**；Host 重启后计数器归零，但 store 也重建（风险仅限「旧客户端缓存里旧 id 与新 Host 同 id 且同 session 缓存键」这种边界，FACT 层面不构成当前泄漏）。
- **客户端缓存**：`SESSION_CACHE` 按 `sessionId` 分键（`client.js:1367` 起，`createSessionCache` `:1478-1526` 的 `get/set/delete` 都以 sessionId 为 key，LRU 4 / TTL 30min）⇒ **键层面已隔离，不会把 A 的 view 直接交给 B**；但**内容层面已被 v10 的泄漏污染**（B 的 view 里可能含 A 的 runs），缓存会存活 30min/4 个会话，升级后仍可能显示旧泄漏内容。
- **客户端切 session**：`usePanelSession` 的 poll effect 依赖 `sessionId`（`:1450` 起），切换时 effect cleanup 置 `disposed=true`，await 返回后 `if (disposed) return`（`:1835`）⇒ **在途请求不会跨会话合并**；`if (viewRef.current.sessionId !== sessionId)` 会重建空 state（v8 逻辑）。所以泄漏不是竞态，是 host 帧内容 + 缓存残留。
- **客户端无帧校验（FACT，需补防御）**：
  - poll 处理 `client.js:1834-1845`：`result.ok` 后直接 `const frame = result.value`，**没有校验 `frame.sessionId === sessionId`**；
  - `mergePoll` `:1160-1200`：`next.sessionId = frame.sessionId`（`:1197`）会**反向改写**本地状态（若真收到异会话帧，会把 B 的 state 标成 A）；
  - `commit()` `:1750` 里 `cacheSaveSession(sessionId, next, …)` 不校验 `next.sessionId === sessionId` → 可能把污染 view 存进 B 键。

---

## D. 最小修复方案（可直接实现）

### D.1 Host（backend；按依赖顺序）

1. **store 过滤谓词**：`frameSelection(options)` 增加 `options.sessionIds`（Set 或 string[]）；`visible = records.filter(r => r.absorbedBy===undefined && allowed.has(r.ownerSessionId))`（`store.mjs:416-444`）。`takeEntries`/`resync` 内部复用 frameSelection ⇒ 只需透传 options（`store.mjs:445-458,536-556`）。**这一步同时修掉「B 偷 A 的 pending 增量」**。
2. **`removed` 按会话 drain**：`removed` 结构改为 `Map<runId, ownerSessionId>`（`registerRemoval` 内部统一），新增 `drainRemoved(sessionIds)`：只取 `owner ∈ allowed` 的条目并删除，其余**保留**；保留无参重载（取全部）供测试/兼容。`panel.mjs:1000-1004` 改为 `store.drainRemoved(allowedSessionIds)`。
3. **prune 只本会话**：`prune(now, {protect, sessionIds})`：先按 owner 过滤再按 `completedLimit`/`retainCompletedMs` 计数淘汰；非本会话记录**全量跳过**（隔离优先；配额语义变为「每会话 50 条/5min」）。
4. **resync 只本会话**：`store.resync({...allowedSessionIds})`；panel 的 resync 分支（`:701-709`）传 allowed。
5. **terminalScopes 收紧**（移除 v9 union）：`panel.mjs:733-753` 只保留会话树；若确需「同会话但树外 owner」，用**血缘判定**：对 store 中 terminal Run 的 `ownerSessionId` → `agents.get(owner)` → 沿 `agent.session.header.parentSession` 逐级上溯（或 `agentTeams.tryMembership(agent)?.root?.id === rootSessionId`），**只有能回溯到本 root 的才允许**解析；否则不解析（保持 meta-only 或不显示）。可行性：FACT——`SessionHeader` 有 `parentSession/delegationDepth`（T1 取证），队友 `parentSession=lead`、subagent 链到 root；风险：fork/跨 preset 场景血缘可能缺失，需真机样本验证后再放开。
6. **调用点传参**：`panel.mjs:796`（selectForFrame）、`:800` 附近（planReads 用同一 selection，无需再改）、`:846` 附近 takeEntries、`:1030` prune、`:701` resync；`visibleSessionIds`（`:774`）改为只含本树 + 血缘允许集；`panel.mjs:833-846` bash 增量读取加 `owner ∈ allowed`；`:855` `activeOwners` 过滤。
7. **diagnostics 新增**（每帧必带，O(1)/O(n records) 可接受）：`frameSessionId: sessionId`、`allowedSessions: sessionIds.length`、`scopedRuns: selection.length`、`droppedForeignRuns: <store 中 owner ∉ allowed 的条数>`（组装帧时统计）、`removedSent: removed.length`。
8. **次要**：`availabilityOverride` 按 sessionId 分键（或每 poll 局部化）避免 A/B 状态互相覆盖。

### D.2 Client（frontend；纵深防御 + 清残留）

1. **丢弃异会话帧**：poll 成功分支（`client.js:1834-1845`）在 `isObject(frame)` 后：`if (typeof frame.sessionId==='string' && frame.sessionId && frame.sessionId!==sessionId) { schedulePoll(pollHintMs); return }`（可计数 warn 便于真机确认 host 修复）。
2. **mergePoll 守卫**：函数最前面（revision 判断之前）：`if (base.sessionId && frame.sessionId && frame.sessionId!==base.sessionId) return state`；去掉/限制 `:1197` 的反向改写（仅在 base.sessionId 为空时赋值）。
3. **清缓存污染**：引入 `CACHE_VERSION`（随 protocol/契约 bump）参与 key，或 restore 时 sanitize：只保留 `ownerSessionId ∈ (view.sessions ids ∪ {view.sessionId})` 的 runs/columns/order/droppedLines/cursors；restore 位置 `client.js:1394-1410`。
4. **保存断言**：`cacheSaveSession`（`:1740`/`:1750` 调用点）前断言 `next.sessionId === sessionId`，否则不保存 + 计数。
5. `resync` 请求已带 sessionId（`:1827-1834`），host 修后自然 scoped；client 无需改协议。

### D.3 取舍说明（v9 功能 vs 隔离）

- v9「树外 owner 升级 live」是为了修「队友/子代理暂不在树导致黄框」。**隔离优先**：v11 先把 union 去掉（树外不解析，保持 meta-only 或按 D.1-5 血缘允许），等真机验证血缘判定可靠后再局部恢复。验收上：**任何跨会话内容出现 = 缺陷**；同会话树内 live 升级功能不得回退。

---

## E. Tester 用例清单（跨会话隔离）

1. **帧内容**：A 有 bash + job + terminal（meta-only 与 live 各一），B `panel.poll` → `runs[].ownerSessionId` 全部 ∈ B 树；`diagnostics.frameSessionId===B`、`droppedForeignRuns>0`；A 的 runId 一个都不出现。
2. **交替轮询不偷增量**：A、B 交替 poll；B 的帧不得清掉 A 的 pending——A 下一帧仍能收到自己的增量（对比 `store.pendingOf(A.runId)` 前后）。
3. **removed 隔离**：A 的 run 调 `store.remove`；B poll 不得 drain（B 帧 `removed` 不含 A id，且 A 之后必须收到该 removed）；无参 `drainRemoved()` 兼容测试保留。
4. **prune 隔离**：制造 A 的终态 run（finishedAt 超 retain 或超 completedLimit），只由 B 反复 poll → A 的 run 仍在 store / A 下一帧仍在；B 自己的 completedLimit 仍生效。
5. **resync 隔离**：B 发 `resync:true` → 只重置 B 树的 run（A 的 metaDirty/cursor 不变；A 后续输出不重复）。
6. **terminalScopes 收紧**：A 的 terminal（owner ∈ A 树）不得进入 B 的 candidates/tier1（`diagnostics.terminals.candidates` 不因 A 变化）；B 内 subagent/teammate（parentSession 链到 B root）仍能 live 升级（v9 不回归）。
7. **kill 回归**：B `panel.kill` A 的 runId → `run-not-found`（不得泄漏存在性/不得终止 A 的进程）。
8. **client 防御**：直接喂 `sessionId` 不匹配的帧给 `mergePoll` → state 引用不变、不改写 sessionId；poll 层丢弃（可用 mock rpc）。
9. **缓存**：构造含 foreign run 的 cache 条目 → restore 后 foreign 被清（计数）；`cacheSaveSession` 断言：`next.sessionId !== sessionId` 时不保存。
10. **内存/回归**：非本会话 Run 在 store 中不被本会话 prune；同时确认长期运行不因 foreign 记录无界增长（若保留 foreign，需 TTL 或由 owner 会话结束时清理）。

---

## F. 事实索引

| 结论 | 证据 |
|---|---|
| 单实例 panel/store | `lib/index.js:75` |
| frameSelection 无 owner 过滤 | `lib/host/store.mjs:416-444`；`panel.mjs:796` |
| takeEntries 全局消费 pending | `store.mjs:445-458` |
| prune 全局配额 | `store.mjs:507-530`；`panel.mjs:1030` |
| resync 全局 | `store.mjs:536-556`；`panel.mjs:701-709` |
| removed 全局 drain | `store.mjs:561-565`；`panel.mjs:1000-1004` |
| buildPollFrame 无过滤 | `frame.mjs:119-150,172` |
| terminalScopes union（v9 放大） | `panel.mjs:733-753` |
| visibleSessionIds 跨会话 | `panel.mjs:774` |
| bash 增量全局读取 | `panel.mjs:833-846` |
| activeOwners 全局 | `panel.mjs:855` |
| kill 有 scope 守卫 | `panel.mjs` kill 分支的 `scopeOf` 检查 |
| terminal pty id 全局唯一 | `asar:.../dsh-terminal/lib/index.js:101` |
| cache 按 sessionId 分键 | `client.js:1367,1478-1526` |
| 客户端无帧 sessionId 校验 | `client.js:1834-1845`；`mergePoll :1197` |
| 切 session 在途保护 | `client.js:1835`（`if (disposed) return`） |

## G. 未查清项

| # | 未查清 | 影响 | 验证方式 |
|---|---|---|---|
| U1 | 真机是否同时存在「removed 被 B 吞掉」（A 面板残留）与「prune 删 A」（A 数据消失） | 决定修复后是否需要客户端 resync 一次清残 | 真机：A 面板产生 run → B 开面板轮询 1 分钟 → 回 A 看 run 是否还在/是否 stale；或加临时 host 日志（drainRemoved 长度/droppedForeignRuns） |
| U2 | v9 树外 owner 场景（队友/subagent 短暂不在树）在真机的实际频率 | 决定 D.1-5 血缘判定的优先级 | 真机 diagnostics `terminalOwners.outOfScope` + `agentsProbe.sampleIds`（v9 已带） |
| U3 | 血缘判定（`session.header.parentSession` 上溯）对 fork/跨 preset/旧会话是否可靠 | 决定 v9 功能能否在不泄漏前提恢复 | 用真机会话样本跑 `agents.get(id).session.header` 检查 parentSession 链；单测 mock header |
| U4 | 客户端缓存污染在升级后实际存活多久（LRU4/TTL30min） | 决定是否必须 CACHE_VERSION（本报告建议必须） | 真机：升级后切 4 个会话/等 30min 观察旧内容是否消失 |
| U5 | `availabilityOverride` 全局是否造成用户可感知的错误 banner（A/B 互相覆盖） | 低 | 真机：A 有 shell、B 无 shell 的服务组合下切换观察 banner |
