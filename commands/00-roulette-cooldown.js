// Bootstrap shared Roulette cooldown state before interactions can execute.
// roulette.js references rouletteCooldowns and ROULETTE_COOLDOWN_MS as
// module-global identifiers, so expose them on globalThis to prevent
// ReferenceError while preserving the existing command behavior.
if (!(globalThis.rouletteCooldowns instanceof Map)) {
  globalThis.rouletteCooldowns = new Map();
}

globalThis.ROULETTE_COOLDOWN_MS = 30_000;

module.exports = {};
