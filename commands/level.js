const { SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');

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
      content: `## ${interaction.user.username}'s level card`,
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
        content: `## ${message.author.username}'s level card`,
        files: [attachment],
      });
      return;
    }

    manager.awardMessageXp(message.guild.id, message.author.id);
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

    manager.awardReactionXp(reaction.message.guild.id, user.id);
  },
};
