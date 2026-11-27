const fs = require("node:fs");
const { dirname } = require("node:path");

const file = process.env.FAKE_HERDR_STATE;
if (!file) throw new Error("FAKE_HERDR_STATE is required");
let state = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {
  pane: { pane_id: "pane-1", workspace_id: "workspace-1", tab_id: "tab-1" },
  agents: [{ name: process.env.FAKE_AGENT_NAME || "claude", pane_id: "pane-1" }],
  workspaces: [{ workspace_id: "workspace-1", label: process.env.FAKE_WORKSPACE_LABEL || "Example Project" }],
  tabs: [{ tab_id: "tab-1", workspace_id: "workspace-1", label: process.env.FAKE_TAB_LABEL || "staff" }],
  calls: [],
};
const [group, command, target, value] = process.argv.slice(2);
state.calls.push(process.argv.slice(2));
let result = {};
if (group === "pane" && command === "current") result = { pane: state.pane };
else if (group === "agent" && command === "list") result = { agents: state.agents };
else if (group === "workspace" && command === "list") result = { workspaces: state.workspaces };
else if (group === "tab" && command === "list") result = { tabs: state.tabs };
else if (group === "agent" && command === "rename") {
  const agent = state.agents.find((item) => item.pane_id === target);
  if (agent) agent.name = value;
}
else if (group === "tab" && command === "rename") {
  const tab = state.tabs.find((item) => item.tab_id === target);
  if (tab) tab.label = value;
}
fs.mkdirSync(dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(state, null, 2));
process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
