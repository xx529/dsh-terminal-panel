# 安装 · 生效 · 验证 · 回滚（dsh-terminal-panel v2）

> 状态：**v2（证据版）** — 安装/生效/回滚步骤已按 scout T1 结论升级为 `[FACT]`；仅剩少数需真机安装后才可确认的点标 `[ASSUMPTION]` 并附验证方式。
> 证据来源：`docs/research/dsh-plugin-apis.md` §1/§8/§12、asar 内 `dsh-plugin-manager/README.zh.md`、`dsh-client-hmr/README.zh.md`、`@deepseek-ai/dsh/README.zh.md`、skill `cordis-plugin-development`。
> 标签：`[FACT]` 有可核对证据 / `[INF]` 推导 / `[ASSUMPTION]` 待验证。

## 0. 前置条件

| 项 | 要求 | 依据 |
|---|---|---|
| DSH 版本 | `>= 0.2.1-rc.2 < 0.3.0`（本机 0.2.1-rc.2） | 本文件与 `package.json` `engines.dsh` 一致；asar:`dsh/node_modules/@deepseek-ai/dsh/package.json` `[FACT]` |
| Node | `^22.19.0 \|\| >=24.0.0`（本机 v22.22.2） | `package.json` `engines.node`；scout §7 `[FACT]` |
| profile | 桌面版 profile 名 `desktop`（`~/.dsh/profiles/desktop`），`patchReload: "live"` | `~/.dsh/profiles/desktop/package.json`；scout §1.3 `[FACT]` |
| 代码就位 | `lib/index.js`（T3）与 `lib/client.js`（T4）必须已落地；缺任一则激活失败 | `package.json` `exports` `[INF]` |
| 依赖 | **无**。不装依赖、无构建步骤（`lib/client.js` 是手写自包含 bundle） | 任务约束 + contract §1.3 `[FACT]` |
| 元数据 | `icon.svg`、`locale/{zh,en}.json` 已随包交付（v2 新增） | `package.json` `exports`/`files` `[FACT]` |

安装前自检（一次性）：

```bash
cd /Users/lzx/Documents/GitHub/dsh-terminal-panel
node --check lib/index.js && node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('manifest ok')"
node -e "for (const p of ['icon.svg','locale/zh.json','locale/en.json']) require('fs').accessSync(p)"
ls lib/index.js lib/client.js cordis.patch.yml icon.svg
```

## 1. 安装（`plugin_manager` 的 `install_bundle`）

### 1.1 正规路径（`[FACT]`）

**不要手工改 profile 的 `package.json` / `cordis.patch.yml`，也不要手工在 profile 里 `pnpm install`**：
`install_bundle` 会代做包安装与 bundle 选择，并发布运行时解析。`[FACT]` scout §8.1；`dsh-plugin-manager/README.zh.md:52,60,98-102`；skill `cordis-plugin-development`。

由 Lead（或被授权的 teammate）执行：

1. `plugin_manager({ action: 'install_bundle', target: '/Users/lzx/Documents/GitHub/dsh-terminal-panel' })`
   - `target` = **绝对包目录**；本地目录安装会写 profile `package.json` 的 `link:` 依赖（**开发目标保留普通 `link:`**），选入 `dsh.profile.bundles`，并跑 pnpm。`[FACT]`
   - registry 目标会用 `saveExact: true`（本插件走本地目录，不涉及）。
2. 读返回值（`ChangeResult`，`[FACT]` scout §8.1）：

```ts
interface ChangeResult {
  changed: boolean
  application: 'applied' | 'restart-required' | 'overridden' | 'failed' | 'cancelled'
  restartReason?: 'no-hmr' | 'package-moved' | 'host-module' | 'unmanaged-plugin' | 'module-comparison'
  stage: 'install' | 'enable' | 'remove'
  target: string; enabled?: boolean; error?: ManagementError; warnings?: string[]
  packageResult?: PackageResult; bundle?: string; version?: string
  pendingBuilds?: string[]; approvedBuilds?: string[]; registries?: Registry[]
  failedAt?: 'registry' | 'spec-host'
}
```

   - **`application` 是唯一生效判据**（不是日志、不是进程列表）：`applied` = 已在当前运行组合里挂上。
   - `restart-required` → 看 `restartReason`，重启 DSH 桌面版。
   - `overridden` → 被更高优先级 patch 层覆盖（检查 profile `cordis.patch.yml` 是否有同名 id 或 patch 顺序）。
   - `failed` → 看 `error`；插件文件修好后下一次操作会重新导入（**已装成功后再激活失败不撤销安装** `[FACT]`）。
   - `cancelled` → 用户取消，重试即可。
   - `pendingBuilds` 非空 = pnpm 11 拦下依赖构建脚本：**只有用户明确批准**后才带 `approvedBuilds` 重试；本插件无构建脚本，正常应为空。
   - 安装失败会恢复 profile `package.json` + `pnpm-lock.yaml` `[FACT]`。
