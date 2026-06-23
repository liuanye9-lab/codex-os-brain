import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "codex-os-brain-smoke-"));
const codexHome = path.join(temp, ".codex");
const brainHome = path.join(temp, ".codex-os-brain");

function run(args, options = {}) {
  const result = spawnSync(process.execPath, [path.join(root, "bin", "codex-os-brain.mjs"), ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      CODEX_HOME: codexHome,
      CODEX_OS_BRAIN_HOME: brainHome,
    },
    timeout: 15000,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${args.join(" ")} failed\nstatus: ${result.status}\nerror: ${result.error?.message || ""}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
  }
  return result;
}

try {
  run(["install"]);
  const status = run(["status", "--summary"]);
  if (!status.stdout.includes("status: global_active")) {
    throw new Error(`status did not become global_active:\n${status.stdout}`);
  }
  const hooks = JSON.parse(fs.readFileSync(path.join(codexHome, "hooks.json"), "utf8"));
  const promptGroups = hooks.hooks.UserPromptSubmit || [];
  if (!promptGroups.some((group) => group.matcher === "")) {
    throw new Error("missing global UserPromptSubmit matcher");
  }
  run(["uninstall"]);
  console.log("Smoke test: PASS");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
