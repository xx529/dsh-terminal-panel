# AGENTS.md · dsh-terminal-panel 项目指引

> 给未来会话 / 其他 agent 的项目级指引。**先读本文件，再读契约**；一切硬性接口以
> [`docs/architecture/contract.md`](docs/architecture/contract.md)（**v6**）为唯一契约来源。
> 本文件只描述仓库现状，不发明未实现的能力。仓库：<https://github.com/xx529/dsh-terminal-panel>

## 1. 项目定位

DSH（DeepSeek Harness）双端插件 `dsh-terminal-panel`（`package.json` version `0.1.0`，`private`）：
在会话头部 View 标签栏新增「终端」tab（`conversation.view`，`id: terminal-panel`，`order: 30`），把
**当前会话 + 子代理 + Agent Team 队友** 的 bash 前台执行、后台任务（`ctx.jobs`）、持久终端（`ctx.terminals`）
输出聚合成**只读**的横向列面板（列/筛选/自动收起/跟随滚动/最大化弹窗）。

- 代码侧已交付（见 §9）；**尚未做真机安装与视觉验收**。
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
│   ├── host/*.mjs                # Host 半端 12 个模块（lib/index.js + 12 = 13 个 host 侧文件）
│   │   ├── panel.mjs             #   插件装配 / poll & kill 调度 / dropStreak
│   │   ├── route.mjs             #   exact HTTP 路由 + 认证 + 错误映射
│   │   ├── store.mjs             #   Run 注册表（选择集/游标/保留窗口/meta 截断）
│   │   ├── frame.mjs             #   帧组装 + Tier1/Tier2 预算与 H1 保底
│   │   ├── cursors.mjs           #   字节增量 / planReads 公平分配
│   │   ├── terminal-window.mjs   #   行坐标增量（computeTerminalDelta 等）
│   │   ├── status.mjs / tree.mjs / classify.mjs
│   │   └── capture-bash.mjs / capture-jobs.mjs / capture-terminals.mjs
│   └── client.js                 # Client 半端单文件 classic script（≈2,795 行；无独立 lib/client 目录）
├── tests/                        # 20 个 *.test.mjs（tests/{client,host,e2e}/ + helpers/）
│   ├── client/                   #   纯函数 + 装配 + 静态样式检查
│   ├── host/                     #   纯模块 + panel 集成
│   └── e2e/smoke.mjs             #   端到端冒烟脚本（可独立运行）
├── scripts/smoke-host.mjs        # Host mock ctx 冒烟（91 checks）
├── docs/
│   ├── design/ui-spec.md         # v4 设计规格（验收基线）
│   ├── architecture/contract.md  # **唯一契约来源（v6）**
│   ├── research/dsh-plugin-apis.md # scout T1 平台取证（事实来源）
│   ├── testing/{acceptance-matrix,report,integration-report}.md
│   ├── retro/2026-10-26-bash-live-source.md
│   └── install.md                # 安装 / 生效 / 验证 / 回滚
└── deploy/                       # 发布+安装脚本目录（deploy/publish-and-install.sh，由发布脚本任务交付）
```

## 3. 常用命令与门禁

```bash
npm run check      # node --check lib/index.js && node --check lib/client.js
npm test           # node --test "tests/**/*.test.mjs" → 255 tests / 255 pass
npm run smoke      # node scripts/smoke-host.mjs → 91/91 checks，exit 0
npm run verify     # check → test → smoke（当前 exit 0）
node tests/e2e/smoke.mjs   # 端到端冒烟（独立脚本，exit 0）
```

**门禁：任何改动后必须跑 `npm run verify` 并通过（exit 0）。** 不依赖网络、不装依赖。
当前基线：**255 tests / 255 pass / 0 fail / 0 skip / 0 todo；smoke 91/91；`npm run verify` exit 0**。

## 4. 硬约束（摘自 contract v6，违反即缺陷）

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

## 5. 已知限制（已裁决，不要当 bug 修）

1. **Tab 无角标**：内建 tab 渲染只读 `label`，无 badge API；运行中计数放面板工具栏（contract §12.1）。
2. **持久终端是文本流，不是 xterm 屏幕帧**：平台表无 xterm + 禁装依赖；全屏 TUI 会退化为文本流（§12.2）。
3. **前台 bash 只有终态输出（final-only）**：拿不到 `ShellExecution` 句柄；该类 Run 标「仅终态」、停止禁用（§12.7）。
4. **`⋯` 菜单仅 3 项**：ui-spec §3.7 的「在对话中定位」「在终端中打开（仅终端）」**本期不做**，替代 = 复制命令/复制输出/固定展开（§12.8）。
5. **跨会话聚合待真机验证**（scout U6）；失败时按来源降级（chip 置灰 + 原因），不影响面板主体。

## 6. 安装与发布

- 官方安装路径（plugin_manager `install_bundle`、生效/验证/回滚）：[`docs/install.md`](docs/install.md)。
- 一键发布 + 安装脚本：`deploy/publish-and-install.sh`（push 到 GitHub + 安装进 DSH profile；支持 `--dry-run`、`--rollback`、`--no-push`、`--no-install` 等；脚本由发布任务交付，若目录尚未生成以 `docs/install.md` 为准）。
- 生效事实：配置层/启停可 live reload；**替换已安装包代码需重启 DSH 桌面版 + 刷新页面**（contract §0 / install.md §2）。

## 7. 文档索引

| 文档 | 用途 |
|---|---|
| [`docs/design/ui-spec.md`](docs/design/ui-spec.md) | v4 设计规格（验收基线，A–F 六板） |
| [`docs/architecture/contract.md`](docs/architecture/contract.md) | **唯一契约来源（v6）**：集成/传输/数据模型/状态机/预算/冻结表/裁决 |
| [`docs/research/dsh-plugin-apis.md`](docs/research/dsh-plugin-apis.md) | scout T1 平台取证（FACT/INF/ASSUMPTION 事实来源） |
| [`docs/testing/acceptance-matrix.md`](docs/testing/acceptance-matrix.md) | 验收矩阵（ui-spec ↔ 用例） |
| [`docs/testing/report.md`](docs/testing/report.md) | 测试报告（T5 基线 236，当前累计 255） |
| [`docs/testing/integration-report.md`](docs/testing/integration-report.md) | T6 集成审计（H1/M2 已修，§10 真机清单） |
| [`docs/retro/2026-10-26-bash-live-source.md`](docs/retro/2026-10-26-bash-live-source.md) | T4 触发复盘（closed） |
| [`docs/install.md`](docs/install.md) | 安装/生效/验证/回滚（证据版） |

## 8. 协作约定

- 分支：`main`（发布前不要自行改分支名/强推）。
- 提交信息类型：`feat:` / `fix:` / `test:` / `docs:` / `chore:`（必要时 `feat(deploy):` 这类 scope）。
- **改动前先读契约**（`docs/architecture/contract.md`，尤其 §4/§11/§12）；实现与契约冲突先停下确认，不要静默改行为。
- **契约变更**：必须同步 §0「版本与变更记录」（当前 v6），并说明触发方（Lead 裁决/审计/实现偏差）。
- **测试不得「顺手改绿」**：禁止为了让用例通过而放宽断言或改 `tests/**` 的期望值；实现错就修实现，用例错需先说明理由并获批准。
- 冻结表改动需 maintainer 批准；低风险文案/像素级差异见 contract §12.10（L1–L5）。
- 文档写作用域各归其主（architect=契约/docs；backend=lib/host；frontend=lib/client.js；tester=tests/docs/testing；devops=deploy），改动不要越界。

## 9. 验收基线

- **代码侧已交付**：`255 tests / 255 pass / 0 fail / 0 skip / 0 todo`；`smoke 91/91`；`npm run verify` exit 0（2026-10-26，HEAD 以 `git log` 为准）。
- **真机待验收**：ui-spec 有 **19 项 Unverified**（视觉/像素、指针/键盘交互、宿主集成行为、平台限制项、网络/权限异常、性能等），清单与步骤见 `docs/testing/integration-report.md` §10 与 `docs/install.md` §3。
- **不得宣称已真机验收**，除非逐项执行并留下证据（截图/Console/Network 记录）。
- 发布前最小集合（集成报告 §9）：H1/M2 已修；真机 19 项 + `docs/retro` P2 已关闭；新增回归不得让 `npm run verify` 回退。
