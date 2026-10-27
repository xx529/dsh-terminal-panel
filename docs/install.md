# 安装 · 生效 · 验证 · 回滚（dsh-terminal-panel v2）

> 状态：**v3（GitHub 安装优先，2026-10-27）** — 安装主路径改为 **GitHub git spec**（`github:xx529/dsh-terminal-panel#v0.1.1`），本地目录 `link:` 降级为开发模式；新增升级/回滚/网络注意。安装/生效/回滚步骤以 scout 取证为 `[FACT]`。
> 证据来源：`docs/research/dsh-plugin-apis.md` §1/§8/§12、**`docs/research/terminal-panel-github-install-2026-10-27.md`（scout T78：git spec/覆盖 link:/回滚/重启）**、asar 内 `dsh-plugin-manager/README.zh.md`、`dsh-client-hmr/README.zh.md`、`@deepseek-ai/dsh/README.zh.md`、skill `cordis-plugin-development`。
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

### 1.1 GitHub 安装（**推荐主路径**，`[FACT]`）

> 用 GitHub 仓库安装，不依赖本机路径、可重复、可复现。证据：`docs/research/terminal-panel-github-install-2026-10-27.md`（scout T78）；asar `@deepseek-ai/dsh-plugin-manager` 的 spec 解析/回滚实现。

**推荐 spec（不可变 tag）**：

```text
github:xx529/dsh-terminal-panel#v0.1.1
```

**等价 commit spec（tag 被移动/不存在时最稳）**：

```text
github:xx529/dsh-terminal-panel#9f3fed1271150c39af210bdd0e17c79c04ce5a83
```

由 Lead（或被授权的 teammate）执行：

```jsonc
// plugin_manager
{ "action": "install_bundle", "target": "github:xx529/dsh-terminal-panel#v0.1.1" }
```

- **可直接覆盖已装的 `link:` 依赖**（无需先 `remove_bundle`）：`install_bundle` 会把 profile `dependencies` 里的 `link:…` 改写为 git spec、重建 lock、重新解析 bundle patch。`[FACT]`
- **失败自动回滚**：安装失败会恢复 profile `package.json` + `pnpm-lock.yaml`，不会留半装状态。`[FACT]`
- `#ref` 由 pnpm 解析（tag / commit / branch 均可）；git spec 安装前会做 GitHub 连接检查，**只有网络/超时类失败会中止**（本插件无构建脚本，正常情况下 `pendingBuilds` 为空，无需 `--yes` 类审批）。
- 成功后 `application` 预期为 **`restart-required`**：**重启 DSH 桌面版 + 刷新页面**才加载新 Host/Client 代码。
- `node_modules/dsh-terminal-panel` 从 **symlink → 实体目录**（包被完整复制）；profile 的 `cordis.patch.yml` **不需要**写本插件行（bundle patch 来自包内 `cordis.patch.yml`）。`[FACT]`
- **升级到新 tag**：把 spec 的 `#v0.1.1` 换成新 tag（如 `#v0.1.2`）或新 commit，再次 `install_bundle` → 重启 DSH + 刷新页面。**不要手工 `pnpm add`/改 lock**。
- **网络 / 超时注意**：需要能访问 GitHub；失败会回滚，可重试。包**无 `prepare` 构建、无运行时依赖**，不会触发 pnpm 构建脚本。
  - `install_bundle` 自身的超时：git 连接检查 **5s**（`githubConnectionTimeoutMs`）+ pnpm **idle 600s**（非总时长）；**部署脚本的 `--timeout`（默认 120s）只覆盖脚本内的 CLI/pnpm 调用，不覆盖 plugin_manager 这条路径**。`[FACT]` scout T78 §A/§E。
- 其它等价 spec 形态：`git+https://github.com/xx529/dsh-terminal-panel.git#v0.1.1`、`github:xx529/dsh-terminal-panel#<commit>`；**不要用 GitHub archive tarball**（archive 顶层多一层目录，`pnpm add` 预期找不到根 `package.json`，高失败风险）。`[FACT]` scout T78 §E。
- **版本口径**：`v0.1.1` 是 annotated tag（指向 commit `9f3fed1`）；当前包内 `package.json` 的 `version` 仍是 **`0.1.0`**，因此 `ChangeResult.version` 会显示 `0.1.0`——这是预期现象，不是装错 tag；以 dependency spec/commit 为准。`[FACT]` scout T78 §D。

安装后（重启前）只读核对：

