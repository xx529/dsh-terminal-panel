# T1 取证：DSH 三方双端插件 API 与数据通路

> 角色：scout（只读取证）。
> 取证对象：本机安装的 DSH Desktop `0.2.1-rc.2`（`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`）+ 当前 profile `desktop`（`~/.dsh/profiles/desktop`）。
> 标注口径：**Fact** = 有可定位证据（asar 内路径/行号、README 小节、live inspect 返回）；**Inference** = 由 Fact 推导，写明依据；**Assumption** = 未证实，写清验证方式。
> 取证日期：2026-10-26。

---

## 0. 摘要：对 Lead「已核实事实」的复核结果

| Lead 给出的既有结论 | 复核 | 依据 |
|---|---|---|
| asar 未压缩、python 读 8 字节头 + pickle 可取文件 | ✅ 正确。**baseOffset = 8 + uint32@4**（不是 `8 + node.offset`；`node.offset` 是相对数据区） | 本文件 §9 附命令；先错后正的校验过程见回执 |
| `conversation.view` 是 list / session 作用域，内建渲染成会话 tab，注册参数 id/order/label/locale | ✅ 正确，另有 `inject`、`children`、`key/priority`(非本 slot) | §3 |
| host 服务 tools/execute、shell.execute、jobs、terminals、subagents.listDescendants、agentTeams | ✅ 全部存在且在此 profile 已启用；**精确签名见 §4，与猜测有出入**（`terminals.read` 是按行不是按字节；`jobs.readAt` 有 `next` 游标；`tools/execute` 的 `exec.agent` 是可选字段） | §4 |
| client builtins：`ctx.get/on/provide/effect`、`React.createElement`、`styles.insert(css)`、`console` | ⚠️ **部分正确但归属错**：`React`/`console`/`styles`/`host` 是**动态 Cordis 包**（agent 用 `cordis` 工具现场写的代码插件）的闭包符号；`styles.insert` 与 `host.call` **不适用于**我们这种「静态 npm 包双端插件」。静态包的客户端半只有 `require(内置模块表)` + Cordis `ctx` 服务 | §1.4、§2 |
| `host.call(method,args)` = Package 私有 JSON RPC | ❌ **不适用于本插件形态**。`host.call` 仅存在于 `dsh-cordis-client-runner`（动态包）。静态包没有 `host` 内建 | §2；证据 `dsh-cordis-client-runner/README.zh.md`「使用本包」+ `lib/client.js:54-68` |
| remote 服务 jobController/terminalController 存在；**三方能否自声明 ctx.remote 命名空间**未定 | ✅ 存在。**能**：三方 `dsh-vnc-client` 已在用 `TypertRemoteService` + 运行时 `Remote()` 装饰器 + Gateway 自动接管 | §5.2 |
| `tools/execute` 是 waterfall，可拿到 exec.agent.id/name/arguments/signal | ✅ 正确，补充：`exec.agent` **可选**；且该事件是 **waterfall，必须 `return next()`**，观察者不得改动调用标识 | §4.1 |

**一句话结论**：本项目应当采用「**静态双端 bundle + Host 半轮询聚合 + 自建 unary RPC 通道 (`ctx.connection.rpc`, 路径 `/terminal-panel`)**」，**不要**按 `host.call` 设计（那条路只属于运行时动态包）。流式不是必需（设计规格已是 ≤300ms 轮询）。

---

## 1. 三方插件的双端包格式与加载方式

### 1.1 清单字段（Fact）

证据：`dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:40-80`（`parseDshClient` 校验器，逐字段报错文案）、`dsh/node_modules/@deepseek-ai/dsh-experimental-terminal-bundle/package.json`、`~/.dsh/profiles/desktop/node_modules/dsh-context/package.json`、`.../dsh-vnc-client/package.json`。

`package.json` 里与 DSH 有关的字段：

```jsonc
{
  "name": "dsh-terminal-panel",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",          // 浏览器半入口（必须）
    "./locale/*.json": "./locale/*.json",   // 展示元数据/词典（Plugin Manager 读取）
    "./icon": "./icon.svg",                 // 可选；也可用 package.json 顶层 icon
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",                    // 必填 string
      "immediately": true,                  // 可选 boolean；装饰类模板用它保证先挂载
      "inject": ["@deepseek-ai/dsh-client-connection"],   // 可选 string[]
      "external": []                        // 可选 string[]；平台表之外的精确模块请求
    },
    "manifestVersion": 1
  },
  "engines": { "dsh": ">=0.2.0-rc.2 <0.3.0", "node": ">=22" }
}
```

要点（均 Fact）：

- `dsh.bundle.patch` 可以是**一个路径或有序路径数组**（`dsh-package-manifest/README.zh.md`「使用本包」）。
- `dsh.client` 校验极严格：`platform` 必须是 string；`inject`/`external` 必须是 string[]；`immediately` 必须是 boolean，否则抛 `client-modules: <pkg> ... must be ...`（`dsh-client-modules/lib/index.js:57-80`）。
- `dsh.manifestVersion` 当前声明为 `1`；`engines.dsh` 的 SemVer 范围在**安装/启动**时会检查（`@deepseek-ai/dsh/README.zh.md:39`），但 `dsh-package-manifest/README.zh.md` 自承「当前安装器和加载器不强制检查」——**两处文档冲突**，保守写法是写上正确范围。
- **`immediately` 的真实语义 = 启动期预取（prefetch），不是激活开关**（Fact）。shell bundle 里唯一消费点：`async prefetchImmediateTier(){await Promise.all(this.manifest.plugins.filter(e=>e.immediately).map(e=>this.modules.prefetch(e.id).catch(()=>{})))}`（`dsh-web-frontend/dist/assets/index-CN7NIWNw.js`，asar 偏移同 §9.3）。→ 不设置也能正常工作（反证：`dsh-context` 没有 `immediately`，它的 `conversation.view` tab 正常出现）；设置它只是让 bundle 早点下载。
- **`dsh.client.inject` 里必须是真实包名**（Fact）：`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-connection`、`@deepseek-ai/dsh-client-ui-primitives`、`@deepseek-ai/dsh-client-ui-slots` 都确实作为包名出现在 asar 的 `dsh/node_modules/@deepseek-ai/` 下或平台模块表里；`dsh-context` 的 `dsh.client.inject` 就是这组名字的实例（`["@deepseek-ai/dsh-api-remotes","@deepseek-ai/dsh-client-connection","@deepseek-ai/dsh-client-locale","@deepseek-ai/dsh-client-ui-conversation","@deepseek-ai/dsh-client-ui-settings","@deepseek-ai/dsh-client-ui-sidebar-right"]`）。语义：这些包的客户端半**先于**本包加载/注册（`dsh-client-modules/README.zh.md`「让动态提供方先于其消费方加载」）；它不改变运行时 `ctx` 服务注入——服务可用性仍由插件对象的 `inject: ['slots','locale','connection']` 决定。

### 1.2 cordis.patch.yml（Fact）

证据：`dsh-context/cordis.patch.yml`、`dsh-vnc-client/cordis.patch.yml`、`dsh-experimental-terminal-bundle/cordis.patch.yml`、`dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/cordis.patch.yml`。

最小形态（bundle 行 + 由包名自动解析 main）：

```yaml
- insert:
    - id: terminal-panel
      name: 'dsh-terminal-panel'
```

- Host 半 = 该行的 `main` / exports `.`（Cordis 插件：`export function apply(ctx, config)` 或 default 导出 Service class；可 `export const inject = [...]`、`export const Config`）。
- **客户端半不需要在 patch 里登记**：`dsh.client` 声明即可，由 `dsh-client-modules` 自动扫描激活行并注入 `window.__DSH_BOOT__`。
- patch 行 `id` 训练要点：`id` 用于 config 覆盖定位；同 id 覆盖会**整体替换 config**（`references/host-plugin.md`）。

### 1.3 宿主如何加载 / 安装（Fact）

- profile 组合顺序：`dsh.profile.bundles`（含 patch 层） → profile `cordis.patch.yml` → `$DSH_HOME/cordis.patch.yml` → `--patch`（`@deepseek-ai/dsh/README.zh.md:41-46`）。
- 本地目录安装 = `plugin_manager` `install_bundle` (`target` = 绝对包目录) → 写 profile `package.json`（`link:` 依赖）+ 选入 bundles；registry 安装用 `saveExact: true`。**不要手写 profile 的 package.json / patch，也不要自己在 profile 里跑 pnpm**（skill `cordis-plugin-development`，`dsh-plugin-manager/README.zh.md:52,98-100`）。
- 当前 profile 事实：`~/.dsh/profiles/desktop/package.json` 有 `dsh.profile.bundles`（27 项）与 `"patchReload": "live"`；host 侧存在 `hmr` 服务（inspect Service catalog 有 `hmr` 键）→ **配置层热重载是开着的**。

### 1.4 浏览器半的确切格式（Fact）

静态包（我们的形态）客户端 bundle 就是一个 CJS-free 的「懒工厂注册」脚本，**id 必须等于包名**：

```js
// lib/client.js  —— 无 import/export 语法，无 JSX
window.__ModuleLoader__.load({
  id: 'dsh-terminal-panel',
  factory(require) {
    const React = require('react');            // 来自平台模块表
    const h = React.createElement;
    function Panel(props) { /* props 见 §3 */ return h('div', null, '…'); }
    return {
      inject: ['slots', 'locale', 'connection'],   // Cordis 服务名，等待其可用
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('terminal-panel', { zh, en }), 'terminal-panel: dicts');
        ctx.slots.inject('conversation.view', () =>
          ctx.slots.register({
            name: 'conversation.view',
            id: 'terminal-panel',
            order: 30,
            locale: 'terminal-panel',
            label: () => ctx.locale.bind('terminal-panel')('tab.label'),
          }, Panel));
      },
    };
  },
});
```

