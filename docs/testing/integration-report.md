# 终端面板 · T6 集成验证与契约一致性审计报告

> 审计角色：tester（独立验证者；未修改 `lib/**`、`package.json`、`cordis.patch.yml`）
> 审计基线：`docs/architecture/contract.md` **v4**（commit `4adfe94`，含 §0 v4 A1–A5 附录）+ `docs/design/ui-spec.md` v4
> 被审计实现：`lib/**`（backend `5a92a2f` / frontend `4cb0586` 及其后续修复）、`scripts/smoke-host.mjs`、`tests/**`（T5 资产）
> 审计方式：静态代码核对 + 只读运行探针（`/tmp`，不入库）+ 现有 236 用例 + backend 冒烟 + 独立 e2e
> 结论一句话：**默认配置下未发现 CRITICAL 问题；发现 1 个 HIGH（受支持配置/超长命令可触发帧 livelock，Run 永不显示）、2 个 MEDIUM（ui-spec §3.7 菜单缺 2 项；预算目标与选择集错配）、3 个 LOW。** 6 项重点风险的其余 5 项均通过，契约 v4 附录 A1–A5 与实现一致。

---

## 1. 结论摘要

| 审计面 | 结果 |
|---|---|
| `node --test`（T5 全量 236 用例） | **PASS** — 236/236，0 fail，0 skip，exit 0 |
| `npm run smoke`（backend `scripts/smoke-host.mjs`） | **PASS** — 72/72，exit 0 |
| `node tests/e2e/smoke.mjs`（独立 e2e） | **PASS** — 17/17 断言、3 帧轮询，exit 0 |
| `npm run check` / 全量 `node --check lib/**` | **PASS** — 0 语法错误 |
| 契约 §11 冻结导出表 | **PASS** — host 6 模块 + client `__internals` 共 90+ 导出逐项核对，**0 缺失** |
| 重点风险 a：三级预算 ①–⑥ + Tier3 不可达 | **PASS**（默认/高配置）；**HIGH 缺陷 H1**：受支持的低 `maxFrameBytes` 或超长 `command` 会触发 Tier2 livelock |
| 重点风险 b：`removed` 立即删除（无 5min 延时） | **PASS** |
| 重点风险 c：终态单调 + 收起后新输出重新展开 | **PASS**（两者同时成立） |
| 重点风险 d：terminal 行坐标 / 仅 k<0 lossy / v4 A2 truncated | **PASS** |
| 重点风险 e：装配 dispose（路由/包装/监听/样式/shell 还原） | **PASS** |
| 真机（视觉/指针键盘/宿主集成） | **Unverified** — 清单见 §10（本次审计无真实 DSH 页面） |
| 发布前必须修最小集合 | **H1（必须）+ M1 裁决或实现 + task-11 prevention 用例**（详见 §9） |

---

## 2. 审计环境

| 项 | 值 |
|---|---|
| 仓库 | `/Users/lzx/Documents/GitHub/dsh-terminal-panel` |
| HEAD 审计时 | `4adfe94 docs(contract): v4 附录补丁…`（工作树干净） |
| Node | `v22.22.2` |
| 依赖 | 未安装、未联网；`react` 用测试 stub |
| 宿主 | 无真实 DSH 进程（host 服务全 mock；真机项标 Unverified） |

---

## 3. 执行命令与结果

```bash
# 1) 单元/集成测试（package.json 已修复 glob 形式；`node --test tests/` 在 v22 仍不可用）
node --test
#   → # tests 236 / pass 236 / fail 0 / skipped 0 ; exit 0
npm test
#   → 同上 ; exit 0

# 2) backend 冒烟
npm run smoke            # = node scripts/smoke-host.mjs
#   → PASS — 72/72 checks passed ; exit 0

# 3) 独立 e2e（host 纯逻辑 + 模拟轮询 3 帧 → client mergePoll → 最终视图帧）
node tests/e2e/smoke.mjs
#   → E2E SMOKE: 17 项断言全部通过（3 帧轮询序列）; exit 0

# 4) 静态检查
npm run check            # node --check lib/index.js && node --check lib/client.js ; exit 0
for f in lib/index.js lib/host/*.mjs; do node --check "$f"; done   # 全部 OK
grep -n "host\.call\|styles\.insert" lib/client.js   # 仅注释提及，无调用
grep -rn "console\.error\|console\.log" lib/          # 0 命中
grep -n "^import \|require('\./" lib/client.js        # 0 命中（client 单文件自包含）
```

补充静态证据：

- `lib/client.js` 是自包含 classic script：无相对 `import/require`、无其它 Client 包依赖，仅 `require('react')`（`tests/client/internals-export.test.mjs` 断言）。
- 全库无 `console.error` / `console.log`；唯一的 `console.warn` 是 `relative RPC 404 → 回退绝对路径`（契约 §4.1 允许的「一次告警」）。
- `package.json` scripts 已从 `node --test tests/` 修为 `node --test "tests/**/*.test.mjs"`（commit `d970be5`），并新增 `smoke` / `verify`；`npm run verify` 串起 check+test+smoke，本次等价通过。

---

## 4. 重点风险专项验证（Lead 指定 a–e）

> 方法：读取实现 + `/tmp` 只读探针（`/tmp/t6-probes.mjs`、`/tmp/t6-probes2.mjs`）。探针不写入仓库。

### a. 三级帧预算不变量 ①–⑥ + Tier3 不可达

**实现核对**（`lib/host/panel.mjs:483-500`、`frame.mjs`、`route.mjs:114-144`）：

- Tier1：`planReads` → `buildPollFrame(entries, cursors, { maxBytes })`，输出文本口径；首条 Run 永远放行；被跳过的 Run 记 `dropped` 且不写 `nextCursors`。✅
- Tier2：`const tier2Limit = Math.min(config.maxFrameBytes, MAX_RESPONSE_BYTES - 2048)` → `boundFrameDetailed(value, tier2Limit)`；被丢 Run `store.restore(dropped)` 且只 `commitCursors(kept)`。✅ 与 backend 声明「Tier2 上限 = min(maxFrameBytes, MAX_RESPONSE_BYTES-2048)」**一致**。
- Tier3：`route.createRpcHandler` 仅对 `poll` 结果调用 `boundResponseValue(value, 262144, params.cursors)`；被丢 Run 游标回退上一轮/删除。✅

