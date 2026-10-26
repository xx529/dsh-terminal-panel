# T51 取证 v10：网格重排闪烁根因 + 统一卡宽方案 + 粗边框实现

> 角色：scout（只读取证）。仓库 `/Users/lzx/Documents/GitHub/dsh-terminal-panel`，`HEAD=6bf33ef`（v9，工作树 clean，`lib/client.js` 3610 行）。
> 标注：**FACT** = 代码位置/可复现推理；**INFERENCE** = 由 FACT 推导；**ASSUMPTION** = 未真机验证 + 验证方式。
> 行号为本次快照，frontend（T52）并行改 `lib/client.js` 时可能漂移。

---

## 0. 结论速览

| 用户反馈 | 结论 |
|---|---|
| ① 黄/绿边框不够粗 | 现在 `.tp-col` 1px（`client.js:299`）+ 状态色 mix 55%/50%（`:326-329`）、`.tp-row` 1px 绿 mix 45%（`:368`）。**可无损加粗**：`border:2px`（border-box 下不改变外框尺寸，内容少 2px）+ hover/focus 用 `inset box-shadow` 加 1px 视觉。见 §C。 |
| ② 单卡被拉长铺满 | 根因是 `.tp-cell{flex:1 1 var(--tp-card-w,352px)}`（`:297`）**flex-grow:1**：行里只有 1 个 item 时它吃掉整行；内层 `.tp-col{width:100%}`（`:299`）随之铺满。用户要的「等宽 + 铺满 + 单卡不拉长」用 **CSS Grid `repeat(auto-fill, minmax(min(100%,var(--tp-card-w)),1fr))`** 可满足（有边界情况，见 §B）。 |
| ③ 收起后重排闪烁「像整页刷新」 | **不是 remount**（key=runId 稳定）。主因：**退场 ghost 在 passive `useEffect` 里晚一帧才挂上**，同一移除动作被拆成两次相反方向的重排；第二次 ghost-insert 因 signature 不含 exiting 而**没有 FLIP**，于是「平滑左移 → 瞬移回右 → 180ms 后 ghost 移除再 FLIP」= 闪烁。见 §A。 |

---

## A. 闪烁真因：按优先级排序（重点）

### A.0 现有实现（FACT 行号）

| 机制 | 位置 |
|---|---|
| 退场状态 `exiting` | `lib/client.js:2967` |
| FLIP layout effect（无 deps，每次 commit 都跑） | `:2984-3018` |
| 只测量 `activeIds` | `:2988-2995` |
| `shouldAnimate = pendingFlipRef && !dragRef && !reducedMotion` | `:2996` |
| 先把 transform 设回旧位、再 rAF 过渡到 0 | `:2999-3014` |
| `gridSignature = activeKey + '#' + gridWidth`；变化时**在 render 里** `pendingFlipRef=true` | `:3104-3107` |
| 退场检测（`React.useEffect`，deps `[activeKey]`） | `:3109-3145` |
| ghost 插入 `setExiting`（passive） | `:3123-3127` |
| 每张退场卡一个定时器；到点 `pendingFlipRef=true` + `setExiting(filter)` | `:3128-3137` |
| `gridItems`：active（新 index）+ exiting（`entry.index - 0.5`），再按 index 排序 | `:3156-3163` |
| cells `key: item.id`（=runId，稳定） | `:3422`（`gridItems.map` 内 `key: item.id`） |
| ghost 不登记 `registerCard`（不参与 FLIP 测量） | `:3425` |
| `data-tp-fresh` 入场（仅首次挂载播放，animationend→played） | `:2102-2113`、CSS `:298` |
| grid 宽度 ResizeObserver | `:3366-3380` |
| `--tp-card-w` + inline `flexBasis` | `:2452` |
| 退场动画 CSS `tp-col-exit` / `tp-card-out` | `:330-332` |
| 常量 `CARD_EXIT_MS=180`、`FLIP_MS=200` | `:2138-2139` |

