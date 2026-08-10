const { MessageFlags } = require('discord.js');
const { ALLOWED_MENTIONS } = require('./format');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xFFFFFF;

function v2Payload(components, options = {}) {
  const payload = {
    content: null,
    embeds: [],
    allowedMentions: ALLOWED_MENTIONS,
    components,
  };
  if (options.initial !== false) {
    payload.flags = COMPONENTS_V2_FLAG | (options.ephemeral ? EPHEMERAL_FLAG : 0);
  }
  return payload;
}

function textContainer(content, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: options.color ?? WHITE,
    components: [{ type: 10, content: String(content).slice(0, 4_000) }],
  }], options);
}

function errorPayload(content, options = {}) {
  return textContainer(`### ${content}`, { color: 0xEF4444, ...options });
}

module.exports = {
  COMPONENTS_V2_FLAG,
  EPHEMERAL_FLAG,
  WHITE,
  errorPayload,
  textContainer,
  v2Payload,
};