证据：`dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js`（模板原文）＋ `templates/decoration/package.json`＋ `dsh-context/lib/client.js` 的真实注册块（`id:'context'`、`order:20`、`locale:zu`、`label:()=>t('tab.context')`、组件包裹 `React.createElement(a, props)`）。

**平台模块表（可直接 `require` 的 11 个键，Fact）** —— 从已构建 shell bundle 里直接抄出的表：

```
react | react/jsx-runtime | react-dom | react-dom/client | @deepseek-ai/cordis | zod |
@tanstack/react-virtual | @deepseek-ai/dsh-client-store |
@deepseek-ai/dsh-client-ui-slots | @deepseek-ai/dsh-client-ui-primitives |
@deepseek-ai/dsh-client-ui-dockkit
```

证据：`dsh-web-frontend/dist/assets/index-CN7NIWNw.js` 内 `function SZ(){return{react:sC,"react/jsx-runtime":uC,"react-dom":mC,"react-dom/client":yC,"@deepseek-ai/cordis":Fb,zod:Zj,"@tanstack/react-virtual":Yj,"@deepseek-ai/dsh-client-store":wI,"@deepseek-ai/dsh-client-ui-slots":SI,"@deepseek-ai/dsh-client-ui-primitives":zU,"@deepseek-ai/dsh-client-ui-dockkit":xZ}}`。
其他请求一律要进 `dsh.client.external`（被解析到「某个已启用客户端包 row」或「完全相等的静态表键」）；否则组合期报错（`dsh-client-modules/README.zh.md`「共享模块」）。

> 推论（Inference）：我们**不需要** `external`，只用 react + 自写 DOM + 自注入 `<style>`；若想复用 `dsh-client-ui-primitives`（内建终端块/按钮）则不必声明——它已在平台表里。

### 1.5 最小可加载示例（合成，Fact 组件 + 未安装验证）

见 §10.1。**注意**：本机不允许安装（硬边界「不得改其它文件/不得安装依赖」），故此示例**未做真机加载验证**，标 **Assumption**：验证方式见 §8.3。

---

## 2. `host.call` 到底属于谁？（关键纠偏）

### 2.1 Fact

- `host.call` 只出现在 `dsh-cordis-host-runner` / `dsh-cordis-client-runner` 两个包里（全 asar grep：`host.call` 18 处，全部命中这两包及其内联副本）。
- 官方描述：**"Package-private JSON RPC from Client to this Package's Host half."**，签名 `host.call(method: string, args?: JsonValue): Promise<JsonValue>`（`dsh-cordis-host-runner/lib/index.js` 附近的 builtin 目录，asar 偏移 ~50.29MB 处）。
- 它的接收端是 `harness.handle(method, fn)`，由 **协程动态包**（agent 用 `cordis` 工具写的 `code` + `clientCode`，或 Creator UI 现场运行）使用（`dsh-cordis-client-runner/README.zh.md`「页面会做什么」：「浏览器半用纯 JavaScript 编写……它拿到一组固定的名字——`React`、`console`、`styles` 与 `host`」）。
- 语义（Fact，`dsh-cordis-client-runner/lib/client.js`）：
  - 参数缺省以 `null` 过线（`call: (method,args=null)=>env.invoke(method,args)`）；
  - 双向都只走 JSON；codec 拒收 → 教学错误「did not complete: …」；
  - 路由失败码：`plugin-not-running`（host 半没在跑）、`stale-run`（run 已换）；
  - **只有 unary**（Promise），没有流式参数/回调。
- 静态包（`dsh.client` 双端 npm 包）的客户端半由 `dsh-client-modules` 装载，`factory(require)` 的 `require` 只解析平台表/启动图 row；`ctx` 里没有任何 `host` 服务（模板与三个真实三方包都没有用它）。

### 2.2 Inference

我们的插件是静态包 → **没有 `host.call`**。若 architect 的 contract.md 里出现 `host.call`，必须替换为下面三条之一：

| 通道 | 语义 | 适合 | 证据 |
|---|---|---|---|
| **A. `ctx.connection.rpc`（推荐）** | Host: `ctx.connection.rpc.handle(channel, handler)`；Client: `ctx.connection.rpc.call(channel, endpoint, payload, signal)`。**unary + JSON + 信封**，自动过 Host/Origin 栅栏与浏览器 cookie 认证 | 面板轮询（roster/read/kill/ping） | §2.3 |
| B. `TypertRemoteService`（`@Remote`） → `/api` 通道 | 服务类被 Gateway 自动接管；支持 `{mode:'stream'}` | 需要真流式、且愿意依赖 `@deepseek-ai/dsh-typert-protocol` | §5.2（vnc 先例） |
| C. 裸 HTTP：Host `ctx.webServer.register({kind:'prefix', path, handler})` / `ctx.connection.fetch.register(...)`；Client 直接 `fetch()` | 最简单，自己定 JSON；需自行处理认证/错误 | 下载/简单端点 | §2.4（global-rules 先例） |

### 2.3 通道 A 的精确线上契约（Fact，读取实现得出）

Host 半注册（`dsh-client-connection/lib/index.js:727,855-880,900-950`）：

```js
ctx.inject(['connection'], (host) => {
  const dispose = host.connection.rpc.handle('/terminal-panel', async (endpoint, payload, signal, peer) => {
    // endpoint: 'roster' | 'read' | ...（路径里 /terminal-panel/ 之后的部分）
    // payload: 客户端 call 的第 3 参数（JSON）
    // 返回值必须是 RemoteResult：
    return { ok: true, value: {...} };                    // 成功
    // 或者 { ok: false, error: { code: 'terminal-panel/…', message: '…', details: {} } }
  });
});
```

- channel 必须匹配 `/^\/[A-Za-z0-9._~-]+$/` 且 **不能是 `/api`**（`assertChannel`，`lib/index.js:970-972`）；endpoint 每段 `[A-Za-z0-9_$.-]+`，不能有空段/`.`/`..`（`endpointFromPath`）。
- 只接受 `POST` + `content-type: application/json`（否则 415）、HTTP 401（未认证）/403（Host/Origin 栅栏）；body 必须是 `{type:'client-request', rpcId, method, payload}`；`method` 必须等于 endpoint，否则回 `gateway/bad-request`。
- handler 抛异常 → HTTP 500 纯文本（**不是** JSON 错误帧）；所以 handler 内部要自己 try/catch 并回 `{ok:false,...}`。
- 响应信封：`{type:'server-response', rpcId, result: {ok:true,value} | {ok:false,error}}`；`rpcId` 由客户端生成并校验，不匹配抛错。
- 注册是 **effect 作用域**：`owner.effect(() => owner.webServer.register({kind:'prefix', path: channel, handler: …}))` → 插件卸载自动摘路由。

Client 半调用（`dsh-client-connection/lib/client.browser.js:1232-1260`）：

```js
const res = await ctx.connection.rpc.call('/terminal-panel', 'roster', { sessionId }, signal);
// res === { ok: true, value } | { ok: false, error: { code, message, details } }
```

- 网络层失败（非 2xx）→ 抛 `transport failure for <channel>/<endpoint>: HTTP <status>`；只有 handler 回的业务失败才是 `ok:false`。
- **没有流式**：`rpc.call` 只有 Promise；`open`(stream) 仅限 `/api` 且需要 worker-local stream carrier（`createWebConnectionRpc` 的 `openStream` 是可选的、由 shell 提供的）。

### 2.4 通道 C 的精确契约（Fact，含本机三方先例）

**先例 1（最简单，已安装在本 profile 的三方包：`@local/dsh-popout-window`）**：

- Host（`~/.dsh/profiles/desktop/node_modules/@local/dsh-popout-window/index.js:355-383`）：

```js
ctx.effect(() => ctx.webServer.register({
  kind: 'exact',
  path: '/popout/open',
  handler: async (req, res) => {
    if (req.method !== 'POST') { /* 405 */ }
    const rejection = ctx.connection.requestRejection({ headers: req.headers })  // ← 自己复刻认证栅栏
    if (rejection !== undefined) { /* 401/403 */ }
    const input = await readJson(req)
    // …业务…
    sendJson(res, 200, { ok: true, browser })
  },
}))
```

- Client（同包 `client.js:139`）：**相对路径 fetch**（同源 cookie 自动带上）：

```js
const response = await fetch('popout/open', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})
```

**先例 2（精确 `/api` 路由 + fetch 桥，三方 `dsh-global-rules`）**：

- Host：`ctx.inject(['connection'], host => host.connection.fetch.register({ path:'/api/global-rules', methods:['GET','POST'], requestBody:'buffered', fetch: request => handle(...) }))`（`dsh-global-rules/lib/index.js:114-123`）；`assertFetchRoute` 要求 path 落在 `/api` 下、methods 非空且不重复（`dsh-client-connection/lib/index.js:973-977`）。
- Client：直接 `fetch('/api/global-rules', {...})`（同源 cookie 认证）。

> 结论：**三方包用自建 HTTP 路由 + 同源 fetch 是被实证过的正规做法**；但它不带 RPC 信封/rpcId，也**没有流式**。对面板这种需要多方法 + 关联 id + 统一错误码的场景，通道 A（`connection.rpc`）更合适；通道 C 可作为兜底（例如「下载完整日志」这种文件响应）。

