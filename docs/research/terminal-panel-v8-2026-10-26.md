# T36 取证：切 tab 状态丢失 / job 抖动 / 网格与 FLIP 可行性

> 角色：scout（只读取证）。仓库 `/Users/lzx/Documents/GitHub/dsh-terminal-panel`，`HEAD=d4fe331`。
> **注意**：取证期间 frontend（T37）与 architect（T38）已在并行改 `lib/client.js` / `docs/**`，本文所有 `lib/client.js:行号` 是 **17:2x 快照**，与最终提交可能漂移；平台侧行号（asar）稳定。
> 标注：**FACT** = 代码/命令证据；**INFERENCE** = 由 FACT 推导（写明依据）；**ASSUMPTION** = 未证实 + 验证方式。

---

## 0. 结论速览

| 现象 | 一句话根因 |
|---|---|
| ① 切 tab 回来记录全没 | **`conversation.view` 是 unmount（不是 display:none）**：DSH 用 `renderSlot(..., { only: viewId })` 只渲染激活项（`dsh-client-ui-renderer/lib/client.js:1219` + `dsh-client-ui-conversation/lib/client.js:17951`），组件状态随之销毁；而 Host **按服务端游标增量发送、不会因客户端游标为空而重放**（`lib/host/panel.mjs:540` + `store.mjs:390-401,445-457`），所以重挂后首帧是「空」的，要等某些 Run 的元信息/输出变化才回来。 |
| ② 只有 background job 时「有/无数据」跳动 | **Host 的 prune ↔ 重新发现打架**：`store.prune()` 在每个 poll 末尾按 `finishedAt` 年龄（默认 300s）删除终态 Run（`panel.mjs:723`、`store.mjs:497-512`），而 `collectJobRuns()` **每帧**把 `ctx.jobs.list()` 返回的 job 全部重新 `upsert`（不跳过终态，`capture-jobs.mjs:91-119`），jobs 注册表又会把已结算记录保留到 owner 释放（`dsh-jobs/lib/index.js:96`）→ 同一 job 每帧「删了又加」，`removed` 与 `runs` 同时出现在相邻/同一帧，客户端先删后建（`client.js:1071-1090`）→ 列状态（展开/倒计时/跟随/宽度）被重建，视觉上就是跳动/闪。 |

> ②与①**部分同源**：不是同一行代码，但都属于「客户端无状态 + 服务端增量语义」的组合问题；①的 v8 修复（SESSION_CACHE）能显著缓解②的观感，但不能消除②的 host 侧振荡（见 §6 建议）。

---

## A. View 生命周期：切 tab = unmount（FACT）

### A.1 DSH 侧证据

1. `dsh-client-ui-conversation/lib/client.js:17942-17952`（会话体渲染）：

```js
if (session.blank && conversationPhase(session, conversation) === "blank") return null;
const viewId = view ?? active?.id;
return jsx("div", { className: viewArea,
  children: viewId !== undefined && renderSlot("conversation.view", {
    inspectCall, viewRequest, openView, completeViewRequest,
  }, { only: viewId }) });
```

2. `dsh-client-ui-renderer/lib/client.js:1219-1222`（slot 渲染器对 `only` 的实现）：

```js
let list = [...rows].sort((a, b) => a.order - b.order);
if (opts?.only !== void 0) list = list.filter((item) => item.id === opts.only);
if (list.length === 0) return jsx(Fragment, { children: opts?.fallback ?? null });
return jsx(Fragment, { children: list.map(...) });
```

**FACT**：`only` 是**过滤掉其他注册项、不渲染**，不是 `display:none`；被过滤掉的项不在 React 树里 → **组件 unmount**，`useState`/`useRef`/定时器全部销毁。切 tab 时 `viewId`（激活 view id）变化即可触发。

3. 旁证：view 区只有激活项（`only: viewId`），tab 条本身在 `ConversationSessionHeader`（`:17991-18057`）独立渲染；因此「切 tab」只改 `viewId`，不改 DOM 容器结构。

### A.2 插件侧：旧版重挂时做了什么

FACT（v8 工作树已部分修复，下面同时给「旧行为」与「当前快照」）：

