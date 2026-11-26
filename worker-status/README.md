# Worker Status

A standalone Herdr plugin that shows live agent state. It runs without this repository, a Chief ledger, network access, or model calls.

## Quick start
1. Install: `herdr plugin install Quoc-Khanh-029/herdr-plugin/worker-status`; from the installed `worker-status` directory in a Herdr pane, run `node setup.mjs` to enable and open a right-side pane at about one-third width.
2. Optional Chief-start auto-open: `node setup.mjs --hook` (review the printed diff and rerun with `--yes`).
3. Use `herdr plugin action invoke community.worker-status.toggle` to toggle the pane; `node setup.mjs --toggle` does the same.
4. Chief environment settings are in `chief_tasks/sessions.json`, `chief_tasks/inbox`, `chief_tasks/inbox/pointers.json`, and `~/.claude/ctx`; configure them only when those sources exist.

Requirements: Herdr 0.9.0 or newer and Node.js 20 or newer. No npm packages or build step.

## Upgrading

For v1 / ver1.0, use this safe reinstall path:
1. Run `herdr plugin uninstall community.worker-status`.
2. Run `herdr plugin install Quoc-Khanh-029/herdr-plugin/worker-status`.
3. Run `herdr server reload-config`.
4. From the installed `worker-status` directory in a Herdr pane, run `node setup.mjs`.

Your Herdr config keybindings and Chief-start hook remain. Rerun `node setup.mjs --hook` only if the launcher path changed; review the diff, then rerun with `--yes`.

## Keyboard shortcut

Use `ctrl+shift+m` directly or `prefix+m` after your configured prefix to toggle the pane (open if absent; close if present). Check active bindings with `prefix+?`; choose unused keys, then run `herdr server reload-config`.
Keys are not installed automatically. Append the TOML below to `~/.config/herdr/config.toml` (Linux/macOS) or `%APPDATA%\herdr\config.toml` (Windows; `herdr --help` prints the resolved path).

    [[keys.command]]
    key = "ctrl+shift+m"
    type = "plugin_action"
    command = "community.worker-status.toggle"

    [[keys.command]]
    key = "prefix+m"
    type = "plugin_action"
    command = "community.worker-status.toggle"

## Behavior

The pane calls `HERDR_BIN_PATH agent list` (falling back to `herdr`) and displays Herdr's agent names and states. It uses optional paths passed by the launcher for Chief-specific model, task, ASK, and context columns. Missing sources are not inferred. The Chief-start hook runs only in Chief sessions, on `startup` and `resume`, and leaves existing settings hooks intact. `node setup.mjs --unhook` removes only this launcher's hook.

The launcher opens one right-side Worker Status pane per tab and reapplies its size on open. Width is the greater of 33% of the tab, `WORKER_STATUS_WIDTH_FRACTION` of the estimated whole terminal (default `0.2`), and 60 columns, capped at the tab width. The renderer keeps each row on one line and clips long tasks with `...`. `setup.mjs`, the toggle action, and the Chief-start hook use the same launcher and inherit this environment variable.

## Tests

Run `node test.mjs` from this directory. Tests cover dashboard rendering, source precedence, fixture-driven pane output, and hook merge/idempotence/removal/invalid-JSON behavior.

## Marketplace

For automatic marketplace discovery, add the GitHub topic `herdr-plugin` to the public repository's default branch and retain a parseable `herdr-plugin.toml` in the plugin directory. Herdr refreshes its index periodically; discovery is not review or endorsement. Inspect plugin source before installing; Herdr does not sandbox third-party commands.