```bash
node -e "const p=require(process.env.HOME+'/.dsh/profiles/desktop/package.json'); console.log(p.dependencies['dsh-terminal-panel'])"
# 期望：github:xx529/dsh-terminal-panel#v0.1.1（或等价 git+https…）
ls -ld ~/.dsh/profiles/desktop/node_modules/dsh-terminal-panel
# 期望：实体目录（不再是 -> /Users/... symlink）
node -e "console.log(require(process.env.HOME+'/.dsh/profiles/desktop/node_modules/dsh-terminal-panel/package.json').version)"
```

返回 `ChangeResult` 的字段语义、`application` 判据、`restartReason` 等仍见下方「读返回值」（与 v2 相同）：

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
- `restart-required` → 看 `restartReason`，重启 DSH 桌面版 + 刷新页面。
- `overridden` → 被更高优先级 patch 层覆盖（检查 profile `cordis.patch.yml` 是否有同名 id 或 patch 顺序）。
- `failed` → 看 `error`；插件文件修好后下一次操作会重新导入（**已装成功后再激活失败不撤销安装** `[FACT]`）。
- `cancelled` → 用户取消，重试即可。
- `pendingBuilds` 非空 = pnpm 11 拦下依赖构建脚本：只有用户明确批准后才带 `approvedBuilds` 重试；**本插件无构建脚本，正常应为空**。
- 安装失败会恢复 profile `package.json` + `pnpm-lock.yaml` `[FACT]`。

### 1.2 开发模式：本地目录 `link:`（改代码生效快，**非发布安装**）

> 用途：开发/调试本机工作树。**发布验证请用 §1.1 的 GitHub spec**（测的是打包内容，而不是工作树）。

```jsonc
{ "action": "install_bundle", "target": "/Users/lzx/Documents/GitHub/dsh-terminal-panel" }
```

- 机制：profile `dependencies` 写 `link:/Users/lzx/Documents/GitHub/dsh-terminal-panel`，`node_modules/dsh-terminal-panel` 是 **symlink**；改 `lib/**` 无需重新安装。
- 生效：改 Host/Client 代码仍需**重启 DSH**（Client 另需刷新页面；有 `dev:web` watcher 时例外，见 §2）。
- 与 GitHub 模式差异：

| 维度 | GitHub git spec（§1.1） | 本地 `link:`（本节） |
|---|---|---|
| dependency | `github:xx529/dsh-terminal-panel#v0.1.1` | `link:/Users/lzx/Documents/GitHub/dsh-terminal-panel` |
| `node_modules` 形态 | **实体目录**（包复制） | **symlink**（指向工作树） |
| 代码来源 | 远端 tag/commit（可复现、可分享） | 本机工作树（可能含未提交改动） |
| 升级方式 | 改 spec 重新 install + 重启 | 改代码即生效（Host 仍需重启） |
| 适用场景 | 用户安装、发布验证 | 开发调试 |
| 风险 | 需要 GitHub 网络 | 工作树被移动/删除会导致加载失败 |

- 切换：GitHub → 开发模式：直接 `install_bundle target:'/Users/lzx/Documents/GitHub/dsh-terminal-panel'`（覆盖，失败自动回滚）；开发模式 → GitHub：按 §1.1 重装 + 重启。
- 手工路径兜底（`[ASSUMPTION]`，不推荐）：仅在 `install_bundle` 不可用时考虑——profile `package.json` 加 `link:` 依赖 + `dsh.profile.bundles` 追加 + profile 内 `pnpm install` + 重启；**手工操作前先备份 profile `package.json`/`pnpm-lock.yaml`**，优先用 §1.3 脚本。

### 1.3 一键脚本（`deploy/publish-and-install.sh`，两种来源）

脚本把「推送 + 安装 + 回滚」封装成一条命令，**两种来源模式**（默认仍是 link 开发模式，向后兼容）：

| 模式 | 命令 | spec / 形态 | 需联网 | 适用 |
|---|---|---|---|---|
| **GitHub / 生产** | `./deploy/publish-and-install.sh --from-git [<ref>]` | `github:xx529/dsh-terminal-panel#<ref>`（ref 默认 `v0.1.1`）；`node_modules` 为**实体目录** | **是**（git clone/解析） | 用户安装 / 发布验证（可复现） |
| **本地 / 开发（默认）** | `./deploy/publish-and-install.sh` | `link:<仓库根>`；`node_modules` 为 **symlink** | 否（离线可装） | 开发调试（改代码生效快） |

