const { SlashCommandBuilder } = require('discord.js');
const { evaluateFarmingGameAccess } = require('../services/accessPolicy');
const {
  errorPayload,
  farmPayload,
  farmingBalancePayload,
  farmingIndexPayload,
  farmingSalePayload,
  myInventoryPayload,
  textContainer,
} = require('../components/builders');

const FARMING_GAME_COMMAND_NAMES = new Set(['my-farm', 'my-inventory', 'sell-crop', 'my-balance', 'my-index']);
const FARMING_GAME_COMMANDS = [
  new SlashCommandBuilder().setName('my-farm').setDescription('View and manage your nine farming plots.'),
  new SlashCommandBuilder().setName('my-inventory').setDescription('View your crop and farming-item inventories.'),
  new SlashCommandBuilder().setName('sell-crop').setDescription('Select harvested Farming crops to sell.'),
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
    await interaction.reply(farmingBalancePayload(interaction.user, farmingService.balance(interaction.user.id)));
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

  return { handleSlash };
}

module.exports = {
  FARMING_GAME_COMMAND_NAMES,
  FARMING_GAME_COMMANDS,
  createFarmingCommandHandlers,
  farmingSaleLockedPayload,
};
