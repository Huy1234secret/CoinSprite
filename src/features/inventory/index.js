const { INVENTORY_COMMANDS, parseInventoryCommand } = require('./commands');
const { inventoryErrorPayload, inventoryPageModal, inventoryPayload } = require('./components/builders');
const { InventoryRepository } = require('./repositories/inventoryRepository');
const { InventoryService } = require('./services/inventoryService');
const { openDatabase } = require('../work/repositories/database');
const { acknowledgeUpdate, sendEphemeral } = require('../shared/interactionResponses');

const BUTTON_PATTERN = /^csinventory:page:(\d{16,20})$/;
const MODAL_PATTERN = /^csinventory:modal:(\d{16,20})$/;

function createInventoryFeature(options = {}) {
  const db = options.db || openDatabase({ databasePath: options.databasePath });
  const repository = options.repository || new InventoryRepository(db);
  const service = options.service || new InventoryService(repository);

  async function show(source, ephemeral = false) {
    const userId = String(source.user?.id || source.author?.id || '');
    if (options.isCommandAllowed && !options.isCommandAllowed(source.guildId, source.channelId, 'cs-inventory')) {
      await source.reply(inventoryErrorPayload('This game command is not enabled in this channel.', {
        ephemeral: Boolean(source.isChatInputCommand?.()),
      }));
      return true;
    }
    await source.reply(inventoryPayload(userId, service.page(userId, 1), { ephemeral }));
    return true;
  }

  async function deny(interaction, ownerId) {
    await sendEphemeral(interaction, inventoryErrorPayload(`This inventory menu belongs to <@${ownerId}>.`, { ephemeral: true }));
    return true;
  }

  async function handleInteraction(interaction) {
    if (interaction.isChatInputCommand?.() && interaction.commandName === 'cs-inventory') {
      if (!interaction.guildId || !interaction.user?.id) return false;
      return show(interaction);
    }
    const buttonMatch = interaction.isButton?.() ? BUTTON_PATTERN.exec(String(interaction.customId || '')) : null;
    if (buttonMatch) {
      const ownerId = buttonMatch[1];
      if (String(interaction.user?.id) !== ownerId) return deny(interaction, ownerId);
      const current = service.page(ownerId, 1);
      await interaction.showModal(inventoryPageModal(ownerId, current.maxPages));
      return true;
    }
    const modalMatch = interaction.isModalSubmit?.() ? MODAL_PATTERN.exec(String(interaction.customId || '')) : null;
    if (!modalMatch) return false;
    const ownerId = modalMatch[1];
    if (String(interaction.user?.id) !== ownerId) return deny(interaction, ownerId);
    const current = service.page(ownerId, 1);
    const rawPage = String(interaction.fields.getTextInputValue('page') || '').trim();
    const validInteger = /^[1-9]\d*$/.test(rawPage);
    const requested = validInteger ? BigInt(rawPage) : 0n;
    if (!validInteger || requested > BigInt(current.maxPages)) {
      await sendEphemeral(interaction, inventoryErrorPayload(`Enter a page number from 1 to ${current.maxPages}.`, { ephemeral: true }));
      return true;
    }
    if (!await acknowledgeUpdate(interaction, { reportError: options.reportError })) return true;
    await interaction.editReply(inventoryPayload(ownerId, service.page(ownerId, Number(requested)), { initial: false }));
    return true;
  }

  async function handleMessage(message) {
    if (!message?.guildId || message.author?.bot || message.webhookId || message.system || !parseInventoryCommand(message.content)) return false;
    return show(message);
  }

  return {
    commands: INVENTORY_COMMANDS, db, repository, service, handleInteraction, handleMessage,
    close() { if (!options.db && db.open) db.close(); },
  };
}

module.exports = { BUTTON_PATTERN, INVENTORY_COMMANDS, MODAL_PATTERN, createInventoryFeature, parseInventoryCommand };
