const { RNG_GAME_COMMANDS, createCommandHandlers } = require('./commands');
const { createComponentHandler } = require('./components/handler');
const { openDatabase } = require('./repositories/database');
const { RngGameRepository } = require('./repositories/gameRepository');
const { RngGameService } = require('./services/gameService');
const { ActionStore, SaleSessionStore, ViewStore } = require('./services/sessionStore');

function createRngGameFeature(options = {}) {
  const clock = options.clock || Date.now;
  const db = options.db || openDatabase({ databasePath: options.databasePath, migrationsPath: options.migrationsPath });
  const repository = options.repository || new RngGameRepository(db);
  const saleSessions = options.saleSessions || new SaleSessionStore({ clock, ttlMs: options.sessionTtlMs });
  const inventoryViews = options.inventoryViews || new ViewStore({ clock, ttlMs: options.sessionTtlMs });
  const actions = options.actions || new ActionStore({ clock, ttlMs: options.sessionTtlMs });
  const gameService = options.gameService || new RngGameService({
    repository,
    saleSessions,
    rng: options.rng,
    clock,
    cooldownMs: options.cooldownMs,
  });
  const context = { actions, db, gameService, inventoryViews, repository, saleSessions };
  const commands = createCommandHandlers(context);
  const handleComponent = createComponentHandler(context);

  return {
    ...context,
    commands: RNG_GAME_COMMANDS,
    async handleInteraction(interaction) {
      if (await commands.handleSlash(interaction)) return true;
      return handleComponent(interaction);
    },
    handleMessage: commands.handlePrefix,
    close() {
      actions.clear();
      inventoryViews.clear();
      saleSessions.clear();
      if (!options.db && db.open) db.close();
    },
  };
}

module.exports = { RNG_GAME_COMMANDS, createRngGameFeature };
