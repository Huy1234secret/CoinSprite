const { randomInt, randomUUID } = require('crypto');
const { ROULETTE_STATES, ROULETTE_TIMEOUTS } = require('../config/roulette');
const { canonicalBet, parseBetAmount } = require('./rouletteRules');

const ROULETTE_EXPIRY_POLL_MS = 30 * 1_000;

class RouletteService {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock || Date.now;
    this.randomInt = options.randomInt || randomInt;
    this.createId = options.createId || randomUUID;
    this.createOperationId = options.createOperationId || randomUUID;
    this.timeouts = { ...ROULETTE_TIMEOUTS, ...(options.timeouts || {}) };
  }

  now() { return Number(this.clock()); }
  game(gameId) { return this.repository.game(gameId); }

  createGame(guildId, channelId, hostProfile) {
    const now = this.now();
    this.expireDue();
    return this.repository.create(this.createId(), guildId, channelId, hostProfile, now, now + this.timeouts.choosing);
  }

  chooseMode(gameId, hostUserId, mode) {
    const now = this.now();
    const timeout = mode === 'bot' ? this.timeouts.betting : this.timeouts.choosing;
    return this.repository.chooseMode(gameId, hostUserId, mode, now, now + timeout);
  }

  invite(gameId, hostUserId, profiles) {
    const now = this.now();
    return this.repository.invite(gameId, hostUserId, profiles, now, now + this.timeouts.lobby);
  }

  accept(gameId, userId) { return this.repository.accept(gameId, userId, this.now()); }
  decline(gameId, userId) { return this.repository.decline(gameId, userId, this.now()); }
  start(gameId, hostUserId) {
    const now = this.now();
    return this.repository.start(gameId, hostUserId, now, now + this.timeouts.betting);
  }

  place(gameId, userId, type, target, rawAmount, operationKey) {
    const canonical = canonicalBet(type, target);
    const amount = parseBetAmount(rawAmount);
    const now = this.now();
    return this.repository.place(gameId, userId, canonical.type, canonical.target, amount, operationKey, now, now + this.timeouts.betting);
  }

  undo(gameId, userId, operationKey) {
    const now = this.now();
    return this.repository.undo(gameId, userId, operationKey, now, now + this.timeouts.betting);
  }

  clear(gameId, userId, operationKey) {
    const now = this.now();
    return this.repository.clear(gameId, userId, operationKey, now, now + this.timeouts.betting);
  }

  setReady(gameId, userId, ready, operationKey = `roulette-ready:${this.createOperationId()}`) {
    const now = this.now();
    return this.repository.ready(gameId, userId, ready, operationKey, now, now + this.timeouts.betting);
  }

  leave(gameId, userId, operationKey) {
    const now = this.now();
    return this.repository.leave(gameId, String(userId), String(operationKey), now, now + this.timeouts.betting);
  }

  spin(gameId, hostUserId) {
    return this.repository.settle(gameId, hostUserId, () => this.randomInt(37), this.now());
  }

  cancel(gameId) { return this.repository.refundAll(gameId, ROULETTE_STATES.CANCELED, this.now()); }
  replay(gameId, hostUserId) {
    const now = this.now();
    return this.repository.replay(gameId, hostUserId, now, now + this.timeouts.betting);
  }

  expireDue() {
    const now = this.now();
    return this.repository.due(now).map((gameId) => this.repository.refundAll(gameId, ROULETTE_STATES.EXPIRED, now).game);
  }
}

class RouletteExpiryScheduler {
  constructor(options) {
    this.service = options.service;
    this.notify = options.notify || (async () => {});
    this.onError = options.onError || (() => {});
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.intervalMs = options.intervalMs || ROULETTE_EXPIRY_POLL_MS;
    this.timer = null;
    this.running = false;
  }

  async run() {
    if (this.running) return [];
    this.running = true;
    try {
      const games = this.service.expireDue();
      await Promise.all(games.map((game) => Promise.resolve(this.notify(game)).catch(this.onError)));
      return games;
    } finally {
      this.running = false;
    }
  }

  schedule() {
    if (this.timer) return;
    this.timer = this.setTimer(async () => {
      this.timer = null;
      try { await this.run(); } catch (error) { this.onError(error); }
      this.schedule();
    }, this.intervalMs);
    this.timer?.unref?.();
  }
  start() { this.schedule(); }
  stop() { if (this.timer) this.clearTimer(this.timer); this.timer = null; }
}

module.exports = { ROULETTE_EXPIRY_POLL_MS, RouletteExpiryScheduler, RouletteService };
