# T78 取证：用 GitHub 方式安装 dsh-terminal-panel（plugin_manager spec / 激活 / 替换 / 回滚）

> 角色：scout（只读取证）。仓库 `/Users/lzx/Documents/GitHub/dsh-terminal-panel`，`HEAD=9f3fed1`（`v0.1.1` 指向它）。
> 安装版 DSH：`@deepseek-ai/dsh-plugin-manager@0.2.1-rc.3`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh/node_modules/...`）。
> 标注：**FACT** = 代码位置（`lib/index.js:行`）/命令输出；**INFERENCE**；**ASSUMPTION**（未真机验证 + 验证方式）。
> 本任务未执行任何安装（只读取证）；实际安装需 `plugin_manager`（需要用户批准）。

---

## 0. 结论速览

| 问题 | 结论 |
|---|---|
| 能否用 GitHub 安装 | **能**。`install_bundle` 的 spec 解析支持 git 形态（`github:user/repo#ref`、`git+https://…#ref`、`git@…`、裸托管 URL），`#tag/#commit` 片段保留并交给 pnpm 解析。 |
| 机制 | 在 profile 目录跑 `pnpm add <spec>`（`runPnpm` `cwd=profile.dir`，`lib/index.js:2204-2220`），成功后校验 `dsh.bundle`、`dsh.profile.bundles` 自动追加、**不写 profile `cordis.patch.yml`**（bundle patch 读包内文件）。 |
| 可复现 ref | 远端已有 **`v0.1.1` → commit `9f3fed1`（= 当前 HEAD，含下拉修复）**；推荐 `github:xx529/dsh-terminal-panel#v0.1.1`，或 commit 钉死 `#9f3fed1271150c39af210bdd0e17c79c04ce5a83`。 |
| 替换 link: | 可直接 `install_bundle` git spec 覆盖（git spec 安装前不知道包名 ⇒ 不触发 `already-installed`；pnpm 覆盖同名 dependency；失败自动恢复 `package.json`+`pnpm-lock.yaml`）。稳妥序列见 §D。 |
| 生效 | 预期 `application:'restart-required'`（模块从 symlink 换成实体目录/新 generation）⇒ 需重启 DSH 桌面版 + 刷新页面。 |

---

## A. `install_bundle` 支持的 target 形态（FACT，`parseInstallSpec`）

`@deepseek-ai/dsh-plugin-manager/lib/index.js`：

- **git**（判定 `GIT_SHORTHAND|GIT_URL|HOSTED_REPOSITORY_URL`，:23-27, :96-101）：
  - `github:user/repo[#tag|#commit|#branch]`（同族 `gitlab:` / `bitbucket:` / `gist:`）
  - `git+https://host/user/repo.git[#ref]`、`git+ssh://…`、`git://…`、scp 形式 `git@host:path`
  - 裸托管 URL：`https://github.com/user/repo[.git][#ref]`（`HOSTED_REPOSITORY_URL` 自带 `(?:#.*)?`）
  - `#` 片段**不解析、原样传给 pnpm**（`runPnpm(["add", spec, …])` :2033-2038）⇒ tag/commit 由 pnpm 处理。
- **path**：绝对路径，可带 `file:`/`link:` 前缀（:73-76）；**相对路径被拒绝**（"a local path must be absolute"）——当前 `link:/Users/...` 属这一类。
- **tarball**：`.tgz` / `.tar.gz`（HTTP URL 或绝对路径，可带 `#`；:28）。
- **registry**：`name` 或 `name@range`（:103-116）。
- 拒绝：空 spec、`-` 开头、相对路径、`https://…` 既非 git 也非 tarball（`invalid-spec`）。
- **git 专有前置检查**：`checkGithubConnection(...)`，`githubConnectionTimeoutMs` 默认 5000ms；只有 network/timeout 会中止（`failedAt:'spec-host'`），认证/协议回退交 pnpm（:1995-2010）。
- **`saveExact`**：只追加 pnpm `--save-exact`（:2036）；对 git spec 无可复现性增益（git 靠 `#ref`）。

