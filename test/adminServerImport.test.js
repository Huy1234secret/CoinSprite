const assert = require('node:assert/strict');
const test = require('node:test');

const adminServer = require('../src/adminServer');

test('admin server module exports the startup function', () => {
  assert.equal(typeof adminServer.startAdminServer, 'function');
});
