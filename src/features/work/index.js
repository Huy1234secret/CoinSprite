const { WORK_COMMANDS, parseWorkCommand } = require('./commands');
const {
  activeSessionPayload, cooldownPayload, ownershipDeniedPayload, settledPayload, unavailablePayload,
} = require('./components/builders');
const { openDatabase } = require('./repositories/database');
const { WorkRepository } = require('./repositories/workRepository');
const { WorkService } = require('./services/workService');
const { acknowledgeUpdate, sendEphemeral } = require('../shared/interactionResponses');

function createWorkFeature(options = {}) {
  const db = options.db || openDatabase({ databasePath: options.databasePath, migrationsPath: options.migrationsPath });
  const repository = options.repository || new WorkRepository(db, { clock: options.clock });
  const editRecovered = options.editRecovered || (async () => {});
  const service = options.service || new WorkService(repository, {
    ...options,
    async onTimeout(result) {
      try { await editRecovered(result.session, settledPayload(result.session, result)); }
      catch (error) { options.reportError?.(error, { kind: 'timeout-message-edit', session: result.session }); }
    },
  });

  async function start(source, ephemeralStatus) {
    const userId = String(source.user?.id || source.author?.id || '');
    if (!options.isCommandAllowed?.(source.guildId, source.channelId, 'cs-work') && options.isCommandAllowed) {
      await source.reply(unavailablePayload({ ephemeral: ephemeralStatus }));
      return true;
    }
    const result = await service.start({
      guildId: source.guildId, channelId: source.channelId, userId,
    }, async (payload) => {
      const sent = await source.reply(payload);
      if (sent?.id) return sent.id;
      const fetched = await source.fetchReply?.();
      if (!fetched?.id) throw new Error('Discord did not return the Work message ID.');
      return fetched.id;
    });
    if (result.status === 'cooldown') {
      await source.reply(cooldownPayload(userId, result.nextWorkAt, result.profile, { ephemeral: ephemeralStatus }));
    } else if (result.status === 'active') {
      await source.reply(activeSessionPayload(userId, result.session, result.profile, { ephemeral: ephemeralStatus }));
    }
    return true;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'cs-work') {
      if (!interaction.guildId || !interaction.user?.id) return false;
      return start(interaction, true);
    }
    if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith('cswork:')) return false;
    const parts = String(interaction.customId).split(':');
    if (parts.length !== 3) return false;
    const [, sessionId, action] = parts;
    const session = repository.get(sessionId);
    if (!session) {
      await sendEphemeral(interaction, unavailablePayload({ ephemeral: true }));
      return true;
    }
    const ownershipOk = session.userId === String(interaction.user?.id)
      && session.guildId === String(interaction.guildId)
      && session.channelId === String(interaction.channelId)
      && session.messageId === String(interaction.message?.id);
    if (!ownershipOk) {
      await sendEphemeral(interaction, ownershipDeniedPayload({ ephemeral: true }));
      return true;
    }
    if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
    if (action === 'back') {
      const profile = repository.profile(session.userId);
      await interaction.message.edit(cooldownPayload(session.userId, profile.cooldownUntil, profile, { initial: false }));
      return true;
    }
    if (session.status !== 'active') {
      const result = { changed: false, session, profile: repository.profile(session.userId), reason: session.failureReason };
      await interaction.message.edit(settledPayload(session, result));
      return true;
    }
    const result = await service.handleAction({
      sessionId, action, userId: interaction.user.id, guildId: interaction.guildId,
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

module.exports = { WORK_COMMANDS, createWorkFeature, parseWorkCommand };
