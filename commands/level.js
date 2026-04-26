const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');

const LEVEL_UP_CHANNEL_ID = '1493909588775272448';
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const LEVEL_ROLE_REWARDS = new Map([
  [5, '1493906016570572801'],
  [10, '1493906102990147654'],
  [15, '1493906169054625792'],
  [20, '1493906220065619988'],
  [30, '1493906329465655376'],
  [40, '1496480275352391680'],
]);
const LEVEL_FUN_MESSAGES = new Map([
  [5, 'Bro discovered the chat button.'],
  [10, 'Double digits? Okay, yapper training complete.'],
  [15, 'Slowly becoming a professional keyboard warrior.'],
  [20, 'Hydrate before the next yap session.'],
  [30, 'Chat activity detected. Grass not detected.'],
  [40, 'At this point, the keyboard fears you.'],
  [50, 'Halfway to “please go outside.”'],
  [60, 'The yap grind is getting concerning.'],
  [70, 'Bro is not chatting anymore, bro is farming XP.'],
  [80, 'Scientists are studying this level of activity.'],
  [90, 'So close to Level 100, your keyboard is crying.'],
  [100, 'Someone give them grass… or a trophy.'],
]);

async function sendLevelUpMessage(guild, userId, newLevel) {
  const channel = guild.channels.cache.get(LEVEL_UP_CHANNEL_ID)
    || await guild.channels.fetch(LEVEL_UP_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  const roleId = LEVEL_ROLE_REWARDS.get(newLevel);
  let earnedRoleMessage = '';
  if (roleId) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(roleId)) {
      await member.roles.add(roleId).catch(() => null);
    }
    earnedRoleMessage = `-# You also got <@&${roleId}>`;
  }

  const funMessage = LEVEL_FUN_MESSAGES.get(newLevel) ? `\n${LEVEL_FUN_MESSAGES.get(newLevel)}` : '';
  const levelMessage = `<@${userId}> has leveled up to level ${newLevel}!${funMessage}`;
  await channel.send({
    allowedMentions: { parse: [] },
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x57F287,
        components: [
          { type: 10, content: levelMessage },
          { type: 14, divider: true, spacing: 1 },
          { type: 10, content: earnedRoleMessage || '-# No role reward earned this level.' },
        ],
      },
    ],
  });
}

async function handleLevelUpRange(guild, userId, oldLevel, newLevel) {
  if (!Number.isFinite(oldLevel) || !Number.isFinite(newLevel) || newLevel <= oldLevel) {
    return;
  }

  for (let level = oldLevel + 1; level <= newLevel; level += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendLevelUpMessage(guild, userId, level);
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('level')
    .setDescription('Show your level card.'),

  async execute(interaction) {
    const leaderboard = manager.getSortedLeaderboard(interaction.guildId);
    const rank = Math.max(1, leaderboard.findIndex((entry) => entry.userId === interaction.user.id) + 1);
    const stats = manager.getProgress((leaderboard.find((entry) => entry.userId === interaction.user.id)?.totalXp) || 0);

    const avatarUrl = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });
    const attachment = await manager.buildLevelCard({
      guildId: interaction.guildId,
      userId: interaction.user.id,
      username: interaction.user.username,
      avatarUrl,
      rank,
      stats,
    });

    await interaction.reply({
      files: [attachment],
    });
  },

  async handleMessageCreate(message) {
    if (!message.guild || message.author.bot) {
      return;
    }

    const trimmed = message.content.trim().toLowerCase();
    if (trimmed === '!level' || trimmed === '!rank') {
      const leaderboard = manager.getSortedLeaderboard(message.guild.id);
      const rank = Math.max(1, leaderboard.findIndex((entry) => entry.userId === message.author.id) + 1);
      const stats = manager.getProgress((leaderboard.find((entry) => entry.userId === message.author.id)?.totalXp) || 0);
      const avatarUrl = message.author.displayAvatarURL({ extension: 'png', size: 256 });
      const attachment = await manager.buildLevelCard({
        guildId: message.guild.id,
        userId: message.author.id,
        username: message.author.username,
        avatarUrl,
        rank,
        stats,
      });

      await message.reply({
        files: [attachment],
      });
      return;
    }

    const result = manager.awardMessageXp(message.guild.id, message.author.id);
    await handleLevelUpRange(message.guild, message.author.id, result.oldLevel, result.newLevel);
  },

  async handleMessageReactionAdd(reaction, user) {
    if (user.bot) {
      return;
    }

    if (reaction.partial) {
      await reaction.fetch().catch(() => null);
    }

    if (!reaction.message.guild) {
      return;
    }

    const result = manager.awardReactionXp(reaction.message.guild.id, user.id);
    await handleLevelUpRange(reaction.message.guild, user.id, result.oldLevel, result.newLevel);
  },
};
