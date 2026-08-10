const { RNG_GAME_COMMANDS, createCommandHandlers } = require('./commands');
const { createComponentHandler } = require('./components/handler');
const { autoRollEndedPayload, indexPayload } = require('./components/builders');
const { AutoRollRepository } = require('./repositories/autoRollRepository');
const { openDatabase } = require('./repositories/database');
const { RngGameRepository } = require('./repositories/gameRepository');
const { AutoRollScheduler, AutoRollService } = require('./services/autoRollService');
const { RngGameService } = require('./services/gameService');
const { CropIndexRenderer, indexDiscoveryCount } = require('./services/indexRenderer');
const { createSecretRollAnnouncer } = require('./services/secretRollAnnouncement');
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
  let discordClient = options.client || null;
  const reportError = (error, event) => {
    try {
      options.onError?.(error, event);
    } catch {
      // Error reporting is also isolated from persisted game actions.
    }
  };

  async function refreshOpenIndexViews(userId) {
    const discoveries = repository.discoveries(userId);
    const discoveredSeedIds = discoveries.map((entry) => entry.seedId);
    const discoveredCount = indexDiscoveryCount(discoveredSeedIds);
    await Promise.all(indexViews.forOwner(userId).map(async (view) => {
      if (!view.editOriginal) return;
      const image = await indexRenderer.render(userId, discoveredSeedIds, view.page);
      await view.editOriginal(indexPayload(userId, discoveredCount, view, image, { initial: false }));
    }));
  }

  const onDiscovery = (userId, seedId) => {
    indexRenderer.invalidate(userId);
    Promise.resolve(refreshOpenIndexViews(userId)).catch((error) => {
      reportError(error);
    });
    try {
      Promise.resolve(options.onDiscovery?.(userId, seedId)).catch((error) => {
        reportError(error);
      });
    } catch (error) {
      reportError(error);
    }
  };
  const announceSecretRoll = options.secretRollAnnouncer || createSecretRollAnnouncer({
    channelId: options.secretRollChannelId,
    getClient: () => discordClient || options.getClient?.(),
    onError: options.onError ? reportError : undefined,
  });
  const onSuccessfulRoll = (event) => {
    const listeners = [options.onSuccessfulRoll];
    if (event?.seed?.id === 'eclipse_bloom') listeners.push(announceSecretRoll);
    for (const listener of listeners) {
      if (!listener) continue;
      try {
        Promise.resolve(listener(event)).catch((error) => reportError(error, event));
      } catch (error) {
        reportError(error, event);
      }
    }
  };
  const gameService = options.gameService || new RngGameService({
    repository,
    saleSessions,
    rng: options.rng,
    clock,
    cooldownMs: options.cooldownMs,
    onDiscovery,
    onSuccessfulRoll,
  });
  const autoRollService = options.autoRollService || new AutoRollService({
    repository: autoRollRepository,
    saleSessions,
    rng: options.rng,
    clock,
    onDiscovery,
    onSuccessfulRoll,
  });
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
