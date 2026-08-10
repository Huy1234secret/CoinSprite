const { SlashCommandBuilder } = require('discord.js');
const {
  autoRollStatusPayload,
  autoRollSubmitPayload,
  balancePayload,
  errorPayload,
  indexPayload,
  inventoryPayload,
  powerUpgradePayload,
  rollPayload,
  salePayload,
  statPayload,
  textContainer,
} = require('../components/builders');
const { INDEX_MAX_PAGE, indexDiscoveryCount } = require('../services/indexRenderer');
const { createPowerUpgradeControls } = require('../services/upgradeService');
const { evaluateRngGameAccess } = require('../services/accessPolicy');

const PREFIX_ROLL = 'c!roll';
const PREFIX_COMMANDS = Object.freeze(new Map([
  ['c!roll', 'roll'],
  ['c!inventory', 'inventory'],
  ['c!sell', 'sell'],
  ['c!balance', 'balance'],
  ['c!auto roll', 'auto-roll'],
  ['c!auto-roll', 'auto-roll'],
  ['c!upgrade', 'upgrade'],
  ['c!index', 'index'],
]));
const RNG_GAME_COMMAND_NAMES = new Set(['roll', 'inventory', 'sell', 'balance', 'auto-roll', 'upgrade', 'index', 'stat']);

const RNG_GAME_COMMANDS = [
  new SlashCommandBuilder().setName('roll').setDescription('Roll a seed crop.'),
  new SlashCommandBuilder().setName('inventory').setDescription('View and manage your crop inventory.'),
  new SlashCommandBuilder().setName('sell').setDescription('Select crop instances to sell.'),
  new SlashCommandBuilder().setName('balance').setDescription('View your Sheckle balance.'),
  new SlashCommandBuilder().setName('auto-roll').setDescription('Buy and start a scheduled Auto Roll job.'),
  new SlashCommandBuilder().setName('upgrade').setDescription('View and purchase Luck or BIG crop upgrades.'),
  new SlashCommandBuilder().setName('index').setDescription('View your discovered crop Index.'),
  new SlashCommandBuilder().setName('stat').setDescription('View your all-time RNG rolling statistics.'),
].map((data) => ({ data }));

function lockedPayload(options = {}) {
  return errorPayload('Sale in progress\nFinish or deny your current sale before using another RNG/economy command.', options);
}

function autoLockedPayload(options = {}) {
  return errorPayload('Auto Roll in progress\nManual rolling and selling are unavailable until your Auto Roll ends.', options);
}

function rollErrorPayload(result, options = {}) {
  if (result.status === 'full') {
    return errorPayload(`Inventory full\nYour inventory has ${result.current} / ${result.capacity} crops. Sell crops or upgrade your inventory before rolling.`, options);
  }
  if (result.status === 'locked') return lockedPayload(options);
  if (result.status === 'auto-active') return autoLockedPayload(options);
  if (result.status === 'cooldown') {
    const seconds = Math.max(0.1, Math.ceil(result.remainingMs / 100) / 10).toFixed(1);
    return errorPayload(`Roll cooldown\nTry again in **${seconds}s**.`, options);
  }
  return errorPayload('Roll failed\nThe crop could not be rolled right now.', options);
}

function prefixSource(message) {
  let responseMessage = null;
  return {
    user: message.author,
    guildId: message.guildId,
    channelId: message.channelId,
    parentChannelId: message.channel?.parentId || message.channel?.parent?.id || '',
    member: message.member,
    async reply(payload) {
      responseMessage = await message.reply(payload);
      return responseMessage;
    },
    async editReply(payload) {
      if (responseMessage?.edit) return responseMessage.edit(payload);
      return null;
    },
    async fetchReply() {
      return responseMessage;
    },
  };
}