### A.1 主因 P0：退场 ghost 晚一帧挂载 ⇒ 同一移除被拆成两次**反向**重排，且第二次没有 FLIP

逐帧时间线（FACT 推导，均为同步代码路径）：

1. 触发移除（用户点「收起」/ linger 到点 / poll `removed`）。**Render R1**：`activeIds` 已不含 X；`gridSignature` 变化 → `pendingFlipRef=true`（`:3104-3107`）；此时 `exiting` 还是空数组（`setExiting` 尚未跑），`gridItems` 只有 active（`:3156-3159`）。
2. **Commit R1**：DOM 删除 X，其余卡**立即左移一格**。
3. **useLayoutEffect（FLIP，`:2984-3018`）**：`prevRectsRef` 是上一 commit（X 还在）的位置；`next` 是左移后位置 → 对每张存活卡设 `translate(dx,dy)` 再 rAF 归零 → 视觉上「平滑左移」。**这一步没问题**。
4. **paint R1**：用户看到卡开始向左滑。
5. **passive effect（`:3109-3145`）** 才 `setExiting([X])`（`:3123`）→ **Render R2**：`gridItems` 把 ghost 用 `index: entry.index - 0.5` 插回 X 原来的槽位（`:3161`）→ DOM 里其余卡**又被推回右边**。
6. **Commit R2 的 FLIP**：`gridSignature`（`activeKey + '#' + gridWidth`）**没有变化**（exiting 不在 signature 里），`pendingFlipRef` 已在 R1 被消费为 false ⇒ `shouldAnimate=false`（`:2996`）⇒ **无 FLIP**，其余卡瞬移回右。
7. 180ms 后定时器（`:3128-3137`）先 `pendingFlipRef=true` 再移除 ghost → Render R3 卡再左移，这一次有 FLIP。

⇒ 用户感知：**卡先平滑左移 → 突然弹回右 → 再平移/落下**，且 250ms poll 每次新增移除都会重放（linger→completed、job `removed`、prune 周期），观感即「像整页刷新」。
**注**：任务描述里「ghost 被追加到数组末尾」是 `push` 的动作，但紧接着 `:3162` 按 index 排序，所以 ghost **不是**排在末尾，而是插在原槽位——问题不在追加，而在**晚一帧**。

### A.2 P1：FLIP 只测 active、ghost 不登记 ⇒ 多 ghost / 换行时 delta 失真

- 测量集合只有 `activeIds`（`:2988-2995`），ghost 被排除；`registerCard` 对 ghost 传 `undefined`（`:3425`）⇒ `cardsRef` 里没有 ghost 元素。
- 后果：① ghost 插入/移除这一 commit 里，active 卡的 `prevRects` 与真实 DOM 布局代际不一致；② 同一帧移除多张（如清空/多 job 同时完成）时多个 ghost 共用 `index-0.5`（`:3161`），排序稳定性依赖插入顺序，可能出现 ghost 互相挤位；③ 换行（grid width 变化）与 ghost 同时发生时 delta 错。
- 修复：测量集合改为 `gridItems.map(i => i.id)`；ghost 也 `registerCard`；signature 加上 exiting id 列表。

### A.3 P2：`pendingFlip` 在 render 里写 ref + `gridWidth` 进 signature ⇒ 动画误触发

- `:3105-3107` 在 **render 阶段**修改 `pendingFlipRef.current`（React 不禁止写 ref，但并发渲染/StrictMode 双渲染/被丢弃的渲染都会留下 arm 状态）→ 后续一次无关 render 会播放 FLIP。
- `gridSignature` 含 `gridWidth`（`:3104`），而 `gridWidth` 来自 ResizeObserver（`:3366-3380`，`clientWidth`）：**纵向滚动条出现/消失**、面板 resize、甚至空态切换都会让 `clientWidth` 变 1~6px，从而 arm FLIP ⇒ 「没点任何东西，卡片自己动」。
- 修复：arm 移到 `useLayoutEffect` 里比较签名（`if (sig !== last) { pendingFlip=true }`）；signature 用 `activeKey + '|' + exitingKey`（结构变化），`gridWidth` 单独处理或去掉（换行时 activeKey 不变但位置变——需要保留 width 触发，但建议加「仅当宽度差 > 2px 才 arm」防滚动条抖动）。

