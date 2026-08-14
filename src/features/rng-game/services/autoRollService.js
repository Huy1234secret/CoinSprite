const { randomUUID } = require('crypto');
const { SEEDS } = require('../data/seeds');
const { cascadingRoll } = require('./rngService');
const { emitSuccessfulRoll } = require('./rollEvent');
const { autoRollCostPerRoll } = require('./economyService');
const {
  AUTO_ROLL_INTERVAL_MS,
  autoRollPlan,
  nextGlobalTick,
  parseDuration,
} = require('../utils/autoRoll');

const AUTO_SELL_RARITIES = Object.freeze(['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary', 'Mythic', 'Super', 'Secret']);

function normalizeAutoSellRarities(values) {
  const requested = new Set((values || []).map(String));
  const normalized = AUTO_SELL_RARITIES.filter((rarity) => requested.has(rarity));
  if (requested.size !== normalized.length) throw new RangeError('Choose only rarities shown in the Auto Roll form.');
  return normalized;
}

class AutoRollService {
  constructor(options) {
    this.repository = options.repository;
    this.saleSessions = options.saleSessions;
    this.itemRepository = options.itemRepository || null;
    this.rng = options.rng;
    this.clock = options.clock || Date.now;
    this.onDiscovery = options.onDiscovery || (() => {});
    this.onSuccessfulRoll = options.onSuccessfulRoll || (() => {});
  }

  preview(userId, durationText, selectedRarities) {
    const duration = parseDuration(durationText);
    const player = this.repository.gameRepository.getPlayer(String(userId), this.clock());
    const costPerRoll = autoRollCostPerRoll(player.luckTier, player.bigCropTier);
    return {
      ...duration,
      ...autoRollPlan(duration.durationMinutes, costPerRoll),
      pricedLuckTier: player.luckTier,
      pricedBigTier: player.bigCropTier,
      selectedAutoSellRarities: normalizeAutoSellRarities(selectedRarities),
    };
  }

  active(userId) {
    return this.repository.activeForUser(String(userId));
  }

  start(userId, preview, location = {}) {
    const id = String(userId);
    const current = this.active(id);
    if (current) return { status: 'already-active', job: current };
    if (this.saleSessions.has(id)) return { status: 'sale-active' };
    const player = this.repository.gameRepository.getPlayer(id, this.clock());
    const costPerRoll = autoRollCostPerRoll(player.luckTier, player.bigCropTier);
    const plan = autoRollPlan(preview.durationMinutes, costPerRoll);
    const rarities = normalizeAutoSellRarities(preview.selectedAutoSellRarities);
    if (BigInt(preview.costPerRoll) !== costPerRoll
      || Number(preview.pricedLuckTier) !== player.luckTier
      || Number(preview.pricedBigTier) !== player.bigCropTier) {
      return {
        status: 'price-changed',
        preview: {
          ...preview,
          ...plan,
          pricedLuckTier: player.luckTier,
          pricedBigTier: player.bigCropTier,
          selectedAutoSellRarities: rarities,
        },
      };
    }
    const now = this.clock();
    const nextTickAt = nextGlobalTick(now);
    const result = this.repository.startJob(id, {
      ...plan,
      guildId: String(location.guildId || ''),
      channelId: String(location.channelId || ''),
      selectedAutoSellRarities: rarities,
      nextTickAt,
      endsAt: nextTickAt + (plan.plannedRolls * AUTO_ROLL_INTERVAL_MS),
    }, { now, isSaleLocked: () => this.saleSessions.has(id) });
    if (result.status !== 'price-changed') return result;
    const refreshedPlan = autoRollPlan(preview.durationMinutes, result.costPerRoll);
    return {
      status: 'price-changed',
      preview: {
        ...preview,
        ...refreshedPlan,
        pricedLuckTier: result.player.luckTier,
        pricedBigTier: result.player.bigCropTier,
        selectedAutoSellRarities: rarities,
      },
    };
  }

  processTick(jobId, scheduledTick, now = this.clock()) {
    const result = this.repository.processTick(jobId, scheduledTick, (player) => {
      const modifiers = this.itemRepository?.resolveRollModifiers(player.userId, now) || {};
      return cascadingRoll({
        rng: this.rng,
        luckTier: player.luckTier,
        bigCropTier: player.bigCropTier,
        ...modifiers,
      });
    }, now, (userId, instance) => {
      if (instance.modifierSnapshot?.wateringCanItemId) {
        const consumed = this.itemRepository?.consumeWateringCharge(
          userId,
          instance.modifierSnapshot.wateringCanItemId,
          now,
        );
        if (this.itemRepository && !consumed) throw new Error('Watering-can charge changed during Auto Roll.');
      }
    });
    if (result.discoveredNew) this.onDiscovery(result.job.userId, result.seed.id);
    emitSuccessfulRoll(this.onSuccessfulRoll, result.job?.userId, result, 'auto-roll');
    return result;
  }
}

class AutoRollScheduler {
  constructor(options) {
    this.service = options.service;
    this.repository = options.repository;
    this.clock = options.clock || Date.now;
    this.notify = options.notify || (async () => {});
    this.concurrency = Math.max(1, Math.min(20, Number(options.concurrency) || 5));
    this.batchSize = Math.max(1, Math.min(500, Number(options.batchSize) || 100));
    this.ownerId = options.ownerId || randomUUID();
    this.setTimer = options.setTimer || setTimeout;
    this.clearTimer = options.clearTimer || clearTimeout;
    this.onError = options.onError || ((error) => console.error('RNG Auto Roll scheduler failed:', error?.message || error));
    this.timer = null;
    this.running = false;
  }

  async runPool(items, worker) {
    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.concurrency, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor];
        cursor += 1;
        await worker(item);
      }
    });
    await Promise.all(workers);
  }

  async notifyFinished() {
    const jobs = this.repository.unnotifiedJobs(this.batchSize);
    await this.runPool(jobs, async (job) => {
      try {
        await this.notify(job);
        this.repository.markNotified(job.id, this.clock());
      } catch {
        // Leave notified_at empty so a later global tick can retry channel/DM delivery.
      }
    });
  }

  async runBoundary(now = this.clock()) {
    const boundary = Math.floor(Number(now) / AUTO_ROLL_INTERVAL_MS) * AUTO_ROLL_INTERVAL_MS;
    if (!this.repository.acquireLease(this.ownerId, boundary, AUTO_ROLL_INTERVAL_MS - 250)) {
      return { status: 'leased', processed: 0 };
    }
    const jobs = this.repository.dueJobs(boundary, this.batchSize);
    await this.runPool(jobs, async (job) => this.service.processTick(job.id, boundary, now));
    await this.notifyFinished();
    return { status: 'ok', processed: jobs.length, boundary };
  }

  scheduleNext() {
    if (!this.running) return;
    const delay = Math.max(1, nextGlobalTick(this.clock()) - this.clock());
    this.timer = this.setTimer(async () => {
      try {
        await this.runBoundary(this.clock());
      } catch (error) {
        this.onError(error);
      } finally {
        this.scheduleNext();
      }
    }, delay);
    this.timer?.unref?.();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop() {
    this.running = false;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
  }
}

function autoRollSummaryEntries(job) {
  return SEEDS.filter((seed) => Number(job.summaryCounts?.[seed.id] || 0) > 0)
    .map((seed) => ({ seed, count: Number(job.summaryCounts[seed.id]) }));
}

module.exports = {
  AUTO_SELL_RARITIES,
  AutoRollScheduler,
  AutoRollService,
  autoRollSummaryEntries,
  normalizeAutoSellRarities,
};