### 2.5 轮询频率建议（Inference）

- 设计规格已定 ≤300ms 合帧；对照内建 controller 的流式推送（jobs/terminal 都是 Remote stream），我们的轮询属于「补偿」。
- 建议：**活跃 run 时 250ms/次，空闲时 1000~1500ms/次；单次响应 ≤256KB，超出标记 `truncated`**；页面隐藏（`document.visibilityState !== 'visible'`）时降到 2s。依据：`rpc.call` 每次一个 HTTP POST，`dsh-client-connection/README.zh.md` 有 `maxRequestBodyBytes` 上限与 Peer 生命周期，未见针对 unary 的频率限制；避免 <200ms 造成 Host 端 header/体解析放大。

---

## 3. `conversation.view` 注册契约

### 3.1 slot 声明（Fact）

`dsh-client-ui-conversation/lib/client.js:19798-19803`：

```js
children: { "conversation.view": { kind: "list", scope: "session" } }
```

### 3.2 注册参数（Fact）

真实注册样例：

- 内建轨迹 tab：`dsh-client-ui-trajectory/lib/client.js:8205-8212` — `{name:'conversation.view', id:'trajectory', order:10, locale:NS, label:()=>t('view.trajectory')}`
- 三方 `dsh-context`：`{name:'conversation.view', id:'context', order:20, locale:'dsh-context', label:()=>t('tab.context')}`（另在 `dsh-context/lib/client.js` 里还有 `id:'fleet'`、`order:30`）
- 内建渲染只消费 `id` 与 `label`：

```js
// viewTabs()  dsh-client-ui-conversation/lib/client.js:19556-19568
for (const entry of slots.entries("conversation.view")) {
  if (entry.options.id === undefined) continue;                       // 无 id 直接跳过
  if (!developerTools.enabled && entry.options.id === "trajectory") continue; // 内建特例
  tabs.push({ id: entry.options.id,
              label: resolveSlotLabel(entry.options.label) ?? entry.options.id });
}
```

| 选项 | 语义 | 备注 |
|---|---|---|
| `name` | `'conversation.view'` | 必须 |
| `id` | tab 稳定 id；缺省则**不渲染** | 我们的 `'terminal-panel'`；也是 view 偏好持久化的 key |
| `order` | tab 顺序 | 内建 10 / dsh-context 20 / fleet 30；建议我们 30（在轨迹之后） |
| `locale` | 词典命名空间 | 存在则注入 `t` prop（见 §3.4） |
| `label` | string 或 `() => string` | `ctx.locale.subscribe(refreshViews)` 会重算；tab 里**只渲染它** |
| `inject` | `(sessionId) => props` 追加注入 | 轨迹用它注入 hooks/loadOlder/setActualDuration |
| `children` | 声明子 slot（本 slot 不需要） | 若声明 session 子 slot 会要求 `SessionProvider` |

### 3.3 行为边界（Fact）

- **tab 条只在 >1 个 view 时出现**：`const showTabs = !hideChrome && tabs.length > 1;`（`:17989`）。→ 单 view 时无 tab 条；我们注册后即 ≥2。
- **blank 会话不渲染 view 区**：`if (session.blank && conversationPhase(session, conversation) === "blank") return null;`（`DefaultConversationViews`，`:17943`）。→ 「新建空会话」时终端面板不会出现，符合预期。
- **只渲染当前激活 view**：`renderSlot("conversation.view", {...}, { only: viewId })`（`:17946`）。→ 切走即卸载组件（我们的轮询定时器会随之清理，注意 `useEffect` 清理）。
- tab 按钮只渲染 `label`（children: viewTab.label，`:18047-18057），**没有 badge/角标 API**。→ 设计里「tab 角标 = 运行中数量」**无法用注册参数实现**（除非 label 返回 ReactNode，见 Assumption）。

### 3.4 View 组件收到的 props（Fact，来自 renderer）

`renderSlot` 传的 owner props（`:17946-17952`）：`inspectCall`、`viewRequest`、`openView`、`completeViewRequest`。

renderer 再叠加（`dsh-client-ui-renderer/lib/client.js:667-760`）：

- session 作用域标准 props（`dsh-client-ui-session/lib/client.js:754-762` 的 BUILTIN_SOURCE）：`sessionId`、`useSession`（selector hook）、`useProjection(key)`；
- `locale` 声明 → `t`；
- 注册时声明 `useStore`/`actions` 才有（本 slot 的注册方没有 store）；
- 注册 `inject` 的返回对象、slot 级注入、owner props 合并：`{...kit, ...injected, ...slotInjected.props, ...contextual, ...ownerProps}` → **owner props 优先级最高**（`:779-790`）。
- **`inject` 的调用与合并规则（Fact）**：注册选项 `inject` 是 `(sessionId) => object`（session 作用域 slot），其返回对象被浅合并进组件 props；因此 `inject: (sessionId) => ({ hooks: {...}, extra: 1 })` 会让组件收到 `hooks`/`extra`。内建轨迹 tab 就靠它注入 `loadOlder`/`loadImage`/`setActualDuration`（`dsh-client-ui-trajectory/lib/client.js:8212-8230`）。注意合并顺序在 **owner props 之前**，同名字段会被 `renderSlot` 的 props 覆盖。

> **对 contract v1 的影响（需 v2 的点）**：
> 1. 若 v1 写了 `host.call`，**必须替换**为 `ctx.connection.rpc`（§2.3）或自建 HTTP（§2.4）。
> 2. 若 v1 设计了「流式订阅/回调帧」，必须改成**轮询 + 游标**（`ctx.connection.rpc` 只有 unary，§2.3）。
> 3. 若 v1 依赖「tab 角标」，必须降级为纯文本 label（§3.3；ReactNode label 未验证）。
> 4. 若 v1 承诺「前台 bash 实时输出」，需按 §4.2 决策 D1 降级或改数据源。

> 所以我们的组件签名：`function TerminalPanel({ sessionId, useSession, t, inspectCall, viewRequest, openView, completeViewRequest })`，用 `useSession` 订阅会话状态（不要自己订阅别的 store）。

### 3.5 Assumption / 未确认

- **A3-1（中）**：`label` 返回 ReactNode（用于嵌数字角标）在类型上可能被接受（tab 直接 `children: viewTab.label`），但没有官方用例；`resolveSlotLabel` 的实现未在 asar 中以独立包形式存在（`@deepseek-ai/dsh-client-ui-slots` 只有声明，实现在 shell bundle 内、已压缩）。**验证**：写一个 `label: () => React.createElement('span', null, '终端 3')` 的试验包，看是否被 `resolveSlotLabel` 接受；失败就让 label 保持纯字符串，计数挪进面板头部。
- **A3-2（低）**：`locale` 未声明时 `t` 不存在；别把 `t` 当必有 prop。

---

## 4. Host 服务精确签名与可用性

> 全部来自 **live inspect**（`cordis_inspect_query` host/Service，本机运行中的 Host，0 网络）：这是「当前 profile 真实可用」的最强证据。类型名保持原文。

### 4.1 `tools` 服务 + `tools/execute` 事件

```ts
// Service tools（inspect 返回）
register(definition: ToolDefinition): () => void
get(name: string, scope?: ScopeKey): ToolDefinition | undefined
schemas(scope?: ScopeKey): ToolSchema[]
executionMode(exec: ToolExecutionInput): ToolExecutionMode
execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>

// 事件（waterfall）
'tools/execute'(this: Scoped<ToolRuntime>, exec: ToolDispatchExecution,
                next: () => Promise<ToolExecutionResult>): Promise<ToolExecutionResult>

interface ToolExecutionInput {
  readonly callId: ToolCallId
  readonly rootCallId?: ToolCallId
  readonly name: string
  readonly schema?: ToolSchema
  readonly arguments: unknown
  readonly agent?: Agent          // ← 可选！可能是 undefined
  readonly parent?: ToolExecutionToken
  readonly signal: AbortSignal
}
interface ToolDispatchExecution extends Omit<ToolExecution, 'signal'> { signal: AbortSignal }
interface ToolExecution extends ToolExecutionInput {
  readonly rootCallId: ToolCallId
  readonly token: ToolExecutionToken
}
interface Agent { readonly id: SessionId }
```

事件文档原文要点（inspect 里的 `description`）：

- 「Around-dispatch waterfall for timeout, retry, or metrics. `next()` returns a normalized result; wrappers may change only `exec.signal`, while call identity remains immutable.」
- 「Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): agent-scoped listeners receive only that agent's calls.」
- 配合 `dsh-scope/README.zh.md:42,75`：「**无标签监听器放行**」→ **在 Host 根 ctx 上用 `ctx.on('tools/execute', …)` 注册的监听器能收到所有 agent（所有会话）的调用**。这是「聚合当前会话 + 子代理 + 队友」的关键前提。

坑（Inference，基于签名）：

1. waterfall **必须** `const result = await next(); return result;`，否则链断。只做记录，**不要**动 `exec.signal`（文档只允许换 signal，但换了就要负责静默与恢复）。
2. `exec.agent` 可选 → 会话归属必须容错：`exec.agent?.id` 缺失时该次调用不能归到任何 session（建议丢弃或归 `unknown`，不要猜）。
3. `exec.arguments` 是 unknown（已 parsed），bash 命令从 `{command, …}` 取；`terminal` 类工具参数不同。

### 4.2 `shell` 服务

```ts
resolve(request: ShellExecRequest): ShellExecSpec
execute(spec: ShellExecSpec): Promise<ShellExecution>

