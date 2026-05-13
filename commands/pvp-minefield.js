const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const {
  getBalance,
  addBalance,
  spendBalance,
  recordGamblingEarnings,
  getLastBetInput,
  setLastBetInput,
} = require('../src/gamblingStore');
const { PRCOIN, formatNumber } = require('../src/gamblingConfig');
const { startUserSession, endUserSession, getCommandBlockReason } = require('../src/gameSessionLock');
const { replyIfOnCooldown, setCommandCooldown } = require('../src/commandCooldowns');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const BLUE_ACCENT = 0x5865F2;
const GREEN_ACCENT = 0x57F287;
const RED_ACCENT = 0xED4245;
const YELLOW_ACCENT = 0xFEE75C;
const COMMAND_COOLDOWN_MS = 120_000;
const CHALLENGE_TIMEOUT_MS = 120_000;
const TURN_TIMEOUT_MS = 60_000;
const MIN_BET = 1;
const MAX_BET = 100_000;
const BOARD_SIZE = 25;
const SAFE_TILES = BOARD_SIZE - 1;
const PREFIX = 'pvpmine';
const MINE_LOCATION_THREAD_ID = '1495783372591730750';
const EMPTY_TILE_LABEL = '\u200B';
const MINE_EMOJI = { name: '💥' };
const SUFFIX_MULTIPLIERS = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };

const activeChallenges = new Map();
const activeGames = new Map();
const busyUsers = new Map();

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseBetInput(raw, balance = null) {
  const compact = String(raw || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  if (!compact) return NaN;
  if (['all', 'max'].includes(compact)) return Math.floor(Number(balance) || 0);
  const match = compact.match(/^(\d+(?:\.\d+)?)([kmbt])?$/i);
  if (!match) return NaN;
  return Math.floor(Number(match[1]) * (SUFFIX_MULTIPLIERS[match[2]] || 1));
}

function validateBet(userId, rawAmount) {
  const balance = getBalance(userId);
  const amount = parseBetInput(rawAmount, balance);
  if (!Number.isFinite(amount) || amount < MIN_BET || amount > MAX_BET) {
    return {
      ok: false,
      amount,
      balance,
      message: `Bet must be between **${formatNumber(MIN_BET)}** and **${formatNumber(MAX_BET)}** ${PRCOIN}.`,
    };
  }
  if (balance < amount) {
    return {
      ok: false,
      amount,
      balance,
      message: `You need **${formatNumber(amount)}** ${PRCOIN}. Your current balance is **${formatNumber(balance)}** ${PRCOIN}.`,
    };
  }
  return { ok: true, amount, balance };
}

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false, emoji = null) {
  const component = { type: 2, custom_id: customId, label, style, disabled };
  if (emoji) component.emoji = emoji;
  return component;
}
function payload(accent, components) {
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: accent, components }] };
}

function otherPlayerId(challenge, userId) {
  return userId === challenge.challengerId ? challenge.targetId : challenge.challengerId;
}

function getPlayer(game, userId) {
  return game.players.find((player) => player.id === userId) || null;
}

function currentPlayer(game) {
  return game.players[game.turnIndex];
}

function otherGamePlayer(game, userId) {
  return game.players.find((player) => player.id !== userId) || null;
}

function markBusy(userId, type, id) {
  busyUsers.set(userId, { type, id });
}

function clearBusy(userId) {
  busyUsers.delete(userId);
}

function isBusy(userId) {
  return busyUsers.has(userId);
}

function clearTimer(item) {
  if (item?.timer) {
    clearTimeout(item.timer);
    item.timer = null;
  }
}

function cleanupChallenge(challenge) {
  clearTimer(challenge);
  activeChallenges.delete(challenge.id);
  clearBusy(challenge.challengerId);
  clearBusy(challenge.targetId);
}

function cleanupGame(game) {
  clearTimer(game);
  activeGames.delete(game.id);
  for (const player of game.players) {
    clearBusy(player.id);
    endUserSession(player.id, 'pvp-minefield');
  }
}

