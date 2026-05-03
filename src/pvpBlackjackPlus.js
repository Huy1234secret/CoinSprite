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
const MAX_BET = 100_000;
const MIN_BET = 1;
const TURN_TIMEOUT_MS = 60_000;
const CHALLENGE_TIMEOUT_MS = 120_000;
const SUFFIX_MULTIPLIERS = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };
const PREFIX = 'pvpbjp';

const SUITS = [
  { symbol: 'S', display: 'Spades', color: '#111214' },
  { symbol: 'H', display: 'Hearts', color: '#ed4245' },
  { symbol: 'D', display: 'Diamonds', color: '#ed4245' },
  { symbol: 'C', display: 'Clubs', color: '#111214' },
];
const RANKS = [
  { label: 'A', value: 11 }, { label: '2', value: 2 }, { label: '3', value: 3 }, { label: '4', value: 4 },
  { label: '5', value: 5 }, { label: '6', value: 6 }, { label: '7', value: 7 }, { label: '8', value: 8 },
  { label: '9', value: 9 }, { label: '10', value: 10 }, { label: 'J', value: 10 }, { label: 'Q', value: 10 }, { label: 'K', value: 10 },
];

const activeChallenges = new Map();
const activeGames = new Map();
const busyUsers = new Map();

function createGameId() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
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
  if (!Number.isFinite(amount) || amount < MIN_BET || amount > MAX_BET) return { ok: false, amount, balance, message: `Bet must be between ${formatNumber(MIN_BET)} and ${formatNumber(MAX_BET)} ${PRCOIN}.` };
  if (balance < amount) return { ok: false, amount, balance, message: `You need ${formatNumber(amount)} ${PRCOIN}. Your current balance is ${formatNumber(balance)} ${PRCOIN}.` };
  return { ok: true, amount, balance };
}
function makeDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANKS) deck.push({ ...rank, suit: suit.symbol, suitDisplay: suit.display, color: suit.color });
  for (let i = deck.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return deck;
}
function drawCard(deck) { if (!deck.length) deck.push(...makeDeck()); return deck.pop(); }
function handValue(hand) {
  let total = 0; let aces = 0;
  for (const card of hand) { total += card.value; if (card.label === 'A') aces += 1; }
  while (total > 21 && aces > 0) { total -= 10; aces -= 1; }
  return total;
}
function cardShort(card) { return `${card.label} ${card.suitDisplay}`; }
function handLine(hand) { return hand.map(cardShort).join(', '); }
function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function gallery(fileName) { return { type: 12, items: [{ media: { url: `attachment://${fileName}` } }] }; }
function payload(accent, components, files = []) { const data = { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: accent, components }] }; if (files.length) data.files = files; return data; }
function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + width - r, y); ctx.quadraticCurveTo(x + width, y, x + width, y + r); ctx.lineTo(x + width, y + height - r); ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height); ctx.lineTo(x + r, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - r); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
}
function drawHeart(ctx, cx, cy, size, color) { const s = size / 100; ctx.save(); ctx.translate(cx, cy); ctx.scale(s, s); ctx.beginPath(); ctx.moveTo(0, 34); ctx.bezierCurveTo(-55, -8, -36, -54, 0, -30); ctx.bezierCurveTo(36, -54, 55, -8, 0, 34); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); ctx.restore(); }
function drawDiamond(ctx, cx, cy, size, color) { ctx.beginPath(); ctx.moveTo(cx, cy - size / 2); ctx.lineTo(cx + size * 0.42, cy); ctx.lineTo(cx, cy + size / 2); ctx.lineTo(cx - size * 0.42, cy); ctx.closePath(); ctx.fillStyle = color; ctx.fill(); }
function drawClub(ctx, cx, cy, size, color) { const r = size * 0.18; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(cx, cy - size * 0.18, r, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx - size * 0.2, cy + size * 0.04, r, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.arc(cx + size * 0.2, cy + size * 0.04, r, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.moveTo(cx - size * 0.08, cy + size * 0.15); ctx.lineTo(cx + size * 0.08, cy + size * 0.15); ctx.lineTo(cx + size * 0.16, cy + size * 0.43); ctx.lineTo(cx - size * 0.16, cy + size * 0.43); ctx.closePath(); ctx.fill(); }
function drawSpade(ctx, cx, cy, size, color) { ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI); drawHeart(ctx, 0, 0, size, color); ctx.restore(); ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(cx - size * 0.09, cy + size * 0.12); ctx.lineTo(cx + size * 0.09, cy + size * 0.12); ctx.lineTo(cx + size * 0.18, cy + size * 0.43); ctx.lineTo(cx - size * 0.18, cy + size * 0.43); ctx.closePath(); ctx.fill(); }
function drawSuitImage(ctx, card, cx, cy, size) { if (card.suit === 'H') drawHeart(ctx, cx, cy, size, card.color); else if (card.suit === 'D') drawDiamond(ctx, cx, cy, size, card.color); else if (card.suit === 'C') drawClub(ctx, cx, cy, size, card.color); else drawSpade(ctx, cx, cy, size, card.color); }
function drawHiddenCard(ctx, x, y, w, h) { ctx.shadowColor = 'rgba(0, 0, 0, 0.28)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 4; roundedRect(ctx, x, y, w, h, 18); ctx.fillStyle = '#2b2d31'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#5865f2'; ctx.lineWidth = 4; ctx.stroke(); roundedRect(ctx, x + 12, y + 12, w - 24, h - 24, 12); ctx.fillStyle = '#1f2126'; ctx.fill(); ctx.fillStyle = '#ffffff'; ctx.font = 'bold 52px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('?', x + w / 2, y + h / 2); }
function drawCardFace(ctx, card, x, y, w, h) { ctx.shadowColor = 'rgba(0, 0, 0, 0.22)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 4; roundedRect(ctx, x, y, w, h, 18); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#d7dce2'; ctx.lineWidth = 3; ctx.stroke(); ctx.fillStyle = card.color; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.font = card.label === '10' ? 'bold 28px sans-serif' : 'bold 34px sans-serif'; ctx.fillText(card.label, x + 13, y + 11); drawSuitImage(ctx, card, x + w / 2, y + h / 2 + 12, 76); }
function drawHand(ctx, hand, x, y, reveal, maxWidth = 390) { const cardW = 92; const cardH = 132; const overlap = hand.length > 5 ? Math.max(42, Math.floor((maxWidth - cardW) / Math.max(1, hand.length - 1))) : 70; for (let i = 0; i < hand.length; i += 1) { const cx = x + i * overlap; if (reveal) drawCardFace(ctx, hand[i], cx, y, cardW, cardH); else drawHiddenCard(ctx, cx, y, cardW, cardH); } }
function fitText(ctx, value, x, y, maxWidth, baseSize = 28) { let size = baseSize; do { ctx.font = `bold ${size}px sans-serif`; if (ctx.measureText(value).width <= maxWidth) break; size -= 1; } while (size >= 14); ctx.fillText(value, x, y); }
function tableAttachment(game) {
  const width = 1000; const height = 590; const canvas = createCanvas(width, height); const ctx = canvas.getContext('2d'); const gradient = ctx.createLinearGradient(0, 0, width, height); gradient.addColorStop(0, '#0f5132'); gradient.addColorStop(0.45, '#0b7d3b'); gradient.addColorStop(1, '#064e3b'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height); ctx.strokeStyle = '#f8d66d'; ctx.lineWidth = 10; roundedRect(ctx, 22, 22, width - 44, height - 44, 34); ctx.stroke(); ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = 2; roundedRect(ctx, 58, 72, width - 116, height - 134, 280); ctx.stroke();
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.font = 'bold 38px sans-serif'; ctx.fillText('PVP BLACKJACK', width / 2, 58); ctx.font = 'bold 18px sans-serif'; ctx.fillStyle = '#f6f1c9'; ctx.fillText(`${formatNumber(game.bet)} PRcoin each`, width / 2, 84);
  const reveal = game.status === 'finished'; const [left, right] = game.players; const current = game.players[game.turnIndex];
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left'; fitText(ctx, `${left.username}${current?.id === left.id && !reveal ? '  • TURN' : ''}`, 76, 132, 420, 28); ctx.font = '18px sans-serif'; ctx.fillStyle = '#d7dce2'; ctx.fillText(reveal ? `Score: ${handValue(left.hand)}` : `${left.hand.length} hidden cards`, 76, 158); drawHand(ctx, left.hand, 76, 186, reveal, 390);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'right'; fitText(ctx, `${right.username}${current?.id === right.id && !reveal ? '  • TURN' : ''}`, 924, 132, 420, 28); ctx.font = '18px sans-serif'; ctx.fillStyle = '#d7dce2'; ctx.fillText(reveal ? `Score: ${handValue(right.hand)}` : `${right.hand.length} hidden cards`, 924, 158); drawHand(ctx, right.hand, 534, 186, reveal, 390);
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffffff'; ctx.font = 'bold 24px sans-serif'; ctx.fillText(reveal ? (game.summaryText || 'Game finished') : `${current?.username || 'Player'} is deciding...`, width / 2, 510);
  return new AttachmentBuilder(canvas.toBuffer('image/png'), { name: 'pvp-blackjack-table.png' });
}
function ansiYellow(content) { const esc = String.fromCharCode(27); return `\`\`\`ansi\n${esc}[33m${content}${esc}[0m\n\`\`\``; }
function buildChallengePayload(challenge, state = 'pending') { const asker = `<@${challenge.askUserId}>`; const other = `<@${otherPlayerId(challenge, challenge.askUserId)}>`; const lines = ['## PVP Blackjack Challenge', state === 'pending' ? `${other} wants to play Blackjack against ${asker}.` : challenge.summary || 'Challenge ended.', `-# Current bet: ${formatNumber(challenge.amount)} ${PRCOIN} each`]; if (state === 'pending') lines.push(`-# ${asker}, choose Yes, No, or Higher Bet. Max bet: ${formatNumber(MAX_BET)} ${PRCOIN}.`); const components = [text(lines.join('\n'))]; if (state === 'pending') { components.push(separator()); components.push(row(button(`${PREFIX}:accept:${challenge.id}`, 'Yes', 3), button(`${PREFIX}:decline:${challenge.id}`, 'No', 4), button(`${PREFIX}:higher:${challenge.id}`, 'Higher Bet', 1))); } return payload(state === 'pending' ? BLUE_ACCENT : RED_ACCENT, components); }
function buildGamePayload(game) { const reveal = game.status === 'finished'; const attachment = tableAttachment(game); const lines = ['## PVP Blackjack', `-# Pot: ${formatNumber(game.bet * 2)} ${PRCOIN} • Bet: ${formatNumber(game.bet)} ${PRCOIN} each`]; if (reveal) { for (const player of game.players) lines.push(`-# ${player.mention}: ${handLine(player.hand)} (${handValue(player.hand)})${player.busted ? ' — BUST' : ''}`); lines.push(game.summary || 'Game finished.'); if (game.winAmount > 0) lines.push(ansiYellow(`Won: ${formatNumber(game.winAmount)} PRcoin`)); } else { const current = game.players[game.turnIndex]; lines.push(`### ${current.mention}'s turn`); lines.push('-# Cards stay hidden on the table. Use Show Cards to privately view your hand and score.'); for (const player of game.players) { const status = player.stayed ? (player.busted ? 'busted' : 'stayed') : `${player.hand.length} hidden cards`; lines.push(`-# ${player.mention}: ${status}`); } } const components = [text(lines.join('\n')), gallery('pvp-blackjack-table.png'), separator()]; if (reveal) components.push(row(button(`${PREFIX}:done:${game.id}`, 'Game Over', 2, true))); else components.push(row(button(`${PREFIX}:hit:${game.id}`, 'Hit', 1), button(`${PREFIX}:stay:${game.id}`, 'Stay', 2), button(`${PREFIX}:show:${game.id}`, 'Show Cards', 2))); let accent = BLUE_ACCENT; if (game.status === 'finished' && game.outcome === 'push') accent = YELLOW_ACCENT; if (game.status === 'finished' && game.outcome === 'win') accent = GREEN_ACCENT; return payload(accent, components, [attachment]); }
function otherPlayerId(challenge, userId) { return userId === challenge.challengerId ? challenge.targetId : challenge.challengerId; }
function markBusy(userId, type, id) { busyUsers.set(userId, { type, id }); }
function clearBusy(userId) { busyUsers.delete(userId); }
function isBusy(userId) { return busyUsers.has(userId); }
function clearTimer(item) { if (item?.timer) { clearTimeout(item.timer); item.timer = null; } }
function cleanupChallenge(challenge) { clearTimer(challenge); activeChallenges.delete(challenge.id); clearBusy(challenge.challengerId); clearBusy(challenge.targetId); }
function cleanupGame(game) { clearTimer(game); activeGames.delete(game.id); for (const player of game.players) { clearBusy(player.id); endUserSession(player.id, 'pvp-blackjack'); } }
function resetChallengeTimer(challenge) { clearTimer(challenge); challenge.timer = setTimeout(async () => { if (!activeChallenges.has(challenge.id)) return; challenge.summary = 'Challenge expired before both players accepted.'; cleanupChallenge(challenge); await challenge.message?.edit(buildChallengePayload(challenge, 'expired')).catch(() => null); }, CHALLENGE_TIMEOUT_MS); }
function currentPlayer(game) { return game.players[game.turnIndex]; }
function getPlayer(game, userId) { return game.players.find((player) => player.id === userId) || null; }
function advanceTurn(game) { for (let i = 1; i <= game.players.length; i += 1) { const nextIndex = (game.turnIndex + i) % game.players.length; const next = game.players[nextIndex]; if (!next.stayed && !next.busted) { game.turnIndex = nextIndex; return true; } } return false; }
function resetGameTimer(game) { clearTimer(game); game.timer = setTimeout(async () => { if (!activeGames.has(game.id) || game.status !== 'active') return; currentPlayer(game).stayed = true; advanceOrFinish(game); await game.message?.edit(buildGamePayload(game)).catch(() => null); }, TURN_TIMEOUT_MS); }
function settleGame(game) { const [a, b] = game.players; const aScore = handValue(a.hand); const bScore = handValue(b.hand); const aValid = aScore <= 21; const bValid = bScore <= 21; let winner = null; if (aValid && !bValid) winner = a; else if (!aValid && bValid) winner = b; else if (aValid && bValid && aScore !== bScore) winner = aScore > bScore ? a : b; game.status = 'finished'; if (winner) { const pot = game.bet * 2; addBalance(winner.id, pot); recordGamblingEarnings(winner.id, pot); game.outcome = 'win'; game.winAmount = pot; game.summary = `${winner.mention} wins the pot.`; game.summaryText = `${winner.username} wins ${formatNumber(pot)} PRcoin`; } else { for (const player of game.players) addBalance(player.id, game.bet); game.outcome = 'push'; game.winAmount = 0; game.summary = 'Push! Both bets were returned.'; game.summaryText = 'Push — bets returned'; } cleanupGame(game); }
function advanceOrFinish(game) { if (!advanceTurn(game)) settleGame(game); else resetGameTimer(game); }
async function startPvpChallenge(interaction) { const challenger = interaction.user; const target = interaction.options.getUser('user', true); const rawAmount = interaction.options.getString('amount', true); const blockReason = getCommandBlockReason(challenger.id, 'pvp-blackjack'); if (blockReason) { await interaction.reply({ content: blockReason, flags: EPHEMERAL_FLAG }); return; } if (target.id === challenger.id) { await interaction.reply({ content: 'You cannot challenge yourself to PVP Blackjack.', flags: EPHEMERAL_FLAG }); return; } if (target.bot) { await interaction.reply({ content: 'Challenge a real player, not a bot.', flags: EPHEMERAL_FLAG }); return; } if (isBusy(challenger.id)) { await interaction.reply({ content: 'You already have an active PVP Blackjack game or challenge.', flags: EPHEMERAL_FLAG }); return; } if (isBusy(target.id)) { await interaction.reply({ content: `${target} already has an active PVP Blackjack game or challenge.`, flags: EPHEMERAL_FLAG }); return; } const validation = validateBet(challenger.id, rawAmount); if (!validation.ok) { await interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG }); return; } const targetBalance = getBalance(target.id); if (targetBalance < validation.amount) { await interaction.reply({ content: `${target} needs ${formatNumber(validation.amount)} ${PRCOIN}, but only has ${formatNumber(targetBalance)} ${PRCOIN}.`, flags: EPHEMERAL_FLAG }); return; } const challenge = { id: createGameId(), challengerId: challenger.id, challengerName: challenger.username, targetId: target.id, targetName: target.username, amount: validation.amount, askUserId: target.id, message: null, timer: null, summary: null }; activeChallenges.set(challenge.id, challenge); markBusy(challenger.id, 'challenge', challenge.id); markBusy(target.id, 'challenge', challenge.id); setLastBetInput(challenger.id, rawAmount, 'pvp-blackjack'); await interaction.reply(buildChallengePayload(challenge)); challenge.message = await interaction.fetchReply().catch(() => null); resetChallengeTimer(challenge); }
async function beginGame(challenge, interaction) { const challengerValidation = validateBet(challenge.challengerId, String(challenge.amount)); const targetValidation = validateBet(challenge.targetId, String(challenge.amount)); if (!challengerValidation.ok || !targetValidation.ok) { await interaction.reply({ content: 'One player no longer has enough PRcoin for this bet.', flags: EPHEMERAL_FLAG }); return; } if (!spendBalance(challenge.challengerId, challenge.amount)) { await interaction.reply({ content: `<@${challenge.challengerId}> no longer has enough ${PRCOIN}.`, flags: EPHEMERAL_FLAG }); return; } if (!spendBalance(challenge.targetId, challenge.amount)) { addBalance(challenge.challengerId, challenge.amount); await interaction.reply({ content: `<@${challenge.targetId}> no longer has enough ${PRCOIN}.`, flags: EPHEMERAL_FLAG }); return; } cleanupChallenge(challenge); const deck = makeDeck(); const game = { id: createGameId(), bet: challenge.amount, deck, players: [{ id: challenge.challengerId, username: challenge.challengerName, mention: `<@${challenge.challengerId}>`, hand: [drawCard(deck), drawCard(deck)], stayed: false, busted: false }, { id: challenge.targetId, username: challenge.targetName, mention: `<@${challenge.targetId}>`, hand: [drawCard(deck), drawCard(deck)], stayed: false, busted: false }], turnIndex: 0, status: 'active', outcome: null, winAmount: 0, summary: null, summaryText: null, message: challenge.message, timer: null }; activeGames.set(game.id, game); for (const player of game.players) { markBusy(player.id, 'game', game.id); startUserSession(player.id, { type: 'pvp-blackjack', label: 'PVP Blackjack', lockedCommand: 'pvp-blackjack', lockToCommand: true, lockMessage: 'You have an active PVP Blackjack game. Use the game buttons until it ends.' }); } await interaction.deferUpdate().catch(() => null); await game.message?.edit(buildGamePayload(game)).catch(() => null); resetGameTimer(game); }
async function handlePvpInteraction(interaction) { const customId = interaction.customId; if (typeof customId !== 'string' || !customId.startsWith(`${PREFIX}:`)) return false; if (interaction.isModalSubmit?.()) { const [, action, challengeId] = customId.split(':'); if (action !== 'higher') return false; const challenge = activeChallenges.get(challengeId); if (!challenge) { await interaction.reply({ content: 'This challenge is no longer active.', flags: EPHEMERAL_FLAG }); return true; } if (interaction.user.id !== challenge.askUserId) { await interaction.reply({ content: `Only <@${challenge.askUserId}> can update this challenge right now.`, flags: EPHEMERAL_FLAG }); return true; } const rawAmount = interaction.fields.getTextInputValue('amount'); const amount = parseBetInput(rawAmount, getBalance(interaction.user.id)); if (!Number.isFinite(amount) || amount <= challenge.amount || amount > MAX_BET) { await interaction.reply({ content: `Higher bet must be above ${formatNumber(challenge.amount)} and no more than ${formatNumber(MAX_BET)} ${PRCOIN}.`, flags: EPHEMERAL_FLAG }); return true; } const otherId = otherPlayerId(challenge, interaction.user.id); if (getBalance(interaction.user.id) < amount) { await interaction.reply({ content: `You do not have ${formatNumber(amount)} ${PRCOIN}.`, flags: EPHEMERAL_FLAG }); return true; } if (getBalance(otherId) < amount) { await interaction.reply({ content: `<@${otherId}> does not have ${formatNumber(amount)} ${PRCOIN}.`, flags: EPHEMERAL_FLAG }); return true; } challenge.amount = amount; challenge.askUserId = otherId; setLastBetInput(interaction.user.id, rawAmount, 'pvp-blackjack'); resetChallengeTimer(challenge); await interaction.reply({ content: `Higher bet proposed: ${formatNumber(amount)} ${PRCOIN}. Waiting for <@${otherId}>.`, flags: EPHEMERAL_FLAG }); await challenge.message?.edit(buildChallengePayload(challenge)).catch(() => null); return true; } if (!interaction.isButton?.()) return false; const [, action, id] = customId.split(':'); if (['accept', 'decline', 'higher'].includes(action)) { const challenge = activeChallenges.get(id); if (!challenge) { await interaction.reply({ content: 'This challenge is no longer active.', flags: EPHEMERAL_FLAG }); return true; } if (interaction.user.id !== challenge.askUserId) { await interaction.reply({ content: `Only <@${challenge.askUserId}> can answer this challenge right now.`, flags: EPHEMERAL_FLAG }); return true; } if (action === 'decline') { challenge.summary = `${interaction.user} declined the PVP Blackjack challenge.`; cleanupChallenge(challenge); await interaction.update(buildChallengePayload(challenge, 'declined')).catch(() => null); return true; } if (action === 'higher') { await interaction.showModal({ custom_id: `${PREFIX}:higher:${challenge.id}`, title: 'Propose Higher Bet', components: [{ type: 18, label: `New bet, max ${formatNumber(MAX_BET)} PRcoin`, component: { type: 4, custom_id: 'amount', style: 1, required: true, min_length: 1, max_length: 12, placeholder: 'Example: 5000, 5k, all', value: getLastBetInput(interaction.user.id, 'pvp-blackjack') || String(Math.min(MAX_BET, challenge.amount + 1)) } }] }); return true; } await beginGame(challenge, interaction); return true; } const game = activeGames.get(id); if (!game || game.status !== 'active') { await interaction.reply({ content: 'This PVP Blackjack game is no longer active.', flags: EPHEMERAL_FLAG }); return true; } const player = getPlayer(game, interaction.user.id); if (!player) { await interaction.reply({ content: 'Only players in this match can use these buttons.', flags: EPHEMERAL_FLAG }); return true; } if (action === 'show') { await interaction.reply({ content: [`Your cards: ${handLine(player.hand)}`, `Total points: ${handValue(player.hand)}`].join('\n'), flags: EPHEMERAL_FLAG }); return true; } const current = currentPlayer(game); if (interaction.user.id !== current.id) { await interaction.reply({ content: `It is ${current.mention}'s turn.`, flags: EPHEMERAL_FLAG }); return true; } if (action === 'hit') { const card = drawCard(game.deck); current.hand.push(card); const score = handValue(current.hand); let privateMessage = `You drew ${cardShort(card)}. Your current score is ${score}.`; if (score > 21) { current.busted = true; current.stayed = true; privateMessage += ' You busted, so your turn is over.'; advanceOrFinish(game); } else resetGameTimer(game); await interaction.deferUpdate().catch(() => null); await interaction.followUp({ content: privateMessage, flags: EPHEMERAL_FLAG }).catch(() => null); await game.message?.edit(buildGamePayload(game)).catch(() => null); return true; } if (action === 'stay') { const score = handValue(current.hand); current.stayed = true; advanceOrFinish(game); await interaction.deferUpdate().catch(() => null); await interaction.followUp({ content: `You stayed at ${score}.`, flags: EPHEMERAL_FLAG }).catch(() => null); await game.message?.edit(buildGamePayload(game)).catch(() => null); return true; } return true; }
function shouldLogPvpBlackjackInteraction(interaction) { const id = interaction.customId || ''; return !(typeof id === 'string' && id.startsWith(`${PREFIX}:`)); }
module.exports = { startPvpChallenge, handlePvpInteraction, shouldLogPvpBlackjackInteraction };