function createCommandHandlers(context) {
  const {
    actions,
    autoRollService,
    gameService,
    getGuildPolicy,
    indexRenderer,
    indexViews,
    inventoryViews,
    repository,
    saleSessions,
  } = context;

  async function requireAccess(source, options = {}) {
    const access = evaluateRngGameAccess(source, getGuildPolicy);
    if (access.allowed) return access;
    await source.reply(errorPayload(`Command unavailable\n${access.reason}`, options));
    return null;
  }

  async function executeRoll(source, access, options = {}) {
    const result = gameService.roll(source.user.id, {
      bypassCooldown: access.bypassCooldown,
      source: options.rollSource || 'manual',
    });
    if (result.status !== 'ok') {
      await source.reply(rollErrorPayload(result, { ephemeral: options.ephemeral }));
      return;
    }
    await source.reply(rollPayload(source.user.id, {
      seed: result.seed,
      item: result.item,
      effectiveChance: result.effectiveChance,
    }));
  }

  async function executeInventory(source) {
    const state = gameService.inventory(source.user.id);
    const view = inventoryViews.create(source.user.id);
    try {
      await source.reply(inventoryPayload(source.user, state, view));
      view.editOriginal = (payload) => source.editReply?.(payload);
    } catch (error) {
      inventoryViews.delete(view.id);
      throw error;
    }
  }

  async function executeSell(source, options = {}) {
    if (autoRollService.active(source.user.id)) {
      await source.reply(autoLockedPayload({ ephemeral: options.ephemeral }));
      return;
    }
    const state = gameService.inventory(source.user.id);
    if (!state.items.length) {
      await source.reply(errorPayload('Inventory empty\nRoll a crop before starting a sale.', { ephemeral: options.ephemeral }));
      return;
    }
    const session = saleSessions.create(source.user.id, {
      channelId: source.channelId,
    });
    if (!session) {
      await source.reply(lockedPayload({ ephemeral: options.ephemeral }));
      return;
    }
    try {
      await source.reply(salePayload(state, session));
      const message = await source.fetchReply?.().catch?.(() => null);
      session.messageId = message?.id || '';
    } catch (error) {
      saleSessions.delete(source.user.id);
      throw error;
    }
  }

  async function executeBalance(source) {
    await source.reply(balancePayload(source.user, gameService.balance(source.user.id)));
  }

  async function executeStat(source) {
    await source.reply(statPayload(source.user, gameService.statistics(source.user.id)));
  }

  async function executeAutoRoll(source, options = {}) {
    const active = autoRollService.active(source.user.id);
    if (active) {
      await source.reply(autoRollStatusPayload(active, { ephemeral: options.ephemeral }));
      return;
    }
    const action = actions.create(source.user.id, { kind: 'auto-form' });
    await source.reply(autoRollSubmitPayload(action, { ephemeral: options.ephemeral }));
  }

  async function executeUpgrade(source) {
    const player = repository.getPlayer(source.user.id);
    const controls = createPowerUpgradeControls(actions, source.user.id, player);
    await source.reply(powerUpgradePayload(source.user, player, controls));
  }

  async function executeIndex(source) {
    const view = indexViews.create(source.user.id, { maxPage: INDEX_MAX_PAGE });
    view.maxPage = INDEX_MAX_PAGE;
    try {
      await source.reply(textContainer('Loading your crop Index…'));
      const discoveries = repository.discoveries(source.user.id);
      const image = await indexRenderer.render(source.user.id, discoveries.map((entry) => entry.seedId), view.page);
      await source.editReply(indexPayload(
        source.user.id,
        indexDiscoveryCount(discoveries.map((entry) => entry.seedId)),
        view,
        image,
        { initial: false },
      ));
      view.editOriginal = (payload) => source.editReply?.(payload);
    } catch (error) {
      indexViews.delete(view.id);
      await source.editReply?.(errorPayload('Index unavailable\nThe crop page could not be rendered right now.', { initial: false })).catch?.(() => null);
      return error;
    }
  }

  async function execute(commandName, source, access, options = {}) {
    if (commandName === 'roll') return executeRoll(source, access, options);
    if (commandName === 'inventory') return executeInventory(source);
    if (commandName === 'sell') return executeSell(source, options);
    if (commandName === 'balance') return executeBalance(source);
    if (commandName === 'auto-roll') return executeAutoRoll(source, options);
    if (commandName === 'upgrade') return executeUpgrade(source);
    if (commandName === 'index') return executeIndex(source);
    if (commandName === 'stat') return executeStat(source);
    return undefined;
  }

  async function handleSlash(interaction) {
    if (!interaction.isChatInputCommand?.() || !RNG_GAME_COMMAND_NAMES.has(interaction.commandName)) return false;
    if (saleSessions.has(interaction.user.id)) {
      await interaction.reply(lockedPayload({ ephemeral: true }));
      return true;
    }
    const access = await requireAccess(interaction, { ephemeral: true });
    if (!access) return true;
    await execute(interaction.commandName, interaction, access, { ephemeral: true, rollSource: 'slash' });
    return true;
  }

  async function handlePrefix(message) {
    if (message.author?.bot) return false;
    const content = String(message.content || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const commandName = PREFIX_COMMANDS.get(content);
    if (!commandName) return false;
    const source = prefixSource(message);
    if (saleSessions.has(message.author.id)) {
      await source.reply(lockedPayload());
      return true;
    }
    const access = await requireAccess(source);
    if (!access) return true;
    await execute(commandName, source, access, { rollSource: 'prefix' });
    return true;
  }

  return { handlePrefix, handleSlash };
}

module.exports = {
  PREFIX_COMMANDS,
  PREFIX_ROLL,
  RNG_GAME_COMMANDS,
  RNG_GAME_COMMAND_NAMES,
  autoLockedPayload,
  createCommandHandlers,
  lockedPayload,
  prefixSource,
  rollErrorPayload,
};