spec 依据：`docs/research/terminal-panel-github-install-2026-10-27.md`（scout T78）。

```bash
# 先看计划（不改任何文件）：--dry-run 会打印本次将使用的来源与 spec（link: 或 github:…#ref）
./deploy/publish-and-install.sh --dry-run
./deploy/publish-and-install.sh --dry-run --from-git v0.1.1

# 生产：用 GitHub spec 安装（默认 v0.1.1，需联网；装后重启 DSH + 刷新页面）
./deploy/publish-and-install.sh --from-git v0.1.1
./deploy/publish-and-install.sh --from-git            # 等价：默认 ref v0.1.1

# 开发：默认 link: 安装（不传 --from-git；symlink 指向本仓库）
./deploy/publish-and-install.sh --no-push

# 回滚：撤销最近安装；--to-link 额外切回 link: 开发模式（别名 --from-link；无备份也可直接切）
./deploy/publish-and-install.sh --rollback
./deploy/publish-and-install.sh --rollback --to-link

./deploy/publish-and-install.sh --timeout 300          # 放宽超时到 300s（默认 120s）
```

| 选项 | 默认 | 说明 |
|---|---|---|
| `--from-git [<ref>]` / `--from-git=<ref>` | off（默认 link） | 用 GitHub spec 安装：`github:xx529/dsh-terminal-panel#<ref>`；ref 默认 **`v0.1.1`**（tag/commit/branch 均可）；**需联网**；装后 `node_modules` 为实体目录 |
| `--to-link` / `--from-link` | off | **仅与 `--rollback` 一起用**：回滚后把插件恢复为 `link:` 开发模式（无备份也可直接切） |
| `--timeout <秒>` / `--timeout=<秒>` | **120** | 覆盖 `dsh plugin … add`（link/ git spec）、`dsh plugin install`、`pnpm install` 的超时；**范围 10–3600**（越界 exit 2）；**超时统一 exit 6** |
| `--dry-run` | off | 只打印计划（含来源/spec），不改文件/不推送/不安装 |
| `--no-push` / `--no-install` | off | 只装 / 只推 |
| `--rollback` | off | 恢复最近一次 profile 备份（`package.json` + `pnpm-lock.yaml`）、从 `dsh.profile.bundles` 移除插件、重装清理 `node_modules`（幂等） |
| `--skip-tests` | off | 跳过 `npm run verify`（仅限 CI 已跑过时使用） |
| `--yes` | off | 允许「兼容回退路径」（无 `dsh` CLI / CLI 安装失败时的 profile 手工改写）；**git 模式不需要** |

**失败与超时（git 模式）**：`pnpm add` 中断/超时/失败会**自动恢复本次安装前的 `package.json` + `pnpm-lock.yaml`** 备份，并尽力 `pnpm install`（离线优先）收敛，然后以非零码退出——**不会留半装状态**。
退出码：`0` 成功；`2` 用法/参数；`3` 预检；`4` 推送失败；**`5` 安装失败**；**`6` 超时**。失败后可直接重试；`--dry-run` 先看计划。

**安装后校验（脚本自动做）**：

- **git 模式**：dependency 必须为 `github:` / `git+` / `https`（且**不是** `link:`）；`node_modules/dsh-terminal-panel` 必须是**实体目录**（非 symlink）；包内 `package.json`、`lib/index.js`、`lib/client.js`、`cordis.patch.yml` 四个关键文件存在。
- **link 模式**：dependency 必须以 `link:` 开头；`node_modules` 为 symlink。

超时实现（三路降级）：GNU `timeout` → `gtimeout` → `perl -e 'alarm shift; exec @ARGV'` → 无保护降级（会打印 warning）。GNU rc=124 与 perl SIGALRM rc=142 归一为 124，脚本**明确报错而不静默等待**，最终以 **exit 6** 结束并提示可用 `--timeout` 放宽。

> 已知副作用：本机没有 GNU `timeout`、由 perl alarm 终止子进程时，shell 可能打印一行 **`Alarm clock: 14`** —— 这是正常的超时终止提示，不是脚本错误。
>
> 排障：**pnpm 安装长时间无输出/疑似挂起**时，先 `--dry-run` 看计划，再用 `--timeout <秒>`（如 300）重跑；git 模式失败会自动恢复备份并尽力离线 `pnpm install`，可重试。不要 Ctrl-C 后手工补齐，按 §5 处理。