- `lib/client.js:796-815` `createViewState(sessionId)`：`status:'loading'`、**`revision:0`**、`runs:{}`、`columns:{}`、**`cursors:{}`**、`pendingFrameRevision:0`。
- 旧版（v7）在轮询 effect 内**无条件**重置：

```js
const startedState = createViewState(sessionId)
viewRef.current = startedState
setView(startedState)
```

⇒ 每次 mount 都从「loading + 空 runs + 空 cursors + revision 0」开始。
- 当前工作树（v8）已改为：`SESSION_CACHE`（LRU 4 / TTL 30min）在 `useState` 初始化时恢复 `entry.view`（`client.js:1384-1394`），effect 内仅在 `viewRef.current.sessionId !== sessionId` 时新建（`client.js:1469-1478` 注释「卸载/重挂或 retryToken 变化都不得清空已显示的数据」），并把 `revision/cursors` 从缓存恢复（`client.js:1460-1462`）。

### A.3 机制：为什么「重挂 = 空 + 要等轮询」

- 客户端 `cursors` 归零后，下一帧 poll 请求体 `cursors: {}`（`client.js` poll 调用）；
- Host 侧读取**从不依赖客户端游标**，而是 `store.nextReadCursor(runId, channel)`（`store.mjs:349-354`）→ 已交付字节的游标在**服务端**，`{}` 不会重置（见 §B）；
- 帧只携带 **`metaDirty` 或有未交付增量的 Run**（`store.mjs:445-457`）：`if (!hasPending && record.metaDirty !== true) continue`；
- ⇒ 重挂后的帧 `runs: []`（直到某些 Run 变化）+ 客户端 `hasFrame` 一旦置真，就会渲染**空态**（`client.js:2947-2949`：`empty = hasFrame && runs.length===0`）。
- **FACT（客户端丢弃旧帧）**：`mergePoll` 对 `frame.revision <= base.revision` 直接返回旧 state（`client.js:1036-1040`）。重挂后 base.revision 来自缓存或 0，正常；但 **Host 进程/插件重载后 `store.revision` 从 1 重新计数**（`store.mjs:520`）而页面未刷新时，客户端会**持续丢弃**所有新帧（状态冻结，不刷新）。这是与①同类的隐性风险，见 §C.3。

---

## B. Host 对「客户端游标为空」的反应（FACT：不重放、不 removed、不 truncated）

### B.1 代码路径

1. `lib/host/panel.mjs:530`：`const cursors = params?.cursors ... : {}`；
2. `panel.mjs:540`：`store.mergeClientCursors(cursors)`；
3. `store.mjs:386-401`：

```js
function mergeClientCursors(incoming) {
  if (incoming === null || typeof incoming !== 'object') return
  for (const [runId, value] of Object.entries(incoming)) {
    ... for (const channel of ['stdout','stderr','job','terminal'])
      if (Number.isFinite(value[channel])) merged[channel] = value[channel]
    cursors.set(runId, merged)
  }
}
```

**FACT**：空对象 `{}` → 循环 0 次 → **什么都不做**；它只做「客户端游标覆盖/对齐」，**没有「清空/重置/重放」语义**。

4. 读取端（以 job 为例）：`capture-jobs.mjs:122-125`
   `const prev = store.nextReadCursor(runId, 'job') ?? 0; if (total <= prev) continue;`（`readAt(jobId, prev, sessionId)`）→ 服务端游标已推进过的字节**永远不会再发**。
5. 保留窗口：`store.prune()`（`store.mjs:497-512`）只做「终态 Run 淘汰」（`completedLimit` 50 + `retainCompletedMs` 300000，`panel.mjs:35-43` DEFAULT_CONFIG），与客户端游标无关。
6. `removed` 只由 `store.remove()` / `setAbsorbed()` 产生（`store.mjs:216-238`），与「客户端无状态」无关。

### B.2 结论

