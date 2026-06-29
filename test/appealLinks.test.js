const assert = require('node:assert/strict');
const { test } = require('node:test');

process.env.PUBLIC_WEB_BASE_URL = 'https://appeals.example.com/';
const { appealButtonRow, caseAppealUrl } = require('../src/appealLinks');

test('case appeal links open the matching public form', () => {
  const record = { guildId: '123456789012345678', id: 'W-000001', appealable: true };
  assert.equal(
    caseAppealUrl(record),
    'https://appeals.example.com/appeal?guild=123456789012345678&case=W-000001',
  );
  const button = appealButtonRow(record).components[0];
  assert.equal(button.style, 5);
  assert.equal(button.disabled, false);
  assert.equal(button.label, 'Submit an appeal');
});

test('unappealable cases retain a disabled link button', () => {
  const button = appealButtonRow({
    guildId: '123456789012345678',
    id: 'B-000002',
    appealable: false,
  }).components[0];
  assert.equal(button.style, 5);
  assert.equal(button.disabled, true);
  assert.equal(button.label, 'Appeal unavailable');
});
