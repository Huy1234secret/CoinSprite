const { createComponentHandler } = require('./components/handler');
const { autoRollEndedPayload, indexPayload } = require('./components/builders');
const { canceledPayload } = require('./components/rpsBuilders');
const {
  rouletteResultPayload,
  rouletteSpinningPayload,
  rouletteTerminalPayload,
} = require('./components/rouletteBuilders');
const { ROULETTE_STATES } = require('./config/roulette');
const { AutoRollRepository } = require('./repositories/autoRollRepository');
const { openDatabase } = require('./repositories/database');
const { RngGameRepository } = require('./repositories/gameRepository');
const { ItemPetRepository } = require('./repositories/itemPetRepository');
const { RpsRepository } = require('./repositories/rpsRepository');
const { RouletteRepository } = require('./repositories/rouletteRepository');
const { TokenRepository } = require('./repositories/tokenRepository');
const { AutoRollScheduler, AutoRollService } = require('./services/autoRollService');
const { RngGameService } = require('./services/gameService');
const { ShopPageRenderer } = require('./services/shopCardRenderer');
const { ShopRestockScheduler, ShopService } = require('./services/shopService');
const { RpsTableRenderer } = require('./services/rpsRenderer');
const { RpsExpiryScheduler, RpsService } = require('./services/rpsService');
const { RouletteTableRenderer } = require('./services/rouletteRenderer');
const { loadRouletteStateImage } = require('./services/rouletteMedia');
const { RouletteExpiryScheduler, RouletteRevealScheduler, RouletteService } = require('./services/rouletteService');
const { CropIndexRenderer, indexDiscoveryCount } = require('./services/indexRenderer');
const { createSecretRollAnnouncer } = require('./services/secretRollAnnouncement');
const { ActionStore, SaleSessionStore, ViewStore } = require('./services/sessionStore');
const { createWorkFeature } = require('../work');

const RNG_GAME_COMMANDS = Object.freeze([]);

