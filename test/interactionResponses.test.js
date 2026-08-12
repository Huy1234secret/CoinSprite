const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageFlags } = require('discord.js');

const {
  acknowledgeEphemeral,
  acknowledgeUpdate,
  formatInteractionFailure,
  safeErrorMessage,
  safeControlKind,
} = require('../src/features/shared/interactionResponses');

function discordError(code) {
  const error = new Error('request failed');
  error.code = code;
  error.status = 404;
  error.url = 'https://discord.com/api/v10/interactions/id/SECRET_CALLBACK_TOKEN/callback';
  return error;
}

test('acknowledgement helpers cover fresh, deferred, replied, expired, and raced interactions', async () => {
  const calls = [];
  assert.equal(await acknowledgeUpdate({
    deferred: false,
    replied: false,
    deferUpdate: async () => calls.push('update'),
  }), true);
  assert.equal(await acknowledgeEphemeral({
    deferred: false,
    replied: false,
    deferReply: async (options) => calls.push(options.flags),
  }), true);
  assert.equal(await acknowledgeUpdate({ deferred: true, deferUpdate: async () => calls.push('unexpected') }), true);
  assert.equal(await acknowledgeUpdate({ replied: true, deferUpdate: async () => calls.push('unexpected') }), true);
  assert.deepEqual(calls, ['update', MessageFlags.Ephemeral]);

  for (const code of [10062, 40060]) {
    const reports = [];
    const interaction = {
      customId: 'rng:rps:reveal:private-game-id',
      guildId: 'guild',
      channelId: 'channel',
      isButton: () => true,
      deferUpdate: async () => { throw discordError(code); },
    };
    assert.equal(await acknowledgeUpdate(interaction, {
      reportError: (error, event) => reports.push([error, event]),
    }), false);
    assert.equal(reports.length, 1);
    assert.equal(reports[0][0].code, code);
    assert.doesNotMatch(reports[0][0].message, /SECRET_CALLBACK_TOKEN|discord\.com\/api\/v10\/interactions/);
  }
});

test('safe interaction diagnostics contain routing context without custom IDs or callback secrets', () => {
  const error = discordError(10062);
  const interaction = {
    customId: 'rng:info:command:v3:123456789012345678:1',
    commandName: '',
    guildId: '123456789012345678',
    channelId: '223456789012345678',
    deferred: false,
    replied: false,
    isStringSelectMenu: () => true,
  };
  assert.equal(safeControlKind(interaction.customId), 'rng:info:command');
  const diagnostic = formatInteractionFailure(error, interaction, { operation: 'defer-update', startedAt: Date.now() - 5 });
  assert.match(diagnostic, /kind=string-select.*control=rng:info:command.*code=10062/);
  assert.doesNotMatch(diagnostic, /SECRET_CALLBACK_TOKEN|v3:123456789012345678|discord\.com/);
  const unsafeMessage = new Error('failed https://discord.com/api/v10/interactions/id/SECRET_CALLBACK_TOKEN/callback Bot secret');
  assert.doesNotMatch(safeErrorMessage(unsafeMessage), /SECRET_CALLBACK_TOKEN|discord\.com|Bot secret/);
});
