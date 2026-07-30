#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnNpmSync } = require('./npm-runtime');

function main(argv = process.argv.slice(2)) {
  const outputIndex = argv.indexOf('--output');
  const output = path.resolve(outputIndex >= 0 ? argv[outputIndex + 1] : 'sbom.cdx.json');
  const result = spawnNpmSync(['sbom', '--sbom-format', 'cyclonedx']);
  if (result.status !== 0) throw new Error(result.stderr || 'npm_sbom_failed');
  const sbom = JSON.parse(result.stdout);
  if (sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components) || !sbom.components.length) {
    throw new Error('sbom_contract_failed');
  }
  const missingLicense = sbom.components.filter(component => !Array.isArray(component.licenses) || component.licenses.length === 0)
    .map(component => component['bom-ref'] || component.name);
  if (missingLicense.length) throw new Error(`sbom_license_missing:${missingLicense.join(',')}`);
  fs.writeFileSync(output, `${JSON.stringify(sbom, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ passed: true, output, components: sbom.components.length })}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

module.exports = { main };
