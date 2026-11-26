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
const defaults = { chief: "claude", workers: "omp", compact_percent: 50, model_fallback: { agy: "hydrogen", luna: "openai-codex/gpt-6-luna", terra: "openai-codex/gpt-6.1-terra", sol: "openai-codex/gpt-6.1-sol" } };
function requireAgyModelApproval(isDefault, approved) {
  if (!isDefault && !approved) throw new Error("A newer agy model requires explicit user approval");
}
function validateAgyModel(model, approved = false) {
  const value = typeof model === "string" ? model.trim() : "";
  if (!value) throw new Error("agy model must be a non-empty string");
  const olderGemini = /^gemini-(\d+)(?:\.\d+)?(?:-|$)/i.exec(value);
  if (olderGemini && Number(olderGemini[1]) < 4) throw new Error(`Refusing older agy model "${value}"; use hydrogen (Gemini 4)`);
  requireAgyModelApproval(value === "hydrogen", approved);
  return value;
}
function validateOmpModel(model, tier) {
  const value = typeof model === "string" ? model.trim() : "";
  if (!value) throw new Error(`omp ${tier} model must be a non-empty string`);
  if (/google-antigravity|gemini/i.test(value)) throw new Error(`Refusing omp model "${value}" for ${tier}: omp Workers use the OpenAI Codex ladder only; Gemini models are reachable only through agy.`);
  if (!value.startsWith("openai-codex/")) throw new Error(`Refusing omp model "${value}" for ${tier}: omp Workers use the OpenAI Codex ladder only.`);
  return value;
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
async function choose(label, options, fallback, ask) {
  const usable = options.filter((option) => option.available);
  if (!usable.length) throw new Error(`No available harness for ${label}`);
  if (!ask) return usable.find((item) => item.value === fallback)?.value ?? usable[0].value;
  stdout.write(`${label}:\n`);
  usable.forEach((item, index) => stdout.write(`  ${index + 1}. ${item.title}\n`));
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = Number((await rl.question(`Choose [${usable.findIndex((item) => item.value === fallback) + 1 || 1}]: `)).trim());
    return usable[(answer || usable.findIndex((item) => item.value === fallback) + 1) - 1]?.value ?? usable[0].value;
  } finally { rl.close(); }
}
async function configure({ yes, reconfigure, dryRun = false, scan = scanHarnesses(), home = homedir(), approveNewerAgy = false, confirmAgyModel = confirm }) {
  const path = join(home, ".config", "herdr", "multi-agent.config.json");
  const current = existsSync(path) ? parseJson(readFileSync(path, "utf8"), "configuration JSON") : {};
  const ask = !yes && (reconfigure || !existsSync(path));
  const choices = harnesses.map((value) => ({ value, title: value, available: Boolean(scan[value]) }));
  const chief = await choose("Chief harness", choices, current.chief ?? defaults.chief, ask);
  const workers = await choose("Worker harness", choices, current.workers ?? defaults.workers, ask);
  const model_fallback = { ...defaults.model_fallback, ...(current.model_fallback ?? {}) };
  const candidateAgyModel = validateAgyModel(model_fallback.agy, true);
  const approvedAgyModel = candidateAgyModel === "hydrogen" || approveNewerAgy || await confirmAgyModel(`Use newer agy model "${candidateAgyModel}"?`);
  const agyModel = validateAgyModel(candidateAgyModel, approvedAgyModel);
  if (workers === "omp") for (const tier of ["luna", "terra", "sol"]) model_fallback[tier] = validateOmpModel(model_fallback[tier], tier);
  const config = { ...defaults, ...current, chief, workers, compact_percent: current.compact_percent ?? defaults.compact_percent, model_fallback: { ...model_fallback, agy: agyModel } };
  if (!dryRun) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  return { path, config, scan };
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
  const known = new Set(["--yes", "--dry-run", "--uninstall", "--reconfigure"]);
  const unknown = argv.find((item) => !known.has(item));
  if (unknown) throw new Error(`Unknown option: ${unknown}`);
  return Object.fromEntries([...known].map((key) => [key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), argv.includes(key)]));
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
  const setup = await configure({ yes: flags.yes || flags.dryRun, reconfigure: flags.reconfigure, dryRun: flags.dryRun, approveNewerAgy: flags.yes });
  const available = harnesses.filter((name) => setup.scan[name]);
  const modelResult = setup.scan.omp
    ? (process.platform === "win32" ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "omp models"], { encoding: "utf8", windowsHide: true }) : spawnSync("omp", ["models"], { encoding: "utf8", windowsHide: true }))
    : { status: 1, stdout: "" };
  const modelIds = modelResult.status === 0 ? modelResult.stdout : "";
  for (const tier of ["luna", "terra", "sol"]) {
    const id = setup.config.model_fallback[tier];
    if (!modelIds.includes(id)) stdout.write(`Warning: newest ${tier} model could not be resolved; using configured fallback ${id}.\n`);
  }
  stdout.write(`Detected harnesses: ${available.join(", ") || "none"}\n`);
  stdout.write("Worker model ladder: luna -> terra -> sol. terra requires a written reason in the task header; sol requires explicit user request.\n");
  stdout.write("No plugin files are changed automatically when model IDs change.\n");
  if (setup.scan.agy) stdout.write(`agy interactive model: ${setup.config.model_fallback.agy}; select it with --model when starting the interactive session. Verify the result with a read-only worker on another harness.\n`);
  const answers = {};
  for (const harness of [setup.config.chief, setup.config.workers]) {
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
export { args, claudeEnv, compactTokenLimit, configure, defaults, installFiles, parseJson, parseToml, parseYaml, requireAgyModelApproval, scanHarnesses, updateToml, updateYaml, validateAgyModel, validateOmpModel, writeCompaction };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
