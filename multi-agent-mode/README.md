# Multi-Agent Mode

Multi-Agent Mode installs generic Chief and Worker role files into the current project. Project-specific build, board, flash, and vendor rules belong in that project's `CLAUDE.md`; do not put them in this plugin.

## Quick Start

1. Install: `herdr plugin install Quoc-Khanh-029/herdr-plugin/multi-agent-mode`.
2. In the target workspace, invoke `herdr plugin action invoke community.multi-agent-mode.setup`.
3. Review each file diff; approve the prompt or rerun setup with `--yes` for all replacements.
4. Configure detected Chief and Worker harnesses; defaults are Claude Code and omp.
5. On Windows, start the default Claude Code Chief with `chief_launch.ps1` (PowerShell) or `chief_launch.sh` (Git Bash); dispatch only after writing a scoped task.

Requirements: Herdr 0.9.0+, Node.js 20+. No npm dependencies.

## Platform support

| Platform | Status | How verified |
| --- | --- | --- |
| Windows | Supported and tested for ver1 (PowerShell and Git Bash). | Windows `node test/run-all.mjs`; portability test covers clean-home install/uninstall with `.cmd` shims. |
| Linux | Not yet claimed; status awaits the first GitHub CI run. | Included in the CI matrix; no GitHub run result yet. |
| macOS | Not yet claimed; status awaits the first GitHub CI run. | Included in the CI matrix; no GitHub run result yet. |

Requires Node.js 20+, Herdr 0.9.0+, and at least one installed harness (`claude`, `omp`, `codex`, or `agy`). Windows setup uses Node's `homedir()` (based on `%USERPROFILE%`) for user paths; it does not use `%APPDATA%`.
Windows harness discovery uses `where.exe` on `PATH` (with `.cmd`/`.exe` command entries). Launchers: `chief_launch.ps1` (PowerShell) and `chief_launch.sh` (Git Bash).

## Upgrading

Install the new plugin version, then run `node setup.mjs` from its directory. Identical files are left unchanged. Different files are shown before replacement; a timestamped backup is made first. Use `--dry-run` to preview, `--yes` to approve all file replacements and configuration changes, `--reconfigure` to select harnesses again, or `--uninstall` to remove installed project files. Keep project rules in `CLAUDE.md`. Setup does not migrate legacy role configurations.

## Rules

1. Package generic role guidance, reference files, task template, Chief agent and scouts, Chief driver and launchers, and a worker-status pane reference. Project rules stay in each project's `CLAUDE.md`.
2. Exclude backups, `orig/`, task and report archives, ledgers, logs, secrets, user names, absolute user paths, and organization-specific role names. No caveman wording.
3. Setup copies files into the current project root. It does not overwrite different content without a displayed diff and approval; it backs up before replacement, supports `--yes`, `--dry-run`, and `--uninstall`, and refuses malformed JSON, TOML, or YAML settings.
4. Detect only `claude`, `omp`, `codex`, and `agy` using the platform executable lookup; if Herdr is present, also inspect `herdr agent list`. Select Chief and Worker harnesses in the user's config at `~/.config/herdr/multi-agent.config.json`. `--reconfigure` asks again. Missing harnesses are not offered. Defaults: Chief=Claude Code, Workers=omp.
5. Worker model ladder, cheapest first: luna -> terra -> sol. Start at luna; terra needs a written task-header reason; sol needs explicit user request.
6. Resolve the newest OpenAI Codex model id for each tier from `omp models`; omp Workers accept only `openai-codex/` model IDs and setup rejects `google-antigravity` or any Gemini ID. The agy model map defaults to `hydrogen` (Gemini 4); older Gemini IDs are refused and any newer agy ID needs the user's explicit approval. Gemini models are reachable only through agy (interactive pane via herdr agent prompt); never via omp or any other harness. Never edit files automatically on model changes. Models outside the worker ladder need user approval. Chief uses the newest family model and never changes mid-session.
7. Gemini models are reachable only through agy (interactive pane via herdr agent prompt); never via omp or any other harness. Start the interactive session with `hydrogen` using `agy --model hydrogen` or `/model hydrogen` in agy (`agy --help` confirms `--model`). Read `ref_agy_herdr.md` first; verify results with a read-only worker on another harness. No route if agy is missing.
8. Never assign a test task to the worker that wrote or built the code. One worker per code project at a time. Retire a worker only with user approval.
9. Chief and Workers compact at 50%. One `compact_percent` value defaults to 50. The context guard warns; finish the atomic step, then compact with focus in the same session. Write a handoff only for large state.
10. Load skills and references only when needed. Do not spawn an agent unless the user asks.
11. Bound reads; do not read whole logs. Keep short output in context; move longer output to a file.
12. No Monitor, polling, sleep loops, or tail-follow waits. Start a run once in the background and let the harness wake the session; put abort rules in the script.
13. Version tags use `verX.Y`; commit messages are one line, use the user's identity, contain no trailer, and are not pushed without user approval.
14. Each plugin README has Quick Start and Upgrading. The top-level README is an index with links only.
15. Tests use fixtures only, never real user configuration directories.

## Compaction settings

Setup applies only the compaction setting for the selected harness, after showing its diff and asking before changes. A backup is made first; malformed files are never edited.

| Harness | Setting |
|---|---|
| Claude Code | Launcher environment: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=360000`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=<percent>` |
| omp | `~/.omp/agent/config.yml`: `compaction.thresholdPercent` |
| Codex CLI | `~/.codex/config.toml`: `model_auto_compact_token_limit` computed from model window x percent; display the value and confirm |
| agy | Model map defaults to `hydrogen` (Gemini 4); fixed threshold, print a manual-compaction warning |

## CI

CI's OS/Node matrix is configured for Windows, Linux, and macOS; run it before claiming support for Linux or macOS. Require a green matrix before tagging `verX.Y`; tagging does not publish a release.

## Project rules

Put project-specific build, flash, board, vendor, configuration, and hardware constraints in that project's `CLAUDE.md`. This plugin contains reusable role behavior only.
