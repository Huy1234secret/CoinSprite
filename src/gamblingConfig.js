const COIN = '<:CRCoin:1501105540497936454>';
const SKILL_POINT = '<:CRSP:1501165123711139961>';

const COIN_EMOJI = { id: '1501105540497936454', name: 'CRCoin' };
const SKILL_POINT_EMOJI = { id: '1501165123711139961', name: 'CRSP' };

// Backward-compatible aliases for older commands that still import the previous names.
const PRCOIN = COIN;
const JPCOIN = SKILL_POINT;
const JBCOIN = SKILL_POINT;
const PRCOIN_EMOJI = COIN_EMOJI;
const JPCOIN_EMOJI = SKILL_POINT_EMOJI;
const JBCOIN_EMOJI = SKILL_POINT_EMOJI;

const WHITE_ACCENT = 0xFFFFFF;
const RED_ACCENT = 0xED4245;
const GREEN_ACCENT = 0x57F287;
const YELLOW_ACCENT = 0xFEE75C;

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod'];

const MINEFIELD_DIFFICULTIES = {
  easy: { label: '🟢 Easy', rows: 3, columns: 3, mines: 2 },
  medium: { label: '🟡 Medium', rows: 3, columns: 4, mines: 4 },
  hard: { label: '🔴 Hard', rows: 4, columns: 4, mines: 10 },
  hardcore: { label: '💀 HARDCORE', rows: 5, columns: 5, mines: 19 },
};

const MINEFIELD_PAYOUT_CONFIG = {
  easy: { basePercent: 80, bonusPercents: [20, 40, 60, 80, 120, 200] },
  medium: { basePercent: 80, bonusPercents: [30, 50, 70, 90, 130, 200, 300] },
  hard: { basePercent: 80, bonusPercents: [50, 100, 250, 500, 1000] },
  hardcore: { basePercent: 80, bonusPercents: [100, 200, 500, 1000, 2000] },
};

function getMinefieldBasePercent(difficultyKey) {
  return MINEFIELD_PAYOUT_CONFIG[difficultyKey]?.basePercent ?? 0;
}

function getMinefieldStepIncreasePercent(difficultyKey, safeNumber) {
  if (safeNumber < 2) return 0;
  const bonusPercents = MINEFIELD_PAYOUT_CONFIG[difficultyKey]?.bonusPercents;
  return bonusPercents?.[safeNumber - 2] ?? 0;
}

function formatNumber(value) {
  return Number(Math.floor(Number(value) || 0)).toLocaleString('en-US');
}

function formatAbbreviated(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  const maxTier = SUFFIXES.length - 1;
  const maxValue = 999 * (10 ** (maxTier * 3));
  const safeAmount = Math.min(amount, maxValue);
  let tier = 0;
  let scaled = safeAmount;
  while (scaled >= 1000 && tier < maxTier) {
    scaled /= 1000;
    tier += 1;
  }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  const formatted = Number(scaled.toFixed(decimals)).toString();
  return `${formatted}${SUFFIXES[tier]}`;
}

function calculateMinefieldPayout(bet, difficultyConfig, safeFound, difficultyKeyOverride = null) {
  const safe = Math.max(0, Number(safeFound) || 0);
  if (safe <= 0) return 0;
  const mines = Math.max(1, Number(difficultyConfig?.mines) || 1);
  const rows = Math.max(1, Number(difficultyConfig?.rows) || 1);
  const columns = Math.max(1, Number(difficultyConfig?.columns) || 1);
  const maxSafe = (rows * columns) - mines;
  const clampedSafe = Math.min(safe, maxSafe);
  const difficultyKey = difficultyKeyOverride || Object.entries(MINEFIELD_DIFFICULTIES).find(([, config]) => config === difficultyConfig)?.[0];
  const basePercent = getMinefieldBasePercent(difficultyKey);
  if (basePercent <= 0) return 0;
  const extraPercent = getMinefieldStepIncreasePercent(difficultyKey, clampedSafe);
  return Math.max(0, Math.round(Number(bet) * ((basePercent + extraPercent) / 100)));
}

module.exports = {
  COIN,
  SKILL_POINT,
  COIN_EMOJI,
  SKILL_POINT_EMOJI,
  PRCOIN,
  JPCOIN,
  JBCOIN,
  PRCOIN_EMOJI,
  JPCOIN_EMOJI,
  JBCOIN_EMOJI,
  WHITE_ACCENT,
  RED_ACCENT,
  GREEN_ACCENT,
  YELLOW_ACCENT,
  MINEFIELD_DIFFICULTIES,
  formatNumber,
  formatAbbreviated,
  calculateMinefieldPayout,
};
