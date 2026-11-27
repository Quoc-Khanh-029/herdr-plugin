import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const { parse } = await import(process.env.HERDR_SMOL_TOML_MODULE ?? "smol-toml");

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) walk(path); else files.push(path);
  }
}
walk(resolve(root, "multi-agent-mode"));
const compatibilityFiles = new Set(["assets/scripts/chief.ts", "assets/scripts/chief_name.mjs", "test.mjs"]);
const content = files.filter((path) => !compatibilityFiles.has(path.slice(resolve(root, "multi-agent-mode").length + 1).replaceAll("\\", "/"))).map((path) => readFileSync(path, "utf8")).join("\n");
assert.doesNotMatch(content, /\bstaff\b|\bsr\b|sr-eng|staff_tasks/i);
assert.doesNotMatch(content, /a5145403|C:\\\\Users|\/home\/[^\s"'`]+/i);
for (const path of files.filter((file) => /\.(?:mjs|toml|md)$/.test(file))) assert.doesNotMatch(readFileSync(path, "utf8"), /\r\n/, `${path} must use LF`);
for (const path of ["worker-status/herdr-plugin.toml", "multi-agent-mode/herdr-plugin.toml"]) {
  const manifest = parse(readFileSync(resolve(root, path), "utf8"));
  assert.ok(manifest.id && manifest.name && manifest.min_herdr_version);
}
const index = readFileSync(resolve(root, "README.md"), "utf8");
for (const name of ["worker-status/README.md", "multi-agent-mode/README.md"]) assert.ok(index.includes(name), `missing README link: ${name}`);
assert.equal(index.trim().split(/\r?\n/).length, 4, "top README must remain a one-intro, two-link index");
assert.match(index, /^Herdr community plugins:\r?\n\r?\n/m);
for (const plugin of ["worker-status/README.md", "multi-agent-mode/README.md"]) {
  const readme = readFileSync(resolve(root, plugin), "utf8");
  assert.match(readme, /^##\s+Quick Start\s*$/im, `${plugin} missing Quick Start`);
  assert.match(readme, /^##\s+Upgrading\s*$/im, `${plugin} missing Upgrading`);
}
console.log("hygiene: forbidden names and paths, LF endings, valid TOML, and plugin README index passed");
