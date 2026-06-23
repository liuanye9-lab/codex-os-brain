#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const ROOT = process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".codex-os-brain");
const DATA_DIR = path.join(ROOT, "data");
const HEARTBEAT = path.join(DATA_DIR, "heartbeat.json");

function countJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(HEARTBEAT, `${JSON.stringify({
    updated_at: new Date().toISOString(),
    prompt_events: countJsonl(path.join(DATA_DIR, "prompt-events.jsonl")),
    engineering_audits: countJsonl(path.join(DATA_DIR, "engineering-audit.jsonl")),
    red_flag: fs.existsSync(path.join(DATA_DIR, "red-flag.json")),
  }, null, 2)}\n`, "utf8");
} catch {
  process.exit(0);
}
