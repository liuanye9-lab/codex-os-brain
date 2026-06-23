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

function status() {
  const globalStatus = readJson(path.join(DATA_DIR, "global-hook-status.json"), null);
  const heartbeat = readJson(path.join(DATA_DIR, "heartbeat.json"), null);
  const redFlag = readJson(path.join(DATA_DIR, "red-flag.json"), null);
  return {
    generated_at: new Date().toISOString(),
    runtime_home: ROOT,
    runtime_installed: fs.existsSync(RUNTIME_DIR),
    global_entry: globalStatus || {
      status: "unknown",
      global_coverage: false,
      hint: "Run codex-os-brain status --json or codex-os-brain install.",
    },
    metrics: {
      prompt_events: countJsonl(path.join(DATA_DIR, "prompt-events.jsonl")),
      engineering_audits: countJsonl(path.join(DATA_DIR, "engineering-audit.jsonl")),
      red_flag: Boolean(redFlag),
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
    "access-control-allow-origin": "*",
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
