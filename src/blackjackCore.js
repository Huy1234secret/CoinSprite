const {
  MessageFlags,
  AttachmentBuilder,
} = require('discord.js');
const { createCanvas } = require('@napi-rs/canvas');
const {
  getBalance,
  addBalance,
  spendBalance,
  recordGamblingEarnings,
  getLastBetInput,
  setLastBetInput,
} = require('./gamblingStore');
const {
  PRCOIN,
  WHITE_ACCENT,
  RED_ACCENT,
  GREEN_ACCENT,
  YELLOW_ACCENT,
  formatNumber,
} = require('./gamblingConfig');
const { startUserSession, endUserSession, getCommandBlockReason } = require('./gameSessionLock');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const BLUE_ACCENT = 0x5865F2;
const PRCOIN_MIN_BET = 1;
const PRCOIN_MAX_BET = 100_000;
const BLACKJACK_TURN_TIMEOUT_MS = 60_000;
const PVP_CHALLENGE_TIMEOUT_MS = 120_000;
const SUFFIX_MULTIPLIERS = {
  k: 1_000,
  m: 1_000_000,
  b: 1_000_000_000,
  t: 1_000_000_000_000,
};

const SUITS = [
  { symbol: '♠', name: 'spades', color: '#111214' },
  { symbol: '♥', name: 'hearts', color: '#ed4245' },
  { symbol: '♦', name: 'diamonds', color: '#ed4245' },
  { symbol: '♣', name: 'clubs', color: '#111214' },
];
const RANKS = [
  { label: 'A', value: 11 },
  { label: '2', value: 2 },
  { label: '3', value: 3 },
  { label: '4', value: 4 },
  { label: '5', value: 5 },
  { label: '6', value: 6 },
  { label: '7', value: 7 },
  { label: '8', value: 8 },
  { label: '9', value: 9 },
  { label: '10', value: 10 },
  { label: 'J', value: 10 },
  { label: 'Q', value: 10 },
  { label: 'K', value: 10 },
];

const activeBotGames = new Map();
const activePvpGames = new Map();
const activeUserGames = new Map();
const activeChallenges = new Map();
const activeChallengeUsers = new Map();

