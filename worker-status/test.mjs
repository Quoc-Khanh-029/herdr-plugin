import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildRows, contextTokens, modelShort, pendingAsks, readOmpTokens, renderDashboard, stateFor } from "./index.mjs";

const liveAgents = [
  { name: "worker-live", agent_status: "working", pane_id: "pane-live" },
  { name: "worker-done", agent_status: "idle", pane_id: "pane-done" },
  { name: "worker-ask", agent_status: "working", pane_id: "pane-ask" },
  { name: "worker-ctx", agent_status: "idle", agent_session: { value: "session-ctx" } },
  { name: "worker-blocked", agent_status: "blocked", agent_session: { value: "session-blocked" } },
];

const sessions = [
  { name: "worker-live", status: "live", runtime: "omp", model: "openai-codex/gpt-6.1-terra", tasks: [{ id: "2026-11-25_build-widget", status: "running" }] },
  { name: "worker-done", status: "live", runtime: "omp", model_note: "Sonnet 5.5 (claude-sonnet-5-5)", tasks: [{ id: "2026-11-25_review-widget", status: "DONE" }] },
  { name: "worker-ask", status: "live", runtime: "omp", tier: "luna", tasks: [{ id: "2026-11-25_wait-for-input", status: "running" }] },
  { name: "worker-ctx", status: "live", runtime: "claude", tier: "luna", tasks: [{ id: "2026-11-25_read-docs", status: "running" }] },
  { name: "worker-blocked", status: "live", runtime: "claude", tier: "sonnet", tasks: [{ id: "2026-11-25_debug", status: "running" }] },
];

function fixtureDir() {
  const dir = mkdtempSync(join(tmpdir(), "worker-status-parity-"));
  mkdirSync(join(dir, "inbox"));
  mkdirSync(join(dir, "ctx"));
  return dir;
}

function writeFixture(dir, name, data) {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(data));
  return path;
}

