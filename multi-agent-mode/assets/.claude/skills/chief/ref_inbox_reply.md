# Signals and replies

Workers send `DONE`, `ASK`, or `BLOCKED` through the coordination CLI. `ASK` requests a decision or missing information; answer only after checking the task and project rules. `BLOCKED` identifies an unavailable prerequisite. A `DONE` signal points to the report; verify report status, criteria, and evidence before closing work.