**动态探针 P1–P6（全部 PASS）**：

| 探针 | 场景 | 结果 |
|---|---|---|
| P1 | `maxFrameBytes=1048576`、32 个 job 各 20KB 输出 | Tier1 放行后 Tier2 裁剪：帧 JSON **254334 B**（≤ 260096）、`runs=15`、`truncated=true`；`boundResponseValue` 对该帧**引用相等原样返回** → **Tier3 未触发** ✅ |
| P2 | 不变量①③ | `nextCursors` 的 key ⊆ 已交付 `runs`；Tier1 跳过的 Run 不出现 ✅ |
| P3 | 不变量② | 每个 job 游标 = 已交付 chunk 字节数，且 ≤ 源 `output.total` ✅ |
| P4 | Tier2 丢弃 → 恢复 | 多轮续读后 32/32 Run 至少交付一次（无永久丢失；`store.restore` 生效）✅ |
| P5 | 不变量⑤（Tier3 单元） | 构造 3×150KB 帧 + 上一轮游标，`boundResponseValue(...,262144)` 裁剪后体积 ≤262144，被丢 Run 游标回退/删除 ✅ |
| P6 | 不变量⑥（client） | `lib/client.js` 中 `frame.truncated === true && truncationBurst <= 3` → 立即续读、同 tick ≤3 次 ✅ |

**HIGH 缺陷 H1（见 §8）**：当「单条 Run 的序列化体积 > Tier2 上限」时，Tier2 会把它丢弃并 restore，下轮重读→再丢，形成 **livelock**：
`poll` 永远返回该坏帧的其余部分（可能 0 条 Run）、`truncated=true`、`nextCursors` 不前进。触发面：
1. 用户把 `maxFrameBytes` 配到受支持区间 1024–8192（契约 §9 允许）；或
2. **默认配置 65536** 下，前台 bash 的 `command` 元信息 > ~64KB（heredoc/生成脚本；`capture-bash.mjs` 未截断 command）。
复现见 §8 H1。

### b. `removed` 二分（服务端立即移除 → 客户端立即删列，无 5 分钟延时）

**实现核对**：

- 服务端：`store.remove(runId)` 删除 `records/pending/live/cursors/windows` 并 `removed.push(runId)`（`store.mjs:197-206`）；`store.prune()` 对超 `completedLimit`/`completedRetainMs` 的终态 Run 调 `remove`；会话结束的 terminal Run 也 `store.remove`（`capture-terminals.mjs:64`）；`panel.poll` 用 `store.drainRemoved()` 放进帧。✅
- 客户端：`mergePoll` 对 `frame.removed` 立即 `delete runs/columns/droppedLines/cursors`，无任何延时/保留分支；`pruneRuns()` 独立于 `removed`，只做本地兜底淘汰（`COMPLETED_RETAIN_MS=300000`、`MAX_RETAINED_COMPLETED=200`）。✅

**探针 P7（PASS）**：构造 `removed:['job:rm']` 帧 → `runs/columns/droppedLines/cursors` 四处同时清空，`order` 两区都不再含该 id。✅

### c. 终态单调 + 已收起后新输出重新展开（同时成立）

**实现核对**：

- `mergeRun`（`lib/client.js:793-805`）：`previousStatus` 已是终态 → `run.status = previousStatus`（忽略帧内 running/旧状态），`stopping=false`。✅
- `mergePoll` 输出合并后（`lib/client.js:915-916`）：`wasTerminal && sawOutput && collapse.expanded===false && !pinned` → `expandCollapse(...)`（重新 `deadline=now+10000`）。✅

**探针 P8（PASS）**：终态 job 收起后收到 `status:'running'`+新输出帧 → `status` 保持 `completed`，`collapse.expanded===true` 且 `deadline` 为重 arm 的数值。两条语义同时满足。✅

### d. terminal 行坐标 / `k<0` 才 lossy / v4 A2 truncated 语义

**实现核对**（`lib/host/terminal-window.mjs`）：

- `planTerminalRead(prev, totalLines)`：initial（prev.totalLines=0 且 tail=''）/ delta（k>0, count=min(k,10000)）/ probe（k===0, count=1）/ reset（k<0）；`offset` 恒 0，窗口按 `end=totalLines-offset`、`start=max(0,end-count)`。✅
- `computeTerminalDelta(prev, page)`：`absBegin=totalLines-lineEnd`、`absEnd=totalLines-lineBegin`、`nextCursor`（k>0/k<0 = totalLines，k===0 = prev.totalLines）；**k<0 → lossy=true + 重置基线；k===0 → lossy 不置位、基线不变；k>0 正常增量**；行边界：新行增量以 `\n` 开头（HIGH 缺陷回归点已修）；`truncated = page.truncated || lineEnd < totalLines`（v4 A2）。✅
- `capture-terminals.mjs` 注释明确「truncated 只表示 scrollback/未覆盖最旧行，不能据此循环翻页」；client 侧只用 `frame.truncated` 续读，不拿 terminal delta 的 truncated 翻页。✅

**探针 P9（PASS）**：k===0（原样尾行 / 行内续写）→ `lossy=false`；k<0（totalLines 回退）→ `lossy=true`；k>0 → `lossy=false`；`lineEnd<totalLines` → `truncated=true`，覆盖最旧行 → `false`；`text` 在跨页拼接时保留 `\n`（`'a\nb\nc'+'d' → 'a\nb\nc\nd'`）。✅ 与 v4 A1/A2 一致。

### e. 装配 dispose：路由/包装/监听/样式全撤、shell 原方法还原

**实现核对**：

- Host（`lib/index.js`）：`ctx.effect(() => { offRoute = webServer.register(...); capture = panel.start(); return () => { capture(); offRoute(); panel.dispose() } })`；`panel.start()` 清理：`tools/execute`、`tools/result` 监听 disposer、`tee.restore()` 还原 `shell.execute`、`bashCapture.dispose()`、`started=false`（幂等）。✅
- Client（`lib/client.js` apply）：`ctx.effect(insertStyle)`（`<style data-plugin-css=...>` 在清理时 `parentNode.removeChild`）+ `ctx.locale.register` + `ctx.slots.inject(...)`；View 卸载清理：`disposed=true`、`clearPoll`、`clearTimeout(notice/commit)`、`cancelAnimationFrame`、`clearInterval(tick)`、`removeEventListener('visibilitychange')`、`rpc.abort()`（frontend `4cb0586`）。✅

