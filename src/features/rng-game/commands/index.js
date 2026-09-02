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
const { EXCHANGE_SHECKLES_PER_TOKEN } = require('../repositories/tokenRepository');
const {
  exchangePreviewPayload,
  initialRpsPayload,
} = require('../components/rpsBuilders');
const {
  rouletteBettingPayload,
  rouletteRenderFailurePayload,
} = require('../components/rouletteBuilders');
const { ITEMS, ITEM_BY_ID } = require('../data/items');
const {
  eggOpeningPayload,
  hatchedPetsPayload,
  itemUseError,
  shopPayload,
  useResultPayload,
} = require('../components/itemBuilders');

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
  ['c!stat', 'stat'],
  ['c!shop', 'shop'],
]));
const RNG_GAME_COMMAND_NAMES = new Set([
  'roll', 'inventory', 'sell', 'balance', 'auto-roll', 'upgrade', 'index', 'stat',
  'exchange-token', 'g-rps', 'g-roulette', 'shop', 'use',
]);

const RNG_GAME_COMMANDS = [
  new SlashCommandBuilder().setName('roll').setDescription('Roll a seed crop.'),
  new SlashCommandBuilder().setName('inventory').setDescription('View and manage your crop inventory.'),
  new SlashCommandBuilder().setName('sell').setDescription('Select crop instances to sell.'),
  new SlashCommandBuilder().setName('balance').setDescription('View your Sheckle and token balances.'),
  new SlashCommandBuilder().setName('auto-roll').setDescription('Buy and start a scheduled Auto Roll job.'),
  new SlashCommandBuilder().setName('upgrade').setDescription('View and purchase Luck or BIG crop upgrades.'),
  new SlashCommandBuilder().setName('index').setDescription('View your discovered crop Index.'),
  new SlashCommandBuilder().setName('stat').setDescription('View your all-time RNG rolling statistics.'),
  new SlashCommandBuilder().setName('shop').setDescription('Browse the globally restocked item shop.'),
  new SlashCommandBuilder()
    .setName('use')
    .setDescription('Use an item from your item inventory.')
    .addStringOption((option) => option
      .setName('item')
      .setDescription('Item to use.')
      .setRequired(true)
      .addChoices(...ITEMS.map((item) => ({ name: item.displayName, value: item.id }))))
    .addIntegerOption((option) => option
      .setName('amount')
      .setDescription('Amount to use (defaults to 1).')
      .setRequired(false)
      .setMinValue(1)),
  new SlashCommandBuilder()
    .setName('exchange-token')
    .setDescription('Exchange Sheckles for RPS tokens (1 token per 1,000 Sheckles).')
    .addIntegerOption((option) => option
      .setName('amount-token')
      .setDescription('Token value to receive (up to 100 per four hours).')
      .setRequired(true)
      .setMinValue(1)
      .setMaxValue(100)),
  new SlashCommandBuilder().setName('g-rps').setDescription('Play Rock-Paper-Scissors with tokens.'),
  new SlashCommandBuilder().setName('g-roulette').setDescription('Play European Roulette with tokens.'),
].map((data) => ({ data }));

function discordProfile(source) {
  const member = source.member;
  const user = source.user;
  const avatarOwner = member && typeof member.displayAvatarURL === 'function' ? member : user;
  return {
    userId: String(user.id),
    displayName: String(member?.displayName || user.globalName || user.username || 'Player'),
    avatarUrl: typeof avatarOwner?.displayAvatarURL === 'function'
      ? avatarOwner.displayAvatarURL({ extension: 'png', size: 256 })
      : '',
  };
}

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

const PREFIX_USE_ITEMS = Object.freeze([...ITEMS].sort((left, right) => (
  right.displayName.length - left.displayName.length
)));

function parsePrefixUse(content) {
  const raw = String(content || '').trim().replace(/\s+/g, ' ');
  if (!/^c!use(?:\s|$)/i.test(raw)) return null;
  const argument = raw.replace(/^c!use\s*/i, '');
  const lower = argument.toLowerCase();
  const item = PREFIX_USE_ITEMS.find((candidate) => {
    const name = candidate.displayName.toLowerCase();
    return lower === name || lower.startsWith(`${name} `);
  });
  if (!item) return { status: 'invalid', usage: 'c!use <item name> [amount]' };
  const remainder = argument.slice(item.displayName.length).trim();
  if (remainder && !/^[1-9]\d*$/.test(remainder)) {
    return { status: 'invalid', usage: `c!use ${item.displayName} [amount]` };
  }
  try {
    const amount = remainder ? BigInt(remainder) : 1n;
    if (amount > 9_223_372_036_854_775_807n) throw new RangeError('amount overflow');
    return { status: 'ok', itemId: item.id, amount };
  } catch {
    return { status: 'invalid', usage: `c!use ${item.displayName} [amount]` };
  }
}

