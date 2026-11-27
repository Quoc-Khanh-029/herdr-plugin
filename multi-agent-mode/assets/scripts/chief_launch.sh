#!/usr/bin/env bash
compact_percent=50
config_file="$HOME/.config/herdr/multi-agent.config.json"
if [[ -f "$config_file" ]]; then
  configured=$(node -e 'try { process.stdout.write(String(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).compact_percent ?? "")); } catch {}' "$config_file")
  if [[ "$configured" =~ ^([1-9]|[1-9][0-9]|100)$ ]]; then compact_percent=$configured; fi
fi
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=360000
export CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=$compact_percent
node "$(dirname "${BASH_SOURCE[0]}")/chief_name.mjs" || exit $?
exec claude --agent chief --dangerously-skip-permissions --remote-control "$@"
