const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

const UTDX_MEMBER_PLUS_ROLE_ID = '1507984807680938165';
const SP_MEMBER_PLUS_ROLE_ID = '1495039173260873738';

const ROLE_CHOICES = {
  utdx_member_plus: {
    label: 'UTDX Member+',
    roleId: UTDX_MEMBER_PLUS_ROLE_ID,
  },
  sp_member_plus: {
    label: 'SP Member+',
    roleId: SP_MEMBER_PLUS_ROLE_ID,
  },
};

module.exports = {
  data: new SlashCommandBuilder()
    .setName('give-role')
    .setDescription('Give a game Member+ role to a user')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) => option
      .setName('user')
      .setDescription('User to give the role to')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('role')
      .setDescription('Role to give')
      .setRequired(true)
      .addChoices(
        { name: ROLE_CHOICES.utdx_member_plus.label, value: 'utdx_member_plus' },
        { name: ROLE_CHOICES.sp_member_plus.label, value: 'sp_member_plus' },
      )),
  suppressCommandLog: true,
  async execute(interaction) {
    if (!interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Only administrators can use this command.', flags: MessageFlags.Ephemeral });
      return;
    }

    const choice = ROLE_CHOICES[interaction.options.getString('role', true)];
    const targetUser = interaction.options.getUser('user', true);
    const member = await interaction.guild?.members.fetch(targetUser.id).catch(() => null);

    if (!choice) {
      await interaction.reply({ content: 'Unknown role choice.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (!member) {
      await interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
      return;
    }

    await member.roles.add(choice.roleId);
    await interaction.reply({
      content: `Gave **${choice.label}** to <@${targetUser.id}>.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
