import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = os.homedir();
const ROOT = process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".codex-os-brain");
const DATA_DIR = path.join(ROOT, "data");
const RUNTIME_DIR = path.join(ROOT, "runtime");
const AGENT_LIBRARY = path.join(RUNTIME_DIR, "agents", "library.json");
const PORT = Number(process.env.CODEX_OS_BRAIN_PORT || 8791);

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function countJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function latestJsonl(file) {
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      try { return JSON.parse(lines[i]); } catch {}
    }
  } catch {}
  return null;
}

function publicGlobalEntry(entry) {
  if (!entry) {
    return {
      status: "unknown",
      global_coverage: false,
      hint: "Run codex-os-brain status --json or codex-os-brain install.",
    };
  }
  return {
    generated_at: entry.generated_at,
    status: entry.status,
    global_coverage: Boolean(entry.global_coverage),
    scope: entry.scope,
    hooks: {
      user_prompt_submit_count: entry.hooks?.user_prompt_submit_count || 0,
      global_user_prompt_submit_count: entry.hooks?.global_user_prompt_submit_count || 0,
      post_tool_use_count: entry.hooks?.post_tool_use_count || 0,
      stop_count: entry.hooks?.stop_count || 0,
    },
    required: entry.required || [],
    injection_smoke: entry.injection_smoke || null,
    privacy_boundary: entry.privacy_boundary,
  };
}

function status() {
  const globalStatus = readJson(path.join(DATA_DIR, "global-hook-status.json"), null);
  const heartbeat = readJson(path.join(DATA_DIR, "heartbeat.json"), null);
  const redFlag = readJson(path.join(DATA_DIR, "red-flag.json"), null);
  const agentLibrary = readJson(AGENT_LIBRARY, { version: "missing", agents: [] });
  const latestDispatch = latestJsonl(path.join(DATA_DIR, "agentic-dispatch.jsonl"));
  return {
    generated_at: new Date().toISOString(),
    runtime_installed: fs.existsSync(RUNTIME_DIR),
    runtime_home: "local",
    global_entry: publicGlobalEntry(globalStatus),
    metrics: {
      prompt_events: countJsonl(path.join(DATA_DIR, "prompt-events.jsonl")),
      engineering_audits: countJsonl(path.join(DATA_DIR, "engineering-audit.jsonl")),
      agentic_dispatches: countJsonl(path.join(DATA_DIR, "agentic-dispatch.jsonl")),
      red_flag: Boolean(redFlag),
    },
    agentic: {
      library_version: agentLibrary.version || "missing",
      agents: (agentLibrary.agents || []).map((agent) => ({
        id: agent.id,
        name: agent.name,
        displayName: agent.displayName,
        description: agent.description,
        type: agent.type,
        tool_policy: agent.tool_policy,
        sideEffects: agent.sideEffects,
        recursionPolicy: agent.recursionPolicy,
      })),
      latest_dispatch: latestDispatch,
      policy: agentLibrary.policy || {},
    },
    latest: {
      heartbeat,
      audit: latestJsonl(path.join(DATA_DIR, "engineering-audit.jsonl")),
      red_flag: redFlag,
    },
    privacy: {
      packaged_private_memory: false,
      packaged_user_profile: false,
      packaged_api_keys: false,
    },
  };
}

function send(res, statusCode, body, type = "application/json") {
  res.writeHead(statusCode, {
    "content-type": type,
    "cache-control": "no-store",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api/status") {
    send(res, 200, `${JSON.stringify(status(), null, 2)}\n`);
    return;
  }
  if (url.pathname === "/" || url.pathname === "/index.html") {
    send(res, 200, fs.readFileSync(path.join(__dirname, "index.html"), "utf8"), "text/html; charset=utf-8");
    return;
  }
  send(res, 404, JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Codex OS Brain dashboard: http://127.0.0.1:${PORT}/`);
});
