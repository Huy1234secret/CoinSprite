const { randomInt, randomUUID } = require('crypto');
const {
  ROULETTE_SPIN_DURATION_MS,
  ROULETTE_STATES,
  ROULETTE_TIMEOUTS,
} = require('../config/roulette');
const { canonicalBet, parseBetAmount } = require('./rouletteRules');

const ROULETTE_EXPIRY_POLL_MS = 30 * 1_000;
const ROULETTE_REVEAL_POLL_MS = 30 * 1_000;

class RouletteService {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock || Date.now;
    this.randomInt = options.randomInt || randomInt;
    this.createId = options.createId || randomUUID;
    this.createOperationId = options.createOperationId || randomUUID;
    this.timeouts = { ...ROULETTE_TIMEOUTS, ...(options.timeouts || {}) };
    this.spinDurationMs = options.spinDurationMs ?? ROULETTE_SPIN_DURATION_MS;
    this.onSpinStarted = options.onSpinStarted || (() => {});
    this.onError = options.onError || (() => {});
  }

  now() { return Number(this.clock()); }
  game(gameId) { return this.repository.game(gameId); }
  setSpinStartedHandler(handler) { this.onSpinStarted = handler || (() => {}); }

  createGame(guildId, channelId, hostProfile) {
    const now = this.now();
    this.expireDue();
    return this.repository.create(this.createId(), guildId, channelId, hostProfile, now, now + this.timeouts.betting);
  }

  join(gameId, profile) {
    const now = this.now();
    return this.repository.join(gameId, profile, now, now + this.timeouts.betting);
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

  toggleReady(gameId, userId, operationKey = `roulette-ready:${this.createOperationId()}`) {
    const now = this.now();
    return this.repository.toggleReady(gameId, userId, operationKey, now, now + this.timeouts.betting);
  }

  leave(gameId, userId, operationKey) {
    const now = this.now();
    return this.repository.leave(gameId, String(userId), String(operationKey), now, now + this.timeouts.betting);
  }

  beginSpin(gameId, hostUserId) {
    const now = this.now();
    const result = this.repository.beginSpin(
      gameId,
      hostUserId,
      () => this.randomInt(37),
      now,
      now + this.spinDurationMs,
    );
    if (result.status === 'ok' && !result.duplicate) {
      try {
        Promise.resolve(this.onSpinStarted(result.game)).catch(this.onError);
      } catch (error) {
        this.onError(error);
      }
    }
    return result;
  }

  spin(gameId, hostUserId) { return this.beginSpin(gameId, hostUserId); }
  finishSpin(gameId) { return this.repository.finishSpin(gameId, this.now()); }
  spinningGames(limit = 100) { return this.repository.spinning(limit); }

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

class RouletteRevealScheduler {
  constructor(options) {
    this.service = options.service;
    this.notifySpinning = options.notifySpinning || (async () => {});
    this.notifyFinished = options.notifyFinished || (async () => {});
    this.onError = options.onError || (() => {});
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.intervalMs = options.intervalMs || ROULETTE_REVEAL_POLL_MS;
    this.gameTimers = new Map();
    this.running = new Map();
    this.pollTimer = null;
    this.started = false;
  }

  schedule(game) {
    if (!game || game.state !== ROULETTE_STATES.SPINNING || game.revealAt == null) return false;
    const existing = this.gameTimers.get(game.id);
    if (existing !== undefined) this.clearTimer(existing);
    const delay = Math.max(0, game.revealAt - this.service.now());
    const timer = this.setTimer(() => {
      this.gameTimers.delete(game.id);
      void this.finish(game.id);
    }, delay);
    timer?.unref?.();
    this.gameTimers.set(game.id, timer);
    return true;
  }

  finish(gameId) {
    const id = String(gameId);
    if (this.running.has(id)) return this.running.get(id);
    const pending = this.gameTimers.get(id);
    if (pending !== undefined) this.clearTimer(pending);
    this.gameTimers.delete(id);
    const task = Promise.resolve().then(async () => {
      const result = this.service.finishSpin(id);
      if (result.status === 'not-due') {
        this.schedule(result.game);
        return result;
      }
      if (result.status === 'ok' && result.game?.state === ROULETTE_STATES.FINISHED) {
        await this.notifyFinished(result.game);
      }
      return result;
    }).catch((error) => {
      this.onError(error);
      return null;
    }).finally(() => {
      if (this.running.get(id) === task) this.running.delete(id);
    });
    this.running.set(id, task);
    return task;
  }

  async recover() {
    const games = this.service.spinningGames();
    const now = this.service.now();
    await Promise.all(games.map(async (game) => {
      if (game.revealAt == null || game.revealAt <= now) {
        await this.finish(game.id);
        return;
      }
      try { await this.notifySpinning(game); } catch (error) { this.onError(error); }
      this.schedule(game);
    }));
    return games;
  }

  schedulePoll() {
    if (!this.started || this.pollTimer) return;
    this.pollTimer = this.setTimer(async () => {
      this.pollTimer = null;
      try { await this.recover(); } catch (error) { this.onError(error); }
      this.schedulePoll();
    }, this.intervalMs);
    this.pollTimer?.unref?.();
  }

  start() {
    if (this.started) return;
    this.started = true;
    Promise.resolve(this.recover()).catch(this.onError);
    this.schedulePoll();
  }

  stop() {
    this.started = false;
    if (this.pollTimer !== null) this.clearTimer(this.pollTimer);
    this.pollTimer = null;
    for (const timer of this.gameTimers.values()) this.clearTimer(timer);
    this.gameTimers.clear();
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

module.exports = {
  ROULETTE_EXPIRY_POLL_MS,
  ROULETTE_REVEAL_POLL_MS,
  RouletteExpiryScheduler,
  RouletteRevealScheduler,
  RouletteService,
};
