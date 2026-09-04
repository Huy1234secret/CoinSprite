const { SlashCommandBuilder } = require('discord.js');

const INVENTORY_COMMANDS = Object.freeze([{
  data: new SlashCommandBuilder()
    .setName('cs-inventory')
    .setDescription('View your CoinSprite inventory.'),
}]);

function parseInventoryCommand(content) { return /^\s*csinventory\s*$/i.test(String(content || '')); }

module.exports = { INVENTORY_COMMANDS, parseInventoryCommand };