**探针 P10（PASS）**：mock ctx + 假 DOM 上执行 `apply → dispose`：
- Host：`shell.execute` 包装后恢复为**原函数**（`===`）、路由 0 条、监听 0 个、`teeState().wrapped===false`、重复 dispose 幂等。
- Client：`<style>` 从 `document.head` 移除、document 监听 0、定时器 0、slot 注册释放（cordis 生命周期模拟）。

### 契约 v4 附录 A1–A5 核对

| 项 | v4 定案 | 实现/证据 | 结论 |
|---|---|---|---|
| A1 k===0 不标 lossy | 空闲探尾正常 | `computeTerminalDelta` k===0 分支不置 lossy；探针 P9 | **一致** |
| A2 terminal truncated | `page.truncated \|\| lineEnd < totalLines`，不是「分页未取完」，client 不得据此翻页 | 实现一致；client 无 terminal truncated 翻页逻辑 | **一致** |
| A3 非 live root | 降级帧优先（ok:true、仅 root、tree.available=false、runs:[]），语法非法才 bad-request | 探针：`poll('no-such')` → ok:true、sessions=1、tree={available:false,reason:'session has no live agent'}、runs=[]；`poll('')` → `bad-request` | **一致** |
| A4 inject props | `inject` 返回 `{}`，owner props 优先 | `apply` 中 `inject: () => ({})`；测试断言不覆盖保留 props | **一致** |
| A5 C3/C4 closed | removed 二分 / 三级预算 | §4b、§4a 已验证 | **一致** |

---

## 5. 契约一致性核对（方法/帧/错误码/游标/配置）

| 契约条款 | 期望 | 实际 | 结论 |
|---|---|---|---|
| §4.1 路由 | exact `POST /terminal-panel/rpc`；405+Allow POST / 415 / 413 / 4KiB 上限 / no-store | 路由 exact 且 path 一致；探针 P11：405+Allow、415、413、no-store、非法 JSON→400、unknown-method→200 ok:false、401 认证拒绝 | **一致** |
| §4.2 poll 帧 | protocol/revision/serverTime/sessions/runs/removed/availability/truncated/nextCursors | 帧字段齐全；`availability` 额外含 `bashLive`（v2 引入，v4 §8 已文档化） | **一致（超集）** |
| §4.2 hello | protocol/hostTime/capabilities{bash,jobs,terminals,tree}/limits{maxFrameBytes,maxRuns,pollHintMs}/availability | 探针：capabilities 4 项、limits `{65536,32,250}`、availability 含 bashLive；无 `idlePollHintMs`（契约 §4.5 标「实现未发，client 用 IDLE 常量」） | **一致（可选字段未发，符合 v3 注记）** |
| §4.3 三级预算 | Tier1 文本 / Tier2 同参数整帧兜底 / Tier3 262144；六条 nextCursors 不变量；`budgetMode` 可选 | P1–P6 全通过；`budgetMode` 未发（v3 明确「省略即 text，client 不得依赖」） | **一致**（H1 为配置/元信息边界缺陷，见 §8） |
| §4.4 错误码 | bad-request/unknown-method/run-not-found/run-not-stoppable/session-not-found 极少数 | 探针 + e2e 覆盖：`bad-request`(空 sessionId)、`unknown-method`、`run-not-found`、`run-not-stoppable`(final-only bash 无句柄)；常规非 live root 走降级帧（v4 A3） | **一致** |
| §4.5 轮询 | 活跃 250 / 空闲 1000–1500 / 隐藏暂停 / 单飞 / 60ms 合帧 / 卸载 abort | client 常量 `IDLE_POLL_DEFAULT_MS=1000`，`pollHintMs` 来自 hello，`visibilitychange` 暂停，rAF 合帧，`rpc.abort()` | **一致** |
| §5 数据模型 | Run/RunCursor/AgentRef/SessionScope/availability | 字段齐备；`outputMode` 已用于 final-only；terminal delta 字段与 v4 冻结表一致 | **一致** |
| §6 状态机 | 终态单调 / 10s 收起 / 4px 跟随 / 两击停止 | 见 §4c + 测试全绿（collapse/follow/mergePoll） | **一致** |
| §8 降级矩阵 | 各来源缺失只降级 | panel availability 按服务探测；探针覆盖 jobs/terminals/shell 缺失；非 live root 降级帧 | **一致** |
| §9 配置默认值 | 10 个默认值 | `DEFAULT_CONFIG` 与契约表逐项相同（pollHintMs 250 / maxFrameBytes 65536 / maxRuns 32 / completedLimit 50 / completedRetainMs 300000 / scrollbackLines 600 / terminalPageLines 400 / initialTailBytes 32768 / collapseDelayMs 10000 / bashCapture true） | **一致** |

---

## 6. 冻结导出表核对（§11.1 / §11.2）

逐项脚本核对结果：**0 缺失**。

| 模块 | 冻结导出 | 实际 | 结论 |
|---|---|---|---|
| `classify.mjs` | 5 | 5 | ✅ |
| `tree.mjs` | 4 | 4 | ✅ |
| `status.mjs` | 7 | 7 | ✅ |
| `cursors.mjs` | 18（含 terminal re-export） | 19（多 `textBytes`，超集） | ✅ |
| `frame.mjs` | 8 | 8 | ✅ |
| `terminal-window.mjs` | 11 | 11 | ✅ |
| `lib/client.js __internals` | 38（20 纯函数 + 13 辅助 + 5 常量） | 38（表内 38 项全部命中，无缺无多） | ✅ |

---

## 7. ui-spec v4 逐条打分

> 口径：`Pass` = 静态/单测/探针可证；`Unverified` = 必须真实 DSH 页面/浏览器（本次审计无真机）；`Fail` = 实现缺失或与规格不符（附复现）；`N/A` = 已裁决不实现/不可用能力。
> 详细映射见 `docs/testing/acceptance-matrix.md`。