interface ShellExecution extends ShellProcess { result(): Promise<ShellRunResult> }
interface ShellProcess {
  status: 'running' | 'completed' | 'killed'
  exitCode: number | null
  signal: NodeJS.Signals | null
  readonly done: Promise<void>
  sandbox?: ShellSandboxInfo
  readOutput(): ShellProcessRead            // 累计/增量语义由实现定义，见下
  observed: { stdout: SubprocessOutputReader; stderr: SubprocessOutputReader }
  kill(): boolean
}
interface SubprocessOutputReader { readFrom(fromByte: number): SubprocessOutputRead }
interface SubprocessOutputRead { text: string; nextOffset: number; lossy: boolean; spillPath?: string }
interface ShellProcessRead { delta: string; lossy: boolean; stdoutSpillPath?: string; stderrSpillPath?: string }
interface ShellRunResult {
  exitCode: number | null; signal: NodeJS.Signals | null
  timedOut: boolean; aborted: boolean; timeoutMs: number
  stdout: CollectedOutput; stderr: CollectedOutput; sandbox?: ShellSandboxInfo
}
interface CollectedOutput { text: string; truncated: boolean; spillPath?: string }
```

服务描述关键句（inspect）：`execute` 返回句柄后，「前台/后台只是调用方是否 await 的区别」；`onExpiry:'none'` 不设 deadline；「ShellProcess.readOutput is incremental: consecutive reads never repeat output.」

> **重要**（Inference）：`observed.*.readFrom(fromByte)` 与 `readOutput()` 都只在**拿到 ShellExecution 句柄**时可用。三方插件若想拿前台 bash 的增量输出，唯一办法是**包装** `ctx.shell.execute`（在 `apply` 里提供同服务的替身？——但 shell 是「一个上下文一个实现，重复加载会 throw」，见 4.2 描述原文），实际可行的是：
> - 方案 S1：监听 `tools/execute` 记录 `callId ↔ tool name/args`，仅在**自己**能拿到句柄时不成立；所以仍拿不到句柄；
> - 方案 S2：**不改 shell**，前台 bash 的输出来自 `tools/post-execute` / `tools/result` 的 tool result content（`ToolExecutionResult.content`，一次性）+ job 快照；
> - 方案 S3（高风险）：`ctx.inject(['shell'])` 后包装 `ctx.shell.execute` 并返回代理对象（转发 readOutput/observed 同时 tee 给插件）。文档明确「load 第二个实现会 throw」，包装不是新实现而是**装饰现有服务**，Cordis 上通常不可行（服务是只读属性）。
>
> 结论建议给 backend：**不要包装 shell.execute**。数据源改为
> ① `ctx.jobs`（后台 bash 全覆盖，含增量 ring，见 4.3）；
> ② `tools/execute` + `tools/post-execute`（拿到工具名/参数/最终结果，用于「进行中列 + 完成后行」）；
> ③ `ctx.terminals.read`（持久终端，见 4.4）。
> 若产品必须看到前台 bash 的**过程输出**，则需要 architect 明确接受「只有终态输出」或评估 S3 的真实可行性（未验证项，见 §7）。

### 4.3 `jobs` 服务

```ts
readonly events: JobEvents
start(spec: JobSpec): JobId
list(caller?: SessionId): JobView[]
get(id: JobId, caller?: SessionId): JobView
read(id: JobId, caller?: SessionId): JobRead                 // 推进「模型游标」
readAt(id: JobId, from: number, caller?: SessionId): JobOutputRead  // 绝对字节偏移，不动模型游标 ✅
kill(id: JobId, caller?: SessionId, reason?: string): 'requested' | 'already-finished'
wait(id: JobId, timeoutMs: number, caller?: SessionId, signal?: AbortSignal): Promise<JobView>
remove(id: JobId, caller?: SessionId): void
attachController(name: string): () => void

interface JobView {
  id: JobId; kind: string; label: string; owner?: SessionId
  outputLimitBytes?: number
  status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
  progress?: string; detail?: string
  startedAt: number; finishedAt?: number
  output: { total: number; earliest: number; spillPaths?: readonly string[] }
}
interface JobOutputRead { chunks: readonly JobChunk[]; next: number; lossy: boolean }
interface JobChunk { readonly at: number; readonly text: string; readonly channel?: 'stdout'|'stderr'|'log'; readonly gapBefore?: true }
interface JobEvents { subscribe(filter: JobEventFilter, listener: (event: JobEvent) => void): () => void }
type JobEventFilter = { owner: SessionId } | { owners: 'all' | 'scope' }
type JobEvent =
  | { type: 'registered'|'progress'|'stopping'|'removed'; job: JobView }
  | { type: 'settled'; job: JobView; cause: 'producer'|'kill'|'teardown'; awaited: boolean }
  | { type: 'output'; id: JobId; owner?: SessionId; total: number }
```

语义要点（Fact）：

- `readAt(id, from)`：`from` 是**绝对字节偏移**；resume 用上次的 `next`；`from` 落在某个 chunk 内部会返回整个 chunk（其 `at` 可能 < `from`）。
- ring 有上限：低于保留窗口的读返回 `lossy: true`（不是错误），并可用 `spillPaths` 指向完整文件。
- `list/get/read/readAt/kill/wait` 的 `caller` 是**owner 围栏**（「authorization — not secrecy — is the boundary」，`dsh-jobs` 服务描述原文）→ 只要知道目标 sessionId 就能读它的 job。**聚合多家（当前会话/子代理/队友）在服务层是允许的**（Inference：这是设计意图——围栏防误读 id，不防同进程插件；本机未实测跨 session 读）。
- `kind` 目前已知只有 `'bash'`（`JobKindMap`）；后台任务就是 bash job。
- 事件 `{owners:'scope'}` 表示与注册上下文作用域相关的 owner；根 ctx 注册用 `{owners:'all'}` 或按 `owner` 逐个订阅。

### 4.4 `terminals` 服务（只读观看的关键）

```ts
registerBackend(backend: TerminalBackend): () => void
listBackends(): string[]
spawn(owner: Agent, request: TerminalSpawnRequest, signal?): Promise<TerminalSpawnResult>
hasOwnerActivity(owner: Agent): boolean
startSend(owner: Agent, id: TerminalSessionId, request: TerminalSendRequest): TerminalSendOperation
read(owner: Agent, id: TerminalSessionId, request?: TerminalReadRequest): TerminalReadResult
signal(owner: Agent, id: TerminalSessionId, signal: TerminalSignal): Promise<TerminalSignalResult>
kill(owner: Agent, id: TerminalSessionId, reason?: string): Promise<boolean>
list(owner: Agent): TerminalSessionSnapshot[]

interface TerminalReadRequest { offset?: number; count?: number }         // newest-relative 行偏移
interface TerminalReadResult {
  text: string; totalLines: number; lineBegin: number; lineEnd: number; truncated: boolean
}
interface TerminalSessionSnapshot {
  sessionId: TerminalSessionIdValue; name?: string; type: string; pid?: number
  status: { kind:'running' } | { kind:'exited'; exitCode: number|null; signal: NodeJS.Signals|null }
}
```

- **`read` 的窗口语义（Fact，逐行读实现得出，`dsh-terminal-bash/lib/index.js:582-611`）**：

```js
const snapshot = this.scrollback.snapshot()          // 保留的 scrollback 全文
const lines = snapshot.text.split("\n")
const totalLines = snapshot.text.length === 0 ? 0 : lines.length
const offset = request.offset ?? 0                   // 非负安全整数，否则 throw
const count  = request.count  ?? 500                 // 正整数，否则 throw
if (offset >= totalLines) return { text:"", totalLines, lineBegin:offset, lineEnd:offset, truncated:snapshot.truncated }
const end   = totalLines - offset                    // ← 页面「锚定在距离最新处 offset 行」
const start = Math.max(0, end - count)
const bounded = utf8Tail(lines.slice(start, end).join("\n"), this.config.maxReadBytes)
const returnedLines = bounded.text.length === 0 ? 0 : bounded.text.split("\n").length
return { text: bounded.text, totalLines, lineBegin: offset, lineEnd: offset + returnedLines,
         truncated: snapshot.truncated || bounded.truncated }
```

  - `offset = 0` → **最后 count 行**（尾页）；`offset = 500` → 再往前 500 行。**offset 是「距最新多少行」**，不是绝对行号。
  - `lineBegin/lineEnd` 也在**「距最新行数」坐标系**里：`lineBegin = offset`、`lineEnd = offset + 实际返回行数`。要换成绝对行号：`absoluteEnd = totalLines - lineBegin`、`absoluteBegin = totalLines - lineEnd`。
  - 翻页：下一次 `offset = 上一次 lineEnd`（即 `offset += count`）。
  - **增量**：比较两次 `totalLines` 的差 `k`，拉 `{offset:0, count: max(k,1)}`（至少 1 行，因为 PTY 会用 `\r` 重写当前行），用文本尾重叠去重。
  - `truncated` 的含义是「scrollback 曾被裁剪 或 本次被 `maxReadBytes` 截断」，**不是**「分页没取完」——分页是否取完看 `lineEnd >= totalLines`。
  - 默认 `scrollbackLines = 10000`、`scrollbackMaxBytes = 4MiB`（`dsh-terminal-bash` Config）。
- 需要 `owner: Agent` → 跨会话读取前必须先拿到该会话的 Agent：`ctx.agents.get(sessionId)`（`agent 服务` inspect：`get(id: SessionId): Agent | undefined`）。
- 没有事件/订阅面（服务里没有 `events`），只能轮询。

### 4.5 `subagents` / `agentTeams`（会话树）

```ts
// subagents
listChildren(parentSessionId: SessionId, signal?): Promise<SubagentCatalogEntry[]>
listDescendants(rootSessionId: SessionId, signal?): Promise<SubagentDescendantListEntry[]>

