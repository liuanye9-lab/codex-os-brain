'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createEvidenceSealer,
  createProductionEvidenceKeyProvider,
  createWindowsDpapiEvidenceKeyProvider,
} = require('../scripts/v9/evidence-seal');
const { createTaskContract, sealTaskContract } = require('../scripts/v9/task-contract');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'brain-v9-evidence-provider-'));
  return { root, evidenceSealKeyPath: path.join(root, 'evidence', 'seal.key') };
}

test('Linux production mode creates a private fallback key without NODE_TEST_CONTEXT', () => {
  const paths = fixture();
  const run = () => ({ status: null, stdout: '', stderr: 'secret-tool unavailable' });
  const provider = createProductionEvidenceKeyProvider({ paths, platform: 'linux', run });
  const key = provider.get({ create: true });
  assert.equal(key.length, 32);
  if (process.platform !== 'win32') assert.equal(fs.statSync(paths.evidenceSealKeyPath).mode & 0o777, 0o600);
  assert.deepEqual(provider.get({ create: false }), key);
});

test('Windows production mode delegates storage and retrieval to current-user DPAPI', () => {
  const paths = fixture();
  let protectedValue = null;
  const run = (_command, args) => {
    const script = args[args.indexOf('-Command') + 1];
    const scriptArgs = args.slice(args.indexOf('-Command') + 2);
    if (script.includes('::Protect')) {
      protectedValue = scriptArgs[1];
      fs.mkdirSync(path.dirname(scriptArgs[0]), { recursive: true });
      fs.writeFileSync(scriptArgs[0], 'synthetic-dpapi-envelope');
      return { status: 0, stdout: '', stderr: '' };
    }
    if (script.includes('::Unprotect')) return { status: 0, stdout: protectedValue, stderr: '' };
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };
  const provider = createWindowsDpapiEvidenceKeyProvider({ keyPath: paths.evidenceSealKeyPath, run });
  const created = provider.get({ create: true });
  assert.equal(created.length, 32);
  assert.deepEqual(provider.get({ create: false }), created);
});

test('production sealer can complete a contract round trip with a platform provider', () => {
  const paths = fixture();
  const provider = createProductionEvidenceKeyProvider({
    paths,
    platform: 'linux',
    run: () => ({ status: null, stdout: '', stderr: '' }),
  });
  const sealer = createEvidenceSealer({ paths, keyProvider: provider });
  const contract = sealTaskContract(createTaskContract({
    taskId: 'production-smoke',
    objective: 'prove production signing works',
    criteria: [{ id: 'exists', verifier: 'file_exists', verifierSpec: { path: 'marker.txt' } }],
  }), sealer);
  assert.equal(sealer.verifyContract(contract), true);
  assert.equal(sealer.providerType, 'linux-libsecret-or-file-0600');
});
