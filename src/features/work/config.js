const WORK_SESSION_TTL_MS = 2 * 60 * 1_000;
const WORK_COOLDOWN_MS = 60 * 60 * 1_000;

module.exports = Object.freeze({
  WORK_COOLDOWN_MS,
  WORK_SESSION_TTL_MS,
});
