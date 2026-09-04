const crypto = require('crypto');
const { activeGamePayload, settledPayload } = require('../components/builders');
const { applyBurgerAction, createBurgerGame } = require('../games/burger');
const { applyTrashAction, createTrashGame } = require('../games/trash');
const { applyPlumberAction, createPlumberGame } = require('../games/plumber');
const { applyElectricianAction, createElectricianGame, electricianTimerSeconds } = require('../games/electrician');

const DIFFICULTIES = Object.freeze([
  { id: 'easy', level: 0, weight: 50, multiplier: 1 },
  { id: 'normal', level: 5, weight: 30, multiplier: 1.5 },
  { id: 'hard', level: 15, weight: 15, multiplier: 2.25 },
  { id: 'expert', level: 30, weight: 5, multiplier: 3.25 },
]);
const JOBS = Object.freeze(['trash', 'burger', 'electrician', 'plumber']);
const JOB_CONFIG = Object.freeze({
  trash: { baseXp: 45, cooldownMs: 5 * 60_000, timers: { easy: 45, normal: 60, hard: 80, expert: 100 } },
  burger: { baseXp: 50, cooldownMs: 6 * 60_000, timers: { easy: 45, normal: 65, hard: 90, expert: 125 } },
  electrician: { baseXp: 60, cooldownMs: 7 * 60_000 },
  plumber: { baseXp: 75, cooldownMs: 9 * 60_000, timers: { easy: 90, normal: 125, hard: 170, expert: 220 } },
});
const GAME_FACTORIES = Object.freeze({ burger: createBurgerGame, trash: createTrashGame, plumber: createPlumberGame, electrician: createElectricianGame });
const GAME_ACTIONS = Object.freeze({ burger: applyBurgerAction, trash: applyTrashAction, plumber: applyPlumberAction, electrician: applyElectricianAction });

function roundToNearest5(value) { return Math.round(Number(value) / 5) * 5; }
function rewardFor(job, difficulty) { return roundToNearest5(JOB_CONFIG[job].baseXp * DIFFICULTIES.find((entry) => entry.id === difficulty).multiplier); }
function chooseDifficulty(level, rng = Math.random) {
  const unlocked = DIFFICULTIES.filter((entry) => level >= entry.level);
  const total = unlocked.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of unlocked) { roll -= entry.weight; if (roll < 0) return entry.id; }
  return unlocked.at(-1).id;
}

class WorkService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.clock = options.clock || Date.now;
    this.rng = options.rng || Math.random;
    this.createId = options.createId || (() => crypto.randomBytes(6).toString('base64url'));
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.awardXp = options.awardXp || (async () => ({ newLevel: 0 }));
    this.getLevel = options.getLevel || (() => 0);
    this.customWirePairs = options.customWirePairs || [];
    this.onTimeout = options.onTimeout || (async () => {});
    this.timers = new Map();
  }

  buildGame(job, difficulty) {
    return job === 'electrician'
      ? createElectricianGame(difficulty, this.rng, this.customWirePairs)
      : GAME_FACTORIES[job](difficulty, this.rng);
  }

  timerSeconds(job, difficulty, state) {
    return job === 'electrician' ? electricianTimerSeconds(state) : JOB_CONFIG[job].timers[difficulty];
  }

  async start(input, send) {
    const difficulty = chooseDifficulty(input.level, this.rng);
    const job = JOBS[Math.min(JOBS.length - 1, Math.floor(this.rng() * JOBS.length))];
    const state = this.buildGame(job, difficulty);
    const deadline = Number(this.clock()) + this.timerSeconds(job, difficulty, state) * 1000;
    const created = this.repository.create({
      sessionId: this.createId(), guildId: String(input.guildId), channelId: String(input.channelId),
      userId: String(input.userId), job, difficulty, deadline, state,
    });
    if (created.status !== 'created') return created;
    try {
      const messageId = await send(activeGamePayload(created.session));
      const session = this.repository.attachMessage(created.session.sessionId, messageId);
      this.schedule(session);
      return { status: 'started', session };
    } catch (error) {
      this.repository.abortSend(created.session.sessionId);
      throw error;
    }
  }

  schedule(session) {
    this.cancel(session.sessionId);
    const delay = Math.max(0, session.deadline - Number(this.clock()));
    const timer = this.setTimer(async () => {
      this.timers.delete(session.sessionId);
      const result = await this.settle(session.sessionId, 'timed_out', 'Time ran out.');
      if (result.changed) await this.onTimeout(result).catch(() => {});
    }, delay);
    timer?.unref?.();
    this.timers.set(session.sessionId, timer);
  }

  cancel(sessionId) {
    const timer = this.timers.get(sessionId);
    if (timer !== undefined) this.clearTimer(timer);
    this.timers.delete(sessionId);
  }

  async settle(sessionId, status, reason) {
    const current = this.repository.get(sessionId);
    if (!current) return { changed: false, reason: 'This work session no longer exists.' };
    const xp = status === 'succeeded' ? rewardFor(current.job, current.difficulty) : 0;
    const settlement = this.repository.settle(sessionId, status, xp, JOB_CONFIG[current.job].cooldownMs);
    if (!settlement.changed) return { ...settlement, reason };
    this.cancel(sessionId);
    let level = this.getLevel(current.guildId, current.userId);
    if (xp) level = (await this.awardXp(current.guildId, current.userId, xp, current.sessionId))?.newLevel ?? level;
    return { ...settlement, level, reason };
  }

  async handleAction(input) {
    const session = this.repository.get(input.sessionId);
    if (!session || session.status !== 'active') return { status: 'inactive', session };
    if (session.userId !== String(input.userId)) return { status: 'denied', reason: 'This work session belongs to another member.' };
    if (session.guildId !== String(input.guildId) || session.channelId !== String(input.channelId) || session.messageId !== String(input.messageId)) {
      return { status: 'denied', reason: 'These controls do not belong to this message.' };
    }
    if (Number(this.clock()) >= session.deadline) {
      const result = await this.settle(session.sessionId, 'timed_out', 'Time ran out.');
      return { status: 'settled', result, payload: settledPayload(result.session, result) };
    }
    const state = session.state;
    const applied = GAME_ACTIONS[session.job](state, input.action);
    if (applied.outcome === 'active') {
      const saved = this.repository.saveState(session.sessionId, state);
      return { status: 'active', session: saved, payload: activeGamePayload(saved, { initial: false }) };
    }
    const result = await this.settle(session.sessionId, applied.outcome, applied.reason || 'The job was not completed.');
    return { status: 'settled', result, payload: settledPayload(result.session, result) };
  }

  async recover() {
    const active = this.repository.listActive();
    const expired = [];
    for (const session of active) {
      if (session.deadline <= Number(this.clock())) {
        const result = await this.settle(session.sessionId, 'timed_out', 'Time ran out.');
        expired.push(result);
        if (result.changed) await this.onTimeout(result).catch(() => {});
      }
      else this.schedule(session);
    }
    return expired.filter((entry) => entry.changed);
  }

  close() { for (const id of [...this.timers.keys()]) this.cancel(id); }
}

module.exports = { DIFFICULTIES, GAME_ACTIONS, GAME_FACTORIES, JOBS, JOB_CONFIG, WorkService, chooseDifficulty, rewardFor, roundToNearest5 };
