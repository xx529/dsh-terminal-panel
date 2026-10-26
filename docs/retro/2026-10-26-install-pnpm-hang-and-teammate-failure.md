# 复盘 · 安装期 pnpm 挂起 + teammate 中途 failed

> 触发条件：dsh-team-contract §12 的 **T2**（出现 §9 失败表未覆盖的失败：teammate 在任务中途 failed 且无收尾回执）。
> 字段格式严格按 `dsh-team-contract §12.3`（id / date / trigger / owner / symptom / root_cause / impact / fix / prevention / verified_by / status）。

```yaml
id: R-2026-10-26-install-pnpm-hang-and-teammate-failure
date: 2026-10-26
trigger: T2
owner: architect（复盘撰写/载体核对）；处置现场 owner: lead；脚本载体 owner: devops
symptom: |
  (1) `./deploy/publish-and-install.sh --no-push` 里 `dsh plugin … add link:` 转发的 `pnpm add` 在 profile 目录运行 >10 分钟无进度（网络/解析阶段），Lead 手动 kill 后脚本中断；后续执行 `pnpm install --offline` 实际 6.6s 完成（+6 −39），说明是「联网解析路径」而非依赖本身不可用。
  (2) devops teammate 在 task-22 收尾阶段 failed，且没有 closing message；任务板 task-22 停在 in_progress（owner=devops，revision 2），后由 Lead 手动 reassign/闭环。
root_cause: |
  (1) 脚本把「联网 pnpm add」作为默认主路径，没有超时与离线优先；profile 已有 node_modules，本应先离线收敛。
  (2) 团队成员在长命令/收尾阶段失败时，任务 owner 不会自动释放（契约 §5/§9），Lead 未预设「任务中途 member failed」的处置流程（谁接手、如何核对现场）。
  (3) 长步骤（>2 分钟）缺少「先报预计耗时/进度」的团队约定，导致静默挂起只能靠 Lead 人工发现。
impact: |
  安装停在中途（dependency/symlink 已写、bundles 未补），Lead 需介入 kill + 手工补齐 + 核对 profile 完整性；task-22 需要 reassign 才能重做；总耗时增加约 20 分钟；且 unreviewed 的中间态（已写 dependency 但缺 bundle）可能被误当成完成。
fix: |
  Lead kill 挂起进程（bash 9408 / dsh 9436 / pnpm 9443）→ devops 补齐 bundles → Lead 校验 profile 依赖完整性（31 bundles 中第三方全在，官方 9 个随 app.asar）→ 等待用户重启激活；task-22 由 Lead 手动闭环为 completed。
prevention: |
  三项可执行载体（a/b/c 全部落地，详见下方「prevention 明细」）：
  (a) 脚本规则：`deploy/publish-and-install.sh` 安装阶段改「离线优先 + 超时 + 明确降级」（`_timeout_cmd` 三路降级、`--timeout` 默认 120s、超时 exit 6），写进 `--help` 与 docs/install.md §1.3；
  (b) 团队流程规则：AGENTS.md §8.1「长步骤先报预计耗时」「成员中途 failed → Lead 立即 reassign 并核对现场」；
  (c) 发布检查载体：docs/install.md §1.4「发布前检查清单（--dry-run 回归）」明确列出 verify/dry-run/超时/路由/留证五项。
verified_by: |
  见「prevention 明细」逐条命令；另 `npm run verify` 当前 338 tests / 338 pass + 91/91 smoke + exit 0（未回退）。
status: closed
```

## 证据

| # | 证据 | 位置 / 命令 |
|---|---|---|
| E1 | 挂起进程被 kill | Lead 记录：bash 9408 / dsh 9436 / pnpm 9443 |
| E2 | 离线路径实际很快 | `/tmp/task22-install.log`：后续 `pnpm install --offline` → `Done in 6.6s / +6 -39` |
| E3 | 安装后 profile 状态 | dep=`link:/Users/lzx/Documents/GitHub/dsh-terminal-panel`、bundles 31 含插件、`node_modules/dsh-terminal-panel` 为 symlink、lock importer 条目存在 |
| E4 | teammate 失败无收尾 | `list_agents` devops `status=failed`；task-22 revision 2 `ownerName=devops`、status 停在 in_progress（后由 Lead 手动闭环 completed） |
| E5 | 脚本已有超时/离线载体 | `deploy/publish-and-install.sh:40` `TIMEOUT_SECS=120`、`:54` `EXIT_TIMEOUT=6`、`:90` `_timeout_cmd()`、`:148` `--timeout` help、`:198-199` 参数解析、`:345-361` pnpm offline 优先 |
| E6 | 文档载体已写 | `docs/install.md:68` §1.3（脚本选项/超时）、`:92` 排障、`:94` §1.4 发布前检查清单、`:82` `--dry-run` 说明；`README.md:79-82` 一键脚本先 dry-run |

## prevention 明细（可执行载体与落地检查）

| # | 载体类型 | 载体位置 | 落地 owner | 当前状态 | 验证方式 |
|---|---|---|---|---|---|
| P1 | 脚本规则（离线优先 + 超时 + 降级） | `deploy/publish-and-install.sh:40`（默认 120s）、`:54`（`EXIT_TIMEOUT=6`）、`:90`（`_timeout_cmd`：GNU timeout→gtimeout→perl alarm→无保护）、`:198-199`（`--timeout` 解析/范围 10–3600）、`:345-361`（pnpm offline 优先、失败才联网，同受超时） | devops | **已落地** | `grep -n "_timeout_cmd\|EXIT_TIMEOUT=6\|offline" deploy/publish-and-install.sh`；`./deploy/publish-and-install.sh --help` 含 `--timeout`；`docs/install.md:82` 有 `--dry-run` |
| P2 | 团队流程规则（长步骤/成员失败） | `AGENTS.md:145-152` §8.1：`:149` 长步骤（>2 分钟）先 `send_message` 报「即将执行 X，预计 N 分钟」；`:150` 成员 `failed` → Lead 立即 `team_task_update` reassign 并核对现场 | lead | **已落地** | `grep -n "长步骤先报预计耗时\|成员中途 failed" AGENTS.md` → 命中 |
| P3 | 发布检查载体（dry-run 回归清单） | `docs/install.md:94-101` §1.4：verify / `--dry-run` 计划 / 超时保护（exit 6）/ 页面内 fetch 200 / 留证 | architect | **已落地** | `grep -n "发布前检查清单" docs/install.md` → 命中；清单含 `--dry-run`、`exit 6`、`200` 三项硬检查 |

## status 说明与解除条件

- `status: closed`（2026-10-26）：P1/P2/P3 三项载体均已落地并可 grep 到。
- 解除条件（均已满足）：
  1. 脚本存在离线优先 + 超时 + 三路降级，且 `--timeout` 默认 120s、超时 exit 6；
  2. AGENTS §8.1 含「长步骤先报预计耗时」「成员中途 failed → Lead 立即 reassign 并核对现场」；
  3. docs/install.md §1.4 存在发布前检查清单（含 `--dry-run` 回归与留证要求）。
- 后续维护：新增安装路径（新的包管理器/CLI）时，必须同步 P1 的超时保护与 P3 的检查清单；仅在脚本默认路径改变时更新本文件 `verified_by`。
