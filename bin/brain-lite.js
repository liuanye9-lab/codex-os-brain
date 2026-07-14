#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const api = require('../index');
const v8Config = require('../config/brain-lite-v8.json');
const packageJson = require('../package.json');
const { parseArgs, readConfig } = require('../scripts/brain-lite-common');

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function help() {
  process.stdout.write([
    'brain-lite self-check',
    'brain-lite contract --features <features.json>',
    'brain-lite index-health --config <runtime-config.json> [--stale-after-hours 48]',
    '',
    'All commands are deterministic. None launches a model or enables hooks.',
  ].join('\n') + '\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];

  if (!command || command === 'help' || args.help) {
    help();
    return;
  }

  if (command === 'self-check') {
    print({
      name: packageJson.name,
      version: packageJson.version,
      policyVersion: v8Config.policyVersion,
      hooksEnabled: v8Config.hooks.enabled,
      behavioralMemoryEnabled: v8Config.behavioralMemory.enabled,
      automaticLifecycleChanges: v8Config.outcomeAttribution.automaticLifecycleChanges,
    });
    return;
  }

  if (command === 'contract') {
    if (!args.features) throw new Error('--features is required');
    const features = JSON.parse(fs.readFileSync(path.resolve(args.features), 'utf8'));
    print(api.taskContract.buildTaskContract(features, v8Config.taskContract));
    return;
  }

  if (command === 'index-health') {
    if (!args.config) throw new Error('--config is required');
    const configPath = path.resolve(args.config);
    const configRoot = path.dirname(configPath);
    const runtimeConfig = readConfig(configPath);
    const resolveFromConfig = (value) => path.isAbsolute(value) ? value : path.resolve(configRoot, '..', value);
    print(api.indexHealth.inspectIndexHealth({
      indexPath: resolveFromConfig(runtimeConfig.recall.indexPath),
      sources: runtimeConfig.recall.sources.map(resolveFromConfig),
      staleAfterHours: Number(args['stale-after-hours'] || v8Config.indexHealth.staleAfterHours),
    }));
    return;
  }

  throw new Error(`unknown command: ${command}`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { help, main };
