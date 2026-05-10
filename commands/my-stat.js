const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const levelingManager = require('../src/levelingManager');
const { addBalance } = require('../src/gamblingStore');
const {
  getMemberRoleBoosts,
  getCoinBoostPercent,
  getXpBoostPercent,
  formatBoostLines,
} = require('../src/rewardBoosts');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const CHAT_COIN_MIN = 1;
const CHAT_COIN_MAX = 100;
const CHAT_COIN_CAP = 1000;

function randomInt(min, max) {
  return Math.floor(Math.random() * ((max - min) + 1)) + min;
}

function getLevelCoinMultiplier(level) {
  return 1.02 ** Math.max(0, Math.floor(Number(level) || 1) - 1);
}

function awardChatCoins(message) {
  const progress = levelingManager.getUserProgress(message.guild.id, message.author.id);
  const baseCoins = randomInt(CHAT_COIN_MIN, CHAT_COIN_MAX);
  const roleMultiplier = 1 + (getCoinBoostPercent(message.member) / 100);
  const earned = Math.max(1, Math.min(CHAT_COIN_CAP, Math.floor(baseCoins * getLevelCoinMultiplier(progress.level) * roleMultiplier)));
  addBalance(message.author.id, earned);
}

function awardRoleBonusXp(message) {
  const xpBoostPercent = getXpBoostPercent(message.member);
  if (xpBoostPercent <= 0) return;
  const bonusXp = Math.floor((randomInt(1, 10) * xpBoostPercent) / 10) / 10;
  if (bonusXp > 0) levelingManager.addUserXp(message.guild.id, message.author.id, bonusXp);
}

function sectionLines(title, total, lines, note = null) {
  return [
    `### ${title}: +${total}%`,
    note,
    ...(lines.length ? lines : ['-# No active boosts.']),
  ].filter(Boolean);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-stat')
    .setDescription('Show your active XP and coin boosts.'),

  async execute(interaction) {
    const boosts = getMemberRoleBoosts(interaction.member);
    const xpLines = formatBoostLines(boosts, 'xpPercent');
    const coinLines = formatBoostLines(boosts, 'coinPercent');
    const content = [
      ...sectionLines('XP Boost', getXpBoostPercent(interaction.member), xpLines),
      '',
      ...sectionLines('Coin Boost', getCoinBoostPercent(interaction.member), coinLines, '-# Note: Coin Boost only affects chat earning.'),
    ].join('\n');

    await interaction.reply({
      flags: COMPONENTS_V2_FLAG,
      components: [{
        type: 17,
        accent_color: 0xffffff,
        components: [{ type: 10, content }],
      }],
    });
  },

  async handleMessageCreate(message) {
    if (!message.guild || message.author.bot) return;
    awardChatCoins(message);
    awardRoleBonusXp(message);
  },
};