### A.4 P3：`data-tp-fresh` 入场动画只在「元素重建」时重放；当前唯一重建来源是 duplicate key

- `useFreshFlag`（`:2102-2113`）：首次遇到元素时设 `data-tp-fresh='playing'`，`animationend` 后改 `'played'`；之后即使重排也不重放。
- cells `key: item.id`（runId，`:3422`）稳定 → 普通重排**不会**remount、**不会**重放。
- **但是**：若某 run 在 ghost 未结束时又被 poll 重新加回（v8 已知的 job prune→re-add 振荡、或 `resync`），`gridItems` 会同时出现 active 的 id 与 ghost 的同一 id（`:3158` 与 `:3161`）→ **React 重复 key** → 元素被复用/重建，fresh fade-in 重放 + 闪烁。
- 修复：`gridItems = active + exiting.filter(e => !activeIds.includes(e.id))`（active 优先）。

### A.5 P4：不存在「key 变化导致整块 remount」（回答 ⑤）

- 网格用 `key: item.id`（`:3422`），不是数组 index；React 只做节点移动。**所以「像整页刷新」不是 remount**，而是 A.1 的两次反向重排；唯一会 remount 的是 A.4 的 duplicate key 场景。

### A.6 P5：定时器/多 ghost 管理

- 每张退场卡一个 `setTimeout`（`:3128-3137`），`exitTimersRef` 只在卸载时统一清（`:3009-3013`）；同一 id 短时间反复移除/加回会重复建表项（有 `clearTimeout` 但 map 覆盖）。
- 建议：同帧移除 >2 张直接跳过 fade（比多 ghost 更稳）；`setExiting` 用函数式合并（现有已 concat 去重，`:3123-3126`）。

### A.7 修复方案（给 frontend，按风险从低到高）

| 方案 | 做法 | 风险 |
|---|---|---|
| **S1（推荐，最小）** | **删掉 ghost fade，只保留 FLIP**：移除卡直接卸载，邻居由 FLIP 平滑补位（transform 200ms）。删/短路 `exiting`（`:2967`）、退场 effect（`:3109-3145`）、`gridItems` ghost 分支（`:3160-3162`）、`.tp-col-exit`（`:330-332`）。 | 失去「被移除卡的淡出」，但用户诉求是「网格平滑挪动」，FLIP 已满足；无二次重排 |
| S2 | 保留 fade：**在 render 期同步算 ghosts**（从 `previousActiveRef` 派生 `removedIds`，直接进 `gridItems`），`setExiting` 只用于驱动 180ms 后的移除；ghost 也 registerCard；signature 含 exitingKey | 改动较大，要小心 render 期读 ref 的 StrictMode 语义 |
| S3 | 保留现结构，把 `setExiting` 从 `useEffect` 移到 **`useLayoutEffect`**（paint 前完成第二次 commit），并在 R2 也 arm FLIP | 仍是两次 commit，需处理 R1 FLIP transform 与 R2 布局叠加，仍有轻微抖 |

**验证方法（同一份代码可复现）**：DevTools Performance 录制中点击一次「收起」：理想只有 1 次 layout shift；若看到 2 次（t0 与 t0+~1 frame 或 +180ms）即 P0 未修。也可临时加 `console.count('flipArm')` 于 `:3107`、`console.count('ghostMount')` 于 `:3123`：一次移除命中 flipArm=2 即证实 A.1。

---

## B. 统一卡宽 + 网格铺满（CSS Grid 方案）

### B.1 目标拆解（三个诉求的冲突点）

用户要：①所有卡**统一宽度**；②**整个网格铺满**容器；③**单卡不要拉长**。