### 1.4 发布前检查清单（`--dry-run` 回归）

> prevention 载体（来源复盘：`docs/retro/2026-10-26-install-pnpm-hang-and-teammate-failure.md`，task-23）。**每次发布前逐项执行并保留输出**（贴进发布回执/任务板），不依赖 `npm run verify` 单独覆盖安装期风险。

- [ ] **门禁**：`npm run verify` exit 0（记录 tests/smoke 数字）
- [ ] **计划**：`./deploy/publish-and-install.sh --dry-run`（开发）与 `--dry-run --from-git v0.1.1`（生产）分别输出计划；确认来源/spec 正确、`--timeout` 默认 120s 生效、失败/超时自动回滚
- [ ] **GitHub 安装（§1.1 / §1.3）**：用 `install_bundle target:'github:xx529/dsh-terminal-panel#v0.1.1'` 或 `./deploy/publish-and-install.sh --from-git v0.1.1` 验证；成功后重启 DSH + 刷新页面，并核对 profile dependency 为 git spec、`node_modules/dsh-terminal-panel` 为**实体目录**（非 symlink）
- [ ] **超时保护**：实际安装（可用 `--no-push`）时观察超时保护；预期超时 **exit 6**，不得静默挂起（perl 降级出现 `Alarm clock: 14` 属正常）
- [ ] **路由验证**：安装后按 §3.1.1 用页面内 fetch 验证 `200 {"ok":true,"value":{"protocol":1,…}}`（非 405）
- [ ] **留证**：把 dry-run 输出、verify 数字、安装退出码贴进发布回执

## 2. 生效矩阵（`[FACT]`，scout §8.2）

| 变更类型 | 是否免重启 | 依据 |
|---|---|---|
| 配置层（patch/config） | ✅ 即时（本 profile `patchReload: "live"` + `hmr` 服务在跑） | `@deepseek-ai/dsh/README.zh.md:37`；profile `package.json` |
| 启用/停用插件行（`set_plugin` / `set_bundle`） | ✅ 即时（普通插件启停无需刷新页面或重启 Host） | asar:`dsh-client-hmr/README.zh.md`「概述」 |
| **替换已安装包的代码**（同 spec 新版本） | ❌ **需要重启 DSH**；HMR 模式下要先卸载再安装，旧版本先停 | asar:`dsh-plugin-manager/README.zh.md:100,141` |
| **安装形态切换**（`link:` ↔ GitHub git spec / 新 tag） | ❌ **需要重启 DSH + 刷新页面**；`restart-required` 预期返回 | scout T78（`docs/research/terminal-panel-github-install-2026-10-27.md`）；profile 依赖重写 + `node_modules` 实体化/重新复制 |
| 客户端 bundle 重建 | 仅当有 bundle watcher（`pnpm run dev:web`）时页面级热替换（`rebuilt` 帧→换模块→重挂），**React 状态丢失** | asar:`dsh-client-hmr/README.zh.md`「一次重载做什么」 |
| 页面刷新 | 总是安全；不恢复动态 Cordis 定义（与静态包无关） | asar:`dsh-cordis-client-runner/README.zh.md` |

**开发循环（`[INF]`，scout §8.2 建议；仅 `link:` 开发模式适用；GitHub 安装的实体目录改工作树不会生效）**：workspace 以 `link:` 安装一次后——

- 改 Host 半 `lib/index.js` / `lib/host/**` → **重启 DSH**（Desktop 退出重开）后生效；
- 改 Client 半 `lib/client.js` → 同样需要重启 + 刷新页面（除非同时跑 `pnpm run dev:web` watcher，且它覆盖本 workspace——**未验证**，scout U8）；
- 改 `cordis.patch.yml` / `package.json` → 配置层可能即时热载，但为确定性仍建议重启核对。

## 3. 验证清单

### 3.1 安装/加载层

| # | 检查 | 方法 | 期望 |
|---|---|---|---|
| V1 | 插件已装 | `plugin_manager({action:'list_plugins'})` 或插件列表页 | 有 `dsh-terminal-panel` 条目，状态启用 |
| V1b | 安装来源正确（GitHub spec） | 读 profile `package.json` 的 dependency + `ls -ld node_modules/dsh-terminal-panel` + 包内 `package.json` | dependency=`github:xx529/dsh-terminal-panel#v0.1.1`（或等价 commit/git+https）；`node_modules` 为**实体目录**；包内 name/version 正确 |
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

