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
    minSafeForBetBack: 3,
    cashoutGrowth: 1.18,
    mines: 4,
    lossMultiplier: 1,
    houseEdge: 0.08,
  },
  medium: {
    label: '🟡 Medium',
    minSafeForBetBack: 2,
    cashoutGrowth: 1.32,
    mines: 8,
    lossMultiplier: 1,
    houseEdge: 0.10,
  },
  hard: {
    label: '🔴 Hard',
    minSafeForBetBack: 1,
    cashoutGrowth: 1.62,
    mines: 13,
    lossMultiplier: 1,
    houseEdge: 0.13,
  },
  hardcore: {
    label: '💀 HARDCORE',
    minSafeForBetBack: 1,
    cashoutGrowth: 2.35,
    mines: 20,
    lossMultiplier: 1,
    houseEdge: 0.18,
  },
};

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

  const totalCells = 25;
  const mines = Math.max(1, Number(difficultyConfig.mines) || 1);
  const maxSafe = totalCells - mines;
  const clampedSafe = Math.min(safe, maxSafe);

  let survivalChance = 1;
  for (let step = 0; step < clampedSafe; step += 1) {
    survivalChance *= (maxSafe - step) / (totalCells - step);
  }

  const fairMultiplier = 1 / Math.max(0.0001, survivalChance);
  const edgeMultiplier = 1 - Math.min(0.9, Math.max(0, difficultyConfig.houseEdge || 0));
  const streakMultiplier = difficultyConfig.cashoutGrowth ** Math.max(0, clampedSafe - 1);
  const raw = bet * fairMultiplier * edgeMultiplier * streakMultiplier;

  if (clampedSafe < difficultyConfig.minSafeForBetBack) {
    return Math.floor((bet / difficultyConfig.minSafeForBetBack) * clampedSafe);
  }

  return Math.max(1, Math.floor(raw));
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
