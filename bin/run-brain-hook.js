#!/usr/bin/env node
'use strict';

process.env.BRAIN_V9_HOOKS = '1';
process.env.BRAIN_V9_HOOK_OWNER = 'codex-brain-v9';
require('./brain-hook');
