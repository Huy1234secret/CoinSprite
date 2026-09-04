const { WORK_GAMES } = require('./data');
const { createWorkComponentHandler } = require('./components/handler');
const { WorkRepository } = require('./repositories/workRepository');
const { WorkService } = require('./services/workService');

const WORK_COMMANDS = Object.freeze([]);

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
    reportError: options.reportError,
    random,
    repository,
    service,
  };
  const handleComponent = createWorkComponentHandler(context);
  return {
    ...context,
    commands: WORK_COMMANDS,
    async handleInteraction(interaction) {
      return handleComponent(interaction);
    },
  };
}

module.exports = { WORK_COMMANDS, createWorkFeature };
