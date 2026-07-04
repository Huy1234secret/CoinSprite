'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const test = require('node:test');

const servicePath = require.resolve('../src/moderationActionService');
const patchPath = require.resolve('../commands/004-channel-rule-explicit-reports');

test('channel-rule sanctions hide global staff log channels only', async () => {
  const savedService = require.cache[servicePath];
  const savedPatch = require.cache[patchPath];
  const calls = [];
  const fakeService = new Module(servicePath);
  fakeService.filename = servicePath;
  fakeService.loaded = true;
  fakeService.exports = {
    executeSanction: async (input) => {
      calls.push(input);
      return input;
    },
  };
  require.cache[servicePath] = fakeService;
  delete require.cache[patchPath];

  try {
    const { guildWithoutStaffLogChannels } = require(patchPath);
    const sanctions = require(servicePath);
    const configuredChannel = { id: '234567890123456789' };
    const guild = {
      id: '123456789012345678',
      channels: {
        cache: new Map([[configuredChannel.id, configuredChannel]]),
        fetch: async () => configuredChannel,
      },
      members: { marker: true },
    };

    const shadow = guildWithoutStaffLogChannels(guild);
    assert.notStrictEqual(shadow, guild);
    assert.equal(shadow.id, guild.id);
    assert.strictEqual(shadow.members, guild.members);
    assert.equal(shadow.channels.cache.size, 0);
    assert.equal(await shadow.channels.fetch(configuredChannel.id), null);
    assert.equal(guild.channels.cache.size, 1);

    await sanctions.executeSanction({ source: 'channel_rule', guild });
    assert.notStrictEqual(calls[0].guild, guild);
    assert.equal(calls[0].guild.channels.cache.size, 0);
    assert.equal(await calls[0].guild.channels.fetch(configuredChannel.id), null);

    await sanctions.executeSanction({ source: 'manual', guild });
    assert.strictEqual(calls[1].guild, guild);
  } finally {
    if (savedService) require.cache[servicePath] = savedService;
    else delete require.cache[servicePath];
    if (savedPatch) require.cache[patchPath] = savedPatch;
    else delete require.cache[patchPath];
  }
});