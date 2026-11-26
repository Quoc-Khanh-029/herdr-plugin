import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const settingsPath = join(homedir(), ".claude", "settings.json");
const launcherPath = join(homedir(), ".claude", "worker-status", "launch.mjs");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", windowsHide: true, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `${command} ${args.join(" ")} failed`);
  return result.stdout;
}

export function mergeHook(settings, launcher) {
  const entry = { matcher: "^(startup|resume)$", hooks: [{ type: "command", command: `node \"${launcher}\"`, timeout: 3 }] };
  const list = settings.hooks?.SessionStart ?? [];
  const found = list.some((item) => item.matcher === entry.matcher && item.hooks?.some((hook) => hook.command === entry.hooks[0].command));
  return found ? settings : { ...settings, hooks: { ...settings.hooks, SessionStart: [...list, entry] } };
}

export function removeHook(settings, launcher) {
  const command = `node \"${launcher}\"`;
  const list = settings.hooks?.SessionStart ?? [];
  const next = list.map((item) => ({ ...item, hooks: item.hooks?.filter((hook) => hook.command !== command) ?? [] })).filter((item) => item.hooks.length > 0);
  return { ...settings, hooks: { ...settings.hooks, SessionStart: next } };
}

export function parseSettings(text) {
  try { return JSON.parse(text); }
  catch (error) { throw new Error(`Refusing to edit invalid settings JSON: ${error.message}`); }
}

function hookSettings(remove, yes) {
  const settings = parseSettings(readFileSync(settingsPath, "utf8"));
  const next = remove ? removeHook(settings, launcherPath) : mergeHook(settings, launcherPath);
  const same = JSON.stringify(settings) === JSON.stringify(next);
  if (!same) {
    console.log(`${remove ? "Remove" : "Add"} SessionStart hook in ${settingsPath}:`);
    console.log(JSON.stringify({ before: settings.hooks?.SessionStart ?? [], after: next.hooks?.SessionStart ?? [] }, null, 2));
    if (!yes) throw new Error("Review the diff above; rerun with --yes to apply.");
    const backup = `${settingsPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    copyFileSync(settingsPath, backup);
    writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`Backup: ${backup}`);
  } else console.log(remove ? "Chief-start hook is already absent." : "Chief-start hook is already installed.");
  if (!remove) {
    mkdirSync(dirname(launcherPath), { recursive: true });
    copyFileSync(join(root, "launch.mjs"), launcherPath);
    console.log(`Launcher installed: ${launcherPath}`);
  }
}

function setup(argv) {
  if (argv.includes("--hook") || argv.includes("--unhook")) return hookSettings(argv.includes("--unhook"), argv.includes("--yes"));
  run("herdr", ["plugin", "enable", "community.worker-status"]);
  const output = run(process.execPath, [join(root, "launch.mjs"), argv.includes("--toggle") ? "--toggle" : "--open-current"], { cwd: process.cwd(), env: { ...process.env } });
  if (output) process.stdout.write(output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { setup(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
