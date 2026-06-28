const assert = require('node:assert/strict');
const test = require('node:test');

const { parseActionDuration, formatDuration } = require('../src/moderationActionService');
const mute = require('../commands/mute');
const kick = require('../commands/kick');
const ban = require('../commands/ban');

test('moderation commands expose Discord attachment and appealable options', () => {
  for (const command of [mute, kick, ban]) {
    const json = command.data.toJSON();
    const names = json.options.map((option) => option.name);
    assert.deepEqual(names.slice(0, 2), ['user', 'reason']);
    assert.ok(names.includes('attachment'));
    assert.ok(names.includes('appealable'));
    assert.equal(json.options.find((option) => option.name === 'attachment').type, 11);
    assert.equal(typeof command.execute, 'function');
  }
  assert.ok(mute.data.toJSON().options.some((option) => option.name === 'time' && option.required));
  assert.ok(ban.data.toJSON().options.some((option) => option.name === 'time' && option.required));
  assert.equal(kick.data.toJSON().options.some((option) => option.name === 'time'), false);
});

test('sanction durations support temporary and permanent actions', () => {
  assert.equal(parseActionDuration('30m'), 30 * 60000);
  assert.equal(parseActionDuration('7d'), 7 * 86400000);
  assert.equal(parseActionDuration('permanent', { allowPermanent: true }), null);
  assert.equal(formatDuration(2 * 86400000), '2 days');
  assert.equal(formatDuration(null), 'Permanent');
  assert.throws(() => parseActionDuration('29d', { maximumMs: 28 * 86400000 }), /between/);
});
