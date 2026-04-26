const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const manager = require('../src/levelingManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-xp')
    .setDescription('Edit a user XP: +N add, -N remove, sN set')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to edit')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('amount')
      .setDescription('Use +N, -N, or sN (set). Example: s3')
      .setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const rawAmount = interaction.options.getString('amount', true).trim().toLowerCase();
    const match = /^([+\-s])\s*(\d+)$/.exec(rawAmount);

    if (!match) {
      await interaction.reply({
        content: 'Invalid format. Use **+N** to add, **-N** to remove, or **sN** to set XP (example: **s3**).',
        ephemeral: true,
      });
      return;
    }

    const operation = match[1];
    const value = Number(match[2]);

    if (operation === 's') {
      const result = manager.setUserXp(interaction.guildId, user.id, value);
      await interaction.reply({
        content: `Set <@${user.id}> to **${result.totalXp} XP**. New level: **${result.level}**.`,
      });
      return;
    }

    const delta = operation === '+' ? value : -value;
    const current = manager.getUserProgress(interaction.guildId, user.id);
    const targetXp = Math.max(0, current.totalXp + delta);
    const result = manager.setUserXp(interaction.guildId, user.id, targetXp);

    await interaction.reply({
      content: `${delta >= 0 ? 'Added' : 'Removed'} **${Math.abs(delta)} XP** ${delta >= 0 ? 'to' : 'from'} <@${user.id}>. New level: **${result.level}** (Total XP: **${result.totalXp}**).`,
    });
  },
};
