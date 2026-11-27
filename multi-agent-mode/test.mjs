import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";
import { chiefNameForWorkspace, isChiefName, isWorkerName, slug } from "./assets/scripts/chief_name.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, categories, claudeEnv, configure, MODEL_SUGGESTIONS, parseJson, parseToml, parseYaml, updateToml, updateYaml, writeCompaction } from "./setup.mjs";
const root = dirname(fileURLToPath(import.meta.url));
function fixture() { return mkdtempSync(join(tmpdir(), "multi-agent-mode-")); }
const fakeHerdrDir = join(root, "..", "test", "fixtures", "fake-herdr");
if (process.platform !== "win32") chmodSync(join(fakeHerdrDir, "herdr"), 0o755);
const packagedChiefName = join(root, "assets", "scripts", "chief_name.mjs");
function testEnv(home, fixtureEnv) {
  return {
    PATH: `${fakeHerdrDir}${delimiter}${process.env.PATH ?? ""}`,
    HOME: home,
    USERPROFILE: home,
    ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
    TEMP: home,
    ...fixtureEnv,
  };
}
function runFakeChiefName({ label, folder = "project_name", agentName = "claude", tabLabel = "staff", herdrEnv = "1", args = [] }) {
  const home = fixture();
  const project = join(home, folder);
  const scripts = join(project, "scripts");
  mkdirSync(scripts, { recursive: true });
  const helper = join(scripts, "chief_name.mjs");
  writeFileSync(helper, readFileSync(packagedChiefName, "utf8"));
  const state = join(home, "herdr.json");
  const env = testEnv(home, { FAKE_HERDR_STATE: state, FAKE_WORKSPACE_LABEL: label, FAKE_AGENT_NAME: agentName, FAKE_TAB_LABEL: tabLabel, HERDR_ENV: herdrEnv });
  const result = spawnSync(process.execPath, [helper, ...args], { cwd: project, encoding: "utf8", env, windowsHide: true });
  return { home, project, state, result };
}

function recorder(prompts, answers = {}) {
  return async (label, suggested, options) => {
    if (!options.ask) return suggested;
    prompts.push(`${label}: ${suggested || "none"}`);
    return Object.hasOwn(answers, label) ? answers[label] : suggested;
  };
}
function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.isFile() && entry.name.endsWith(".md") ? [path] : [];
  });
}

test("writes harness compaction settings to fixture formats and rejects malformed input", async () => {
  const home = fixture();
  try {
    const omp = join(home, ".omp", "agent"); mkdirSync(omp, { recursive: true });
    const codex = join(home, ".codex"); mkdirSync(codex);
    writeFileSync(join(omp, "config.yml"), "compaction:\n  enabled: true\n");
    writeFileSync(join(codex, "config.toml"), "model = \"example\"\n");
    await writeCompaction("omp", 50, { yes: true, dryRun: false, home, modelWindow: 360000 });
    await writeCompaction("codex", 50, { yes: true, dryRun: false, home, modelWindow: 272000 });
    assert.match(readFileSync(join(omp, "config.yml"), "utf8"), /thresholdPercent: 50/);
    assert.match(readFileSync(join(codex, "config.toml"), "utf8"), /model_auto_compact_token_limit = 136000/);
    assert.equal(parseJson("{\"ok\":true}").ok, true);
    assert.throws(() => parseJson("{bad"), /Refusing to edit invalid JSON/);
    assert.throws(() => parseToml("not toml"), /Refusing to edit invalid TOML/);
    assert.throws(() => parseYaml("not yaml"), /Refusing to edit invalid YAML/);
  } finally { rmSync(home, { recursive: true, force: true }); }
  assert.equal(updateToml("model = \"x\"\n", 50000), "model = \"x\"\nmodel_auto_compact_token_limit = 50000\n");
  assert.match(updateYaml("compaction:\n  enabled: true\n", 40), /thresholdPercent: 40/);
  assert.match(claudeEnv(50), /CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50/);
});

