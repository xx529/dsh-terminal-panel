# Figma 原型恢复指南（terminal-panel）

> 目的：把「设计稿本体只存在于本机 Figma 桌面缓存」这件事变成**可恢复、可交接**的流程。
> 现状：Figma 本地文档 **`terminal-panel`** 当前与 DSH 断连（`figma_status` 返回 `documents: []`），
> **无法由 agent 直接导出 `.fig`**；但 6 张验收板 PNG 已在仓库，可作只读对照与重绘依据。
> 本文所有路径以仓库根 `/Users/lzx/Documents/GitHub/dsh-terminal-panel` 为准；**不要修改 `.figma/assets/**`（原始导出，保留）**。

## 0. TL;DR

| 想要什么 | 走哪条路 | 产物 | 代价 |
|---|---|---|---|
| **真 Figma 源文件（可继续编辑）** | 恢复路径一：Figma 桌面 **File → Save local copy…** | `docs/design/figma-export/terminal-panel-2026-10-26.fig` | 需在本机 Figma 里打开该文档 |
| 可编辑但**有损**（仅视觉/文本层级） | 恢复路径二：逐板导出 SVG | `a-main.svg`…`f-maximize.svg` | 丢 auto-layout、组件属性、变量绑定 |
| 只读对照 / 重新绘制 | 恢复路径三：仓库内 PNG + ui-spec | 当前 6 张 PNG | 只能看，不能改 |

**首选路径一**：`.fig` 是唯一能完整恢复（含 auto-layout、组件、变量）的资产；SVG/PNG 只作降级。

## 1. 当前设计资产清单

- Figma 文档名：**`terminal-panel`**
- Page：**「命令实况 · UI/UX 设计」**
- 页标题文字节点：`12:1090`、`12:1091`、`12:1092`
- 设计规格（验收基线）：[`docs/design/ui-spec.md`](ui-spec.md)（v4）
- 原始 PNG 目录：[`.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/`](../../.figma/assets/e7b0e68d-51fe-4f9a-9247-0698ba78ee0d/)
- 稳定命名导出目录：**`docs/design/figma-export/`**（由 `T27 整理 Figma 导出包` 生成；若尚未生成，以上面的原始 PNG 目录为准）

### 1.1 六张验收板

| 板 | 节点 ID | 尺寸（像素） | 一句话说明 | 原始 PNG（仓库内当前文件名） | ASCII 目标名（`figma-export/`） |
|---|---|---|---|---|---|
| A · 主视图 | `12:2` | 1440×900 | 默认「全部会话」：横向列进行中 + 已完成折叠行 + 工具栏 | `1-A-主视图-默认全部会话-横向列-已完成收起-.png` | `a-main.png` |
| B · 横向溢出 + 筛选 | `12:240` | 1440×900 | 列超过 3 个时的横向滚动/`›` 角标 + 会话范围多选（子代理/队友） | `2-B-横向滚动溢出-会话范围多选-子代理-队友-.png` | `b-overflow-filter.png` |
| C · 状态机与规则 | `12:674` | 1000×1180 | 自动收起/暂停计时/数据源/状态迁移规则说明板 | `3-C-状态机-自动收起规则-数据源.png` | `c-states-rules.png` |
| D · Light 主题 | `12:1005` | 1000×630 | 亮色主题与 `--dsw-alias-*` 令牌映射 | `5-D-Light-主题-令牌映射.png` | `d-light.png` |
| E · 边界状态 | `12:895` | 1440×430 | 空态 / 暂停跟随 / 「N 条新输出」/ 清空已完成 / 断线 | `4-E-边界状态-空态-暂停跟随-清空已完成.png` | `e-boundary.png` |
| F · 最大化弹窗 | `14:1815` | 1440×900 | `⤢` 打开的 980×600 只读弹窗（遮罩/停止/复制全部） | `6-F-最大化弹窗-单条活动专注观看-只读-.png` | `f-maximize.png` |

> 尺寸已用 PNG 头部实际校验（与设计稿节点尺寸一致）；节点 ID 用于在 Figma 里按 `⌘F`/图层定位与导出。
> 说明文字节点：A–D 板说明 `12:1093`、`12:1094`、`12:1095`、`12:1096`、`12:1097`（共 5 个，按 Figma 层顺序）；F 板说明 `14:2198`。

## 2. 恢复路径一（首选）：拿到真 `.fig`

前提：本机能打开 Figma 桌面版，且 Figma 里能打开 `terminal-panel` 文档（本地缓存/网格文档皆可）。

1. Figma 桌面版打开文档 **`terminal-panel`**（Page「命令实况 · UI/UX 设计」）。
2. **File → Save local copy…**（快捷键 **⌘⇧S**）。
   - ⚠️ 是 **Save local copy**，不是 Export（Export 只能出 PNG/SVG/PDF，拿不到可编辑源文件）。
3. 保存为 **`terminal-panel-2026-10-26.fig`**，路径：
   ```
   /Users/lzx/Documents/GitHub/dsh-terminal-panel/docs/design/figma-export/terminal-panel-2026-10-26.fig
   ```
4. 提交：
   ```bash
   cd /Users/lzx/Documents/GitHub/dsh-terminal-panel
   git add docs/design/figma-export/terminal-panel-2026-10-26.fig
   git commit -m "design: add local .fig snapshot (terminal-panel 2026-10-26)"
   ```
5. 在任意机器恢复：`git clone https://github.com/xx529/dsh-terminal-panel.git` → Figma 桌面 **File → Open local copy…** → 选择该 `.fig` 即可继续编辑。

注意事项：

