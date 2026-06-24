const test = require('node:test');
const assert = require('node:assert/strict');

require('../commands/000-zz-ai-moderation-alert-format-fix');
const { EXTRA_DEFAULT_BOT_TEMPLATES } = require('../commands/000z-message-template-extra-defaults');
const { DEFAULT_BOT_TEMPLATES, deleteTemplate, listTemplates } = require('../src/messageTemplates');

test('exposes extra bot defaults without word-chain messages', () => {
  const expectedIds = EXTRA_DEFAULT_BOT_TEMPLATES.map((template) => template.id);
  const defaults = listTemplates('extra-defaults-test').filter((template) => template.botDefault);
  const defaultIds = new Set(defaults.map((template) => template.id));

  for (const id of expectedIds) assert.ok(defaultIds.has(id), `${id} is listed as a bot default`);
  assert.ok(DEFAULT_BOT_TEMPLATES.some((template) => template.id === 'default-level-up-message'));

  const wordChainDefaults = defaults.filter((template) => {
    const haystack = JSON.stringify({ id: template.id, name: template.name, containers: template.containers }).toLowerCase();
    return haystack.includes('word-chain') || haystack.includes('word chain');
  });
  assert.deepEqual(wordChainDefaults.map((template) => template.id), []);
});

test('keeps extra bot defaults locked against deletion', () => {
  assert.equal(deleteTemplate('extra-defaults-test', 'default-level-up-message'), false);
});
