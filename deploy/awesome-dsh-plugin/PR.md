<!--
PR 标题（提交时用，不要用本注释里的说明作正文）：

  Add xx529/dsh-terminal-panel (ui)

用法：
  gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
    --title "Add xx529/dsh-terminal-panel (ui)" \
    --body-file deploy/awesome-dsh-plugin/PR.md
-->

## What this adds

One file, one entry: `data/plugins/xx529__dsh-terminal-panel.yml`.

[dsh-terminal-panel](https://github.com/xx529/dsh-terminal-panel) adds a read-only **Terminal** view tab to the conversation header. It aggregates the current session's, subagents' and Agent Team teammates' `bash` output, background jobs (`ctx.jobs`) and persistent terminal sessions (`ctx.terminals`) into one filterable panel with type and session-scope filters, command/output search, auto-collapse, follow-scroll and a maximize dialog. It never injects input; the only write action is a two-step "stop".

- Host half: Cordis plugin — `lib/index.js` exports named `name` / `inject` / `apply`, registers one exact HTTP route (`/terminal-panel/rpc`).
- Client half: single-file classic script (`lib/client.js`) mounted through the `conversation.view` slot (`id: terminal-panel`, `order: 30`), reusing the built-in tab chrome.
- No runtime dependencies, no build step; installable from source.

## Checklist

- [x] One file at `data/plugins/xx529__dsh-terminal-panel.yml` — the whole submission
- [x] `package.json` declares `dsh.bundle` (`{ "patch": "./cordis.patch.yml" }`) *and* `dsh.client` — see https://raw.githubusercontent.com/xx529/dsh-terminal-panel/main/package.json
- [x] `cordis.patch.yml` at the repo root (single `insert` for `terminal-panel`)
- [x] Repo has the `dsh-plugin` topic (also `dsh`, `deepseek-harness`, `developer-tools`, `terminal`), contains working code, public and not a fork
- [ ] Repo age: created `2026-10-26T04:03:40Z`. This PR is opened a few hours after creation, so the 1-day gate will report `repository is 0.x days old (needs 1) — nothing to do`; the gate re-runs itself (`regate.yml`, about every 6 h) and clears without any push, close or reopen. Expected green: `2026-10-27T04:03:40Z`.
- [x] Description states what it does, no superlatives; every claim is checkable in the repo — e.g. "foreground bash shows final output only" is documented under 已知限制 #3 in the README
- [x] `category: ui` — it only adds a conversation-header view tab; no tools and no model-facing surface. Maintainers may re-file it (e.g. `dev`), no objection.

## Notes for reviewers

- **Not a duplicate of the interactive-terminal entries** (e.g. `giiiiiithub/terminal`, `whiteS18/dsh-terminal-button`): those give you a PTY/xterm surface to type into. This plugin is a read-only observer of runs the agent already executes — it renders their output and offers filters/follow/maximize, and writes nothing back to a terminal.
- **No `tarball:`** — the repo installs from source with no build step: `dsh plugin --profile web add github:xx529/dsh-terminal-panel`. (`package.json` is `private: true`; nothing is published to npm, and none is needed for listing.)
- **Icon** is optional and points at `assets/icon.png` in the submitted repo (same artwork as the in-repo `icon.svg`, rendered to 512×512 PNG).
- Repo gates ship with the repo and run offline: `npm run verify` (syntax check + `node:test` suite + host smoke).
