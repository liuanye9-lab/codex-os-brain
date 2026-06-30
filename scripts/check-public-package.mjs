import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const commands = [
  ["npm", ["run", "privacy:scan"]],
  ["npm", ["run", "smoke"]],
];

for (const [cmd, args] of commands) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status || 1);
}

const approvedFiles = [
  "bin/",
  "dashboard/",
  "evals/",
  "examples/",
  "os-agent/",
  "plugins/",
  "research-reviews/",
  "runtime/",
  "schemas/",
  "scripts/",
  "skills/",
  "templates/",
  "tools/",
  "v2/",
  "v3/",
  "v4/",
  "v5/",
  "v6/",
  "v7/",
  "docs/",
  "README.md",
  "LICENSE",
];

const mandatoryPackageFiles = new Set(["package.json", "README.md", "LICENSE"]);
const maxPackageFiles = 70;
const maxPackageSize = 100 * 1024;
const maxUnpackedSize = 250 * 1024;
const deniedPackagePatterns = [
  /(^|\/)(MEMORY|USER|STATE|IDENTITY|SOUL|AGENTS\.local)\.md$/i,
  /(^|\/)\.env(\.|$)|(^|\/)\.env$/i,
  /(^|\/)(auth|credentials)\.json$/i,
  /(^|\/)secrets\//i,
  /\.(pem|key|p12|pfx|sqlite|sqlite3|db|jsonl|log)$/i,
  /(^|\/)(data|artifacts|node_modules|dist|build|coverage)\//i,
  /(^|\/).+ 2\.(js|py|md|json|toml|ya?ml|sh)$/i,
  /(^|\/)README 2\.md$/i,
];

function fail(message, details = []) {
  console.error(`Public package check: FAIL - ${message}`);
  for (const detail of details) console.error(`- ${detail}`);
  process.exit(1);
}

function normalizePackageFiles(files) {
  return [...files].sort((a, b) => a.localeCompare(b));
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const actualFiles = normalizePackageFiles(pkg.files || []);
const expectedFiles = normalizePackageFiles(approvedFiles);
if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
  fail("package.json files allowlist changed without updating the public package gate", [
    `expected: ${expectedFiles.join(", ")}`,
    `actual: ${actualFiles.join(", ")}`,
  ]);
}

const pack = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  encoding: "utf8",
  shell: process.platform === "win32",
});
if (pack.status !== 0) fail("npm pack --dry-run --json failed", [pack.stderr || pack.stdout || "no output"]);

let packSummary;
try {
  [packSummary] = JSON.parse(pack.stdout);
} catch (error) {
  fail("could not parse npm pack JSON", [error.message, pack.stdout.slice(0, 1000)]);
}

const packageFiles = (packSummary.files || []).map((file) => file.path);
const allowed = (file) => mandatoryPackageFiles.has(file) || approvedFiles.some((entry) => (
  entry.endsWith("/") ? file.startsWith(entry) : file === entry
));
const unexpected = packageFiles.filter((file) => !allowed(file));
const denied = packageFiles.filter((file) => deniedPackagePatterns.some((pattern) => pattern.test(file)));

if (unexpected.length) fail("unexpected files in public package", unexpected);
if (denied.length) fail("denied runtime/private files in public package", denied);
if (packageFiles.length > maxPackageFiles) fail("public package file count is too large", [`${packageFiles.length} > ${maxPackageFiles}`]);
if ((packSummary.size || 0) > maxPackageSize) fail("public package tarball is too large", [`${packSummary.size} > ${maxPackageSize}`]);
if ((packSummary.unpackedSize || 0) > maxUnpackedSize) fail("public package unpacked size is too large", [`${packSummary.unpackedSize} > ${maxUnpackedSize}`]);

console.log(`Public package check: PASS (${packageFiles.length} files, ${packSummary.size} bytes tarball, ${packSummary.unpackedSize} bytes unpacked)`);
