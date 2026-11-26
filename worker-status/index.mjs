import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ownPath = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const options = {
    interval: 3000,
    once: false,
    agentsJson: undefined,
    ledger: process.env.WORKER_STATUS_LEDGER,
    inbox: process.env.WORKER_STATUS_INBOX,
    pointers: process.env.WORKER_STATUS_POINTERS,
    ctxDir: process.env.WORKER_STATUS_CTX_DIR,
    footerFixture: undefined,
    noColor: false,
  };
  const values = new Map([
    ["--interval", "interval"], ["--agents-json", "agentsJson"], ["--ledger", "ledger"],
    ["--inbox", "inbox"], ["--pointers", "pointers"], ["--ctx-dir", "ctxDir"],
    ["--footer-fixture", "footerFixture"],
  ]);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--once") options.once = true;
    else if (arg === "--no-color") options.noColor = true;
    else if (values.has(arg)) {
      const value = argv[++i];
      if (!value) throw new Error(`missing value for ${arg}`);
      const key = values.get(arg);
      options[key] = key === "interval" ? Number(value) * 1000 : value;
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!Number.isFinite(options.interval) || options.interval < 250) {
    throw new Error("--interval must be at least 0.25 seconds");
  }
  return options;
}

function pathFromCwd(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function parseAgents(raw) {
  const value = JSON.parse(raw);
  const agents = Array.isArray(value) ? value : value.agents ?? value.result?.agents;
  if (!Array.isArray(agents)) throw new Error("Herdr agent list did not contain an agents array");
  return agents;
}

function loadAgents(options) {
  if (options.agentsJson) return parseAgents(readFileSync(pathFromCwd(options.agentsJson), "utf8"));
  const herdr = process.env.HERDR_BIN_PATH || "herdr";
  const raw = execFileSync(herdr, ["agent", "list"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return parseAgents(raw);
}

function loadLedger(options) {
  if (!options.ledger) return { configured: false, sessions: [], warning: "" };
  try {
    const parsed = JSON.parse(readFileSync(pathFromCwd(options.ledger), "utf8"));
    if (!Array.isArray(parsed.sessions)) throw new Error("expected a sessions array");
    return { configured: true, sessions: parsed.sessions, warning: "" };
  } catch (error) {
    return { configured: true, sessions: [], warning: `Optional ledger unavailable: ${error.message}` };
  }
}

function pendingAsks(inboxPath, pointersPath) {
  if (!inboxPath) return { names: new Set(), warning: "" };
  try {
    const resolvedInbox = pathFromCwd(inboxPath);
    const files = statSync(resolvedInbox).isDirectory()
      ? readdirSync(resolvedInbox).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort().reverse().map((name) => join(resolvedInbox, name))
      : [resolvedInbox];
    const pointers = pointersPath ? JSON.parse(readFileSync(pathFromCwd(pointersPath), "utf8")) : {};
    const newest = new Map();
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      const blocks = text.split(/(?=^## #\d+ )/m).filter((block) => block.trim());
      for (let i = blocks.length - 1; i >= 0; i--) {
        const match = /^## #(\d+) [^\n]*?\b(DONE|ASK|BLOCKED)\b \S+ from ([^\s\n]+)/m.exec(blocks[i]);
        if (!match || newest.has(match[3])) continue;
        const key = `${basename(file).startsWith("202") ? `chief_tasks/inbox/${basename(file)}` : file}#${match[1]}`;
        newest.set(match[3], { key, kind: match[2] });
      }
    }
    const names = new Set();
    for (const [name, record] of newest) {
      const pointer = pointers[record.key];
      const state = typeof pointer === "string" ? pointer : pointer?.state;
      if ((record.kind === "ASK" || record.kind === "BLOCKED") && state !== "acked") names.add(name);
    }
    return { names, warning: "" };
  } catch (error) {
    return { names: new Set(), warning: `Optional inbox data unavailable: ${error.message}` };
  }
}

function latestTask(session) {
  const tasks = Array.isArray(session?.tasks) ? session.tasks : [];
  return [...tasks].reverse().find((task) => task?.status === "running") ?? tasks.at(-1);
}

function modelShort(session) {
  const raw = session?.model ?? session?.model_note ?? session?.tier ?? "?";
  const value = String(raw);
  if (/^(luna|terra|sol|haiku|sonnet|opus)$/i.test(value)) return value.toLowerCase();
  const match = /gpt-6(?:\.1)?-(luna|terra|sol)|claude-[^/]*(haiku|sonnet|opus)/i.exec(value);
  if (match) return (match[1] ?? match[2]).toLowerCase();
  return (value.split(/[/:]/).at(-1) ?? "?").slice(0, 12);
}

function contextTokens(agent, ctxDir) {
  if (!ctxDir || !agent?.agent_session?.value) return "-";
  try {
    const value = JSON.parse(readFileSync(join(pathFromCwd(ctxDir), `${agent.agent_session.value}.json`), "utf8")).used_tokens;
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? `${Math.round(value / 1000)}k` : "-";
  } catch { return "-"; }
}

function readOmpTokens(agents, options) {
  const result = new Map();
  let fixture;
  if (options.footerFixture) {
    try { fixture = JSON.parse(readFileSync(pathFromCwd(options.footerFixture), "utf8")); }
    catch { return result; }
  }
  const herdr = process.env.HERDR_BIN_PATH || "herdr";
  for (const agent of agents) {
    const paneId = agent.pane_id;
    if (!paneId) continue;
    let footer = "";
    try {
      footer = fixture
        ? fixture[paneId] ?? ""
        : execFileSync(herdr, ["pane", "read", paneId, "--lines", "4"], {
          encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 5000,
        });
    } catch { /* OMP footer context is best-effort. */ }
    const match = /(\d+(?:\.\d+)?)%\/(\d+)K\b/i.exec(footer);
    result.set(paneId, match ? `${Math.round(Number(match[1]) * Number(match[2]) / 100)}k` : "-");
  }
  return result;
}

function stateFor(agent, task, pendingAsk = false, runtime = "") {
  const status = String(agent?.agent_status ?? "").toLowerCase();
  if (pendingAsk) return "ASK";
  if (status === "blocked") return "BLOCKED";
  if (status === "working" || (runtime === "omp" && task?.status === "running")) return "RUNNING";
  if (task?.status === "DONE" && (status === "idle" || !status || !agent)) return "DONE";
  if (status === "idle") return "IDLE";
  return status ? status.toUpperCase() : "UNKNOWN";
}

function isBoardTestProcess(processes) {
  return processes.some((entry) => {
    const command = String(entry.commandLine ?? entry.CommandLine ?? "");
    return /(?:^|[\s\\/])fleet_test\.py\s+run(?:\s|$)|(?:^|[\s\\/])(?:rtt_fleet|logic2_capture)\.py(?:\s|$)/i.test(command);
  });
}

function readProcesses(options) {
  if (options.processes) return options.processes;
  if (process.platform !== "win32") return [];
  try {
    const raw = execFileSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object CommandLine | ConvertTo-Json -Compress",
    ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true, timeout: 5000 });
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : value ? [value] : [];
  } catch { return []; }
}
function buildRows(agents, sessions, options = {}) {
  const agentByName = new Map(agents.map((agent) => [agent.name ?? agent.agent ?? "", agent]));
  const footerTokens = options.footerTokens ?? new Map();
  const contextDir = options.ctxDir;
  const asks = options.pendingAsks ?? new Set();
  const testingProcess = isBoardTestProcess(options.processes ?? []);
  const liveSessions = options.ledgerConfigured ? sessions.filter((session) => session.status === "live") : [];
  const sources = options.ledgerConfigured
    ? liveSessions.map((session) => ({ name: session.name ?? "?", session }))
    : agents.map((agent) => ({ name: agent.name ?? agent.agent ?? "?", session: undefined }));
  return sources.map(({ name, session }) => {
    const agent = agentByName.get(name);
    const task = latestTask(session);
    const runtime = session?.runtime ?? "";
    const paneId = runtime === "omp" ? agent?.pane_id : undefined;
    const ledgerState = String(task?.status ?? "").toUpperCase();
    const testing = session?.status === "live" && ledgerState === "RUNNING"
      && /(?:^|[+\s])BOARD(?:$|[+\s])/i.test(String(task.mode ?? "")) && testingProcess;
    const state = ledgerState === "BLOCKED" || ledgerState === "FAILED"
      ? ledgerState
      : testing ? "TESTING" : stateFor(agent, task, asks.has(name), runtime);
    const tokens = runtime === "omp"
      ? (paneId ? footerTokens.get(paneId) ?? "-" : "-")
      : contextTokens(agent, contextDir);
    return {
      name: name.replace(/^(?:worker|sr-eng)-(\d+)$/, "w-$1"),
      model: modelShort(session),
      state,
      task: task?.id?.replace(/^\d{4}-\d{2}-\d{2}_/, "") ?? "(no task)",
      tokens,
    };
  });
}


function truncate(value, width) {
  const chars = [...String(value ?? "")];
  if (chars.length <= width) return chars.join("").padEnd(width);
  return width === 1 ? "~" : `${chars.slice(0, width - 1).join("")}~`;
}
function truncateTask(value, width) {
  const chars = [...String(value ?? "")];
  if (chars.length <= width) return chars.join("").padEnd(width);
  return width <= 3 ? ".".repeat(width) : `${chars.slice(0, width - 3).join("")}...`;
}

function contextColumn(value) {
  const text = String(value ?? "-");
  if (text === "-") return text.padStart(5);
  const amount = Number.parseInt(text, 10);
  return Number.isFinite(amount) && amount > 999 ? "999k+" : text.padStart(5);
}

function renderDashboard(rows, width = 100, now = new Date(), color = false) {
  const nameWidth = 6;
  const modelWidth = 5;
  const stateWidth = 7;
  const tokenWidth = 5;
  const taskWidth = Math.max(8, width - 28);
  const cell = (value, size) => truncate(value, size);
  const header = `WORKER STATUS ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  const lines = [truncate(header, width - 1).trimEnd(), [cell("#", nameWidth), cell("MODEL", modelWidth), cell("STATE", stateWidth), cell("TASK", taskWidth), "CTX".padStart(tokenWidth)].join(" ")];
  if (!rows.length) lines.push(truncate("No agents found", width - 1).trimEnd());
  for (const row of rows) {
    let state = cell(row.state, stateWidth);
    const colorCode = row.state === "TESTING" ? 35 : row.state === "RUNNING" ? 33 : row.state === "IDLE" ? 36 : row.state === "DONE" ? 32 : 31;
    if (color) state = `\x1b[${colorCode}m${state}\x1b[0m`;
    lines.push([cell(row.name, nameWidth), cell(row.model, modelWidth), state, truncateTask(row.task, taskWidth), contextColumn(row.tokens)].join(" "));
  }
  return lines;
}

function draw(lines, clear) {
  if (clear) process.stdout.write("\x1b[H\x1b[0J");
  process.stdout.write(`${lines.join("\n")}\n`);
}

function run(options) {
  let stopped = false;
  let lastFooterRead = 0;
  let footerPaneSignature = "";
  let footerTokens = new Map();
  const stop = () => { stopped = true; if (!options.once) process.stdout.write("\x1b[?25h\n"); };
  if (!options.once) {
    process.stdout.write("\x1b[?25l");
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  }
  const tick = () => {
    if (stopped) return;
    try {
      const agents = loadAgents(options);
      const ledger = loadLedger(options);
      const ledgerUsable = ledger.configured && !ledger.warning;
      const inbox = pendingAsks(options.inbox, options.pointers);
      const herdrByName = new Map(agents.map((agent) => [agent.name ?? agent.agent ?? "", agent]));
      const ompAgents = ledgerUsable
        ? ledger.sessions.filter((session) => session.status === "live" && session.runtime === "omp")
          .map((session) => herdrByName.get(session.name)).filter(Boolean)
        : [];
      const paneSignature = ompAgents.map((agent) => agent.pane_id).filter(Boolean).sort().join(",");
      if (paneSignature !== footerPaneSignature || Date.now() - lastFooterRead >= 15_000) {
        footerTokens = readOmpTokens(ompAgents, options);
        footerPaneSignature = paneSignature;
        lastFooterRead = Date.now();
      }
      const rows = buildRows(agents, ledger.sessions, {
        ledgerConfigured: ledgerUsable,
        pendingAsks: inbox.names,
        ctxDir: options.ctxDir,
        footerTokens,
        processes: readProcesses(options),
      });
      const lines = renderDashboard(rows, process.stdout.columns || 100, new Date(), process.stdout.isTTY && !options.noColor);
      for (const warning of [ledger.warning, inbox.warning].filter(Boolean)) lines.push(warning);
      draw(lines, !options.once);
    } catch (error) {
      draw([`Worker status unavailable: ${error.message}`], !options.once);
    }
    if (options.once) stop();
    else if (!stopped) setTimeout(tick, options.interval);
  };
  tick();
}

export { buildRows, contextTokens, loadAgents, loadLedger, modelShort, parseAgents, pendingAsks, readOmpTokens, renderDashboard, stateFor };

if (process.argv[1] && resolve(process.argv[1]) === ownPath) {
  try { run(parseArgs(process.argv.slice(2))); }
  catch (error) {
    console.error(`worker-status: ${error.message}`);
    process.exitCode = 1;
  }
}