- `.fig` 体积可能数 MB；**若单文件 > 50 MB**，不要提交进 Git，改存网盘（iCloud/Google Drive/团队盘），并把分享链接补到本文 §5 的资产记录里。
- `.fig` 含图稿全部可编辑内容；提交前确认没有把个人账号/私有评论等敏感信息带进公开仓库（必要时在 Figma 里先另存副本）。

## 3. 恢复路径二（有损但可编辑）：逐板 SVG

适用：拿不到 `.fig`，但想以后能直接拖回 Figma 继续改视觉。

1. 在 Figma 中选中每一张板（按 §1.1 节点 ID 定位）。
2. 右侧 **Export → `+` → SVG → Export 1x**，逐个导出；或（**仅当 companion 在线时**）让 agent 用 `figma_download_assets` 批量导出 `nodeIds`。
3. 按 ASCII 名放入同一目录：
   ```
   docs/design/figma-export/a-main.svg
   docs/design/figma-export/b-overflow-filter.svg
   docs/design/figma-export/c-states-rules.svg
   docs/design/figma-export/d-light.svg
   docs/design/figma-export/e-boundary.svg
   docs/design/figma-export/f-maximize.svg
   ```
4. 下次恢复：Figma 里直接把 `.svg` 拖进画布（或 File → Place image）即可编辑。

**会丢什么（必须知道）**：

- 丢失 **Auto layout / 约束**（拖入后是绝对定位的图层，需手动重排）；
- 丢失 **组件实例关系与组件属性**（变体、instance swap、交互）；
- 丢失 **变量/样式绑定**（颜色回到硬编码，需重新绑 `--dsw-alias-*` 对应 token）；
- 文本会转成可编辑文本图层但字号/行高可能被展平；阴影/模糊/蒙版可能降级。
  保留的是：**视觉外观、图层分组、文本内容与层级**——足够做视觉回归与二次排版。

## 4. 恢复路径三（只读对照）：PNG + 规格重绘

当只需要「照着画」或做视觉走查时，不必导出可编辑文件：

- 6 张 PNG（§1.1）就是验收基线截图，可与实现逐像素对照（A–F 分别对应 ui-spec §2.1/§2.3/§3、§4、§2.4、§6、§2.2）。
- 重新绘制的规格来源：[`docs/testing/acceptance-matrix.md`](../testing/acceptance-matrix.md)（验收项 ↔ 板号）+ [`docs/design/ui-spec.md`](ui-spec.md)（布局/交互/令牌）。
- 字体与颜色（ui-spec §2.4）：
  - 代码/终端字体：`--ds-font-family-code`（随宿主主题，设计稿用 **JetBrains Mono** 类等宽字体）；
  - 界面字体：中文 **PingFang SC**，西文/数字设计稿用 **Inter**（仓库文档显式只列 PingFang SC 与 `--ds-font-family-code`，Inter/JetBrains Mono 为设计稿用字体，重绘时以原稿/PNG 为准）；
  - 颜色：只用 `--dsw-alias-*` 令牌（`bg-base`/`bg-layer-1/2`、`label-primary/secondary/tertiary`、`border-l1/l2`、`state-business/success/error/warn-primary`、`radius-sm/md`、`shadow-lv1/lv3`），禁止硬编码 hex。
- 图标：设计稿里的 `› ▾ ✓ ✕ ⌕ ↑` 只是占位，实现侧用内联 SVG（禁 emoji）。

## 5. 断连时的应急

`figma_status` 返回 `documents: []`（或列表为空）表示：**Figma 桌面版没打开文档，或「DSH to Figma · Local」插件未连上**，此时 agent 无法读取/导出画布。

恢复步骤（按顺序）：

1. 打开 **Figma 桌面版**，并打开 `terminal-panel` 文档（本地缓存文档亦可）。
2. 确认 **「DSH to Figma · Local」** 插件正在运行、保持窗口打开（companion 已配对，端口 `3055`；首次需在 Figma 里导入 `~/.dsh/figma/companion/manifest.json`，见 `figma_status.companion` / `figma_setup`）。
3. 重新执行 `figma_status` → `documents` 出现该文档即恢复；再走 §2/§3 导出。
4. 若仍为空：重开插件 → 重开文档 → 再查；仍失败则本次只能走 §4（PNG 对照）。

**不要把图稿存进 DSH profile**（`~/.dsh/**` 只属于运行时配置，不随仓库迁移）；设计资产一律进仓库 `docs/design/figma-export/` 或网盘。

## 6. 资产记录（恢复后回填）

| 资产 | 文件名 | 大小 | 恢复日期 | 备注（链接/校验） |
|---|---|---|---|---|
| `.fig` 源文件 | `terminal-panel-2026-10-26.fig` | 待填 | 待填 | 若 >50MB 填网盘链接 |
| SVG 六板 | `a-main.svg`…`f-maximize.svg` | 待填 | 待填 | 有损，见 §3 |
| PNG 六板（稳定名） | `a-main.png`…`f-maximize.png` + `SHA256SUMS` | 由导出任务回填 | 2026-10-26 | 校验：`cd docs/design/figma-export && shasum -a 256 -c SHA256SUMS` |

## 7. 恢复成功的最小验证

- **路径一**：Figma `File → Open local copy` 能打开 `.fig`，6 张板齐全、auto-layout 与组件可编辑；
- **路径二**：Figma 拖入 `.svg` 后 6 张板视觉与 PNG 一致（允许布局需重排），文本可编辑；
- **路径三**：`file docs/design/figma-export/*.png` 全部为 `PNG image data` 且尺寸见 §1.1；打开与 ui-spec/acceptance-matrix 对照无缺板；
- 任何恢复动作完成后，回填 §6 并 `git commit`（不要只留在本机）。