### §1 集成座位

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| R1 | 注册 `conversation.view` id/order/label/locale | **Pass** | `tests/client/assembly.test.mjs`；`order=30`、`label()='终端'`、只注册一次 |
| R2 | tab 在对话/轨迹之后、复用内建 tab（不自绘） | **Pass（静态）** | 只 register slot，无自绘 tab 条代码；真实按钮位置 Unverified |
| R3 | blank session 不渲染 | **Unverified** | 宿主内建行为（F25），需真机 blank 会话验证 |
| R4 | tab 角标（运行中数量+蓝点） | **N/A（裁决）** | §12.1 裁决不实现；工具栏计数已实现（见 L2.3-1） |
| R5 | 视图选择按会话持久化 | **Unverified** | 宿主内建机制，需真机切会话/刷新验证 |

### §2 布局规格

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| L2.1-1 | 默认列宽 352、列高 342、结构 30/24/…/22 | **Pass（静态）** | `DEFAULT_COLUMN_WIDTH=352`；CSS `.tp-col{height:342px}`、head 30、foot 22；命令行实测 24px（规格 22px，视觉差 2px，见 LOW） |
| L2.1-2 | 列宽夹取 280–640 | **Pass** | `client/layout.test.mjs` 全边界 |
| L2.1-3 | 拖拽调宽/实时像素/松手持久/双击复位 | **Unverified** | 代码：`.tp-resizer` 8px 命中、`tp-drag-badge` 显示 px、`onDoubleClick→onResizeReset`；交互需真机 |
| L2.1-4 | running 按 startedAt 升序、列序稳定 | **Pass** | `orderRunningColumns` + mergePoll 测试；`merge-poll` 顺序断言 |
| L2.1-5 | 横向滚动 + `›` + 剩余角标 | **Unverified** | 代码：`.tp-strip-track{overflow-x:auto}`、`.tp-more`、`.tp-more-badge`；需真机 |
| L2.1-6 | 标题行 类型/agent/状态/耗时/停止 | **Pass（数据）+ Unverified（视觉）** | e2e 断言 agent/status/duration；行 DOM 由 `ColumnHead` 渲染 |
| L2.1-7 | 类型标签 Bash/后台任务/终端 | **Pass** | `RUN_TITLES` + locale `kind.*`；探针/测试覆盖 |
| L2.1-8 | 命令行 mono 单行省略 + tooltip | **Pass（静态）** | `.tp-col-cmd` + `.tp-cmd-text` ellipsis + `title` |
| L2.1-9 | 输出区终端底/滚动/自动贴底 | **Pass（逻辑）** | `follow.test.mjs` 11 用例；视觉 Unverified |
| L2.1-10 | 脚注 pid/terminal id/job id + 跟随中 | **Pass（静态）** | `.tp-foot`、`follow.following/paused` locale；视觉 Unverified |
| L2.1-11 | 会话归属 3px 竖条（无/蓝/琥珀） | **Pass** | `mergeSessionTree` accent 测试 + `.tp-accent-subagent/teammate` CSS |
| L2.1-12 | ⤢ 980×600 只读弹窗 | **Pass（静态）+ Unverified** | `.tp-modal{width:980px;height:600px}`、`aria-modal`、Esc；交互需真机 |
| L2.1-13 | 像素级（间距 12、内边距 8/9、字号 10/14.5 等） | **Unverified** | 需与 Figma A 板叠图 |

### §2.2 已完成

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| L2.2-1 | 行高 32、组最高 160 内滚 | **Pass（静态）** | `.tp-row{height:32px}`、`.tp-done-list{max-height:160px}` |
| L2.2-2 | 分组默认折叠 | **Pass** | `defaults.test.mjs`：`completedCollapsed===true` |
| L2.2-3 | 行内字段/状态符号/倒计时/进度条 | **Pass（静态）** | `CompletedRow` + `RowStatusText`（exitCode 文案）+ `.tp-progress-bar` 2px |
| L2.2-4 | 10s 收起 | **Pass** | `collapse.test.mjs` arm/tick |
| L2.2-5 | 悬停/聚焦暂停、失焦重新 10s | **Pass** | `pause/resumeCollapse` 测试；DOM 事件绑定静态存在 |
| L2.2-6 | 收起后新输出重新展开 | **Pass** | `collapse.test.mjs` + 探针 P8 |
| L2.2-7 | 失败 1px 红边框 | **Pass（静态）** | `.tp-row-failed{border-color: color-mix(...40%)}` |
| L2.2-8 | 行展开/收起 + `⋯` 菜单 | **Fail（部分）** | 菜单仅 3 项（复制命令/复制输出/固定展开）；缺「在对话中定位」「在终端中打开（仅终端）」→ 见 M1 |

### §2.3 工具栏

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| L2.3-1 | `N 个进行中 · M 条记录 · K 个会话` | **Pass** | locale `stats.summary` + `countByKind`/`filter` 测试 |
| L2.3-2 | 类型 chips 单选 + 全局计数 | **Pass** | `filter.test.mjs` 15+ 用例 |
| L2.3-3 | 0 计数 chip 仍显示（置灰可点） | **Pass（静态）** | `kindReason`/toolbar 渲染逻辑；视觉 Unverified |
| L2.3-4 | 会话范围/搜索/自动展开/清空已完成 | **Pass（静态）+ Unverified** | 控件与状态机均存在；交互需真机 |

### §2.4 颜色/令牌

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| L2.4-1 | 只用 `--dsw-alias-*`，禁硬编码 | **Pass** | `static-style.test.mjs`（≥10 令牌、无直接 hex 前景/背景） |
| L2.4-2 | 明/暗主题可读 | **Unverified** | 需真机切换 D 板 light/dark |
| L2.4-3 | 内联 SVG 图标、禁 emoji | **Pass** | 静态：`h('svg')`、无 emoji 区段 |
| L2.4-4 | 圆角/阴影 token | **Pass** | 静态：`--dsw-radius-sm/md`、`--dsw-shadow-lv1/lv3` |

