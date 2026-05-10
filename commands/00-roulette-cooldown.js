// Bootstrap shared Roulette cooldown state before interactions can execute.
// roulette.js references rouletteCooldowns and ROULETTE_COOLDOWN_MS as
// module-global identifiers, so expose them on globalThis to prevent
// ReferenceError while preserving the existing command behavior.
const ROULETTE_COOLDOWN_MS = 30_000;
const rouletteCooldownStore = new Map();

function normalizeCooldown(until) {
  const value = Math.floor(Number(until) || 0);
  if (value <= Date.now()) return 0;
  const maxUntil = Date.now() + ROULETTE_COOLDOWN_MS;
  return value > maxUntil ? 0 : value;
}

globalThis.rouletteCooldowns = {
  get(userId) {
    const until = normalizeCooldown(rouletteCooldownStore.get(userId));
    if (!until) rouletteCooldownStore.delete(userId);
    return until;
  },
  set(userId, until) {
    const normalized = normalizeCooldown(until);
    if (normalized) rouletteCooldownStore.set(userId, normalized);
    else rouletteCooldownStore.delete(userId);
    return this;
  },
  delete(userId) {
    return rouletteCooldownStore.delete(userId);
  },
  clear() {
    rouletteCooldownStore.clear();
  },
};

globalThis.ROULETTE_COOLDOWN_MS = ROULETTE_COOLDOWN_MS;

module.exports = {};
