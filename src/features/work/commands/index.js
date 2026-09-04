const { SlashCommandBuilder } = require('discord.js');

const WORK_COMMANDS = Object.freeze([{ data: new SlashCommandBuilder().setName('cs-work').setDescription('Start a random work minigame.') }]);

function parseWorkCommand(content) { return /^\s*cswork\s*$/i.test(String(content || '')); }

module.exports = { WORK_COMMANDS, parseWorkCommand };
