const { SlashCommandBuilder } = require('discord.js');
const { randomUUID } = require('crypto');
const { evaluateFarmingGameAccess } = require('../services/accessPolicy');
const { ITEMS, getItem } = require('../data/items');
const {
  errorPayload,
  farmPayload,
  farmingBalancePayload,
  farmingDirectSalePayload,
  farmingIndexPayload,
  farmingSalePayload,
  myInventoryPayload,
  textContainer,
} = require('../components/builders');

const FARMING_GAME_COMMAND_NAMES = new Set(['my-farm', 'my-inventory', 'sell-crop', 'my-balance', 'my-index']);
const sellCropCommand = new SlashCommandBuilder()
  .setName('sell-crop')
  .setDescription('Sell harvested crops from your Farming inventory.')
  .addStringOption((option) => option
    .setName('crop')
    .setDescription('Harvested Farming crop to sell.')
    .setAutocomplete(true))
  .addStringOption((option) => option
    .setName('quantity')
    .setDescription('Positive whole number or all.'));
const FARMING_GAME_COMMANDS = [
  new SlashCommandBuilder().setName('my-farm').setDescription('View and manage your nine farming plots.'),
  new SlashCommandBuilder().setName('my-inventory').setDescription('View your crop and farming-item inventories.'),
  sellCropCommand,
  new SlashCommandBuilder().setName('my-balance').setDescription('View your Farming currency balance.'),
  new SlashCommandBuilder().setName('my-index').setDescription('View your Farming seed and crop Index.'),
].map((data) => ({ data }));

function farmingSaleLockedPayload(options = {}) {
  return errorPayload('Sale in progress\nFinish or deny your current Farming crop sale first.', options);
}