### §3 交互规则

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| I3-1 | 自动展开默认开；新 Run 以列出现并贴底 | **Pass（逻辑）** | `defaults/follow/mergePoll` 测试 |
| I3-2 | 终态 32px 行 + 10s 倒计时（琥珀点/文案/2px 进度条） | **Pass（逻辑+静态）** | collapse/format 测试 + `.tp-progress` 静态 |
| I3-3 | 悬停/焦点暂停、失焦重计 | **Pass（逻辑）** | pause/resume 测试 |
| I3-4 | 收起后新输出重新展开 | **Pass** | collapse 测试 + P8 |
| I3-5 | 滚轮隔离、贴底、上翻暂停、回底自动恢复 | **Pass（逻辑）+ Unverified（真实滚轮）** | follow 10 用例；`onWheel: stopPropagation` 静态 |
| I3-6 | 停止两击确认（3s） | **Pass（静态）** | `armed` 状态 + `setTimeout(3000)`；点击行为 Unverified |
| I3-7 | `⋯` 菜单 5 项 | **Fail（部分）** | 缺 2 项（同 L2.2-8/M1） |
| I3-8 | 清空已完成只清命中项 + 3s 撤销 | **Pass（静态）** | `undoRef`/`setTimeout(3000)`/`filter.undo` locale |
| I3-9 | 180ms 入场 / 200ms 收起 / reduced-motion | **Pass（静态）** | 静态测试 |
| I3-10 | Tab/Enter/Shift+Enter/Esc 键盘 | **Pass（静态）+ Unverified** | `onKeyDown`（Enter/空格/Shift+Enter、Esc 退出跟随）、`tabIndex`、`role=log` |
| I3-11 | 拖拽 6px 命中/实时 px/双击复位 | **Unverified** | 代码存在（`tp-resizer` 8px），交互需真机 |
| I3-12 | 最大化只读、保留停止/复制、Esc/✕ | **Pass（静态）+ Unverified** | `Modal` 组件、`aria-modal`、复制/停止按钮 |

### §4 筛选

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| F4-1 | 类型单选、计数全局 | **Pass** | filter 测试 |
| F4-2 | 会话范围多选/子代理缩进/队友色点 | **Pass（逻辑）** | filter + tree accent 测试；视觉 Unverified |
| F4-3 | 默认全部会话（§12.3 裁决） | **Pass** | `sessionIds===null` 默认 |
| F4-4 | 底部「仅显示有命令行活动的会话」 | **Pass（静态）** | locale `scope.note` + `markActivity` |
| F4-5 | 搜索命令/输出/显示名、即时、高亮、清空恢复 | **Pass（逻辑）+ Unverified（高亮视觉）** | filter/searchMatch 测试；`highlight()` 静态 |
| F4-6 | 筛选状态仅会话内存 | **Unverified** | 需真机切 tab/刷新验证 |

### §5 数据源与能力

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| D5-1 | Bash 前台实时 | **N/A + 限制（manual）** | 平台限制：仅 final-only；UI 有「仅终态」徽标、停止禁用（静态+测试） |
| D5-2 | 旁路读取不消费游标 | **Pass** | 假 ShellExecution 只提供 `readFrom`；`readOutput()` 立即抛错；cursors 测试 |
| D5-3 | 后台任务增量+终态 | **Pass** | `panel.test.mjs` job running→stopping→completed、增量不重复 |
| D5-4 | 持久终端文本流 | **Pass（逻辑）** | `terminal-window.test.mjs` 28 用例；TUI 退化属 §12.2 裁决 |
| D5-5 | 归属按 `exec.agent.id`、树合并 | **Pass** | tree/panel 测试 + e2e agent 名 |
| D5-6 | 单来源缺失只降级 | **Pass** | panel availability 测试 + 探针 |

### §6 边界状态

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| B6-1 | 空态（终端字形+文案） | **Pass（静态）** | `panel.empty.*` locale + `tp-state`；视觉 Unverified |
| B6-2 | 暂停跟随浮层 `N 条新输出 ↓` | **Pass（逻辑）** | follow 测试 + `follow.newOutput` locale |
| B6-3 | 已完成全部收起 | **Pass（逻辑）** | collapse 测试 |
| B6-4 | 输出超长截断提示 | **Pass（逻辑+静态）** | `tailLines` 测试、`output.truncated` + `dropped>0` 渲染 |
| B6-5 | >50 条虚拟化（可视±10） | **Pass（静态）** | `CompletedSection`：`runs.length>50`、start±5/end+20 |
| B6-6 | 断线重连游标续读、提示一次 | **Pass（逻辑）+ Unverified（真实网络）** | revision 丢弃/nextCursors 测试；`banner.recovered` 一次 |

### §7 无障碍与性能

| ID | 验收点 | 结论 | 证据/说明 |
|---|---|---|---|
| A7-1 | 状态不只靠颜色；类型文字常显；chip 带名字 | **Pass（静态）** | `RowStatusText` + `KindLabel` + `AgentChip` |
| A7-2 | button/aria-expanded/aria-label | **Pass（静态）** | 静态测试 `aria-expanded/aria-label` |
| A7-3 | aria-live + tabular-nums | **Pass** | 静态测试 |
| A7-4 | rAF 合帧（≥60ms）、只对可见列渲染 | **Pass（静态）** | `requestAnimationFrame` 合帧 + 虚拟化；性能 Unverified |
| A7-5 | 内联 SVG、占位符 | **Pass** | 静态测试 |

**汇总**：Pass 44 项、Unverified 19 项、Fail 2 项（同一根因：菜单 2 项缺失）、N/A 2 项（角标、xterm）。

---

## 8. 问题清单（按严重级别）

> 说明：严重度按「对发布的影响」判。默认配置、正常交互路径下无数据损坏/崩溃。

### CRITICAL

无。

### HIGH

