#!/usr/bin/env bash
# Sync the harness into its hosts from the development working copy.
#
# The daily harness deliberately does NOT run from the dev checkout. Pointing hooks at a
# working copy means every experiment there changes the thing that is supposed to be
# guarding you, and a half-finished edit silently disarms it. So the runtime is a packed
# release installed at ~/.agents/runtime/codex-brain, and this script is the only path
# from the checkout to that runtime.
#
# Usage: scripts/sync-hosts.sh [path-to-dev-checkout]

set -euo pipefail

DEV="${1:-/Users/lay/Harness/codex-os-brain}"
RUNTIME="$HOME/.agents/runtime/codex-brain"
BIN="$HOME/.local/bin/brain"
SKILL_SRC="$DEV/integrations/doubao/harness-discipline/SKILL.md"
DOUBAO_SKILLS="$HOME/Library/Application Support/DoubaoWork/Profile 2/.doubaowork/agent_mode/workspace/.user_skills"
AGENT_SKILLS="$HOME/.agents/skills"

[ -d "$DEV" ] || { echo "dev checkout not found: $DEV" >&2; exit 1; }

echo "==> Gate the source before shipping it"
cd "$DEV"
node --run test >/dev/null 2>&1 || { echo "tests failed; refusing to sync" >&2; exit 1; }
echo "    tests pass"

echo "==> Pack and install the runtime"
TGZ="$(npm pack --silent 2>/dev/null | tail -1)"
rm -rf "$RUNTIME"
mkdir -p "$RUNTIME"
tar -xzf "$TGZ" -C "$RUNTIME" --strip-components=1
rm -f "$TGZ"
( cd "$RUNTIME" && npm install --omit=dev --silent >/dev/null 2>&1 )
echo "    installed at $RUNTIME"

echo "==> Link the global command"
mkdir -p "$(dirname "$BIN")"
chmod +x "$RUNTIME/bin/brain.js"
ln -sf "$RUNTIME/bin/brain.js" "$BIN"
echo "    $BIN -> runtime"

echo "==> Point Codex hooks at the runtime, not the checkout"
node "$RUNTIME/bin/brain.js" hooks enable --project "$RUNTIME" --confirm --json >/dev/null 2>&1
echo "    hooks re-signed"

echo "==> Install the Doubao skill (advisory: Doubao has no hook mechanism)"
if [ -f "$SKILL_SRC" ]; then
  for dest in "$DOUBAO_SKILLS" "$AGENT_SKILLS"; do
    mkdir -p "$dest/harness-discipline"
    cp "$SKILL_SRC" "$dest/harness-discipline/SKILL.md"
  done
  echo "    skill installed to both skill roots"
else
  echo "    skill source missing, skipped: $SKILL_SRC" >&2
fi

echo "==> Verify the installed runtime actually intercepts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
( cd "$TMP" && git init -q . && printf '{"name":"t","version":"1.0.0","scripts":{"test":"node -e \\"process.exit(1)\\""}}' > package.json && git add -A && git commit -qm init )
BRAIN_SESSION_ID=synccheck node "$RUNTIME/bin/brain.js" task create \
  --task-id sync --objective "post-sync canary" --criterion tests --project "$TMP" --json >/dev/null 2>&1

check() {
  local label="$1" payload="$2" field="$3" want="$4"
  local got
  got="$(printf '%s' "$payload" | BRAIN_SESSION_ID=synccheck node "$RUNTIME/bin/run-brain-hook.js" 2>/dev/null \
    | grep -o '^{.*}' \
    | FIELD="$field" node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=s.trim()?JSON.parse(s):{};console.log(o[process.env.FIELD]||"allow")})')"
  if [ "$got" = "$want" ]; then
    echo "    ok   $label -> $got"
  else
    echo "    FAIL $label -> $got (expected $want)" >&2
    exit 1
  fi
}

# Stop carries `decision`; PreToolUse carries `permissionDecision`. A Stop block also sets
# permissionDecision=deny, so asserting the wrong field silently passes for the wrong reason.
check "false completion claim blocked" \
  "{\"hook_event_name\":\"Stop\",\"cwd\":\"$TMP\",\"completion_claim\":true}" decision block
check "destructive delete denied" \
  "{\"hook_event_name\":\"PreToolUse\",\"cwd\":\"$TMP\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"rm -rf $HOME/Documents\"}}" permissionDecision deny
check "ordinary command passes" \
  "{\"hook_event_name\":\"PreToolUse\",\"cwd\":\"$TMP\",\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"ls -la\"}}" permissionDecision allow

echo
VERSION="$(node "$RUNTIME/bin/brain.js" status --json 2>/dev/null | grep -o '^{.*}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const i=JSON.parse(s).identity;console.log(i.productMajor+" "+i.releaseVersion)}catch{console.log("(version unavailable)")}})')"
echo "Synced. brain $VERSION"