**installBundle 的处理顺序（FACT）**：
1. `change()` 备份可恢复文件（`RESTORED_FILES = ["package.json","pnpm-lock.yaml"]`，:1293）并持有 profile 写锁；
2. `specPackageName()` 预判包名（git/tarball 只能靠「已保存依赖 spec 等值匹配」→ link: 与 git 不等 ⇒ `known=undefined`）；
3. `already-installed` 守卫仅在 **HMR 存在 + 预判到包名 + 依赖已存在** 时触发（:1988-1990）⇒ **git 覆盖 link: 不会命中**；
4. `runPnpm(["add", spec, ...saveExact?, ...registryArguments])`（cwd=profile.dir；idle 600s / lookup 20s 超时；输出经 `plugin-manager/install-log` 流式播报，:2204）；
5. 从 profile manifest 的 diff 找**唯一**新增/变更依赖（`installed = names where before[name] !== after[name]`，:2072-2080），多于 1 个 → `ambiguous-install`；
6. `resolveBundleDir` 读新目录 manifest，要求 `dsh.bundle`（否则 `not-bundle` + 回滚）；`evaluatePluginCompatibility`（engines.dsh / dsh peer）不符 → `incompatible-version`；
7. `loadOverlayPatches` 校验包内 `cordis.patch.yml` 可解析；`selectBundle(name,true)`；`publishAndReload`。
8. 任一步失败/取消 → `restoreFiles(files)` 恢复 `package.json` + `pnpm-lock.yaml`（:2110-2113）。

---

## B. 安装机制细节

- **不是自己写 profile**：安装 = `pnpm add`（`runPnpm`，cwd=profile.dir，execution:'service'，日志 `plugin-manager/install-log`）。**不是** `dsh plugin` CLI：`dsh plugin --profile <name> <args>` 是「把剩余参数转发给 profile 的 pnpm」（`@deepseek-ai/dsh/README.zh.md`），**绕过 bundle 校验/选入**；官方路径仍是 `install_bundle`。
- **git 依赖**：等价于手工 `cd ~/.dsh/profiles/desktop && pnpm add github:xx529/dsh-terminal-panel#v0.1.1`。pnpm 会 clone 仓库（git fetch），并按 pnpm 自身规则处理依赖的 lifecycle 脚本。
- **是否需要 prepare/构建**：本包 `scripts` 只有 `check/test/smoke/verify`，**没有 `prepare`/`prebuild`/`postinstall`**，且产物 `lib/index.js`、`lib/client.js` 已提交 → **无需构建**（无构建步骤 = 设计前提）。若未来加入 `prepare`，git 安装才会触发（INFERENCE，pnpm 通用行为；本包当前无此脚本）。
- **`pendingBuilds`**：pnpm 10/11 对依赖 build script 需批准；本包无此类脚本 ⇒ 预期 `pendingBuilds` 为空。若出现，需用户明确批准后带 `approvedBuilds` 重试（不得自行批准）。
- **`private:true`**：只影响 `npm publish`（registry 发布被禁），**不影响 git/tarball 安装**；registry 安装本包本来就不可能（未发布）。当前 package.json：`private:true`、`version:0.1.0`、`engines.dsh: ">=0.2.1-rc.2 <0.3.0"`（运行版 0.2.1-rc.3 → 兼容）。
- **超时/离线**：安装服务自身超时 = `githubConnectionTimeoutMs`(5s) + pnpm `idleTimeoutMs`(600s) + `inspectTimeoutMs`(20s，仅 registry view)；部署脚本 `--timeout`(默认 120s) 只覆盖脚本内的 CLI/pnpm 调用。离线时 git 需网络（clone），失败表现：`failedAt:'spec-host'`（连接检查）或 pnpm 失败 → 自动恢复 profile 两文件，`application:'failed'`。

---

## C. 安装后的激活（bundles / patch）

- **`dsh.profile.bundles` 自动追加**：`selectBundle(name, true)` 读 profile manifest，把 name 并入 `dsh.profile.bundles` 后 `saveManifest`（`lib/index.js:2280-2320`）。与 link: 安装**完全等价**（同一 name、同一位置语义）。
- **profile `cordis.patch.yml` 不会被写**：`change().diskState()` 只是把 `package.json/cordis.patch.yml/pnpm-workspace.yaml/compatibility` 纳入「是否 changed」检测（:2400-2410），不做修改。bundle 的 patch 层来自**包内** `dsh.bundle.patch`：`bundleRows()` → `resolveBundleDir(...)` + `bundlePatchPaths` + `loadOverlayPatches`（:2287-2292, 2350 附近）；git 安装后目录变成 `node_modules/dsh-terminal-panel`（实体），路径解析自动跟进。
- 也就是说：**不需要手工把插件行写进 profile `cordis.patch.yml`**；profile patch 只承载用户对 bundle 行的 config 覆盖。安装失败的 `not-bundle` 正是「包内没有 dsh.bundle.patch」的检查结果。
- 依赖锁：`pnpm-lock.yaml` 记录 importer spec + resolution（git 会记录 commit-ish），可用于复现核对（见 §F）。

