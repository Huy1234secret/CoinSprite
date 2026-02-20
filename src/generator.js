const { getUserStats, setUserStats } = require('./userStats');

const BRONZE_BASE_RATE_PER_MINUTE = 10;
const GENERATOR_TIER = 1;
const GENERATOR_COOLDOWN_MS = 60 * 60 * 1000;
const MIN_GENERATE_MINUTES = 10;
const MAX_GENERATE_MINUTES = 480;

function sanitizeGeneratorState(state = {}) {
  const run = state.run && typeof state.run === 'object' ? state.run : null;
  return {
    tier: GENERATOR_TIER,
    cooldownEndsAt: Number.isFinite(state.cooldownEndsAt) ? state.cooldownEndsAt : 0,
    pendingDurationMinutes: Number.isFinite(state.pendingDurationMinutes)
      ? Math.max(MIN_GENERATE_MINUTES, Math.floor(state.pendingDurationMinutes))
      : null,
    locationMultiplier: Number.isFinite(state.locationMultiplier) ? state.locationMultiplier : 1,
    run: run
      ? {
          startedAt: Number.isFinite(run.startedAt) ? run.startedAt : 0,
          endsAt: Number.isFinite(run.endsAt) ? run.endsAt : 0,
          durationMinutes: Number.isFinite(run.durationMinutes) ? Math.max(1, Math.floor(run.durationMinutes)) : 1,
          channelId: typeof run.channelId === 'string' ? run.channelId : null,
          messageId: typeof run.messageId === 'string' ? run.messageId : null,
          guildId: typeof run.guildId === 'string' ? run.guildId : null,
          status:
            run.status === 'running' || run.status === 'ready_claim' || run.status === 'stopped'
              ? run.status
              : 'running',
          generatedAmount: Number.isFinite(run.generatedAmount) ? Math.max(0, Math.floor(run.generatedAmount)) : 0,
          totalMultiplier: Number.isFinite(run.totalMultiplier) ? run.totalMultiplier : 1,
        }
      : null,
  };
}

function getGeneratorProfile(userId) {
  const stats = getUserStats(userId);
  return sanitizeGeneratorState(stats.generator);
}

function setGeneratorProfile(userId, generator) {
  const stats = getUserStats(userId);
  return setUserStats(userId, { ...stats, generator: sanitizeGeneratorState(generator) });
}

function getNotificationSetting(userId) {
  const stats = getUserStats(userId);
  return Boolean(stats.generator_notify_dm ?? true);
}

function setNotificationSetting(userId, enabled) {
  const stats = getUserStats(userId);
  return setUserStats(userId, { ...stats, generator_notify_dm: Boolean(enabled) });
}

function getLocationMultiplier() {
  return 1;
}

function getRateForTier(tier = GENERATOR_TIER) {
  return tier >= 1 ? BRONZE_BASE_RATE_PER_MINUTE : BRONZE_BASE_RATE_PER_MINUTE;
}

module.exports = {
  BRONZE_BASE_RATE_PER_MINUTE,
  GENERATOR_TIER,
  GENERATOR_COOLDOWN_MS,
  MIN_GENERATE_MINUTES,
  MAX_GENERATE_MINUTES,
  getGeneratorProfile,
  setGeneratorProfile,
  getNotificationSetting,
  setNotificationSetting,
  getLocationMultiplier,
  getRateForTier,
  sanitizeGeneratorState,
};
