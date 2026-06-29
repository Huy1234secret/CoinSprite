const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../commands/000-zz-ai-moderation-alert-format-fix');
const { EXTRA_DEFAULT_BOT_TEMPLATES } = require('../commands/000z-message-template-extra-defaults');
const { DEFAULT_BOT_TEMPLATES, deleteTemplate, listTemplates } = require('../src/messageTemplates');

const EXCLUDED_DEFAULT_IDS = [
  'default-level-up-message',
  'default-ticket-launcher-message',
  'default-ticket-open-message',
  'default-ticket-transcript-saving',
  'default-ticket-transcript-saved',
  'default-giveaway-transcript-proof-saved',
  'default-ticket-deleting',
];

const WARNING_ACTION_DEFAULT_IDS = [
  'default-warning-timeout-notice',
  'default-warning-kick-notice',
  'default-warning-ban-notice',
  'default-moderation-mute-notice',
  'default-moderation-kick-notice',
  'default-moderation-ban-notice',
];

test('exposes extra bot defaults without excluded categories', () => {
  const expectedIds = EXTRA_DEFAULT_BOT_TEMPLATES.map((template) => template.id);
  const defaults = listTemplates('extra-defaults-test').filter((template) => template.botDefault);
  const defaultIds = new Set(defaults.map((template) => template.id));

  for (const id of expectedIds) assert.ok(defaultIds.has(id), `${id} is listed as a bot default`);
  for (const id of WARNING_ACTION_DEFAULT_IDS) assert.ok(defaultIds.has(id), `${id} is listed as a warning action default`);
  for (const id of EXCLUDED_DEFAULT_IDS) assert.equal(defaultIds.has(id), false, `${id} is not listed as a bot default`);
  assert.ok(DEFAULT_BOT_TEMPLATES.some((template) => template.id === 'default-warning-notice'));
  assert.ok(DEFAULT_BOT_TEMPLATES.some((template) => template.id === 'default-warning-timeout-notice'));

  const forbiddenDefaults = defaults.filter((template) => {
    const haystack = JSON.stringify({ id: template.id, name: template.name, containers: template.containers }).toLowerCase();
    return haystack.includes('word-chain')
      || haystack.includes('word chain')
      || haystack.includes('level-up')
      || haystack.includes('leveling')
      || haystack.includes('ticket');
  });
  assert.deepEqual(forbiddenDefaults.map((template) => template.id), []);
});

test('keeps remaining extra bot defaults locked against deletion', () => {
  assert.equal(deleteTemplate('extra-defaults-test', 'default-warning-notice'), false);
  assert.equal(deleteTemplate('extra-defaults-test', 'default-warning-timeout-notice'), false);
  assert.equal(deleteTemplate('extra-defaults-test', 'default-moderation-ban-notice'), false);
});

test('default-message search applies the same query filter as custom templates', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'admin', 'messages.js'), 'utf8');
  assert.match(source, /const defaults = allTemplates\.filter\(\(item\) => isDefaultTemplate\(item\) && item\.type !== 'folder' && matchesQuery\(item, query\)\);/);
});
