const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  getBalance,
  addBalance,
  spendBalance,
  setBalance,
  getRebirthUpgrades,
} = require('../src/rngGameStore');
const {
  PRCOIN,
  WHITE_ACCENT,
  RED_ACCENT,
  GREEN_ACCENT,
  YELLOW_ACCENT,
  MINEFIELD_DIFFICULTIES,
  formatNumber,
  calculateMinefieldPayout,
  isMinefieldUnlocked,
} = require('../src/rngConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const MIN_BET = 1000;
const BOARD_SIZE = 25;
const TIMEOUT_MS = 20_000;
const activeGames = new Map();
const activeUserGames = new Map();

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function createMineCells(mineCount) {
  const mines = new Set(shuffle(Array.from({ length: BOARD_SIZE }, (_, index) => index)).slice(0, mineCount));
  return Array.from({ length: BOARD_SIZE }, (_, index) => mines.has(index));
}

function getSafeCount(game) {
  let count = 0;
  for (const index of game.revealed) {
    if (!game.cells[index]) count += 1;
  }
  return count;
}

function getMaxSafe(game) {
  return BOARD_SIZE - game.config.mines;
}

function getCurrentPayout(game) {
  return calculateMinefieldPayout(game.bet, game.config, getSafeCount(game));
}

function clearGameTimer(game) {
  if (game?.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function resetGameTimer(game) {
  clearGameTimer(game);
  game.timer = setTimeout(() => finishGame(game.id, 'stopped', null, true).catch(() => null), TIMEOUT_MS);
}

function removeGame(game) {
  clearGameTimer(game);
  activeGames.delete(game.id);
  activeUserGames.delete(game.userId);
}

function buildHeaderContent(game, status) {
  const safeFound = getSafeCount(game);
  const maxSafe = getMaxSafe(game);
  const payout = getCurrentPayout(game);

  if (status === 'exploded') {
    return [
      `## ${game.username}'s Minefield Game`,
      '',
      'You have exploded! You lose...',
      `-# Lost: **${formatNumber(Math.floor(game.bet * game.config.lossMultiplier))}** ${PRCOIN}`,
    ].join('\n');
  }

  if (status === 'cleared') {
    return [
      `## ${game.username}'s Minefield Game`,
      '',
      `You have found all safe slots. You won **${formatNumber(payout)}** ${PRCOIN}!!`,
    ].join('\n');
  }

  if (status === 'stopped') {
    return [
      `## ${game.username}'s Minefield Game`,
      '',
      `You stopped and found **${safeFound}** safe slots. You won **${formatNumber(payout)}** ${PRCOIN}!`,
    ].join('\n');
  }

  return [
    `## ${game.username}'s Minefield Game`,
    '',
    `You have found **${safeFound} / ${maxSafe}** safe slots.`,
    `-# Game will stop **20s after your last move**. Stop the game to take the current money.`,
    `-# You earned **${formatNumber(payout)}** ${PRCOIN}`,
    `-# Difficulty: **${game.config.label}** | Bet: **${formatNumber(game.bet)}** ${PRCOIN}`,
  ].join('\n');
}

function getAccent(status) {
  if (status === 'exploded') return RED_ACCENT;
  if (status === 'stopped') return GREEN_ACCENT;
  if (status === 'cleared') return YELLOW_ACCENT;
  return WHITE_ACCENT;
}

function buildCellButton(game, index, status) {
  const final = status !== 'active';
  const isMine = game.cells[index];
  const isRevealed = game.revealed.has(index);

  if (final) {
    return {
      type: 2,
      custom_id: `minefield:done:${game.userId}:${game.id}:${index}`,
      label: isMine ? (game.explodedIndex === index ? '💥' : '💣') : '✓',
      style: isMine ? 4 : 3,
      disabled: true,
    };
  }

  if (isRevealed) {
    return {
      type: 2,
      custom_id: `minefield:done:${game.userId}:${game.id}:${index}`,
      label: '✓',
      style: 3,
      disabled: true,
    };
  }

  return {
    type: 2,
    custom_id: `minefield:pick:${game.userId}:${game.id}:${index}`,
    label: '\u200b',
    style: 2,
    disabled: false,
  };
}

function buildBoardRows(game, status) {
  const rows = [];
  for (let row = 0; row < 5; row += 1) {
    rows.push({
      type: 1,
      components: Array.from({ length: 5 }, (_, column) => buildCellButton(game, (row * 5) + column, status)),
    });
  }
  return rows;
}

function buildPayload(game, status = 'active') {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: getAccent(status),
        components: [
          {
            type: 9,
            components: [
              {
                type: 10,
                content: buildHeaderContent(game, status),
              },
            ],
            accessory: {
              type: 2,
              custom_id: `minefield:stop:${game.userId}:${game.id}`,
              label: 'Stop Game',
              style: 3,
              disabled: status !== 'active',
            },
          },
          { type: 14, divider: true, spacing: 1 },
          ...buildBoardRows(game, status),
        ],
      },
    ],
  };
}

