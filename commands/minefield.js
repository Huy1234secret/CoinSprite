const {
  SlashCommandBuilder,
  MessageFlags,
} = require('discord.js');
const {
  getBalance,
  addBalance,
  spendBalance,
  recordGamblingEarnings,
  incrementMinefieldCompleted,
} = require('../src/gamblingStore');
const leveling = require('../src/levelingManager');
const {
  PRCOIN,
  WHITE_ACCENT,
  RED_ACCENT,
  GREEN_ACCENT,
  YELLOW_ACCENT,
  MINEFIELD_DIFFICULTIES,
  formatNumber,
  calculateMinefieldPayout,
} = require('../src/gamblingConfig');
const { startUserSession, endUserSession, getCommandBlockReason } = require('../src/gameSessionLock');
const { unlockMinefieldAchievement } = require('../src/achievements');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const MIN_BET = 100;
const MAX_BET = 100_000;
const TIMEOUT_MS = 20_000;
const activeGames = new Map();
const activeUserGames = new Map();
const MINEFIELD_COMPLETION_XP = {
  easy: 100,
  medium: 200,
  hard: 450,
  hardcore: 1000,
};

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

function getBoardSize(config) {
  return Math.max(1, Number(config?.rows || 1) * Number(config?.columns || 1));
}

function createMineCells(config) {
  const boardSize = getBoardSize(config);
  const mines = new Set(shuffle(Array.from({ length: boardSize }, (_, index) => index)).slice(0, config.mines));
  return Array.from({ length: boardSize }, (_, index) => mines.has(index));
}

function getSafeCount(game) {
  let count = 0;
  for (const index of game.revealed) {
    if (!game.cells[index]) count += 1;
  }
  return count;
}

function getMaxSafe(game) {
  return getBoardSize(game.config) - game.config.mines;
}

function getCurrentPayout(game) {
  return calculateMinefieldPayout(game.bet, game.config, getSafeCount(game), game.difficulty);
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
  endUserSession(game.userId, 'minefield');
}

function normalizeDifficulty(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return null;

  if (value.includes('easy')) return 'easy';
  if (value.includes('medium')) return 'medium';
  if (value.includes('hardcore')) return 'hardcore';
  if (value.includes('hard')) return 'hard';
  return null;
}

function getModalComponents(interaction) {
  const rawComponents = interaction.components ?? interaction?.data?.components ?? [];
  return Array.isArray(rawComponents) ? rawComponents : [];
}

function findSubmittedComponent(interaction, customId) {
  for (const wrapper of getModalComponents(interaction)) {
    const component = wrapper?.component ?? wrapper?.components?.[0] ?? null;
    if (component?.custom_id === customId || component?.customId === customId) {
      return component;
    }
  }
  return null;
}