- 若「铺满」= 卡片铺满整行（列宽随容器均分）：「单卡不拉长」在**容器只能放 1 列时不可兼得**（那一列必然占满整行）。
- 若「铺满」= 面板区域被利用、右侧不留大片空白：用 `auto-fill` 预留空 track 可做到「单卡只占 1 列宽」。

### B.2 推荐公式（满足 ①+③，②在 ≥2 列时满足）

```css
.tp-strip-track{
  display:grid;
  grid-template-columns:repeat(auto-fill, minmax(min(100%, var(--tp-card-w, 352px)), 1fr));
  gap:12px;
  align-content:start;
  align-items:start;
  box-sizing:border-box;
  min-height:0;
}
.tp-cell{ display:flex; min-width:0; max-width:100%; height:342px; box-sizing:border-box }
.tp-col{ width:100%; height:342px; max-height:100% }
```

- **等宽**：所有 track 是 `1fr`（等分剩余空间）⇒ 每张卡宽度 = 同一 track 宽（同一行/跨行都一致）。
- **铺满**：`1fr` 吃掉全部剩余空间 ⇒ 每行右边缘与容器对齐。
- **单卡不拉长**：`auto-fill` **保留空 track**（与 `auto-fit` 相反，`auto-fit` 会把空 track 折叠 → 单卡被拉满整行，**不能用**）。单卡只占 1 个 track。
- **边界（ASSUMPTION 需真机验）**：容器内容宽 < `2*min+gap` 时 `auto-fill` 只能生成 1 个 track → 1fr 填满容器 = 单卡被拉长。按 min=352、gap=12：内容宽 <716px 时单卡仍会被拉长（这是「铺满」的必然结果）。若用户坚持「任何情况下单卡 ≤352 且不拉长」，只能改成**固定 track**（`repeat(auto-fill, var(--tp-card-w))`）+ `justify-content:start`，代价是右侧留白（不铺满）——需要 Lead/设计裁决（见 §B.5）。
- 容器 < 352 时 `min(100%, 352px)` 让 min 变 100% → 单列不横向溢出 ✓。
- 与 `auto-fit` 的区分必须写进注释，避免后人改成 auto-fit 导致单卡铺满。

### B.3 迁移清单（文件:行，当前快照）

| 位置 | 现状 | 迁移 |
|---|---|---|
| `:292` `.tp-strip-track{display:flex;flex-wrap:wrap;...gap:12px}` | flex wrap | → `display:grid; grid-template-columns:repeat(auto-fill, minmax(min(100%,var(--tp-card-w,352px)),1fr)); gap:12px; align-content:start` |
| `:297` `.tp-cell{display:flex;flex:1 1 var(--tp-card-w,352px);min-width:min(280px,100%);max-width:100%;height:342px;...}` | flex item + grow | 删 `flex:1 1`/`min-width:min(280px,100%)`（track 已决定宽度）；保留 `min-width:0; max-width:100%; height:342px; display:flex` |
| `:299` `.tp-col{...width:100%;...}` | 100% of flex cell | 保留（grid item 内 100%） |
| `:2452` inline `style:{'--tp-card-w':width+'px', flexBasis:width+'px'}` | 每卡宽度写 inline | 删 `flexBasis`（grid 忽略）；`--tp-card-w` 若做**统一宽度**应改写到 **track 容器**（`.tp-strip-track` style）或 `:root`/panel 根，不再每卡写 |
| `:489` `clampColumnWidth`、`:934-945` `createColumnState.width`、`:1442` `widthPrefsFor`、`:3287-3326` `beginResize/resetWidth` 用 `column.width` | 每列独立宽度 | 统一宽度后：拖拽改为写**会话级基准宽**（`widthPrefsFor(sessionId).defaultWidth`），Clamp 仍 280–640；`column.width` 可保留为「该卡基宽」但不再用于布局（或删除相关读写） |
| `:3104` `gridSignature = activeKey + '#' + gridWidth` | 宽度变化触发 FLIP | 保留 `gridWidth` 或改用 `ResizeObserver` 的 row-break 判定；若 grid 原生换行，仍需 FLIP 感知换行 → 保留 |
| `:3366-3380` ResizeObserver | 读 `clientWidth` | 可保留（FLIP/记录用），但不再需要「计算列数」 |
| `:2550` `tp-drag-badge`、`:3425` inline 宽度 | 拖拽 UI | 若改为统一宽度：拖任一卡的右缘 = 调整所有卡宽度（badge 仍显示 px）；UI 文案/交互需同步（ui-spec） |

