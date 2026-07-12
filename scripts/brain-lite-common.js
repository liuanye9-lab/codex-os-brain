'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const DEFAULT_CONFIG = path.resolve(__dirname, '../config/brain-lite.json');

function readConfig(configPath = DEFAULT_CONFIG) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function resolveRuntimePaths(env = process.env, options = {}) {
  const pathImpl = options.pathImpl || path;
  const home = options.home || os.homedir();
  const codexHome = pathImpl.resolve(env.CODEX_HOME || pathImpl.join(home, '.codex'));
  const brainHome = pathImpl.resolve(env.CODEX_BRAIN_HOME || pathImpl.join(home, '.codex-brain'));
  return {
    codexHome,
    brainHome,
    configPath: pathImpl.join(brainHome, 'config', 'brain-lite.json'),
    v8ConfigPath: pathImpl.join(brainHome, 'config', 'brain-lite-v8.json'),
    dataRoot: pathImpl.join(brainHome, 'data', 'brain-lite'),
    reportsRoot: pathImpl.join(brainHome, 'reports'),
  };
}

function readV8Config(configPath = resolveRuntimePaths().v8ConfigPath) {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function estimateTokens(text) {
  const value = String(text || '');
  const ascii = (value.match(/[\x00-\x7F]/g) || []).length;
  return Math.ceil(ascii / 4 + (value.length - ascii) / 1.5);
}

function tokenize(text) {
  const value = String(text || '').toLowerCase();
  const compounds = value.match(/[a-z0-9][a-z0-9._+-]*/g) || [];
  const words = compounds.flatMap(token => [token, ...token.split(/[^a-z0-9]+/).filter(Boolean)]);
  const cjk = (value.match(/[\u3400-\u9fff]/g) || []).join('');
  const cjkTokens = [];
  for (let index = 0; index < cjk.length; index += 1) {
    cjkTokens.push(cjk[index]);
    if (index + 1 < cjk.length) cjkTokens.push(cjk.slice(index, index + 2));
  }
  return [...new Set([...words, ...cjkTokens])];
}

function redactSensitive(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED]')
    .replace(/\b(api[_-]?key|password|access[_-]?token|secret)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]');
}

function contentHash(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function chunkMarkdown(text, source, modifiedAt, maxChars = 1800) {
  const lines = String(text || '').split(/\r?\n/);
  const sections = [];
  let headings = [];
  let buffer = [];

  function flush() {
    const body = buffer.join('\n').trim();
    buffer = [];
    if (!body) return;
    const heading = headings.join(' > ') || path.basename(source);
    for (let offset = 0; offset < body.length; offset += maxChars) {
      const content = body.slice(offset, offset + maxChars).trim();
      if (!content) continue;
      sections.push({
        id: contentHash(`${source}\0${heading}\0${content}`),
        hash: contentHash(content),
        source,
        heading,
        modifiedAt,
        content,
        estimatedTokens: estimateTokens(content),
      });
    }
  }

  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (match) {
      flush();
      const level = match[1].length;
      headings = headings.slice(0, level - 1);
      headings[level - 1] = match[2];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

function atomicWriteJson(outputPath, value) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.tmp.${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, outputPath);
}

function isDataless(filePath) {
  if (process.platform !== 'darwin') return false;
  let target = filePath;
  try { target = fs.realpathSync(filePath); } catch {}
  const result = spawnSync('/bin/ls', ['-lO', target], { encoding: 'utf8', timeout: 1500 });
  return /\bdataless\b/.test(result.stdout || '');
}

function collectSourceFiles(sources) {
  const files = [];
  const warnings = [];
  const visit = source => {
    if (!fs.existsSync(source)) {
      warnings.push({ source, reason: 'missing' });
      return;
    }
    const stat = fs.statSync(source);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue;
        visit(path.join(source, entry.name));
      }
      return;
    }
    if (!/\.(md|txt|json|jsonl)$/i.test(source)) return;
    if (isDataless(source)) {
      warnings.push({ source, reason: 'dataless' });
      return;
    }
    files.push(source);
  };
  for (const source of sources || []) visit(source);
  return { files: [...new Set(files)], warnings };
}

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) {
      result._.push(item);
      continue;
    }
    const key = item.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

module.exports = {
  DEFAULT_CONFIG,
  atomicWriteJson,
  chunkMarkdown,
  collectSourceFiles,
  contentHash,
  estimateTokens,
  parseArgs,
  readConfig,
  readV8Config,
  redactSensitive,
  resolveRuntimePaths,
  tokenize,
};