- **不会**因空游标触发全量重发；**不会**因此产生 `truncated`；**不会**因此产生 `removed`。
- ⇒ 客户端重挂且无本地缓存时：**只能等 Run 的下一次元信息变化/新输出**，才能重新看到它；已终态且不再变化的 Run（例如已完成的后台 job）可能**长时间/永久不回来**。
- 唯一的「补偿」是 §C 的 prune↔re-add 振荡（会周期性把老 Run 重新发一遍，但代价是抖动）。
- 修法（给 backend/contract，若要根治「无缓存首屏」）：新增显式「客户端无状态」信号（如 `params.resync:true` / `cursors:null` 语义），Host 收到后对该会话的 Run 置 `metaDirty` 并重置 `nextReadCursor` 到保留窗口起点（`earliest`/`spillPaths`），一帧全量（受 Tier2 预算与 H1 保底约束，分帧可接受）。**当前 contract v8 只靠客户端 SESSION_CACHE 兜底**（INFRENCE：缓存丢失场景仍会空，见 §5 风险）。

---

## C. ②「有数据/无数据」跳动的成因（重点：Host prune ↔ 每帧重登记）

### C.1 主因（FACT 链，确定性振荡）

1. **每帧重新登记 job**：`capture-jobs.mjs:91-119` 对 `ctx.jobs.list(sessionId)` 的**每个** view 都 `store.upsert({runId, kind:'job', ...})`；**没有** `if (terminalStatus) continue`（该文件里 `isTerminalStatus` 只用于 `stoppable`，见 `:98,:114`）。
2. **jobs 注册表保留已结算记录**：`dsh-jobs/lib/index.js:96`「A settled record stays listed until its owner's disposal, service disposal, or an explicit remove」→ 只要会话/Agent 还在，`jobs.list()` 一直返回它。
3. **每帧末尾 prune 又删掉它**：`panel.mjs:723` `store.prune(now())`；`store.mjs:497-512`：

```js
const expired = now - (record.finishedAt ?? record.startedAt) > retainCompletedMs
if (index >= completedLimit || expired) victims.push(record.runId)
for (const runId of victims) remove(runId)     // remove() → removed.push(runId)  (store.mjs:216-223)
```

4. ⇒ **对一个 `finishedAt` 已超过 `completedRetainMs`(默认 5min) 的终态 job**（或完成条数 > `completedLimit` 50 时被挤出的那些）：
   - Poll N：discovery `upsert`（新记录，`metaDirty`）→ `takeEntries` 带上它 → 帧含该 Run → 末尾 `prune` 删除 → `removed=[job]`；
   - Poll N+1：discovery 又 `upsert`（记录不存在→新建）→ 帧再次含该 Run，同时 `removed` 排空 = `[job]`。
5. 客户端 `mergePoll` 的处理顺序是**先 removed、后 runs**：`client.js:1071-1090` 先 `delete next.runs[...]`，再对 `frame.runs` 逐条 `mergeRun(previous...)`；因为刚被删掉，`previous === undefined` → **重建 column**（`createColumnState`，含 `expanded/follow/collapse/scrollTop/width` 复位）→ 每 250ms 重建一次。
   - 视觉：已完成行/列在「有→无→有」间闪；倒计时徽标/展开态/跟随滚动每帧重置；分组计数抖动 → 用户描述为「有数据/无数据不断跳动」。

**FACT 补充**：客户端本地也有同参数裁剪 `pruneRuns`（`client.js:1101-1135`，`COMPLETED_RETAIN_MS=300000` 见 `client.js:428`），与 Host 窗口相同，会进一步放大「本地删了又被 Host 重发」的帧差。

### C.2 次因候选（排除或降级）

| 候选 | 结论 |
|---|---|
| `availability` 每帧翻转导致 banner/空态切换 | **未成立（FACT 排除）**：`collectJobRuns` 的 `available` 只在**全部调用失败**时为 false（`capture-jobs.mjs:136-140`），正常不翻；`client.mergePoll` 对 availability 只做覆盖，不清 runs（`client.js:1075-1077`）。 |
| `mergePoll` 的 revision 语义在 remount 后丢首帧 | **remount 正常**（缓存 revision 或 0 ≤ 新 revision）。但 **Host 重载后 revision 归 1、页面未刷新** 时客户端会永久丢帧（`client.js:1036-1040` + `store.mjs:520`）——现象是「冻住」不是「跳动」；列为独立风险 R-2。 |
| `collectJobRuns` 每帧 `remove` 后重登记 | **不是 remove**，是 `upsert`；真正的删除在 §C.1 的 `prune`。 |
| `takeEntries` 只发 dirty → 无数据的帧 | 单帧内容可以为空，但 `mergePoll` 是合并语义，**不会清空**（`client.js:1041-1090`），故不是主因。 |

