const { randomUUID } = require('crypto');
const { WORK_GAMES } = require('../data');
const { unlockedDifficulties, workRank } = require('../ranks');
const { WORK_COOLDOWN_MS, WORK_SESSION_TTL_MS } = require('../config');

function randomIndex(length, random) {
  if (!Number.isInteger(length) || length < 1) throw new RangeError('Cannot select from an empty work registry.');
  const value = Number(random(length));
  if (!Number.isInteger(value) || value < 0 || value >= length) {
    throw new RangeError(`Work random function returned ${value} for a collection of ${length}.`);
  }
  return value;
}

function selectRandom(values, random) {
  return values[randomIndex(values.length, random)];
}

function shuffleIngredients(ingredients, random) {
  const shuffled = ingredients.map((ingredient, index) => ({ index, ingredient }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const selected = randomIndex(index + 1, random);
    [shuffled[index], shuffled[selected]] = [shuffled[selected], shuffled[index]];
  }
  return shuffled.map((slot, index) => ({ index, ingredient: slot.ingredient }));
}

class WorkService {
  constructor(options) {
    this.repository = options.repository;
    this.clock = options.clock || Date.now;
    this.random = options.random || ((maximum) => Math.floor(Math.random() * maximum));
    this.createId = options.createId || (() => randomUUID().replaceAll('-', ''));
    this.games = options.games || WORK_GAMES;
    this.sessionTtlMs = options.sessionTtlMs ?? WORK_SESSION_TTL_MS;
    this.cooldownMs = options.cooldownMs ?? WORK_COOLDOWN_MS;
  }

  profile(userId) {
    return this.repository.profile(userId, this.clock());
  }

  start(userId, context = {}) {
    const now = this.clock();
    const profile = this.repository.profile(userId, now);
    const rank = workRank(profile.totalXp);
    const games = this.games.filter((game) => !game.eligible || game.eligible({ profile, rank }));
    const game = selectRandom(games, this.random);
    const unlocked = new Set(unlockedDifficulties(rank.level));
    const customers = game.customers.filter((customer) => unlocked.has(customer.difficulty));
    const customer = selectRandom(customers, this.random);
    const gameMessage = selectRandom(game.messages, this.random);
    return this.repository.start({
      id: this.createId(),
      userId: String(userId),
      guildId: context.guildId,
      channelId: context.channelId,
      messageId: context.messageId,
      gameId: game.id,
      customerId: customer.id,
      gameMessage,
      expectedRecipe: customer.order,
      buttonSlots: shuffleIngredients(customer.order, this.random),
      baseReward: customer.reward,
      salaryBoost: rank.salaryBoost + profile.workStreak,
      streakBoost: profile.workStreak,
    }, { now, ttlMs: this.sessionTtlMs, cooldownMs: this.cooldownMs });
  }

  press(sessionId, userId, slotIndex) {
    return this.repository.press(sessionId, userId, slotIndex, this.clock());
  }

  cancel(sessionId, userId) {
    return this.repository.cancel(sessionId, userId, this.clock());
  }

  expire(sessionId) {
    return this.repository.expire(sessionId, this.clock());
  }

  customer(session) {
    return this.games
      .find((game) => game.id === session.gameId)
      ?.customers.find((customer) => customer.id === session.customerId) || null;
  }
}

module.exports = {
  WORK_COOLDOWN_MS,
  WORK_SESSION_TTL_MS,
  WorkService,
  randomIndex,
  selectRandom,
  shuffleIngredients,
};