---

## D. 替换现有 `link:` 安装的正确顺序（推荐 / 兜底 / 回滚）

现状（FACT，本机已核对）：profile `dependencies["dsh-terminal-panel"] = "link:/Users/lzx/Documents/GitHub/dsh-terminal-panel"`；`dsh.profile.bundles` 32 项含本插件；`node_modules/dsh-terminal-panel` 为 symlink；profile `cordis.patch.yml` **不含**本插件行（正确）。

### 方案 2（推荐：直接覆盖，自动回滚）
1. **先备份**（可省但建议）：`cp ~/.dsh/profiles/desktop/{package.json,pnpm-lock.yaml} /tmp/`（或依赖历史 `.bak-*` 惯例）。
2. `plugin_manager({ action:'install_bundle', target:'github:xx529/dsh-terminal-panel#v0.1.1' })`
   - 预期不触发 `already-installed`（git spec 预判不到包名，见 §A 步骤 3），pnpm 覆盖同名依赖 spec `link:→git`。
   - 返回：`bundle:'dsh-terminal-panel'`、`version:'0.1.x'`（git 安装读包内 version，当前 0.1.0）、`application:'applied'|'restart-required'`、`restartReason?`、`changed:true`。
   - 失败（`failed`/`ambiguous-install`/`not-bundle`/`incompatible-version`/网络）→ 自动恢复两文件，link: 安装保持原样；按返回 `error` 排查。
3. 若返回 `restart-required` → **重启 DSH 桌面版 + 刷新页面**；`applied` 则直接刷新页面验证。

### 方案 1（兜底：先移除再装）
`plugin_manager({action:'remove_bundle', target:'dsh-terminal-panel'})`（取消选入 + `pnpm remove`；要求 `bundle.removable` 且不 `bundle-in-use`；失败自动恢复）→ 再执行方案 2。适用于方案 2 返回 `ambiguous-install` 或想彻底清依赖时。**注意** remove 期间插件不可用（Host 行卸载）。

### 回滚
- 装 git 失败 → 无需动作（`change()` 已恢复 `package.json`+`pnpm-lock.yaml`；`node_modules` 里残留的下载文件无害）。
- 已切 git 后想回 link: → `remove_bundle` → `install_bundle` target 用绝对路径 `/Users/lzx/Documents/GitHub/dsh-terminal-panel`（→ `link:` 依赖）→ 重启。
- 极端兜底：用备份恢复 profile `package.json`/`pnpm-lock.yaml` + `pnpm install --offline`（`docs/install.md` 流程）。

> **重要 gap（FACT）**：`deploy/publish-and-install.sh` 当前把安装阶段写死为 `link:`，且安装后核对断言 `dep.startsWith("link:")`（脚本 :319-329）。**切到 GitHub 安装后该脚本会误报 bad，且再跑会退回 link:**。需要 devops 增补 `--from-git <ref>`（或改默认为 git spec）并同步 `docs/install.md`，否则「可复现安装」只靠 `plugin_manager` 手动路径。

---

## E. 可复现 ref（已核实远端 tag，无需新打 tag）

`git ls-remote --tags origin` 实测：
```
b8cbef2… refs/tags/v0.1.0        fbe8586… refs/tags/v0.1.0^{}
a370ade… refs/tags/v0.1.1        9f3fed1… refs/tags/v0.1.1^{}   ← = 当前 main HEAD
```
（`v0.1.1` 是 annotated tag，`^{}` 才是 commit。）

- **推荐**：`github:xx529/dsh-terminal-panel#v0.1.1`
- 等价显式：`git+https://github.com/xx529/dsh-terminal-panel.git#v0.1.1`
- **最不可变**：`github:xx529/dsh-terminal-panel#9f3fed1271150c39af210bdd0e17c79c04ce5a83`
- 备选（不推荐）：GitHub archive tarball `https://github.com/xx529/dsh-terminal-panel/archive/9f3fed1.tar.gz` —— 解析器认 tarball，但 GitHub archive **顶层多一层目录**，`pnpm add` 该 tarball 预期找不到根 `package.json`（高失败风险）；用 git spec。
- 若 Lead 想「安装语义 = 发布 tag」，当前 `v0.1.1` 已满足；**不需要**额外 tag（若坚持每个发布都新 tag，可打 `v0.1.2` 指向 9f3fed1，但两 tag 同 commit 无收益）。

