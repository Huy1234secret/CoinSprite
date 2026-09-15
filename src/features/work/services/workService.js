const crypto = require('crypto');
const { activeGamePayload, settledPayload } = require('../components/builders');
const { applyBurgerAction, createBurgerGame } = require('../games/burger');
const { applyTrashAction, createTrashGame } = require('../games/trash');
const { applyPlumberAction, createPlumberGame } = require('../games/plumber');
const { applyElectricianAction, createElectricianGame } = require('../games/electrician');
const newJobs = require('../games/newJobs');

const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard', 'expert']);
const JOBS = Object.freeze(['trash', 'burger', 'electrician', 'plumber', 'odd', 'cashier', 'colors', 'captcha']);
const JOB_CONFIG = Object.freeze({
  odd: { salary: [1_000, 2_200], xp: [15, 95] },
  cashier: { salary: [1_000, 2_700], xp: [20, 110] },
  colors: { salary: [1_000, 3_000], xp: [25, 130] },
  captcha: { salary: [1_000, 2_400], xp: [18, 100] },
  trash: { salary: [1_000, 1_400], xp: [12, 55] },
  electrician: { salary: [1_000, 2_600], xp: [20, 120] },
  burger: { salary: [1_000, 3_000], xp: [25, 130] },
  plumber: { salary: [1_000, 3_500], xp: [45, 180] },
});
const GAME_FACTORIES = Object.freeze({
  odd: newJobs.createOddGame, cashier: newJobs.createCashierGame,
  colors: newJobs.createColorGame, captcha: newJobs.createCaptchaGame,
  burger: createBurgerGame,
  trash: createTrashGame,
  plumber: createPlumberGame,
  electrician: createElectricianGame,
});
const GAME_ACTIONS = Object.freeze({
  odd: newJobs.applyOddAction, cashier: newJobs.applyCashierAction,
  colors: newJobs.applyColorAction, captcha: newJobs.applyCaptchaAction,
  burger: applyBurgerAction,
  trash: applyTrashAction,
  plumber: applyPlumberAction,
  electrician: applyElectricianAction,
});

function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
function scaledReward(range, difficulty) { return Math.round(range[0] + (range[1] - range[0]) * clamp(difficulty, 0, 1)); }
function rewardsFor(job, difficulty) {
  return {
    baseSalary: scaledReward(JOB_CONFIG[job].salary, difficulty),
    xpReward: scaledReward(JOB_CONFIG[job].xp, difficulty),
  };
}
function systemRng() { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; }
function chooseDifficulty(level) {
  const workLevel = Math.max(0, Number(level) || 0);
  if (workLevel >= 30) return 'expert';
  if (workLevel >= 15) return 'hard';
  if (workLevel >= 5) return 'normal';
  return 'easy';
}
function rewardFor(job, difficulty) {
  const normalized = typeof difficulty === 'number' ? difficulty : DIFFICULTIES.indexOf(difficulty) / 3;
  return rewardsFor(job, normalized);
}
function timerSeconds(job, state) {
  if (job === 'odd') return 35 + state.difficulty * 20;
  if (job === 'cashier') return 60 + state.difficulty * 30;
  if (job === 'colors') return 90 + state.difficulty * 45;
  if (job === 'captcha') return 60 + state.difficulty * 15;
  if (job === 'burger') return clamp(30 + 3 * state.target.length, 45, 110);
  if (job === 'trash') return clamp(25 + 4 * state.required, 40, 110);
  if (job === 'electrician') return clamp(25 + 3 * state.buttons.length, 45, 100);
  return clamp(70 + 2 * state.rotatablePipes + 2 * state.minimumSolutionRotations, 90, 240);
}

class WorkService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.clock = options.clock || Date.now;
    this.rng = options.rng || systemRng;
    this.createId = options.createId || (() => crypto.randomBytes(6).toString('base64url'));
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.onTimeout = options.onTimeout || (async () => {});
    this.timers = new Map();
  }

  buildGame(job, difficulty) { return GAME_FACTORIES[job](difficulty, this.rng); }

  async start(input, send) {
    const profile = this.repository.profile(input.userId);
    const difficulty = chooseDifficulty(profile.level);
    const job = JOBS[Math.min(JOBS.length - 1, Math.floor(this.rng() * JOBS.length))];
    const state = this.buildGame(job, difficulty);
    const normalizedDifficulty = clamp(Number(state.difficulty), 0, 1);
    const rewards = rewardsFor(job, normalizedDifficulty);
    const deadline = Number(this.clock()) + timerSeconds(job, state) * 1000;
    const created = this.repository.create({
      sessionId: this.createId(), guildId: String(input.guildId), channelId: String(input.channelId),
      userId: String(input.userId), job, difficulty, normalizedDifficulty, deadline, state,
      bypassCooldown: input.bypassCooldown === true, ...rewards,
    });
    if (created.status !== 'created') return created;
    try {
      const messageId = await send(activeGamePayload(created.session));
      const session = this.repository.attachMessage(created.session.sessionId, messageId);
      this.schedule(session);
      return { status: 'started', session, profile: created.profile };
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
    const settlement = this.repository.settle(sessionId, status, reason);
    if (settlement.changed) this.cancel(sessionId);
    return { ...settlement, reason: settlement.session?.failureReason || reason };
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
    const expired = [];
    for (const session of this.repository.listActive()) {
      if (!session.messageId || session.deadline <= Number(this.clock())) {
        const result = await this.settle(session.sessionId, 'timed_out', 'Time ran out.');
        if (result.changed) {
          expired.push(result);
          await this.onTimeout(result).catch(() => {});
        }
      } else this.schedule(session);
    }
    return expired;
  }

  close() { for (const id of [...this.timers.keys()]) this.cancel(id); }
}

module.exports = {
  DIFFICULTIES, GAME_ACTIONS, GAME_FACTORIES, JOBS, JOB_CONFIG, WorkService,
  chooseDifficulty, clamp, rewardFor, rewardsFor, scaledReward, systemRng, timerSeconds,
};
