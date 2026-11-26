# Herdr community plugins

This repository contains the Worker Status Herdr plugin.

## Quick start

1. Install: `herdr plugin install Quoc-Khanh-029/herdr-plugin/worker-status`.
2. Run `node setup.mjs` from the installed `worker-status` directory while in a Herdr pane.
3. Optional Chief-start auto-open: `node setup.mjs --hook`, inspect the diff, then confirm with `--yes`.
4. Toggle from Herdr with `herdr plugin action invoke community.worker-status.toggle`.
5. Chief environment settings come from `chief_tasks/sessions.json`, `chief_tasks/inbox`, `chief_tasks/inbox/pointers.json`, and `~/.claude/ctx`.

See [`worker-status/README.md`](worker-status/README.md) for requirements and behavior.
