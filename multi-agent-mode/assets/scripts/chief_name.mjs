import { spawnSync } from "node:child_process";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(process.env.CHIEF_PROJECT_ROOT || join(dirname(fileURLToPath(import.meta.url)), ".."));
const slug = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
const chiefNameForWorkspace = (label, folderName) => `chief-${slug(label) || slug(folderName) || "project"}`;
const isChiefName = (name) => typeof name === "string" && (/^chief(?:-.+)?$/.test(name) || ["staff", "staff-gemini", "chief-gemini"].includes(name));
const isWorkerName = (name) => typeof name === "string" && !isChiefName(name) && /^(?:worker(?:-|$)|sr-eng)/.test(name);
const USAGE = "Usage: node chief_name.mjs [--help | --dry-run]";

function parseArgs(args) {
  if (args.length === 0) return { dryRun: false };
  if (args.length === 1 && args[0] === "--help") return { help: true };
  if (args.length === 1 && args[0] === "--dry-run") return { dryRun: true };
  console.error(USAGE);
  process.exitCode = 2;
  return null;
}

function herdr(args) {
  const windows = process.platform === "win32";
  const result = spawnSync(windows ? (process.env.ComSpec || "cmd.exe") : "herdr", windows ? ["/d", "/s", "/c", "herdr", ...args] : args, { cwd: projectRoot, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || `herdr ${args.join(" ")} failed`);
  const text = result.stdout.trim();
  if (!text) return {};
  const parsed = JSON.parse(text);
  return parsed.result ?? parsed;
}

function main(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  if (!options) return;
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (process.env.HERDR_ENV !== "1") {
    process.stdout.write("Chief name was not set (HERDR_ENV is not set).\n");
    return;
  }
  const pane = herdr(["pane", "current"]).pane;
  if (!pane?.pane_id) throw new Error("Herdr did not return the current pane id");
  const agents = herdr(["agent", "list"]).agents ?? [];
  const caller = agents.find((agent) => agent.pane_id === pane.pane_id);
  if (caller && isWorkerName(caller.name)) throw new Error(`Refusing to rename Worker pane ${pane.pane_id} (${caller.name}) as Chief`);
  const workspaces = herdr(["workspace", "list"]).workspaces ?? [];
  const workspaceLabel = workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)?.label;
  const name = chiefNameForWorkspace(workspaceLabel, basename(projectRoot));
  const tabs = herdr(["tab", "list"]).tabs ?? [];
  const tabId = pane.tab_id ?? tabs.find((tab) => tab.workspace_id === pane.workspace_id)?.tab_id;
  const tab = tabs.find((item) => item.tab_id === tabId);
  const renameAgent = caller?.name !== name;
  const renameTab = !!tabId && tab?.label !== "chief";
  if (options.dryRun) {
    process.stdout.write(`Would ${renameAgent ? `name pane ${pane.pane_id} ${name}` : `leave pane ${pane.pane_id} as ${name}`}; ${renameTab ? `label tab ${tabId} chief` : "leave tab labelled chief"}.\n`);
    return;
  }
  if (renameAgent) herdr(["agent", "rename", pane.pane_id, name]);
  if (renameTab) herdr(["tab", "rename", tabId, "chief"]);
  process.stdout.write(`Chief pane ${pane.pane_id} named ${name}; Chief tab labelled chief.\n`);
}

export { chiefNameForWorkspace, isChiefName, isWorkerName, slug };
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(`Could not set Chief name: ${error.message}`); process.exitCode = 1; }
}