### C.3 相关风险（供 frontend 防御）

- **R-1（高）**：`removed` 与 `runs` 同帧出现时，客户端「先删后建」导致列状态重置；即使 Host 不修，客户端也应**同帧去重**：处理 `removed` 时若该 runId 也出现在 `frame.runs` 里，则**忽略该条 removed**（或先合并 runs 再删未被覆盖的 removed）。这一条能立刻消除大部分抖动。
- **R-2（中）**：客户端应检测 `frame.revision < base.revision`（Host 重载/重启）→ 清空本地 view 并全量重同步（当前 `<=` 直接 return，等于永久冻结）。
- **R-3（低）**：Host 侧 prune 建议改成「本帧**未被 discovery 再次看到**的 Run 才淘汰」，即先收集 `seenThisPoll` 集合，prune 只处理不在集合里的记录；或把 `prune` 移到 discovery **之前**（这样 re-add 发生在 prune 之后，下一帧不会再产生同 id 的 removed）。

---

## D. 动画可行性（FLIP / 网格 / reduced-motion）

### D.1 平台事实

- **React 18.3.1**（FACT）：从 shell 产物 `dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 提取到 `version:"18.3.1"`；插件通过 `require('react')` 拿到同一实例（平台模块表，T1 取证）。
- **可用浏览器 API**（FACT，现有代码已在用）：`ResizeObserver`（`client.js:2674-2676`，已做 `typeof ResizeObserver === 'function'` 保护）、`getBoundingClientRect`、`requestAnimationFrame`（`client.js` 的 `raf` 兜底）。
- **CSS 动画/过渡现状**（FACT）：`@keyframes tp-fade-in` + `.tp-col[data-tp-fresh='playing']`（`client.js:399-401`）、`transition` 用于 switch knob / progress bar；**已有** `@media (prefers-reduced-motion: reduce){.tp-col,.tp-row{animation:none}.tp-progress-bar{transition:none}}`（`client.js:403`）。
- ⇒ FLIP **可行**，无需新依赖：进入/离开用 `transform: scale/translate` + `opacity`；布局位移用「先 measure（prev/next rect）→ 设置 transform 反向偏移 → 下一帧 `transition: transform 200ms` 到 0」。约束（v8 契约）：**只动 transform/opacity，不动高度**；reduced-motion 下瞬时。

### D.2 FLIP 实现要点（给 frontend）

1. 用 `React.useLayoutEffect`（避免首帧闪）在 runs 列表变化时：
   - 变化前：`const prev = new Map(el.getBoundingClientRect())`；
   - 变化后：对每个仍存在的 key 计算 `dx/dy`，设置 `el.style.transform = translate(dx,dy)`、`el.style.transition='none'`，随后 `requestAnimationFrame(() => { el.style.transition='transform 200ms ease-out'; el.style.transform='' })`。
2. 例外跳过：`document.documentElement.dataset.reducedMotion === 'reduce'` 或 `matchMedia('(prefers-reduced-motion: reduce)').matches`；正在拖列宽（`drag !== null`）；`stripRef` 不可见/`display:none`。
3. 离开动画（fade+scale 180ms）：不要等动画结束再删数据（会造成列表延迟跳动）；用「保留 180ms 的 ghost 快照层」或接受立即卸载 + 仅对**新增**做 fade-in（当前已实现 fresh 首挂）。
4. 不要对每 250ms 刷新导致的重新渲染做 FLIP——只对**集合增删/换行变化**触发（比较 runId 顺序 + 每行首 id），否则会持续抖。

### D.3 网格 vs 横向轨道：滚动条与窄容器

FACT（现状 CSS）：`.tp-strip{flex:0 0 auto;height:352px}`（`client.js:281`）、`.tp-strip-track{display:flex;...;overflow-x:auto;overflow-y:hidden;padding:0 12px 10px}`（`:282`）、`.tp-col{...;height:342px;max-height:100%}`（`:291`）、`.tp-more` 右侧按钮（`:287`）。

改成换行网格后：

- **双滚动条风险（中）**：`.tp-main` 已经是 `flex:1;overflow:hidden`，`.tp-done` 内部自带纵向滚动，`.tp-out` 每列自带纵向滚动；若把 `.tp-strip-track` 再加 `overflow-y:auto`，会出现「外层网格滚动 + 每列输出滚动」两层纵向滚动（预期内），但要**避免第三层**：不要同时让 `.tp-strip` 固定 352px 又让 track 滚动；建议：
  - `.tp-strip{flex:1 1 auto;min-height:0;height:auto;overflow:hidden}`；
  - `.tp-strip-track{display:flex;flex-wrap:wrap;align-content:flex-start;gap:12px;overflow-y:auto;overflow-x:hidden;padding:0 12px 10px;min-height:0}`（**唯一**的网格纵向滚动容器）；
  - `.tp-col{flex:0 0 auto;height:342px}` 保持卡片固定高（行高一致），`width` 仍由拖拽值决定但加 `max-width:100%`。
- **窄容器（< 2 卡宽）**：建议 `width: min(<dragWidth>px, 100%)`（CSS `max-width:100%` 即可），**不得**回退横向滚动；单卡时占满整行（`flex-basis:100%` 或 `width:100%`）；两卡最小需要 `2*280 + gap12 + padding24 = 596px`，低于此值即单列。
- **完成区高度**：`.tp-done` 仍 `flex:1 1 auto;min-height:0;overflow:hidden` + `.tp-done-list{overflow-y:auto}`（已有，`:352-360` 一带），与网格互不挤压；运行网格占「剩余高度」并自己滚动，避免整面板高度随卡片行数变化（v7 抖动教训）。
- `prefers-reduced-motion` 已覆盖 animation/transition；新增 FLIP 的 `transition:transform` 需**同步加进**该媒体查询（`:403`）。

---

## E. `.tp-strip-track` 改 wrap 网格的「必须一起改」清单（文件:行，17:2x 快照）

### E.1 CSS（`lib/client.js` STYLE_CSS 数组）

| 行 | 现状 | 改法 |
|---|---|---|
| `281` | `.tp-strip{flex:0 0 auto;height:352px}` | 去掉固定 352，改 `flex:1 1 auto;min-height:0;height:auto;overflow:hidden` |
| `282` | `.tp-strip-track{display:flex;...;overflow-x:auto;overflow-y:hidden;...}` | `flex-wrap:wrap;align-content:flex-start;overflow-x:hidden;overflow-y:auto` |
| `283` | `.tp-strip-empty{width:100%;height:100%}` | 网格下保留即可（`flex-basis:100%`） |
| `284-285` | 横向滚动条 `::-webkit-scrollbar{height:6px}` | 改为纵向滚动条（`width:6px`），或删除 |
| `287` | `.tp-more{position:absolute;right:4px;...}` | **删除**（v8 契约 §12.12 R9：禁止右侧 `›` 溢出按钮） |
| `291` | `.tp-col{...height:342px;max-height:100%}` | 保留 342 固定高；补 `max-width:100%`（窄容器不溢出） |
| `394/403` | reduced-motion 只覆盖 `.tp-col,.tp-row` 动画 | 追加 FLIP 的 `transition` 禁用 |

### E.2 JS（`lib/client.js`）

| 行 | 逻辑 | 影响 |
|---|---|---|
| `2620-2625` | `stripRef` / `atEndRef` | 网格后不再需要 `atEndRef`（改为 `scrollTop` 判底） |
| `2600` | `const [strip,setStrip] = useState({left,width,scrollWidth})` | 只剩 `› 更多` 用；可删或改存 `scrollTop` |
| `2664-2680` | `measure`/`ResizeObserver` 用 `scrollLeft/scrollWidth/clientWidth` | 改网格后这些量无意义；若 FLIP 需要，改为 `getBoundingClientRect` 测量；保留 ResizeObserver 但 measure 内容换成「容器高度/宽度」 |
| `2728-2746` | `remainingColumns` + `atEndRef` 自动跟随右侧 | **删除**（横向剩余数/自动右滚不再存在） |
| `2729` | `el.scrollLeft = el.scrollWidth` | 删除（横向） |
| `2966-2977` | `.tp-strip` + `.tp-strip-track` + `onScroll`（`scrollWidth/scrollLeft`）渲染 | 改网格容器；`onScroll` 若保留只用于记录 `scrollTop`（无必要可删） |
| `3040+` | `remainingColumns > 0 ? <button className="tp-more">` | **删除**按钮与角标 |
| `3028` | `el.scrollLeft = Math.min(el.scrollWidth, el.scrollLeft + ...)` | 删除（右滚按钮 handler） |
| 入口 | 需为 FLIP 增加 `useLayoutEffect`（新增，不改现有） | 见 §D.2 |

> 结论：换网格**不是纯 CSS 改动**，至少牵连上面 9 处 JS（`strip` 状态、ResizeObserver measure、右滚/角标、atEndRef）。建议 frontend 一次性删除横向一整套（状态/监听/按钮/CSS），避免残留逻辑在 wrap 后仍被触发（例如 `onScroll` 里对 `scrollWidth` 的判断会把纵向滚动误判为「到右侧」）。

---

## F. 事实索引

| 结论 | 证据 |
|---|---|
| `only` = 过滤不渲染（unmount） | `asar:dsh/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js:1219-1222` |
| 会话 view 只渲染激活项 | `asar:.../dsh-client-ui-conversation/lib/client.js:17942-17952`（tab 条 `:17991-18057`） |
| 空 cursors 不重置服务端游标 | `lib/host/panel.mjs:530,540`；`lib/host/store.mjs:386-401` |
| 增量读用服务端游标 | `lib/host/store.mjs:349-354`；`lib/host/capture-jobs.mjs:122-125` |
| 帧只带 dirty Run | `lib/host/store.mjs:445-457` |
| prune 年龄阈值 5min / 50 条 | `lib/host/panel.mjs:723`；`lib/host/store.mjs:497-512`；`DEFAULT_CONFIG` `panel.mjs:35-43` |
| job 每帧无条件 upsert | `lib/host/capture-jobs.mjs:91-119` |
| jobs 已结算记录保留到 owner 释放 | `asar:.../dsh-jobs/lib/index.js:96` |
| 客户端先删后建、revision 门 | `lib/client.js:1071-1090`、`:1036-1040`；`createViewState` `:796-815` |
| React 18.3.1 | `asar:.../dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（`version:"18.3.1"`） |
| reduced-motion 现状 | `lib/client.js:394,403`（snapshot 行号） |
| 横向轨道/更多按钮/ResizeObserver | `lib/client.js:281-291,2600,2664-2680,2728-2746,2966-2999,3028`（snapshot） |

