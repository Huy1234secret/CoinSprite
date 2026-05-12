const { SlashCommandBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { getAllGamblingStats, getAllBalances } = require('../src/gamblingStore');
const { getAllWorkStats } = require('../src/workStats');
const { getAllFishStats } = require('../src/fishingStore');
const { FISHES, RARITY_LABELS } = require('../src/fishingConfig');
const { buildGamblingLeaderboardImage } = require('../src/gamblingLeaderboardManager');
const { formatCompactNumber } = require('../src/numberFormat');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const LEADERBOARD_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const activeLeaderboardMessages = new Map();
let leaderboardScheduler = null;
let schedulerClient = null;

const TYPE_OPTIONS = [
  { label: 'PRcoin leaderboard', value: 'money', description: 'Switch between all-time earnings and top balance.' },
  { label: 'Trivia best run', value: 'trivia', description: 'Best trivia score reached in one run.' },
  { label: 'Minefield completed', value: 'minefield', description: 'Total completed minefield games.' },
  { label: 'Roulette Win', value: 'roulette', description: 'Straight bet roulette wins.' },
  { label: 'Most worked', value: 'work', description: 'Total work attempts completed or failed.' },
  { label: 'Most Fish Fished', value: 'fish', description: 'Total fish caught, with rarity ✨ filters.' },
];
const MONEY_MODES = { EARNED: 'earned', BALANCE: 'balance' };
const FISH_FILTERS = ['all', ...[...new Set(FISHES.map((fish) => fish.rarity))]];

function getDifficultyOptions(type) {
  if (type === 'trivia') return ['all', 'easy', 'medium', 'hard'];
  if (type === 'minefield') return ['all', 'easy', 'medium', 'hard', 'hardcore'];
  if (type === 'roulette') return ['straight'];
  if (type === 'fish') return FISH_FILTERS;
  return [];
}
function difficultyLabel(type, difficulty) {
  if (type === 'roulette' && difficulty === 'straight') return 'Straight bet';
  if (type === 'fish') return difficulty === 'all' ? 'All' : RARITY_LABELS[difficulty] || difficulty[0].toUpperCase() + difficulty.slice(1);
  if (type === 'trivia' && difficulty === 'all') return '🎲 Random Diff';
  if (difficulty === 'all') return 'All';
  if (type === 'minefield' && difficulty === 'hardcore') return '💀 HARDCORE';
  if (difficulty === 'easy') return '🟢 Easy';
  if (difficulty === 'medium') return '🟡 Medium';
  if (difficulty === 'hard') return '🔴 Hard';
  return difficulty;
}
function parseState(customId) { const parts = customId.split(':'); return { ownerId: parts[2], type: parts[3] || 'money', difficulty: parts[4] || 'all', moneyMode: parts[5] || MONEY_MODES.EARNED }; }
function normalizeDifficulty(type, difficulty) { const options = getDifficultyOptions(type); if (!options.length) return 'all'; return options.includes(difficulty) ? difficulty : options[0]; }
function buildControls(ownerId, type, selectedDifficulty, selectedMoneyMode) {
  const rows = [];
  rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`gamblinglb:type:${ownerId}:${type}:${selectedDifficulty}:${selectedMoneyMode}`).setPlaceholder('Select gambling leaderboard').addOptions(TYPE_OPTIONS.map((option) => ({ label: option.label, value: option.value, description: option.description, default: option.value === type })))).toJSON());
  if (type === 'money') {
    rows.push(new ActionRowBuilder().addComponents([
      new ButtonBuilder().setCustomId(`gamblinglb:money:${ownerId}:${type}:${selectedDifficulty}:${MONEY_MODES.EARNED}`).setLabel('Total earn [all-time]').setStyle(selectedMoneyMode === MONEY_MODES.EARNED ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(selectedMoneyMode === MONEY_MODES.EARNED),
      new ButtonBuilder().setCustomId(`gamblinglb:money:${ownerId}:${type}:${selectedDifficulty}:${MONEY_MODES.BALANCE}`).setLabel('Top Balance').setStyle(selectedMoneyMode === MONEY_MODES.BALANCE ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(selectedMoneyMode === MONEY_MODES.BALANCE),
    ]).toJSON());
    return rows;
  }
  const options = getDifficultyOptions(type);
  if (options.length) {
    const buttons = options.map((difficulty) => new ButtonBuilder().setCustomId(`gamblinglb:filter:${ownerId}:${type}:${difficulty}:${selectedMoneyMode}`).setLabel(difficultyLabel(type, difficulty)).setStyle(difficulty === selectedDifficulty ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(difficulty === selectedDifficulty));
    for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)).toJSON());
  }
  return rows;
}
function getScore(type, difficulty, stats, balance, moneyMode, workStats, fishStats) {
  if (type === 'money' && moneyMode === MONEY_MODES.BALANCE) return Math.max(0, Math.floor(Number(balance) || 0));
  if (type === 'money') return Math.max(0, Math.floor(Number(stats.moneyEarned) || 0));
  if (type === 'trivia') return Math.max(0, Math.floor(Number(stats.triviaBestRun?.[difficulty]) || 0));
  if (type === 'minefield') return Math.max(0, Math.floor(Number(stats.minefieldCompleted?.[difficulty]) || 0));
  if (type === 'roulette') return Math.max(0, Math.floor(Number(stats.rouletteStraightWins?.straight) || 0));
  if (type === 'work') return Math.max(0, Math.floor(Number(workStats.totalWorks) || 0));
  if (type === 'fish') return difficulty === 'all' ? Math.max(0, Math.floor(Number(fishStats.total) || 0)) : Math.max(0, Math.floor(Number(fishStats.byRarity?.[difficulty]) || 0));
  return 0;
}
function getTitle(type, difficulty, moneyMode) {
  if (type === 'money' && moneyMode === MONEY_MODES.BALANCE) return 'Top Balance';
  if (type === 'money') return 'Total Earn (All Time)';
  if (type === 'trivia') return `Trivia best run • ${difficultyLabel(type, difficulty)}`;
  if (type === 'minefield') return `Minefield completed • ${difficultyLabel(type, difficulty)}`;
  if (type === 'roulette') return `Roulette Win • ${difficultyLabel(type, difficulty)}`;
  if (type === 'work') return 'Most worked';
  if (type === 'fish') return `Most Fish Fished • ${difficultyLabel(type, difficulty)}`;
  return 'Gambling leaderboard';
}
function getMetricLabel(type, moneyMode) { if (type === 'money' && moneyMode === MONEY_MODES.BALANCE) return 'Current PRcoin'; if (type === 'money') return 'PRcoin'; if (type === 'trivia') return 'Correct'; if (type === 'roulette') return 'Wins'; if (type === 'work') return 'Worked'; if (type === 'fish') return 'Fish'; return 'Completed'; }
function getNextFiveMinuteRefresh(now = new Date()) { const next = new Date(now.getTime()); const minutes = next.getUTCMinutes(); const nextMinutes = (Math.floor(minutes / 5) + 1) * 5; next.setUTCMinutes(nextMinutes, 0, 0); return next; }
function buildPayload(guild, ownerId, type, difficulty, moneyMode, attachment) { const nextUpdateUnix = Math.floor(getNextFiveMinuteRefresh().getTime() / 1000); return { flags: COMPONENTS_V2_FLAG, files: [attachment], components: [{ type: 17, accent_color: 0xffffff, components: [{ type: 10, content: [`## ${guild.name}'s gambling leaderboard.`, `-# Category: **${getTitle(type, difficulty, moneyMode)}**`, `-# Auto-refresh timer: <t:${nextUpdateUnix}:R> (<t:${nextUpdateUnix}:T>)`].join('\n') }, { type: 12, items: [{ media: { url: 'attachment://gambling-leaderboard.png' } }] }, { type: 14, divider: true, spacing: 1 }, ...buildControls(ownerId, type, difficulty, moneyMode)] }] }; }
async function sendLeaderboard(target, guild, ownerId, type = 'money', difficulty = 'all', moneyMode = MONEY_MODES.EARNED, mode = 'reply') {
  const allStats = getAllGamblingStats(); const allBalances = getAllBalances(); const allWorkStats = getAllWorkStats(); const allFishStats = getAllFishStats();
  const allUserIds = new Set([...Object.keys(allStats), ...Object.keys(allBalances), ...Object.keys(allWorkStats), ...Object.keys(allFishStats)]);
  const rows = [...allUserIds].map((userId) => ({ userId, score: getScore(type, difficulty, allStats[userId] || {}, allBalances[userId] || 0, moneyMode, allWorkStats[userId] || {}, allFishStats[userId] || {}) })).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score).slice(0, 10).map((entry, index) => ({ ...entry, rank: index + 1 }));
  const rowsWithMeta = await Promise.all(rows.map(async (row) => { let member = guild.members.cache.get(row.userId) || await guild.members.fetch(row.userId).catch(() => null); return { ...row, username: member?.user?.username || `Unknown (${row.userId})`, avatarUrl: member?.user?.displayAvatarURL({ extension: 'png', size: 128 }) || '', displayValue: formatCompactNumber(row.score) }; }));
  const attachment = await buildGamblingLeaderboardImage({ guildName: guild.name, title: getTitle(type, difficulty, moneyMode), metricLabel: getMetricLabel(type, moneyMode), rows: rowsWithMeta });
  const payload = buildPayload(guild, ownerId, type, difficulty, moneyMode, attachment);
  if (mode === 'edit') { if (typeof target.editReply === 'function') return target.editReply(payload); if (typeof target.edit === 'function') return target.edit(payload); }
  if (mode === 'update' && typeof target.update === 'function') return target.update(payload);
  if (typeof target.reply === 'function') return target.reply(payload);
  if (typeof target.followUp === 'function') return target.followUp(payload);
  return null;
}
async function refreshTrackedLeaderboards() { if (!schedulerClient) return; for (const [messageId, state] of activeLeaderboardMessages.entries()) { const guild = schedulerClient.guilds.cache.get(state.guildId) || await schedulerClient.guilds.fetch(state.guildId).catch(() => null); if (!guild) continue; const channel = guild.channels.cache.get(state.channelId) || await guild.channels.fetch(state.channelId).catch(() => null); if (!channel || !channel.isTextBased?.()) continue; const message = await channel.messages.fetch(messageId).catch(() => null); if (!message) { activeLeaderboardMessages.delete(messageId); continue; } await sendLeaderboard(message, guild, state.ownerId, state.type, state.difficulty, state.moneyMode, 'edit').catch(() => null); } }
function scheduleLeaderboardRefresh() { if (leaderboardScheduler) clearTimeout(leaderboardScheduler); const delay = Math.max(1_000, Math.min(LEADERBOARD_REFRESH_INTERVAL_MS, getNextFiveMinuteRefresh().getTime() - Date.now())); leaderboardScheduler = setTimeout(async () => { await refreshTrackedLeaderboards().catch(() => null); scheduleLeaderboardRefresh(); }, delay); }
function rememberLeaderboardMessage(message, state) { if (!message?.id || !message?.channelId || !message?.guildId) return; activeLeaderboardMessages.set(message.id, { ownerId: state.ownerId, guildId: message.guildId, channelId: message.channelId, type: state.type, difficulty: state.difficulty, moneyMode: state.moneyMode }); }
async function deferForLeaderboard(interaction) { if (interaction.isChatInputCommand?.() && !interaction.deferred && !interaction.replied) { await interaction.deferReply().catch(() => null); return 'edit'; } if ((interaction.isButton?.() || interaction.isStringSelectMenu?.()) && !interaction.deferred && !interaction.replied) { await interaction.deferUpdate().catch(() => null); return 'edit'; } if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) return 'update'; return 'reply'; }
module.exports = { data: new SlashCommandBuilder().setName('gambling-leaderboard').setDescription('Show gambling leaderboard'), async init(client) { schedulerClient = client; scheduleLeaderboardRefresh(); }, async execute(interaction) { const mode = await deferForLeaderboard(interaction); await sendLeaderboard(interaction, interaction.guild, interaction.user.id, 'money', 'all', MONEY_MODES.EARNED, mode); const message = await interaction.fetchReply().catch(() => null); rememberLeaderboardMessage(message, { ownerId: interaction.user.id, type: 'money', difficulty: 'all', moneyMode: MONEY_MODES.EARNED }); }, async handleInteraction(interaction) { if (interaction.isStringSelectMenu() && interaction.customId.startsWith('gamblinglb:type:')) { const { ownerId, difficulty, moneyMode } = parseState(interaction.customId); if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use controls from your own gambling leaderboard command.', flags: MessageFlags.Ephemeral }); return true; } const type = interaction.values?.[0] || 'money'; const fallbackDifficulty = normalizeDifficulty(type, difficulty); const mode = await deferForLeaderboard(interaction); await sendLeaderboard(interaction, interaction.guild, ownerId, type, fallbackDifficulty, moneyMode, mode); rememberLeaderboardMessage(interaction.message || await interaction.fetchReply().catch(() => null), { ownerId, type, difficulty: fallbackDifficulty, moneyMode }); return true; } if (interaction.isButton() && interaction.customId.startsWith('gamblinglb:filter:')) { const { ownerId, type, difficulty, moneyMode } = parseState(interaction.customId); if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use controls from your own gambling leaderboard command.', flags: MessageFlags.Ephemeral }); return true; } const mode = await deferForLeaderboard(interaction); await sendLeaderboard(interaction, interaction.guild, ownerId, type, difficulty, moneyMode, mode); rememberLeaderboardMessage(interaction.message || await interaction.fetchReply().catch(() => null), { ownerId, type, difficulty, moneyMode }); return true; } if (interaction.isButton() && interaction.customId.startsWith('gamblinglb:money:')) { const { ownerId, type, difficulty, moneyMode } = parseState(interaction.customId); if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use controls from your own gambling leaderboard command.', flags: MessageFlags.Ephemeral }); return true; } const mode = await deferForLeaderboard(interaction); await sendLeaderboard(interaction, interaction.guild, ownerId, type, difficulty, moneyMode, mode); rememberLeaderboardMessage(interaction.message || await interaction.fetchReply().catch(() => null), { ownerId, type, difficulty, moneyMode }); return true; } return false; } };