test("interactive setup asks and accepts suggestions for all four categories", async () => {
  const home = fixture();
  const prompts = [];
  const scan = { claude: true, omp: true, codex: true, agy: true };
  try {
    const result = await configure({ yes: false, scan, home, modelLists: { claude: ["claude-live-model"] }, askValueFn: recorder(prompts) });
    assert.deepEqual(Object.keys(result.config.categories), categories);
    assert.deepEqual(result.config.categories.normal, { harness: "claude", model: "claude-live-model", effort: "" });
    assert.equal(prompts.length, 13);
    assert.deepEqual(prompts.slice(1).filter((line) => line.includes(" harness:")), categories.map((category) => `${category} harness: claude`));
    console.log(`Interactive fixture prompt transcript:\n${prompts.join("\n")}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("--yes accepts existing values and suggestions; old harness-only config loads", async () => {
  const home = fixture();
  const configPath = join(home, ".config", "herdr", "multi-agent.config.json");
  const legacy = { chief: "claude", workers: "omp", compact_percent: 40 };
  const scan = { claude: true, omp: true, codex: true, agy: false };
  let promptCount = 0;
  try {
    mkdirSync(join(home, ".config", "herdr"), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(legacy)}\n`);
    const result = await configure({ yes: true, scan, home, modelLists: { claude: ["live-claude"] }, askValueFn: async (_label, suggested, options) => { if (options.ask) promptCount++; return suggested; } });
    assert.equal(promptCount, 0);
    assert.deepEqual(Object.keys(result.config.categories), categories);
    assert.equal(result.config.categories.coding.model, "live-claude");
    assert.equal(result.config.compact_percent, 40);
    assert.equal(result.config.workers, undefined);
    const saved = { ...legacy, categories: { normal: { harness: "codex", model: "preserved-model", effort: "high" } } };
    writeFileSync(configPath, `${JSON.stringify(saved)}\n`);
    const reused = await configure({ yes: true, scan, home, modelLists: { claude: ["live-claude"] } });
    assert.deepEqual(reused.config.categories.normal, saved.categories.normal);
    assert.equal(args(["--yes"]).yes, true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("--reconfigure coding asks only that category and accepts the selected harness", async () => {
  const home = fixture();
  const scan = { claude: true, omp: false, codex: true, agy: false };
  const modelLists = { claude: ["claude-live"], codex: ["codex-live"] };
  const prompts = [];
  try {
    const initial = await configure({ yes: true, scan, home, modelLists });
    const changed = await configure({ yes: false, reconfigure: "coding", scan, home, modelLists, askValueFn: recorder(prompts, { "coding harness": "codex", "coding model": "typed-coding-model", "coding effort (optional)": "high" }) });
    assert.deepEqual(prompts.map((line) => line.split(":")[0]), ["coding harness", "coding model", "coding effort (optional)"]);
    assert.deepEqual(changed.config.categories.coding, { harness: "codex", model: "typed-coding-model", effort: "high" });
    for (const category of categories.filter((name) => name !== "coding")) assert.deepEqual(changed.config.categories[category], initial.config.categories[category]);
    assert.equal(args(["--reconfigure", "coding"]).reconfigure, "coding");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("harness prompts offer only detected harnesses", async () => {
  const home = fixture();
  const offered = [];
  try {
    await configure({ yes: false, scan: { claude: true, omp: false, codex: true, agy: false }, home, modelLists: { claude: ["live"] }, askValueFn: async (label, suggestion, options) => { if (label.endsWith("harness")) offered.push(options.choices); return suggestion; } });
    assert.ok(offered.every((choices) => !choices.includes("omp") && !choices.includes("agy")));
    assert.ok(offered.every((choices) => choices.includes("claude") && choices.includes("codex")));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("rules, skills, and README keep model selection generic; static suggestions stay in MODEL_SUGGESTIONS", () => {
  const skillDir = join(root, "assets", ".claude");
  const files = [join(root, "README.md"), join(root, "ref_agy_herdr.md"), ...markdownFiles(skillDir)];
  const forbidden = /\b(?:luna|terra|sol|hydrogen)\b|gpt-6|openai-codex/i;
  for (const file of files) assert.doesNotMatch(readFileSync(file, "utf8"), forbidden, file);
  assert.deepEqual(Object.keys(MODEL_SUGGESTIONS), ["claude", "omp", "codex", "agy"]);
});
test("Chief name matching and workspace slug follow the naming contract", () => {
  assert.equal(chiefNameForWorkspace("  TSN /  EP!! ", "fallback"), "chief-tsn-ep");
  assert.equal(slug(" Worker___1 !!! "), "worker___1");
  assert.equal(chiefNameForWorkspace("!!!", "My_Project"), "chief-my_project");
  assert.equal(isChiefName("chief"), true);
  assert.equal(isChiefName("chief-worker-1"), true);
  assert.equal(isChiefName("chief-gemini"), true);
  assert.equal(isChiefName("staff-gemini"), true);
  assert.equal(isChiefName("worker-1"), false);
  assert.equal(isWorkerName("worker-1"), true);
  assert.equal(isWorkerName("chief-worker-1"), false);
});

test("launcher naming uses workspace label, renames legacy names, and is idempotent with fake Herdr", () => {
  const run = runFakeChiefName({ label: "TSN EP / Lab", agentName: "staff" });
  try {
    assert.equal(run.result.status, 0, run.result.stderr);
    assert.equal(run.result.stdout, "Chief pane pane-1 named chief-tsn-ep-lab; Chief tab labelled chief.\n");
    let state = JSON.parse(readFileSync(run.state, "utf8"));
    assert.equal(state.agents[0].name, "chief-tsn-ep-lab");
    assert.equal(state.tabs[0].label, "chief");
    assert.ok(state.calls.some((call) => call[0] === "agent" && call[1] === "rename" && call[3] === "chief-tsn-ep-lab"));
    assert.ok(state.calls.some((call) => call[0] === "tab" && call[1] === "rename" && call[3] === "chief"));
    const before = state.calls.length;
    const second = spawnSync(process.execPath, [join(run.project, "scripts", "chief_name.mjs")], { cwd: run.project, encoding: "utf8", env: testEnv(run.home, { FAKE_HERDR_STATE: run.state, HERDR_ENV: "1" }), windowsHide: true });
    assert.equal(second.status, 0, second.stderr);
    state = JSON.parse(readFileSync(run.state, "utf8"));
    assert.equal(state.calls.length - before, 4);
    assert.equal(state.calls.filter((call) => call[0] === "agent" && call[1] === "rename").length, 1);
    assert.equal(state.calls.filter((call) => call[0] === "tab" && call[1] === "rename").length, 1);
  } finally { rmSync(run.home, { recursive: true, force: true }); }
});

test("Chief name falls back to project folder and outside Herdr leaves the name unset", () => {
  const fallback = runFakeChiefName({ label: "!!!", folder: "My_Project", agentName: "claude" });
  try {
    assert.equal(fallback.result.status, 0, fallback.result.stderr);
    assert.match(fallback.result.stdout, /chief-my_project/);
  } finally { rmSync(fallback.home, { recursive: true, force: true }); }
  const outside = runFakeChiefName({ label: "ignored", herdrEnv: "" });
  try {
    assert.equal(outside.result.status, 0, outside.result.stderr);
    assert.equal(outside.result.stdout, "Chief name was not set (HERDR_ENV is not set).\n");
    assert.equal(existsSync(outside.state), false);
  } finally { rmSync(outside.home, { recursive: true, force: true }); }
});
test("Chief naming helper guards help, dry-run, and unknown arguments", () => {
  const help = runFakeChiefName({ label: "TSN EP", args: ["--help"] });
  try {
    assert.equal(help.result.status, 0);
    assert.equal(help.result.stdout, "Usage: node chief_name.mjs [--help | --dry-run]\n");
    assert.equal(existsSync(help.state), false);
  } finally { rmSync(help.home, { recursive: true, force: true }); }

  const invalid = runFakeChiefName({ label: "TSN EP", args: ["--unknown"] });
  try {
    assert.equal(invalid.result.status, 2);
    assert.match(invalid.result.stderr, /Usage:/);
    assert.equal(existsSync(invalid.state), false);
  } finally { rmSync(invalid.home, { recursive: true, force: true }); }

  const dry = runFakeChiefName({ label: "TSN EP / Lab", agentName: "staff", tabLabel: "staff", args: ["--dry-run"] });
  try {
    assert.equal(dry.result.status, 0, dry.result.stderr);
    assert.equal(dry.result.stdout, "Would name pane pane-1 chief-tsn-ep-lab; label tab tab-1 chief.\n");
    const state = JSON.parse(readFileSync(dry.state, "utf8"));
    assert.equal(state.agents[0].name, "staff");
    assert.equal(state.tabs[0].label, "staff");
    assert.equal(state.calls.some((call) => call[0] === "agent" && call[1] === "rename"), false);
    assert.equal(state.calls.some((call) => call[0] === "tab" && call[1] === "rename"), false);
  } finally { rmSync(dry.home, { recursive: true, force: true }); }
});


test("packaged chief init creates markers and keeps existing ledger rows", () => {
  const home = fixture();
  const project = join(home, "project");
  const tasks = join(project, "chief_tasks");
  mkdirSync(tasks, { recursive: true });
  const original = { chief_name: "chief-tsn_ep", sessions: [{ name: "worker-7", pane: "pane-7", status: "live", tasks: [] }] };
  writeFileSync(join(tasks, "sessions.json"), `${JSON.stringify(original, null, 2)}\n`);
  try {
    const result = spawnSync(process.execPath, [join(root, "assets", "scripts", "chief.ts"), "init"], { cwd: project, encoding: "utf8", windowsHide: true });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /"kept_sessions":1/);
    assert.deepEqual(JSON.parse(readFileSync(join(tasks, "sessions.json"), "utf8")), original);
    assert.ok(existsSync(join(tasks, "inbox")));
    assert.ok(existsSync(join(tasks, "sessions.md")));
    assert.ok(existsSync(join(project, "worker_report")));
  } finally { rmSync(home, { recursive: true, force: true }); }
});
