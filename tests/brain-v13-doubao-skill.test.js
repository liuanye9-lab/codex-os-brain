'use strict';
// The Doubao skill is self-discipline, not enforcement -- that platform has no hooks. Its
// one hard requirement is therefore honesty: every command it tells the agent to run must
// exist, and it must not claim powers the platform does not have.
//
// A skill citing a removed command is worse than no skill: the agent runs it, gets an
// error, and quietly falls back to the verbal conclusion this whole thing exists to stop.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { commandGuide } = require('../scripts/v9/cli');

const skillPath = path.resolve(__dirname, '..', 'integrations', 'doubao', 'harness-discipline', 'SKILL.md');
const skill = fs.readFileSync(skillPath, 'utf8');

test('every brain command the skill cites still exists', () => {
  const groups = new Set(Object.keys(commandGuide().commands));
  const cited = [...skill.matchAll(/\bbrain\s+([a-z-]+)/g)].map(match => match[1]);
  assert.ok(cited.length > 0, 'skill should cite commands');
  const missing = [...new Set(cited)].filter(name => !groups.has(name));
  assert.deepEqual(missing, [], `skill cites commands that no longer exist: ${missing.join(', ')}`);
});

test('the skill documents the episodic loop', () => {
  // V13 added failure recording and replay. A skill that predates it leaves the Doubao
  // side unaware that this history exists and can be queried.
  assert.match(skill, /brain failures/);
  assert.match(skill, /PostToolUse/);
  assert.match(skill, /UserPromptSubmit/);
});

test('the skill states the Doubao side cannot enforce', () => {
  assert.match(skill, /没有 hook 机制/);
  assert.match(skill, /自觉级/);
});

test('the skill does not claim interception on the Doubao side', () => {
  assert.match(skill, /不要在豆包侧宣称"已强制拦截"/);
});

test('the skill teaches adopt as the way in', () => {
  // `brain task create` requires inventing a task id, an objective and a criterion before
  // any work starts. That friction is what left every real directory unguarded.
  assert.match(skill, /brain adopt/);
});