function createFarmingCommandHandlers(context) {
  const {
    farmingService,
    farmRenderer,
    farmViews,
    getGuildPolicy,
    indexRenderer,
    indexViews,
    inventoryViews,
    saleSessions,
    upgradeViews,
  } = context;

  async function requireAccess(interaction) {
    const access = evaluateFarmingGameAccess(interaction, getGuildPolicy);
    if (access.allowed) return true;
    await interaction.reply(errorPayload(`Command unavailable\n${access.reason}`, { ephemeral: true }));
    return false;
  }

  async function executeFarm(interaction) {
    farmingService.ensureProfile(interaction.user.id);
    const view = farmViews.createFarm(interaction.user.id);
    try {
      await interaction.reply(textContainer('Loading your farm…'));
      const state = farmingService.farmState(interaction.user.id);
      const image = await farmRenderer.render(state, {
        selectedPlotNumbers: [...view.selectedPlots],
      });
      await interaction.editReply(farmPayload(interaction.user.id, state, view, image, { initial: false }));
    } catch (error) {
      farmViews.delete(view.id);
      await interaction.editReply?.(errorPayload('Farm unavailable\nThe farm could not be rendered right now.', { initial: false })).catch?.(() => null);
      return error;
    }
    return null;
  }

  async function executeInventory(interaction) {
    farmingService.ensureProfile(interaction.user.id);
    const view = inventoryViews.createInventory(interaction.user.id);
    try {
      const payload = myInventoryPayload(
        interaction.user,
        farmingService.inventory(interaction.user.id),
        view,
      );
      await interaction.reply(payload);
    } catch (error) {
      inventoryViews.delete(view.id);
      throw error;
    }
  }

  async function executeSale(interaction) {
    const inventory = farmingService.inventory(interaction.user.id);
    if (!inventory.crops.length) {
      await interaction.reply(errorPayload('Farming inventory empty\nHarvest a crop before starting a sale.', { ephemeral: true }));
      return;
    }
    const cropOption = interaction.options?.getString?.('crop')?.trim() || '';
    const quantityOption = interaction.options?.getString?.('quantity')?.trim().toLowerCase() || '';
    if (quantityOption && !cropOption) {
      await interaction.reply(errorPayload('Crop required\nChoose an owned Farming crop before entering a quantity.', { ephemeral: true }));
      return;
    }
    if (cropOption) {
      const item = getItem(cropOption);
      if (!item || item.inventoryCategory !== 'crops') {
        await interaction.reply(errorPayload('Unknown crop\nChoose a harvested crop from autocomplete.', { ephemeral: true }));
        return;
      }
      const quantityText = quantityOption || 'all';
      if (quantityText !== 'all' && (!/^[1-9]\d*$/.test(quantityText) || quantityText.length > 1_000)) {
        await interaction.reply(errorPayload('Invalid quantity\nEnter a positive whole number or `all`.', { ephemeral: true }));
        return;
      }
      const quantity = quantityText === 'all' ? null : BigInt(quantityText);
      const result = farmingService.sellCropQuantity(
        interaction.user.id,
        item.id,
        quantity,
        interaction.id || randomUUID(),
      );
      if (result.status !== 'ok') {
        const message = result.status === 'insufficient'
          ? `You own only **${result.available}** harvested ${item.name}${result.available === 1n ? '' : 's'}.`
          : result.status === 'empty'
            ? `You do not own a harvested ${item.name}.`
            : 'The crop or quantity is no longer valid.';
        await interaction.reply(errorPayload(`Sale unavailable\n${message}`, { ephemeral: true }));
        return;
      }
      await interaction.reply(farmingDirectSalePayload(
        item, result.itemCount, result.total, result.balance,
      ));
      return;
    }
    const session = saleSessions.create(interaction.user.id);
    if (!session) {
      await interaction.reply(farmingSaleLockedPayload({ ephemeral: true }));
      return;
    }
    try {
      await interaction.reply(farmingSalePayload(inventory, session));
      const message = interaction.fetchReply ? await interaction.fetchReply().catch(() => null) : null;
      session.messageId = message?.id || '';
    } catch (error) {
      saleSessions.delete(interaction.user.id);
      throw error;
    }
  }

  async function executeBalance(interaction) {
    const view = upgradeViews.createUpgrade(interaction.user.id);
    await interaction.reply(farmingBalancePayload(
      interaction.user,
      farmingService.profile(interaction.user.id),
      view,
    ));
  }

  async function executeIndex(interaction) {
    const state = farmingService.indexState(interaction.user.id);
    const view = indexViews.createIndex(interaction.user.id, { maxPage: state.entries.length });
    try {
      await interaction.reply(textContainer('Loading your Farming Index…'));
      const image = await indexRenderer.render(state.entries[view.page - 1]);
      await interaction.editReply(farmingIndexPayload(interaction.user.id, view, image, { initial: false }));
    } catch (error) {
      indexViews.delete(view.id);
      await interaction.editReply?.(errorPayload('Index unavailable\nThe Farming Index could not be rendered right now.', { initial: false })).catch?.(() => null);
      return error;
    }
    return null;
  }

  async function handleSlash(interaction) {
    if (!interaction.isChatInputCommand?.() || !FARMING_GAME_COMMAND_NAMES.has(interaction.commandName)) return false;
    if (saleSessions.has(interaction.user.id)) {
      await interaction.reply(farmingSaleLockedPayload({ ephemeral: true }));
      return true;
    }
    if (!await requireAccess(interaction)) return true;
    if (interaction.commandName === 'my-farm') await executeFarm(interaction);
    else if (interaction.commandName === 'my-inventory') await executeInventory(interaction);
    else if (interaction.commandName === 'sell-crop') await executeSale(interaction);
    else if (interaction.commandName === 'my-balance') await executeBalance(interaction);
    else await executeIndex(interaction);
    return true;
  }

  async function handleAutocomplete(interaction) {
    if (!interaction.isAutocomplete?.() || interaction.commandName !== 'sell-crop') return false;
    const access = evaluateFarmingGameAccess(interaction, getGuildPolicy);
    if (!access.allowed) {
      await interaction.respond([]).catch(() => null);
      return true;
    }
    const ownedIds = new Set(farmingService.inventory(interaction.user.id).crops.map((crop) => crop.cropId));
    const focused = String(interaction.options?.getFocused?.() || '').trim().toLocaleLowerCase('en-US');
    const choices = ITEMS.filter((item) => (
      item.inventoryCategory === 'crops'
      && ownedIds.has(item.id)
      && (!focused || item.name.toLocaleLowerCase('en-US').includes(focused))
    )).slice(0, 25).map((item) => ({ name: item.name, value: item.id }));
    await interaction.respond(choices).catch(() => null);
    return true;
  }

  return { handleAutocomplete, handleSlash };
}

module.exports = {
  FARMING_GAME_COMMAND_NAMES,
  FARMING_GAME_COMMANDS,
  createFarmingCommandHandlers,
  farmingSaleLockedPayload,
};