function createGameId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function parseBetInput(raw, balance = null) {
  const compact = String(raw || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  if (!compact) return NaN;
  if (['all', 'max'].includes(compact)) return Math.floor(Number(balance) || 0);
  const match = compact.match(/^(\d+(?:\.\d+)?)([kmbt])?$/i);
  if (!match) return NaN;
  const numeric = Number(match[1]);
  const multiplier = SUFFIX_MULTIPLIERS[match[2]] || 1;
  return Math.floor(numeric * multiplier);
}

function validateBet(userId, rawAmount) {
  const balance = getBalance(userId);
  const amount = parseBetInput(rawAmount, balance);
  if (!Number.isFinite(amount) || amount < PRCOIN_MIN_BET || amount > PRCOIN_MAX_BET) {
    return {
      ok: false,
      amount,
      balance,
      message: `Bet must be between **${formatNumber(PRCOIN_MIN_BET)}** and **${formatNumber(PRCOIN_MAX_BET)}** ${PRCOIN}.`,
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

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ ...rank, suit: suit.symbol, suitName: suit.name, color: suit.color });
  }
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function drawCard(deck) {
  if (!deck.length) deck.push(...makeDeck());
  return deck.pop();
}

function handValue(hand) {
  let total = 0;
  let aces = 0;
  for (const card of hand) {
    total += card.value;
    if (card.label === 'A') aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function isBlackjack(hand) {
  return hand.length === 2 && handValue(hand) === 21;
}

function cardShort(card) {
  if (!card) return '??';
  return `${card.label}${card.suit}`;
}

function handText(hand, { hideAll = false, hideSecond = false } = {}) {
  if (hideAll) return hand.map(() => '`??`').join(' ');
  return hand.map((card, index) => (hideSecond && index > 0 ? '`??`' : `\`${cardShort(card)}\``)).join(' ');
}

function text(content) {
  return { type: 10, content };
}

function separator() {
  return { type: 14, divider: true, spacing: 1 };
}

function button(customId, label, style = 2, disabled = false, emoji = null) {
  const item = { type: 2, custom_id: customId, label, style, disabled };
  if (emoji) item.emoji = emoji;
  return item;
}

function row(...components) {
  return { type: 1, components };
}

function gallery(fileName) {
  return { type: 12, items: [{ media: { url: `attachment://${fileName}` } }] };
}

function componentsPayload({ accent = WHITE_ACCENT, components = [], files = [] }) {
  const payload = {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components }],
  };
  if (files.length) payload.files = files;
  return payload;
}

function simplePanel(content, ok = true) {
  return componentsPayload({
    accent: ok ? GREEN_ACCENT : RED_ACCENT,
    components: [text(content)],
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawHiddenCard(ctx, x, y, w, h) {
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = '#2b2d31';
  ctx.fill();
  ctx.strokeStyle = '#5865f2';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.fillStyle = '#1f2126';
  roundedRect(ctx, x + 12, y + 12, w - 24, h - 24, 12);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 48px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', x + w / 2, y + h / 2);
}

function drawCardFace(ctx, card, x, y, w, h) {
  if (!card) {
    drawHiddenCard(ctx, x, y, w, h);
    return;
  }
  roundedRect(ctx, x, y, w, h, 18);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#d7dce2';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = card.color || '#111214';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(card.label, x + 14, y + 12);
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(card.suit, x + 14, y + 42);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 56px sans-serif';
  ctx.fillText(card.suit, x + w / 2, y + h / 2 + 6);
}

function drawHand(ctx, hand, x, y, options = {}) {
  const { hideAll = false, hideSecond = false, maxWidth = 840 } = options;
  const cardW = 86;
  const cardH = 126;
  const overlap = hand.length > 8 ? Math.max(34, Math.floor((maxWidth - cardW) / Math.max(1, hand.length - 1))) : 64;
  hand.forEach((card, index) => {
    const hidden = hideAll || (hideSecond && index > 0);
    if (hidden) drawHiddenCard(ctx, x + index * overlap, y, cardW, cardH);
    else drawCardFace(ctx, card, x + index * overlap, y, cardW, cardH);
  });
}

function fitText(ctx, value, x, y, maxWidth, baseSize = 28) {
  let size = baseSize;
  do {
    ctx.font = `bold ${size}px sans-serif`;
    if (ctx.measureText(value).width <= maxWidth) break;
    size -= 1;
  } while (size >= 14);
  ctx.fillText(value, x, y);
}

function createTableAttachment(game, mode) {
  const width = 1000;
  const height = 590;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#0f5132');
  gradient.addColorStop(0.45, '#0b7d3b');
  gradient.addColorStop(1, '#064e3b');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#f8d66d';
  ctx.lineWidth = 10;
  roundedRect(ctx, 22, 22, width - 44, height - 44, 34);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.lineWidth = 2;
  roundedRect(ctx, 58, 72, width - 116, height - 134, 280);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText(mode === 'pvp' ? 'PVP BLACKJACK' : 'BLACKJACK', width / 2, 58);
  ctx.font = 'bold 18px sans-serif';
  ctx.fillStyle = '#f6f1c9';
  ctx.fillText(`${formatNumber(game.bet)} PRcoin table`, width / 2, 84);

  if (mode === 'pvp') {
    const [left, right] = game.players;
    const reveal = game.status === 'finished';
    const current = game.players[game.turnIndex];

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    fitText(ctx, `${left.username}${current?.id === left.id && !reveal ? '  • TURN' : ''}`, 76, 132, 420, 28);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#d7dce2';
    ctx.fillText(reveal ? `Score: ${handValue(left.hand)}` : `${left.hand.length} hidden card${left.hand.length === 1 ? '' : 's'}`, 76, 158);
    drawHand(ctx, left.hand, 76, 186, { hideAll: !reveal, maxWidth: 390 });

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'right';
    fitText(ctx, `${right.username}${current?.id === right.id && !reveal ? '  • TURN' : ''}`, 924, 132, 420, 28);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#d7dce2';
    ctx.fillText(reveal ? `Score: ${handValue(right.hand)}` : `${right.hand.length} hidden card${right.hand.length === 1 ? '' : 's'}`, 924, 158);
    drawHand(ctx, right.hand, 534, 186, { hideAll: !reveal, maxWidth: 390 });

    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    const footer = reveal ? (game.summary || 'Game finished') : `${current?.username || 'Player'} is deciding...`;
    ctx.fillText(footer, width / 2, 510);
  } else {
    const dealerReveal = game.status !== 'active';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('Dealer', 76, 132);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#d7dce2';
    ctx.fillText(dealerReveal ? `Score: ${handValue(game.dealerHand)}` : `Showing: ${handValue([game.dealerHand[0]])}`, 76, 158);
    drawHand(ctx, game.dealerHand, 76, 186, { hideSecond: !dealerReveal, maxWidth: 840 });

    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'left';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(game.username, 76, 374);
    ctx.font = '18px sans-serif';
    ctx.fillStyle = '#d7dce2';
    ctx.fillText(`Score: ${handValue(game.playerHand)}`, 76, 400);
    drawHand(ctx, game.playerHand, 76, 426, { maxWidth: 840 });
  }

  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'blackjack-table.png' });
}

function buildBotPayload(game) {
  const status = game.status || 'active';
  const attachment = createTableAttachment(game, 'bot');
  const playerScore = handValue(game.playerHand);
  const dealerScore = handValue(game.dealerHand);
  const components = [
    text([
      `## 🃏 ${game.username}'s Blackjack Table`,
      `-# Bet: **${formatNumber(game.bet)}** ${PRCOIN}`,
      status === 'active'
        ? `-# Your hand: ${handText(game.playerHand)} (**${playerScore}**) • Dealer: ${handText(game.dealerHand, { hideSecond: true })}`
        : `-# Your hand: ${handText(game.playerHand)} (**${playerScore}**) • Dealer: ${handText(game.dealerHand)} (**${dealerScore}**)`,
      game.summary ? `### ${game.summary}` : '-# Hit to draw. Stay to let the dealer play.',
    ].join('\n')),
    gallery('blackjack-table.png'),
    separator(),
  ];

  if (status === 'active') {
    components.push(row(
      button(`bj:hit:${game.userId}:${game.id}`, 'Hit', 1, false, { name: '🃏' }),
      button(`bj:stay:${game.userId}:${game.id}`, 'Stay', 2, false, { name: '✋' }),
    ));
  } else {
    components.push(row(
      button(`bj:done:${game.userId}:${game.id}`, 'Game Over', 2, true, { name: '🏁' }),
    ));
  }

  let accent = WHITE_ACCENT;
  if (game.outcome === 'win' || game.outcome === 'blackjack') accent = GREEN_ACCENT;
  if (game.outcome === 'lose') accent = RED_ACCENT;
  if (game.outcome === 'push') accent = YELLOW_ACCENT;
  return componentsPayload({ accent, components, files: [attachment] });
}

function clearGameTimer(game) {
  if (game?.timer) {
    clearTimeout(game.timer);
    game.timer = null;
  }
}

function botOutcome(game, outcome, summary, payout = 0) {
  game.status = 'finished';
  game.outcome = outcome;
  game.summary = summary;
  clearGameTimer(game);
  activeBotGames.delete(game.id);
  activeUserGames.delete(game.userId);
  endUserSession(game.userId, 'blackjack');
  if (payout > 0) {
    addBalance(game.userId, payout);
    recordGamblingEarnings(game.userId, payout);
  }
}

function finishBotGame(game, reason) {
  if (reason === 'player_blackjack') {
    const dealerHasBlackjack = isBlackjack(game.dealerHand);
    if (dealerHasBlackjack) {
      botOutcome(game, 'push', `Push! Both you and dealer hit Blackjack. Returned **${formatNumber(game.bet)}** ${PRCOIN}.`, game.bet);
      return;
    }
    const payout = Math.floor(game.bet * 2.5);
    botOutcome(game, 'blackjack', `BLACKJACK! You won **${formatNumber(payout)}** ${PRCOIN} with a 3:2 payout.`, payout);
    return;
  }

  if (reason === 'player_bust') {
    botOutcome(game, 'lose', `Bust! You went over 21 and lost **${formatNumber(game.bet)}** ${PRCOIN}.`, 0);
    return;
  }

  while (handValue(game.dealerHand) < 17) game.dealerHand.push(drawCard(game.deck));
  const playerScore = handValue(game.playerHand);
  const dealerScore = handValue(game.dealerHand);

  if (dealerScore > 21) {
    const payout = game.bet * 2;
    botOutcome(game, 'win', `Dealer busts! You won **${formatNumber(payout)}** ${PRCOIN}.`, payout);
  } else if (playerScore > dealerScore) {
    const payout = game.bet * 2;
    botOutcome(game, 'win', `You beat the dealer **${playerScore}** to **${dealerScore}** and won **${formatNumber(payout)}** ${PRCOIN}.`, payout);
  } else if (playerScore === dealerScore) {
    botOutcome(game, 'push', `Push at **${playerScore}**. Your **${formatNumber(game.bet)}** ${PRCOIN} bet was returned.`, game.bet);
  } else {
    botOutcome(game, 'lose', `Dealer wins **${dealerScore}** to **${playerScore}**. You lost **${formatNumber(game.bet)}** ${PRCOIN}.`, 0);
  }
}

function resetBotTimer(game) {
  clearGameTimer(game);
  game.timer = setTimeout(async () => {
    if (!activeBotGames.has(game.id) || game.status !== 'active') return;
    botOutcome(game, 'lose', `Table timed out. You forfeited **${formatNumber(game.bet)}** ${PRCOIN}.`, 0);
    await game.message?.edit(buildBotPayload(game)).catch(() => null);
  }, BLACKJACK_TURN_TIMEOUT_MS);
}

async function startBlackjack(interaction) {
  const blockReason = getCommandBlockReason(interaction.user.id, 'blackjack');
  if (blockReason) {
    await interaction.reply({ content: blockReason, flags: EPHEMERAL_FLAG });
    return;
  }
  if (activeUserGames.has(interaction.user.id)) {
    await interaction.reply({ content: 'You already have an active Blackjack game. Finish it first.', flags: EPHEMERAL_FLAG });
    return;
  }

  const rawAmount = interaction.options.getString('amount', true);
  const validation = validateBet(interaction.user.id, rawAmount);
  if (!validation.ok) {
    await interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG });
    return;
  }
  if (!spendBalance(interaction.user.id, validation.amount)) {
    await interaction.reply({ content: `You do not have enough ${PRCOIN} for that bet.`, flags: EPHEMERAL_FLAG });
    return;
  }

  const deck = makeDeck();
  const game = {
    id: createGameId(),
    type: 'blackjack',
    userId: interaction.user.id,
    username: interaction.user.username,
    bet: validation.amount,
    deck,
    playerHand: [drawCard(deck), drawCard(deck)],
    dealerHand: [drawCard(deck), drawCard(deck)],
    status: 'active',
    outcome: null,
    summary: null,
    message: null,
    timer: null,
  };

  setLastBetInput(interaction.user.id, rawAmount, 'blackjack');
  activeBotGames.set(game.id, game);
  activeUserGames.set(game.userId, game.id);
  startUserSession(game.userId, {
    type: 'blackjack',
    label: 'Blackjack',
    lockedCommand: 'blackjack',
    lockToCommand: true,
    lockMessage: 'You have an active Blackjack game. Use /blackjack controls until it ends.',
  });

  if (isBlackjack(game.playerHand)) finishBotGame(game, 'player_blackjack');
  await interaction.reply(buildBotPayload(game));
  game.message = await interaction.fetchReply().catch(() => null);
  if (game.status === 'active') resetBotTimer(game);
}

