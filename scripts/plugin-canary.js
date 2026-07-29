#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { buildPublicExport } = require('./build-public-export');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: false, ...options });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${path.basename(command)}_failed`);
  return result.stdout;
}

function digestFile(file) {
  if (!fs.existsSync(file)) return 'missing';
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function findFile(root, suffix, limit = 20_000) {
  if (!fs.existsSync(root)) return null;
  const pending = [root];
  let seen = 0;
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      seen += 1;
      if (seen > limit) throw new Error('plugin_canary_walk_limit');
      const target = path.join(directory, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) pending.push(target);
      else if (target.replaceAll('\\', '/').endsWith(suffix)) return target;
    }
  }
  return null;
}

async function main() {
  const sourceRoot = path.resolve(__dirname, '..');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-brain-plugin-canary-'));
  const marketplaceRoot = path.join(temp, 'marketplace');
  const pluginRoot = marketplaceRoot;
  const tempCodexHome = path.join(temp, 'codex-home');
  const liveCodexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const liveBefore = {
    config: digestFile(path.join(liveCodexHome, 'config.toml')),
    hooks: digestFile(path.join(liveCodexHome, 'hooks.json')),
  };
  const codex = process.env.CODEX_BIN
    || (fs.existsSync('/Applications/ChatGPT.app/Contents/Resources/codex')
      ? '/Applications/ChatGPT.app/Contents/Resources/codex'
      : 'codex');
  fs.mkdirSync(tempCodexHome, { recursive: true });
  try {
    buildPublicExport({
      sourceRoot,
      outputRoot: pluginRoot,
      allowlistPath: path.join(sourceRoot, 'config', 'public-export-allowlist.json'),
    });
    if (fs.existsSync(path.join(pluginRoot, 'node_modules'))) throw new Error('plugin_canary_must_not_bundle_node_modules');
    const env = {
      ...process.env,
      CODEX_HOME: tempCodexHome,
      CODEX_BRAIN_HOME: path.join(temp, 'brain-home'),
      CODEX_BRAIN_STATE_HOME: path.join(temp, 'state-home'),
    };
    const addedMarketplace = JSON.parse(run(codex, ['plugin', 'marketplace', 'add', marketplaceRoot, '--json'], { env }));
    if (!JSON.stringify(addedMarketplace).includes('codex-brain')) throw new Error('marketplace_add_contract_failed');
    const available = JSON.parse(run(codex, ['plugin', 'list', '--available', '--json'], { env }));
    if (!JSON.stringify(available).includes('codex-brain-v9')) throw new Error('plugin_not_discoverable');
    const installed = JSON.parse(run(codex, ['plugin', 'add', 'codex-brain-v9@codex-brain', '--json'], { env }));
    if (!JSON.stringify(installed).includes('codex-brain-v9')) throw new Error('plugin_install_contract_failed');
    const installedManifest = findFile(tempCodexHome, '/.codex-plugin/plugin.json');
    if (!installedManifest) throw new Error('installed_plugin_manifest_missing');
    const installedRoot = path.resolve(path.dirname(installedManifest), '..');
    if (fs.existsSync(path.join(installedRoot, 'node_modules'))) throw new Error('installed_plugin_unexpected_node_modules');
    const mcpConfig = JSON.parse(fs.readFileSync(path.join(installedRoot, '.mcp.json'), 'utf8'));
    const server = mcpConfig.mcpServers?.['codex-brain'];
    if (server?.args?.[0] !== './mcp/standalone.mjs') throw new Error('native_mcp_launcher_mismatch');

    const { Client } = await import('@modelcontextprotocol/client');
    const { StdioClientTransport } = await import('@modelcontextprotocol/client/stdio');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(installedRoot, 'mcp', 'standalone.mjs')],
      cwd: installedRoot,
      env,
      stderr: 'pipe',
    });
    const client = new Client({ name: 'codex-brain-native-canary', version: '1.0.0' });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      if (tools.tools.map(tool => tool.name).join(',') !== 'brain_get_status') throw new Error('native_mcp_tool_boundary_failed');
      const status = await client.callTool({ name: 'brain_get_status', arguments: {} });
      if (status.structuredContent?.runtimeInitialized !== false
        || status.structuredContent?.features?.memory !== false
        || status.structuredContent?.features?.cognitiveAssets !== false) {
        throw new Error('native_mcp_default_off_failed');
      }
    } finally {
      await transport.close();
    }
    if (findFile(path.join(temp, 'state-home'), '/memory.sqlite3')) throw new Error('native_plugin_initialized_memory');
    const liveAfter = {
      config: digestFile(path.join(liveCodexHome, 'config.toml')),
      hooks: digestFile(path.join(liveCodexHome, 'hooks.json')),
    };
    if (liveBefore.config !== liveAfter.config || liveBefore.hooks !== liveAfter.hooks) {
      throw new Error('native_plugin_mutated_live_codex_home');
    }
    process.stdout.write(`${JSON.stringify({
      passed: true,
      marketplace: true,
      pluginInstall: true,
      noBundledDependencies: true,
      mcpInitialize: true,
      tools: ['brain_get_status'],
      runtimeInitialized: false,
      liveCodexHomeUnchanged: true,
    })}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { main };
