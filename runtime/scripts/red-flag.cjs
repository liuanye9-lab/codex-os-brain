#!/usr/bin/env node
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const ROOT = process.env.ACOB_HOME || process.env.CODEX_OS_BRAIN_HOME || path.join(HOME, ".acob");
const DATA_DIR = path.join(ROOT, "data");
const ACTIVE_FILE = path.join(DATA_DIR, "red-flag.json");
const ARCHIVE_FILE = path.join(DATA_DIR, "red-flag-archive.jsonl");

function parseArgs(argv) {
  const args = { command: argv[0] || "status", json: false, reason: "", by: "local-operator", verification: [] };
  for (let i = 1; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--json") args.json = true;
    else if (item === "--reason") args.reason = argv[++i] || "";
    else if (item === "--by" || item === "--approved-by") args.by = argv[++i] || args.by;
    else if (item === "--verification") args.verification.push(argv[++i] || "");
  }
  return args;
}

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function readJsonl(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function archiveCount() {
  return readJsonl(ARCHIVE_FILE).length;
}

function activeStatus() {
  const active = readJson(ACTIVE_FILE);
  return {
    id: "acob-red-flag-status",
    generated_at: new Date().toISOString(),
    active: Boolean(active),
    active_flag: active ? {
      raised_at: active.raised_at || null,
      reason: active.reason || "unknown",
      required_action: active.required_action || "verify before completion",
    } : null,
    archive_count: archiveCount(),
  };
}

function clearFlag(args) {
  const active = readJson(ACTIVE_FILE);
  if (!active) return { ...activeStatus(), cleared: false, message: "no active red flag" };
  if (!args.reason.trim()) {
    throw new Error("clearing a red flag requires --reason");
  }
  const record = {
    archived_at: new Date().toISOString(),
    previous_flag: {
      raised_at: active.raised_at || null,
      reason: active.reason || "unknown",
      required_action: active.required_action || "verify before completion",
    },
    cleared_by: args.by,
    clear_reason: args.reason,
    verification: args.verification.filter(Boolean),
    policy: "archive_metadata_only_no_raw_prompt_or_tool_input",
  };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(ARCHIVE_FILE, `${JSON.stringify(record)}\n`, "utf8");
  fs.rmSync(ACTIVE_FILE, { force: true });
  return {
    id: "acob-red-flag-clear",
    generated_at: record.archived_at,
    cleared: true,
    active: false,
    archived_record: record,
    archive_count: archiveCount(),
  };
}

function toMarkdown(result) {
  if (result.id === "acob-red-flag-clear") {
    return [
      "# ACOB Red Flag Cleared",
      "",
      `cleared: ${result.cleared}`,
      `archive_count: ${result.archive_count}`,
      `reason: ${result.archived_record.clear_reason}`,
      "",
    ].join("\n");
  }
  return [
    "# ACOB Red Flag Status",
    "",
    `active: ${result.active}`,
    `archive_count: ${result.archive_count}`,
    result.active_flag ? `reason: ${result.active_flag.reason}` : "reason: none",
    result.active_flag ? `required_action: ${result.active_flag.required_action}` : "required_action: none",
    "",
  ].join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let result;
  if (args.command === "status") result = activeStatus();
  else if (args.command === "clear" || args.command === "ack") result = clearFlag(args);
  else throw new Error(`unknown red-flag command: ${args.command}`);
  if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(toMarkdown(result));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

module.exports = { activeStatus, clearFlag };
