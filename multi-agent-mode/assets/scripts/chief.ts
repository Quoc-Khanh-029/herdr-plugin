const { appendFileSync, mkdirSync, readFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { join, resolve } = require("node:path");
const { spawnSync } = require("node:child_process");

const root = process.cwd();
const inbox = join(root, "chief_tasks", "inbox");
function run(args) {
  const result = spawnSync("herdr", args, { cwd: root, encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || `herdr ${args.join(" ")} failed`);
  return result.stdout.trim();
}
function option(args, name) {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
}
function main(argv) {
  const [command, ...args] = argv;
  if (command === "status") {
    const raw = run(["agent", "list"]);
    process.stdout.write(`${JSON.stringify(JSON.parse(raw), null, 2)}\n`);
    return;
  }
  if (command === "prompt") {
    const [name, ...words] = args;
    if (!name || !words.length) throw new Error("Usage: node scripts/chief.ts prompt <agent-name> <message>");
    process.stdout.write(`${run(["agent", "prompt", name, words.join(" ")])}\n`);
    return;
  }
  if (command === "signal") {
    const [kind, taskId] = args;
    if (!["DONE", "ASK", "BLOCKED"].includes(kind) || !taskId) throw new Error("Usage: node scripts/chief.ts signal <DONE|ASK|BLOCKED> <task-id> --text <message> | --file <path>");
    const text = option(args, "--text") ?? (option(args, "--file") && readFileSync(resolve(option(args, "--file")), "utf8"));
    if (!text) throw new Error("A non-empty --text or --file is required");
    const date = new Date().toISOString().slice(0, 10);
    const file = join(inbox, `${date}.md`);
    mkdirSync(inbox, { recursive: true });
    appendFileSync(file, `\n## ${kind} ${taskId} from ${process.env.HERDR_AGENT_NAME || "worker"}\n\n${text.trim()}\n`, "utf8");
    const parsed = JSON.parse(run(["agent", "list"]));
    const agents = parsed.agents ?? parsed.result?.agents ?? [];
    const chief = agents.find((agent) => agent.name === "chief");
    if (chief?.name) run(["agent", "prompt", chief.name, `${kind} ${taskId}: see ${file}`]);
    process.stdout.write(`${file}\n`);
    return;
  }
  if (command === "config") {
    const file = join(homedir(), ".config", "herdr", "multi-agent.config.json");
    process.stdout.write(`${file}\n`);
    return;
  }
  throw new Error("Usage: node scripts/chief.ts <status|prompt|signal|config> ...");
}
try { main(process.argv.slice(2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
