const { errorPayload } = require('../../shared/components');
const {
  INFO_MESSAGE_VERSION,
  INFO_SELECT_CUSTOM_ID,
  TOPIC_BY_ID,
} = require('./catalog');
const { topicPayload } = require('./builders');

function featureError(policy) {
  if (policy?.unlocked !== true) return 'GAG2 RNG Game is locked for this server. Ask the bot owner to unlock it.';
  if (policy?.enabled !== true) return 'GAG2 RNG Game is disabled for this server. Ask a server administrator to enable it.';
  return '';
}

function createInfoHandler(context) {
  function topicContext(userId) {
    let discoveries = [];
    try {
      discoveries = context.repository?.discoveries?.(String(userId)) || [];
    } catch {
      discoveries = [];
    }
    return { discoveries };
  }

  async function reject(interaction, message) {
    await interaction.reply(errorPayload(`Information unavailable\n${message}`, { ephemeral: true })).catch(() => null);
    return true;
  }

  return async function handleInfoInteraction(interaction) {
    const customId = String(interaction.customId || '');
    if (!customId.startsWith('rng:info:')) return false;
    const policy = typeof context.getGuildPolicy === 'function'
      ? context.getGuildPolicy(String(interaction.guildId || '')) || {}
      : { unlocked: true, enabled: true };
    const unavailable = featureError(policy);
    if (unavailable) return reject(interaction, unavailable);

    if (customId === INFO_SELECT_CUSTOM_ID) {
      if (!interaction.isStringSelectMenu?.()) return reject(interaction, 'That information control is malformed.');
      const topicId = String(interaction.values?.[0] || '');
      if (!TOPIC_BY_ID.has(topicId)) return reject(interaction, 'That topic no longer exists. Choose another topic.');
      await interaction.reply(topicPayload(topicId, 1, topicContext(interaction.user.id), { ephemeral: true }));
      return true;
    }

    const match = customId.match(/^rng:info:page:v(\d+):([a-z0-9-]+):(\d+)$/);
    if (!match || !interaction.isButton?.()) return reject(interaction, 'That information control is malformed.');
    if (Number(match[1]) !== INFO_MESSAGE_VERSION) {
      return reject(interaction, 'This guide control is outdated. Choose the topic again from the information message.');
    }
    if (!TOPIC_BY_ID.has(match[2])) return reject(interaction, 'That topic no longer exists. Choose another topic.');
    await interaction.update(topicPayload(
      match[2],
      Number(match[3]),
      topicContext(interaction.user.id),
      { initial: false },
    )).catch(() => null);
    return true;
  };
}

module.exports = { createInfoHandler, featureError };
