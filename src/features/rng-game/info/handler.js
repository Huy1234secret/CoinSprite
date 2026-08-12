const { errorPayload } = require('../../shared/components');
const {
  INFO_MESSAGE_VERSION,
  commandByKey,
  commandCatalog,
} = require('./catalog');
const { commandPayload, infoMessagePayload } = require('./builders');
const { resolveRegisteredCommandIds } = require('./mentions');

const SELECT_PATTERN = new RegExp(`^rng:info:command:v${INFO_MESSAGE_VERSION}:(\\d+):(\\d+)$`);
const BROWSE_PATTERN = new RegExp(`^rng:info:browse:v${INFO_MESSAGE_VERSION}:(\\d+):(\\d+):(\\d+)$`);
const HOME_PATTERN = new RegExp(`^rng:info:home:v${INFO_MESSAGE_VERSION}:(\\d+)$`);

function featureError(policy) {
  if (policy?.unlocked !== true) return 'GAG2 RNG Game is locked for this server. Ask the bot owner to unlock it.';
  if (policy?.enabled !== true) return 'GAG2 RNG Game is disabled for this server. Ask a server administrator to enable it.';
  return '';
}

function createInfoHandler(context) {
  const commands = context.commands || commandCatalog();

  async function reject(interaction, message) {
    await interaction.reply(errorPayload(`Information unavailable\n${message}`, { ephemeral: true })).catch(() => null);
    return true;
  }

  function ownedBy(interaction, ownerId) {
    return ownerId === '0' || ownerId === String(interaction.user?.id || '');
  }

  async function payloadContext(interaction, ownerId, page) {
    const client = interaction.client || context.getClient?.() || context.client || null;
    return {
      botUserId: String(client?.user?.id || context.getBotUser?.()?.id || '0'),
      client,
      commandIds: await resolveRegisteredCommandIds(client, interaction.guildId),
      commands,
      ownerId,
      page,
    };
  }

  async function updateLanding(interaction, ownerId, page, notice = '') {
    const view = await payloadContext(interaction, ownerId, page);
    await interaction.update(infoMessagePayload(view.botUserId, { ...view, notice }, { initial: false })).catch(() => null);
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

    const selectMatch = customId.match(SELECT_PATTERN);
    if (selectMatch) {
      if (!interaction.isStringSelectMenu?.()) return reject(interaction, 'That command control is malformed.');
      const ownerId = selectMatch[1];
      if (!ownedBy(interaction, ownerId)) return reject(interaction, 'Only the player who opened this guide can control it.');
      const commandKey = String(interaction.values?.[0] || '');
      const command = commandByKey(commandKey, commands);
      const nextOwnerId = String(interaction.user?.id || ownerId);
      const view = await payloadContext(interaction, nextOwnerId, Number(selectMatch[2]));
      if (!command) {
        const payload = infoMessagePayload(view.botUserId, {
          ...view,
          notice: 'That selection is stale. Choose a current command below.',
        }, ownerId === '0' ? { ephemeral: true } : { initial: false });
        if (ownerId === '0') await interaction.reply(payload).catch(() => null);
        else await interaction.update(payload).catch(() => null);
        return true;
      }
      const payload = commandPayload(command.key, view, ownerId === '0' ? { ephemeral: true } : { initial: false });
      if (ownerId === '0') await interaction.reply(payload).catch(() => null);
      else await interaction.update(payload).catch(() => null);
      return true;
    }

    const browseMatch = customId.match(BROWSE_PATTERN);
    if (browseMatch) {
      if (!interaction.isButton?.()) return reject(interaction, 'That command control is malformed.');
      const ownerId = browseMatch[1];
      if (!ownedBy(interaction, ownerId)) return reject(interaction, 'Only the player who opened this guide can control it.');
      const page = Number(browseMatch[2]);
      const stateIndex = Number(browseMatch[3]);
      if (stateIndex <= 0) return updateLanding(interaction, ownerId, page);
      const selected = commands[stateIndex - 1];
      if (!selected) return updateLanding(interaction, ownerId, page, 'That command guide is no longer available.');
      const view = await payloadContext(interaction, ownerId, page);
      await interaction.update(commandPayload(selected.key, view, { initial: false })).catch(() => null);
      return true;
    }

    const homeMatch = customId.match(HOME_PATTERN);
    if (homeMatch) {
      if (!interaction.isButton?.()) return reject(interaction, 'That command control is malformed.');
      const ownerId = homeMatch[1];
      if (!ownedBy(interaction, ownerId)) return reject(interaction, 'Only the player who opened this guide can control it.');
      return updateLanding(interaction, ownerId, 1);
    }

    return reject(interaction, 'This guide control is malformed or outdated. Republish the information message and try again.');
  };
}

module.exports = { createInfoHandler, featureError };
