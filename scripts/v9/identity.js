'use strict';

// Identity is read from package.json rather than restated here. Two copies of a version number
// drift the moment one is bumped: V11 raised the package to 11 / 0.17.0 and left this file
// reporting 10 / 0.16.0, so `brain status` disagreed with the release it came from.
const pkg = require('../../package.json');

const declared = pkg.codexBrain || {};

const IDENTITY = Object.freeze({
  productName: declared.productName || 'Codex Brain',
  productMajor: Number(declared.productMajor),
  releaseVersion: declared.releaseVersion || pkg.version,
  runtimeContract: Number(declared.runtimeContract),
  releaseChannel: declared.releaseChannel || 'personal',
  compatibilityName: declared.compatibilityName || pkg.name,
});

module.exports = { IDENTITY };