type SubagentDescendantListEntry = SubagentListEntry & { readonly parentId: SessionId; readonly depth: number }
type SubagentListEntry =
  | (SubagentCatalogRow & { kind:'child'; hasChildren: boolean })
  | { kind:'diagnostic'; id: SessionId; reason:'corrupt'|'unsupported'|'unavailable' }
type SubagentCatalogRow = { id: SessionId; activity: 'running'|'inactive' } &
  ( { mode:'one-shot'; label?: string } | { mode:'external'; label?: string }
  | { mode:'continuable'; label: string } )

// agentTeams
membership(agent: Agent): TeamMembership
listMembers(agent: Agent): TeamMemberView[]
tryMembership(agent: Agent): TeamMembership | undefined

interface TeamMembership { root: Agent; id: TeamId; role: 'lead'|'teammate'; name: string }
interface TeamMemberView {
  id: SessionId; name: string; role: 'lead'|'teammate'
  status: 'running'|'inactive'|'provisioning'|'failed'
  description?: string; provider?: string; context?: 'fresh'|'fork'; model?: string
  diagnostics: string[]
}
```

- `listDescendants` **不加载/不 resume Agent**，读的是 durable catalog；root 读失败会整体 reject；某分支坏掉只产生 `diagnostic` 行并停止该分支。
- `agentTeams.listMembers(agent)` 需要**一个 live 的 Team 成员 Agent** 作凭据；对「当前会话是不是 Team Lead / 是不是 teammate」，用 `tryMembership(agent)`（不抛异常，非 Team subagent / 过期身份返回 undefined）。
- **归属必须按 sessionId**（`TeamMemberView.id` 就是 SessionId），不要按 name 猜。

### 4.6 `sessions` / `agents`（枚举与凭据）

```ts
// sessions
get(id: SessionId): Session | undefined
list(): Session[]                       // 所有 live session，按创建顺序
// agents
get(id: SessionId): Agent | undefined
list(): Agent[]
roots(): Agent[]
```

用途：面板要覆盖「当前会话 + 子代理 + 队友」时，用 `agents.get(sessionId)` 换 `terminals.read` 的 `owner` 凭据；用 `sessions.list()` 判断 live 集合。

### 4.7 `sessionController` / `jobController` / `terminalController`（Remote 基因）

| 服务 | 可用面 | 说明 |
|---|---|---|
`jobController` | `@Remote` 的 `list`/`follow`(stream)/`kill` | 浏览器端 `dsh-api-job-controller` 的客户端半把它包装成 `ctx.jobs` 客户端服务 |
`terminalController` | `list` / `retain`(stream) / `attach`(stream, 双向) / `shells` / `environment` / `rename` / `close` | 这些是**给 Client 消费的 Remote**；Host 插件之间直接用 `ctx.terminals` 更简单 |
`sessionController` | 会话列表/状态等 Remote | 内建 UI 用推流保持会话列表 |

（完整签名可用 `cordis_inspect_query` 现场复现，见 §9.2。）

---

## 5. 终端只读观看的最优路径

### 5.1 两条路径的差异（Fact）

| | Host 侧 `ctx.terminals.read` | Client 侧 `terminalController` Remote（`retain`/`attach`） |
|---|---|---|
| 传输 | 进程内调用 | HTTP POST unary / WebSocket mux stream |
| 数据 | **按行** scrollback 分页（`text/totalLines/lineBegin/lineEnd/truncated`） | `TerminalRetentionFrame` 流（保留/屏幕）/ `TerminalFrame` 流（含输入上行） |
| 订阅 | 无，必须轮询 | 有，真流式 |
| 认证 | 进程内（无） | 浏览器 cookie / API Peer + Host/Origin 栅栏 |
| 风险 | 无输入面 | `attach` 是**双向**（`RemoteStream<TerminalFrame, TerminalInput>`），误用会向 PTY 写输入 |
| 三方可用性 | ✅ host half 直接调用 | ⚠️ 需要客户端能拿到 `ctx.remote.terminal` 或 `ctx.webTerminals`（内建 controller 的客户端服务） |

**结论（Inference）**：本项目「只读、聚合多会话、轮询」的诉求 → **Host 半轮询 `ctx.terminals.read`**，把文本随 RPC 帧发给 Client。不要用 `attach`（双向，且需要 PTY 流协议），除非后续要做真流式。

### 5.2 三方能否自声明 `ctx.remote` 命名空间？——**能，已有先例**（Fact）

`~/.dsh/profiles/desktop/node_modules/dsh-vnc-client`（第三方 github 插件，v0.8.x，未编译 TS，纯 JS）的 Host 半：

```js
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

// V8 decorators 关闭，@Remote(...) 是语法错误 → 运行时调用装饰器
function declareRemote(Proto, method) {
  const initializers = []
  Remote(method)(void 0, { name: method, static: false, private: false,
                           addInitializer(i){ initializers.push(i) } })
  initializers[0].call(Object.create(Proto.prototype))
}

class VncTargetsService extends TypertRemoteService {
  static inject = ['vncBridge']
  constructor(ctx) { super(ctx, 'vnc') }      // ← 命名空间 = 'vnc'
  async listTargets() { … }
  async resolveTarget(request) { … throw new RemoteError('vnc/unknown-target', …) }
}
declareRemote(VncTargetsService, 'listTargets')
…
ctx.plugin(VncTargetsService)
```

**关键注释原文**：「Saved-server management … **Auto-claimed by the Gateway, so no route or permission is needed.**」
客户端（同一插件的 `lib/client.js`）：

```js
ctx.connection.rpc.call('/api', 'vnc/' + method, { args: { request } })
  .then(result => { if (result?.ok !== true) throw …; return result.value })
```

即：自建 Remote 命名空间后，浏览器端**不需要生成代码**也能用 `/api` 通道按 `<namespace>/<method>` 调用；参数用 `{ args: { request } }`（命名参数对象）；失败帧 `{ok:false,error:{code,message,details}}`。

> Inference：这条路可行但比通道 A 复杂（要用 `@deepseek-ai/dsh-typert-protocol`、`/api` 通道名与 Gateway 的参数装箱约定），且 `vnc` 的先例依赖 Gateway 对 `/api` 的 interceptor/claim 行为。**建议**：面板用通道 A（`/terminal-panel` 自有 channel），把 `ctx.remote` 自声明列为「若将来要真流式」的备选。

### 5.3 若确实需要流式（Inference，两个可选实现）

1. **WebSocket upgrade 路由**：`ctx.webServer.registerUpgrade({ path, handler })` + 自己用 `ctx.connection.admit(request)` 复刻 Gateway 的栅栏认证（vnc 先例，`dsh-vnc-client/lib/index.js:260-292`）。风险：自己维护 WS 帧/背压/重连。
2. **TypertRemoteService + `@Remote({mode:'stream'})`**：由 Gateway 托管流生命周期，但客户端消费需要 Gateway stream 客户端（`ctx.remote` 生成物或 `/api` mux WebSocket 直连），三方集成成本高。

---

## 6. 可复用参考实现

| 参考包（本机路径 / asar 路径） | 可复用什么 | **不可直接依赖的内部 API** |
|---|---|---|
`~/.dsh/profiles/desktop/node_modules/dsh-context`（三方，双端 + conversation.view + locale） | ① `conversation.view` 注册形态（id/order/locale/label 函数）② `ctx.locale.register/bind` + `locale.subscribe` 触发 tab 文案刷新 ③ 双端包最小 patch 写法（patch 只 insert 一行）④ 静态 bundle 里自注入 `<style data-plugin-css>`（它把 tailwind 产物塞进 `document.head`）⑤ 用 `ctx.effect` 包裹注册以支持启停 | 它没有依赖任何私有内部包——这点本身是「可复刻」的证据；但它的 484KB client bundle 是 esbuild 产物，**不要 copy 其压缩代码**，只抄形态 |
`dsh-client-ui-jobs`（内建） | ① 「会话头部入口 + 展开才开流」的按需订阅模式 ② `ctx.jobs` 客户端服务（`job.list` 名册流 / `job.follow` 观测流 / `job.kill`）③ 分组与 `detail`/`progress` 展示字段 ④ 「捕获流中断/保留缺口提示」的降级 UX | `MenuSurface`、`ui-primitives` 内部组件（`TerminalBlock` 可经平台表 `require('@deepseek-ai/dsh-client-ui-primitives')` 使用，但**其 props 契约未在文档中给出**，属未确认项） |
`dsh-client-ui-sidebar-terminal`（内建） | xterm 渲染、fit/resize、终端头/复制、`retain`/`attach` 的用法示范 | 它用 `ctx.webTerminals`（`dsh-api-terminal-controller` 的客户端服务，`super(ctx,'webTerminals')`）；我们的 Host 半轮询方案不需要它 |
`dsh-better-sidebar/lib/client-terminal.js`（三方，233 处 xterm） | **三方包如何集成 xterm**（require 路径、样式、fit）——最接近的现成样板 | 它同时是输入终端，逻辑不能直接搬；xterm 本体需要 `dsh.client.external` 或自带打包 |
`dsh-vnc-client`（三方） | ① 三方自建 unary RPC 的完整链路 ② 三方自建 Remote 命名空间 + 运行时 `Remote()` 装饰器 ③ `ctx.connection.admit` 做 WS 升级认证 ④ 「Host 半不解析业务协议、只搬运字节」的边界 | 它的 `declareRemote` 技巧依赖 `@deepseek-ai/dsh-typert-protocol` 的导出面；DSH 升级可能改 |
`dsh-global-rules`（三方） | 最简单的精确 `/api` fetch 路由 + 前端 `fetch`（不想要 RPC 信封时的模板） | — |

---

## 7. 运行/测试环境（本机实测）

| 项 | 值 | 证据 |
|---|---|---|
| node | **v22.22.2**（nvm） | `node -v` |
| pnpm | **11.22.0** | `pnpm -v` |
| npm | 10.9.7 | `npm -v` |
| python / uv | 3.13.12 / 有 | `python3 -V`, `which uv` |
| `node --check` | 可用（ESM `.mjs`） | `printf 'export function apply(){}\n' > /tmp/t.mjs; node --check /tmp/t.mjs` → 0 |
| workspace 依赖 | **无 node_modules、无 git 仓库**（task-2 才 init） | `ls`、`git status` → `fatal: not a git repository` |
| 网络 | **可达**：`registry.npmjs.org` HTTP 200 | `curl -sS -m 6 -o /dev/null -w "%{http_code}" https://registry.npmjs.org/react` |
| react 本地副本 | **没有现成可用**：profile `node_modules` 顶层无 `react`；asar 的 `dsh/node_modules` 无 `react`；React 只在 `dsh-web-frontend/dist` 的 shell bundle 里被内联 | `ls`/asar 遍历 |
| `--dsw-alias-*` 主题令牌 | 实测 **55 个**（暗/亮由 shell 根属性切换） | 从 `dsh-web-frontend/dist/assets/index-BxpfOGf3.css` 提取 |
| 测试框架 | `node:test` 内建（Node 22） | 标准能力；本机未装 vitest/jsdom |

