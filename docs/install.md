# 安装 · 生效 · 验证 · 回滚（dsh-terminal-panel）

> 状态：**v1 草稿**。安装/生效细节标 `[ASSUMPTION]` 的部分等 scout（T1）结论回来后由 Lead 转发确认，v2 修订。
> 结论标签：`[FACT]` 有可核对证据 / `[INF]` 推导 / `[ASSUMPTION]` 待验证。

## 0. 前置条件

| 项 | 要求 | 依据 |
|---|---|---|
| DSH 版本 | `>= 0.2.1-rc.2`（本机 0.2.1-rc.2） | `package.json` `engines.dsh`；asar:`dsh/node_modules/@deepseek-ai/dsh/package.json` `[FACT]` |
| Node | `^22.19.0 \|\| >=24.0.0`（本机 v22.22.2） | `package.json` `engines.node` `[FACT]` |
| profile | 桌面版 profile 名 `desktop`（`~/.dsh/profiles/desktop`） | `~/.dsh/profiles/desktop/package.json` `[FACT]` |
| 代码就位 | `lib/index.js`（T3）与 `lib/client.js`（T4）必须已落地，否则激活失败 | `package.json` `exports` `[INF]` |
| 依赖 | 无。本插件不装任何依赖，也不需要构建步骤 | 任务约束 + `lib/client.js` 单文件契约 `[FACT]` |

安装前自检（一次性）：

```bash
cd /Users/lzx/Documents/GitHub/dsh-terminal-panel
node --check lib/index.js && node --check lib/client.js
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('manifest ok')"
ls lib/index.js lib/client.js cordis.patch.yml
```

## 1. 安装（推荐：`plugin_manager` 的 `install_bundle`）

**不要手工改 profile 的 `package.json` / `cordis.patch.yml`，也不要手工在 profile 里 `pnpm install`**：
`install_bundle` 会代做包安装与 bundle 选择。`[FACT]` 见 cordis-plugin-development skill
（`~/…/dsh-agent-preset/skills/cordis-plugin-development/SKILL.md`「Persistent Harness plugins」段与
`references/host-plugin.md`「Install, enable, and observe」段）。

由 Lead（或被授权的 teammate）执行：

1. `plugin_manager({ action: 'install_bundle', target: '/Users/lzx/Documents/GitHub/dsh-terminal-panel' })`
   - `target` 用**绝对包目录**；本地目录安装会 link 到本 checkout，改代码后无需重装即可生效。`[FACT]` host-plugin.md
   - 若返回 `pendingBuilds`：本插件无构建脚本，正常应为空；非空须由用户显式批准后带 `approvedBuilds` 重试。
2. 读返回值：`application` 必须是 `"applied"`；`warnings` 为空。**只有 `application: applied` 才算生效**，
   进程在跑、日志无报错都不构成证据。`[FACT]` host-plugin.md
3. 若 `application` 为 `failed` / `overridden` / `restart-required`：
   - `failed` → 看诊断（多为 `lib/index.js` 语法或 `inject` 服务缺失）；修好后需**重启 DSH 桌面版**再装（替换已安装包要重启才能加载新的 JS 代际）。`[FACT]`
   - `overridden` → 更高优先级 patch 层覆盖了 `terminal-panel` 行，检查 profile `cordis.patch.yml` 是否有同名 id。
   - `restart-required` → 重启 DSH 桌面版。

### 1.1 备选路径（不推荐，`[ASSUMPTION]`，需用户明确同意）

若 `install_bundle` 不可用，可手工把本包加为 profile 依赖：

```
# ~/.dsh/profiles/desktop/package.json
"dependencies": { … , "dsh-terminal-panel": "link:/Users/lzx/Documents/GitHub/dsh-terminal-panel" }
"dsh": { "profile": { "bundles": [ … , "dsh-terminal-panel" ] } }
```

然后 `cd ~/.dsh/profiles/desktop && pnpm install` 并重启。`[ASSUMPTION]` 未在本机验证；
**v2 以 scout 结论为准**（`install_bundle` vs 依赖 + bundles 列表 + `pnpm install` 的准确组合）。
用手工路径前先备份 `~/.dsh/profiles/desktop/package.json` 与 `cordis.patch.yml`。

## 2. 生效

| 步骤 | 预期 |
|---|---|
| 1. 安装返回 `applied` | Host 半端 loader 行已插入（`id: terminal-panel`），`POST /terminal-panel/rpc` 路由已注册 |
| 2. 刷新 Harness 页面（`http://127.0.0.1:<port>`；桌面版会自动打开带 token 的 URL） | 页面加载 Client 半端 bundle（`/plugins/dsh-terminal-panel/client.js`）；若安装走 HMR 可无需重启但**刷新页面才能确保新 bundle 生效** `[INF]` |
| 3. 打开一个**已开始**的会话 | 会话头部 View 标签栏出现「终端」，位于「对话」「轨迹」之后 |
| 4. 点击「终端」 | 出现工具栏（`N 个进行中 · M 条记录 · K 个会话`）；无数据时显示空态「本会话还没有命令行活动」 |

关于标签栏的宿主行为（不是 bug）：

- **可用 View 少于 2 个时标签栏隐藏** `[FACT]` ui-conversation README §Shell。
- **blank Session（未发过消息）不渲染 `conversation.view`** `[FACT]` 同上。
- View 选择按会话持久化（宿主机制），上次停在「终端」的会话重启后仍会打开它 `[FACT]`。

## 3. 验证清单

按顺序打勾，每条都给可核对证据：

