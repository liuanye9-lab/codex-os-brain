#!/usr/bin/env node
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { runCli } = require('../scripts/v9/cli');

async function serveMcp() {
  const module = await import(pathToFileURL(path.resolve(__dirname, '..', 'mcp', 'server.mjs')).href);
  return module.serve();
}

runCli(process.argv.slice(2), undefined, { serveMcp })
  .then(code => { process.exitCode = code; })
  .catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 4; });
