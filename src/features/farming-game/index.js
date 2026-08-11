const { FARMING_GAME_COMMANDS, createFarmingCommandHandlers } = require('./commands');
const { createFarmingComponentHandler } = require('./components/handler');
const { FarmingGameRepository } = require('./repositories/farmingRepository');
const { migrateFarmingGame, openFarmingDatabase } = require('./repositories/database');
const { FarmRenderer } = require('./renderer/farmRenderer');
const { FarmingIndexRenderer } = require('./renderer/indexRenderer');
const { FarmingGameService } = require('./services/farmingService');
const { FarmingSaleSessionStore, FarmingViewStore } = require('./services/sessionStore');

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
    idGenerator: options.idGenerator,
    anchorGenerator: options.anchorGenerator,
  });
  const farmRenderer = options.farmRenderer || new FarmRenderer(options.rendererOptions);
  const indexRenderer = options.indexRenderer || new FarmingIndexRenderer(options.indexRendererOptions);
  const farmViews = options.farmViews || new FarmingViewStore({ clock, ttlMs: options.sessionTtlMs });
  const indexViews = options.indexViews || new FarmingViewStore({ clock, ttlMs: options.sessionTtlMs });
  const inventoryViews = options.inventoryViews || new FarmingViewStore({ clock, ttlMs: options.sessionTtlMs });
  const saleSessions = options.saleSessions || new FarmingSaleSessionStore({ clock, ttlMs: options.sessionTtlMs });
  const context = {
    db,
    farmingService,
    farmRenderer,
    farmViews,
    getGuildPolicy: options.getGuildPolicy,
    indexRenderer,
    indexViews,
    inventoryViews,
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
      farmRenderer.clear?.();
      indexRenderer.clear?.();
      farmViews.clear();
      indexViews.clear();
      inventoryViews.clear();
      saleSessions.clear();
      if (ownsDatabase && db.open) db.close();
    },
  };
}

module.exports = { FARMING_GAME_COMMANDS, createFarmingGameFeature };