**无网络也能跑**的测试方案（Inference，依据上表）：

1. 纯逻辑用 `node --test`（Node 内建，零依赖），**不 import React**；把状态机/游标/格式化拆成 `lib/client/*.mjs`、`lib/host/*.mjs`。
2. 组件渲染测试用 **React stub**：焊接 `require` 为 `{createElement: (t,p,...c)=>({type:t,props:p,children:c})}`，断言树结构；或干脆只测纯函数 + 一个 `apply()` 装配测试（mock `ctx`，断言注册了哪些 slot / effect 清理）。
3. RPC 端到端：mock Host 的 `ctx.connection` 与 client 的 `ctx.connection.rpc.call`，驱动「轮询 → 帧 → 状态迁移」序列；不需要真 DSH 进程。
4. 真实 React（若后续要）可用网络 `pnpm add -D react react-dom`——但**本任务边界禁止安装**，且引入 React 会带来 SSR/act 复杂度；建议长期保持 stub 方案。

---

## 8. 安装、生效与回滚

### 8.1 安装（Fact，来自 skill + plugin-manager 实现）

- **正规路径**：`plugin_manager` `action: install_bundle, target: <绝对包目录>`（本地目录 → `link:` 依赖）；registry 目标用 `saveExact: true`。该动作是 DSH 授权入口，会写 profile `package.json`（dependencies + `dsh.profile.bundles` 选入）、跑 pnpm、发布 runtime resolution（`dsh-plugin-manager/README.zh.md:52`：「开发目标保留普通 `link:` 依赖」；skill `cordis-plugin-development`：「Do not write the profile's package.json or cordis.patch.yml … `install_bundle` performs those steps」）。
- **不要**手改 profile 的 `package.json` / `cordis.patch.yml`，不要自己在 profile 跑 pnpm；`install_bundle` 等操作在非 Full access 下需要用户批准。
- **返回类型 `ChangeResult`（Fact，`dsh-plugin-manager/lib/typert.host.js` 的声明原文）**：

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

  - `application` 是**是否已生效的唯一判据**（不是日志、不是进程列表）：`applied` = 已在当前运行组合里挂上；`restart-required` = 需重启（看 `restartReason`）；`overridden` = 被更高优先级层覆盖；`failed` = 激活失败（看 `error`，插件文件修好后下次操作会重新导入）；`cancelled` = 用户取消。
  - `pendingBuilds` 非空 = pnpm 11 拦下了依赖构建脚本，需要用户批准后带 `approvedBuilds` 重试（skill 明令：只在用户在对话中明确批准后传）。
  - 安装失败会恢复 `package.json` + `pnpm-lock.yaml`（`dsh-plugin-manager/README.zh.md:60`）；**已装成功后再激活失败不撤销安装**。

### 8.2 生效（Fact）

| 变更类型 | 是否免重启 | 证据 |
|---|---|---|
| 配置层（patch/config） | ✅ 即时（本 profile `patchReload: "live"` + `hmr` 服务在跑） | `@deepseek-ai/dsh/README.zh.md:37`、profile package.json |
| **启用/停用插件行** | ✅ 即时（普通插件启停无需刷新页面或重启 Host） | `dsh-client-hmr/README.zh.md`「概述」 |
| **替换已安装包的代码**（同 spec 新版本） | ❌ 需要重启；HMR 模式下要先卸载再安装，旧版本先停 | `dsh-plugin-manager/README.zh.md:100,141`；「没有 HMR 时，替换包需要重启进程」 |
| 客户端 bundle 重建 | ✅ 页面级热替换（`rebuilt` 帧 → 换模块 → 重挂），但**React 状态丢失**；仅当有 bundle watcher（`pnpm run dev:web`）在跑 | `dsh-client-hmr/README.zh.md`「一次重载做什么」「启动重载链路」 |
| 页面刷新 | 总是安全；不会恢复动态 Cordis 定义（与静态包无关） | `dsh-cordis-client-runner/README.zh.md` |

**开发循环建议**（Inference）：workspace 目录 `link:` 安装一次后，
- 改 Host 半 `lib/index.js` / `lib/host/**`：**重启 DSH**（Desktop 就是退出重开）后生效；
- 改 Client 半 `lib/client.js`：同样需要重启 + 刷新页面（除非同时跑 `pnpm run dev:web` watcher，且我们的包在 watcher 的监视范围内——未验证）；
- 改 `cordis.patch.yml` / `package.json`：配置层 live reload 可能即时，但为确定性仍建议重启核对。

### 8.3 回滚（Fact + 操作步骤）

1. `plugin_manager action: set_bundle, target: dsh-terminal-panel, enabled: false` → 关闭组合包（配置层即时、不卸载依赖）。
2. `plugin_manager action: remove_bundle, target: dsh-terminal-panel` → 卸载（取消选入 → 摘运行贡献 → `pnpm remove`）。
3. 本机 profile 有手工备份惯例：`~/.dsh/profiles/desktop/{package.json,cordis.patch.yml}.bak-*`（27 个历史备份），可作为最后兜底；但**不要**用脚本改 profile，让 `plugin_manager` 做。
4. 插件自身必须**幂等 + 可清理**：所有 `ctx.effect`/`ctx.on`/定时器/`<style>` 都要在 dispose 时归还（slot 卸载、路由摘除、终端轮询停止），否则「停用」不彻底——`dsh-client-hmr` 的失败策略说明「旧 fiber 被卸载后新 bundle 导入失败不会恢复旧版」，清理不彻底会留脏 DOM。

### 8.4 未验证（Assumption）

- **A8-1**：`link:` 安装后，`dsh.client` 的 `/plugins` 路由是否能服务 workspace 里**未经过 tsdown 构建**的手写 `lib/client.js`。证据链上应该可以（client-modules 只读 `lib/client.js` 产物，不关心构建方式；模板本身就是手写 JS）。**验证**：安装最小骨架后刷新页面，看 `window.__DSH_BOOT__` 是否含我们的行、Network 里 `/plugins?…` 是否 200。
- **A8-2**：Desktop 重启方式（托盘退出/⌘Q）。未实测，避免在取证阶段动用户环境。

---

## 9. 取证方法与可复现命令

### 9.1 asar 正确读法（先写对 baseOffset）

```python
# python3
import json, struct
P = "/Applications/DeepSeek Harness.app/Contents/Resources/app.asar"
with open(P, 'rb') as f:
    h = f.read(8)                                   # [u32=4][u32=pickle_size]
    size = struct.unpack('<I', h[4:8])[0]
    body = f.read(size)
    jl = struct.unpack('<I', body[4:8])[0]          # pickle: [u32 payload][u32 json_len][json]
    HEAD = json.loads(body[8:8 + jl].decode())
BASE = 8 + size                                     # ← 文件数据区起点
def read(path):
    n = HEAD
    for p in path.strip('/').split('/'): n = n['files'][p]
    with open(P, 'rb') as f:
        f.seek(BASE + int(n['offset'])); return f.read(n['size'])
print(read('dsh/node_modules/@deepseek-ai/dsh/package.json')[:120])
```

> 常见错误：`f.seek(8 + node.offset)`（漏掉 header 长度）会读出**错位内容**——本任务第一版脚本就踩了，表现为 README 内容是 zod 测试片段。校验方法：任取一个 `package.json`，解析必须成功且 `name` 正确。

### 9.2 live inspect（Host 侧可用，Client 侧本次超时）

```
cordis_inspect_list()
cordis_inspect_query {platform:'host', provider:'Service', method:'listService'}            # 目录
cordis_inspect_query {platform:'host', provider:'Service', method:'listService', input:{service:'terminals'}}
cordis_inspect_query {platform:'host', provider:'Event',   method:'listEvents'}
cordis_inspect_query {platform:'host', provider:'Event',   method:'listEvents', input:{event:'tools/execute'}}
```

