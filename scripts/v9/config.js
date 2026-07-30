'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveV9Paths } = require('./paths');

function validateV9Config(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 9) throw new Error('invalid_v9_config');
  if (typeof value.enabled !== 'boolean' || !value.hooks || typeof value.hooks !== 'object') throw new Error('invalid_v9_config');
  for (const [key, fallback] of [['preToolUseBudgetMs', 100], ['postToolUseBudgetMs', 150], ['contextTokenBudget', 250]]) {
    const observed = value.hooks[key] ?? fallback;
    if (!Number.isFinite(observed) || observed < 0 || observed > 60_000) throw new Error(`invalid_v9_config:${key}`);
  }
  return value;
}

function readV9Config(configPath, env = process.env) {
  const packageDefault = path.resolve(__dirname, '..', '..', 'config', 'brain-lite-v9.json');
  const userConfig = resolveV9Paths(env).configPath;
  const file = configPath || env.BRAIN_V9_CONFIG || (fs.existsSync(userConfig) ? userConfig : packageDefault);
  return validateV9Config(JSON.parse(fs.readFileSync(file, 'utf8')));
}

module.exports = { readV9Config, validateV9Config };
