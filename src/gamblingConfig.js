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

function getMinefieldBasePercent(difficultyKey) {
  if (difficultyKey === 'easy') return 70;
  if (difficultyKey === 'medium') return 75;
  if (difficultyKey === 'hard') return 80;
  if (difficultyKey === 'hardcore') return 110;
  return 0;
}

function getMinefieldStepIncreasePercent(difficultyKey, safeNumber) {
  if (difficultyKey === 'easy') {
    if (safeNumber >= 2 && safeNumber <= 7) return 14;
    if (safeNumber <= 12) return 18;
    if (safeNumber <= 18) return 24;
    if (safeNumber <= 20) return 35;
    if (safeNumber === 21) return 50;
  }

  if (difficultyKey === 'medium') {
    if (safeNumber >= 2 && safeNumber <= 7) return 24;
    if (safeNumber <= 13) return 37;
    if (safeNumber <= 16) return 80;
    if (safeNumber === 17) return 135;
  }

  if (difficultyKey === 'hard') {
    if (safeNumber >= 2 && safeNumber <= 5) return 45;
    if (safeNumber <= 9) return 100;
    if (safeNumber <= 11) return 225;
    if (safeNumber === 12) return 350;
  }

  if (difficultyKey === 'hardcore') {
    if (safeNumber === 2) return 400;
    if (safeNumber === 3) return 900;
    if (safeNumber === 4) return 1400;
    if (safeNumber === 5) return 1700;
  }

  return 0;
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