- 本次 **host 侧全部成功**（返回即本文 §4 的类型原文）。
- **client 侧全部 10s 超时**：`Slots.listSubTree` / `Builtin.listBuiltins` 均报 `Client inspect query … timed out after 10000ms. Open or reconnect the Harness page`。→ 说明当时**没有已连接的页面**。影响：`conversation.view` 的 props 与行为是从 `dsh-client-ui-conversation` / `dsh-client-ui-renderer` / `dsh-client-ui-session` 源码读出来的（等价可信），但**「live slot 的注入 props 实际值」未用 inspect 复核**——列入 §11 待复核项。

### 9.3 关键证据索引

| 结论 | 证据位置 |
|---|---|
| `dsh.client` 字段校验 | `asar:dsh/node_modules/@deepseek-ai/dsh-client-modules/lib/index.js:40-80` |
| 平台模块表 11 键 | `asar:dsh/node_modules/@deepseek-ai/dsh-web-frontend/dist/assets/index-CN7NIWNw.js`（函数 `SZ`） |
| 客户端 bundle 形态 | `asar:.../dsh-agent-preset/skills/cordis-plugin-development/templates/decoration/client.js` |
| `host.call` 仅动态包 | `asar:.../dsh-cordis-client-runner/README.zh.md` + `.../lib/client.js:54-68` |
| rpc unary 契约 | `asar:.../dsh-client-connection/lib/index.js:727,855-950`；`lib/client.browser.js:1232-1310` |
| conversation.view 声明/注册/行为 | `asar:.../dsh-client-ui-conversation/lib/client.js:17940-18060,19556-19620,19798` |
| View props / scope props | `asar:.../dsh-client-ui-renderer/lib/client.js:667-790`；`.../dsh-client-ui-session/lib/client.js:754-762` |
| 服务签名 | live inspect（§9.2），对应包 README：`dsh-shell`、`dsh-jobs`、`dsh-terminal`、`dsh-subagent`、`dsh-experimental-agent-team` |
| `TypertRemoteService` 三方先例 | `~/.dsh/profiles/desktop/node_modules/dsh-vnc-client/lib/index.js:1-270`、`lib/client.js:2752-2762` |
| 无标签监听器全局可见 | `asar:.../dsh-scope/README.zh.md:42,75` + `tools/execute` inspect description |
| 安装/热加载/回滚 | `asar:.../dsh-plugin-manager/README.zh.md:52,60,98-102,141`；`dsh-client-hmr/README.zh.md`；`dsh/README.zh.md:20,37-48` |

---

## 10. 给 architect 的接口建议

### 10.1 最小可加载骨架（未真机安装，Assumption 已在 §8.4 标注）

`package.json`：

```json
{
  "name": "dsh-terminal-panel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Session-scoped terminal panel: live bash / background jobs / persistent terminals.",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./locale/*.json": "./locale/*.json",
    "./icon": "./icon.svg",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "locale/*.json", "icon.svg"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "inject": ["@deepseek-ai/dsh-client-connection"] },
    "manifestVersion": 1
  },
  "engines": { "dsh": ">=0.2.1-rc.2 <0.3.0", "node": ">=22" }
}
```

`cordis.patch.yml`：

```yaml
- insert:
    - id: terminal-panel
      name: 'dsh-terminal-panel'
```

`lib/index.js`（Host 半骨架）：

```js
export const inject = ['connection']            // 只要 connection；其余用 ctx.get 容错
export function apply(ctx, config) {
  ctx.inject(['connection'], (host) => {
    ctx.effect(() => host.connection.rpc.handle('/terminal-panel', handler), 'terminal-panel: rpc')
  })
}
```

`lib/client.js`（Client 半骨架）：见 §1.4。

### 10.2 建议的 RPC 契约 v1（通道 A）

channel：`/terminal-panel`；请求体统一 `payload = {v:1, …}`；响应 `{ok:true,value}` / `{ok:false,error:{code,message,details}}`。

| endpoint | 入参 | 返回（`value`） |
|---|---|---|
| `ping` | `{}` | `{hostVersion, now, availability:{jobs:boolean, terminals:boolean, subagents:boolean, agentTeams:boolean, shell:boolean}}` |
| `roster` | `{sessionId, includeDescendants?:true, includeTeam?:true}` | `{scope:{root,sessions:[{sessionId,label,kind:'root'\|'subagent'\|'teammate',parentId?,depth?,status}]}, runs:[RunFrame], nextCursor}` |
| `read` | `{sessionId, cursors:{runId:offset\|line}, includeCompleted?:boolean, limitBytes?:262144}` | `{runs:[RunFrameWithDelta], cursor:{…}, truncated:boolean, availability}` |
| `kill` | `{sessionId, kind:'job'\|'terminal', targetId, reason?}` | `{result:'requested'\|'already-finished'\|'closed'}` |

`RunFrame`（建议字段）：

```ts
type RunFrame = {
  runId: string                 // `${kind}:${id}`
  kind: 'bash-foreground' | 'job' | 'terminal'
  sessionId: string             // 归属会话（root/subagent/teammate 一致）
  agentName?: string            // 从 agentTeams/subagents 目录解析，缺失就不显示
  command?: string              // job.label / bash 参数 / terminal name
  status: 'running' | 'stopping' | 'completed' | 'failed' | 'killed'
  startedAt: number; finishedAt?: number
  exitCode?: number | null; signal?: string | null
  progress?: string; detail?: string
  output: { channel: 'stdout'|'stderr'|'log'; text: string; at: number }[]  // 本帧增量
  outputCursor: number | string // jobs: 绝对字节 next；terminal: lineEnd
  lossy?: boolean
  truncated?: boolean
}
```

游标语义（照抄上游语义，别无正则）：

- **job**：`readAt(id, from)` → 回 `chunks[*].at`、`next`、`lossy`；把 `next` 当不透明整数存；`lossy` 时前端提示「输出被截断（保留窗口外）」。
- **terminal**：无字节游标 → 回 `totalLines` + `lineBegin/lineEnd`（二者在「距最新行数」坐标系，见 §4.4）；前端每轮留 `totalLines` 基线，`k = totalLines_new - totalLines_old`，再拉 `{offset:0,count:max(k,1)}` 取尾部新增行，按行文本尾重叠去重；上翻看历史用 `offset += count`。`truncated:true` 时提示「scrollback 已被裁剪」。
- **foreground bash**：无增量句柄（§4.2 结论）→ 只在 `status` 变化时给终态 `result` 文本（来自 `tools/post-execute` 的 `content` 摘要），并在 `detail` 标注「仅终态」。

降级要求：每个源单独 `availability`，缺服务就返回 `{available:false, reason}`，**不要抛异常**（`ctx.get(name)` 返回 undefined 是常态，见 inspect 的 `access.optional`）。

### 10.3 必须在 contract.md 里明确写下的三条硬约束

1. **没有 `host.call`**，Host↔Client 只有 `ctx.connection.rpc`（unary）或自建 Remote/WS；contract 不要写成「host.call」。
2. **没有流式 unary**：前端必须是轮询模型（≤300ms 合帧 + 退避 + visibility 降频），不能设计「订阅回调」。
3. **tab 没有 badge API**：设计稿的「tab 角标 = 运行中数量」需降级为 `label: '终端'`（纯文本）+ 面板内计数；若 A3-1 验证通过才可用 ReactNode label。

### 10.4 需要 architect 决策的两个点

- **D1「前台 bash 过程输出」**：接受「只有终态」吗？若必须过程输出，唯一现实路径是「让用户用后台 job（`run_in_background`）→ 走 `ctx.jobs` 增量」，或在 contract 里标注为 P2 并单独立项验证 shell 包装。
- **D2「终端流式」**：v1 轮询 `terminals.read` 够用吗？（建议够：设计是只读观看，最多 1s 刷新；PTY 输出很快时按行 diff 也够。）

---

## 11. 给 backend 的坑位清单

1. **不要包装 `ctx.shell.execute`**：`shell` 是「一个上下文一个实现，重复提供会 throw」的抽象服务；包装会污染 agent 的工具行为，且拿不到别人创建的句柄（§4.2）。
2. **`tools/execute` 是 waterfall**：必须 `return await next()`；只允许改 `exec.signal`，别改 `callId/name/arguments`。异常/中断会污染工具链。
3. **`exec.agent` 可选**：`exec.agent?.id` 缺失时不要猜归属（§4.1 类型）。
4. **`jobs.readAt` 用 `next` 不透明游标**；`from` 在 chunk 中间会重发整 chunk，必须按 `chunk.at + text.length` 去重；`lossy:true` 不是错误。
5. **`jobs.*` 的 `caller` 是围栏不是身份**：聚合队友/子代理时传**目标 sessionId**（不是当前会话 id）；传错会 throw（unknown/foreign）。
6. **`terminals.read` 要 `owner: Agent`**：先 `ctx.agents.get(sessionId)`；`undefined` 说明该会话已不在 live registry → 降级为「会话已结束」而不是报错。
7. **`terminals.read` 按行**，`offset` 是 newest-relative；不要用字节偏移混用（和 jobs 的字节游标完全不同）。
8. **`terminals.read` 无订阅**：轮询 + 行 diff；`truncated:true` 表示这一页不完整（`count` 太大），要分页取。
9. **`subagents.listDescendants` 会随分支损坏返回 diagnostic 行**；`kind:'diagnostic'` 行没有 `activity` 字段，别直接读。
10. **`agentTeams.listMembers/tryMembership` 需要一个 live Agent**；对「当前会话自己」用 `ctx.agents.currentInitiator()`（ToolRuntime 链上的 initiator）或 slot 的 `sessionId` 换 `agents.get`。`tryMembership` 对非 Team 会话返回 undefined（不抛）。
11. **所有可选服务都走 `ctx.get(name)` + undefined 检查**：本 profile 启用了 `dsh-experimental-terminal-bundle` 与 agent-team profile，但**别的 profile 不一定**；插件必须能在只有基础服务时降级。
12. **别在 `apply` 顶层做订阅**：全部放 `ctx.effect(() => { … return dispose })`，否则 HMR/停用留脏监听（`dsh-client-hmr` 失败策略）。
13. **RPC handler 自己 try/catch**：handler 抛异常 → HTTP 500 纯文本，前端只会得到 `transport failure`，丢掉错误语义。
14. **单次响应设上限**：`dsh-client-connection` 的 `/api` 有 `maxRequestBodyBytes`（默认 300MiB）但 unary 响应没有明确上限；自己截断到 ≤256KB 并在帧里 `truncated:true`。
15. **`owner` 概念别混淆**：`jobs.owner` 是 SessionId；`terminals.read` 的 `owner` 是 Agent 对象；`TeamMembership.root` 是 Agent。

