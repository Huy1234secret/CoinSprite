// Keep roulette.js compatible with its existing cooldown references without
// letting a stale process-global timestamp block /roulette indefinitely.
// The actual roulette command and its canvas/GIF/PNG rendering live in
// commands/roulette.js and are intentionally left untouched.
globalThis.ROULETTE_COOLDOWN_MS = 0;

globalThis.rouletteCooldowns = {
  get() {
    return 0;
  },
  set() {
    return this;
  },
  delete() {
    return false;
  },
  clear() {},
};

module.exports = {};
