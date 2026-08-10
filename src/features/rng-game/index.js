const { RNG_GAME_COMMANDS, createCommandHandlers } = require('./commands');
const { createComponentHandler } = require('./components/handler');
const { autoRollEndedPayload } = require('./components/builders');
const { AutoRollRepository } = require('./repositories/autoRollRepository');
const { openDatabase } = require('./repositories/database');
const { RngGameRepository } = require('./repositories/gameRepository');
const { AutoRollScheduler, AutoRollService } = require('./services/autoRollService');
const { RngGameService } = require('./services/gameService');
const { CropIndexRenderer } = require('./services/indexRenderer');
const { ActionStore, SaleSessionStore, ViewStore } = require('./services/sessionStore');

function createRngGameFeature(options = {}) {
  const clock = options.clock || Date.now;
  const db = options.db || openDatabase({ databasePath: options.databasePath, migrationsPath: options.migrationsPath });
  const repository = options.repository || new RngGameRepository(db);
  const autoRollRepository = options.autoRollRepository || new AutoRollRepository(db, repository);
  const saleSessions = options.saleSessions || new SaleSessionStore({ clock, ttlMs: options.sessionTtlMs });
  const inventoryViews = options.inventoryViews || new ViewStore({ clock, ttlMs: options.sessionTtlMs });
  const actions = options.actions || new ActionStore({ clock, ttlMs: options.sessionTtlMs });
  const indexViews = options.indexViews || new ViewStore({ clock, ttlMs: options.sessionTtlMs });
  const indexRenderer = options.indexRenderer || new CropIndexRenderer(options.indexRendererOptions);
  const onDiscovery = (userId, seedId) => {
    indexRenderer.invalidate(userId);
    options.onDiscovery?.(userId, seedId);
  };
  const gameService = options.gameService || new RngGameService({
    repository,
    saleSessions,
    rng: options.rng,
    clock,
    cooldownMs: options.cooldownMs,
    onDiscovery,
  });
  const autoRollService = options.autoRollService || new AutoRollService({
    repository: autoRollRepository,
    saleSessions,
    rng: options.rng,
    clock,
    onDiscovery,
  });
  let discordClient = options.client || null;
  async function notifyAutoRoll(job) {
    const client = discordClient || options.getClient?.();
    if (!client) throw new Error('Discord client is unavailable for Auto Roll notification.');
    const payload = autoRollEndedPayload(job);
    try {
      const channel = await client.channels.fetch(job.channelId);
      if (channel?.isTextBased?.() && channel?.send) {
        await channel.send(payload);
        return;
      }
    } catch {
      // Fall through to a DM when the original channel was deleted or denied.
    }
    const user = await client.users.fetch(job.userId);
    await user.send(payload);
  }
  const autoRollScheduler = options.autoRollScheduler || new AutoRollScheduler({
    service: autoRollService,
    repository: autoRollRepository,
    clock,
    notify: options.notifyAutoRoll || notifyAutoRoll,
    concurrency: options.schedulerConcurrency,
    batchSize: options.schedulerBatchSize,
    setTimer: options.setTimer,
    clearTimer: options.clearTimer,
  });
  const context = {
    actions,
    autoRollRepository,
    autoRollScheduler,
    autoRollService,
    db,
    gameService,
    getGuildPolicy: options.getGuildPolicy,
    inventoryViews,
    indexRenderer,
    indexViews,
    repository,
    saleSessions,
  };
  const commands = createCommandHandlers(context);
  const handleComponent = createComponentHandler(context);

  return {
    ...context,
    commands: RNG_GAME_COMMANDS,
    startScheduler(client) {
      discordClient = client || discordClient;
      autoRollScheduler.start();
    },
    async handleInteraction(interaction) {
      if (await commands.handleSlash(interaction)) return true;
      return handleComponent(interaction);
    },
    handleMessage: commands.handlePrefix,
    close() {
      actions.clear();
      autoRollScheduler.stop();
      indexRenderer.clear();
      indexViews.clear();
      inventoryViews.clear();
      saleSessions.clear();
      if (!options.db && db.open) db.close();
    },
  };
}

module.exports = { RNG_GAME_COMMANDS, createRngGameFeature };
