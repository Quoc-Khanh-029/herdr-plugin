# Worker Status

A standalone Herdr community plugin that opens a live pane showing agents returned by Herdr. It runs without this repository, a Chief ledger, network access, or model calls.

## Requirements

- Herdr 0.9.0 or newer, for the plugin manifest and pane API.
- Node.js 20 or newer; no npm packages or build step.

The pane calls `HERDR_BIN_PATH agent list` (falling back to `herdr` when Herdr does not provide that variable). It uses the returned agent names and `agent_status` values. Herdr is the source of truth for agent state.

## Install and run

For local development, link this directory (this registers a plugin globally for the current Herdr user):

```sh
herdr plugin link /absolute/path/to/plugins/worker-status
herdr plugin pane open --plugin community.worker-status --entrypoint status
```

To remove the local registration later, run `herdr plugin unlink community.worker-status`. Herdr links are per-user and available in every session; review `herdr plugin link --help` and the manifest before linking. The plugin pane is configured as a split.

## Chief user-scope installation

The installed user-scope copy lives at `C:\Users\<user>\.claude\worker-status\plugin`; the launcher is `C:\Users\<user>\.claude\worker-status\launch.mjs`. Copy the plugin directory there and run:

```powershell
herdr plugin link "$HOME\.claude\worker-status\plugin" --enabled
```

One `SessionStart` hook in the user's `~/.claude/settings.json` invokes the launcher for `startup` and `resume`. The launcher accepts only Chief sessions, returns immediately after starting detached pane setup, and exits silently for non-Chiefs. Pane discovery is limited to the Chief tab; an existing `worker-status` pane prevents another from opening. New panes open as a right split using the Chief pane's cwd. If that cwd has `chief_tasks/sessions.json`, matching ledger, inbox, pointer, and context paths are passed to the pane. Otherwise the pane receives no Chief paths and lists Herdr agents only.

The launcher's installation folder is independent of the project. Its pane uses the plugin copy under the user profile and derives its optional Chief data from the active Chief's project cwd.

PowerShell from the repository root:

```powershell
herdr plugin link (Resolve-Path .\plugins\worker-status).Path
herdr plugin pane open --plugin community.worker-status --entrypoint status
```

On macOS/Linux, pass the absolute plugin directory to the same `herdr plugin link` command. The manifest enables all three platforms; each needs `node` available on `PATH`.

For publishing, put the plugin directory in a public GitHub repository and install it with `herdr plugin install owner/repo/worker-status`. Do not use `--yes` for an unreviewed source.

## Operation and optional Chief data

With no optional data configured, the pane lists Herdr agents and their current Herdr states; model, task and context cells show `?`, `(no task)` and `-`. It does not search for Chief files.

To restore the existing dashboard's Chief-specific columns, explicitly configure `WORKER_STATUS_LEDGER` with a JSON ledger containing `sessions`. Only sessions marked `live` are shown. Their `model`, `model_note` or `tier` field supplies MODEL; the latest running task (or final task) supplies TASK and DONE state. A ledger load error is shown as a warning and falls back to Herdr-only data.

Pending ASK/BLOCKED signals require `WORKER_STATUS_INBOX`, set to a YYYY-MM-DD inbox file or a directory of such files. The newest signal per source agent determines whether ASK is active. Set `WORKER_STATUS_POINTERS` to the associated pointer JSON to honor acknowledgements; without pointers, a current ASK/BLOCKED signal is treated as pending. A DONE signal supersedes an older ASK. Set these environment variables before launching Herdr so the pane inherits them. For local testing, the equivalent pane-command options are `--ledger`, `--inbox`, `--pointers`, and `--ctx-dir` (set them in the manifest command).

```powershell
$env:WORKER_STATUS_LEDGER = 'C:\\path\\to\\chief_tasks\\sessions.json'
$env:WORKER_STATUS_INBOX = 'C:\\path\\to\\chief_tasks\\inbox'
$env:WORKER_STATUS_POINTERS = 'C:\\path\\to\\chief_tasks\\inbox\\pointers.json'
$env:WORKER_STATUS_CTX_DIR = 'C:\\path\\to\\context'
```

Set `WORKER_STATUS_CTX_DIR` to a directory of context JSON files named for Herdr's `agent_session.value`; numeric `used_tokens` values are displayed in rounded thousands for non-OMP sessions. For ledger sessions with `runtime = "omp"`, the plugin best-effort reads the mapped agent pane's last four terminal lines through `HERDR_BIN_PATH pane read` and estimates tokens from a `percent/windowK` footer. This footer is terminal output, can be absent or change format, and then displays `-`. OMP pane output is read only when an explicitly configured, valid ledger identifies the session as live and `runtime = "omp"`.
For a live `BOARD` task, any matching Windows `Win32_Process.CommandLine` (`fleet_test.py run`, `rtt_fleet.py` or `logic2_capture.py`) sets the row to purple `TESTING`, overriding ASK, RUNNING and IDLE regardless of ASK timing. Ledger task states `BLOCKED` and `FAILED` take precedence. A pending ASK remains pending when the visible row becomes TESTING; the matching command is not proven to belong to that Worker.

The plugin reads only the paths explicitly configured above. It makes no task, context-token, model or inbox claims when the corresponding source is absent. It does not transmit data, make network requests, or invoke a model. Herdr does not sandbox third-party plugin commands, so inspect the source before installing.

## Tests

From this directory, run:

```sh
node --test test.mjs
```

The tests cover live/working, DONE, pending and acknowledged ASK, blocked, model-name fallbacks, ledger task selection, context-file tokens, OMP footer estimates, no-ledger fallback, inbox precedence, and both fixture-driven pane-entrypoint paths.

## Marketplace and contributions

Marketplace discovery is automatic and unreviewed. To request discovery, add the GitHub topic `herdr-plugin` to the public repository's default branch and keep a parseable `herdr-plugin.toml` manifest in the plugin directory. Herdr refreshes the index periodically; adding the topic does not mean the plugin has been reviewed or published by Herdr.

Contributions should preserve the no-network/no-model runtime, support Windows/macOS/Linux, and include focused deterministic tests. No online listing or publication is claimed for this package.
