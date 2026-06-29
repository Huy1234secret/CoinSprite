const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-sanctions-'));
process.env.MODERATION_CASE_STORE_PATH = path.join(directory, 'moderation-cases.json');

const {
  DISCORD_MAX_TIMEOUT_MS,
  executeSanction,
  formatDuration,
  parseActionDuration,
} = require('../src/moderationActionService');
const mute = require('../commands/mute');
const kick = require('../commands/kick');
const ban = require('../commands/ban');
const warn = require('../commands/warn');

after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('moderation commands expose optional time, attachment, and appealable options', () => {
  for (const command of [mute, kick, ban]) {
    const json = command.data.toJSON();
    const names = json.options.map((option) => option.name);
    assert.deepEqual(names.slice(0, 2), ['user', 'reason']);
    assert.ok(names.includes('attachment'));
    assert.ok(names.includes('appealable'));
    assert.equal(json.options.find((option) => option.name === 'attachment').type, 11);
    assert.equal(typeof command.execute, 'function');
  }
  assert.equal(mute.data.toJSON().options.find((option) => option.name === 'time').required, false);
  assert.equal(ban.data.toJSON().options.find((option) => option.name === 'time').required, false);
  assert.equal(warn.data.toJSON().options.find((option) => option.name === 'time').required, false);
  assert.equal(kick.data.toJSON().options.some((option) => option.name === 'time'), false);
});

test('sanction durations support temporary and permanent actions', () => {
  assert.equal(parseActionDuration('30m'), 30 * 60000);
  assert.equal(parseActionDuration('7d'), 7 * 86400000);
  assert.equal(parseActionDuration('permanent', { allowPermanent: true }), null);
  assert.equal(parseActionDuration('', { allowPermanent: true }), null);
  assert.equal(formatDuration(2 * 86400000), '2 days');
  assert.equal(formatDuration(null), 'Permanent');
  assert.throws(() => parseActionDuration('29d', { maximumMs: 28 * 86400000 }), /between/);
});

function sanctionFixture() {
  const events = [];
  const user = {
    id: '234567890123456789',
    bot: false,
    username: 'target',
    displayAvatarURL: () => '',
    send: async () => {
      events.push('dm');
      return { channelId: '345678901234567890', id: '456789012345678901' };
    },
  };
  const member = {
    id: user.id,
    moderatable: true,
    kickable: true,
    bannable: true,
    timeout: async (durationMs) => events.push('mute:' + durationMs),
    kick: async () => events.push('kick'),
  };
  const guild = {
    id: '567890123456789012',
    name: 'Test guild',
    ownerId: '678901234567890123',
    members: {
      fetch: async () => member,
      ban: async () => events.push('ban'),
    },
    channels: {
      cache: new Map(),
      fetch: async () => null,
    },
  };
  return { events, guild, member, user };
}

test('kick and ban notices are sent before the member leaves the guild', async () => {
  for (const action of ['kick', 'ban']) {
    const fixture = sanctionFixture();
    const result = await executeSanction({
      action,
      guild: fixture.guild,
      user: fixture.user,
      member: fixture.member,
      moderatorId: '789012345678901234',
      reason: 'Test reason',
      time: '',
    });
    assert.equal(result.delivery, 'dm');
    assert.deepEqual(fixture.events, ['dm', action]);
  }
});

test('a blank mute duration applies a renewable Discord timeout and records permanence', async () => {
  const fixture = sanctionFixture();
  const result = await executeSanction({
    action: 'mute',
    guild: fixture.guild,
    user: fixture.user,
    member: fixture.member,
    moderatorId: '789012345678901234',
    reason: 'Test reason',
    time: '',
  });
  assert.equal(result.durationMs, null);
  assert.equal(result.delivery, 'dm');
  assert.deepEqual(fixture.events, ['mute:' + DISCORD_MAX_TIMEOUT_MS, 'dm']);
  assert.equal(result.case.expiresAt, null);
});
