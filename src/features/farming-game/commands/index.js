const { SlashCommandBuilder } = require('discord.js');
const { evaluateFarmingGameAccess } = require('../services/accessPolicy');
const {
  errorPayload,
  farmPayload,
  myInventoryPayload,
  textContainer,
} = require('../components/builders');

const FARMING_GAME_COMMAND_NAMES = new Set(['my-farm', 'my-inventory']);
const FARMING_GAME_COMMANDS = [
  new SlashCommandBuilder().setName('my-farm').setDescription('View and manage your nine farming plots.'),
  new SlashCommandBuilder().setName('my-inventory').setDescription('View your crop and farming-item inventories.'),
].map((data) => ({ data }));

function createFarmingCommandHandlers(context) {
  const {
    farmingService,
    farmRenderer,
    farmViews,
    getGuildPolicy,
    inventoryViews,
    refreshScheduler,
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
      const image = await farmRenderer.render(state);
      await interaction.editReply(farmPayload(interaction.user.id, state, view, image, { initial: false }));
      view.editOriginal = (payload) => interaction.editReply(payload);
      refreshScheduler?.schedule?.(view);
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
      view.editOriginal = (nextPayload) => interaction.editReply(nextPayload);
    } catch (error) {
      inventoryViews.delete(view.id);
      throw error;
    }
  }

  async function handleSlash(interaction) {
    if (!interaction.isChatInputCommand?.() || !FARMING_GAME_COMMAND_NAMES.has(interaction.commandName)) return false;
    if (!await requireAccess(interaction)) return true;
    if (interaction.commandName === 'my-farm') await executeFarm(interaction);
    else await executeInventory(interaction);
    return true;
  }

  return { handleSlash };
}

module.exports = {
  FARMING_GAME_COMMAND_NAMES,
  FARMING_GAME_COMMANDS,
  createFarmingCommandHandlers,
};