async function handleBlackjackInteraction(interaction) {
  if (!interaction.isButton?.()) return false;
  const customId = interaction.customId;
  if (typeof customId !== 'string' || !customId.startsWith('bj:')) return false;

  const [prefix, action, ownerId, gameId] = customId.split(':');
  if (prefix !== 'bj') return false;
  if (ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'You can only play your own Blackjack table.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const game = activeBotGames.get(gameId);
  if (!game || game.status !== 'active') {
    await interaction.reply({ content: 'This Blackjack game is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }

  if (action === 'hit') {
    game.playerHand.push(drawCard(game.deck));
    if (handValue(game.playerHand) > 21) finishBotGame(game, 'player_bust');
    else resetBotTimer(game);
    await interaction.update(buildBotPayload(game)).catch(async () => {
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Blackjack table updated.', flags: EPHEMERAL_FLAG }).catch(() => null);
    });
    return true;
  }

  if (action === 'stay') {
    finishBotGame(game, 'stay');
    await interaction.update(buildBotPayload(game)).catch(async () => {
      if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Blackjack table ended.', flags: EPHEMERAL_FLAG }).catch(() => null);
    });
    return true;
  }

  return true;
}

function otherPlayerId(challenge, userId) {
  return userId === challenge.challengerId ? challenge.targetId : challenge.challengerId;
}

function buildChallengePayload(challenge, status = 'pending') {
  let accent = BLUE_ACCENT;
  if (status === 'declined' || status === 'expired') accent = RED_ACCENT;
  if (status === 'accepted') accent = GREEN_ACCENT;
  const askerMention = `<@${challenge.askUserId}>`;
  const otherMention = `<@${otherPlayerId(challenge, challenge.askUserId)}>`;
  const lines = [
    '## ⚔️ PVP Blackjack Challenge',
    status === 'pending'
      ? `${otherMention} wants to play Blackjack against ${askerMention}.`
      : challenge.summary || 'Challenge updated.',
    `-# Current bet: **${formatNumber(challenge.amount)}** ${PRCOIN} each`,
  ];
  if (status === 'pending') {
    lines.push(`-# ${askerMention}, choose **Yes**, **No**, or **Higher Bet**.`);
  }

  const components = [text(lines.join('\n'))];
  if (status === 'pending') {
    components.push(separator());
    components.push(row(
      button(`pvpbj:accept:${challenge.id}`, 'Yes', 3, false, { name: '✅' }),
      button(`pvpbj:decline:${challenge.id}`, 'No', 4, false, { name: '✖️' }),
      button(`pvpbj:higher:${challenge.id}`, 'Higher Bet', 1, false, { name: '⬆️' }),
    ));
  }
  return componentsPayload({ accent, components });
}

function challengeUserBusy(userId) {
  return activeUserGames.has(userId) || activeChallengeUsers.has(userId);
}

function clearChallengeTimer(challenge) {
  if (challenge?.timer) {
    clearTimeout(challenge.timer);
    challenge.timer = null;
  }
}

function cleanupChallenge(challenge) {
  clearChallengeTimer(challenge);
  activeChallenges.delete(challenge.id);
  activeChallengeUsers.delete(challenge.challengerId);
  activeChallengeUsers.delete(challenge.targetId);
}

function resetChallengeTimer(challenge) {
  clearChallengeTimer(challenge);
  challenge.timer = setTimeout(async () => {
    if (!activeChallenges.has(challenge.id)) return;
    challenge.summary = 'Challenge expired before both players accepted.';
    cleanupChallenge(challenge);
    await challenge.message?.edit(buildChallengePayload(challenge, 'expired')).catch(() => null);
  }, PVP_CHALLENGE_TIMEOUT_MS);
}

async function startPvpChallenge(interaction) {
  const challenger = interaction.user;
  const target = interaction.options.getUser('user', true);
  const rawAmount = interaction.options.getString('amount', true);

  if (target.id === challenger.id) {
    await interaction.reply({ content: 'You cannot challenge yourself to PVP Blackjack.', flags: EPHEMERAL_FLAG });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: 'Challenge a real player, not a bot.', flags: EPHEMERAL_FLAG });
    return;
  }
  if (getCommandBlockReason(challenger.id, 'pvp-blackjack')) {
    await interaction.reply({ content: getCommandBlockReason(challenger.id, 'pvp-blackjack'), flags: EPHEMERAL_FLAG });
    return;
  }
  if (getCommandBlockReason(target.id, 'pvp-blackjack')) {
    await interaction.reply({ content: `${target} is currently locked in another game.`, flags: EPHEMERAL_FLAG });
    return;
  }
  if (challengeUserBusy(challenger.id)) {
    await interaction.reply({ content: 'You already have an active Blackjack game or pending challenge.', flags: EPHEMERAL_FLAG });
    return;
  }
  if (challengeUserBusy(target.id)) {
    await interaction.reply({ content: `${target} already has an active Blackjack game or pending challenge.`, flags: EPHEMERAL_FLAG });
    return;
  }

  const validation = validateBet(challenger.id, rawAmount);
  if (!validation.ok) {
    await interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG });
    return;
  }
  const targetBalance = getBalance(target.id);
  if (targetBalance < validation.amount) {
    await interaction.reply({ content: `${target} needs **${formatNumber(validation.amount)}** ${PRCOIN}, but only has **${formatNumber(targetBalance)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
    return;
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
  activeChallengeUsers.set(challenge.challengerId, challenge.id);
  activeChallengeUsers.set(challenge.targetId, challenge.id);
  setLastBetInput(challenger.id, rawAmount, 'pvp-blackjack');

  await interaction.reply(buildChallengePayload(challenge));
  challenge.message = await interaction.fetchReply().catch(() => null);
  resetChallengeTimer(challenge);
}

function buildPvpGamePayload(game) {
  const attachment = createTableAttachment(game, 'pvp');
  const reveal = game.status === 'finished';
  const current = game.players[game.turnIndex];
  const lines = [
    '## 🃏 PVP Blackjack',
    `-# Pot: **${formatNumber(game.bet * 2)}** ${PRCOIN} • Bet: **${formatNumber(game.bet)}** ${PRCOIN} each`,
  ];
  if (reveal) {
    for (const player of game.players) {
      lines.push(`-# ${player.mention}: ${handText(player.hand)} (**${handValue(player.hand)}**)${player.busted ? ' — BUST' : ''}`);
    }
    lines.push(`### ${game.summary}`);
  } else {
    lines.push(`### ${current.mention}'s turn`);
    lines.push('-# Cards stay hidden on the table. Hit results are sent privately.');
    for (const player of game.players) {
      const status = player.stayed ? (player.busted ? 'busted' : 'stayed') : `${player.hand.length} hidden card${player.hand.length === 1 ? '' : 's'}`;
      lines.push(`-# ${player.mention}: ${status}`);
    }
  }

  const components = [text(lines.join('\n')), gallery('blackjack-table.png'), separator()];
  if (reveal) {
    components.push(row(button(`pvpbj:game:done:${game.id}`, 'Game Over', 2, true, { name: '🏁' })));
  } else {
    components.push(row(
      button(`pvpbj:game:hit:${game.id}`, 'Hit', 1, false, { name: '🃏' }),
      button(`pvpbj:game:stay:${game.id}`, 'Stay', 2, false, { name: '✋' }),
    ));
  }

  let accent = BLUE_ACCENT;
  if (game.outcome === 'win') accent = GREEN_ACCENT;
  if (game.outcome === 'push') accent = YELLOW_ACCENT;
  return componentsPayload({ accent, components, files: [attachment] });
}

function resetPvpTimer(game) {
  clearGameTimer(game);
  game.timer = setTimeout(async () => {
    if (!activePvpGames.has(game.id) || game.status !== 'active') return;
    const current = game.players[game.turnIndex];
    current.stayed = true;
    await advanceOrFinishPvp(game);
    await game.message?.edit(buildPvpGamePayload(game)).catch(() => null);
  }, BLACKJACK_TURN_TIMEOUT_MS);
}

function currentPvpPlayer(game) {
  return game.players[game.turnIndex];
}

function advancePvpTurn(game) {
  for (let i = 1; i <= game.players.length; i += 1) {
    const nextIndex = (game.turnIndex + i) % game.players.length;
    const next = game.players[nextIndex];
    if (!next.stayed && !next.busted) {
      game.turnIndex = nextIndex;
      return true;
    }
  }
  return false;
}

function cleanupPvpGame(game) {
  clearGameTimer(game);
  activePvpGames.delete(game.id);
  for (const player of game.players) {
    activeUserGames.delete(player.id);
    endUserSession(player.id, 'pvp-blackjack');
  }
}

function settlePvpGame(game) {
  const [a, b] = game.players;
  const aScore = handValue(a.hand);
  const bScore = handValue(b.hand);
  const aValid = aScore <= 21;
  const bValid = bScore <= 21;
  let winner = null;

  if (aValid && !bValid) winner = a;
  else if (!aValid && bValid) winner = b;
  else if (aValid && bValid && aScore !== bScore) winner = aScore > bScore ? a : b;

  game.status = 'finished';
  if (winner) {
    const payout = game.bet * 2;
    addBalance(winner.id, payout);
    recordGamblingEarnings(winner.id, payout);
    game.outcome = 'win';
    game.summary = `${winner.mention} wins the pot of **${formatNumber(payout)}** ${PRCOIN}!`;
  } else {
    for (const player of game.players) addBalance(player.id, game.bet);
    game.outcome = 'push';
    game.summary = 'Push! Both bets were returned.';
  }
  cleanupPvpGame(game);
}

async function advanceOrFinishPvp(game) {
  const hasNext = advancePvpTurn(game);
  if (!hasNext) settlePvpGame(game);
  else resetPvpTimer(game);
}

async function startPvpGameFromChallenge(challenge, interaction) {
  const challengerValidation = validateBet(challenge.challengerId, String(challenge.amount));
  const targetValidation = validateBet(challenge.targetId, String(challenge.amount));
  if (!challengerValidation.ok || !targetValidation.ok) {
    await interaction.reply({ content: 'One of the players no longer has enough PRcoin for this bet.', flags: EPHEMERAL_FLAG });
    return;
  }

  const challengerSpent = spendBalance(challenge.challengerId, challenge.amount);
  if (!challengerSpent) {
    await interaction.reply({ content: `<@${challenge.challengerId}> no longer has enough ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
    return;
  }
  const targetSpent = spendBalance(challenge.targetId, challenge.amount);
  if (!targetSpent) {
    addBalance(challenge.challengerId, challenge.amount);
    await interaction.reply({ content: `<@${challenge.targetId}> no longer has enough ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
    return;
  }

  cleanupChallenge(challenge);
  const deck = makeDeck();
  const game = {
    id: createGameId(),
    type: 'pvp-blackjack',
    bet: challenge.amount,
    deck,
    players: [
      {
        id: challenge.challengerId,
        username: challenge.challengerName,
        mention: `<@${challenge.challengerId}>`,
        hand: [drawCard(deck), drawCard(deck)],
        stayed: false,
        busted: false,
      },
      {
        id: challenge.targetId,
        username: challenge.targetName,
        mention: `<@${challenge.targetId}>`,
        hand: [drawCard(deck), drawCard(deck)],
        stayed: false,
        busted: false,
      },
    ],
    turnIndex: 0,
    status: 'active',
    outcome: null,
    summary: null,
    message: challenge.message,
    timer: null,
  };

  activePvpGames.set(game.id, game);
  for (const player of game.players) {
    activeUserGames.set(player.id, game.id);
    startUserSession(player.id, {
      type: 'pvp-blackjack',
      label: 'PVP Blackjack',
      lockedCommand: 'pvp-blackjack',
      lockToCommand: true,
      lockMessage: 'You have an active PVP Blackjack game. Use the game buttons until it ends.',
    });
  }

  await interaction.deferUpdate().catch(() => null);
  await challenge.message?.edit(buildPvpGamePayload(game)).catch(() => null);
  resetPvpTimer(game);
}

async function handlePvpBlackjackInteraction(interaction) {
  const customId = interaction.customId;
  if (typeof customId !== 'string' || !customId.startsWith('pvpbj:')) return false;

  if (interaction.isButton?.()) {
    const parts = customId.split(':');
    const action = parts[1];

    if (['accept', 'decline', 'higher'].includes(action)) {
      const challengeId = parts[2];
      const challenge = activeChallenges.get(challengeId);
      if (!challenge) {
        await interaction.reply({ content: 'This PVP Blackjack challenge is no longer active.', flags: EPHEMERAL_FLAG });
        return true;
      }
      if (interaction.user.id !== challenge.askUserId) {
        await interaction.reply({ content: `Only <@${challenge.askUserId}> can answer this challenge right now.`, flags: EPHEMERAL_FLAG });
        return true;
      }

      if (action === 'decline') {
        challenge.summary = `${interaction.user} declined the PVP Blackjack challenge.`;
        cleanupChallenge(challenge);
        await interaction.update(buildChallengePayload(challenge, 'declined')).catch(() => null);
        return true;
      }

      if (action === 'higher') {
        await interaction.showModal({
          custom_id: `pvpbj:higher-modal:${challenge.id}`,
          title: 'Propose a Higher Bet',
          components: [
            {
              type: 18,
              label: `New bet above ${formatNumber(challenge.amount)} PRcoin`,
              component: {
                type: 4,
                custom_id: 'amount',
                style: 1,
                required: true,
                min_length: 1,
                max_length: 12,
                placeholder: 'Example: 5000, 5k, all',
                value: getLastBetInput(interaction.user.id, 'pvp-blackjack') || String(challenge.amount + 1),
              },
            },
          ],
        });
        return true;
      }

      await startPvpGameFromChallenge(challenge, interaction);
      return true;
    }

    if (action === 'game') {
      const gameAction = parts[2];
      const gameId = parts[3];
      const game = activePvpGames.get(gameId);
      if (!game || game.status !== 'active') {
        await interaction.reply({ content: 'This PVP Blackjack game is no longer active.', flags: EPHEMERAL_FLAG });
        return true;
      }
      const current = currentPvpPlayer(game);
      if (interaction.user.id !== current.id) {
        await interaction.reply({ content: `It is ${current.mention}'s turn.`, flags: EPHEMERAL_FLAG });
        return true;
      }

      if (gameAction === 'hit') {
        const card = drawCard(game.deck);
        current.hand.push(card);
        const score = handValue(current.hand);
        let privateMessage = `You drew **${cardShort(card)}**. Your current score is **${score}**.`;
        if (score > 21) {
          current.busted = true;
          current.stayed = true;
          privateMessage += ' You busted, so your turn is over.';
          await advanceOrFinishPvp(game);
        } else {
          resetPvpTimer(game);
        }
        await interaction.deferUpdate().catch(() => null);
        await interaction.followUp({ content: privateMessage, flags: EPHEMERAL_FLAG }).catch(() => null);
        await game.message?.edit(buildPvpGamePayload(game)).catch(() => null);
        return true;
      }

      if (gameAction === 'stay') {
        const score = handValue(current.hand);
        current.stayed = true;
        await advanceOrFinishPvp(game);
        await interaction.deferUpdate().catch(() => null);
        await interaction.followUp({ content: `You stayed at **${score}**.`, flags: EPHEMERAL_FLAG }).catch(() => null);
        await game.message?.edit(buildPvpGamePayload(game)).catch(() => null);
        return true;
      }

      return true;
    }
  }

  if (interaction.isModalSubmit?.()) {
    const [prefix, action, challengeId] = customId.split(':');
    if (prefix !== 'pvpbj' || action !== 'higher-modal') return false;
    const challenge = activeChallenges.get(challengeId);
    if (!challenge) {
      await interaction.reply({ content: 'This PVP Blackjack challenge is no longer active.', flags: EPHEMERAL_FLAG });
      return true;
    }
    if (interaction.user.id !== challenge.askUserId) {
      await interaction.reply({ content: `Only <@${challenge.askUserId}> can update this challenge right now.`, flags: EPHEMERAL_FLAG });
      return true;
    }

    const rawAmount = interaction.fields.getTextInputValue('amount');
    const proposed = parseBetInput(rawAmount, getBalance(interaction.user.id));
    if (!Number.isFinite(proposed) || proposed <= challenge.amount || proposed > PRCOIN_MAX_BET) {
      await interaction.reply({ content: `Higher bet must be above **${formatNumber(challenge.amount)}** and no more than **${formatNumber(PRCOIN_MAX_BET)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
      return true;
    }
    if (getBalance(interaction.user.id) < proposed) {
      await interaction.reply({ content: `You do not have **${formatNumber(proposed)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
      return true;
    }
    const otherId = otherPlayerId(challenge, interaction.user.id);
    if (getBalance(otherId) < proposed) {
      await interaction.reply({ content: `<@${otherId}> does not have **${formatNumber(proposed)}** ${PRCOIN}.`, flags: EPHEMERAL_FLAG });
      return true;
    }

    challenge.amount = proposed;
    challenge.askUserId = otherId;
    challenge.summary = null;
    setLastBetInput(interaction.user.id, rawAmount, 'pvp-blackjack');
    resetChallengeTimer(challenge);
    await interaction.reply({ content: `Higher bet proposed: **${formatNumber(proposed)}** ${PRCOIN}. Waiting for <@${otherId}>.`, flags: EPHEMERAL_FLAG });
    await challenge.message?.edit(buildChallengePayload(challenge)).catch(() => null);
    return true;
  }

  return false;
}

function shouldLogBlackjackInteraction(interaction) {
  const id = interaction.customId || '';
  return !(typeof id === 'string' && (id.startsWith('bj:') || id.startsWith('pvpbj:')));
}

module.exports = {
  COMPONENTS_V2_FLAG,
  EPHEMERAL_FLAG,
  PRCOIN_MIN_BET,
  PRCOIN_MAX_BET,
  startBlackjack,
  handleBlackjackInteraction,
  startPvpChallenge,
  handlePvpBlackjackInteraction,
  shouldLogBlackjackInteraction,
  simplePanel,
};
