# awesome-dsh-plugin 收录投稿包

> 目标：把 `dsh-terminal-panel` 收录进 **Awesome DSH Plugin**（站点 <https://awesome-dsh-plugin.com/>，
> 数据仓库 <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>）。
> 本目录是**投稿内容**，不是可执行发布脚本；实际提交动作（fork / push / PR）仍由维护者执行。

## 0. 一句话结论

收录**只需一个文件**：`data/plugins/xx529__dsh-terminal-panel.yml`（本目录已备好，文件名与 url 严格对应）。
仓库形态（`dsh.bundle` + `cordis.patch.yml` + 真实代码 + `dsh-plugin` topic）已满足；正式提交只剩**一个硬前置**：

1. **时间门槛**：仓库创建满 1 天——创建于 `2026-10-26T04:03:40Z`，即 **2026-10-27 12:03:40（Asia/Shanghai）** 之后 CI 才会判过。
   提前开 PR 也不会白费：年龄检查会自动重跑（`regate.yml`，约每 6 小时），到点自行变绿，无需重开 PR 或强推。
2. **描述与布局解耦（已处理）**：条目刻意不写具体布局（v7 横向列 / v8 卡片网格都成立），因此**不依赖 v8 是否已推送到 main**；
   筛选（类型/会话范围）、命令/输出搜索、自动收起、跟随滚动、最大化弹窗、只读、bash 终态等说法在 v7 与 v8 下均可核对。
   若之后想让条目强调 v8 卡片网格，另提一个小 PR 只改自己那条即可（可选）。

来源：[contributing.md](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md)、
[`scripts/check-submission.mjs`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/check-submission.mjs)（`MIN_AGE_DAYS = 1`，用 `Date.now() - created_at` 计算）。

## 1. 交付物

| 文件 | 用途 |
|---|---|
| [`xx529__dsh-terminal-panel.yml`](xx529__dsh-terminal-panel.yml) | 投稿条目本体；复制到列表仓库 `data/plugins/` 下即完成投稿 |
| [`PR.md`](PR.md) | PR 正文（含与官方模板对应的 checklist、去重说明、评审备注）；标题见文件顶部注释 |
| `assets/icon.png`（仓库根） | 商店 96px 磁贴图标：`icon.svg` 经 `rsvg-convert` 渲染的 512×512 RGBA PNG |
| 本文件 | 规则核对、提交流程、时间窗口、可选增强与合并后动作 |

条目内容（预览）：

```yaml
url: https://github.com/xx529/dsh-terminal-panel
name: xx529/dsh-terminal-panel
category: ui
icon: https://raw.githubusercontent.com/xx529/dsh-terminal-panel/main/assets/icon.png
description:
  en: "Read-only terminal view tab in the conversation header: ..."
  zh: "会话头部只读的「终端」视图标签页：..."
```

## 2. 收录要求核对（按 contributing.md + CI 实际检查项）

| 要求 | 现状 | 证据 / 说明 |
|---|---|---|
| 一个文件 `data/plugins/<owner>__<repo>.yml` | ✅ 已备 | 文件名 = `xx529__dsh-terminal-panel.yml`；`scripts/lib/entries.mjs` 的 `slugFor()` 会按 url 反查文件名，必须一致 |
| `package.json` 声明 `dsh.bundle`（只有 `dsh.client` 会被拒） | ✅ | 远端 main：`"bundle": { "patch": "./cordis.patch.yml" }`，另有 `dsh.client`（Web 前端） |
| 根目录有 `cordis.patch.yml` | ✅ | `- insert: { id: terminal-panel, name: dsh-terminal-panel }` |
| 仓库有真实可用代码（非占位/README-only） | ✅ | 完整 Host/Client 实现 + 离线测试与冒烟脚本；`npm run verify` exit 0（2026-10-26 实测） |
| 仓库创建满 1 天 | ⏳ 2026-10-27 12:03:40（+08:00）后满足 | 创建时间 `2026-10-26T04:03:40Z`（GitHub API）；CI 按运行时刻计算，不按 PR 创建时刻 |
| 仓库已打 `dsh-plugin` topic | ✅ | topics：`dsh-plugin`、`dsh`、`deepseek-harness`、`developer-tools`、`terminal` |
| 描述只说功能、不带营销词、且**与代码一致** | ✅ 与当前 v7 main 一致 | 只读、`conversation.view` tab、bash/jobs/terminals 聚合、类型/会话范围筛选、命令/输出搜索、自动收起、跟随滚动、最大化弹窗；「前台 bash 仅终态」见 README 已知限制 #3。措辞不承诺具体布局，v8 推送后同样成立 |
| `category` 取值合法 | ✅ `ui` | 合法值：`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`；本插件只加会话头部视图 tab，不改工具/模型面 |
| 一个 PR 最多 3 条 | ✅ 1 条 | 本仓库只提交自己这一条 |
| 描述含 `: ` 必须加引号 | ✅ | en/zh 均用双引号包裹 |
| 不手改生成的 README | ✅ | 只提交 `data/plugins/*.yml`，README 由 `scripts/generate-readme.mjs` 在合并后生成 |
| 可选 `tarball` / `npm` | 未使用（不需要） | 本仓库无构建步骤，`dsh plugin --profile web add github:xx529/dsh-terminal-panel` 可直接源码安装 |

