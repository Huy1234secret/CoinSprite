const { SlashCommandBuilder } = require('discord.js');
const manager = require('../src/inviteRewardsManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('invite-points')
    .setDescription('View your current Invite Points.'),

  async init(client) {
    await manager.init(client);
  },

  async execute(interaction) {
    const userState = manager.loadGuildUserState(interaction.guildId, interaction.user.id);
    if (userState.blacklisted) {
      await interaction.reply(manager.createBlacklistedPayload());
      return;
    }

    await interaction.reply(manager.createInvitePointsPayload(interaction.user.username, userState.invitePoints));
  },

  async handleGuildMemberAdd(member) {
    await manager.onGuildMemberAdd(member);
  },

  async handleGuildMemberUpdate(oldMember, newMember) {
    await manager.onGuildMemberUpdate(oldMember, newMember);
  },

  async handleInviteCreate(invite) {
    await manager.onInviteCreateOrDelete(invite);
  },

  async handleInviteDelete(invite) {
    await manager.onInviteCreateOrDelete(invite);
  },

  async handleMessageCreate(message) {
    await manager.onMessageCreate(message);
  },
};
