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

function getMinefieldPayoutPercent(difficultyKey, safeFound) {
  const safe = Math.max(0, Number(safeFound) || 0);
  if (safe <= 0) return 0;

  if (difficultyKey === 'easy') {
    if (safe === 1) return 50;
    if (safe <= 7) return 110;
    if (safe <= 12) return 125;
    if (safe <= 18) return 150;
    if (safe <= 20) return 200;
    return 300;
  }

  if (difficultyKey === 'medium') {
    if (safe === 1) return 65;
    if (safe <= 8) return 135;
    if (safe <= 13) return 200;
    if (safe <= 16) return 300;
    return 500;
  }

  if (difficultyKey === 'hard') {
    if (safe === 1) return 80;
    if (safe <= 5) return 160;
    if (safe <= 9) return 400;
    if (safe <= 11) return 850;
    return 1300;
  }

  if (difficultyKey === 'hardcore') {
    if (safe === 1) return 125;
    if (safe === 2) return 1100;
    if (safe === 3) return 2100;
    if (safe === 4) return 3100;
    return 4100;
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
  const payoutPercent = getMinefieldPayoutPercent(difficultyKey, clampedSafe);
  return Math.max(0, Math.floor((bet * payoutPercent) / 100));
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
