const PRCOIN = '<:PRcoin:1497972406030176356>';
const JBCOIN = '<:Jbcoin:1498172292511825950>';

const PRCOIN_EMOJI = { id: '1497972406030176356', name: 'PRcoin' };
const JBCOIN_EMOJI = { id: '1498172292511825950', name: 'Jbcoin' };

const WHITE_ACCENT = 0xFFFFFF;
const RED_ACCENT = 0xED4245;
const GREEN_ACCENT = 0x57F287;
const YELLOW_ACCENT = 0xFEE75C;

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod'];

const MINEFIELD_DIFFICULTIES = {
  easy: {
    label: '🟢 Easy',
    mines: 4,
  },
  medium: {
    label: '🟡 Medium',
    mines: 8,
  },
  hard: {
    label: '🔴 Hard',
    mines: 13,
  },
  hardcore: {
    label: '💀 HARDCORE',
    mines: 20,
  },
};

const MINEFIELD_PAYOUT_CONFIG = {
  easy: {
    basePercent: 75,
    stepPercents: [19, 21, 23, 25, 27, 29, 31, 33, 35, 37, 39, 41, 43, 45, 47, 49, 51, 53, 55, 57.9],
  },
  medium: {
    basePercent: 75,
    stepPercents: [40, 43, 46, 49, 52, 55, 58, 61, 64, 67, 70, 74, 78, 82, 86, 96.2],
  },
  hard: {
    basePercent: 80,
    stepPercents: [80, 90, 100, 110, 120, 130, 140, 150, 160, 170, 226.65],
  },
  hardcore: {
    basePercent: 100,
    stepPercents: [800, 1200, 1800, 2149.21],
  },
};

function getMinefieldBasePercent(difficultyKey) {
  return MINEFIELD_PAYOUT_CONFIG[difficultyKey]?.basePercent ?? 0;
}

function getMinefieldStepIncreasePercent(difficultyKey, safeNumber) {
  if (safeNumber < 2) return 0;
  const stepPercents = MINEFIELD_PAYOUT_CONFIG[difficultyKey]?.stepPercents;
  return stepPercents?.[safeNumber - 2] ?? 0;
}

function formatNumber(value) {
  return Number(Math.floor(Number(value) || 0)).toLocaleString('en-US');
}

function formatAbbreviated(amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    return '0';
  }

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

function calculateMinefieldPayout(bet, difficultyConfig, safeFound) {
  const safe = Math.max(0, Number(safeFound) || 0);
  if (safe <= 0) return 0;
  const mines = Math.max(1, Number(difficultyConfig?.mines) || 1);
  const maxSafe = 25 - mines;
  const clampedSafe = Math.min(safe, maxSafe);

  const difficultyKey = Object.entries(MINEFIELD_DIFFICULTIES)
    .find(([, config]) => config === difficultyConfig)?.[0];
  const basePercent = getMinefieldBasePercent(difficultyKey);
  if (basePercent <= 0) return 0;

  let pool = Number(bet) * (basePercent / 100);
  for (let safeNumber = 2; safeNumber <= clampedSafe; safeNumber += 1) {
    const bonusPercent = getMinefieldStepIncreasePercent(difficultyKey, safeNumber);
    pool *= 1 + (bonusPercent / 100);
  }

  return Math.max(0, Math.round(pool));
}

module.exports = {
  PRCOIN,
  JBCOIN,
  PRCOIN_EMOJI,
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