#### H1 · 单条 Run 超 Tier2 上限时帧 livelock（Run 永不显示、`truncated` 永真）
- **位置**：`lib/host/panel.mjs:483-500`（Tier2 裁剪+restore）、`lib/host/frame.mjs::boundFrameDetailed`、`lib/host/capture-bash.mjs`（`command` 未截断）。
- **根因**：Tier1「第一条 Run 永远放行」允许单条 Run 进入 `boundFrameDetailed`；若该 Run 的 JSON 体积 > `min(maxFrameBytes, 260096)`，Tier2 只能丢弃它 → `store.restore` 退回 → 下轮重复读取→再丢弃，`nextCursors` 不前进。
- **触发面（均已复现）**：
  1. 默认配置 `maxFrameBytes=65536` + 前台 bash 的超长命令（`command` 元信息 > ~64KB，如 heredoc/生成脚本）；
  2. 受支持配置区间 1024–8192（契约 §9 允许）下输出大于该值——实测 `maxFrameBytes=4096` 时 5KB 输出即 livelock；`=1024` 时 10B 输出也 livelock。
- **复现**（只读，勿修库）：
  ```bash
  cd /Users/lzx/Documents/GitHub/dsh-terminal-panel
  node - <<'JS'
  import { createPanel } from './lib/host/panel.mjs'
  import { createFakeHostCtx, createFakeJobsService, createFakeTerminalsService } from './tests/helpers/fakes.mjs'
  const agents = { get: (id) => id==='root-1' ? { id, name:'lead' } : undefined, list:()=>[], roots:()=>[] }
  const fake = createFakeHostCtx({ services: { agents, subagents:{listDescendants:()=>[]}, agentTeams:{listMembers:()=>[],membership:()=>undefined}, jobs:createFakeJobsService(), terminals:createFakeTerminalsService() } })
  const panel = createPanel({ ctx: fake.ctx, config: {}, now: () => 1700000000000 })
  panel.store.upsert({ runId:'bash:huge', kind:'bash', ownerSessionId:'root-1', command:'x'.repeat(100000), startedAt:1699999999000, status:'running', outputMode:'live', stoppable:false, handle:{callId:'c1'} })
  for (let i=0;i<3;i++) { const r = await panel.handleRpc('panel.poll', { sessionId:'root-1', cursors:{} }); console.log('poll',i+1,'runs',r.value.runs.length,'truncated',r.value.truncated) }
  // 实际输出：runs 0 / truncated true，重复 3 次；该 Run 永不出现在面板
  JS
  ```
- **影响**：该 Run 永远不可见；client 因 `frame.truncated=true` 持续立即续读（每 tick 3 次）→ 无效轮询与 CPU 浪费。不影响其它 Run（Tier2 从尾部丢弃，其它仍交付）。
- **建议修复（任选其一/组合，需 Lead 定）**：
  1. Host 侧限制元信息长度：`command/cwd/detail` 序列化前截断（如 4 KiB，UI 只显示单行省略 + tooltip，足够；契约可补「元信息列上限」）；**推荐，一处改动覆盖所有触发面**；
  2. Tier2 保底不丢最后一个 Run（与 Tier1 首条放行对称），允许该帧超 `maxFrameBytes` 但 <262144；或
  3. 把 `maxFrameBytes` 配置下限提高到 ≥4096 并保证单 Run JSON 不超过它（治标不治本）。
- **回归建议**：`tests/host/panel.test.mjs` 增加「`command=100KB` 时 poll 在 2 轮内交付该 Run 且 `nextCursors` 前进」用例；`tests/host/frame.test.mjs` 增加「单 run 超 Tier2 上限时保底至少一条」。

### MEDIUM

#### M1 · ui-spec §3.7「⋯ 菜单」缺 2 项
- **期望**（ui-spec §3.7）：在对话中定位 / 复制命令 / 复制输出 / 在终端中打开（仅终端）/ 固定展开。
- **实际**：`lib/client.js` `RowMenu` 仅渲染 复制命令 / 复制输出 / 固定展开（`lib/client.js:1916-1924`）；locale 无「在对话中定位」「在终端中打开」键。
- **复现**：真实页面已完成行的 `⋯` 菜单只有 3 项（静态可证：`grep -n "actions.copyCommand\|actions.copyOutput\|actions.pin" lib/client.js`，无 locate/open-terminal 项）。
- **影响**：ui-spec §3.7 验收 Fail；用户无法从面板跳回对话定位或打开终端。
- **裁决需要**：实现（需宿主导航/终端 API 支持）或在 `contract.md §12.8` + `README` 记录「已裁决不做」；**发布前必须有明确结论**（不能既不做也不记录）。

#### M2 · `planReads` 预算目标与 `takeEntries` 选择集错配（running > maxRuns）
- **位置**：`lib/host/cursors.mjs::planReads`（running 按 startedAt **升序取前 32** 分配预算）vs `lib/host/store.mjs::takeEntries`（running 按 startedAt 升序后 `slice(-maxRuns)` **取最新 32**）。
- **探针**：40 个 running job（startedAt 递增，各 20KB）→ 首帧 32 列中**有输出 0 列**（预算读的是最旧 32，帧选的是最新 32，交集为空）；下一帧才补齐；无永久丢失（4 轮内 40/40 出现）。
- **影响**：>32 并发 Run 时首帧空白/延迟一帧；每轮浪费读取预算；不影响数据正确性。**非阻塞**，建议把 `planReads` 的排序与 `takeEntries` 对齐（同一函数/常量）或先把选择集传给 planReads。

### LOW

| ID | 问题 | 证据 | 影响 |
|---|---|---|---|
| L1 | 部分 UI 文案硬编码中文，未走 locale：停止相关 toast（`已请求停止/该任务已结束或不可见/该来源不支持停止`，`lib/client.js:1255-1260`）、lossy 缺口标记 `（已丢失 N 字节/行）`（`lib/client.js:823,860`） | 静态 grep | en 界面下出现中文；不影响功能 |
| L2 | 命令行高度 24px vs ui-spec 22px；停止按钮 18px vs 规格 16×16 | CSS `.tp-col-cmd{height:24px}`、`.tp-stop{height:18px}` | 像素级偏差，待真机对照 Figma 判断是否接受 |
| L3 | `hello.limits` 未发 `idlePollHintMs`；`budgetMode` 未发 | 契约 §4.5/§4.3 均标注可选/当前未实现，client 有常量兜底 | 无功能影响，v3/v4 已记录 |
| L4 | `formatCountdown` 纯函数硬编码 `'s 后收起'`（UI 实际用 locale `collapse.in`） | 静态 | 纯函数契约输出（tester 依赖），非 UI 缺陷；记录以便后续统一 |
| L5 | T5 测试桩 `ctx.on` 曾返回 `{dispose}` 对象，与真实 cordis（函数）不一致 | `tests/helpers/fakes.mjs` 已修正为函数 | 仅测试夹具问题，已修；不影响生产 |

