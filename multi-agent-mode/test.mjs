import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claudeEnv, configure, defaults, parseJson, parseToml, parseYaml, requireAgyModelApproval, updateToml, updateYaml, validateAgyModel, writeCompaction } from "./setup.mjs";

function fixture() { return mkdtempSync(join(tmpdir(), "multi-agent-mode-")); }

test("writes harness compaction settings to the expected fixture formats", async () => {
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
});


test("supports YAML/TOML, Claude, and agy configuration", async () => {
  assert.equal(updateToml("model = \"x\"\n", 50000), "model = \"x\"\nmodel_auto_compact_token_limit = 50000\n");
  assert.match(updateYaml("compaction:\n  enabled: true\n", 40), /thresholdPercent: 40/);
  assert.match(claudeEnv(50), /CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=50/);
  const home = fixture();
  try { assert.equal(await writeCompaction("agy", 50, { yes: true, dryRun: false, home, modelWindow: 360000 }), "warning-only"); }
  finally { rmSync(home, { recursive: true, force: true }); }
  assert.match(defaults.model_fallback.luna, /gpt-6-luna/);
});

test("config defaults agy to hydrogen and refuses older Gemini model IDs", async () => {
  const home = fixture();
  const scan = { claude: true, omp: true, agy: true, codex: false };
  const configPath = join(home, ".config", "herdr", "multi-agent.config.json");
  try {
    const initial = await configure({ yes: true, scan, home });
    assert.equal(defaults.model_fallback.agy, "hydrogen");
    assert.equal(initial.config.model_fallback.agy, "hydrogen");
    assert.equal(validateAgyModel("hydrogen"), "hydrogen");

    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    saved.model_fallback.agy = "gemini-3.8-flash";
    const legacyText = `${JSON.stringify(saved, null, 2)}\n`;
    writeFileSync(configPath, legacyText);
    await assert.rejects(configure({ yes: true, scan, home }), /Refusing older agy model/);
    assert.equal(readFileSync(configPath, "utf8"), legacyText);

    saved.model_fallback.agy = "hydrogen";
    writeFileSync(configPath, `${JSON.stringify(saved, null, 2)}\n`);
    const accepted = await configure({ yes: true, scan, home });
    assert.equal(accepted.config.model_fallback.agy, "hydrogen");
    assert.throws(() => requireAgyModelApproval(false, false), /explicit user approval/);
    assert.doesNotThrow(() => requireAgyModelApproval(false, true));
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("omp Workers reject Google Antigravity and Gemini model IDs in fixture config", async () => {
  const home = fixture();
  const scan = { claude: true, omp: true, agy: true, codex: false };
  const configPath = join(home, ".config", "herdr", "multi-agent.config.json");
  try {
    await configure({ yes: true, scan, home });
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    for (const forbidden of ["google-antigravity", "gemini-3.8-flash"]) {
      config.model_fallback.luna = forbidden;
      const text = `${JSON.stringify(config, null, 2)}\n`;
      writeFileSync(configPath, text);
      await assert.rejects(configure({ yes: true, scan, home }), /Refusing omp model .*omp Workers use the OpenAI Codex ladder only/);
      assert.equal(readFileSync(configPath, "utf8"), text);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("harness selection uses only detected harnesses and reconfigure overwrites fixture config", async () => {
  const home = fixture();
  try {
    const first = await configure({ yes: true, reconfigure: false, scan: { claude: true, omp: true, agy: false, codex: false }, home });
    assert.equal(first.config.chief, "claude");
    assert.equal(first.config.workers, "omp");
    const second = await configure({ yes: true, reconfigure: true, scan: { claude: false, omp: true, agy: false, codex: true }, home });
    assert.equal(second.config.chief, "omp");
    assert.equal(second.config.workers, "omp");
    assert.equal(JSON.parse(readFileSync(join(home, ".config", "herdr", "multi-agent.config.json"), "utf8")).compact_percent, 50);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
