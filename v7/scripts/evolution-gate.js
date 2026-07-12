#!/usr/bin/env node
/**
 * V7 evolution gate — a path-neutral archival copy.
 *
 * Turns self-evolution proposals into reviewable candidate records. It does
 * not change persona, memory, hooks, or runtime by itself.
 */

const fs = require('node:fs');
const crypto = require('node:crypto');

const CORE_FILE_RE = /(?:^|\/)(IDENTITY|SOUL|MEMORY|AGENTS|CORE|STATE)\.md$/;
const CODE_FILE_RE = /\.(js|mjs|cjs|ts|tsx|py|sh|json|toml|ya?ml|html|css)$/i;
const MEMORY_WORD_RE = /memory|hot|warm|cold|memskill|recall|retrieval|reflection|retain/i;
const SELF_MOD_WORD_RE = /self[- ]?evol|self[- ]?modify|dgm|darwin|automatic modification/i;
const LONG_EVAL_WORD_RE = /swe[- ]?evo|long[- ]?horizon|fix rate|multi-file|release|regression/i;
const DUAL_BRAIN_WORD_RE = /dual[- ]?brain|left brain|right brain|challenger|verification/i;
const HARNESS_WORD_RE = /harness|code as agent|executable|audit|reproduce/i;

function stableId(input) {
  return crypto.createHash('sha1').update(JSON.stringify(input)).digest('hex').slice(0, 12);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function scoreDimension(condition, label, evidence = '') {
  return { label, ok: Boolean(condition), evidence };
}

function analyzeProposal(input = {}) {
  const title = String(input.title || input.name || 'untitled proposal');
  const summary = String(input.summary || input.description || '');
  const text = title + '\n' + summary;
  const changedFiles = asArray(input.changedFiles || input.files || input.paths).map(String);
  const tests = asArray(input.tests || input.verification).map(String).filter(Boolean);
  const metrics = input.metrics && typeof input.metrics === 'object' ? input.metrics : {};
  const approvals = asArray(input.approvals).map(String);
  const memoryWrites = asArray(input.memoryWrites || input.memory_writes).map(String);
  const autoApply = Boolean(input.autoApply || input.auto_apply);
  const sandbox = Boolean(input.sandbox || input.sandboxed);

  const touchesCore = changedFiles.concat(memoryWrites).some((file) => CORE_FILE_RE.test(file));
  const touchesCode = changedFiles.some((file) => CODE_FILE_RE.test(file));
  const isMemoryProposal = MEMORY_WORD_RE.test(text) || memoryWrites.length > 0;
  const isSelfEvolution = SELF_MOD_WORD_RE.test(text) || autoApply;
  const isLongHorizon = LONG_EVAL_WORD_RE.test(text) || Number(metrics.changed_files || 0) >= 8;
  const isDualBrain = DUAL_BRAIN_WORD_RE.test(text);
  const isHarness = HARNESS_WORD_RE.test(text) || touchesCode;
  const hasHumanApproval = approvals.length > 0 || input.humanApproved === true;
  const hasVerification = tests.length > 0 || Boolean(metrics.fix_rate !== undefined || metrics.smoke_ok !== undefined);
  const hasFixRate = metrics.fix_rate !== undefined || metrics.fixed !== undefined || metrics.total !== undefined;
  const hasDifficultCase = Boolean(input.difficultCase || input.badCase || input.failureCase || input.failure_case);

  const dimensions = [
    scoreDimension(!touchesCore || hasHumanApproval, 'human approval for core/persona/memory changes', touchesCore ? approvals.join(', ') : 'no core file touched'),
    scoreDimension(!isMemoryProposal || memoryWrites.length === 0 || hasHumanApproval, 'memory write filter', memoryWrites.join(', ') || 'candidate-only'),
    scoreDimension(!touchesCode || hasVerification, 'empirical verification before adoption', tests.join('; ') || JSON.stringify(metrics)),
    scoreDimension(!isSelfEvolution || sandbox, 'sandbox for self-evolution', sandbox ? 'sandbox declared' : 'no sandbox declared'),
    scoreDimension(!isLongHorizon || hasFixRate, 'long-horizon Fix Rate metric', hasFixRate ? JSON.stringify(metrics) : 'missing fix_rate/fixed/total'),
    scoreDimension(!isDualBrain || Boolean(input.rightBrain && input.leftBrain), 'dual-brain challenge and verification', input.rightBrain && input.leftBrain ? 'both roles provided' : 'missing role outputs'),
    scoreDimension(!isHarness || changedFiles.length > 0, 'code-as-harness artifact boundary', changedFiles.join(', ') || 'no artifact path'),
    scoreDimension(!hasDifficultCase || isMemoryProposal || isSelfEvolution, 'difficult-case-driven skill or memory evolution', hasDifficultCase ? 'bad case supplied' : 'not a difficult-case update'),
  ];

  const blocks = [];
  const warnings = [];
  for (const dimension of dimensions) {
    if (!dimension.ok) {
      if (/human approval|memory write|empirical verification|sandbox/.test(dimension.label)) blocks.push(dimension);
      else warnings.push(dimension);
    }
  }

  if (autoApply && (touchesCore || isSelfEvolution || memoryWrites.length > 0)) {
    blocks.push(scoreDimension(false, 'no automatic adoption for sensitive self-modification', 'autoApply requested'));
  }

  const recommendation = blocks.length
    ? 'reject_or_hold'
    : warnings.length
      ? 'candidate_with_conditions'
      : 'candidate';

  return {
    id: stableId({ title, summary, changedFiles, memoryWrites, metrics }),
    generated_at: new Date().toISOString(),
    title,
    recommendation,
    taxonomy: {
      memory_governance: isMemoryProposal,
      self_evolution: isSelfEvolution,
      long_horizon_eval: isLongHorizon,
      dual_brain: isDualBrain,
      code_as_harness: isHarness,
    },
    dimensions,
    blocks,
    warnings,
  };
}

function parseStdin() {
  const text = fs.readFileSync(0, 'utf8').trim();
  return text ? JSON.parse(text) : {};
}

function selfTest() {
  const blocked = analyzeProposal({
    title: 'self-evolution writes protected memory',
    summary: 'automatic modification of memory policy',
    changedFiles: ['scripts/context-injection.js'],
    memoryWrites: ['MEMORY.md'],
    autoApply: true,
    sandbox: false,
  });
  const candidate = analyzeProposal({
    title: 'Fix Rate adoption gate',
    summary: 'code as harness long-horizon evaluation',
    changedFiles: ['v7/scripts/evolution-gate.js'],
    tests: ['node v7/scripts/evolution-gate.js --self-test'],
    metrics: { fix_rate: 0.42, changed_files: 3 },
    sandbox: true,
    approvals: ['human reviewer'],
  });
  return {
    ok: blocked.recommendation === 'reject_or_hold' && blocked.blocks.length >= 3 && candidate.recommendation === 'candidate',
    checks: { blocked, candidate },
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    const result = selfTest();
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(result.ok ? 0 : 1);
  }
  const record = analyzeProposal(parseStdin());
  process.stdout.write(JSON.stringify(record, null, 2) + '\n');
  process.exit(record.blocks.length ? 2 : 0);
}

if (require.main === module) main();

module.exports = { analyzeProposal, selfTest };
