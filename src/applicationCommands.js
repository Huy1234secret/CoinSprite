const { LEVELING_COMMANDS } = require('./leveling');
const { COUNTING_COMMANDS } = require('./features/counting');
const { WORK_COMMANDS } = require('./features/work');
const { ACHIEVEMENT_COMMANDS } = require('./features/achievements');
const { INVENTORY_COMMANDS } = require('./features/inventory');
const { getGuildConfigRaw } = require('./serverConfig');

const GLOBAL_APPLICATION_COMMANDS = Object.freeze([]);

function commandJson(commands) {
  return commands.map((command) => command.data.toJSON());
}

function featureCommandsForConfig(config) {
  if (!config || config.enabled === false) return [];
  const commands = [];
  commands.push(...commandJson(COUNTING_COMMANDS));
  commands.push(...commandJson(WORK_COMMANDS));
  commands.push(...commandJson(INVENTORY_COMMANDS));
  commands.push(...commandJson(ACHIEVEMENT_COMMANDS));
  if (config.features?.leveling === true && config.leveling?.enabled === true) {
    commands.push(...commandJson(LEVELING_COMMANDS));
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
  featureCommandsForConfig,
  syncGuildApplicationCommands,
};

