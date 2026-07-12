'use strict';

function parseLimit(value, fallback) {
  return Number(value) || fallback;
}

module.exports = { parseLimit };
