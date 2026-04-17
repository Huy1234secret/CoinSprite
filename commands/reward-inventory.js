const { SlashCommandBuilder } = require('discord.js');
const manager = require('../src/inviteRewardsManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reward-inventory')
    .setDescription('View your reward inventory.'),

  async init(client) {
    await manager.init(client);
  },

  async execute(interaction) {
    const userState = manager.loadGuildUserState(interaction.guildId, interaction.user.id);
    if (userState.blacklisted) {
      await interaction.reply({ ...manager.createBlacklistedPayload(), ephemeral: true });
      return;
    }

    const rewardLines = manager.getRewardLines(userState);
    await interaction.reply({
      ...manager.createRewardInventoryPayload(interaction.user.username, rewardLines),
      ephemeral: true,
    });
  },
};