function prefixSource(message) {
  let responseMessage = null;
  return {
    id: message.id,
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
    itemRepository,
    inventoryViews,
    repository,
    rpsService,
    rouletteRenderer,
    rouletteService,
    saleSessions,
    shopService,
    shopViews,
    tokenRepository,
    hatchDelay,
    reportError,
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
    const state = {
      crops: gameService.inventory(source.user.id),
      itemInventory: itemRepository.itemInventory(source.user.id),
      boosts: itemRepository.activeBoosts(source.user.id),
      pets: itemRepository.petState(source.user.id),
    };
    const view = inventoryViews.create(source.user.id, { type: 'crops' });
    try {
      await source.reply(inventoryPayload(source.user, state, view));
      view.editOriginal = (payload) => source.editReply?.(payload);
    } catch (error) {
      inventoryViews.delete(view.id);
      throw error;
    }
  }

  async function executeShop(source) {
    const view = shopViews.create(source.user.id, { page: 1 });
    try {
      await source.reply(textContainer('Loading the item shop\u2026'));
      const page = await shopService.page(source.user.id, view.page);
      await source.editReply(shopPayload(page, view, { initial: false }));
      view.editOriginal = (payload) => source.editReply?.(payload);
    } catch (error) {
      shopViews.delete(view.id);
      throw error;
    }
  }

  async function executeUse(source, options = {}) {
    const itemId = options.itemId || source.options?.getString?.('item', true);
    const item = ITEM_BY_ID.get(String(itemId || ''));
    let amount;
    try {
      amount = options.amount ?? BigInt(source.options?.getInteger?.('amount') ?? 1);
      amount = BigInt(amount);
    } catch {
      amount = 0n;
    }
    if (!item || amount < 1n) {
      await source.reply(errorPayload(
        `Invalid item or amount\nUsage: \`${options.usage || '/use item:<item> amount:<optional>'}\`. Item names may contain spaces.`,
        { ephemeral: options.ephemeral },
      ));
      return;
    }
    const operationKey = `use:${source.id || options.operationId || `${source.user.id}:${Date.now()}`}`;
    let result;
    try {
      result = itemRepository.use(source.user.id, item.id, amount, operationKey);
    } catch (error) {
      if (error instanceof RangeError) {
        await source.reply(errorPayload(`Invalid amount\n${error.message}`, { ephemeral: options.ephemeral }));
        return;
      }
      throw error;
    }
    if (result.status !== 'ok') {
      await source.reply(itemUseError(result, { ephemeral: options.ephemeral }));
      return;
    }
    if (result.kind !== 'egg') {
      await source.reply(useResultPayload(item, result, { ephemeral: options.ephemeral }));
      return;
    }
    const instances = result.pets || [];
    await source.reply(eggOpeningPayload(item, instances, { ephemeral: options.ephemeral }));
    await hatchDelay(5_000);
    try {
      await source.editReply?.(hatchedPetsPayload(instances, { initial: false }));
    } catch (error) {
      reportError?.(error, { kind: 'egg-animation-edit', userId: String(source.user.id) });
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
    await source.reply(balancePayload(source.user, repository.getPlayer(source.user.id)));
  }

  async function executeExchangeToken(source) {
    const amount = BigInt(source.options?.getInteger?.('amount-token', true) ?? 0);
    const allowance = tokenRepository.windowStatus(source.user.id);
    if (amount < 1n || amount > allowance.remaining) {
      await source.reply(errorPayload(
        `Exchange limit\nYou can exchange **${allowance.remaining}** more token value during the current rolling four-hour window.`,
        { ephemeral: true },
      ));
      return;
    }
    const sheckleCost = amount * EXCHANGE_SHECKLES_PER_TOKEN;
    const player = repository.getPlayer(source.user.id);
    const action = actions.create(source.user.id, {
      kind: 'token-exchange',
      tokenAmount: amount,
      sheckleCost,
    });
    await source.reply(exchangePreviewPayload(
      source.user.id,
      amount,
      sheckleCost,
      action,
      player.balance >= sheckleCost,
    ));
  }

  async function executeRps(source) {
    const result = rpsService.createGame(source.guildId, source.channelId, discordProfile(source));
    if (result.status === 'already-active') {
      await source.reply(errorPayload('RPS game already active\nFinish or wait for your current table to expire.', { ephemeral: true }));
      return;
    }
    await source.reply(initialRpsPayload(result.game));
    const message = await source.fetchReply?.().catch?.(() => null);
    if (message?.id) rpsService.repository.setMessage(result.game.id, message.id);
  }

  async function executeRoulette(source) {
    const result = rouletteService.createGame(source.guildId, source.channelId, discordProfile(source));
    if (result.status === 'already-active') {
      await source.reply(errorPayload('Casino game already active\nFinish or wait for your current table to expire.', { ephemeral: true }));
      return;
    }
    let payload;
    try {
      payload = rouletteBettingPayload(result.game, await rouletteRenderer.render(result.game));
    } catch (error) {
      reportError?.(error, { kind: 'roulette-initial-render', gameId: result.game.id, revision: result.game.revision });
      payload = rouletteRenderFailurePayload(result.game);
    }
    await source.reply(payload);
    const message = await source.fetchReply?.().catch?.(() => null);
    if (message?.id) rouletteService.repository.setMessage(result.game.id, message.id, rouletteService.now());
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
    if (commandName === 'exchange-token') return executeExchangeToken(source);
    if (commandName === 'g-rps') return executeRps(source);
    if (commandName === 'g-roulette') return executeRoulette(source);
    if (commandName === 'shop') return executeShop(source);
    if (commandName === 'use') return executeUse(source, options);
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
    const rawContent = String(message.content || '').trim();
    const content = rawContent.toLowerCase().replace(/\s+/g, ' ');
    const useArguments = parsePrefixUse(rawContent);
    const commandName = useArguments ? 'use' : PREFIX_COMMANDS.get(content);
    if (!commandName) return false;
    const source = prefixSource(message);
    if (saleSessions.has(message.author.id)) {
      await source.reply(lockedPayload());
      return true;
    }
    const access = await requireAccess(source);
    if (!access) return true;
    if (useArguments?.status === 'invalid') {
      await source.reply(errorPayload(`Invalid item or amount\nUsage: \`${useArguments.usage}\`. Item names are case-insensitive and may contain spaces.`));
      return true;
    }
    await execute(commandName, source, access, {
      rollSource: 'prefix',
      operationId: message.id,
      ...(useArguments?.status === 'ok' ? useArguments : {}),
    });
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
  parsePrefixUse,
  rollErrorPayload,
};
