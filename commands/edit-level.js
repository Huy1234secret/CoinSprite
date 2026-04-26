const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const manager = require('../src/levelingManager');
const { syncMemberLevelRoles } = require('../src/levelRoleManager');
const MAX_LEVEL_OPERAND = 10_000;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('edit-level')
    .setDescription('Edit a user level: +N add, -N remove, sN set')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to edit')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('level')
      .setDescription('Use +N, -N, or sN (set). Example: s3')
      .setRequired(true)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const rawLevel = interaction.options.getString('level', true).trim().toLowerCase();
    const match = /^([+\-s])\s*(\d+)$/.exec(rawLevel);

    if (!match) {
      await interaction.reply({
        content: 'Invalid format. Use **+N** to add, **-N** to remove, or **sN** to set level (example: **s3**).',
        ephemeral: true,
      });
      return;
    }

    const operation = match[1];
    const value = Number(match[2]);
    if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value > MAX_LEVEL_OPERAND) {
      await interaction.reply({
        content: `Invalid level value. Please use an integer between **0** and **${MAX_LEVEL_OPERAND.toLocaleString()}**.`,
        ephemeral: true,
      });
      return;
    }

    const current = manager.getUserProgress(interaction.guildId, user.id);
    let targetLevel = current.level;

    if (operation === 's') {
      targetLevel = Math.max(1, value);
    } else if (operation === '+') {
      targetLevel = current.level + value;
    } else {
      targetLevel = Math.max(1, current.level - value);
    }

    const result = manager.setUserLevel(interaction.guildId, user.id, targetLevel);

    const member = interaction.guild.members.cache.get(user.id)
      || await interaction.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      await syncMemberLevelRoles(interaction.guild, member);
    }

    await interaction.reply({
      content: `Updated <@${user.id}> to level **${result.level}** (Total XP: **${result.totalXp}**).`,
    });
  },
};