function buildChallengePayload(challenge, state = 'pending') {
  const asker = `<@${challenge.askUserId}>`;
  const other = `<@${otherPlayerId(challenge, challenge.askUserId)}>`;
  const lines = [
    '## PVP Minefield Challenge',
    state === 'pending' ? `${other} wants to play Minefield against ${asker}.` : challenge.summary || 'Challenge ended.',
    `-# Current bet: **${formatNumber(challenge.amount)}** ${PRCOIN} each`,
  ];
  if (state === 'pending') {
    lines.push(`-# ${asker}, choose Yes, No, or Higher Bet. Max bet: ${formatNumber(MAX_BET)} ${PRCOIN}.`);
  }

  const components = [text(lines.join('\n'))];
  if (state === 'pending') {
    components.push(separator());
    components.push(row(
      button(`${PREFIX}:accept:${challenge.id}`, 'Yes', 3),
      button(`${PREFIX}:decline:${challenge.id}`, 'No', 4),
      button(`${PREFIX}:higher:${challenge.id}`, 'Higher Bet', 1),
    ));
  }

  let accent = BLUE_ACCENT;
  if (state === 'declined' || state === 'expired') accent = RED_ACCENT;
  if (state === 'accepted') accent = GREEN_ACCENT;
  return payload(accent, components);
}

function formatTileLocation(tileIndex) {
  const rowIndex = Math.floor(tileIndex / 5);
  const columnIndex = tileIndex % 5;
  return `tile **${tileIndex + 1}** (row **${rowIndex + 1}**, column **${columnIndex + 1}**)`;
}

async function announceMineLocation(game, interaction) {
  const thread = interaction.client.channels.cache.get(MINE_LOCATION_THREAD_ID)
    || await interaction.client.channels.fetch(MINE_LOCATION_THREAD_ID).catch(() => null);
  if (!thread?.isTextBased?.()) return;

  await thread.send({
    content: [
      '## PVP Minefield Bomb Location',
      `Game: **${game.id}**`,
      `Players: ${game.players.map((player) => player.username).join(' vs ')}`,
      `Bomb: ${formatTileLocation(game.mineIndex)}`,
    ].join('\n'),
    allowedMentions: { parse: [] },
  }).catch(() => null);
}

function buildMinefieldRows(game) {
  const components = [];
  for (let rowIndex = 0; rowIndex < 5; rowIndex += 1) {
    const buttons = [];
    for (let columnIndex = 0; columnIndex < 5; columnIndex += 1) {
      const index = (rowIndex * 5) + columnIndex;
      const picked = game.pickedSafe.has(index);
      const exploded = game.explodedIndex === index;
      const revealMine = game.status === 'finished' && game.outcome !== 'timeout' && game.mineIndex === index;
      const label = EMPTY_TILE_LABEL;
      let style = 2;
      let disabled = game.status !== 'active';
      let emoji = null;

      if (picked) {
        style = 3;
        disabled = true;
      } else if (exploded || revealMine) {
        style = 4;
        disabled = true;
        emoji = MINE_EMOJI;
      }

      buttons.push(button(`${PREFIX}:pick:${game.id}:${index}`, label, style, disabled, emoji));
    }
    components.push(row(...buttons));
  }
  return components;
}

function buildGamePayload(game) {
  const safeFound = game.pickedSafe.size;
  const current = game.status === 'active' ? currentPlayer(game) : null;
  const lines = [
    '## PVP Minefield',
    `-# Pot: **${formatNumber(game.bet * 2)}** ${PRCOIN} | Bet: **${formatNumber(game.bet)}** ${PRCOIN} each`,
    `-# Safe tiles found: **${safeFound}/${SAFE_TILES}**`,
  ];

  if (game.status === 'active') {
    lines.push(`### ${current.mention}'s turn`);
    lines.push('-# Pick one tile. Safe tiles pass the turn. A mine ends the game.');
  } else {
    lines.push(`### ${game.summary}`);
  }

  const components = [text(lines.join('\n')), separator(), ...buildMinefieldRows(game)];
  let accent = BLUE_ACCENT;
  if (game.outcome === 'win') accent = GREEN_ACCENT;
  if (game.outcome === 'timeout') accent = GREEN_ACCENT;
  if (game.outcome === 'mine') accent = RED_ACCENT;
  if (game.outcome === 'clear') accent = YELLOW_ACCENT;
  return payload(accent, components);
}

