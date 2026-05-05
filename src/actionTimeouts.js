const { MessageFlags } = require('discord.js');

const TIMEOUT_MS = 30_000;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;

const sessionsByMessageId = new Map();
const messagesByInteractionToken = new Map();

function isInteractiveComponent(component) {
  return Boolean(component && [2, 3, 5, 6, 7, 8].includes(component.type));
}

function disableComponents(components) {
  return (components || []).map((component) => {
    const copy = { ...component };
    if (Array.isArray(copy.components)) copy.components = disableComponents(copy.components);
    if (isInteractiveComponent(copy)) copy.disabled = true;
    return copy;
  });
}

function hasInteractiveComponents(components) {
  for (const component of components || []) {
    if (isInteractiveComponent(component)) return true;
    if (Array.isArray(component.components) && hasInteractiveComponents(component.components)) return true;
  }
  return false;
}

function messageKey(message) {
  return message?.id ? String(message.id) : null;
}

async function expireSession(messageId) {
  const session = sessionsByMessageId.get(messageId);
  if (!session || session.expired) return;
  session.expired = true;
  sessionsByMessageId.delete(messageId);

  const message = session.message;
  if (!message?.editable && typeof message?.edit !== 'function') return;
  try {
    const existingComponents = message.components?.map((component) => component.toJSON ? component.toJSON() : component) || session.components || [];
    if (!hasInteractiveComponents(existingComponents)) return;
    await message.edit({ components: disableComponents(existingComponents) }).catch(() => null);
  } catch {
    // Ignore timeout cleanup failures. A deleted/unknown message should not crash the bot.
  }
}

function scheduleSession(session) {
  if (session.timer) clearTimeout(session.timer);
  session.expiresAt = Date.now() + TIMEOUT_MS;
  session.timer = setTimeout(() => expireSession(session.messageId), TIMEOUT_MS);
  if (typeof session.timer.unref === 'function') session.timer.unref();
}

function trackMessage(message, ownerId = null) {
  const id = messageKey(message);
  if (!id || !message?.components?.length) return null;
  const components = message.components.map((component) => component.toJSON ? component.toJSON() : component);
  if (!hasInteractiveComponents(components)) return null;

  let session = sessionsByMessageId.get(id);
  if (!session) {
    session = { messageId: id, message, ownerId, expired: false, components, timer: null, expiresAt: 0 };
    sessionsByMessageId.set(id, session);
  } else {
    session.message = message;
    session.components = components;
    session.ownerId = ownerId || session.ownerId;
    session.expired = false;
  }
  scheduleSession(session);
  return session;
}

async function trackInteractionReply(interaction) {
  if (!interaction?.fetchReply) return null;
  const message = await interaction.fetchReply().catch(() => null);
  if (!message) return null;
  if (interaction.token) messagesByInteractionToken.set(interaction.token, message.id);
  return trackMessage(message, interaction.user?.id);
}

async function trackMessageFromInteraction(interaction) {
  if (interaction?.message) return trackMessage(interaction.message, interaction.user?.id);
  if (interaction?.token && messagesByInteractionToken.has(interaction.token)) {
    const message = await interaction.fetchReply?.().catch(() => null);
    if (message) return trackMessage(message, interaction.user?.id);
  }
  return null;
}

async function rememberCommandReply(interaction) {
  await trackInteractionReply(interaction);
}

async function resetActionTimer(interaction) {
  const messageId = interaction?.message?.id || (interaction?.token ? messagesByInteractionToken.get(interaction.token) : null);
  if (!messageId) return;
  const session = sessionsByMessageId.get(String(messageId));
  if (!session || session.expired) return;
  if (interaction.message) session.message = interaction.message;
  scheduleSession(session);
}

async function rejectIfExpired(interaction) {
  const messageId = interaction?.message?.id || (interaction?.token ? messagesByInteractionToken.get(interaction.token) : null);
  if (!messageId) return false;
  const session = sessionsByMessageId.get(String(messageId));
  if (session && !session.expired && Date.now() <= session.expiresAt) return false;

  if (session && !session.expired) await expireSession(String(messageId));
  if (interaction?.isRepliable?.() && !interaction.replied && !interaction.deferred) {
    await interaction.reply({ content: 'This action expired because there was no activity for 30 seconds. Please run the command again.', flags: EPHEMERAL_FLAG }).catch(() => null);
  }
  return Boolean(session);
}

async function refreshMessageAfterAction(interaction) {
  if (interaction?.message) {
    await trackMessageFromInteraction(interaction);
    return;
  }
  await trackInteractionReply(interaction);
}

module.exports = {
  TIMEOUT_MS,
  rememberCommandReply,
  resetActionTimer,
  rejectIfExpired,
  refreshMessageAfterAction,
  trackMessage,
};
