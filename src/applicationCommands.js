const { LEVELING_COMMANDS } = require('./leveling');
const { RNG_GAME_COMMANDS } = require('./features/rng-game');
const { getGuildConfigRaw } = require('./serverConfig');
const { isGuildAllowlisted } = require('./guildAllowlist');

const GLOBAL_APPLICATION_COMMANDS = Object.freeze([]);

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
  }
  return commands;
}

async function syncGuildApplicationCommands(guild) {
  if (!guild?.id || !isGuildAllowlisted(guild.id) || !guild.commands?.set) return [];
  const commands = featureCommandsForConfig(getGuildConfigRaw(guild.id));
  await guild.commands.set(commands);
  return commands;
}

module.exports = {
  GLOBAL_APPLICATION_COMMANDS,
  featureCommandsForConfig,
  syncGuildApplicationCommands,
};