---

## F. 验证口径

### F.1 不重启即可取证（安装返回后即可做）
```bash
python3 - <<'PY'   # 1) dep spec 与 bundles
import json; d=json.load(open('/Users/lzx/.dsh/profiles/desktop/package.json'))
print('dep =', d.get('dependencies',{}).get('dsh-terminal-panel'))
print('bundles has plugin =', 'dsh-terminal-panel' in d.get('dsh',{}).get('profile',{}).get('bundles',[]))
PY
ls -l ~/.dsh/profiles/desktop/node_modules/dsh-terminal-panel   # 2) 实体目录（无 "->"）而不是 symlink
cat ~/.dsh/profiles/desktop/node_modules/dsh-terminal-panel/package.json | head   # 3) version/name/private
ls ~/.dsh/profiles/desktop/node_modules/dsh-terminal-panel/{lib/index.js,lib/client.js,cordis.patch.yml,icon.svg}  # 4) 运行必需文件
grep -n "dsh-terminal-panel" ~/.dsh/profiles/desktop/pnpm-lock.yaml | head   # 5) importer spec + resolution(commit)
grep -n "dsh-terminal-panel" ~/.dsh/profiles/desktop/cordis.patch.yml        # 6) 期望：无输出（bundle patch 在包内）
```
- 6) 若出现本插件行 → 说明有人手工加过，不是 install_bundle 行为（需清理，重复行会覆盖 patch）。
- `install_bundle` 返回的 `bundle/version/application/restartReason/changed` 本身就是证据（保存原始 JSON）。
- `plugin_manager` `list_bundles` 可看 row/存活条目（无副作用版本）；`list_plugins`/`inspect` 也可。

### F.2 必须重启后才可验证
- Host 半端实际从新路径加载（模块 generation/行激活）；
- 页面内 `fetch('/terminal-panel/rpc', {method:'POST', credentials:'include', headers:{'content-type':'application/json'}, body:'{"reqId":"t","method":"panel.hello","params":{}}'})` → `200 {"ok":true,"value":{"protocol":1,…}}`；
- 终端 tab 出现、面板可用；Plugin Manager 行状态/图标/locale 展示。
- 判定口径（契约 §13）：裸 curl **401** = 路由存在；**405 空 body = 路由缺失**；只有页面内 200 才算通过。

---

## G. 风险与未查清项

| # | 项 | 级别 | 说明/验证 |
|---|---|---|---|
| R1 | `deploy/publish-and-install.sh` 仍写死 link: + 断言 `dep.startsWith('link:')`（脚本 :319-329） | 高（流程一致性） | 切 git 后脚本会误判并可能回退 link:；devops 需增 `--from-git`/改断言 |
| R2 | 直接覆盖（方案 2）未真机实测 | 中 | 预期可行（§A 步骤 3）；真机失败会自动回滚；失败则走方案 1 |
| R3 | 替换已装包代码预期需重启（`restart-required`，reason 可能是 `package-moved`/`host-module`/`module-comparison`） | 中 | 以 `install_bundle` 返回为准；`applied` 也要刷新页面验证面板 |
| R4 | pnpm 对 git 依赖的**文件过滤**行为（是否按 `files` pack）未在本机验证 | 低 | 真机 `ls node_modules/dsh-terminal-panel` 核对 `files` 必需项（F.1-4）；无论 pack 与否 `files` 已含运行所需 |
| R5 | 网络/离线：git 安装必须联网 clone；DSH 连接检查 5s + pnpm 自身超时 | 中 | `failedAt:'spec-host'` 立即失败并回滚；离线环境不可用 git 安装（只能 link:/tarball 本地） |
| R6 | 仓库含 tests/docs 等非运行文件；若 pnpm 拷贝全仓，node_modules 体积增大 | 低 | 可接受；如需最小化可发 tarball（但需手工打包正确 root 结构） |
| R7 | tag 可被移动（`v0.1.1` 目前=9f3fed1） | 低 | 要不可变请用 commit hash（§E 第三行） |
| R8 | 用户环境 `~/.dsh/profiles/desktop` 备份恢复是否覆盖 `pnpm-workspace.yaml`（build approvals） | 低 | `RESTORED_FILES` 只有 package.json+pnpm-lock.yaml（:1293），workspace 文件不恢复（既有设计） |