function resetChallengeTimer(challenge) {
  clearTimer(challenge);
  challenge.timer = setTimeout(async () => {
    if (!activeChallenges.has(challenge.id)) return;
    challenge.summary = 'Challenge expired before both players accepted.';
    cleanupChallenge(challenge);
    await challenge.message?.edit(buildChallengePayload(challenge, 'expired')).catch(() => null);
  }, CHALLENGE_TIMEOUT_MS);
}

function resetGameTimer(game) {
  clearTimer(game);
  game.timer = setTimeout(async () => {
    if (!activeGames.has(game.id) || game.status !== 'active') return;
    const inactive = currentPlayer(game);
    const winner = otherGamePlayer(game, inactive.id);
    const payout = game.bet * 2;
    game.status = 'finished';
    game.outcome = 'timeout';
    game.explodedIndex = null;
    if (winner) {
      addBalance(winner.id, payout);
      recordGamblingEarnings(winner.id, payout);
      game.summary = `${inactive.mention} was inactive. ${winner.mention} wins **${formatNumber(payout)}** ${PRCOIN} by inactivity.`;
    } else {
      game.summary = 'The Minefield game ended by inactivity.';
    }
    cleanupGame(game);
    await game.message?.edit(buildGamePayload(game)).catch(() => null);
  }, TURN_TIMEOUT_MS);
}

