const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, spendBalance, addBalance, recordGamblingEarnings, setLastBetInput } = require('../src/gamblingStore');
const { PRCOIN, formatNumber } = require('../src/gamblingConfig');
const { startUserSession, endUserSession, getCommandBlockReason } = require('../src/gameSessionLock');
const { replyIfOnCooldown, setCommandCooldown } = require('../src/commandCooldowns');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const MIN_BET = 100;
const MAX_BET = 100_000;
const COOLDOWN_MS = 30_000;
const INACTIVE_MS = 30_000;
const PREFIX = 'bjcool';
const activeGames = new Map();
const activeUsers = new Map();
const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = [['A', 11], ['2', 2], ['3', 3], ['4', 4], ['5', 5], ['6', 6], ['7', 7], ['8', 8], ['9', 9], ['10', 10], ['J', 10], ['Q', 10], ['K', 10]];
const MULTIPLIERS = { k: 1_000, m: 1_000_000, b: 1_000_000_000, t: 1_000_000_000_000 };

function id() { return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }
function parseBet(raw, balance = null) {
  const compact = String(raw || '').trim().toLowerCase().replace(/,/g, '').replace(/\s+/g, '');
  if (['all', 'max'].includes(compact)) return Math.floor(Number(balance) || 0);
  const match = compact.match(/^(\d+(?:\.\d+)?)([kmbt])?$/);
  if (!match) return NaN;
  return Math.floor(Number(match[1]) * (MULTIPLIERS[match[2]] || 1));
}
function validateBet(userId, raw) {
  const balance = getBalance(userId);
  const amount = parseBet(raw, balance);
  if (!Number.isFinite(amount) || amount < MIN_BET || amount > MAX_BET) return { ok: false, message: `Bet must be between **${formatNumber(MIN_BET)}** and **${formatNumber(MAX_BET)}** ${PRCOIN}.` };
  if (balance < amount) return { ok: false, message: `You need **${formatNumber(amount)}** ${PRCOIN}. Your current balance is **${formatNumber(balance)}** ${PRCOIN}.` };
  return { ok: true, amount };
}
function deck() {
  const cards = SUITS.flatMap((suit) => RANKS.map(([rank, value]) => ({ rank, suit, value })));
  for (let i = cards.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}
function draw(game) { if (!game.deck.length) game.deck.push(...deck()); return game.deck.pop(); }
function score(hand) { let total = 0; let aces = 0; for (const card of hand) { total += card.value; if (card.rank === 'A') aces += 1; } while (total > 21 && aces > 0) { total -= 10; aces -= 1; } return total; }
function isBlackjack(hand) { return hand.length === 2 && score(hand) === 21; }
function card(cardValue) { return `\`${cardValue.rank}${cardValue.suit}\``; }
function handText(hand, hideDealer = false) { return hideDealer ? `${card(hand[0])} \`??\`` : hand.map(card).join(' '); }
function text(content) { return { type: 10, content }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function panel(game) {
  const active = game.status === 'active';
  const lines = [
    `## ${game.username}'s Blackjack Table`,
    `-# Bet: **${formatNumber(game.bet)}** ${PRCOIN}`,
    active ? `-# Your hand: ${handText(game.player)} (**${score(game.player)}**) | Dealer: ${handText(game.dealer, true)}` : `-# Your hand: ${handText(game.player)} (**${score(game.player)}**) | Dealer: ${handText(game.dealer)} (**${score(game.dealer)}**)`,
    game.summary ? `### ${game.summary}` : '-# Hit to draw. Stay to let the dealer play.',
  ];
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: game.outcome === 'win' || game.outcome === 'blackjack' ? 0x57f287 : game.outcome === 'lose' ? 0xed4245 : game.outcome === 'push' ? 0xfee75c : 0xffffff,
      components: [text(lines.join('\n')), { type: 14, divider: true, spacing: 1 }, row(button(`${PREFIX}:hit:${game.userId}:${game.id}`, 'Hit', 1, !active), button(`${PREFIX}:stay:${game.userId}:${game.id}`, 'Stay', 2, !active))],
    }],
  };
}
function cleanup(game) { if (game.timer) clearTimeout(game.timer); activeGames.delete(game.id); activeUsers.delete(game.userId); endUserSession(game.userId, 'blackjack'); }
function finish(game, outcome, summary, payout = 0, earnings = payout) { game.status = 'finished'; game.outcome = outcome; game.summary = summary; cleanup(game); if (payout > 0) addBalance(game.userId, payout); if (earnings > 0) recordGamblingEarnings(game.userId, earnings); }
function finishDealer(game) {
  while (score(game.dealer) < 17) game.dealer.push(draw(game));
  const playerScore = score(game.player);
  const dealerScore = score(game.dealer);
  if (dealerScore > 21) return finish(game, 'win', `Dealer busts. You won **${formatNumber(game.bet * 2)}** ${PRCOIN}.`, game.bet * 2);
  if (playerScore > dealerScore) return finish(game, 'win', `You beat the dealer **${playerScore}** to **${dealerScore}** and won **${formatNumber(game.bet * 2)}** ${PRCOIN}.`, game.bet * 2);
  if (playerScore === dealerScore) return finish(game, 'push', `Push at **${playerScore}**. Your bet was returned.`, game.bet, 0);
  return finish(game, 'lose', `Dealer wins **${dealerScore}** to **${playerScore}**.`, 0);
}
function resetTimer(game) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(async () => {
    if (!activeGames.has(game.id) || game.status !== 'active') return;
    finish(game, 'push', `Table timed out after 30 seconds of inactivity. Returned **${formatNumber(game.bet)}** ${PRCOIN}.`, game.bet, 0);
    await game.message?.edit(panel(game)).catch(() => null);
  }, INACTIVE_MS);
  if (typeof game.timer.unref === 'function') game.timer.unref();
}