0. **GitHub 安装 → 开发模式（回到 link:）**
   `plugin_manager({ action: 'remove_bundle', target: 'dsh-terminal-panel' })` → `plugin_manager({ action: 'install_bundle', target: '/Users/lzx/Documents/GitHub/dsh-terminal-panel' })` → 重启 DSH + 刷新页面。
   （直接对 git spec 再 `install_bundle` 本地目录通常也可覆盖，但 scout 推荐“先 remove 再装 link:”作为干净回滚；失败自动回滚 profile 两文件。）反向（开发→GitHub）按 §1.1 重装。
1. **临时停用（保留安装）**
   `plugin_manager({ action: 'set_bundle', target: 'dsh-terminal-panel', enabled: false })`
   → 刷新页面；tab 消失，Host 路由随插件卸载被撤。配置层即时生效。`[FACT]` scout §8.2/§8.3。
2. **完全移除**
   `plugin_manager({ action: 'remove_bundle', target: 'dsh-terminal-panel' })`
   → 跟随返回的 `nextStep`（可能需要重启）。该动作取消选入 → 摘运行贡献 → `pnpm remove`。`[FACT]`
   → 若要回到开发模式：移除后执行 `install_bundle target:'/Users/lzx/Documents/GitHub/dsh-terminal-panel'`，重启 + 刷新。
3. **代码层回退**
   `git -C /Users/lzx/Documents/GitHub/dsh-terminal-panel log --oneline` → `git revert`/`git reset`，再重装或重启。
4. **profile 兜底（极端情况）**
   profile 目录有历史备份 `~/.dsh/profiles/desktop/{package.json,cordis.patch.yml,pnpm-lock.yaml}.bak-*`：
   1) 停止 DSH；2) 恢复 `package.json` + `pnpm-lock.yaml` 备份；3) 在 profile 目录执行 `pnpm install --offline`；4) 重启 DSH。
   **不要用脚本改 profile**，优先让 `plugin_manager` 做；恢复前确认备份时间戳与安装前基线一致。
5. **数据**：本插件只在内存保存 Run 注册表与 UI 偏好，不写 session、不落盘；卸载无需清理数据 `[INF]`。

回滚验证：刷新页面后标签栏无「终端」；`POST /terminal-panel/rpc` 返回 404；插件列表无条目；宿主日志无该插件报错。

## 5. 故障排查

| 现象 | 可能原因 | 处置 |
|---|---|---|
| `application: failed` | Host 代码语法 / `inject` 服务缺失 / 行名解析失败 | 看 `error`；`node --check lib/index.js`；修好后重新安装（已装成功不会自动回滚，需 remove 或重装） |
| **安装结果 `version` 显示 0.1.0，但装的是 v0.1.1** | tag 与包内 `package.json` version 不同（`v0.1.1` 指向 `9f3fed1`，包内仍 0.1.0） | 属预期：以 profile dependency spec/commit 为准，不是装错 tag |
| **GitHub 安装超时 / 无法连接 GitHub** | 网络受限、代理、GitHub 不可达（git spec 安装前会做连接检查） | 修复网络/代理后重试；失败已自动回滚 profile，不会留半装状态；离线环境改用 §1.2 开发模式或预置 tarball |
| **`#v0.1.1` 解析失败 / tag 不存在** | tag 未推送或远端仓库不可达 | 用不可变 commit spec：`github:xx529/dsh-terminal-panel#9f3fed1271150c39af210bdd0e17c79c04ce5a83`；`git ls-remote --tags https://github.com/xx529/dsh-terminal-panel.git` 核对 |
| **用脚本安装/回滚 GitHub 版本** | 旧版本脚本只支持 link:（scout T78 R1 已修复，T83） | 用 `./deploy/publish-and-install.sh --from-git v0.1.1` 安装；`--rollback --to-link` 切回 link 开发模式；`--dry-run` 先看 spec |
| **覆盖 link: 后仍加载旧代码** | 未重启 DSH（返回 `restart-required`）；或仍在用 symlink | 重启桌面版 + 刷新页面；确认 `node_modules/dsh-terminal-panel` 已是实体目录、profile dependency 为 git spec |
| **已装 GitHub 版本，想改本机代码** | 实体目录不含工作树改动 | 用 §1.2 开发模式覆盖：`install_bundle target:'/Users/lzx/Documents/GitHub/dsh-terminal-panel'` → 重启 + 刷新 |
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