| # | 检查 | 方法 | 期望 |
|---|---|---|---|
| V1 | 插件已装 | `plugin_manager({action:'list_plugins'})` 或插件列表页 | 有 `dsh-terminal-panel` 条目，状态启用 |
| V2 | Host 行已激活 | `cordis_inspect_query`（Host `Config.listConfigs`，`name:'dsh-terminal-panel'`） | 能查到条目；无 `failed` 诊断 |
| V3 | 路由可用 | 页面 DevTools → Network，点击「终端」tab | `POST terminal-panel/rpc` → `200`，body `{"ok":true,…}`；若 `404` 见 §5 |
| V4 | tab 出现 | 打开已开始会话 | 标签栏有「终端」 |
| V5 | bash 列出现 | 在任意 agent（含子代理）执行一条 bash 命令 | 面板出现一列：类型 Bash + agent chip + 命令 + 实时输出 |
| V6 | 后台任务 | 让 agent 启动一个后台 job（`bash` 的 background 模式 / `job_*` 工具） | 出现「后台任务」列；完成后变 32px 行并倒计时 |
| V7 | 持久终端 | `terminal_open` 后 `terminal_send` | 出现「终端」列（只读文本流） |
| V8 | 自动收起 | 任一任务完成 | 10s 后折叠；鼠标悬停时计时暂停，移出后重新计 10s |
| V9 | 跟随 | 输出区上翻 | 出现「N 条新输出 ↓」；滚回底部自动恢复（不点按钮） |
| V10 | 停止 | 对运行中的 Run 点停止两次（3s 内） | 该 Run 进入终态（killed），不影响其它列 |
| V11 | 筛选/搜索 | 切换 chips、取消会话、输入命令片段 | 本地立即过滤，计数正确，不重新请求全量 |
| V12 | 最大化 | 点列头 `⤢` | 980×600 只读弹窗；Esc 关闭；可复制全部 |
| V13 | 无端口泄漏 | 关闭浏览器页面后观察 Host 日志 | 无持续报错（轮询随页面停止） |

端到端人工验收模板：ui-spec v4 + Figma A–F 六板逐条对照（tester 的 `docs/testing/acceptance-matrix.md` 是正式版）。

## 4. 回滚

按「破坏程度从小到大」：

1. **临时停用（保留安装）**
   `plugin_manager({ action: 'set_bundle', target: 'dsh-terminal-panel', enabled: false })`
   → 刷新页面；tab 消失，Host 路由随插件卸载被撤。`[INF]` 依据 host-plugin.md「set_bundle 切换」。
2. **完全移除**
   `plugin_manager({ action: 'remove_bundle', target: 'dsh-terminal-panel' })`
   → 跟随返回的 `nextStep`（可能需要重启）。`[FACT]` 同上。
3. **手工安装路径的回滚**（仅当用过 §1.1）
   恢复备份的 `~/.dsh/profiles/desktop/package.json` 与 `cordis.patch.yml`（该目录已有 `.bak-*` 历史备份可参考），
   `cd ~/.dsh/profiles/desktop && pnpm install`，重启 DSH。
4. **代码层回退**
   `git -C /Users/lzx/Documents/GitHub/dsh-terminal-panel log --oneline` 找到首个提交，
   `git revert`/`git reset --hard <commit>` 后重装或重启。
5. **数据**：本插件只在内存中保存 Run 注册表与 UI 偏好，**不写 session、不落盘**，卸载无需清理数据 `[INF]`。

回滚验证：刷新页面后标签栏无「终端」；`POST /terminal-panel/rpc` 返回 404；宿主日志无该插件报错。

## 5. 故障排查

| 现象 | 可能原因 | 处置 |
|---|---|---|
| tab 完全不出现 | 会话是 blank Session（未发消息） | 先发送一条消息；这是宿主行为 `[FACT]` |
| tab 不出现（已开始会话） | 可用 View < 2；或插件未启用；或 Client bundle 加载失败 | 查插件列表；DevTools Console 搜 `dsh-terminal-panel`；Network 看 `/plugins/…/client.js` 是否 200 |
| tab 出现但空白/报错 | `lib/client.js` 运行期异常（slot entry crashed） | Console 搜 `slot entry crashed in 'conversation.view'`；`node --check` 后重装 bundle |
| 面板显示「Host 半端未加载」 | Host 行未激活（`inject` 缺 `webServer`/`connection`，或 `lib/index.js` 语法错误） | `plugin_manager` 重装看 `application`；`cordis_inspect_query` 查条目诊断 |
| RPC 404 | 路由未注册 / 页面在子路径且相对 fetch 未命中 | 见 contract §4.1 回退逻辑；T6 用 Network 确认 URL |
| RPC 401/403 | 浏览器 cookie 过期 / Host-Origin 栅栏 | 刷新页面（重新走 token 换 cookie）；检查是否用了非 loopback host `[FACT]` connection README |
| 某个 chip 置灰 | 对应来源服务缺失（jobs/shell/terminals）或 tree 发现失败 | 面板内 tooltip 有原因；在干净 profile 里确认服务存在 |
| 输出不刷新 | 轮询停了（页面隐藏/认证失效/连续失败） | 看面板横幅；恢复可见或按重试 |
| 安装后行为没变 | 替换已安装包需要重启才能加载新 JS 代际 | 重启 DSH 桌面版 `[FACT]` host-plugin.md |

## 6. 卸载的副作用与边界

- 不修改模型可见行为：不注册工具、不写 session、不注入 prompt；唯一写操作是用户点「停止」。
- 若其它插件也注册了 `id: terminal-panel` 或占用 `/terminal-panel/rpc` 路由，安装会失败（路由重复注册抛错）。
  先确认没有同名插件。
- 终端只读：面板不会向 PTY 写任何输入；`terminals.kill` 仅在用户点停止时调用。
