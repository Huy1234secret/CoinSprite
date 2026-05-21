const TIMEOUT_MS = 30_000;
const IGNORED_COMPONENT_PREFIXES = ['fish:reel:'];

const sessionsByMessageId = new Map();
const messagesByInteractionToken = new Map();

function isIgnoredComponentId(customId) {
  return IGNORED_COMPONENT_PREFIXES.some((prefix) => String(customId || '').startsWith(prefix));
}

function shouldIgnoreActionTimeout(interaction) {
  return isIgnoredComponentId(interaction?.customId);
}

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

function hasTrackableInteractiveComponents(components) {
  for (const component of components || []) {
    if (isInteractiveComponent(component) && !isIgnoredComponentId(component.custom_id)) return true;
    if (Array.isArray(component.components) && hasTrackableInteractiveComponents(component.components)) return true;
  }
  return false;
}

function messageKey(message) {
  return message?.id ? String(message.id) : null;
}

function messageComponents(message) {
  return message?.components?.map((component) => component.toJSON ? component.toJSON() : component) || [];
}

function clearSession(messageId) {
  const id = messageId ? String(messageId) : null;
  if (!id) return;
  const session = sessionsByMessageId.get(id);
  if (session?.timer) clearTimeout(session.timer);
  sessionsByMessageId.delete(id);
}

function getTrackedSessionForInteraction(interaction) {
  const messageId = interaction?.message?.id || (interaction?.token ? messagesByInteractionToken.get(interaction.token) : null);
  if (!messageId) return null;
  return sessionsByMessageId.get(String(messageId)) ?? null;
}

async function expireSession(messageId) {
  const session = sessionsByMessageId.get(messageId);
  if (!session || session.expired) return;
  session.expired = true;
  sessionsByMessageId.delete(messageId);

  const message = session.message;
  if (typeof message?.edit !== 'function') return;
  try {
    const existingComponents = messageComponents(message).length ? messageComponents(message) : session.components || [];
    if (!hasTrackableInteractiveComponents(existingComponents)) return;
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
  if (!id) return null;
  const components = messageComponents(message);
  if (!hasTrackableInteractiveComponents(components)) {
    clearSession(id);
    return null;
  }

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

async function fetchLatestInteractionMessage(interaction) {
  if (interaction?.message?.id) {
    const channel = interaction.channel || interaction.message.channel;
    const fresh = await channel?.messages?.fetch?.(interaction.message.id).catch(() => null);
    return fresh || interaction.message;
  }
  if (interaction?.fetchReply) return interaction.fetchReply().catch(() => null);
  return null;
}

async function trackInteractionReply(interaction) {
  const message = await fetchLatestInteractionMessage(interaction);
  if (!message) return null;
  if (interaction.token) messagesByInteractionToken.set(interaction.token, message.id);
  return trackMessage(message, interaction.user?.id);
}

async function rememberCommandReply(interaction) {
  await trackInteractionReply(interaction);
}

async function resetActionTimer(interaction) {
  if (shouldIgnoreActionTimeout(interaction)) return;
  const session = getTrackedSessionForInteraction(interaction);
  if (!session || session.expired) return;
  if (interaction.message) session.message = interaction.message;
  scheduleSession(session);
}

async function rejectIfExpired(interaction) {
  if (shouldIgnoreActionTimeout(interaction)) return false;
  const messageId = interaction?.message?.id || (interaction?.token ? messagesByInteractionToken.get(interaction.token) : null);
  if (!messageId) return false;
  const session = sessionsByMessageId.get(String(messageId));
  if (session && !session.expired && Date.now() <= session.expiresAt) return false;

  if (session && !session.expired) await expireSession(String(messageId));
  return Boolean(session);
}

async function refreshMessageAfterAction(interaction) {
  const message = await fetchLatestInteractionMessage(interaction);
  if (!message) return;
  trackMessage(message, interaction.user?.id);
}

module.exports = {
  TIMEOUT_MS,
  rememberCommandReply,
  resetActionTimer,
  rejectIfExpired,
  refreshMessageAfterAction,
  trackMessage,
};
