import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { args, categories, claudeEnv, configure, MODEL_SUGGESTIONS, parseJson, parseToml, parseYaml, updateToml, updateYaml, writeCompaction } from "./setup.mjs";
const root = dirname(fileURLToPath(import.meta.url));
function fixture() { return mkdtempSync(join(tmpdir(), "multi-agent-mode-")); }

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