---

## 9. 发布前必须修（最小集合）

1. **H1**：消除 Tier2 livelock。最小改动 = Host 序列化前截断 `command`（如 4096 B）+ Tier2 保底不丢最后一条 Run；并补回归用例。**必须修**（默认配置 + 超长命令可触发）。
2. **M1**：ui-spec §3.7 两项菜单——实现**或**在 `contract.md §12.8`/`README` 明确记录「已裁决不做」。**必须有结论**（验收基线不能悬空）。
3. **task-11 prevention 载体**：`tests/host/panel.test.mjs` 当前**没有** `availability.bashLive.available=false` 时 poll 仍返回完整帧、bash 来源仍 available 的断言（`grep -n bashLive tests/` → 0 命中）；按 Lead 的 task-11 落地（本报告 §12 已给出用例设计），并把 `docs/retro/2026-10-26-bash-live-source.md` 的 P2 标记为已落地、`status: open → closed`。
4. **真机验收**（§10）：本次审计无真实 DSH 页面，ui-spec 的 19 项 Unverified 必须在发布前由 Lead/owner 逐条执行并留证；尤其 R2/R3/R5、L2.1-3/5/13、L2.2-7、L2.4-2、I3-5/6/7/10/11、B6-6。

非阻塞（可排后）：M2、L1–L5。

---

## 10. 真机验收清单（安装后逐条执行）

> 前置：`docs/install.md` §1 的 `plugin_manager install_bundle` 已执行；本清单按 ui-spec v4/Figma A–F 与契约 §8 顺序。证据请截图 + Console/Network 录屏片段。

### T6-V0 安装前自检（本机终端）

```bash
cd /Users/lzx/Documents/GitHub/dsh-terminal-panel
node --check lib/index.js && node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('manifest ok')"
node -e "for (const p of ['icon.svg','locale/zh.json','locale/en.json']) require('fs').accessSync(p)"
npm run verify        # check + 236 tests + 72 smoke checks，期望 exit 0
```

### T6-V1 安装与加载

| # | 步骤 | 期望 |
|---|---|---|
| V1 | `plugin_manager({action:'list_plugins'})` 或插件页 | 有 `dsh-terminal-panel`，已启用 |
| V2 | `cordis_inspect_query`（Host `Config.listConfigs`，name `dsh-terminal-panel`） | 有条目，无 `failed` 诊断 |
| V3 | 插件列表/详情 | 标题/描述来自 `locale/zh.json`（中文界面）/`en.json`；图标为 `icon.svg` 渲染 |
| V4 | DevTools Console：`window.__DSH_BOOT__`；Network `/plugins?...` | boot 图含 `dsh-terminal-panel`；`/plugins?...` 200；产物含 `__ModuleLoader__` 与 `id:"dsh-terminal-panel"` |

### T6-V2 RPC 与降级

| # | 步骤 | 期望 |
|---|---|---|
| V5 | 打开有内容的会话 → 点「终端」tab；Network 看 `POST terminal-panel/rpc` | 200 + `{"ok":true,...}`；无 404（404 = Host 半端未激活，见 install.md §5） |
| V6 | 在 Console 检查首帧 `panel.hello` 响应（Network → Response） | `protocol:1`、`capabilities{bash,jobs,terminals,tree}` 与运行环境相符、`limits.maxFrameBytes=65536`、`availability.bashLive` 存在（无 shell 句柄时 `available:false`，属预期） |
| V7 | 断网 3s 再恢复 | 横幅「连接中断，重试中…」→ 恢复后清横幅 + 一次「连接已恢复」；输出无重复/缺口 |

### T6-V3 数据源（跨会话重点）

| # | 步骤 | 期望 |
|---|---|---|
| V8 | 让模型跑一条前台 bash（`npm test` 之类） | 「Bash」列出现 + agent chip；列内「仅终态」徽标；结束后有终态输出；停止按钮禁用 + tooltip「仅终态，无法从此面板停止」 |
| V9 | 让模型起一个后台 job（如 `pnpm dev`） | 「后台任务」列 + 实时增量；完成后 32px 行 + 10s 倒计时；两击停止生效 |
| V10 | 模型开一个持久终端并 `send` 命令 | 「终端」列 + 文本流（无输入框）；`kill` 后变已完成；全屏 TUI 退化为文本属预期 |
| V11 | 起子代理 + Agent Team 队友各跑 bash/job | 会话范围多选出现「子代理（蓝点）/队友（琥珀点）」；跨会话 Run 正确归属（agent chip 名字/角色正确）；面板底部有「仅显示有命令行活动的会话」 |
| V12 | 打开一个 blank 会话 | 不显示「终端」tab（R3）；切回有内容会话 tab 仍在（R5 切会话）；刷新页面后保持选中（R5） |

### T6-V4 交互与视觉

| # | 步骤 | 期望 |
|---|---|---|
| V13 | 切换暗/亮主题（D 板 light） | 无生硬色块/对比不足；颜色随主题变化；等宽数字对齐 |
| V14 | 输出区滚轮上翻 → 产生新输出 → 滚回底部 | 上翻暂停并出现「N 条新输出 ↓」，页面骨架不滚；回底自动恢复（不点按钮） |
| V15 | 拖列右缘 / 双击右缘；4+ 列时点右侧 `›` | 实时显示 `NNNpx`、松手切会话再回来宽度保留、双击回 352；`›` 右滚且角标=剩余列数，滚到最右隐藏 |
| V16 | 点列头 ⤢ / 双击列头；Esc/✕ 关闭 | 980×600 只读弹窗、65% 遮罩、可停止/复制全部、独立滚动；不能输入终端 |
| V17 | 已完成项：悬停 10s +、移出再等 10s；收起后让其再输出 | 悬停期间不收起；移出重新完整 10s；收起后新输出自动展开并重新计时 |
| V18 | 类型 chips/会话范围/搜索/自动展开开关/清空已完成（3s 撤销） | 计数全局且与列/行一致；搜索即时过滤并高亮；清空只清命中项且可撤销 |
| V19 | `⋯` 菜单 | 逐项确认；**当前已知缺「在对话中定位」「在终端中打开」**（M1，先记录现状，裁决后复验） |
| V20 | DevTools Console | 无 error；仅首次 404 回退时允许一条 `console.warn` |

