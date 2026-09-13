const { SlashCommandBuilder } = require('discord.js');

const BEG_COMMANDS = Object.freeze([{
  data: new SlashCommandBuilder()
    .setName('cs-beg')
    .setDescription('Ask CoinSprite citizens for some coins.'),
}]);

function parseBegCommand(content) {
  return /^\s*csbeg\s*$/i.test(String(content || ''));
}

module.exports = { BEG_COMMANDS, parseBegCommand };
