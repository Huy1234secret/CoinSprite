const assert = require('node:assert/strict');
const { test } = require('node:test');
const { __test } = require('../commands/moderator');

function moderationMessage() {
  let replyPayload = null;
  const author = { id: '123456789012345678', username: 'flagged-user' };
  const guild = { id: '234567890123456789', name: 'CoinSprite' };
  const channel = { id: '345678901234567890', name: 'general' };
  return {
    message: {
      guildId: guild.id,
      guild,
      channel,
      author,
      member: { displayName: 'Flagged User', user: author, guild },
      async reply(payload) {
        replyPayload = payload;
        return { id: '456789012345678901' };
      },
    },
    getReplyPayload: () => replyPayload,
  };
}

test('severity below 8 does not send a user warning', async () => {
  const fixture = moderationMessage();
  const sent = await __test.sendSevereUserWarning(fixture.message, {
    severityScore: 7.99,
    case: 'Harassment',
    reason: 'Test reason.',
  });
  assert.equal(sent, false);
  assert.equal(fixture.getReplyPayload(), null);
});

test('severity 8 replies with the Components V2 user warning template', async () => {
  const fixture = moderationMessage();
  const sent = await __test.sendSevereUserWarning(fixture.message, {
    severityScore: 8,
    severity: 'critical',
    case: 'Harassment',
    reason: 'The message contains severe harassment.',
  });

  assert.equal(sent, true);
  const payload = fixture.getReplyPayload();
  assert.equal(payload.flags, 32768);
  assert.equal(payload.failIfNotExists, false);
  assert.deepEqual(payload.allowedMentions.users, ['123456789012345678']);

  const warningText = payload.components
    .flatMap((component) => component.components || [])
    .map((component) => component.content || '')
    .join('\n');
  assert.match(warningText, /Message flagged/);
  assert.match(warningText, /Severity:\*\* 8\/10/);
  assert.match(warningText, /Case:\*\* Harassment/);
  assert.match(warningText, /Reason:\*\* The message contains severe harassment\./);
});
