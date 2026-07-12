const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('ticket patch guards avoid direct circular export property reads', () => {
  for (const file of [
    'commands/ticket-system.js',
    'src/adminServer.js',
    'src/messageTemplates.js',
    'src/ticketConfig.js',
  ]) {
    const text = source(file);
    assert.doesNotMatch(text, /\|\|\s*exported\.__[A-Za-z0-9_]+/);
    assert.doesNotMatch(text, /if\s*\(![A-Za-z0-9_]+(?:Object)?\.__coinSprite/);
  }
});
