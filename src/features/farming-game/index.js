const { FARMING_GAME_COMMANDS, createFarmingCommandHandlers } = require('./commands');
const { createFarmingComponentHandler } = require('./components/handler');
const { FarmingGameRepository } = require('./repositories/farmingRepository');
const { migrateFarmingGame } = require('./repositories/database');
const { FarmRenderer } = require('./renderer/farmRenderer');
const { FarmingGameService } = require('./services/farmingService');
const { FarmViewRefreshScheduler } = require('./services/refreshScheduler');
const { FarmingActionStore, FarmingViewStore } = require('./services/sessionStore');
const { openDatabase } = require('../rng-game/repositories/database');
const { RngGameRepository } = require('../rng-game/repositories/gameRepository');
const { RngGameService } = require('../rng-game/services/gameService');

function createFarmingGameFeature(options = {}) {
  const clock = options.clock || Date.now;
  const ownsDatabase = !options.db;
  const db = options.db || openDatabase({
    databasePath: options.databasePath,
    migrationsPath: options.rngMigrationsPath,
  });
  migrateFarmingGame(db, options.farmingMigrationsPath);
  const cropRepository = options.cropRepository || new RngGameRepository(db);
  const saleSessions = options.saleSessions || { has: () => false };
  const cropGameService = options.cropGameService || new RngGameService({
    repository: cropRepository,
    saleSessions,
    clock,
  });
  const repository = options.repository || new FarmingGameRepository(db);
  const farmingService = options.farmingService || new FarmingGameService({
    repository,
    clock,
    rng: options.rng,
    anchorGenerator: options.anchorGenerator,
  });
  const farmRenderer = options.farmRenderer || new FarmRenderer(options.rendererOptions);
  const farmViews = options.farmViews || new FarmingViewStore({ clock, ttlMs: options.sessionTtlMs });
  const inventoryViews = options.inventoryViews || new FarmingViewStore({ clock, ttlMs: options.sessionTtlMs });
  const actions = options.actions || new FarmingActionStore({ clock, ttlMs: options.sessionTtlMs });
  const refreshScheduler = options.refreshScheduler || new FarmViewRefreshScheduler({
    clock,
    farmingService,
    farmRenderer,
    farmViews,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });
  const context = {
    actions,
    cropGameService,
    cropRepository,
    db,
    farmingService,
    farmRenderer,
    farmViews,
    getGuildPolicy: options.getGuildPolicy,
    inventoryViews,
    refreshScheduler,
    repository,
    saleSessions,
  };
  const commands = createFarmingCommandHandlers(context);
  const handleComponent = createFarmingComponentHandler(context);

  return {
    ...context,
    commands: FARMING_GAME_COMMANDS,
    async handleInteraction(interaction) {
      if (await commands.handleSlash(interaction)) return true;
      return handleComponent(interaction);
    },
    close() {
      actions.clear();
      refreshScheduler.clear?.();
      farmRenderer.clear?.();
      farmViews.clear();
      inventoryViews.clear();
      if (ownsDatabase && db.open) db.close();
    },
  };
}

module.exports = { FARMING_GAME_COMMANDS, createFarmingGameFeature };