function buildWelcomePayload(user) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: WHITE_ACCENT,
        components: [
          {
            type: 10,
            content: [
              `## Welcome ${user} to Minefield game!`,
              '### 💣 Minefield Rules',
              '',
              '-# * Pick a difficulty and place your bet. Each difficulty has a different amount of safe tiles and mines.',
              '-# * Click safe tiles to increase your payout. The more safe tiles you find, the higher your reward becomes.',
              '-# * You can cash out anytime after finding at least 1 safe tile. If you hit a mine, your whole bet is lost.',
              '-# * Higher difficulty = fewer safe tiles, bigger rewards.',
              '',
              '### Difficulties:',
              '-# * 🟢 Easy — 3×3 grid, 2 mines, 7 safe tiles',
              '-# * 🟡 Medium — 3×4 grid, 4 mines, 8 safe tiles',
              '-# * 🔴 Hard — 4×4 grid, 10 mines, 6 safe tiles',
              '-# * 💀 Hardcore — 5×5 grid, 19 mines, 6 safe tiles',
            ].join('\n'),
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 1,
            components: [
              {
                type: 2,
                custom_id: `minefield:play:${user.id}:${createGameId()}`,
                label: 'PLAY',
                style: 2,
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildHeaderContent(game, status) {
  const safeFound = getSafeCount(game);
  const maxSafe = getMaxSafe(game);
  const payout = getCurrentPayout(game);

  if (status === 'exploded') {
    return [
      `## ${game.username}'s Minefield Game`,
      '',
      `💥 You hit a mine and lost **${formatNumber(game.bet)}** ${PRCOIN}.`,
    ].join('\n');
  }

  if (status === 'cleared') {
    return [
      `## ${game.username}'s Minefield Game`,
      '',
      `🎉 You cleared the board and won **${formatNumber(payout)}** ${PRCOIN}!`,
    ].join('\n');
  }

  if (status === 'stopped') {
    return [
      `## ${game.username}'s Minefield Game`,
      '',
      `You cashed out after finding **${safeFound}** safe slots.`,
      `-# Won: **${formatNumber(payout)}** ${PRCOIN}`,
    ].join('\n');
  }

  return [
    `## ${game.username}'s Minefield Game`,
    '',
    `You have found **${safeFound} / ${maxSafe}** safe slots.`,
    '-# The game will automatically cash out 20s after your last move.',
    '-# Press **Stop Game** to lock in your current payout.',
    `-# Current payout: **${formatNumber(payout)}** ${PRCOIN}`,
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
  for (let row = 0; row < game.config.rows; row += 1) {
    rows.push({
      type: 1,
      components: Array.from(
        { length: game.config.columns },
        (_, column) => buildCellButton(game, (row * game.config.columns) + column, status),
      ),
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

  if (status !== 'exploded') {
    const payout = getCurrentPayout(game);
    addBalance(game.userId, payout);
    recordGamblingEarnings(game.userId, payout);
    if (status === 'cleared') {
      incrementMinefieldCompleted(game.userId, game.difficulty);
      await unlockMinefieldAchievement(game.message?.channel, game.userId, `<@${game.userId}>`, game.difficulty);
      if (game.guildId && MINEFIELD_COMPLETION_XP[game.difficulty]) {
        leveling.addUserXp(game.guildId, game.userId, MINEFIELD_COMPLETION_XP[game.difficulty]);
      }
    }
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

module.exports = {
  data: new SlashCommandBuilder()
    .setName('minefield')
    .setDescription('Risk PRcoin in the unlocked Minefield gambling game'),
  suppressCommandLog: true,

  async execute(interaction) {
    const blockReason = getCommandBlockReason(interaction.user.id, 'minefield');
    if (blockReason) {
      await interaction.reply({ content: blockReason, flags: MessageFlags.Ephemeral });
      return;
    }

    if (activeUserGames.has(interaction.user.id)) {
      await interaction.reply({ content: 'You already have an active Minefield game. Finish it first.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply(buildWelcomePayload(interaction.user));
  },

  shouldLogInteraction(interaction) {
    return !(typeof interaction.customId === 'string' && interaction.customId.startsWith('minefield:'));
  },

  async handleInteraction(interaction) {
    const customId = interaction.customId;
    const isMinefieldInteraction = typeof customId === 'string' && customId.startsWith('minefield:');

    if (interaction.isButton() && isMinefieldInteraction) {
      const [prefix, action, ownerId] = customId.split(':');
      if (prefix !== 'minefield') return false;

      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only play your own Minefield game.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (action === 'play') {
        await interaction.showModal({
          custom_id: `minefield:setup:${interaction.user.id}:${createGameId()}`,
          title: 'Minefield Setup',
          components: [
            {
              type: 18,
              label: 'Question 1: Difficulty',
              component: {
                type: 3,
                custom_id: 'difficulty',
                placeholder: 'Select a difficulty',
                min_values: 1,
                max_values: 1,
                required: true,
                options: [
                  { label: '🟢 Easy', value: 'easy' },
                  { label: '🟡 Medium', value: 'medium' },
                  { label: '🔴 Hard', value: 'hard' },
                  { label: '💀 Hardcore', value: 'hardcore' },
                ],
              },
            },
            {
              type: 18,
              label: `Bet amount (${formatNumber(MIN_BET)} - ${formatNumber(MAX_BET)})`,
              component: {
                type: 4,
                custom_id: 'bet',
                style: 1,
                required: true,
                min_length: 1,
                max_length: 12,
                placeholder: 'Enter your bet',
              },
            },
          ],
        });
        return true;
      }

      const [, stopAction, , gameId, indexRaw] = customId.split(':');
      const game = activeGames.get(gameId);
      if (!game || game.status !== 'active') {
        await interaction.reply({ content: 'This Minefield game is no longer active.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (stopAction === 'stop') {
        await finishGame(gameId, 'stopped', interaction);
        return true;
      }

      if (stopAction !== 'pick') {
        return true;
      }

      const index = Number(indexRaw);
      const boardSize = getBoardSize(game.config);
      if (!Number.isInteger(index) || index < 0 || index >= boardSize || game.revealed.has(index)) {
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
    }

    if (interaction.isModalSubmit() && isMinefieldInteraction) {
      const [prefix, action, ownerId] = customId.split(':');
      if (prefix !== 'minefield' || action !== 'setup') return false;

      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only play your own Minefield game.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (activeUserGames.has(interaction.user.id)) {
        await interaction.reply({ content: 'You already have an active Minefield game. Finish it first.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const difficultySelect = findSubmittedComponent(interaction, 'difficulty');
      const difficultyInput =
        difficultySelect?.values?.[0]
        ?? difficultySelect?.value
        ?? null;
      const betInput = interaction.fields.getTextInputValue('bet');
      const difficulty = normalizeDifficulty(difficultyInput);
      const bet = Math.floor(Number(String(betInput || '').replace(/,/g, '').trim()));
      const baseConfig = difficulty ? MINEFIELD_DIFFICULTIES[difficulty] : null;
      const config = baseConfig
        ? {
          ...baseConfig,
          ...(difficulty === 'medium' && Math.random() >= 0.5 ? { rows: 4, columns: 3 } : {}),
        }
        : null;

      if (!config) {
        await interaction.reply({
          content: 'Invalid difficulty. Choose one: 🟢 Easy, 🟡 Medium, 🔴 Hard, 💀 Hardcore.',
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (!Number.isFinite(bet) || bet < MIN_BET || bet > MAX_BET) {
        await interaction.reply({
          content: `Bet must be between **${formatNumber(MIN_BET)}** and **${formatNumber(MAX_BET)}** ${PRCOIN}.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      const balance = getBalance(interaction.user.id);
      if (balance < bet) {
        await interaction.reply({
          content: `You need **${formatNumber(bet)}** ${PRCOIN} to place that bet. Your current balance is **${formatNumber(balance)}** ${PRCOIN}.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }

      if (!spendBalance(interaction.user.id, bet)) {
        await interaction.reply({ content: 'You do not have enough PRcoin for that bet.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const game = {
        id: createGameId(),
        userId: interaction.user.id,
        username: interaction.user.username,
        bet,
        difficulty,
        config,
        cells: createMineCells(config),
        revealed: new Set(),
        explodedIndex: null,
        status: 'active',
        guildId: interaction.guildId || null,
        message: null,
        timer: null,
      };

      activeGames.set(game.id, game);
      activeUserGames.set(game.userId, game.id);
      startUserSession(game.userId, {
        type: 'minefield',
        label: 'Minefield',
        lockedCommand: 'minefield',
        lockToCommand: true,
        lockMessage: 'You have an active Minefield game. You can only use /minefield until the current game ends.',
      });

      const message = await interaction.reply({ ...buildPayload(game, 'active'), fetchReply: true });
      game.message = message;
      resetGameTimer(game);
      return true;
    }

    return false;
  },
};
