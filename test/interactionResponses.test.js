const assert = require('node:assert/strict');
const test = require('node:test');
const { MessageFlags } = require('discord.js');

const {
  acknowledgeEphemeral,
  acknowledgeUpdate,
  completeEphemeral,
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
      customId: 'mt:2n9c:b:template-token:control-token:revision-token',
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

test('interaction diagnostics include selected control validation paths and payload sizes without secrets', () => {
  const error = discordError(10062);
  error.name = 'DiscordAPIError50035';
  error.code = 50035;
  error.status = 400;
  error.rawError = { errors: { components: { 0: { components: { 1: { components: { 1: {
    custom_id: { _errors: [{ code: 'COMPONENT_CUSTOM_ID_DUPLICATED', message: 'Component custom id must be unique.' }] },
  } } } } } } } };
  error.requestBody = { json: {
    flags: MessageFlags.IsComponentsV2,
    components: [{ type: 17, components: [{ type: 10, content: 'trade' }] }],
  } };
  const interaction = {
    customId: 'mt:2n9c:d:template-token:control-token:revision-token',
    values: ['option-1'],
    commandName: '',
    guildId: '123456789012345678',
    channelId: '223456789012345678',
    deferred: false,
    replied: false,
    isStringSelectMenu: () => true,
  };
  assert.equal(safeControlKind(interaction.customId), 'mt:2n9c:d');
  const diagnostic = formatInteractionFailure(error, interaction, { operation: 'defer-update', startedAt: Date.now() - 5 });
  assert.match(diagnostic, /kind=string-select.*control=mt:2n9c:d/);
  assert.match(diagnostic, /customId="mt:2n9c:d:template-token:control-token:revision-token" selected="option-1"/);
  assert.match(diagnostic, /code=50035.*status=400/);
  assert.match(diagnostic, /components\[0\]\.components\[1\]\.components\[1\]\.custom_id/);
  assert.match(diagnostic, /COMPONENT_CUSTOM_ID_DUPLICATED.*Component custom id must be unique/);
  assert.match(diagnostic, /payload=.*"embeds":0.*"components":2.*"componentTextChars":5/);
  assert.doesNotMatch(diagnostic, /SECRET_CALLBACK_TOKEN|discord\.com/);
  const unsafeMessage = new Error('failed https://discord.com/api/v10/interactions/id/SECRET_CALLBACK_TOKEN/callback Bot secret');
  assert.doesNotMatch(safeErrorMessage(unsafeMessage), /SECRET_CALLBACK_TOKEN|discord\.com|Bot secret/);
});

test('ephemeral completion edits acknowledged interactions and never replies twice', async () => {
  const payload = { flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral, components: [] };
  for (const state of [{ deferred: true, replied: false }, { deferred: false, replied: true }]) {
    const calls = [];
    await completeEphemeral({
      ...state,
      editReply: async (value) => calls.push(['edit', value]),
      reply: async () => calls.push(['reply']),
      followUp: async () => calls.push(['follow']),
    }, payload);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'edit');
    assert.equal(calls[0][1].flags, MessageFlags.IsComponentsV2);
  }

  const freshCalls = [];
  await completeEphemeral({
    deferred: false,
    replied: false,
    reply: async (value) => freshCalls.push(value),
  }, payload);
  assert.equal(freshCalls.length, 1);
  assert.equal(freshCalls[0].flags, MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral);
});
