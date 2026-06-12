const { SlashCommandBuilder } = require('discord.js');
const ticketSystem = require('./ticket-system');

const ACTION_CHOICES = [
  { name: 'Close ticket', value: 'close' },
  { name: 'Save transcript', value: 'transcript' },
  { name: 'Delete ticket channel', value: 'delete' },
  { name: 'Blacklist ticket author', value: 'blacklist' },
  { name: 'Move to another ticket type', value: 'move_to' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ticket-action')
    .setDescription('Run a staff action in the current ticket channel.')
    .addStringOption((option) => option
      .setName('action')
      .setDescription('Action to run')
      .setRequired(true)
      .addChoices(...ACTION_CHOICES))
    .addStringOption((option) => option
      .setName('ticket-type')
      .setDescription('Destination ticket type for the move action')
      .setAutocomplete(true)),

  disableActionTimeout: true,

  async execute(interaction) {
    const action = interaction.options.getString('action', true);
    const ticketTypeId = interaction.options.getString('ticket-type') || '';
    await ticketSystem.executeTicketAction(interaction, action, ticketTypeId);
  },

  async handleInteraction(interaction) {
    if (!interaction.isAutocomplete() || interaction.commandName !== 'ticket-action') return false;
    const focused = String(interaction.options.getFocused() || '').toLowerCase();
    const choices = ticketSystem.getTicketTypeChoices(interaction.guildId)
      .filter((choice) => !focused || choice.name.toLowerCase().includes(focused) || choice.value.includes(focused))
      .slice(0, 25);
    await interaction.respond(choices).catch(() => null);
    return true;
  },
};