### T6-V5 回滚

| # | 步骤 | 期望 |
|---|---|---|
| V21 | `plugin_manager remove_bundle` / 禁用插件 → 刷新 | 标签栏无「终端」；`POST terminal-panel/rpc` 404；插件列表无条目；无「终端」残留样式/监听（Console `getEventListeners(document)` 无相关） |

**留证要求**：每条给「截图 + Console/Network 导出 + 实际环境（DSH 版本 / OS / 亮暗主题）」，回到本报告 §7 把对应 `Unverified` 改为 Pass/Fail。

---

## 11. 未验证项与审计局限

1. 本次审计**无真实 DSH 页面**：所有视觉、指针/键盘、宿主 tab 行为、真实跨会话 jobs/terminals 权限（scout U6）、HMR/安装生效路径（U4/U8）均为 **Unverified**（清单见 §7 汇总 19 项 + §10）。
2. 跨会话真实权限：mock 服务无法证明宿主 owner 围栏放行子代理/队友的 jobs/terminals；需真机 V11 验证。
3. 性能（rAF、>60 行虚拟化、长输出）仅静态抽查，未做真实 Performance 录制。
4. H1 的默认配置触发面基于「超长 command 元信息」推演并已用 store 直插复现；未通过真实 bash 工具链路端到端复现（因无宿主，但元信息路径 `capture-bash → store.serializeRun` 静态确认无截断）。
5. 审计未覆盖宿主升级/回滚后残留、与其他插件（terminal/sidebar）同时使用的冲突。

---

## 12. task-11 交接：bashLive prevention 用例设计（待落地）

现状：`grep -n "bashLive" tests/` → **0 命中**，T5 资产缺该 regression 载体。建议/test 设计与实现一致：

```js
// tests/host/panel.test.mjs（新增，task-11）
test('availability.bashLive.available=false 时 poll 仍返回完整帧且 bash 来源可用（T11 prevention）', async () => {
  // ctx.get('tools') 存在、shell 缺失 → bash 来源可用（final-only），bashLive 不可用
  const services = baseServices({ shell: undefined, tools: {} })
  const { panel, fake } = makePanel(services)
  panel.start?.()   // 注册 tools/execute + tools/result 监听
  // 触发 ghost bash run（tools/execute → 记录；tools/result → 终态）
  const exec = { callId: 'call-live-1', name: 'bash', arguments: { command: 'npm test' }, agent: { id: 'root-1' } }
  await fake.listeners.find((l) => l.event === 'tools/execute').handler(exec, async () => ({ ok: true }))
  const poll = await panel.handleRpc('panel.poll', { sessionId: 'root-1' })
  assert.equal(poll.ok, true, 'bashLive=false 不得让 poll 失败')
  assert.equal(poll.value.availability.bashLive.available, false)
  assert.equal(poll.value.availability.bash.available, true, 'bash 来源（tools 侧 ghost run）仍 available')
  assert.equal(poll.value.runs.length, 1, '应返回 ghost bash run（final-only），而非空帧')
  assert.equal(poll.value.runs[0].outputMode, 'final-only')
})
```

同时 `docs/retro/2026-10-26-bash-live-source.md` 的 P2 需把状态改为已落地、frontmatter `status: open → closed`（task-11 执行）。

---

## 附录 A：探针脚本与关键输出（只读，位于 `/tmp`，未入库）

| 脚本 | 覆盖 | 输出 |
|---|---|---|
| `/tmp/t6-probes.mjs` | a 三级预算 ①–⑥ + Tier3；b removed；c 终态单调+重新展开；d terminal lossy；e 装配 dispose | `10 pass / 0 fail`；Tier2 帧 254334B / Tier3 原样返回 / 40 Run 多轮补齐 / shell 还原 |
| `/tmp/t6-probes2.mjs` | >maxRuns 预算错配量化；路由信封 405/415/413/401；client `<style>`/监听/定时器清理；冻结导出表逐项 | `4 pass / 1 note / 0 fail`（note=M2）；冻结表 0 缺失 |

关键原始输出（摘）：

```
PASS  a1 Tier2 兜底生效：整帧 JSON ≤ min(maxFrameBytes, 262144-2048) — 254334 bytes, runs=15, truncated=true
PASS  a2 Tier3 不可达：已满足 Tier2 上限的帧在 route 层原样返回
PASS  a4 被丢 Run 退回注册表：多轮续读后全部 32 个 Run 至少交付一次
PASS  a5 不变量⑤：Tier3 裁剪时被丢 Run 游标回退/删除
PASS  b removed 立即删除 run/column/droppedLines/游标
PASS  c 终态单调（不回退）与收起后新输出重新展开同时成立
PASS  d terminal：仅 k<0 标 lossy；k===0/k>0 均不标
PASS  e 装配 dispose：路由/监听/shell tee 全部撤销且幂等
NOTE  预算目标/选择集错配（40 running > maxRuns=32）：帧内 32 列，其中有输出 0 列……
PASS  路由信封：405+Allow/415/413/非法 JSON/unknown-method/hello/401 全部符合 §4.1/§4.4
PASS  client 装配 dispose：<style>/监听/定时器/slot 全部清理
PASS  §11.1/§11.2 冻结导出表逐项核对：0 缺失
```

## 附录 B：审计未修改的文件与边界

- 未改：`lib/**`、`package.json`、`cordis.patch.yml`、`docs/architecture/**`、`docs/design/**`、`tests/**`（T6 只写本报告；bashLive 用例在 task-11 单独提交）。
- 唯一发现并修正的测试侧问题（L5）在 `tests/helpers/fakes.mjs`（`ctx.on` disposer 形状），属测试夹具且已随复跑验证 236/236 全绿；不改变生产行为。