> 已用官方校验器（`scripts/lib/entries.mjs` 的 `readEntries()` + `validateEntries()`）在本地跑过本条目，返回空问题列表；复现命令见 §6。

## 3. 提交流程

```bash
# ── 0) 提交前校验（条目措辞与布局无关，不依赖 v8；只剩仓库年龄这一时间门槛）
cd /Users/lzx/Documents/GitHub/dsh-terminal-panel
npm run verify                                        # 门禁必须 exit 0
git log --oneline -1                                  # 记录本仓库提交号（PR 正文可引用）
git add assets/icon.png deploy/awesome-dsh-plugin
git commit -m "chore(deploy): awesome-dsh-plugin 投稿条目 + 商店图标"
git push origin main                                  # icon 指向 raw.githubusercontent 的 main，必须先存在
curl -sI https://raw.githubusercontent.com/xx529/dsh-terminal-panel/main/assets/icon.png | head -1   # 期望 200

# ── 1) fork 列表仓库并浅克隆（6700+ 条数据文件，浅克隆足够）
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone=false
cd /tmp && rm -rf awesome-dsh-plugin
git clone --depth 1 https://github.com/xx529/awesome-dsh-plugin.git
cd awesome-dsh-plugin
git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git
git checkout -b add-xx529-dsh-terminal-panel

# ── 2) 放入条目（文件名必须与 url 对应）
cp /Users/lzx/Documents/GitHub/dsh-terminal-panel/deploy/awesome-dsh-plugin/xx529__dsh-terminal-panel.yml \
   data/plugins/

# ── 3) 提交 + 推送
git add data/plugins/xx529__dsh-terminal-panel.yml
git commit -m "Add xx529/dsh-terminal-panel (ui)"
git push -u origin add-xx529-dsh-terminal-panel

# ── 4) 开 PR（标题与正文见 PR.md 顶部注释）
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --head xx529:add-xx529-dsh-terminal-panel \
  --title "Add xx529/dsh-terminal-panel (ui)" \
  --body-file /Users/lzx/Documents/GitHub/dsh-terminal-panel/deploy/awesome-dsh-plugin/PR.md
```

**不想用命令行**：打开
<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/new/main/data/plugins?filename=xx529__dsh-terminal-panel.yml>
粘贴 §1 的 YAML → 选 “Create a new branch and start a pull request” → 正文粘贴 `PR.md`（去掉顶部 HTML 注释）。

## 4. 时间窗口（前置 1：仓库年龄）

| 事项 | 时间 |
|---|---|
| 仓库创建 | `2026-10-26T04:03:40Z` = 2026-10-26 12:03:40（+08:00） |
| 1 天门槛最早通过 | `2026-10-27T04:03:40Z` = **2026-10-27 12:03:40（+08:00）** |
| 提前提交会怎样 | CI 红字：`repository is 0.x days old (needs 1) — nothing to do …`；`regate.yml` 每约 6 小时按该措辞重跑，**自动转绿**；不要因红灯重开/强推/加空提交 |

## 5. 可选增强（非必需，本包已做/未做的原因）

- **图标（已做）**：`icon:` 指向 `assets/icon.png`（512×512）。规则要求 https + GitHub 托管 + 位图（`.png/.jpg/.jpeg/.webp`），
  所以不能用仓库里的 `icon.svg`。**先 push 图标再提 PR**，否则链接 404；提交后可用
  `curl -sI https://raw.githubusercontent.com/xx529/dsh-terminal-panel/main/assets/icon.png | head -1` 验证 200。
  不想要图标就删掉 `icon:` 这一行即可（商店回落为作者头像）。
