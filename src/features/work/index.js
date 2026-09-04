const { WORK_COMMANDS, parseWorkCommand } = require('./commands');
const { activeSessionPayload, cooldownPayload, ownershipDeniedPayload, settledPayload, unavailablePayload } = require('./components/builders');
const { openDatabase } = require('./repositories/database');
const { WorkRepository } = require('./repositories/workRepository');
const { WorkService } = require('./services/workService');
const { acknowledgeUpdate, sendEphemeral } = require('../shared/interactionResponses');

function configuredWirePairs(env = process.env) {
  return [10, 11, 12].map((number) => ({
    circle: { name: env[`WORK_WIRE_${number}_CIRCLE_NAME`], id: env[`WORK_WIRE_${number}_CIRCLE_ID`] },
    square: { name: env[`WORK_WIRE_${number}_SQUARE_NAME`], id: env[`WORK_WIRE_${number}_SQUARE_ID`] },
  })).filter((pair) => pair.circle.name && pair.circle.id && pair.square.name && pair.square.id);
}

function createWorkFeature(options = {}) {
  const db = options.db || openDatabase({ databasePath: options.databasePath, migrationsPath: options.migrationsPath });
  const repository = options.repository || new WorkRepository(db, { clock: options.clock });
  const editRecovered = options.editRecovered || (async () => {});
  const service = options.service || new WorkService(repository, {
    ...options,
    customWirePairs: options.customWirePairs || configuredWirePairs(options.env),
    async onTimeout(result) {
      try { await editRecovered(result.session, settledPayload(result.session, result)); }
      catch (error) { options.reportError?.(error, { kind: 'timeout-message-edit', session: result.session }); }
    },
  });
  const enabled = options.isLevelingEnabled || (() => true);
  const level = options.getLevel || (() => 0);

  async function start(source, ephemeralCooldown) {
    if (!enabled(source.guildId)) {
      await source.reply(unavailablePayload({ ephemeral: ephemeralCooldown }));
      return true;
    }
    const result = await service.start({
      guildId: source.guildId, channelId: source.channelId,
      userId: source.user?.id || source.author?.id,
      level: level(source.guildId, source.user?.id || source.author?.id),
    }, async (payload) => {
      const sent = await source.reply(payload);
      if (sent?.id) return sent.id;
      const fetched = await source.fetchReply?.();
      if (!fetched?.id) throw new Error('Discord did not return the work message ID.');
      return fetched.id;
    });
    if (result.status === 'cooldown') await source.reply(cooldownPayload(result.nextWorkAt, { ephemeral: ephemeralCooldown }));
    else if (result.status === 'active') {
      const until = result.session.deadline;
      await source.reply(activeSessionPayload(until, { ephemeral: ephemeralCooldown }));
    }
    return true;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'cs-work') return start(interaction, true);
    if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith('work:')) return false;
    const [, sessionId, action] = interaction.customId.split(':');
    const session = repository.get(sessionId);
    if (!session || session.status !== 'active') {
      await sendEphemeral(interaction, unavailablePayload({ ephemeral: true }));
      return true;
    }
    const userId = interaction.user?.id;
    const ownershipOk = session.userId === String(userId)
      && session.guildId === String(interaction.guildId)
      && session.channelId === String(interaction.channelId)
      && session.messageId === String(interaction.message?.id);
    if (!ownershipOk) {
      await sendEphemeral(interaction, ownershipDeniedPayload({ ephemeral: true }));
      return true;
    }
    if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
    const result = await service.handleAction({
      sessionId, action, userId, guildId: interaction.guildId,
      channelId: interaction.channelId, messageId: interaction.message?.id,
    });
    if (result.payload) await interaction.message.edit(result.payload);
    return true;
  }

  async function handleMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system || !parseWorkCommand(message.content)) return false;
    return start(message, false);
  }

  return {
    commands: WORK_COMMANDS, db, repository, service, handleInteraction, handleMessage,
    recover: () => service.recover(),
    close() { service.close(); if (!options.db && db.open) db.close(); },
  };
}

module.exports = { WORK_COMMANDS, configuredWirePairs, createWorkFeature, parseWorkCommand };
