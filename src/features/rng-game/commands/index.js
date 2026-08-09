const { SlashCommandBuilder } = require('discord.js');
const {
  balancePayload,
  errorPayload,
  inventoryPayload,
  rollPayload,
  salePayload,
} = require('../components/builders');
const { evaluateRngGameAccess } = require('../services/accessPolicy');

const PREFIX_ROLL = 'c!roll';
const RNG_GAME_COMMAND_NAMES = new Set(['roll', 'inventory', 'sell', 'balance']);

const RNG_GAME_COMMANDS = [
  new SlashCommandBuilder().setName('roll').setDescription('Roll a seed crop.'),
  new SlashCommandBuilder().setName('inventory').setDescription('View and manage your crop inventory.'),
  new SlashCommandBuilder().setName('sell').setDescription('Select crop instances to sell.'),
  new SlashCommandBuilder().setName('balance').setDescription('View your Sheckle balance.'),
].map((data) => ({ data }));

function lockedPayload(options = {}) {
  return errorPayload('Sale in progress\nFinish or deny your current sale before using another RNG/economy command.', options);
}

function rollErrorPayload(result, options = {}) {
  if (result.status === 'full') {
    return errorPayload(`Inventory full\nYour inventory has ${result.current} / ${result.capacity} crops. Sell crops or upgrade your inventory before rolling.`, options);
  }
  if (result.status === 'locked') return lockedPayload(options);
  if (result.status === 'cooldown') {
    const seconds = Math.max(0.1, Math.ceil(result.remainingMs / 100) / 10).toFixed(1);
    return errorPayload(`Roll cooldown\nTry again in **${seconds}s**.`, options);
  }
  return errorPayload('Roll failed\nThe crop could not be rolled right now.', options);
}

function createCommandHandlers(context) {
  const { gameService, getGuildPolicy, inventoryViews, saleSessions } = context;

  async function requireAccess(source, options = {}) {
    const access = evaluateRngGameAccess(source, getGuildPolicy);
    if (access.allowed) return access;
    await source.reply(errorPayload(`Command unavailable\n${access.reason}`, options));
    return null;
  }

  async function executeRoll(interaction, access) {
    const result = gameService.roll(interaction.user.id, { bypassCooldown: access.bypassCooldown });
    if (result.status !== 'ok') {
      await interaction.reply(rollErrorPayload(result, { ephemeral: true }));
      return;
    }
    await interaction.reply(rollPayload(interaction.user.id, { seed: result.seed, item: result.item }));
  }

  async function executeInventory(interaction) {
    const state = gameService.inventory(interaction.user.id);
    const view = inventoryViews.create(interaction.user.id);
    try {
      await interaction.reply(inventoryPayload(interaction.user, state, view));
      view.editOriginal = (payload) => interaction.editReply(payload);
    } catch (error) {
      inventoryViews.delete(view.id);
      throw error;
    }
  }

  async function executeSell(interaction) {
    const state = gameService.inventory(interaction.user.id);
    if (!state.items.length) {
      await interaction.reply(errorPayload('Inventory empty\nRoll a crop before starting a sale.', { ephemeral: true }));
      return;
    }
    const session = saleSessions.create(interaction.user.id, {
      interactionId: interaction.id,
      channelId: interaction.channelId,
    });
    if (!session) {
      await interaction.reply(lockedPayload({ ephemeral: true }));
      return;
    }
    try {
      await interaction.reply(salePayload(state, session));
      const message = await interaction.fetchReply?.().catch?.(() => null);
      session.messageId = message?.id || '';
    } catch (error) {
      saleSessions.delete(interaction.user.id);
      throw error;
    }
  }

  async function executeBalance(interaction) {
    await interaction.reply(balancePayload(interaction.user, gameService.balance(interaction.user.id)));
  }

  async function handleSlash(interaction) {
    if (!interaction.isChatInputCommand?.() || !RNG_GAME_COMMAND_NAMES.has(interaction.commandName)) return false;
    if (saleSessions.has(interaction.user.id)) {
      await interaction.reply(lockedPayload({ ephemeral: true }));
      return true;
    }
    const access = await requireAccess({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      member: interaction.member,
      reply: (payload) => interaction.reply(payload),
    }, { ephemeral: true });
    if (!access) return true;
    if (interaction.commandName === 'roll') await executeRoll(interaction, access);
    if (interaction.commandName === 'inventory') await executeInventory(interaction);
    if (interaction.commandName === 'sell') await executeSell(interaction);
    if (interaction.commandName === 'balance') await executeBalance(interaction);
    return true;
  }

  async function handlePrefix(message) {
    if (message.author?.bot || String(message.content || '').trim().toLowerCase() !== PREFIX_ROLL) return false;
    if (saleSessions.has(message.author.id)) {
      await message.reply(lockedPayload());
      return true;
    }
    const access = await requireAccess({
      guildId: message.guildId,
      channelId: message.channelId,
      member: message.member,
      reply: (payload) => message.reply(payload),
    });
    if (!access) return true;
    const result = gameService.roll(message.author.id, { bypassCooldown: access.bypassCooldown });
    const payload = result.status === 'ok'
      ? rollPayload(message.author.id, { seed: result.seed, item: result.item })
      : rollErrorPayload(result);
    await message.reply(payload);
    return true;
  }

  return { handlePrefix, handleSlash };
}

module.exports = {
  PREFIX_ROLL,
  RNG_GAME_COMMANDS,
  RNG_GAME_COMMAND_NAMES,
  createCommandHandlers,
  lockedPayload,
  rollErrorPayload,
};
