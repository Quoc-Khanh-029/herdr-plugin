import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

const root = dirname(fileURLToPath(import.meta.url));
const assets = join(root, "assets");
const harnesses = ["claude", "omp", "codex", "agy"];
const categories = ["normal", "coding", "debugging", "research"];
const defaults = { chief: "claude", compact_percent: 50 };
// Static suggestions may be outdated; prefer live model lists when available.
const MODEL_SUGGESTIONS = {
  claude: "claude-sonnet-4-5",
  omp: "openai-codex/gpt-6-luna",
  codex: "gpt-5-codex",
  agy: "hydrogen",
};
function modelList(harness) {
  if (harness !== "omp") return [];
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "omp models"], { encoding: "utf8", windowsHide: true })
    : spawnSync("omp", ["models"], { encoding: "utf8", windowsHide: true });
  return result.status === 0 ? result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : [];
}
async function askValue(label, suggested, { ask, choices = [], values = [], suggestionNote = "" } = {}) {
  if (!ask) return suggested;
  stdout.write(`${label}${choices.length ? ` (${choices.join(", ")})` : ""}\nSuggested${suggestionNote}: ${suggested || "none"}; press Enter to accept or type another value.\n`);
  const rl = createInterface({ input: stdin, output: stdout });
  let answer;
  try { answer = await rl.question("> "); }
  finally { rl.close(); }
  const value = answer === "" ? suggested : answer;
  if (values.length && !values.includes(value)) throw new Error(`Invalid ${label}: ${value}`);
  return value;
}
function normalizeReconfigure(value) {
  if (value === true) return true;
  if (typeof value === "string" && categories.includes(value)) return value;
  if (value) throw new Error(`Unknown reconfigure category: ${value}`);
  return false;
}
function availableHarnesses(scan) { return harnesses.filter((name) => Boolean(scan[name])); }
function validCategory(row, scan) {
  return row && scan[row.harness] && typeof row.model === "string" && row.model.trim() &&
    (row.effort === undefined || row.effort === "" || ["low", "medium", "high"].includes(row.effort));
}
async function configure({ yes, reconfigure, dryRun = false, scan = scanHarnesses(), home = homedir(), askValueFn = askValue, modelLists = {} }) {
  const path = join(home, ".config", "herdr", "multi-agent.config.json");
  const current = existsSync(path) ? parseJson(readFileSync(path, "utf8"), "configuration JSON") : {};
  const reconfigureValue = normalizeReconfigure(reconfigure);
  const ask = !yes;
  const choices = availableHarnesses(scan);
  if (!choices.length) throw new Error("No available harness");
  const chiefSuggestion = scan[current.chief] ? current.chief : scan[defaults.chief] ? defaults.chief : choices[0];
  const chief = reconfigureValue === true || !scan[current.chief]
    ? await askValueFn("Chief harness", chiefSuggestion, { ask, choices, values: choices })
    : current.chief;
  const configured = { ...(current.categories ?? {}) };
  const selectedCategories = reconfigureValue === true ? categories : reconfigureValue ? [reconfigureValue] : categories;
  for (const category of selectedCategories) {
    const old = configured[category];
    if (validCategory(old, scan) && !reconfigureValue) continue;
    const harnessSuggestion = scan[old?.harness] ? old.harness : scan.claude ? "claude" : choices[0];
    const harness = await askValueFn(`${category} harness`, harnessSuggestion, { ask, choices, values: choices });
    const listed = modelLists[harness] ?? modelList(harness);
    const fallback = MODEL_SUGGESTIONS[harness] ?? "";
    const modelSuggestion = old?.harness === harness && typeof old.model === "string" && old.model ? old.model : listed[0] ?? fallback;
    const suggestionNote = old?.harness === harness && old.model || listed.length || !MODEL_SUGGESTIONS[harness] ? "" : " (may be outdated)";
    if (!modelSuggestion && !ask) throw new Error(`No model suggestion for ${harness}; rerun interactively to enter a model`);
    if (listed.length && ask) stdout.write(`${harness} models:\n${listed.map((model) => `  ${model}`).join("\n")}\n`);
    const model = await askValueFn(`${category} model`, modelSuggestion, { ask, choices: listed, suggestionNote });
    if (typeof model !== "string" || !model.trim()) throw new Error(`${category} model must be a non-empty string`);
    const effortSuggestion = ["low", "medium", "high"].includes(old?.effort) ? old.effort : "";
    const effort = await askValueFn(`${category} effort (optional)`, effortSuggestion, { ask, choices: ["low", "medium", "high"], values: ["", "low", "medium", "high"] });
    configured[category] = { harness, model, effort };
  }
  const config = { chief, categories: configured, compact_percent: current.compact_percent ?? defaults.compact_percent };
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  return { path, config, scan };
}
const targets = [".claude/skills/chief/SKILL.md", ".claude/skills/chief/task_template.md", ".claude/skills/chief/ref_task_file.md", ".claude/skills/chief/ref_start_dispatch.md", ".claude/skills/chief/ref_inbox_reply.md", ".claude/skills/chief/ref_retire_ctx.md", ".claude/skills/chief/ref_quick.md", ".claude/skills/chief/ref_agy_herdr.md", ".claude/skills/worker/SKILL.md", ".claude/skills/worker/ref_signals.md", ".claude/skills/worker/ref_context_handoff.md", ".claude/skills/worker/report_format.md", ".claude/agents/chief.md", ".claude/agents/scout-code.md", ".claude/agents/scout-research.md", "scripts/chief.ts", "scripts/chief_launch.ps1", "scripts/chief_launch.sh", "worker-status-reference.md"];

