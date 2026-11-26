# Worker signals

Send exactly one signal after the report exists or when blocked:

- `node scripts/chief.ts signal DONE <task-id>` — report is complete.
- `node scripts/chief.ts signal ASK <task-id> --text "<question>"` — a decision or missing information is required.
- `node scripts/chief.ts signal BLOCKED <task-id> --text "<blocker>"` — a prerequisite prevents progress.

State facts, exact paths, and the smallest actionable request. After signaling, stop; do not poll or repeatedly notify Chief.