**拖拽语义（重要决策）**：grid 的 track 宽度是全列统一的，**无法**保留「每卡独立拖宽」。二选一：
1. **统一列宽（推荐，符合用户「所有卡统一宽度」）**：拖任意卡 = 改会话级 `defaultWidth`，全网格同步；`column.width` 退化为兼容字段。
2. 保留每卡独立宽度 ⇒ 只能继续用 flex（`.tp-cell{flex:0 0 var(--tp-card-w)}` 无 grow），代价是「行尾留白、不铺满」，与 ②冲突。
建议 1，并让 T52 与 Lead 确认后同步 contract §9.2/ui-spec。

### B.4 备选（若要零改动最小化）

只把 `:297` 的 `flex:1 1 var(...)` 改成 **`flex:0 0 var(--tp-card-w)`**：单卡不再拉长，但行尾留白（不铺满）。可作为 v10 热修，再把 grid 作为 v11。**不建议**同时保留 grow 与「单卡不拉长」——物理矛盾。

### B.5 需 Lead 裁决

- 「铺满」的语义：**行内均分拉伸（列宽可变、≥基宽）** vs **固定卡宽 + 右侧留白**。前者用 `auto-fill + 1fr`，后者用固定 track。二者不能同时满足「任何容器下单卡不拉长」。
- 拖拽是否接受「统一列宽」（B.3-1）。

---

## C. 更粗边框且不抖动

### C.1 现状（FACT）

- `.tp-col`：`box-sizing:border-box`、`height:342px`、`border:1px solid var(--dsw-alias-border-l1)`（`:299`）；状态色由 `data-phase` 覆盖 `border-color`（`:326-329`：running=warn 55%，linger/completed=success 50%，hover 85%）。
- `.tp-row`：`box-sizing:border-box`、`height:32px`、`border:1px solid color-mix(success 45%, border-l1)`（`:368`）。
- `.tp-cell`：`height:342px; box-sizing:border-box`（`:297`）。
- 已存在 hover/focus 规则只改 `border-color`，不改宽度/尺寸（`:328-329`）。

### C.2 方案（推荐 2px 固定宽 + hover 内描边）

```css
/* 基础：2px 固定宽（border-box，外框尺寸不变，内容少 2px） */
.tp-col{ border:2px solid color-mix(in srgb, var(--dsw-alias-border-l2) 100%, transparent) }
.tp-col[data-phase='running']{ border-color:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 65%, var(--dsw-alias-border-l1)) }
.tp-col[data-phase='linger'],.tp-col[data-phase='completed']{ border-color:color-mix(in srgb, var(--dsw-alias-state-success-primary) 60%, var(--dsw-alias-border-l1)) }
/* hover/focus：只加内描边，视觉 3px，不改盒尺寸 */
.tp-col[data-phase='running']:hover,.tp-col[data-phase='running']:focus-within{
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-state-warn-primary) 85%, transparent);
}
/* 行同理：32px 固定高 + border-box，2px 不撑破（内容少 2px） */
.tp-row{ border-width:2px }
```

