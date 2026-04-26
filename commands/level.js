const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');
const { LEVEL_ROLE_REWARDS } = require('../src/levelRoleRewards');

const LEVEL_UP_CHANNEL_ID = '1493909588775272448';
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
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

function formatCountdown(endsAt) {
  if (!endsAt) {
    return null;
  }
  return `<t:${Math.floor(endsAt / 1000)}:R>`;
}

function punishmentNotice(summary) {
  const countdown = formatCountdown(summary.endsAt);
  if (summary.tier === 1) {
    return `⚠️ You're earning 500% less XP, punishment ends ${countdown}.`;
  }
  if (summary.tier === 2) {
    return `⚠️ You're earning 1000% less XP, punishment ends ${countdown}.`;
  }
  if (summary.tier === 3) {
    return `⚠️ XP blacklisted, punishment ends ${countdown}.`;
  }
  return null;
}

async function sendLevelUpMessage(guild, userId, newLevel) {
  const channel = guild.channels.cache.get(LEVEL_UP_CHANNEL_ID)
    || await guild.channels.fetch(LEVEL_UP_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  const roleId = LEVEL_ROLE_REWARDS.get(newLevel);
  if (roleId) {
    const member = guild.members.cache.get(userId) || await guild.members.fetch(userId).catch(() => null);
    if (member && !member.roles.cache.has(roleId)) {
      await member.roles.add(roleId).catch(() => null);
    }
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
    const summary = manager.getPunishmentSummary(interaction.guildId, interaction.user.id);
    const notice = punishmentNotice(summary);

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
      content: notice || undefined,
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
      const summary = manager.getPunishmentSummary(message.guild.id, message.author.id);
      const notice = punishmentNotice(summary);
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
        content: notice || undefined,
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
