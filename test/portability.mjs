import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const plugin = join(root, "multi-agent-mode");
const fixture = mkdtempSync(join(tmpdir(), "herdr-portability-"));
const home = join(fixture, "home");
const project = join(fixture, "project");
const bin = join(fixture, "bin");
mkdirSync(home); mkdirSync(project); mkdirSync(bin);
const win = process.platform === "win32";
const fakeRoot = join(root, "test", "fixtures", "fake-herdr");
const fake = join(fakeRoot, win ? "herdr.cmd" : "herdr");
if (!win) chmodSync(fake, 0o755);
const fakeNames = win ? ["claude.cmd", "omp.cmd"] : ["claude", "omp"];
for (const name of fakeNames) {
  const file = join(bin, name);
  writeFileSync(file, win ? "@echo off\r\necho fake\r\n" : "#!/bin/sh\necho fake\n");
  if (!win) chmodSync(file, 0o755);
}
const copiedHerdr = join(bin, win ? "herdr.cmd" : "herdr");
writeFileSync(copiedHerdr, readFileSync(fake, "utf8"));
if (!win) chmodSync(copiedHerdr, 0o755);
const env = { ...process.env, HOME: home, USERPROFILE: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
function run(args) {
  const result = spawnSync(process.execPath, [join(plugin, "setup.mjs"), ...args], { cwd: project, env, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`${args.join(" ")} failed: ${result.stderr || result.error?.message}`);
  return result.stdout;
}
try {
  const dry = run(["--dry-run"]);
  assert.match(dry, /Would install/);
  assert.equal(readdirSync(project).length, 0);
  assert.equal(existsSync(join(home, ".config", "herdr", "multi-agent.config.json")), false);
  run(["--yes"]);
  assert.equal(existsSync(join(home, ".config", "herdr", "multi-agent.config.json")), true);
  const expected = [".claude/skills/chief/SKILL.md", "scripts/chief.ts", "scripts/chief_launch.ps1", "scripts/chief_launch.sh", "worker-status-reference.md"];
  for (const relative of expected) assert.equal(existsSync(join(project, relative)), true, relative);
  run(["--uninstall"]);
  for (const relative of expected) assert.equal(existsSync(join(project, relative)), false, relative);
  console.log("portability: dry-run, clean-home install, expected files, and uninstall passed");
} finally { rmSync(fixture, { recursive: true, force: true }); }