- **尺寸核对（FACT）**：`.tp-col`/`.tp-row`/`.tp-cell` 均 `box-sizing:border-box` 且高度固定（342/32/342）⇒ 边框 1→2px **不会改变外框**，只让内部内容区少 2px（`.tp-col` 内 head 30 + cmd 24 + out flex 1 → out 少 2px；`.tp-row` 内容垂直少 2px，行内都是 10~11px 单行文本 + 24px 菜单按钮，不会溢出）。**不会撑破**；若担心 `.tp-col-head`（30px 固定）与 2px 边框挤，建议 head 用 `flex:0 0 30px` 不变即可。
- hover 用 `inset box-shadow`：不参与 layout，不会因 hover 触发重排；`box-shadow` 也不影响 FLIP 的 `getBoundingClientRect`（transform 不变）。
- 可选 3px：`border:2px` + 常驻 `inset 0 0 0 1px` 同色（视觉 3px，仍不改尺寸）；不建议 `border-width` 3px 直接加（内容再少 2px，且 `.tp-row` 32px 内 2px 上下边距更紧）。
- **明暗主题可读性**：
  - 混色基准用 `--dsw-alias-border-l1`（暗色下比 l2 更暗，2px 更「实」）；亮色下 border-l1 偏浅灰，用 60–65% 状态色保证可见。
  - 建议 running：warn 65% + border-l1 35%；completed/linger：success 60% + border-l1 40%；hover 内描边 85% 状态色（不再 mix border）→ 两层叠加 ≈3px 厚度，亮/暗都清晰。
  - 已完成行（绿）：`.tp-row` 45%→`60–65%` + 2px，与卡片视觉一致；失败行（红）同理用 error 65%（当前 `.tp-row-failed` 是 `border-color: error 40%`，建议同步加粗到 60%+2px）。
  - 若某主题 `state-success-primary` 过亮（亮色下偏荧光），把 mix 的第二色换成 `--dsw-alias-label-secondary`（暗/亮都中性的前景色）而不是 border-l1，以降低饱和。
- `prefers-reduced-motion` 不受影响（边框是静态样式）。

---

## D. 事实索引

| 结论 | 位置 |
|---|---|
| `gridItems` 拼接 + 排序 + ghost 槽位 | `lib/client.js:3156-3163` |
| 退场检测在 passive effect | `:3109-3145`（`setExiting` `:3123`） |
| FLIP layout effect 只测 active、消费 pendingFlip | `:2984-3018` |
| signature 在 render 置 pendingFlip、含 gridWidth | `:3104-3107` |
| 退场定时器到点 arm + 移除 | `:3128-3137` |
| cells key=runId、ghost 不 registerCard | `:3422`、`:3425` |
| fresh 标记只首挂播放 | `:2102-2113` |
| `.tp-cell` flex grow（单卡拉长根因） | `:297` |
| 每卡 inline `--tp-card-w/flexBasis` | `:2452` |
| 拖拽/宽度状态 | `:489,934-945,1442,3287-3326` |
| 边框现状（1px/状态 mix） | `:299,326-329,368` |
| reduces-motion / 常量 | `:2165,2138-2139` |
| 退场 CSS | `:330-332` |

## E. 未查清项

| # | 未查清 | 影响 | 验证方式 |
|---|---|---|---|
| U1 | 真机是否确为 A.1 的双重 layout shift（而非页面级重绘/滚动条变化） | 决定 S1 是否足够 | DevTools Performance 点一次「收起」，数 layout shift 次数；或加 `console.count('flipArm')`（`:3107`）与 `console.count('ghostMount')`（`:3123`） |
| U2 | 用户「铺满」的准确语义（均分拉伸 vs 固定宽留白）+ 是否接受「统一列宽拖拽」 | 决定 B.2 vs B.4、以及是否要改 contract §9.2/ui-spec | 需 Lead/设计裁决；可用两张静态示意让用户选 |
| U3 | 容器 <716px 时单卡被拉长是否为可接受边界 | 影响验收口径 | 真机把面板拖窄至 <716 观察；或窗口分屏 |
| U4 | 2px 边框在「最大/最小列宽 280/640」与 342 固定高下内容是否被挤压（尤其 `.tp-col-head` 30px 内元素） | 视觉验收 | 真机截图对照；`document.querySelector('.tp-col').clientHeight` 应为 342 |
| U5 | `gridWidth` 变化中「滚动条出现/消失」导致的 FLIP 误触发幅度 | 影响 P2 修法（阈值 2px 是否够） | 真机滚动出现/消失时录 Performance，或临时 log `gridWidth` 变化序列 |
