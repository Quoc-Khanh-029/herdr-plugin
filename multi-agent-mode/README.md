# Multi-Agent Mode

Multi-Agent Mode installs generic Chief and Worker role files into the current project. Project-specific build, board, flash, and vendor rules belong in that project's `CLAUDE.md`; do not put them in this plugin.

## Quick Start

1. Install: `herdr plugin install Quoc-Khanh-029/herdr-plugin/multi-agent-mode`.
2. In the target workspace, invoke setup with `herdr plugin action invoke community.multi-agent-mode.setup`; this runs `node setup.mjs`.
3. Review each file diff; approve the prompt or rerun setup with `--yes` for all replacements.
4. Configure the Chief harness and each task category's Worker harness, model, and optional effort.
5. Open Herdr, then start Chief in a pane rooted at the target workspace with the launcher below.

## Start Chief

In Herdr, open a pane at the target workspace and run `.\scripts\chief_launch.ps1` (PowerShell) or `./scripts/chief_launch.sh` (Git Bash). Both launch Claude Code as `claude --agent chief`.

## Models

Setup asks for Worker harness, model, and optional effort for `normal`, `coding`, `debugging`, and `research`. Detected harnesses only are offered. Model IDs come from `omp models` when available, a clearly marked suggestion that may be outdated, or free text. Press Enter to accept each printed suggestion; `--yes` accepts existing values or suggestions. Reconfigure all categories with `--reconfigure`, or one with `--reconfigure coding`.

The config at `~/.config/herdr/multi-agent.config.json` stores a `categories` object:

```json
{
  "chief": "claude",
  "categories": {
    "normal": { "harness": "claude", "model": "selected-model-id", "effort": "" },
    "coding": { "harness": "omp", "model": "model-id-from-omp-models", "effort": "medium" },
    "debugging": { "harness": "codex", "model": "selected-model-id", "effort": "high" },
    "research": { "harness": "agy", "model": "selected-model-id", "effort": "low" }
  },
  "compact_percent": 50
}
```

The task header records the selected model and a reason only when the user requested a different model for that task.

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

Install the new plugin version, then run `node setup.mjs` from its directory. Identical files are left unchanged. Different files are shown before replacement; a timestamped backup is made first. Use `--dry-run` to preview, `--yes` to approve file replacements and accept existing configuration values or suggestions, `--reconfigure` to ask again for all categories, or `--reconfigure coding` for one category. Existing configs with Chief/Worker harness fields remain readable; missing category rows are prompted for on the next setup run. Use `--uninstall` to remove installed project files. Keep project rules in `CLAUDE.md`.

## Rules

1. Package generic role guidance, reference files, task template, Chief agent and scouts, Chief driver and launchers, and a worker-status pane reference. Project rules stay in each project's `CLAUDE.md`.
2. Exclude backups, `orig/`, task and report archives, ledgers, logs, secrets, user names, absolute user paths, and organization-specific role names. No caveman wording.
3. Setup copies files into the current project root. It does not overwrite different content without a displayed diff and approval; it backs up before replacement, supports `--yes`, `--dry-run`, and `--uninstall`, and refuses malformed JSON, TOML, or YAML settings.
4. Detect only `claude`, `omp`, `codex`, and `agy` using the platform executable lookup; if Herdr is present, also inspect `herdr agent list`. Store the Chief harness and per-category Worker harness, model, and optional effort in `~/.config/herdr/multi-agent.config.json`. Chief defaults to Claude Code. Missing harnesses are not offered.
5. Ask for a harness, model, and optional effort for `normal`, `coding`, `debugging`, and `research`. `omp models` supplies model choices when available; otherwise setup shows an explicitly outdated suggestion or accepts free text. `--yes` uses existing values or suggestions. There is no implicit category model.
6. Read the category row in `multi-agent.config.json` when assigning a task. If the user requests another model for one task, use it and record it in the task header. Never switch a model mid-session. For agy, follow only the interactive-session procedure in `ref_agy_herdr.md`.
7. Never assign a test task to the worker that wrote or built the code. One Worker per code project at a time. Retire a Worker only with the user's OK.
8. Chief and Workers compact at the configured `compact_percent` (default 50); keep one value across harnesses. The context guard warns; finish the atomic step, then compact with focus in that session. Write a handoff only for large state.
9. Load skills and references only when needed. Do not spawn an agent unless the user asks.
10. Bound reads; do not read whole logs. Keep short output in context; move longer output to a file.
11. No Monitor, polling, sleep loops, or tail-follow waits. Start a run once in the background and let the harness wake the session; put abort rules in the script.
12. Version tags use `verX.Y`; commit messages are one line, use the user's identity, contain no trailer, and are not pushed without user approval.
13. Each plugin README has Quick Start and Upgrading. The top-level README is an index with links only.
14. Tests use fixtures only, never real user configuration directories.

## Compaction settings

Setup applies only the compaction setting for the selected harness, after showing its diff and asking before changes. A backup is made first; malformed files are never edited.

| Harness | Setting |
|---|---|
| Claude Code | Launcher environment: `CLAUDE_CODE_AUTO_COMPACT_WINDOW=360000`, `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=<percent>` |
| omp | `~/.omp/agent/config.yml`: `compaction.thresholdPercent` |
| Codex CLI | `~/.codex/config.toml`: `model_auto_compact_token_limit` computed from model window x percent; display the value and confirm |
| agy | Fixed threshold; print a manual-compaction warning |

## CI

CI's OS/Node matrix is configured for Windows, Linux, and macOS; run it before claiming support for Linux or macOS. Require a green matrix before tagging `verX.Y`; tagging does not publish a release.

## Project rules

Put project-specific build, flash, board, vendor, configuration, and hardware constraints in that project's `CLAUDE.md`. This plugin contains reusable role behavior only.
