// Bootstrap shared Roulette cooldown state before interactions can execute.
// roulette.js references rouletteCooldowns as a module-global identifier, so expose
// it on globalThis to prevent ReferenceError while preserving the existing command.
if (!(globalThis.rouletteCooldowns instanceof Map)) {
  globalThis.rouletteCooldowns = new Map();
}

module.exports = {};
