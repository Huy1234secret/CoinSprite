const { SlashCommandBuilder } = require('discord.js');
const { evaluateRngGameAccess } = require('../rng-game/services/accessPolicy');
const { homePayload, workError } = require('./components/builders');

const WORK_COMMANDS = Object.freeze([{
  data: new SlashCommandBuilder().setName('g-work').setDescription('Work shifts for token salary and rank progress.'),
}]);

function createWorkCommandHandler(context) {
  return async function handleWorkCommand(interaction) {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== 'g-work') return false;
    const access = evaluateRngGameAccess(interaction, context.getGuildPolicy);
    if (!access.allowed) {
      await interaction.reply(workError(`Command unavailable\n${access.reason}`));
      return true;
    }
    await interaction.reply(homePayload(interaction.user.id, context.random));
    return true;
  };
}

module.exports = { WORK_COMMANDS, createWorkCommandHandler };
