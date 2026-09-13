const { openDatabase } = require('../work/repositories/database');
const { acknowledgeUpdate, sendEphemeral } = require('../shared/interactionResponses');
const { BEG_COMMANDS, parseBegCommand } = require('./commands');
const {
  activeMenuPayload, cooldownPayload, expiredPayload, invalidApproachPayload,
  menuPayload, outcomePayload, ownershipDeniedPayload, unavailablePayload,
} = require('./components');
const { migrateBeg } = require('./migrate');
const { BegRepository, sameContext } = require('./repository');
const { BegService } = require('./service');

function createBegFeature(options = {}) {
  const ownsDatabase = !options.db;
  const db = options.db || openDatabase({ databasePath: options.databasePath });
  migrateBeg(db, options.migrationsPath);
  const repository = options.repository || new BegRepository(db, options);
  const service = options.service || new BegService(repository, options);

  async function start(source, startOptions = {}) {
    const userId = String(source.user?.id || source.author?.id || '');
    const ephemeral = Boolean(source.isChatInputCommand?.());
    if (options.isCommandAllowed && !options.isCommandAllowed(source.guildId, source.channelId, 'cs-beg')) {
      await source.reply(unavailablePayload({ ephemeral }));
      return true;
    }
    const result = service.open({
      userId, guildId: source.guildId, channelId: source.channelId,
      bypassCooldown: startOptions.bypassCooldown === true,
    });
    if (result.status === 'cooldown') {
      await source.reply(cooldownPayload(userId, result.nextBegAt, { ephemeral }));
      return true;
    }
    if (result.status === 'active') {
      await source.reply(activeMenuPayload(userId, result.session, { ephemeral }));
      return true;
    }
    try {
      const sent = await source.reply(menuPayload(result.session));
      const message = source.isChatInputCommand?.() ? await source.fetchReply() : sent;
      if (!message?.id) throw new Error('Discord did not return the Beg message ID.');
      repository.attachMessage(result.session.sessionId, message.id);
    } catch (error) {
      repository.abort(result.session.sessionId);
      throw error;
    }
    return true;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'cs-beg') {
      if (!interaction.guildId || !interaction.user?.id) return false;
      return start(interaction);
    }
    if (!interaction.isButton?.() || !String(interaction.customId || '').startsWith('csbeg:')) return false;
    const parts = String(interaction.customId).split(':');
    if (parts.length !== 3 || parts[0] !== 'csbeg' || !parts[1] || !parts[2]) return false;
    if (!interaction.guildId || !interaction.user?.id) return false;
    const [, sessionId, approachId] = parts;
    if (options.isCommandAllowed && !options.isCommandAllowed(interaction.guildId, interaction.channelId, 'cs-beg')) {
      await sendEphemeral(interaction, unavailablePayload({ ephemeral: true }));
      return true;
    }
    const context = {
      userId: interaction.user.id, guildId: interaction.guildId,
      channelId: interaction.channelId, messageId: interaction.message?.id,
    };
    const session = repository.session(sessionId);
    if (!session || !sameContext(session, context)) {
      await sendEphemeral(interaction, ownershipDeniedPayload({ ephemeral: true }));
      return true;
    }
    if (!session.offeredApproachIds.includes(approachId)) {
      await sendEphemeral(interaction, invalidApproachPayload({ ephemeral: true }));
      return true;
    }
    if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
    const result = service.resolve({ sessionId, approachId, ...context });
    if (result.status === 'settled') {
      await interaction.message.edit(outcomePayload(result, { initial: false }));
    } else if (result.status === 'cooldown') {
      await interaction.message.edit(cooldownPayload(interaction.user.id, result.nextBegAt, { initial: false }));
    } else if (result.status === 'invalid-approach') {
      await sendEphemeral(interaction, invalidApproachPayload({ ephemeral: true }));
    } else {
      await interaction.message.edit(expiredPayload({ initial: false }));
    }
    return true;
  }

  async function handleMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system
      || !parseBegCommand(message.content)) return false;
    return start(message);
  }

  async function handleOwnerTestMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system
      || !parseBegCommand(message.content)) return false;
    return start(message, { bypassCooldown: true });
  }

  return {
    commands: BEG_COMMANDS, db, repository, service,
    handleInteraction, handleMessage, handleOwnerTestMessage,
    close() { if (ownsDatabase && db.open) db.close(); },
  };
}

module.exports = { BEG_COMMANDS, createBegFeature, parseBegCommand };