3. 安装成功但 Client bundle 未生效时，**刷新页面**（见 §2）。

### 1.2 备选路径（不推荐，`[ASSUMPTION]`，需用户明确同意）

仅在 `install_bundle` 不可用时考虑。等价于它做的事：profile `package.json` 的 `dependencies` 加 `"dsh-terminal-panel": "link:/Users/lzx/Documents/GitHub/dsh-terminal-panel"`、`dsh.profile.bundles` 追加 `"dsh-terminal-panel"`，然后在 profile 目录跑 `pnpm install` 并重启。`[ASSUMPTION]`（未实测）；手工操作前先备份 profile 两个文件。**优先让 `plugin_manager` 做**；若确需手工路径，优先用 §1.3 的脚本（自带备份/超时/回滚），而不是纯手敲命令。

### 1.3 一键脚本（`deploy/publish-and-install.sh`，可选）

`deploy/publish-and-install.sh` 把「推送 + 安装 + 回滚」封装成一条命令，**安装阶段的所有 `dsh plugin` / `pnpm` 调用都带超时保护**：

```bash
./deploy/publish-and-install.sh --dry-run                # 只打印将执行的命令与变更摘要（不改任何文件、不推送、不安装）
./deploy/publish-and-install.sh --timeout 300            # 放宽超时到 300s（默认 120s）
./deploy/publish-and-install.sh --no-push                # 只安装，不推送
./deploy/publish-and-install.sh --rollback               # 回滚最近一次安装（恢复备份 + 从 bundles 移除 + 重装清理）
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `--timeout <秒>` / `--timeout=<秒>` | **120** | 覆盖 `dsh plugin --profile … add link:`、`dsh plugin install`（离线/联网）、`pnpm install`（离线/联网）的超时；**范围 10–3600**（越界 exit 2）；**超时统一 exit 6** |
| `--dry-run` | off | 只打印计划，不改文件/不推送/不安装（排查挂起首选） |
| `--no-push` / `--no-install` | off | 只装 / 只推 |
| `--rollback` | off | 恢复最近一次 profile 备份并从 `dsh.profile.bundles` 移除插件（幂等） |
| `--skip-tests` | off | 跳过 `npm run verify`（仅限 CI 已跑过时使用） |
| `--yes` | off | 允许「兼容回退路径」（无 `dsh` CLI 或 CLI 安装失败时手工改写 profile） |

超时实现（三路降级）：GNU `timeout` → `gtimeout` → `perl -e 'alarm shift; exec @ARGV'` → 无保护降级（会打印 warning）。GNU rc=124 与 perl SIGALRM rc=142 归一为 124，脚本**明确报错而不静默等待**，最终以 **exit 6** 结束并提示可用 `--timeout` 放宽。

> 已知副作用：本机没有 GNU `timeout`、由 perl alarm 终止子进程时，shell 可能打印一行 **`Alarm clock: 14`** —— 这是正常的超时终止提示，不是脚本错误。
>
> 排障：**pnpm 安装长时间无输出/疑似挂起**时，先 `--dry-run` 看计划，再用 `--timeout <秒>`（如 300）重跑；脚本会优先离线（`pnpm install --offline`），失败才走联网并受同一超时保护。不要 Ctrl-C 后手工补齐，按 §5 处理。

### 1.4 发布前检查清单（`--dry-run` 回归）

> prevention 载体（来源复盘：`docs/retro/2026-10-26-install-pnpm-hang-and-teammate-failure.md`，task-23）。**每次发布前逐项执行并保留输出**（贴进发布回执/任务板），不依赖 `npm run verify` 单独覆盖安装期风险。

- [ ] **门禁**：`npm run verify` exit 0（记录 tests/smoke 数字）
- [ ] **计划**：`./deploy/publish-and-install.sh --dry-run` 输出计划；确认安装阶段**离线优先**、`--timeout` 默认 120s 生效、无「联网 pnpm 无保护」路径
- [ ] **超时保护**：实际安装（可用 `--no-push`）时观察超时保护；预期超时 **exit 6**，不得静默挂起（perl 降级出现 `Alarm clock: 14` 属正常）
- [ ] **路由验证**：安装后按 §3.1.1 用页面内 fetch 验证 `200 {"ok":true,"value":{"protocol":1,…}}`（非 405）
- [ ] **留证**：把 dry-run 输出、verify 数字、安装退出码贴进发布回执

## 2. 生效矩阵（`[FACT]`，scout §8.2）

| 变更类型 | 是否免重启 | 依据 |
|---|---|---|
| 配置层（patch/config） | ✅ 即时（本 profile `patchReload: "live"` + `hmr` 服务在跑） | `@deepseek-ai/dsh/README.zh.md:37`；profile `package.json` |
| 启用/停用插件行（`set_plugin` / `set_bundle`） | ✅ 即时（普通插件启停无需刷新页面或重启 Host） | asar:`dsh-client-hmr/README.zh.md`「概述」 |
| **替换已安装包的代码**（同 spec 新版本） | ❌ **需要重启 DSH**；HMR 模式下要先卸载再安装，旧版本先停 | asar:`dsh-plugin-manager/README.zh.md:100,141` |
| 客户端 bundle 重建 | 仅当有 bundle watcher（`pnpm run dev:web`）时页面级热替换（`rebuilt` 帧→换模块→重挂），**React 状态丢失** | asar:`dsh-client-hmr/README.zh.md`「一次重载做什么」 |
| 页面刷新 | 总是安全；不恢复动态 Cordis 定义（与静态包无关） | asar:`dsh-cordis-client-runner/README.zh.md` |

**开发循环（`[INF]`，scout §8.2 建议）**：workspace 以 `link:` 安装一次后——

- 改 Host 半 `lib/index.js` / `lib/host/**` → **重启 DSH**（Desktop 退出重开）后生效；
- 改 Client 半 `lib/client.js` → 同样需要重启 + 刷新页面（除非同时跑 `pnpm run dev:web` watcher，且它覆盖本 workspace——**未验证**，scout U8）；
- 改 `cordis.patch.yml` / `package.json` → 配置层可能即时热载，但为确定性仍建议重启核对。

## 3. 验证清单

### 3.1 安装/加载层

| # | 检查 | 方法 | 期望 |
|---|---|---|---|
| V1 | 插件已装 | `plugin_manager({action:'list_plugins'})` 或插件列表页 | 有 `dsh-terminal-panel` 条目，状态启用 |
| V2 | Host 行已激活 | `cordis_inspect_query`（Host `Config.listConfigs`，`name:'dsh-terminal-panel'`） | 能查到条目；无 `failed` 诊断 |
| V3 | 展示元数据 | 插件列表 / bundle 详情 | 标题/描述来自 `locale/zh.json`（中文界面）或 `locale/en.json`；图标为 `icon.svg` 渲染结果（非默认图） |
| V4 | Client bundle 真的到达浏览器（U4） | DevTools Console：`window.__DSH_BOOT__`；Network：`/plugins?…` / `/plugins/dsh-terminal-panel/client.js` | boot 图含 `dsh-terminal-panel` 行；`/plugins?…` 200；产物含 `__ModuleLoader__`、`id:"dsh-terminal-panel"` |
| V5 | RPC 路由可用 | **页面 DevTools Console 执行下面 fetch**（同源自动带 cookie），或点「终端」tab 后 Network 过滤 `terminal-panel` | `200` + `{"ok":true,"value":{"protocol":1,…}}`；**不要用无 cookie 裸 curl 的 405/401 当判据**（见 §3.1.1） |

#### 3.1.1 RPC 路由验证口径（H2 教训：无 cookie 裸 curl 不能判定路由）

桌面 Host 的 HTTP 行为（真机实测）：

| 请求 | 响应 | 含义 |
|---|---|---|
| `POST /terminal-panel/rpc`（**无 cookie**） | **405，空 body** | 路由**未注册**（Host 半端没挂上：装配失败 / default export / apply 返回对象 / 未重启加载新代码） |
| `POST /terminal-panel/rpc`（**无 cookie**） | **401 JSON** `{"ok":false,"error":{"code":"unauthorized",…}}` | 路由**已存在**，只是被 `connection` 认证栅栏拒绝（不是失败信号） |
| `POST /api/*`（无 cookie） | **401** 纯文本 `unauthorized` | 与插件无关，是宿主 `/api` 网关行为 |
| `GET /任意缺失路径` | 404 | 静态资源对照 |

所以**唯一通过判据是带 cookie 的 200**。在已登录的 DSH 页面打开 DevTools Console 执行：

```js
// 同源 fetch 默认带 session cookie（credentials: 'same-origin'）
await (await fetch('/terminal-panel/rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  credentials: 'include',
  body: JSON.stringify({ reqId: 'verify-1', method: 'panel.hello', params: {} }),
})).json()
// 期望：{ ok: true, value: { protocol: 1, hostTime: …, capabilities: {…}, limits: {…}, availability: {…} } }
```

或点「终端」tab 后在 Network 面板过滤 `terminal-panel`：看 `POST terminal-panel/rpc` 的 status 与 response（200 + `ok:true`）。

> **Plugin Manager 显示 active ≠ 插件工作**：H2/H2b 故障下插件行是 active，但路由从未注册（405 空 body）。排障顺序：405 → 查 `lib/index.js` 导出形态与 `apply` 返回值（contract §13.5 自检）；401 → 刷新页面换 cookie；200 → Host 半端正常，问题在 Client 半端（看 Console/`window.__DSH_BOOT__`）。

### 3.2 功能层（ui-spec v4 验收，正式矩阵在 `docs/testing/acceptance-matrix.md`）

| # | 检查 | 期望 |
|---|---|---|
| V6 | tab 出现 | 已开始会话的头部有「终端」（在「对话」「轨迹」之后）；blank 会话不显示（宿主行为 `[FACT]`） |
| V7 | bash 列 | 任一 agent 执行 bash 命令 → 出现「Bash」列 + agent chip + 命令；默认显示「仅终态」徽标（过程输出不可得，contract §12.7） |
| V8 | 后台任务 | 后台 job → 出现「后台任务」列，增量输出；完成后 32px 行 + 10s 倒计时 |
| V9 | 持久终端 | `terminal_open`/`terminal_send` → 出现「终端」列（文本流，只读） |
| V10 | 自动收起 | 完成 10s 后折叠；悬停暂停；移出后重新计 10s |
| V11 | 跟随 | 上翻出现「N 条新输出 ↓」；回底自动恢复（不点按钮） |
| V12 | 停止 | job/terminal 列两击停止生效；final-only bash 停止禁用 + tooltip |
| V13 | 筛选/搜索/最大化 | chips 计数正确、本地即时过滤；`⤢` 打开 980×600 只读弹窗，Esc 关闭 |

端到端人工验收：ui-spec v4 + Figma A–F 六板逐条对照（以 tester 的 acceptance-matrix 为正式版）。

## 4. 回滚

按「破坏程度从小到大」：

1. **临时停用（保留安装）**
   `plugin_manager({ action: 'set_bundle', target: 'dsh-terminal-panel', enabled: false })`
   → 刷新页面；tab 消失，Host 路由随插件卸载被撤。配置层即时生效。`[FACT]` scout §8.2/§8.3。
2. **完全移除**
   `plugin_manager({ action: 'remove_bundle', target: 'dsh-terminal-panel' })`
   → 跟随返回的 `nextStep`（可能需要重启）。该动作取消选入 → 摘运行贡献 → `pnpm remove`。`[FACT]`。
3. **代码层回退**
   `git -C /Users/lzx/Documents/GitHub/dsh-terminal-panel log --oneline` → `git revert`/`git reset`，再重装或重启。
4. **profile 兜底**
   profile 目录有历史备份 `~/.dsh/profiles/desktop/{package.json,cordis.patch.yml}.bak-*`；**不要用脚本改 profile**，优先让 `plugin_manager` 做。
5. **数据**：本插件只在内存保存 Run 注册表与 UI 偏好，不写 session、不落盘；卸载无需清理数据 `[INF]`。

回滚验证：刷新页面后标签栏无「终端」；`POST /terminal-panel/rpc` 返回 404；插件列表无条目；宿主日志无该插件报错。

## 5. 故障排查

| 现象 | 可能原因 | 处置 |
|---|---|---|
| `application: failed` | Host 代码语法 / `inject` 服务缺失 / 行名解析失败 | 看 `error`；`node --check lib/index.js`；修好后重新安装（已装成功不会自动回滚，需 remove 或重装） |
| `application: restart-required` | 替换了已安装包的代码（新 JS 代际） | 重启 DSH 桌面版；`restartReason` 说明原因 |
| `application: overridden` | 更高优先级 patch 层覆盖同名 id | 检查 profile `cordis.patch.yml` 与其它 bundle 的同名行 |
| `pendingBuilds` 非空 | pnpm 11 拦了依赖构建脚本 | 本插件无构建脚本；若真出现，等用户明确批准后带 `approvedBuilds` 重试 |
| **pnpm 安装长时间无输出 / 疑似挂起** | 联网解析依赖慢；旧脚本无超时（现脚本默认 120s 保护） | 先 `deploy/publish-and-install.sh --dry-run` 看计划；再用 `--timeout <秒>`（如 300）重跑；离线优先；**超时 = exit 6**；perl 降级时出现的 `Alarm clock: 14` 属正常（§1.3）；不要 Ctrl-C 后手工补齐 |
| tab 完全不出现 | blank 会话（未发消息）；或可用 View < 2 | 先发消息；这是宿主行为 `[FACT]`（ui-conversation README:88/74） |
| tab 不出现（已开始会话） | 插件未启用；Client bundle 未到达（U4）；slot entry crashed | 查 V1/V4；Console 搜 `slot entry crashed in 'conversation.view'` |
| 面板空白/报错 | `lib/client.js` 运行期异常 | `node --check`；Console 看堆栈；修好后重启 + 刷新 |
| 面板显示「Host 半端未加载」 | Host 行未激活（缺 `webServer`/`connection` 或 `lib/index.js` 异常） | 查 V2；`plugin_manager` 重装看 `application` |
| **Plugin Manager 显示 active，但 RPC 405 空 body** | Host 插件形态违反 cordis 契约（`export default` 丢 inject / `apply` 返回对象 → `Invalid effect` 全回滚 / 装配失败被吞） | 按 contract §13.5 自检 `lib/index.js`（无 default、apply 返回 undefined、失败 rethrow）；重启 DSH 后按 §3.1.1 用页面 fetch 复验 200 |
| RPC **405 空 body**（无 cookie） | 路由未注册：Host 半端未加载 / 装配失败 / 未重启加载新代码 | 查 §3.1 V2 与 §3.1.1；重启 DSH 桌面版后复验 |
| RPC **401 JSON**（无 cookie） | 路由存在，只是缺认证 cookie（正常现象） | 用页面内 fetch（带 cookie）复验；或刷新页面重新换 cookie |
| RPC 200 但面板空白 | Client 半端异常 / slot 未渲染 / blank session | 查 V4 与 Console（`slot entry crashed in 'conversation.view'`）；blank session 属宿主行为 |
| 某 chip 置灰 | 对应来源服务缺失或跨会话读取被拒（scout U6） | 面板 tooltip 有原因；换有 jobs/terminals 服务的 profile 复核 |
| bash 列只有终态 | **预期行为**（无 ShellExecution 句柄，contract §12.7） | 引导用后台 job 获取增量输出 |
| 终端输出「较早输出已被裁剪」 | scrollback 裁剪（默认 10000 行/4MiB） | 预期行为，非错误 |
| 输出不刷新 | 轮询停了（页面隐藏/认证失效/连续失败） | 看面板横幅；恢复可见或按重试 |

## 6. 卸载的副作用与边界

- 不修改模型可见行为：不注册工具、不写 session、不注入 prompt；唯一写操作是用户点「停止」。
- 插件必须幂等可清理：所有 `ctx.effect`/`ctx.on`/定时器/`<style data-plugin-css>`/路由都要在 dispose 时归还，否则「停用」不彻底（残留 DOM/路由/轮询）。
- 路由重复注册防护：若其它插件占用 `/terminal-panel/rpc` 或 patch 行 id `terminal-panel`，安装会失败；先确认无同名。
- 终端只读：面板不向 PTY 写输入；`terminals.kill` 仅在用户点停止时调用。
- 本次安装是本项目第一次真机安装（`[ASSUMPTION]` U4 待验证）：安装后请把实际生效路径（是否需要重启、页面刷新是否足够）回填到本文件 §2，供 T6 与后续迭代使用（scout U8）。
