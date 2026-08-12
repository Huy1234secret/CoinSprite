const { randomInt, randomUUID } = require('crypto');
const {
  RPS_LOBBY_TIMEOUT_MS,
  RPS_STATES,
  RPS_TURN_TIMEOUT_MS,
} = require('../config/rps');
const { MOVES, parseBet } = require('./rpsRules');

const CHOOSING_TIMEOUT_MS = 15 * 60 * 1_000;
const EXPIRY_POLL_MS = 30 * 1_000;

class RpsService {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock || Date.now;
    this.randomInt = options.randomInt || randomInt;
    this.createId = options.createId || randomUUID;
    this.lobbyTimeoutMs = options.lobbyTimeoutMs || RPS_LOBBY_TIMEOUT_MS;
    this.turnTimeoutMs = options.turnTimeoutMs || RPS_TURN_TIMEOUT_MS;
  }

  now() {
    return Number(this.clock());
  }

  createGame(guildId, channelId, hostProfile) {
    const now = this.now();
    this.repository.expireDue(now);
    return this.repository.create(
      this.createId(), guildId, channelId, hostProfile, now, now + CHOOSING_TIMEOUT_MS,
    );
  }

  game(gameId) {
    return this.repository.game(gameId);
  }

  chooseMode(gameId, hostUserId, mode) {
    return this.repository.setMode(gameId, hostUserId, mode, this.now());
  }

  chooseOpponents(gameId, hostUserId, profiles) {
    return this.repository.setInvites(gameId, hostUserId, profiles, this.now());
  }

  startHumanLobby(gameId, hostUserId, rawBet) {
    const bet = parseBet(rawBet);
    const now = this.now();
    return this.repository.startHumanLobby(gameId, hostUserId, bet, now, now + this.lobbyTimeoutMs);
  }

  randomMove() {
    return MOVES[this.randomInt(MOVES.length)];
  }

  startBotRound(gameId, hostUserId, rawBet) {
    const bet = parseBet(rawBet);
    const now = this.now();
    return this.repository.startBotRound(
      gameId, hostUserId, bet, this.randomMove(), now, now + this.turnTimeoutMs,
    );
  }

  replay(gameId, hostUserId, multiplier) {
    const game = this.game(gameId);
    if (!game || game.mode !== 'bot' || game.hostUserId !== String(hostUserId) || game.state !== RPS_STATES.FINISHED) {
      return { status: 'stale' };
    }
    const factor = BigInt(multiplier);
    return this.startBotRound(gameId, hostUserId, game.bet * factor);
  }

  replayHuman(gameId, hostUserId, rawBet) {
    const game = this.game(gameId);
    if (!game || game.mode !== 'human' || game.hostUserId !== String(hostUserId)
      || game.state !== RPS_STATES.FINISHED) return { status: 'stale' };
    return this.startHumanLobby(gameId, hostUserId, rawBet);
  }

  accept(gameId, userId) {
    const now = this.now();
    return this.repository.accept(gameId, userId, now, now + this.turnTimeoutMs);
  }

  hostStart(gameId, hostUserId) {
    const now = this.now();
    return this.repository.hostStart(gameId, hostUserId, now, now + this.turnTimeoutMs);
  }

  decline(gameId, userId) {
    return this.repository.decline(gameId, userId, this.now());
  }

  proposeHigherBet(gameId, userId, rawBet) {
    const bet = parseBet(rawBet);
    const now = this.now();
    return this.repository.proposeHigherBet(gameId, userId, bet, now, now + this.lobbyTimeoutMs);
  }

  commit(gameId, userId, choice) {
    const now = this.now();
    return this.repository.commit(gameId, userId, choice, now, now + this.turnTimeoutMs);
  }

  reveal(gameId, userId) {
    return this.repository.reveal(gameId, userId, this.now());
  }

  cancel(gameId) {
    return this.repository.cancel(gameId, this.now());
  }

  expireDue() {
    return this.repository.expireDue(this.now());
  }
}

class RpsExpiryScheduler {
  constructor(options) {
    this.service = options.service;
    this.notify = options.notify || (async () => {});
    this.onError = options.onError || (() => {});
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.intervalMs = options.intervalMs || EXPIRY_POLL_MS;
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
      try {
        await this.run();
      } catch (error) {
        this.onError(error);
      }
      this.schedule();
    }, this.intervalMs);
    this.timer?.unref?.();
  }

  start() {
    this.schedule();
  }

  stop() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }
}

module.exports = {
  CHOOSING_TIMEOUT_MS,
  EXPIRY_POLL_MS,
  RpsExpiryScheduler,
  RpsService,
};
