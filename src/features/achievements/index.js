const { ACHIEVEMENT_COMMANDS, parseAchievementCommand } = require('./commands');
const { achievementErrorPayload, achievementPageModal, achievementPayload } = require('./components');
const { AchievementRepository } = require('./repository');
const { AchievementService } = require('./service');
const { openDatabase } = require('../work/repositories/database');
const { acknowledgeUpdate, sendEphemeral } = require('../shared/interactionResponses');

const BUTTON_PATTERN = /^csachievements:page:(\d{16,20})$/;
const MODAL_PATTERN = /^csachievements:modal:(\d{16,20})$/;

function createAchievementFeature(options = {}) {
  const db = options.db || openDatabase({ databasePath: options.databasePath });
  const repository = options.repository || new AchievementRepository(db);
  const service = options.service || new AchievementService(repository, options.resolveEmoji);

  async function show(source, ephemeral = false) {
    const userId = String(source.user?.id || source.author?.id || '');
    if (options.isCommandAllowed && !options.isCommandAllowed(source.guildId, source.channelId, 'cs-achievements')) {
      await source.reply(achievementErrorPayload('This game command is not enabled in this channel.', {
        ephemeral: Boolean(source.isChatInputCommand?.()),
      }));
      return true;
    }
    await source.reply(achievementPayload(userId, service.page(userId, 1), { ephemeral }));
    return true;
  }

  async function deny(interaction, ownerId) {
    await sendEphemeral(interaction, achievementErrorPayload(`This achievement menu belongs to <@${ownerId}>.`, { ephemeral: true }));
    return true;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'cs-achievements') {
      if (!interaction.guildId || !interaction.user?.id) return false;
      return show(interaction);
    }
    const buttonMatch = interaction.isButton?.() ? BUTTON_PATTERN.exec(String(interaction.customId || '')) : null;
    if (buttonMatch) {
      const ownerId = buttonMatch[1];
      if (String(interaction.user?.id) !== ownerId) return deny(interaction, ownerId);
      const current = service.page(ownerId, 1);
      await interaction.showModal(achievementPageModal(ownerId, current.maxPages));
      return true;
    }
    const modalMatch = interaction.isModalSubmit?.() ? MODAL_PATTERN.exec(String(interaction.customId || '')) : null;
    if (!modalMatch) return false;
    const ownerId = modalMatch[1];
    if (String(interaction.user?.id) !== ownerId) return deny(interaction, ownerId);
    const current = service.page(ownerId, 1);
    const rawPage = String(interaction.fields.getTextInputValue('page') || '').trim();
    const validInteger = rawPage.length <= 10 && /^[1-9]\d*$/.test(rawPage);
    const requested = validInteger ? BigInt(rawPage) : 0n;
    if (!validInteger || requested > BigInt(current.maxPages)) {
      await sendEphemeral(interaction, achievementErrorPayload(`Enter a page number from 1 to ${current.maxPages}.`, { ephemeral: true }));
      return true;
    }
    if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
    await interaction.editReply(achievementPayload(ownerId, service.page(ownerId, Number(requested)), { initial: false }));
    return true;
  }

  async function handleMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system || !parseAchievementCommand(message.content)) return false;
    return show(message);
  }

  return {
    commands: ACHIEVEMENT_COMMANDS, db, repository, service, handleInteraction, handleMessage,
    close() { if (!options.db && db.open) db.close(); },
  };
}

module.exports = { BUTTON_PATTERN, ACHIEVEMENT_COMMANDS, MODAL_PATTERN, createAchievementFeature, parseAchievementCommand };
