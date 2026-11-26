# Interactive agy workflow

1. Confirm `agy` is available and a Herdr pane is assigned to the interactive session.
2. Gemini models are reachable only through agy (interactive pane via herdr agent prompt); never via omp or any other harness.
3. Start the interactive session with `hydrogen` (Gemini 4), selected using `agy --model hydrogen` or `/model hydrogen` inside agy; installed `agy --help` lists the `--model` option. Older Gemini model IDs are rejected; a newer agy model needs the user's explicit approval.
4. Send the task only through `herdr agent prompt <agent-name> "Read <task-file> and execute it"`. Never use a print/non-interactive mode.
5. Check the pane to confirm the prompt was submitted; a visible pasted draft is not proof of submission.
6. Read the result and cited files. A separate read-only worker on another harness verifies every factual claim before it is reported.
7. If agy is unavailable, do not offer this route.