## 12. 给 frontend 的坑位清单

1. **没有 JSX/TS 编译**：`lib/client.js` 必须是手写 JS + `window.__ModuleLoader__.load({id, factory})`，`id` 必须等于包名；不能 `import` 任何模块（`require` 只允许平台表 + `dsh.client.external` 声明的键）。
2. **能 `require` 的只有 11 个**（§1.4）；`require('clsx')`、`require('@xterm/xterm')` 都会失败——要么自带打包进 `lib/client.js`，要么加 `external` 并确保提供方 row 已启用。
3. **React 来自平台表**：`require('react')` 即可；别自带第二份 React（shell 明确禁止重复实例）。
4. **样式只能用 `<style>` 插入**（`document.head.appendChild` + `data-plugin-css` 标记，dsh-context 先例）；**`styles.insert(css)` 是动态包内建，我们不可用**。卸载时要移除自己的 `<style>`。
5. **颜色用 `--dsw-alias-*`**（实测 55 个，如 `--dsw-alias-bg-layer-1/2/3`、`--dsw-alias-label-primary/secondary/tertiary/caption`、`--dsw-alias-border-l1/l2`、`--dsw-alias-state-success-primary`、`--dsw-alias-state-warn-primary`、`--dsw-alias-state-error-primary`、`--dsw-alias-brand-primary`、`--dsw-alias-scrollbar-bg-l2`、`--dsw-alias-interactive-bg-hover`），暗/亮自动切换，不要硬编码 hex。
6. **组件 props 已给全**：`{sessionId, useSession, t, inspectCall, viewRequest, openView, completeViewRequest}`（§3.4）；`useSession(selector)` 是 `useSyncExternalStore` 风格，**selector 必须稳定**（不要每次 render 造新函数导致重复订阅——参考内建写法用模块级 selector）。
7. **只有激活的 view 被渲染**（`only: viewId`）→ 切走即 unmount：定时器/`requestAnimationFrame`/滚动监听必须在 `useEffect` 里清理，否则切 tab 后还在轮询。
8. **空白会话不渲染**（blank 判定），所以不要在组件里假设「一定会挂载」；也不要在没有 `sessionId` 时发 RPC。
9. **tab 只显示 label 文本**，无 badge；observe `label` 是函数（`ctx.locale.subscribe` 会重算），别在里面做副作用。
10. **无法直接读 Host 服务**：所有数据经 `ctx.connection.rpc.call('/terminal-panel', endpoint, payload, signal)`；`payload` 必须是可 JSON 化的纯对象（`undefined`/`Date`/`Map` 会被 codec 拒或静默丢失）。
11. **`rpc.call` 返回信封**：先判 `res?.ok !== true` 再取 `res.value`；`res.error.code` 是自定字符串（建议 `terminal-panel/<reason>`，与 vnc 的 `vnc/invalid-target` 同风格）。
12. **网络失败与业务失败不同**：`fetch`/非 2xx 抛异常（`transport failure … HTTP 500/401/403`）；401 说明 cookie 掉了 → 提示「断线，重连后恢复」一次，别无限重试刷屏。
13. **轮询合帧**：一次 `read` 拿所有源的增量，别为每个 run 发一个请求；**tab 不可见 / 面板折叠 / `document.hidden` 时降频或暂停**（对应设计稿的「hover/focus 暂停倒计时」是 UI 状态，别和轮询耦合）。
14. **xterm 不可用（未启用 external）时**要有纯文本降级：`<pre>` + ANSI 剥离（把 ANSI 处理放纯函数，便于单测）。
15. **等宽字体/主题字号**：shell 有 `--dsw-…font` 变量族（主题里配置了 `terminalFontSize`），用变量别写死 px；数字用 `tabular-nums`（设计稿要求）。

---

## 13. 无法确认项与替代方案

| # | 未确认项 | 影响 | 替代 / 验证方式 |
|---|---|---|---|
| U1 | Client 侧 live slot props（`Slots.listSubTree`）本次超时，未能 inspect 复核 | 低：props 已从 renderer 源码读出 | 打开/刷新 Web GUI 后重跑 `cordis_inspect_query {platform:'client',provider:'Slots',method:'listSubTree',input:{root:'conversation.view'}}` |
| U2 | `label` 能否返回 ReactNode（角标） | 中：设计稿要 tab 角标 | 先按纯文本实现；用最小试验包验证（§3.5 A3-1） |
| U3 | 三方客户端 bundle 能否 `require('xterm')` 或需自打包 | 中：影响终端渲染实现 | 用 `dsh.client.external: ["@xterm/xterm"]` 试验；否则把 xterm 打进 `lib/client.js`（体积代价）或纯 `<pre>` 渲染 |
| U4 | `link:` 安装的手写 `lib/client.js` 能否被 `/plugins` 正常服务 | **高**：决定开发循环 | 先装最小骨架，刷新页面看 `window.__DSH_BOOT__` 与 `/plugins/…` 200（§8.4 A8-1） |
| U5 | 前台 bash 的**过程**输出能否拿到 | 高：UI 有「输出区实时滚动」 | 见 D1；v1 只做终态 / 引导用户用后台 job；若要过程输出，需单独立项验证 shell 装饰可行性 |
| U6 | 跨 session 读 `jobs` / `terminals`（传他人 sessionId / Agent）是否被真正允许 | 中：多会话聚合的核心 | 用最小 Host 插件在真机跑一次 `jobs.list(childSessionId)` 与 `terminals.read(agents.get(child), id)`；文档语义支持，但未实测 |
| U7 | `dsh.manifestVersion` / `engines.dsh` 是否真被强制 | 低 | 装一个故意写错范围的包看是否被拒（不要在用户环境做；用非 desktop profile 测） |
| U8 | Desktop 重启/生效路径与 bundle watcher 是否覆盖 workspace 目录 | 中：影响迭代成本 | 首次安装后记录一次真实生效路径，写进 docs/install.md |
| U9 | `ctx.remote` 自声明命名空间在客户端**不生成代码**时的完整参数装箱（`{args:{request}}` vs `{args:[...]}`） | 低（仅当选通道 B） | 若选 B，读 `dsh-typert-protocol` 生成器输出或做一次最小 vnc 风格试验 |
| U10 | `--dsw-alias-*` 之外是否有官方「终端」专用令牌（如 terminal bg/fg） | 低 | 主题 inspect（`Theme.listTokens`）恢复后查；或读 `dsh-client-ui-theme` README |

### 风险最高的两件事（建议 Lead 优先安排验证）

1. **U4**：决定整个开发循环是否可行（手写 client.js 能否被加载）。建议 task-2 scaffold 完成后**先做一次安装 + 页面加载验证**，再写业务代码。
2. **U5**：决定 UI 规格 §2 的「输出区实时滚动」是否有数据基础。若拿不到过程输出，需与设计/PM 对齐降级文案。

---

## 附录 A：本任务用到的本机路径

- DSH 安装：`/Applications/DeepSeek Harness.app/Contents/Resources/app.asar`
- 实现目录（shell 提示的 checkout 实际在 asar 内）：`asar:dsh/`
- 当前 profile：`/Users/lzx/.dsh/profiles/desktop`（`package.json`、`cordis.patch.yml`、`node_modules/`）
- 三方参考包：`/Users/lzx/.dsh/profiles/desktop/node_modules/{dsh-context,dsh-vnc-client,dsh-global-rules,dsh-better-sidebar,dsh-remote}`
- 官方 skill 参考：`asar:dsh/node_modules/@deepseek-ai/dsh-agent-preset/skills/cordis-plugin-development/`（`SKILL.md`、`references/host-plugin.md`、`references/ui-plugin.md`、`templates/decoration/`）
- 本报告的取证副本（临时）：`/tmp/dsh-scout/src/`（从 asar 解包，非交付物）

## 附录 B：本报告未做（受硬边界限制）

- 未修改任何 `docs/research/**` 之外的文件；未 `git` 操作；未安装依赖；未在 profile 装/卸任何插件；未重启 DSH；未打开/刷新 Web GUI（因此 client inspect 超时）。
- 未对 `lib/**` 或生产代码做任何建议性改动——只给接口约束。
