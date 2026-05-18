const DISCORD_MESSAGE_LINK_PATTERN = /^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)\/(\d+)(?:\?.*)?$/i;
const MESSAGE_ID_PATTERN = /^\d{16,25}$/;

function parseMessageReferenceInput(value) {
  const input = String(value || '').trim();
  if (!input) return null;

  if (MESSAGE_ID_PATTERN.test(input)) {
    return { messageId: input, channelId: null, guildId: null, raw: input };
  }

  const linkMatch = input.match(DISCORD_MESSAGE_LINK_PATTERN);
  if (!linkMatch) return null;

  const [, guildId, channelId, messageId] = linkMatch;
  return {
    messageId,
    channelId,
    guildId: guildId === '@me' ? null : guildId,
    raw: input,
  };
}

function getReferencedMessageId(interaction) {
  const directReference = interaction.reference?.messageId
    ?? interaction.messageReference?.messageId
    ?? interaction.message?.reference?.messageId
    ?? interaction.message?.messageReference?.messageId
    ?? interaction.data?.message_reference?.message_id
    ?? interaction.raw?.message_reference?.message_id
    ?? null;

  if (directReference) return directReference;

  const targetMessageId = interaction.targetMessage?.id ?? interaction.targetId ?? null;
  if (targetMessageId) return targetMessageId;

  return null;
}

async function resolveTargetChannel(interaction, parsedReference, fallbackChannel) {
  if (!parsedReference?.channelId || parsedReference.channelId === fallbackChannel?.id) return fallbackChannel;
  if (parsedReference.guildId && parsedReference.guildId !== interaction.guildId) return null;

  return interaction.guild?.channels?.fetch(parsedReference.channelId).catch(() => null) ?? null;
}

async function fetchReplyTarget(interaction, fallbackChannel, explicitReferenceInput = '') {
  const explicitReference = parseMessageReferenceInput(explicitReferenceInput);
  const detectedMessageId = getReferencedMessageId(interaction);

  if (!explicitReference && !detectedMessageId) return null;

  const reference = explicitReference ?? {
    messageId: detectedMessageId,
    channelId: fallbackChannel?.id ?? null,
    guildId: interaction.guildId ?? null,
    raw: detectedMessageId,
  };

  const targetChannel = await resolveTargetChannel(interaction, reference, fallbackChannel);
  if (!targetChannel?.isTextBased?.()) return { id: reference.messageId, channel: targetChannel, message: null, invalidChannel: true };

  const targetMessage = await targetChannel.messages.fetch(reference.messageId).catch(() => null);
  if (!targetMessage) return { id: reference.messageId, channel: targetChannel, message: null };

  return { id: reference.messageId, channel: targetChannel, message: targetMessage };
}

module.exports = {
  MESSAGE_ID_PATTERN,
  fetchReplyTarget,
  getReferencedMessageId,
  parseMessageReferenceInput,
};