function createRngGameFeature(options = {}) {
  const clock = options.clock || Date.now;
  const db = options.db || openDatabase({ databasePath: options.databasePath, migrationsPath: options.migrationsPath });
  const repository = options.repository || new RngGameRepository(db);
  const itemRepository = options.itemRepository || new ItemPetRepository(db, repository, {
    restockRng: options.restockRng,
    hatchRng: options.hatchRng,
  });
  const autoRollRepository = options.autoRollRepository || new AutoRollRepository(db, repository);
  const tokenRepository = options.tokenRepository || new TokenRepository(db, repository);
  const rpsRepository = options.rpsRepository || new RpsRepository(db, repository);
  const rouletteRepository = options.rouletteRepository || new RouletteRepository(db, repository);
  const saleSessions = options.saleSessions || new SaleSessionStore({ clock, ttlMs: options.sessionTtlMs });
  const inventoryViews = options.inventoryViews || new ViewStore({ clock, ttlMs: options.sessionTtlMs });
  const shopViews = options.shopViews || new ViewStore({ clock, ttlMs: options.sessionTtlMs });
  const actions = options.actions || new ActionStore({ clock, ttlMs: options.sessionTtlMs });
  const indexViews = options.indexViews || new ViewStore({ clock, ttlMs: options.sessionTtlMs });
  const indexRenderer = options.indexRenderer || new CropIndexRenderer(options.indexRendererOptions);
  const rpsRenderer = options.rpsRenderer || new RpsTableRenderer(options.rpsRendererOptions);
  const rouletteRenderer = options.rouletteRenderer || new RouletteTableRenderer(options.rouletteRendererOptions);
  const rouletteEditQueues = new Map();
  function rouletteQueueEdit(gameId, edit) {
    const id = String(gameId);
    const prior = rouletteEditQueues.get(id) || Promise.resolve();
    const task = prior.catch(() => {}).then(edit).finally(() => {
      if (rouletteEditQueues.get(id) === task) rouletteEditQueues.delete(id);
    });
    rouletteEditQueues.set(id, task);
    return task;
  }
  const shopRenderer = options.shopRenderer || new ShopPageRenderer(options.shopRendererOptions);
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
    itemRepository,
    saleSessions,
    rng: options.rng,
    clock,
    cooldownMs: options.cooldownMs,
    onDiscovery,
    onSuccessfulRoll,
  });
  const autoRollService = options.autoRollService || new AutoRollService({
    repository: autoRollRepository,
    itemRepository,
    saleSessions,
    rng: options.rng,
    clock,
    onDiscovery,
    onSuccessfulRoll,
  });
  const shopService = options.shopService || new ShopService({
    repository: itemRepository,
    renderer: shopRenderer,
    clock,
  });
  const shopScheduler = options.shopScheduler || new ShopRestockScheduler({
    repository: itemRepository,
    clock,
    setTimer: options.shopSetTimer,
    clearTimer: options.shopClearTimer,
    onError: (error) => reportError(error),
  });
  const rpsService = options.rpsService || new RpsService({
    repository: rpsRepository,
    clock,
    randomInt: options.rpsRandomInt,
    createId: options.rpsCreateId,
    lobbyTimeoutMs: options.rpsLobbyTimeoutMs,
    turnTimeoutMs: options.rpsTurnTimeoutMs,
  });
  const rouletteService = options.rouletteService || new RouletteService({
    repository: rouletteRepository,
    clock,
    randomInt: options.rouletteRandomInt,
    createId: options.rouletteCreateId,
    spinDurationMs: options.rouletteSpinDurationMs,
    timeouts: options.rouletteTimeouts,
    onError: (error) => reportError(error),
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
  async function notifyRpsExpired(game) {
    const client = discordClient || options.getClient?.();
    if (!client || !game.channelId || !game.messageId) return;
    const channel = await client.channels.fetch(game.channelId);
    const message = await channel?.messages?.fetch?.(game.messageId);
    await message?.edit?.(canceledPayload(game, { initial: false }));
  }
  const rpsExpiryScheduler = options.rpsExpiryScheduler || new RpsExpiryScheduler({
    service: rpsService,
    notify: options.notifyRpsExpired || notifyRpsExpired,
    onError: (error) => reportError(error),
    setTimer: options.rpsSetTimer,
    clearTimer: options.rpsClearTimer,
    intervalMs: options.rpsExpiryPollMs,
  });
  async function notifyRouletteExpired(game) {
    const client = discordClient || options.getClient?.();
    if (!client || !game.channelId || !game.messageId) return;
    const channel = await client.channels.fetch(game.channelId);
    const message = await channel?.messages?.fetch?.(game.messageId);
    await message?.edit?.(rouletteTerminalPayload(game, { initial: false }));
  }
  const rouletteExpiryScheduler = options.rouletteExpiryScheduler || new RouletteExpiryScheduler({
    service: rouletteService,
    notify: options.notifyRouletteExpired || notifyRouletteExpired,
    onError: (error) => reportError(error),
    setTimer: options.rouletteSetTimer,
    clearTimer: options.rouletteClearTimer,
    intervalMs: options.rouletteExpiryPollMs,
  });
  async function rouletteMessage(game) {
    const client = discordClient || options.getClient?.();
    if (!client || !game.channelId || !game.messageId) return null;
    const channel = await client.channels.fetch(game.channelId);
    return channel?.messages?.fetch?.(game.messageId) || null;
  }
  async function notifyRouletteSpinning(game) {
    await rouletteQueueEdit(game.id, async () => {
      const authoritative = rouletteService.game(game.id);
      if (!authoritative || authoritative.state !== ROULETTE_STATES.SPINNING || authoritative.revision !== game.revision) return;
      const message = await rouletteMessage(authoritative);
      if (!message?.edit) return;
      const [tableImage, media] = await Promise.all([
        rouletteRenderer.render(authoritative),
        loadRouletteStateImage(authoritative, rouletteRenderer, reportError),
      ]);
      const latest = rouletteService.game(game.id);
      if (!latest || latest.state !== ROULETTE_STATES.SPINNING || latest.revision !== authoritative.revision) return;
      await message.edit(rouletteSpinningPayload(authoritative, tableImage, media.image, { initial: false, extension: media.extension }));
    });
  }
  async function notifyRouletteFinished(game) {
    await rouletteQueueEdit(game.id, async () => {
      const authoritative = rouletteService.game(game.id);
      if (!authoritative || authoritative.state !== ROULETTE_STATES.FINISHED || authoritative.revision !== game.revision) return;
      const message = await rouletteMessage(authoritative);
      if (!message?.edit) return;
      const [tableImage, media] = await Promise.all([
        rouletteRenderer.render(authoritative),
        loadRouletteStateImage(authoritative, rouletteRenderer, reportError),
      ]);
      const latest = rouletteService.game(game.id);
      if (!latest || latest.state !== ROULETTE_STATES.FINISHED || latest.revision !== authoritative.revision) return;
      await message.edit(rouletteResultPayload(authoritative, tableImage, media.image, { initial: false }));
    });
  }
  const rouletteRevealScheduler = options.rouletteRevealScheduler || new RouletteRevealScheduler({
    service: rouletteService,
    notifySpinning: options.notifyRouletteSpinning || notifyRouletteSpinning,
    notifyFinished: options.notifyRouletteFinished || notifyRouletteFinished,
    onError: (error) => reportError(error),
    setTimer: options.rouletteRevealSetTimer || options.rouletteSetTimer,
    clearTimer: options.rouletteRevealClearTimer || options.rouletteClearTimer,
    intervalMs: options.rouletteRevealPollMs,
  });
  rouletteService.setSpinStartedHandler?.((game) => rouletteRevealScheduler.schedule(game));
  const context = {
    actions,
    autoRollRepository,
    autoRollScheduler,
    autoRollService,
    db,
    gameService,
    inventoryViews,
    indexRenderer,
    indexViews,
    itemRepository,
    getClient: () => discordClient || options.getClient?.() || null,
    getBotUser: () => (discordClient || options.getClient?.())?.user || null,
    reportError,
    repository,
    shopRenderer,
    shopScheduler,
    shopService,
    shopViews,
    rpsExpiryScheduler,
    rpsRenderer,
    rpsRepository,
    rpsService,
    rouletteExpiryScheduler,
    rouletteQueueEdit,
    rouletteRevealScheduler,
    rouletteRenderer,
    rouletteRepository,
    rouletteService,
    saleSessions,
    tokenRepository,
  };
  const handleComponent = createComponentHandler(context);
  const work = options.workFeature || createWorkFeature({
    db,
    playerRepository: repository,
    clock,
    random: options.workRandom,
    createId: options.workCreateId,
    games: options.workGames,
    reportError,
    sessionTtlMs: options.workSessionTtlMs,
    cooldownMs: options.workCooldownMs,
  });

  return {
    ...context,
    work,
    workRepository: work.repository,
    workService: work.service,
    commands: RNG_GAME_COMMANDS,
    startScheduler(client) {
      discordClient = client || discordClient;
      autoRollScheduler.start();
      shopScheduler.start();
      rpsExpiryScheduler.start();
      rouletteExpiryScheduler.start();
      rouletteRevealScheduler.start();
    },
    async handleInteraction(interaction) {
      if (await handleComponent(interaction)) return true;
      return work.handleInteraction(interaction);
    },
    handleMessage() {
      return false;
    },
    close() {
      actions.clear();
      autoRollScheduler.stop();
      shopScheduler.stop();
      rpsExpiryScheduler.stop();
      rouletteExpiryScheduler.stop();
      rouletteRevealScheduler.stop();
      indexRenderer.clear();
      rpsRenderer.clear();
      rouletteRenderer.clear();
      shopRenderer.clear?.();
      indexViews.clear();
      inventoryViews.clear();
      shopViews.clear();
      saleSessions.clear();
      if (!options.db && db.open) db.close();
    },
  };
}

module.exports = { RNG_GAME_COMMANDS, createRngGameFeature };
