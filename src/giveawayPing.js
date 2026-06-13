const { getGiveawayAnnouncementTargetId } = require('./giveawayUtils');

const ROLE_MENTION_RE = /^<@&(?<roleId>\d{17,20})>$/;

function isConfiguredGiveawayPingComponent(component, guildId) {
  if (!component || component.type !== 10) return false;
  const content = String(component.content || '').trim();
  const match = content.match(ROLE_MENTION_RE);
  if (!match) return false;
  return match.groups.roleId === getGiveawayAnnouncementTargetId(guildId);
}

function withoutBaseGiveawayPing(payload, guildId) {
  return {
    ...payload,
    components: (payload.components || []).filter((component) => !isConfiguredGiveawayPingComponent(component, guildId)),
  };
}

function suppressMentions(payload) {
  return {
    ...payload,
    allowedMentions: { parse: [] },
  };
}

function withStartupPing(payload, guildId, roleId) {
  const cleanPayload = withoutBaseGiveawayPing(payload, guildId);
  const normalizedRoleId = String(roleId || '').trim();
  if (!/^\d{17,20}$/.test(normalizedRoleId)) return suppressMentions(cleanPayload);

  return {
    ...cleanPayload,
    components: [
      { type: 10, content: `<@&${normalizedRoleId}>` },
      ...(cleanPayload.components || []),
    ],
    allowedMentions: { parse: [], roles: [normalizedRoleId] },
  };
}

function withoutStartupPing(payload, guildId) {
  return suppressMentions(withoutBaseGiveawayPing(payload, guildId));
}

module.exports = {
  withStartupPing,
  withoutStartupPing,
};
