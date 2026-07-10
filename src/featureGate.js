const {
  isGuildFullBotEnabled,
  isGuildGag2StockEnabled,
} = require('./serverConfig');

const GAG2_STOCK_COMMANDS = new Set(['stock-set-up']);

function commandName(commandOrName) {
  if (typeof commandOrName === 'string') return commandOrName;
  return commandOrName?.data?.name || commandOrName?.name || '';
}

function isCommandVisibleForGuild(guildId, commandOrName) {
  if (isGuildFullBotEnabled(guildId)) return true;
  return isGuildGag2StockEnabled(guildId) && GAG2_STOCK_COMMANDS.has(commandName(commandOrName));
}

function slashCommandPayloadsForGuild(guildId, commands) {
  const values = typeof commands?.values === 'function' ? [...commands.values()] : [];
  return values
    .filter((command) => command?.data?.toJSON && isCommandVisibleForGuild(guildId, command))
    .map((command) => command.data.toJSON());
}

module.exports = {
  GAG2_STOCK_COMMANDS,
  isCommandVisibleForGuild,
  isFullBotFeatureEnabled: isGuildFullBotEnabled,
  isGag2StockFeatureEnabled: isGuildGag2StockEnabled,
  slashCommandPayloadsForGuild,
};
