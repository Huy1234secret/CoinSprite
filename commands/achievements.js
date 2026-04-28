const {
  SlashCommandBuilder,
  MessageFlags,
  ModalBuilder,
  ActionRowBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { buildAchievementsPage } = require('../src/achievementSystem');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('achievements')
    .setDescription('Show your achievement list.'),

  async execute(interaction) {
    const { payload } = buildAchievementsPage(interaction.user, 1, 5);
    await interaction.reply(payload);
  },

  async handleInteraction(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith('achievements:switch:')) {
      const [, , ownerId, currentPageRaw, maxPageRaw] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own achievements command.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const currentPage = Math.max(1, Number(currentPageRaw) || 1);
      const maxPage = Math.max(1, Number(maxPageRaw) || 1);
      const modal = new ModalBuilder()
        .setCustomId(`achievements:modal:${ownerId}:${currentPage}:${maxPage}`)
        .setTitle('Switch achievement page');
      const input = new TextInputBuilder()
        .setCustomId('page_input')
        .setLabel('Which page u wanna switch to')
        .setPlaceholder(`Page 1 - ${maxPage}`)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('achievements:modal:')) {
      const [, , ownerId, currentPageRaw, maxPageRaw] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own achievements command.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const currentPage = Math.max(1, Number(currentPageRaw) || 1);
      const maxPage = Math.max(1, Number(maxPageRaw) || 1);
      const asked = Number(interaction.fields.getTextInputValue('page_input'));
      const page = Number.isFinite(asked) ? Math.min(Math.max(1, Math.floor(asked)), maxPage) : currentPage;
      const { payload } = buildAchievementsPage(interaction.user, page, 5);

      await interaction.deferUpdate().catch(() => null);
      await interaction.editReply(payload).catch(async () => {
        if (interaction.message?.editable) {
          await interaction.message.edit(payload).catch(() => null);
        }
      });
      return true;
    }

    return false;
  },
};