async function finishGame(gameId, status, interaction = null, fromTimeout = false) {
  const game = activeGames.get(gameId);
  if (!game || game.status !== 'active') {
    if (interaction?.isRepliable?.() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'This Minefield game is no longer active.', flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    return true;
  }

  game.status = status;
  removeGame(game);

  if (status === 'exploded') {
    const extraLoss = Math.max(0, Math.floor((game.bet * game.config.lossMultiplier) - game.bet));
    if (extraLoss > 0 && !spendBalance(game.userId, extraLoss)) {
      setBalance(game.userId, 0);
    }
  } else {
    addBalance(game.userId, getCurrentPayout(game));
  }

  const payload = buildPayload(game, status);
  if (interaction) {
    await interaction.update(payload).catch(async () => {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Minefield game ended.', flags: MessageFlags.Ephemeral }).catch(() => null);
      }
    });
    return true;
  }

  if (fromTimeout && game.message?.editable) {
    await game.message.edit(payload).catch(() => null);
  }
  return true;
}

function canStartGame(userId, bet, config) {
  const balance = getBalance(userId);
  const totalRisk = Math.floor(bet * config.lossMultiplier);
  return {
    balance,
    totalRisk,
    ok: balance >= totalRisk,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minefield')
    .setDescription('Risk PRcoin in the Minefield gambling game')
    .addIntegerOption((option) => option
      .setName('bet')
      .setDescription('Amount of PRcoin to bet')
      .setRequired(true)
      .setMinValue(MIN_BET))
    .addStringOption((option) => option
      .setName('difficulty')
      .setDescription('Minefield difficulty')
      .setRequired(true)
      .addChoices(
        { name: '🟢 Easy', value: 'easy' },
        { name: '🟡 Medium', value: 'medium' },
        { name: '🔴 Hard', value: 'hard' },
        { name: '💀 HARDCORE', value: 'hardcore' },
      )),
  suppressCommandLog: true,

  async execute(interaction) {
    const rebirthUpgrades = getRebirthUpgrades(interaction.user.id);
    if (!isMinefieldUnlocked(rebirthUpgrades)) {
      await interaction.reply({ content: '💣 Minefield Fortune is locked. Buy it from Rebirth Upgrades first.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (activeUserGames.has(interaction.user.id)) {
      await interaction.reply({ content: 'You already have an active Minefield game. Finish it first.', flags: MessageFlags.Ephemeral });
      return;
    }

    const bet = Math.floor(interaction.options.getInteger('bet') || 0);
    const difficulty = interaction.options.getString('difficulty');
    const config = MINEFIELD_DIFFICULTIES[difficulty];

    if (!config || bet < MIN_BET) {
      await interaction.reply({ content: `Minimum bet is ${formatNumber(MIN_BET)} ${PRCOIN}.`, flags: MessageFlags.Ephemeral });
      return;
    }

    const risk = canStartGame(interaction.user.id, bet, config);
    if (!risk.ok) {
      await interaction.reply({
        content: `You need **${formatNumber(risk.totalRisk)}** ${PRCOIN} available for ${config.label}, because losing can cost up to **${formatNumber(Math.floor(config.lossMultiplier * 100))}%** of your bet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!spendBalance(interaction.user.id, bet)) {
      await interaction.reply({ content: 'You do not have enough PRcoin for that bet.', flags: MessageFlags.Ephemeral });
      return;
    }

    const game = {
      id: createGameId(),
      userId: interaction.user.id,
      username: interaction.user.username,
      bet,
      difficulty,
      config,
      cells: createMineCells(config.mines),
      revealed: new Set(),
      explodedIndex: null,
      status: 'active',
      message: null,
      timer: null,
    };

    activeGames.set(game.id, game);
    activeUserGames.set(game.userId, game.id);

    const message = await interaction.reply({ ...buildPayload(game, 'active'), fetchReply: true });
    game.message = message;
    resetGameTimer(game);
  },

  shouldLogInteraction(interaction) {
    return !(typeof interaction.customId === 'string' && interaction.customId.startsWith('minefield:'));
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('minefield:')) {
      return false;
    }

    const [prefix, action, ownerId, gameId, indexRaw] = interaction.customId.split(':');
    if (prefix !== 'minefield') return false;

    if (ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only play your own Minefield game.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const game = activeGames.get(gameId);
    if (!game || game.status !== 'active') {
      await interaction.reply({ content: 'This Minefield game is no longer active.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'stop') {
      await finishGame(gameId, 'stopped', interaction);
      return true;
    }

    if (action !== 'pick') {
      return true;
    }

    const index = Number(indexRaw);
    if (!Number.isInteger(index) || index < 0 || index >= BOARD_SIZE || game.revealed.has(index)) {
      await interaction.update(buildPayload(game, 'active'));
      return true;
    }

    game.revealed.add(index);

    if (game.cells[index]) {
      game.explodedIndex = index;
      await finishGame(gameId, 'exploded', interaction);
      return true;
    }

    if (getSafeCount(game) >= getMaxSafe(game)) {
      await finishGame(gameId, 'cleared', interaction);
      return true;
    }

    resetGameTimer(game);
    await interaction.update(buildPayload(game, 'active'));
    return true;
  },
};
