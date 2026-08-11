const AUTO_ROLL_INTERVAL_MS = 5_000;
const AUTO_ROLL_COST_PER_ROLL = 5n;
const AUTO_ROLL_ROLLS_PER_MINUTE = 12;
const MAX_AUTO_ROLL_MINUTES = 24 * 60;
const SQLITE_INTEGER_MAX = 9_223_372_036_854_775_807n;

function parseDuration(value) {
  const text = String(value || '').trim().toLowerCase();
  const tokens = [...text.matchAll(/(\d+)\s*([dhm])/gi)];
  if (!tokens.length || text.replace(/(\d+)\s*([dhm])/gi, '').trim()) {
    throw new RangeError('Use days, hours, and minutes, for example `50m`, `4h 13m`, or `1d`.');
  }
  const parts = { d: 0, h: 0, m: 0 };
  const seen = new Set();
  for (const token of tokens) {
    const unit = token[2].toLowerCase();
    if (seen.has(unit)) throw new RangeError('Each duration unit may only be used once.');
    seen.add(unit);
    parts[unit] = Number(token[1]);
  }
  const { d: days, h: hours, m: minutes } = parts;
  if (![days, hours, minutes].every(Number.isSafeInteger)) throw new RangeError('Duration is too large.');
  const durationMinutes = (days * 1_440) + (hours * 60) + minutes;
  if (durationMinutes < 1) throw new RangeError('Auto Roll must run for at least one minute.');
  if (durationMinutes > MAX_AUTO_ROLL_MINUTES) throw new RangeError('Auto Roll cannot run for more than one day.');
  return { durationMinutes, normalized: normalizeDuration(durationMinutes) };
}

function normalizeDuration(durationMinutes) {
  let remaining = Math.max(0, Math.floor(Number(durationMinutes) || 0));
  const days = Math.floor(remaining / 1_440);
  remaining %= 1_440;
  const hours = Math.floor(remaining / 60);
  const minutes = remaining % 60;
  return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ') || '0m';
}

function autoRollPlan(durationMinutes, costPerRoll = AUTO_ROLL_COST_PER_ROLL) {
  const minutes = Math.floor(Number(durationMinutes));
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_AUTO_ROLL_MINUTES) {
    throw new RangeError('Auto Roll duration must be between one minute and one day.');
  }
  const price = BigInt(costPerRoll);
  if (price < AUTO_ROLL_COST_PER_ROLL) throw new RangeError('Auto Roll price cannot be below five Sheckles per roll.');
  const plannedRolls = minutes * AUTO_ROLL_ROLLS_PER_MINUTE;
  const totalCost = BigInt(plannedRolls) * price;
  if (totalCost > SQLITE_INTEGER_MAX) throw new RangeError('Auto Roll cost exceeds SQLite signed 64-bit range.');
  return {
    durationMinutes: minutes,
    plannedRolls,
    costPerRoll: price,
    totalCost,
  };
}

function nextGlobalTick(now = Date.now()) {
  const timestamp = Math.floor(Number(now));
  return (Math.floor(timestamp / AUTO_ROLL_INTERVAL_MS) * AUTO_ROLL_INTERVAL_MS) + AUTO_ROLL_INTERVAL_MS;
}

function autoRollRefund(plannedRolls, completedRolls, costPerRoll = AUTO_ROLL_COST_PER_ROLL) {
  const remaining = Math.max(0, Number(plannedRolls) - Number(completedRolls));
  return BigInt(remaining) * BigInt(costPerRoll);
}

module.exports = {
  AUTO_ROLL_COST_PER_ROLL,
  AUTO_ROLL_INTERVAL_MS,
  AUTO_ROLL_ROLLS_PER_MINUTE,
  MAX_AUTO_ROLL_MINUTES,
  SQLITE_INTEGER_MAX,
  autoRollPlan,
  autoRollRefund,
  nextGlobalTick,
  normalizeDuration,
  parseDuration,
};
