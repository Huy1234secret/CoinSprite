const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const manager = require('../src/levelingManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lock-exp')
    .setDescription('Lock or unlock a user from earning EXP.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to lock or unlock')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('locked')
      .setDescription('Use yes to stop EXP earning, or no to unlock')
      .setRequired(true)
      .addChoices(
        { name: 'yes', value: 'yes' },
        { name: 'no', value: 'no' },
      ))
    .addStringOption((option) => option
      .setName('reason')
      .setDescription('Reason shown on the user rank card while locked')
      .setRequired(false)
      .setMaxLength(300)),

  async execute(interaction) {
    const user = interaction.options.getUser('user', true);
    const shouldLock = interaction.options.getString('locked', true) === 'yes';
    const reason = interaction.options.getString('reason')?.trim() ?? '';

    if (shouldLock && !reason) {
      await interaction.reply({ content: 'Please provide a reason when locking EXP.' });
      return;
    }

    const result = manager.setUserExpLock(interaction.guildId, user.id, shouldLock, reason);

    if (shouldLock) {
      await interaction.reply({
        content: result.changed
          ? `<@${user.id}> is now EXP locked and will not earn EXP. Reason: ${result.expLockReason}`
          : `<@${user.id}> was already EXP locked and will not earn EXP. Reason: ${result.expLockReason}`,
        allowedMentions: { users: [] },
      });
      return;
    }

    await interaction.reply({
      content: result.changed
        ? `<@${user.id}> is now unlocked and can earn EXP again.`
        : `<@${user.id}> was not EXP locked, so nothing changed.`,
      allowedMentions: { users: [] },
    });
  },
};