module.exports = {
  data: new SlashCommandBuilder().setName('blackjack').setDescription('Play Blackjack against the dealer with PRcoin').addStringOption((option) => option.setName('amount').setDescription('Enter your PRcoin bet amount, min 100').setRequired(true)),
  suppressCommandLog: true,
  async execute(interaction) {
    if (await replyIfOnCooldown(interaction, 'blackjack', COOLDOWN_MS, EPHEMERAL_FLAG)) return;
    const blockReason = getCommandBlockReason(interaction.user.id, 'blackjack');
    if (blockReason) return interaction.reply({ content: blockReason, flags: EPHEMERAL_FLAG });
    if (activeUsers.has(interaction.user.id)) return interaction.reply({ content: 'You already have an active Blackjack game. Finish it first.', flags: EPHEMERAL_FLAG });
    const raw = interaction.options.getString('amount', true);
    const validation = validateBet(interaction.user.id, raw);
    if (!validation.ok) return interaction.reply({ content: validation.message, flags: EPHEMERAL_FLAG });
    if (!spendBalance(interaction.user.id, validation.amount)) return interaction.reply({ content: `You do not have enough ${PRCOIN} for that bet.`, flags: EPHEMERAL_FLAG });
    const game = { id: id(), userId: interaction.user.id, username: interaction.user.username, bet: validation.amount, deck: deck(), player: [], dealer: [], status: 'active', outcome: null, summary: null, timer: null, message: null };
    game.player.push(draw(game), draw(game));
    game.dealer.push(draw(game), draw(game));
    setLastBetInput(interaction.user.id, raw, 'blackjack');
    setCommandCooldown(interaction.user.id, 'blackjack', COOLDOWN_MS);
    activeGames.set(game.id, game);
    activeUsers.set(game.userId, game.id);
    startUserSession(game.userId, { type: 'blackjack', label: 'Blackjack', lockedCommand: 'blackjack', lockToCommand: true, lockMessage: 'You have an active Blackjack game. Use /blackjack controls until it ends.' });
    if (isBlackjack(game.player)) {
      if (isBlackjack(game.dealer)) finish(game, 'push', `Push! Both you and dealer hit Blackjack. Returned **${formatNumber(game.bet)}** ${PRCOIN}.`, game.bet, 0);
      else finish(game, 'blackjack', `BLACKJACK! You won **${formatNumber(Math.floor(game.bet * 2.5))}** ${PRCOIN}.`, Math.floor(game.bet * 2.5));
    }
    await interaction.reply(panel(game));
    game.message = await interaction.fetchReply().catch(() => null);
    if (game.status === 'active') resetTimer(game);
  },
  shouldLogInteraction(interaction) { return !(typeof interaction.customId === 'string' && interaction.customId.startsWith(`${PREFIX}:`)); },
  async handleInteraction(interaction) {
    if (!interaction.isButton?.() || !interaction.customId?.startsWith(`${PREFIX}:`)) return false;
    const [, action, ownerId, gameId] = interaction.customId.split(':');
    if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only play your own Blackjack table.', flags: EPHEMERAL_FLAG }); return true; }
    const game = activeGames.get(gameId);
    if (!game || game.status !== 'active') { await interaction.reply({ content: 'This Blackjack game is no longer active.', flags: EPHEMERAL_FLAG }); return true; }
    if (action === 'hit') {
      game.player.push(draw(game));
      if (score(game.player) > 21) finish(game, 'lose', `Bust! You went over 21 and lost **${formatNumber(game.bet)}** ${PRCOIN}.`, 0);
      else resetTimer(game);
      await interaction.update(panel(game)).catch(() => null);
      return true;
    }
    if (action === 'stay') {
      finishDealer(game);
      await interaction.update(panel(game)).catch(() => null);
      return true;
    }
    return true;
  },
};
