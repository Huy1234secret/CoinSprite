const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const levelingManager = require('../src/levelingManager');
const {
  getMemberRoleBoosts,
  getXpBoostPercent,
  formatBoostLines,
} = require('../src/rewardBoosts');
const { canEarnXpInChannel } = require('../src/xpChannels');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

function randomInt(min, max) {
  return Math.floor(Math.random() * ((max - min) + 1)) + min;
}

function awardRoleBonusXp(message) {
  if (!canEarnXpInChannel(message.channel, message.guildId)) return;
  const xpBoostPercent = getXpBoostPercent(message.member);
  if (xpBoostPercent <= 0) return;
  const bonusXp = Math.floor((randomInt(1, 10) * xpBoostPercent) / 10) / 10;
  if (bonusXp > 0) {
    levelingManager.addUserXp(message.guild.id, message.author.id, bonusXp, {
      source: 'message XP boost',
      channelId: message.channelId,
      messageId: message.id,
    });
  }
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
    .setDescription('Show your active XP boosts.'),

  async execute(interaction) {
    const boosts = getMemberRoleBoosts(interaction.member);
    const xpLines = formatBoostLines(boosts, 'xpPercent');
    const content = [
      ...sectionLines('XP Boost', getXpBoostPercent(interaction.member), xpLines),
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
    awardRoleBonusXp(message);
  },
};
