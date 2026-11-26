import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const home = join(homedir(), ".claude", "worker-status");
const ownPath = fileURLToPath(import.meta.url);
const DEFAULT_TAB_WIDTH_FRACTION = 0.33;
const DEFAULT_TERMINAL_WIDTH_FRACTION = 0.2;
const DEFAULT_SIDEBAR_COLUMNS = 26;
const MIN_PANE_COLUMNS = 60;

function configuredSidebarColumns() {
  const configRoot = process.env.APPDATA || (process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support")
    : process.env.XDG_CONFIG_HOME || join(homedir(), ".config"));
  try {
    const config = readFileSync(join(configRoot, "herdr", "config.toml"), "utf8");
    const match = config.match(/^\s*sidebar_width\s*=\s*(\d+)\s*(?:#.*)?$/m);
    if (match) return Number(match[1]);
  } catch {}
  return DEFAULT_SIDEBAR_COLUMNS;
}

function terminalWidthFraction() {
  const value = process.env.WORKER_STATUS_WIDTH_FRACTION;
  if (value === undefined) return DEFAULT_TERMINAL_WIDTH_FRACTION;
  const fraction = Number(value);
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) {
    throw new Error("WORKER_STATUS_WIDTH_FRACTION must be greater than 0 and less than 1.");
  }
  return fraction;
}

export function desiredPaneColumns(tabWidth, terminalWidth, terminalFraction = DEFAULT_TERMINAL_WIDTH_FRACTION) {
  if (![tabWidth, terminalWidth, terminalFraction].every(Number.isFinite)
    || tabWidth <= 0 || terminalWidth <= 0 || terminalFraction <= 0 || terminalFraction >= 1) {
    throw new RangeError("Pane sizing requires positive widths and a fraction between 0 and 1.");
  }
  return Math.min(tabWidth, Math.max(
    MIN_PANE_COLUMNS,
    Math.ceil(tabWidth * DEFAULT_TAB_WIDTH_FRACTION),
    Math.ceil(terminalWidth * terminalFraction),
  ));
}

function resizeStatusPane(paneId) {
  const layout = herdr(["pane", "layout", "--pane", paneId])?.layout;
  const pane = layout?.panes?.find((item) => item.pane_id === paneId);
  const tabWidth = layout?.area?.width;
  if (!pane || !Number.isFinite(tabWidth) || tabWidth <= 0) {
    throw new Error(`Could not read Worker Status layout for ${paneId}.`);
  }
  const terminalWidth = tabWidth + configuredSidebarColumns();
  const targetWidth = desiredPaneColumns(tabWidth, terminalWidth, terminalWidthFraction());
  const delta = (targetWidth - pane.rect.width) / tabWidth;
  if (delta !== 0) {
    const resized = herdr([
      "pane", "resize", "--pane", paneId,
      "--direction", delta > 0 ? "left" : "right",
      "--amount", String(Math.abs(delta)),
    ]);
    if (!resized) throw new Error(`Could not resize Worker Status pane ${paneId}.`);
  }
  const updated = herdr(["pane", "layout", "--pane", paneId])?.layout;
  const actual = updated?.panes?.find((item) => item.pane_id === paneId)?.rect?.width;
  if (!Number.isFinite(actual) || Math.abs(actual - targetWidth) > 1) {
    throw new Error(`Worker Status width is ${actual ?? "unavailable"} columns; expected ${targetWidth}.`);
  }
  return { paneWidth: actual, tabWidth: updated.area.width };
}

function reportSize(action, paneId, size) {
  const percent = Math.round((100 * size.paneWidth) / size.tabWidth);
  console.log(`Worker Status ${action}: ${paneId} (${size.paneWidth}/${size.tabWidth} tab columns, ${percent}% of tab)`);
}

function open(cwd, chiefPane) {
  const panes = herdr(["pane", "list", "--workspace", process.env.HERDR_WORKSPACE_ID || chiefPane.split(":")[0]])?.panes;
  const current = herdr(["pane", "get", chiefPane])?.pane;
  if (!Array.isArray(panes) || !current) return;
  const existing = panes.find((pane) => pane.tab_id === current.tab_id && isStatusPane(pane));
  if (existing) {
    reportSize("already open", existing.pane_id, resizeStatusPane(existing.pane_id));
    return;
  }
  const root = resolve(current.cwd || cwd);
  const pluginRoot = existsSync(join(dirname(ownPath), "index.mjs")) ? dirname(ownPath) : join(home, "plugin");
  const args = ["plugin", "pane", "open", "--plugin", "community.worker-status", "--entrypoint", "status", "--placement", "split", "--direction", "right", "--target-pane", chiefPane, "--cwd", pluginRoot, "--no-focus"];
  const tasks = join(root, "chief_tasks");
  if (existsSync(join(tasks, "sessions.json"))) {
    args.push("--env", `WORKER_STATUS_LEDGER=${join(tasks, "sessions.json")}`);
    args.push("--env", `WORKER_STATUS_INBOX=${join(tasks, "inbox")}`);
    args.push("--env", `WORKER_STATUS_POINTERS=${join(tasks, "inbox", "pointers.json")}`);
    args.push("--env", `WORKER_STATUS_CTX_DIR=${join(homedir(), ".claude", "ctx")}`);
  }
  const result = spawnSync(process.env.HERDR_BIN_PATH || "herdr", args, { cwd: root, encoding: "utf8", timeout: 2500, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || "Could not open Worker Status.");
  const after = herdr(["pane", "list", "--workspace", process.env.HERDR_WORKSPACE_ID || chiefPane.split(":")[0]])?.panes;
  const pane = Array.isArray(after) && after.find((item) => item.tab_id === current.tab_id && isStatusPane(item));
  if (!pane?.pane_id) throw new Error("Worker Status pane did not appear after opening.");
  reportSize("opened", pane.pane_id, resizeStatusPane(pane.pane_id));
}

function herdr(args) {
  const result = spawnSync(process.env.HERDR_BIN_PATH || "herdr", args, { encoding: "utf8", timeout: 1800, windowsHide: true });
  if (result.error || result.status !== 0) return null;
  try { return JSON.parse(result.stdout).result; } catch { return null; }
}

function paneContext() {
  const current = process.env.HERDR_PANE_ID ? herdr(["pane", "get", process.env.HERDR_PANE_ID])?.pane : herdr(["pane", "current", "--current"])?.pane;
  if (!current) return null;
  return { pane: current, tabId: process.env.HERDR_TAB_ID || current.tab_id, workspace: process.env.HERDR_WORKSPACE_ID || current.workspace_id };
}

function isStatusPane(pane) {
  return pane.label?.toLowerCase().replaceAll(" ", "-") === "worker-status";
}



export function toggle() {
  const context = paneContext();
  if (!context) throw new Error("Run this action from a Herdr pane.");
  const panes = herdr(["pane", "list", "--workspace", context.workspace])?.panes;
  if (!Array.isArray(panes)) throw new Error("Could not list Herdr panes.");
  const existing = panes.find((pane) => pane.tab_id === context.tabId && isStatusPane(pane));

  if (existing) {
    const result = spawnSync(process.env.HERDR_BIN_PATH || "herdr", ["pane", "close", existing.pane_id], { encoding: "utf8", timeout: 2500, windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || "Could not close Worker Status.");
    console.log(`Worker Status closed: ${existing.pane_id}`);
  } else open(context.pane.cwd || process.cwd(), context.pane.pane_id);
}

function chiefTranscript(path) {
  if (!path || !existsSync(path)) return false;
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (line.startsWith('{"type":"agent-setting"')) return JSON.parse(line).agentSetting === "chief";
    }
  } catch {}
  return false;
}

if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  if (process.argv[2] === "--toggle") {
    try { toggle(); } catch (error) { console.error(error.message); process.exitCode = 1; }
  } else if (process.argv[2] === "--open-current") {
    const context = paneContext();
    if (!context) {
      console.error("Run setup from a Herdr pane.");
      process.exitCode = 1;
    } else open(context.pane.cwd || process.cwd(), context.pane.pane_id);
  } else if (process.argv[2] === "--open") {
    if (process.env.WORKER_STATUS_CHIEF_START !== "1" || process.env.HERDR_ENV !== "1" || process.env.HERDR_PANE_ID !== process.argv[4]) process.exit(0);
    open(process.argv[3], process.argv[4]);
  } else {
    try {
      const input = JSON.parse(readFileSync(0, "utf8"));
      const chief = input.agent_type === "chief" || (input.agent_type === undefined && input.source === "resume" && chiefTranscript(input.transcript_path));
      if (!chief || process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) process.exit(0);
      const cwd = input.cwd || process.cwd();
      const pane = process.env.HERDR_PANE_ID;
      const child = spawn(process.execPath, [ownPath, "--open", cwd, pane], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, WORKER_STATUS_CHIEF_START: "1" } });
      child.unref();
    } catch {}
  }
}