---

## G. 未查清项

| # | 未查清 | 影响 | 验证方式 |
|---|---|---|---|
| U1 | 真机 ② 的 job 是否恰好 >5min（`completedRetainMs`）/是否完成条数 >50 | 决定 §C.1 是否就是唯一主因 | 真机 Network 看 `panel.poll` 响应：同一 runId 是否周期性同时出现在 `removed` 与 `runs`；或看 `runs[].finishedAt` 年龄 |
| U2 | 除 prune 外是否还有其它 `removed` 来源参与（如 `setAbsorbed` bash→job 吸收） | 影响残留抖动 | `grep removed` 已有清单：`store.remove`/`setAbsorbed`；`setAbsorbed` 只在 bash 工具结果带 jobId 时触发（`capture-bash.mjs:349`） |
| U3 | Host 重载/重启后 revision 归 1 是否会真机触发「冻住」（R-2） | 高（页面不刷新时） | 真机：页面开着，Plugin Manager 停用/启用插件后看面板是否恢复；或只重启 Host 进程（`dsh`）后不刷新页面 |
| U4 | 网格化后 FLIP 与 250ms 轮询的交互（新增/换行频繁时是否仍抖） | 中 | frontend 实现后用真机录屏/Performance 面板确认；纯函数单测只能测「是否触发」不能测观感 |
| U5 | `prefers-reduced-motion` 真机是否被系统设置命中 | 低 | 真机 macOS「减弱动态效果」开关后在 Console 查 `matchMedia(...).matches` |

## H. 硬边界

只写本文件；未改 `lib/**`、`tests/**`、其它 docs；未 git 操作；未装依赖。取证期间 frontend/architect 的未提交改动不属于本任务，本文按 17:2x 快照标注。