function executable(name) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(command, [name], { encoding: "utf8", windowsHide: true });
  return result.status === 0 && Boolean(result.stdout.trim());
}
function runHerdrAgentList() {
  const result = process.platform === "win32"
    ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "herdr agent list"], { encoding: "utf8", windowsHide: true })
    : spawnSync("herdr", ["agent", "list"], { encoding: "utf8", windowsHide: true });
  return result;
}
function scanHarnesses() {
  const found = Object.fromEntries(harnesses.map((name) => [name, executable(name)]));
  found.herdr = executable("herdr");
  if (found.herdr) {
    const result = runHerdrAgentList();
    found.herdr_agents = result.status === 0;
    if (found.herdr_agents) {
      try {
        const parsed = JSON.parse(result.stdout);
        const agents = parsed.agents ?? parsed.result?.agents ?? [];
        for (const agent of agents) {
          const runtime = String(agent.runtime ?? agent.harness ?? "").toLowerCase();
          if (harnesses.includes(runtime)) found[runtime] = true;
        }
      } catch { /* Herdr versions can return non-JSON status text. */ }
    }
  }
  return found;
}
function parseJson(text, label = "JSON") {
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`Refusing to edit invalid ${label}: ${error.message}`); }
}
function parseToml(text) {
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    if (/^\[[A-Za-z0-9_.-]+\]$/.test(line)) continue;
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!match) throw new Error(`Refusing to edit invalid TOML at line ${index + 1}`);
    const value = match[2].trim();
    if (!/^(?:"(?:[^"\\]|\\.)*"|'[^']*'|true|false|null|-?\d+(?:\.\d+)?|[\[{].*[\]}])$/.test(value)) throw new Error(`Refusing to edit invalid TOML at line ${index + 1}`);
  }
  if (!text.trim()) throw new Error("Refusing to edit empty TOML");
  return text;
}
function parseYaml(text) {
  let previousIndent = 0;
  for (const [index, raw] of text.split(/\r?\n/).entries()) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    if (/\t/.test(raw)) throw new Error(`Refusing to edit invalid YAML at line ${index + 1}`);
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent % 2 !== 0 || indent > previousIndent + 2 || !/^(?:[A-Za-z0-9_.-]+\s*:\s*(?:.*)?|-\s+.+)$/.test(line)) throw new Error(`Refusing to edit invalid YAML at line ${index + 1}`);
    previousIndent = line.endsWith(":") ? indent + 2 : indent;
  }
  if (!text.trim()) throw new Error("Refusing to edit empty YAML");
  return text;
}
function compactTokenLimit(modelWindow, percent) {
  if (!Number.isFinite(modelWindow) || modelWindow < 1 || !Number.isFinite(percent) || percent < 1 || percent > 100) throw new Error("Invalid context window or compaction percentage");
  return Math.floor(modelWindow * percent / 100);
}
function updateToml(text, tokens) {
  const parsed = parseToml(text);
  const line = `model_auto_compact_token_limit = ${tokens}`;
  return /^model_auto_compact_token_limit\s*=.*$/m.test(parsed) ? parsed.replace(/^model_auto_compact_token_limit\s*=.*$/m, line) : `${parsed.trimEnd()}\n${line}\n`;
}
function updateYaml(text, percent) {
  const parsed = parseYaml(text);
  const lines = parsed.split(/\r?\n/);
  const start = lines.findIndex((line) => /^compaction\s*:\s*(?:#.*)?$/.test(line));
  if (start < 0) return `${parsed.trimEnd()}\ncompaction:\n  thresholdPercent: ${percent}\n`;
  let end = start + 1;
  while (end < lines.length && (!lines[end].trim() || /^\s*#/.test(lines[end]) || /^\s/.test(lines[end]))) end++;
  const key = lines.findIndex((line, index) => index > start && index < end && /^  thresholdPercent\s*:/.test(line));
  if (key >= 0) lines[key] = `  thresholdPercent: ${percent}`;
  else lines.splice(start + 1, 0, `  thresholdPercent: ${percent}`);
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}
function claudeEnv(percent) {
  return `CLAUDE_CODE_AUTO_COMPACT_WINDOW=360000\nCLAUDE_AUTOCOMPACT_PCT_OVERRIDE=${percent}\n`;
}
function backupAndWrite(file, text) {
  const backup = `${file}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
  copyFileSync(file, backup);
  writeFileSync(file, text, "utf8");
  return backup;
}
async function confirm(prompt) {
  const rl = createInterface({ input: stdin, output: stdout });
  try { return /^y(?:es)?$/i.test((await rl.question(`${prompt} [y/N] `)).trim()); }
  finally { rl.close(); }
}
async function installFiles(project, yes, dryRun) {
  for (const relative of targets) {
    const source = join(assets, relative);
    const destination = join(project, relative);
    if (!existsSync(source)) throw new Error(`Missing packaged asset: ${relative}`);
    if (existsSync(destination)) {
      const oldText = readFileSync(destination, "utf8");
      const newText = readFileSync(source, "utf8");
      if (oldText === newText) continue;
      stdout.write(`Existing different file: ${destination}\n--- existing ---\n${oldText}\n--- packaged ---\n${newText}\n`);
      if (!yes && !(await confirm("Replace this file?"))) continue;
    }
    if (dryRun) { stdout.write(`Would install ${destination}\n`); continue; }
    mkdirSync(dirname(destination), { recursive: true });
    if (existsSync(destination)) {
      const backup = `${destination}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
      copyFileSync(destination, backup);
      stdout.write(`Backup: ${backup}\n`);
    }
    copyFileSync(source, destination);
    stdout.write(`Installed ${destination}\n`);
  }
}
function args(argv) {
  const known = new Set(["--yes", "--dry-run", "--uninstall"]);
  const result = { yes: false, dryRun: false, uninstall: false, reconfigure: false };
  for (let index = 0; index < argv.length; index++) {
    const item = argv[index];
    if (item === "--reconfigure") {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) { result.reconfigure = next; index++; }
      else result.reconfigure = true;
    } else if (known.has(item)) result[item.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = true;
    else throw new Error(`Unknown option: ${item}`);
  }
  normalizeReconfigure(result.reconfigure);
  return result;
}
async function main(argv = process.argv.slice(2)) {
  const flags = args(argv);
  const project = process.cwd();
  if (flags.uninstall) {
    for (const relative of targets) {
      const file = join(project, relative);
      if (!existsSync(file)) continue;
      const source = join(assets, relative);
      const installed = readFileSync(file, "utf8");
      const packaged = existsSync(source) ? readFileSync(source, "utf8") : installed;
      if (installed !== packaged) {
        stdout.write(`Different file will be removed: ${file}\n--- current ---\n${installed}\n--- packaged ---\n${packaged}\n`);
        if (!flags.yes && !(await confirm("Remove this file?"))) continue;
      }
      if (!flags.dryRun) rmSync(file);
      stdout.write(`${flags.dryRun ? "Would remove" : "Removed"} ${file}\n`);
    }
    return;
  }
  const setup = await configure({ yes: flags.yes || flags.dryRun, reconfigure: flags.reconfigure, dryRun: flags.dryRun });
  const available = availableHarnesses(setup.scan);
  stdout.write(`Detected harnesses: ${available.join(", ") || "none"}\n`);
  if (flags.yes || flags.dryRun) stdout.write("Non-interactive setup accepts existing values or suggestions.\n");
  stdout.write("Category selections:\n");
  for (const category of categories) {
    const row = setup.config.categories[category];
    stdout.write(`  ${category}: ${row.harness} / ${row.model} / effort ${row.effort || "none"}\n`);
  }
  stdout.write("No plugin files are changed automatically when model IDs change.\n");
  const answers = {};
  for (const harness of new Set([setup.config.chief, ...categories.map((category) => setup.config.categories[category]?.harness).filter(Boolean)])) {
    if (answers[harness]) continue;
    answers[harness] = await writeCompaction(harness, setup.config.compact_percent, { yes: flags.yes || flags.dryRun, dryRun: flags.dryRun, home: homedir(), modelWindow: 272000 });
  }
  await installFiles(project, flags.yes, flags.dryRun);
}
async function writeCompaction(harness, percent, { yes, dryRun, home, modelWindow }) {
  const files = {
    omp: [join(home, ".omp", "agent", "config.yml"), (text) => updateYaml(text, percent)],
    codex: [join(home, ".codex", "config.toml"), (text) => updateToml(text, compactTokenLimit(modelWindow, percent))],
  };
  if (harness === "agy") { stdout.write("Warning: agy compaction threshold is fixed; compact manually near 50% context.\n"); return "warning-only"; }
  if (harness === "claude") { stdout.write(`Launcher environment:\n${claudeEnv(percent)}`); return claudeEnv(percent); }
  const entry = files[harness];
  if (!entry) throw new Error(`Unsupported harness: ${harness}`);
  const [file, transform] = entry;
  if (!existsSync(file)) { stdout.write(`Not editing missing settings file: ${file}\n`); return "missing"; }
  const original = readFileSync(file, "utf8");
  const next = transform(original);
  if (original === next) return "unchanged";
  stdout.write(`Settings diff for ${file}:\n--- before ---\n${original}\n--- after ---\n${next}`);
  if (!yes && !(await confirm("Apply this setting change?"))) return "declined";
  if (dryRun) return "dry-run";
  const backup = backupAndWrite(file, next);
  stdout.write(`Backup: ${backup}\n`);
  return "written";
}
export { args, categories, claudeEnv, compactTokenLimit, configure, defaults, installFiles, modelList, MODEL_SUGGESTIONS, parseJson, parseToml, parseYaml, scanHarnesses, updateToml, updateYaml, writeCompaction };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
