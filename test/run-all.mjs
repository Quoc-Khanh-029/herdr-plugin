import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const tomlVersion = "1.5.2";
function run(label, args, options = {}) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", windowsHide: true, ...options });
  process.stdout.write(`== ${label} ==\n${result.stdout}${result.stderr}`);
  if (result.error || result.status !== 0) throw new Error(`${label} failed with ${result.status}`);
}
for (const file of ["worker-status/test.mjs", "multi-agent-mode/test.mjs"]) run(file, ["--test", file]);
run("clean-home portability", ["test/portability.mjs"]);

const dependencyRoot = mkdtempSync(join(tmpdir(), "herdr-plugin-test-deps-"));
try {
  const isWindows = process.platform === "win32";
  const npm = isWindows ? (process.env.ComSpec || "cmd.exe") : "npm";
  const npmArgs = isWindows ? ["/d", "/c", "npm.cmd", "install", "--prefix", dependencyRoot, "--no-save", "--no-package-lock", "--ignore-scripts", `smol-toml@${tomlVersion}`] : ["install", "--prefix", dependencyRoot, "--no-save", "--no-package-lock", "--ignore-scripts", `smol-toml@${tomlVersion}`];
  const install = spawnSync(npm, npmArgs, { cwd: root, encoding: "utf8", windowsHide: true });
  process.stdout.write(`== hygiene dependency (smol-toml@${tomlVersion}) ==\n${install.stdout}${install.stderr}`);
  if (install.error || install.status !== 0) throw new Error(`hygiene dependency installation failed with ${install.status}`);
  const requireFromTemp = createRequire(join(dependencyRoot, "resolver.cjs"));
  const tomlModule = pathToFileURL(requireFromTemp.resolve("smol-toml")).href;
  run("hygiene", ["test/hygiene.mjs"], { env: { ...process.env, HERDR_SMOL_TOML_MODULE: tomlModule } });
} finally {
  rmSync(dependencyRoot, { recursive: true, force: true });
}