- **截图（未做，建议真机安装后补）**：规则是在**自己仓库** `package.json` 旁放 `screenshots.json`，列 1–8 张相对路径
  （不许 `/` 开头、不许 `..`；绝对 URL 必须 GitHub 托管 https）。本仓库目前**没有真机 UI 截图**，
  `.figma/assets/` 里是设计稿而非实际运行截图，拿设计稿冒充会与「描述必须属实」冲突，故本包不声明截图。
  真机安装并留证后：把图放 `assets/screenshots/`，新增 `screenshots.json`（如 `["assets/screenshots/01-overview.png"]`）推 main 即可生效，**不需要再提 PR**。
- **npm / tarball（不做）**：列表不依赖 npm；本仓库无构建步骤，源码安装即可。若以后发 npm，需去掉 `"private": true` 并让包的 `repository` 指回本仓库；不要手写 `npm:` 字段（会被校验拒绝）。
- **peerDependencies（不适用）**：本插件零依赖，没有 `@deepseek-ai/*` 运行时依赖。

## 6. 本地校验（提交前可复跑）

```bash
# 在列表仓库的本地克隆里（§3 步骤 1 / 步骤 2 之后；需要 js-yaml，装在 /tmp 不影响本仓库）
cd /tmp/awesome-dsh-plugin
npm i js-yaml --no-save --cache /tmp/npm-cache >/dev/null 2>&1
node --input-type=module -e '
import { readEntries, validateEntries } from "./scripts/lib/entries.mjs";
const entries = readEntries("data/plugins");
const problems = validateEntries(entries).filter((p) => p.includes("xx529__dsh-terminal-panel"));
console.log("problems:", JSON.stringify(problems));
'
# 期望：problems: []（只过滤本条目；若想看全量，去掉 filter）
```

## 7. 合并后

1. 站点条目页出现：<https://awesome-dsh-plugin.com/p/xx529/dsh-terminal-panel/>（README 也会自动加行；**不要手改**）。
2. dsh-market 从列表构建的索引读取条目（站点给出的索引地址 `cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`，随构建更新；延迟时等下一次构建），详情页可用上 `icon`。
3. 可在本仓库 README 补「安装」命令与收录徽章（合并后再做，避免与进行中的 v8 文档改动冲突）：
   `dsh plugin --profile web add github:xx529/dsh-terminal-panel`。
4. 以后更新条目：**只改自己的** `data/plugins/xx529__dsh-terminal-panel.yml` 再提 PR；不要动别人的条目，也不要手改 README。
5. 可选：v8 展示层（卡片网格）推送后，若想把这个卖点写进条目，另提一个小 PR，只改自己那条的描述即可（同上，不要动别人的条目）。

## 8. 风险与注意

- **描述必须能对上代码**：维护者会读源码核对（数字、命令、API 名）。本条目刻意没写测试数/字节数等易漂移数字，只写可核对的行为。
- **布局措辞**：条目刻意不写具体布局（v7 横向列 / v8 卡片网格都成立），避免因 main 上展示层版本不同而与代码对不上；若日后想强调 v8 卡片网格，另提小 PR 只改自己那条。
- **去重是人工判断**：现有交互式终端条目（`giiiiiithub/terminal`、`whiteS18/dsh-terminal-button`）是给你敲命令的 PTY/xterm；本插件是**只读观察** agent 已执行的内容，不写回终端 —— `PR.md` 已写明这层区别。
- **标签页标题**：条目描述称其「会话头部视图 tab」，与 `conversation.view` slot 一致；不要写成「侧边栏」或「独立窗口」。
- **仓库年龄**：提前提交不会被打回，只是 CI 红一段时间后自动绿；不要为消红去重开 PR。
- **持续维护**：列表会周期性扫描失效/归档/长期停更条目并移除。

## 9. 来源

- 列表站点：<https://awesome-dsh-plugin.com/>（“Get your plugin listed” 段）
- 贡献指南：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/contributing.md>
- 条目模型（允许字段/文件名/分类/icon/tarball 校验）：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/lib/entries.mjs>
- 提交闸门（`dsh.bundle`、1 天年龄、每 PR ≤3 条）：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/scripts/check-submission.mjs>
- PR 模板：<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/blob/main/.github/pull_request_template.md>
- 本仓库安装/验证：`docs/install.md`、`README.md`