test("restores live, DONE, ASK, model, task, and context columns from configured sources", () => {
  const dir = fixtureDir();
  try {
    writeFixture(join(dir, "ctx"), "session-ctx.json", { used_tokens: 79127 });
    writeFixture(join(dir, "ctx"), "session-blocked.json", { used_tokens: 12500 });
    const inbox = join(dir, "inbox");
    writeFileSync(join(inbox, "2026-11-24.md"), "## #1 2026-11-24T10:00:00Z ASK old-task from worker-done\n");
    writeFileSync(join(inbox, "2026-11-25.md"), [
      "## #2 2026-11-25T10:00:00Z DONE current-task from worker-done",
      "## #3 2026-11-25T10:01:00Z ASK current-task from worker-ask",
      "## #4 2026-11-25T10:02:00Z BLOCKED current-task from worker-blocked",
    ].join("\n"));
    const pointers = writeFixture(dir, "pointers.json", {
      "chief_tasks/inbox/2026-11-25.md#3": "acked",
    });
    const askInfo = pendingAsks(inbox, pointers);
    assert.equal(askInfo.names.has("worker-ask"), false);
    assert.equal(askInfo.names.has("worker-done"), false);
    assert.equal(askInfo.names.has("worker-blocked"), true);

    const footerFixture = writeFixture(dir, "footer.json", {
      "pane-live": "Context 30%/200K",
      "pane-done": "Context 65%/100K",
      "pane-ask": "Context 10%/100K",
    });
    const footerTokens = readOmpTokens(liveAgents, { footerFixture });
    assert.equal(footerTokens.get("pane-live"), "60k");
    assert.equal(contextTokens(liveAgents[3], join(dir, "ctx")), "79k");
    assert.equal(modelShort(sessions[0]), "terra");
    assert.equal(modelShort(sessions[1]), "sonnet");

    const rows = buildRows(liveAgents, sessions, {
      ledgerConfigured: true,
      pendingAsks: askInfo.names,
      ctxDir: join(dir, "ctx"),
      footerTokens,
    });
    const byName = new Map(rows.map((row) => [row.name, row]));
    assert.deepEqual(
      [byName.get("worker-live").state, byName.get("worker-live").model, byName.get("worker-live").task, byName.get("worker-live").tokens],
      ["RUNNING", "terra", "build-widget", "60k"],
    );
    assert.deepEqual(
      [byName.get("worker-done").state, byName.get("worker-done").model, byName.get("worker-done").task],
      ["DONE", "sonnet", "review-widget"],
    );
    assert.equal(byName.get("worker-ask").state, "RUNNING", "acked ASK does not override current working state");
    assert.deepEqual(
      [byName.get("worker-ctx").state, byName.get("worker-ctx").tokens, byName.get("worker-ctx").task],
      ["IDLE", "79k", "read-docs"],
    );
    assert.equal(byName.get("worker-blocked").state, "ASK");
    assert.equal(byName.get("worker-blocked").tokens, "13k");
    const output = renderDashboard(rows, 120, new Date("2026-11-25T12:00:00Z")).join("\n");
    assert.match(output, /MODEL/);
    assert.match(output, /CTX/);
    assert.match(output, /worke~ terra RUNNING build-widget\s+60k/);
    assert.match(output, /worke~ sonn~ DONE\s+review-widget/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("shows TESTING only for a BOARD worker with a matching live process", () => {
  const agents = [{ name: "worker-board", agent_status: "working" }];
  const baseTask = { id: "2026-11-25_board-run", status: "running", mode: "BOARD" };
  const boardSession = { name: "worker-board", status: "live", tasks: [baseTask] };
  const processFixture = [{ commandLine: "python fleet_test.py run --step all" }];
  const options = { ledgerConfigured: true, processes: processFixture };
  assert.equal(buildRows(agents, [boardSession], options)[0].state, "TESTING");
  const asks = new Set(["worker-board"]);
  assert.equal(buildRows(agents, [boardSession], { ...options, pendingAsks: asks })[0].state, "TESTING");
  assert.equal(asks.size, 1, "TESTING does not clear the pending ASK mark");
  assert.equal(buildRows([{ name: "worker-board", agent_status: "blocked" }], [boardSession], options)[0].state, "TESTING");
  for (const status of ["BLOCKED", "FAILED"]) {
    const terminal = { ...boardSession, tasks: [{ ...baseTask, status }] };
    assert.equal(buildRows(agents, [terminal], options)[0].state, status);
  }
  assert.equal(buildRows(agents, [{ ...boardSession, tasks: [{ ...baseTask, mode: "BUILD" }] }], options)[0].state, "RUNNING");
  assert.equal(buildRows(agents, [boardSession], { ...options, processes: [] })[0].state, "RUNNING");
  const nonBoard = { ...boardSession, tasks: [{ ...baseTask, mode: "EDIT-ALLOWED" }] };
  assert.equal(buildRows(agents, [nonBoard], options)[0].state, "RUNNING");

  const lines = renderDashboard([{ name: "w-1", model: "luna", state: "TESTING", task: "board-run", tokens: "-" }], 51, new Date("2026-11-25T12:00:00Z"));
  assert.ok(lines.every((line) => line.length <= 50));
  assert.match(lines[2], /TESTING/);
  assert.match(renderDashboard([{ name: "w-1", model: "luna", state: "TESTING", task: "board-run", tokens: "-" }], 80, new Date(), true)[2], /\x1b\[35mTESTING/);
});

test("uses fixed-width columns and keeps every visible line inside the pane", () => {
  const rows = [
    { name: "worker-123456", model: "verylongmodel", state: "RUNNING", task: "a-very-long-task-name-that-must-never-wrap", tokens: "12345678k" },
    { name: "worker-b", model: "luna", state: "IDLE", task: "read", tokens: "-" },
    { name: "worker-c", model: "terra", state: "BLOCKED", task: "another-very-long-task-name", tokens: "1234k" },
  ];
  for (const width of [51, 60, 80]) {
    const lines = renderDashboard(rows, width, new Date("2026-11-25T12:00:00Z"));
    assert.ok(lines.every((line) => line.length <= width - 1), `line exceeds ${width - 1} columns at width ${width}`);
    assert.equal(lines[1].slice(0, 27).trimEnd(), "#      MODEL STATE   TASK");
    assert.match(lines[2], /^worke~ very~ RUNNING /);
    if (width < 80) assert.match(lines[2], /\.\.\.\s+999k\+$/);
    else assert.match(lines[2], /never-wrap\s+999k\+$/);
    assert.match(lines[3], / {4}-$/);
  }
});

test("retains generic Herdr-only fallback with no configured ledger", () => {
  const rows = buildRows([{ name: "agent-a", agent_status: "working" }, { name: "agent-b", agent_status: "blocked" }], [], {
    ledgerConfigured: false,
  });
  assert.deepEqual(rows.map(({ name, model, state, task, tokens }) => [name, model, state, task, tokens]), [
    ["agent-a", "?", "RUNNING", "(no task)", "-"],
    ["agent-b", "?", "BLOCKED", "(no task)", "-"],
  ]);
});

test("actual pane entrypoint displays generic Herdr-only data without a ledger", () => {
  const dir = fixtureDir();
  try {
    const agentsPath = writeFixture(dir, "agents.json", { result: { agents: [
      { name: "agent-a", agent_status: "working" },
      { name: "idle-agent", agent_status: "idle" },
    ] } });
    const env = { ...process.env };
    delete env.WORKER_STATUS_LEDGER;
    delete env.WORKER_STATUS_INBOX;
    delete env.WORKER_STATUS_POINTERS;
    delete env.WORKER_STATUS_CTX_DIR;
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./index.mjs", import.meta.url)), "--once", "--agents-json", agentsPath,
    ], { encoding: "utf8", windowsHide: true, env });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /agent~ \?     RUNNING \(no task\).*-/);
    assert.match(result.stdout, /idle-~ \?     IDLE    \(no task\).*-/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("resolves inbox state to the latest per-agent signal and tolerates absent pointers", () => {
  const dir = fixtureDir();
  try {
    const inbox = join(dir, "inbox");
    writeFileSync(join(inbox, "2026-11-25.md"), [
      "## #1 2026-11-25T10:00:00Z ASK task-a from agent-a",
      "## #2 2026-11-25T10:01:00Z DONE task-a from agent-a",
      "## #3 2026-11-25T10:02:00Z ASK task-b from agent-b",
    ].join("\n"));
    const { names, warning } = pendingAsks(inbox);
    assert.equal(warning, "");
    assert.equal(names.has("agent-a"), false);
    assert.equal(names.has("agent-b"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runs the pane entrypoint against fixture Herdr, ledger, inbox and context data", () => {
  const dir = fixtureDir();
  try {
    const agentsPath = writeFixture(dir, "agents.json", { result: { agents: liveAgents } });
    const ledgerPath = writeFixture(dir, "ledger.json", { sessions });
    const pointersPath = writeFixture(dir, "pointers.json", {});
    const footerPath = writeFixture(dir, "footer.json", { "pane-live": "Context 30%/200K" });
    writeFixture(join(dir, "ctx"), "session-ctx.json", { used_tokens: 79127 });
    writeFixture(join(dir, "ctx"), "session-blocked.json", { used_tokens: 12500 });
    writeFileSync(join(dir, "inbox", "2026-11-25.md"), "## #3 2026-11-25T10:01:00Z ASK current-task from worker-ask\n");
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL("./index.mjs", import.meta.url)), "--once",
      "--agents-json", agentsPath, "--ledger", ledgerPath, "--inbox", join(dir, "inbox"),
      "--pointers", pointersPath, "--ctx-dir", join(dir, "ctx"), "--footer-fixture", footerPath,
    ], { encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /worke~ terra RUNNING build-widget\s+60k/);
    assert.match(result.stdout, /worke~ sonn~ DONE\s+review-widget/);
    assert.match(result.stdout, /worke~ luna  ASK\s+wait-for-input/);
    assert.match(result.stdout, /worke~ luna  IDLE\s+read-docs\s+79k/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("maps Herdr state values without optional source data", () => {
  assert.equal(stateFor({ agent_status: "working" }), "RUNNING");
  assert.equal(stateFor({ agent_status: "blocked" }), "BLOCKED");
  assert.equal(stateFor({ agent_status: "idle" }), "IDLE");
});

test("shows an empty agent set explicitly", () => {
  assert.match(renderDashboard([], 80).join("\n"), /No agents found/);
});
