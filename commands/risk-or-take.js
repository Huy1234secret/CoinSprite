const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  getBalance,
  spendBalance,
  addBalance,
  recordGamblingEarnings,
} = require('../src/gamblingStore');
const { COIN, formatNumber } = require('../src/gamblingConfig');
const {
  validateBet,
  text,
  separator,
  button,
  row,
} = require('../src/simpleGambling');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const RED_ACCENT = 0xed4245;
const GREEN_ACCENT = 0x57f287;
const WHITE_ACCENT = 0xffffff;
const RISK_PREFIX = 'riskortake';

const ROUNDS = [
  { failChance: 10, multiplier: 1.05 },
  { failChance: 12, multiplier: 1.08 },
  { failChance: 15, multiplier: 1.115 },
  { failChance: 19, multiplier: 1.185 },
  { failChance: 24, multiplier: 1.15 },
  { failChance: 30, multiplier: 1.225 },
  { failChance: 37, multiplier: 1.3 },
  { failChance: 45, multiplier: 1.425 },
  { failChance: 54, multiplier: 1.575 },
  { failChance: 64, multiplier: 1.7125 },
  { failChance: 75, multiplier: 1.825 },
  { failChance: 87, multiplier: 2 },
  { failChance: 99, multiplier: 10 },
];

const activeGames = new Map();

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function formatMultiplier(value) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function gameContent(game, statusLine = null) {
  const round = ROUNDS[game.round - 1];
  const lines = [
    `### Round ${game.round}`,
    statusLine || `* <@${game.userId}> do you risk a **${formatMultiplier(round.multiplier)}x** boost to the prize pool?`,
    `-# Fail chance: ${round.failChance}%`,
    '',
    `-# Current prize pool: ${formatNumber(game.pool)} ${COIN}`,
  ];
  return lines.join('\n');
}

function gamePayload(game, statusLine = null, accent = WHITE_ACCENT, disabled = false) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: accent,
      components: [
        text(gameContent(game, statusLine)),
        separator(),
        row(
          button(`${RISK_PREFIX}:risk:${game.userId}:${game.id}`, 'Risk', 4, disabled),
          button(`${RISK_PREFIX}:take:${game.userId}:${game.id}`, 'Take', 3, disabled),
        ),
      ],
    }],
  };
}

function finalPayload(game, content, accent) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: accent,
      components: [text(content)],
    }],
  };
}

function getGameFromInteraction(interaction) {
  const [, action, ownerId, gameId] = String(interaction.customId || '').split(':');
  if (!action || !ownerId || !gameId) return { error: 'This risk game is no longer valid.' };
  if (ownerId !== interaction.user.id) return { error: 'Only the player who started this game can use these buttons.' };
  const game = activeGames.get(gameId);
  if (!game) return { error: 'This risk game has already ended.' };
  return { action, game };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('risk-or-take')
    .setDescription('Build a prize pool by risking each round, or take the current pool.')
    .addStringOption((option) => option
      .setName('bet')
      .setDescription('Starting bet amount, max 10k.')
      .setRequired(true)),
  suppressCommandLog: true,

  async execute(interaction) {
    const validation = validateBet(interaction.options.getString('bet', true), getBalance(interaction.user.id));
    if (!validation.ok) {
      await interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG });
      return;
    }
    if (!spendBalance(interaction.user.id, validation.amount)) {
      await interaction.reply({ content: 'Your balance changed before the bet could be placed.', flags: EPHEMERAL_FLAG });
      return;
    }

    const game = {
      id: createGameId(),
      userId: interaction.user.id,
      bet: validation.amount,
      pool: validation.amount,
      round: 1,
      createdAt: Date.now(),
    };
    activeGames.set(game.id, game);
    await interaction.reply(gamePayload(game));
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton?.() || !interaction.customId?.startsWith(`${RISK_PREFIX}:`)) return false;
    const result = getGameFromInteraction(interaction);
    if (result.error) {
      await interaction.reply({ content: result.error, flags: EPHEMERAL_FLAG });
      return true;
    }

    const { action, game } = result;
    if (action === 'take') {
      activeGames.delete(game.id);
      addBalance(game.userId, game.pool);
      recordGamblingEarnings(game.userId, game.pool);
      await interaction.update(finalPayload(game, [
        '### Prize Taken',
        `* <@${game.userId}> took **${formatNumber(game.pool)}** ${COIN}.`,
        `-# Starting bet: ${formatNumber(game.bet)} ${COIN}`,
      ].join('\n'), GREEN_ACCENT));
      return true;
    }

    if (action !== 'risk') return true;
    const round = ROUNDS[game.round - 1];
    const failed = (Math.random() * 100) < round.failChance;
    if (failed) {
      activeGames.delete(game.id);
      await interaction.update(finalPayload(game, [
        `### Round ${game.round} Failed`,
        `* <@${game.userId}> risked the pool and lost it all.`,
        `-# Fail chance: ${round.failChance}%`,
        `-# Lost prize pool: ${formatNumber(game.pool)} ${COIN}`,
      ].join('\n'), RED_ACCENT));
      return true;
    }

    game.pool = Math.max(1, Math.floor(game.pool * round.multiplier));
    game.round += 1;
    if (game.round > ROUNDS.length) {
      activeGames.delete(game.id);
      addBalance(game.userId, game.pool);
      recordGamblingEarnings(game.userId, game.pool);
      await interaction.update(finalPayload(game, [
        '### Maximum Risk Cleared',
        `* <@${game.userId}> cleared every round and won **${formatNumber(game.pool)}** ${COIN}.`,
        `-# Starting bet: ${formatNumber(game.bet)} ${COIN}`,
      ].join('\n'), GREEN_ACCENT));
      return true;
    }

    const nextRound = ROUNDS[game.round - 1];
    await interaction.update(gamePayload(game, `* <@${game.userId}> Survived. Risk again for **${formatMultiplier(nextRound.multiplier)}x** or take the pool now.`));
    return true;
  },
};
