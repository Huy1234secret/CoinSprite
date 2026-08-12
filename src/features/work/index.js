const { WORK_GAMES } = require('./data');
const { WORK_COMMANDS, createWorkCommandHandler } = require('./commands');
const { createWorkComponentHandler } = require('./components/handler');
const { WorkRepository } = require('./repositories/workRepository');
const { WorkService } = require('./services/workService');

function createWorkFeature(options) {
  const clock = options.clock || Date.now;
  const random = options.random || ((maximum) => Math.floor(Math.random() * maximum));
  const repository = options.repository || new WorkRepository(options.db, options.playerRepository);
  const service = options.service || new WorkService({
    repository,
    clock,
    random,
    createId: options.createId,
    games: options.games || WORK_GAMES,
    sessionTtlMs: options.sessionTtlMs,
    cooldownMs: options.cooldownMs,
  });
  const context = {
    clock,
    games: options.games || WORK_GAMES,
    getGuildPolicy: options.getGuildPolicy,
    reportError: options.reportError,
    random,
    repository,
    service,
  };
  const handleCommand = createWorkCommandHandler(context);
  const handleComponent = createWorkComponentHandler(context);
  return {
    ...context,
    commands: WORK_COMMANDS,
    async handleInteraction(interaction) {
      if (await handleCommand(interaction)) return true;
      return handleComponent(interaction);
    },
  };
}

module.exports = { WORK_COMMANDS, createWorkFeature };
