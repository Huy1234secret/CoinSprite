const { FARMING_GAME_COMMANDS, createFarmingCommandHandlers } = require('./commands');
const { createFarmingComponentHandler } = require('./components/handler');
const { FarmingGameRepository } = require('./repositories/farmingRepository');
const { migrateFarmingGame, openFarmingDatabase } = require('./repositories/database');
const { FarmRenderer } = require('./renderer/farmRenderer');
const { FarmingGameService } = require('./services/farmingService');
const { FarmViewRefreshScheduler } = require('./services/refreshScheduler');
const { FarmingViewStore } = require('./services/sessionStore');

function createFarmingGameFeature(options = {}) {
  const clock = options.clock || Date.now;
  const ownsDatabase = !options.db;
  const db = options.db || openFarmingDatabase({
    databasePath: options.databasePath,
    migrationsPath: options.farmingMigrationsPath,
  });
  if (options.db) migrateFarmingGame(db, options.farmingMigrationsPath);
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
  const refreshScheduler = options.refreshScheduler || new FarmViewRefreshScheduler({
    clock,
    farmingService,
    farmRenderer,
    farmViews,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });
  const context = {
    db,
    farmingService,
    farmRenderer,
    farmViews,
    getGuildPolicy: options.getGuildPolicy,
    inventoryViews,
    refreshScheduler,
    repository,
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
      refreshScheduler.clear?.();
      farmRenderer.clear?.();
      farmViews.clear();
      inventoryViews.clear();
      if (ownsDatabase && db.open) db.close();
    },
  };
}

module.exports = { FARMING_GAME_COMMANDS, createFarmingGameFeature };
