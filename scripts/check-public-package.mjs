import { spawnSync } from "node:child_process";

const commands = [
  ["npm", ["run", "privacy:scan"]],
  ["npm", ["run", "smoke"]],
];

for (const [cmd, args] of commands) {
  const result = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status || 1);
}
