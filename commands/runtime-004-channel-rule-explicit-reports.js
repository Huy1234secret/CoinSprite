'use strict';

const sanctions = require('../src/moderationActionService');

const PATCH_MARKER = Symbol.for('coinsprite.channelRuleExplicitReports');

function guildWithoutStaffLogChannels(guild) {
  if (!guild?.channels) return guild;
  const shadow = Object.create(guild);
  Object.defineProperty(shadow, 'channels', {
    configurable: true,
    enumerable: true,
    value: {
      cache: new Map(),
      fetch: async () => null,
    },
  });
  return shadow;
}

if (!sanctions.executeSanction?.[PATCH_MARKER]) {
  const nativeExecuteSanction = sanctions.executeSanction;
  const executeSanction = async (input) => {
    if (input?.source !== 'channel_rule') return nativeExecuteSanction(input);
    return nativeExecuteSanction({
      ...input,
      guild: guildWithoutStaffLogChannels(input.guild),
    });
  };
  Object.defineProperty(executeSanction, PATCH_MARKER, { value: true });
  sanctions.executeSanction = executeSanction;
}

module.exports = {
  guildWithoutStaffLogChannels,
};