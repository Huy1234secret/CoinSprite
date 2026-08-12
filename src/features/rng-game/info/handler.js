const { errorPayload } = require('../../shared/components');
const {
  INFO_MESSAGE_VERSION,
  commandByKey,
  commandCatalog,
} = require('./catalog');
const { commandPayload, infoMessagePayload } = require('./builders');
const { resolveCachedCommandIds } = require('./mentions');
const {
  acknowledgeEphemeral,
  acknowledgeUpdate,
  completeEphemeral,
} = require('../../shared/interactionResponses');

const SELECT_PATTERN = new RegExp(`^rng:info:command:v${INFO_MESSAGE_VERSION}:(\\d+):(\\d+)$`);
const BROWSE_PATTERN = new RegExp(`^rng:info:browse:v${INFO_MESSAGE_VERSION}:(\\d+):(\\d+):(\\d+):(\\d+)$`);
const DETAIL_PATTERN = new RegExp(`^rng:info:detail:v${INFO_MESSAGE_VERSION}:(\\d+):(\\d+):(\\d+):(\\d+)$`);
const HOME_PATTERN = new RegExp(`^rng:info:home:v${INFO_MESSAGE_VERSION}:(\\d+)$`);

function featureError(policy) {
  if (policy?.unlocked !== true) return 'GAG2 RNG Game is locked for this server. Ask the bot owner to unlock it.';
  if (policy?.enabled !== true) return 'GAG2 RNG Game is disabled for this server. Ask a server administrator to enable it.';
  return '';
}

function createInfoHandler(context) {
  const commands = context.commands || commandCatalog();
  const buildCommandPayload = context.buildCommandPayload || commandPayload;
  const buildInfoMessagePayload = context.buildInfoMessagePayload || infoMessagePayload;

  async function reject(interaction, message) {
    await completeEphemeral(interaction, errorPayload(`Information unavailable\n${message}`, { ephemeral: true }));
    return true;
  }

  function ownedBy(interaction, ownerId) {
    return ownerId === '0' || ownerId === String(interaction.user?.id || '');
  }

  function payloadContext(interaction, ownerId, selectorPage) {
    const client = interaction.client || context.getClient?.() || context.client || null;
    return {
      botUserId: String(client?.user?.id || context.getBotUser?.()?.id || '0'),
      client,
      // Interaction callbacks have a short acknowledgement window. Command registration
      // performs the network work at startup; controls use only that populated cache and
      // safely fall back to plain slash syntax if an ID is temporarily unavailable.
      commandIds: resolveCachedCommandIds(client, interaction.guildId),
      commands,
      ownerId,
      selectorPage,
    };
  }

  async function updateLanding(interaction, ownerId, selectorPage, notice = '', acknowledgement = {}) {
    if (!await acknowledgeUpdate(interaction, acknowledgement)) return true;
    const view = payloadContext(interaction, ownerId, selectorPage);
    await interaction.editReply(await buildInfoMessagePayload(view.botUserId, { ...view, notice }, { initial: false }));
    return true;
  }

  return async function handleInfoInteraction(interaction) {
    const startedAt = Date.now();
    const acknowledgement = { reportError: context.reportError, startedAt };
    const customId = String(interaction.customId || '');
    if (!customId.startsWith('rng:info:')) return false;
    try {
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
        const commandKey = String(interaction.values?.[0] ?? '');
        const command = commandByKey(commandKey, commands);
        const nextOwnerId = String(interaction.user?.id || ownerId);
        const acknowledged = ownerId === '0'
          ? await acknowledgeEphemeral(interaction, acknowledgement)
          : await acknowledgeUpdate(interaction, acknowledgement);
        if (!acknowledged) return true;
        const view = payloadContext(interaction, nextOwnerId, Number(selectMatch[2]));
        if (!command) {
          const payload = await buildInfoMessagePayload(view.botUserId, {
            ...view,
            notice: 'That selection is not a supported RNG command. Choose a current command below.',
          }, ownerId === '0' ? {} : { initial: false });
          await interaction.editReply(payload);
          return true;
        }
        const payload = await buildCommandPayload(command.key, view, ownerId === '0' ? {} : { initial: false });
        await interaction.editReply(payload);
        return true;
      }

      const browseMatch = customId.match(BROWSE_PATTERN);
      if (browseMatch) {
        if (!interaction.isButton?.()) return reject(interaction, 'That command control is malformed.');
        const ownerId = browseMatch[1];
        if (!ownedBy(interaction, ownerId)) return reject(interaction, 'Only the player who opened this guide can control it.');
        const page = Number(browseMatch[2]);
        const stateIndex = Number(browseMatch[3]);
        const guidePage = Number(browseMatch[4]);
        if (stateIndex <= 0) return updateLanding(interaction, ownerId, page, '', acknowledgement);
        const selected = commands[stateIndex - 1];
        if (!selected) return updateLanding(interaction, ownerId, page, 'That command guide is no longer available.', acknowledgement);
        if (!await acknowledgeUpdate(interaction, acknowledgement)) return true;
        const view = payloadContext(interaction, ownerId, page);
        await interaction.editReply(await buildCommandPayload(selected.key, { ...view, guidePage }, { initial: false }));
        return true;
      }

      const detailMatch = customId.match(DETAIL_PATTERN);
      if (detailMatch) {
        if (!interaction.isButton?.()) return reject(interaction, 'That command control is malformed.');
        const ownerId = detailMatch[1];
        if (!ownedBy(interaction, ownerId)) return reject(interaction, 'Only the player who opened this guide can control it.');
        const stateIndex = Number(detailMatch[2]);
        const guidePage = Number(detailMatch[3]);
        const selectorPage = Number(detailMatch[4]);
        const selected = commands[stateIndex - 1];
        if (!selected) return updateLanding(interaction, ownerId, selectorPage, 'That command guide is no longer available.', acknowledgement);
        if (!await acknowledgeUpdate(interaction, acknowledgement)) return true;
        const view = payloadContext(interaction, ownerId, selectorPage);
        await interaction.editReply(await buildCommandPayload(selected.key, { ...view, guidePage }, { initial: false }));
        return true;
      }

      const homeMatch = customId.match(HOME_PATTERN);
      if (homeMatch) {
        if (!interaction.isButton?.()) return reject(interaction, 'That command control is malformed.');
        const ownerId = homeMatch[1];
        if (!ownedBy(interaction, ownerId)) return reject(interaction, 'Only the player who opened this guide can control it.');
        return updateLanding(interaction, ownerId, 1, '', acknowledgement);
      }

      return reject(interaction, 'This guide control is malformed or outdated. Republish the information message and try again.');
    } catch (error) {
      try {
        await completeEphemeral(interaction, errorPayload(
          'Information unavailable\nCoinSprite could not finish this guide. Try the selection again.',
          { ephemeral: true },
        ));
      } catch {
        // Preserve the original validation error for the interaction diagnostic.
      }
      throw error;
    }
  };
}

module.exports = { createInfoHandler, featureError };
