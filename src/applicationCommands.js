const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { LEVELING_COMMANDS } = require('./leveling');
const { RNG_GAME_COMMANDS } = require('./features/rng-game');
const { FARMING_GAME_COMMANDS } = require('./features/farming-game');
const { getGuildConfigRaw } = require('./serverConfig');

const STOCK_SETUP_COMMAND_NAME = 'stock-set-up';
const STOCK_SETUP_COMMAND = new SlashCommandBuilder()
  .setName(STOCK_SETUP_COMMAND_NAME)
  .setDescription('Set up GAG2 stock auto-posting in the dashboard.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .toJSON();

const GLOBAL_APPLICATION_COMMANDS = Object.freeze([STOCK_SETUP_COMMAND]);

function commandJson(commands) {
  return commands.map((command) => command.data.toJSON());
}

function featureCommandsForConfig(config) {
  if (!config || config.enabled === false) return [];
  const commands = [];
  if (config.features?.leveling === true && config.leveling?.enabled === true) {
    commands.push(...commandJson(LEVELING_COMMANDS));
  }
  if (config.features?.rngGame === true && config.rngGame?.enabled === true) {
    commands.push(...commandJson(RNG_GAME_COMMANDS));
    commands.push(...commandJson(FARMING_GAME_COMMANDS));
  }
  return commands;
}

async function syncGuildApplicationCommands(guild) {
  if (!guild?.id || !guild.commands?.set) return [];
  const commands = featureCommandsForConfig(getGuildConfigRaw(guild.id));
  await guild.commands.set(commands);
  return commands;
}

module.exports = {
  GLOBAL_APPLICATION_COMMANDS,
  STOCK_SETUP_COMMAND,
  STOCK_SETUP_COMMAND_NAME,
  featureCommandsForConfig,
  syncGuildApplicationCommands,
};
