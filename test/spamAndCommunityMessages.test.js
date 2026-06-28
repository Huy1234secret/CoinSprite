const assert = require('node:assert/strict');
const test = require('node:test');

const spam = require('../commands/spam-auto-moderator');
const community = require('../commands/community-messages');
const { DEFAULT_COMMUNITY_MESSAGES, DEFAULT_SPAM_AUTOMOD } = require('../src/serverConfig');

function message(overrides = {}) {
  return {
    guildId: '123456789012345678',
    author: { id: '234567890123456789' },
    content: 'hello',
    mentions: { users: { size: 0 }, roles: { size: 0 }, everyone: false },
    ...overrides,
  };
}

function settings(overrides = {}) {
  return {
    messages: { enabled: false, count: 3, durationSeconds: 5 },
    lines: { enabled: false, maxLines: 3 },
    mentions: { enabled: false, maxMentions: 3 },
    ...overrides,
  };
}

test('Spam AutoMod detects bursts, excessive lines, and mass mentions', () => {
  const burst = settings({ messages: { enabled: true, count: 3, durationSeconds: 5 } });
  assert.equal(spam.__test.detectViolation(message(), burst, 1000), null);
  assert.equal(spam.__test.detectViolation(message(), burst, 2000), null);
  assert.equal(spam.__test.detectViolation(message(), burst, 3000).kind, 'message_burst');

  const lines = spam.__test.detectViolation(message({ content: 'a\nb\nc\nd' }), settings({
    lines: { enabled: true, maxLines: 3 },
  }));
  assert.equal(lines.kind, 'excessive_lines');

  const mentions = spam.__test.detectViolation(message({
    mentions: { users: { size: 2 }, roles: { size: 1 }, everyone: false },
  }), settings({ mentions: { enabled: true, maxMentions: 3 } }));
  assert.equal(mentions.kind, 'mass_mention');
});

test('community messages replace member and server placeholders', () => {
  const member = {
    id: '234567890123456789',
    displayName: 'Display Name',
    user: { id: '234567890123456789', username: 'someone', globalName: 'Someone' },
    guild: { name: 'CoinSprite', memberCount: 42 },
  };
  const result = community.__test.replaceMessagePlaceholders(
    '<@mention> <username> <display-name> <user-id> <server-name> <member-count>',
    member,
  );
  assert.equal(result, '<@234567890123456789> someone Display Name 234567890123456789 CoinSprite 42');
  assert.equal(DEFAULT_SPAM_AUTOMOD.messages.count, 6);
  assert.match(DEFAULT_COMMUNITY_MESSAGES.welcome.message, /<@mention>/);
});
