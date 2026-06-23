#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2] || process.cwd());
const forbiddenNames = [
  "MEMORY.md",
  "USER.md",
  "STATE.md",
  "IDENTITY.md",
  "SOUL.md",
  "auth.json",
  "credentials.json",
];
const forbiddenPathParts = [
  [".codex", "brain"].join("-"),
  ".codex/memories",
  "artifacts",
  "data/local",
  "node_modules",
  ".git",
];
const secretPatterns = [
  { id: "openai_key", re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: "github_token", re: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
  { id: "private_key", re: /-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { id: "env_assignment_secret", re: /\b(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*["']?[^"'\s]{8,}/i },
];
const personalNickname = String.fromCharCode(0x5c0f, 0x53f6);
const personalOwnerPhrase = ["L", "ay", " 的 ", "agent"].join("");
const personalAddress = String.fromCharCode(0x4e3b, 0x4eba);
const privateTextPatterns = [
  { id: "private_home_path", re: /\/Users\/lay\b|C:\\Users\\lay\b/i },
  { id: "personal_codex_brain", re: new RegExp(`\\.${["codex", "brain"].join("-")}|${personalNickname}|${personalOwnerPhrase}|${personalAddress}`) },
];

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const file = path.join(dir, name);
    const rel = path.relative(root, file);
    if (forbiddenPathParts.some((part) => rel.split(path.sep).includes(part) || rel.includes(part))) continue;
    const stat = fs.statSync(file);
    if (stat.isDirectory()) walk(file, out);
    else out.push(file);
  }
  return out;
}

function scan() {
  const risks = [];
  const files = walk(root);
  for (const file of files) {
    const rel = path.relative(root, file);
    if (forbiddenNames.includes(path.basename(file))) {
      risks.push({ file: rel, risk: "forbidden_personal_filename" });
      continue;
    }
    if (fs.statSync(file).size > 1024 * 1024) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of secretPatterns) {
      if (pattern.re.test(text)) risks.push({ file: rel, risk: pattern.id });
    }
    for (const pattern of privateTextPatterns) {
      if (pattern.re.test(text)) risks.push({ file: rel, risk: pattern.id });
    }
  }
  return { ok: risks.length === 0, root, checked_files: files.length, risks };
}

const result = scan();
if (result.ok) {
  console.log(`Privacy scan: PASS (${result.checked_files} files)`);
} else {
  console.error(`Privacy scan: FAIL (${result.risks.length} risk(s))`);
  for (const risk of result.risks.slice(0, 50)) {
    console.error(`- ${risk.file}: ${risk.risk}`);
  }
}
process.exit(result.ok ? 0 : 1);