async function startPvpMinefield(interaction) {
  const challenger = interaction.user;
  const target = interaction.options.getUser('user', true);
  const rawAmount = interaction.options.getString('bet', true);

  const blockReason = getCommandBlockReason(challenger.id, 'pvp-minefield');
  if (blockReason) {
    await interaction.reply({ content: blockReason, flags: EPHEMERAL_FLAG });
    return false;
  }
  if (target.id === challenger.id) {
    await interaction.reply({ content: 'You cannot challenge yourself to PVP Minefield.', flags: EPHEMERAL_FLAG });
    return false;
  }
  if (target.bot) {
    await interaction.reply({ content: 'Challenge a real player, not a bot.', flags: EPHEMERAL_FLAG });
    return false;
  }
  if (getCommandBlockReason(target.id, 'pvp-minefield')) {
    await interaction.reply({ content: `${target} is currently locked in another game.`, flags: EPHEMERAL_FLAG });
    return false;
  }
  if (isBusy(challenger.id)) {
    await interaction.reply({ content: 'You already have an active PVP Minefield game or challenge.', flags: EPHEMERAL_FLAG });
    return false;
  }
  if (isBusy(target.id)) {
    await interaction.reply({ content: `${target} already has an active PVP Minefield game or challenge.`, flags: EPHEMERAL_FLAG });
    return false;
  }

  const validation = validateBet(challenger.id, rawAmount);
  if (!validation.ok) {
    await interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG });
    return false;
  }
  const targetBalance = getBalance(target.id);
  if (targetBalance < validation.amount) {
    await interaction.reply({ content: `${target} needs **${formatNumber(validation.amount)}** ${PRCOIN}, but only has **${formatNumber(targetBalance)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
    return false;
  }

  const challenge = {
    id: createGameId(),
    challengerId: challenger.id,
    challengerName: challenger.username,
    targetId: target.id,
    targetName: target.username,
    amount: validation.amount,
    askUserId: target.id,
    message: null,
    timer: null,
    summary: null,
  };
  activeChallenges.set(challenge.id, challenge);
  markBusy(challenge.challengerId, 'challenge', challenge.id);
  markBusy(challenge.targetId, 'challenge', challenge.id);
  setLastBetInput(challenger.id, rawAmount, 'pvp-minefield');

  await interaction.reply(buildChallengePayload(challenge));
  challenge.message = await interaction.fetchReply().catch(() => null);
  resetChallengeTimer(challenge);
  return true;
}

async function beginGame(challenge, interaction) {
  const challengerValidation = validateBet(challenge.challengerId, String(challenge.amount));
  const targetValidation = validateBet(challenge.targetId, String(challenge.amount));
  if (!challengerValidation.ok || !targetValidation.ok) {
    await interaction.reply({ content: 'One player no longer has enough PRcoin for this bet.', flags: EPHEMERAL_FLAG });
    return;
  }

  if (!spendBalance(challenge.challengerId, challenge.amount)) {
    await interaction.reply({ content: `<@${challenge.challengerId}> no longer has enough ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
    return;
  }
  if (!spendBalance(challenge.targetId, challenge.amount)) {
    addBalance(challenge.challengerId, challenge.amount);
    await interaction.reply({ content: `<@${challenge.targetId}> no longer has enough ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
    return;
  }

  cleanupChallenge(challenge);
  const game = {
    id: createGameId(),
    bet: challenge.amount,
    players: [
      { id: challenge.challengerId, username: challenge.challengerName, mention: `<@${challenge.challengerId}>` },
      { id: challenge.targetId, username: challenge.targetName, mention: `<@${challenge.targetId}>` },
    ],
    turnIndex: 0,
    mineIndex: Math.floor(Math.random() * BOARD_SIZE),
    pickedSafe: new Set(),
    explodedIndex: null,
    status: 'active',
    outcome: null,
    summary: null,
    message: challenge.message,
    timer: null,
  };

  activeGames.set(game.id, game);
  for (const player of game.players) {
    markBusy(player.id, 'game', game.id);
    startUserSession(player.id, {
      type: 'pvp-minefield',
      label: 'PVP Minefield',
      lockedCommand: 'pvp-minefield',
      lockToCommand: true,
      lockMessage: 'You have an active PVP Minefield game. Use the game buttons until it ends.',
    });
  }

  await interaction.deferUpdate().catch(() => null);
  await game.message?.edit(buildGamePayload(game)).catch(() => null);
  await announceMineLocation(game, interaction);
  resetGameTimer(game);
}

function finishByMine(game, loser, tileIndex) {
  const winner = otherGamePlayer(game, loser.id);
  const payout = game.bet * 2;
  game.status = 'finished';
  game.outcome = 'mine';
  game.explodedIndex = tileIndex;
  if (winner) {
    addBalance(winner.id, payout);
    recordGamblingEarnings(winner.id, payout);
    game.summary = `${loser.mention} found the mine. ${winner.mention} wins **${formatNumber(payout)}** ${PRCOIN}.`;
  } else {
    game.summary = `${loser.mention} found the mine.`;
  }
  cleanupGame(game);
}

function finishAllSafe(game) {
  const payout = game.bet * 2;
  game.status = 'finished';
  game.outcome = 'clear';
  for (const player of game.players) {
    addBalance(player.id, payout);
    recordGamblingEarnings(player.id, payout);
  }
  game.summary = `All safe tiles were found. Both players win **${formatNumber(payout)}** ${PRCOIN}.`;
  cleanupGame(game);
}

function advanceTurn(game) {
  game.turnIndex = (game.turnIndex + 1) % game.players.length;
  resetGameTimer(game);
}

async function handleMinefieldInteraction(interaction) {
  const customId = interaction.customId;
  if (typeof customId !== 'string' || !customId.startsWith(`${PREFIX}:`)) return false;

  if (interaction.isModalSubmit?.()) {
    const [, action, challengeId] = customId.split(':');
    if (action !== 'higher') return false;
    const challenge = activeChallenges.get(challengeId);
    if (!challenge) {
      await interaction.reply({ content: 'This PVP Minefield challenge is no longer active.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (interaction.user.id !== challenge.askUserId) {
      await interaction.reply({ content: `Only <@${challenge.askUserId}> can update this challenge right now.`, flags: EPHEMERAL_FLAG });
      return true;
    }

    const rawAmount = interaction.fields.getTextInputValue('amount');
    const amount = parseBetInput(rawAmount, getBalance(interaction.user.id));
    if (!Number.isFinite(amount) || amount <= challenge.amount || amount > MAX_BET) {
      await interaction.reply({ content: `Higher bet must be above **${formatNumber(challenge.amount)}** and no more than **${formatNumber(MAX_BET)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
      return true;
    }
    if (getBalance(interaction.user.id) < amount) {
      await interaction.reply({ content: `You do not have **${formatNumber(amount)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
      return true;
    }
    const otherId = otherPlayerId(challenge, interaction.user.id);
    if (getBalance(otherId) < amount) {
      await interaction.reply({ content: `<@${otherId}> does not have **${formatNumber(amount)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
      return true;
    }

    challenge.amount = amount;
    challenge.askUserId = otherId;
    setLastBetInput(interaction.user.id, rawAmount, 'pvp-minefield');
    resetChallengeTimer(challenge);
    await interaction.reply({ content: `Higher bet proposed: **${formatNumber(amount)}** ${PRCOIN}. Waiting for <@${otherId}>.`, flags: EPHEMERAL_FLAG });
    await challenge.message?.edit(buildChallengePayload(challenge)).catch(() => null);
    return true;
  }

  if (!interaction.isButton?.()) return false;
  const [, action, id, extra] = customId.split(':');

  if (['accept', 'decline', 'higher'].includes(action)) {
    const challenge = activeChallenges.get(id);
    if (!challenge) {
      await interaction.reply({ content: 'This PVP Minefield challenge is no longer active.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (interaction.user.id !== challenge.askUserId) {
      await interaction.reply({ content: `Only <@${challenge.askUserId}> can answer this challenge right now.`, flags: EPHEMERAL_FLAG });
      return true;
    }

    if (action === 'decline') {
      challenge.summary = `${interaction.user} declined the PVP Minefield challenge.`;
      cleanupChallenge(challenge);
      await interaction.update(buildChallengePayload(challenge, 'declined')).catch(() => null);
      return true;
    }
    if (action === 'higher') {
      resetChallengeTimer(challenge);
      await interaction.showModal({
        custom_id: `${PREFIX}:higher:${challenge.id}`,
        title: 'Propose Higher Bet',
        components: [{
          type: 18,
          label: `New bet, max ${formatNumber(MAX_BET)} PRcoin`,
          component: {
            type: 4,
            custom_id: 'amount',
            style: 1,
            required: true,
            min_length: 1,
            max_length: 12,
            placeholder: 'Example: 5000, 5k, all',
            value: getLastBetInput(interaction.user.id, 'pvp-minefield') || String(Math.min(MAX_BET, challenge.amount + 1)),
          },
        }],
      });
      return true;
    }

    await beginGame(challenge, interaction);
    return true;
  }

  if (action === 'pick') {
    const game = activeGames.get(id);
    if (!game || game.status !== 'active') {
      await interaction.reply({ content: 'This PVP Minefield game is no longer active.', flags: EPHEMERAL_FLAG });
      return true;
    }
    const player = getPlayer(game, interaction.user.id);
    if (!player) {
      await interaction.reply({ content: 'Only players in this match can pick tiles.', flags: EPHEMERAL_FLAG });
      return true;
    }
    const current = currentPlayer(game);
    if (interaction.user.id !== current.id) {
      await interaction.reply({ content: `It is ${current.mention}'s turn.`, flags: EPHEMERAL_FLAG });
      return true;
    }

    const tileIndex = Number(extra);
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= BOARD_SIZE) {
      await interaction.reply({ content: 'That tile is invalid.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (game.pickedSafe.has(tileIndex)) {
      await interaction.reply({ content: 'That tile was already picked.', flags: EPHEMERAL_FLAG });
      return true;
    }

    if (tileIndex === game.mineIndex) {
      finishByMine(game, current, tileIndex);
    } else {
      game.pickedSafe.add(tileIndex);
      if (game.pickedSafe.size >= SAFE_TILES) finishAllSafe(game);
      else advanceTurn(game);
    }

    await interaction.update(buildGamePayload(game)).catch(async () => {
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'PVP Minefield updated.', flags: EPHEMERAL_FLAG }).catch(() => null);
    });
    return true;
  }

  return false;
}

function shouldLogMinefieldInteraction(interaction) {
  const id = interaction.customId || '';
  return !(typeof id === 'string' && id.startsWith(`${PREFIX}:`));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('pvp-minefield')
    .setDescription('Challenge another player to PVP Minefield')
    .addUserOption((option) => option
      .setName('user')
      .setDescription('The player you want to challenge')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('bet')
      .setDescription('PRcoin bet amount, max 100k')
      .setRequired(true)),
  suppressCommandLog: true,
  disableActionTimeout: true,

  async execute(interaction) {
    if (await replyIfOnCooldown(interaction, 'pvp-minefield', COMMAND_COOLDOWN_MS, EPHEMERAL_FLAG)) return;
    const started = await startPvpMinefield(interaction);
    if (started) setCommandCooldown(interaction.user.id, 'pvp-minefield', COMMAND_COOLDOWN_MS);
  },

  shouldLogInteraction: shouldLogMinefieldInteraction,

  async handleInteraction(interaction) {
    return handleMinefieldInteraction(interaction);
  },
};
