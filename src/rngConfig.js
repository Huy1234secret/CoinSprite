const PRCOIN = '<:PRcoin:1497972406030176356>';
const RBCOIN = '<:Rbcoin:1498172292511825950>';
const Y_MARK = '<:Y_:1498173245981986869>';
const N_MARK = '<:N_:1498173244031631400>';

const PRCOIN_EMOJI = { id: '1497972406030176356', name: 'PRcoin' };
const RBCOIN_EMOJI = { id: '1498172292511825950', name: 'Rbcoin' };

const WHITE_ACCENT = 0xFFFFFF;
const RED_ACCENT = 0xED4245;
const GREEN_ACCENT = 0x57F287;
const YELLOW_ACCENT = 0xFEE75C;
const CYAN_ACCENT = 0x3BFFFF;
const LIGHT_PURPLE_ACCENT = 0xC084FC;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTER_POOL_SIZE = 130;
const BASE_CHANCE_DECAY = 0.74;
const MAX_CHANCE_DECAY = 0.84;
const MAX_LUCK_PERCENT = 75;
const LUCK_GROWTH_RATE = 0.145;
const REWARD_SPREAD_PERCENT = 0.35;

const BASE_CRIT_POWER_PERCENT = 25;
const CRIT_CHANCE_PER_LEVEL = 5;
const MAX_CRIT_CHANCE_LEVEL = 10;
const MAX_CRIT_CHANCE_PERCENT = 50;
const MAX_LUCK_LEVEL = 60;

const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc', 'Ud', 'Dd', 'Td', 'Qad', 'Qid', 'Sxd', 'Spd', 'Ocd', 'Nod'];

const REBIRTHS = [
  null,
  {
    tier: 1,
    coinMultiplier: 2,
    luckMultiplier: 1.05,
    rewardRebirthCoins: 1,
    requiredCoins: 25_000,
    requiredLetter: 'Z',
    unlocks: ['Unlock Rebirth Upgrades'],
  },
  {
    tier: 2,
    coinMultiplier: 4,
    luckMultiplier: 1.10,
    rewardRebirthCoins: 2,
    requiredCoins: 250_000,
    requiredLetter: '1C',
    unlocks: [],
  },
  {
    tier: 3,
    coinMultiplier: 8,
    luckMultiplier: 1.15,
    rewardRebirthCoins: 3,
    requiredCoins: 1_000_000,
    requiredLetter: '1H',
    unlocks: [],
  },
  {
    tier: 4,
    coinMultiplier: 16,
    luckMultiplier: 1.20,
    rewardRebirthCoins: 5,
    requiredCoins: 4_000_000,
    requiredLetter: '1M',
    unlocks: [],
  },
  {
    tier: 5,
    coinMultiplier: 32,
    luckMultiplier: 1.25,
    rewardRebirthCoins: 7,
    requiredCoins: 15_000_000,
    requiredLetter: '1R',
    unlocks: [],
  },
  {
    tier: 6,
    coinMultiplier: 64,
    luckMultiplier: 1.30,
    rewardRebirthCoins: 9,
    requiredCoins: 60_000_000,
    requiredLetter: '1W',
    unlocks: [],
  },
  {
    tier: 7,
    coinMultiplier: 128,
    luckMultiplier: 1.35,
    rewardRebirthCoins: 13,
    requiredCoins: 250_000_000,
    requiredLetter: '1Z',
    unlocks: [],
  },
];

const REBIRTH_UPGRADES = {
  glyphGrowth: {
    key: 'glyphGrowth',
    emoji: '✨',
    name: 'Glyph Growth',
    prices: [1, 2, 3, 5],
    values: [0.1, 0.22, 0.4, 0.65],
    formatValue: (value) => `${value}%`,
    description: (value) => `Every unique alphabet discovered increases coin gain by **${value}%**.`,
  },
  rarityJackpot: {
    key: 'rarityJackpot',
    emoji: '💎',
    name: 'Rarity Jackpot',
    prices: [1, 2, 4, 7],
    values: [2, 4, 8, 20],
    formatValue: (value) => `${value}x`,
    description: (value) => `Rolling an alphabet with chance lower than **0.1%** earns **${value}x** coins from that roll.`,
  },
  luckDiscount: {
    key: 'luckDiscount',
    emoji: '💸',
    name: 'Luck Discount',
    prices: [1, 2, 3],
    values: [5, 10, 15],
    formatValue: (value) => `${value}%`,
    description: (value) => `Reduces Luck upgrade prices by **${value}%**.`,
  },
  fortuneCharge: {
    key: 'fortuneCharge',
    emoji: '⚡',
    name: 'Fortune Charge',
    prices: [1, 2, 4],
    values: [50, 100, 175],
    formatValue: (value) => `${value}%`,
    description: (value) => `Every 25th roll stores **+${value}% Luck** for your next roll once.`,
  },
  minefieldFortune: {
    key: 'minefieldFortune',
    emoji: '💣',
    name: 'Minefield Fortune',
    prices: [2],
    values: ['unlock'],
    formatValue: () => 'Unlock',
    description: () => 'Unlocks the Mines gambling game, where you can risk coins to uncover rewards while avoiding bombs.',
  },
};

const REBIRTH_UPGRADE_ORDER = [
  'glyphGrowth',
  'rarityJackpot',
  'luckDiscount',
  'fortuneCharge',
  'minefieldFortune',
];

const MINEFIELD_DIFFICULTIES = {
  easy: {
    label: '🟢 Easy',
    minSafeForBetBack: 5,
    bonusMultiplier: 1.25,
    mines: 5,
    lossMultiplier: 1,
  },
  medium: {
    label: '🟡 Medium',
    minSafeForBetBack: 5,
    bonusMultiplier: 2,
    mines: 10,
    lossMultiplier: 1.10,
  },
  hard: {
    label: '🔴 Hard',
    minSafeForBetBack: 3,
    bonusMultiplier: 3.5,
    mines: 15,
    lossMultiplier: 1.35,
  },
  hardcore: {
    label: '💀 HARDCORE',
    minSafeForBetBack: 1,
    bonusMultiplier: 150,
    mines: 22,
    lossMultiplier: 2,
  },
};

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function roundToThree(value) {
  return Math.round(value * 1000) / 1000;
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

function buildLetterName(index) {
  const alphabetIndex = index % ALPHABET.length;
  const cycle = Math.floor(index / ALPHABET.length);
  const letter = ALPHABET[alphabetIndex];
  return cycle === 0 ? letter : `${cycle}${letter}`;
}

function buildLetterRewards() {
  return Array.from({ length: LETTER_POOL_SIZE }, (_, index) => {
    const base = Math.floor(
      4
      + (index * 1.2)
      + (Math.pow(index, 1.38) * 0.35)
      + (Math.pow(1.08, index) * 2.5),
    );
    const spread = Math.max(3, Math.floor(base * REWARD_SPREAD_PERCENT));
    return {
      letter: buildLetterName(index),
      min: base,
      max: base + spread,
    };
  });
}

const LETTER_REWARDS = buildLetterRewards();

function getCurrentRebirthInfo(tier) {
  const safeTier = Math.max(0, Math.min(Math.floor(Number(tier) || 0), REBIRTHS.length - 1));
  return REBIRTHS[safeTier] || null;
}

function getLuckPercent(level) {
  if (level <= 0) {
    return 0;
  }

  return roundToOne(MAX_LUCK_PERCENT * (1 - Math.pow(1 - LUCK_GROWTH_RATE, level)));
}

function getEffectiveLuckPercent(level, rebirthTier = 0, fortunePercent = 0) {
  const baseLuck = getLuckPercent(level);
  const rebirthMultiplier = getRebirthLuckMultiplier(rebirthTier);
  const fortuneMultiplier = 1 + ((Math.max(0, fortunePercent) || 0) / 100);
  return roundToOne(baseLuck * rebirthMultiplier * fortuneMultiplier);
}

function getEffectiveChanceDecay(luckLevel, rebirthTier = 0, fortunePercent = 0) {
  const luckPercent = getEffectiveLuckPercent(luckLevel, rebirthTier, fortunePercent);
  const luckRatio = Math.min(1, luckPercent / MAX_LUCK_PERCENT);
  return BASE_CHANCE_DECAY + ((MAX_CHANCE_DECAY - BASE_CHANCE_DECAY) * luckRatio);
}

function buildChances(luckLevel, rebirthTier = 0, fortunePercent = 0) {
  const chanceDecay = getEffectiveChanceDecay(luckLevel, rebirthTier, fortunePercent);
  const raw = LETTER_REWARDS.map((_, index) => Math.pow(chanceDecay, index));
  const totalRaw = raw.reduce((sum, value) => sum + value, 0);
  return raw.map((value) => (value / totalRaw) * 100);
}

function getCritChancePercent(level) {
  return Math.min(MAX_CRIT_CHANCE_PERCENT, Math.max(0, level) * CRIT_CHANCE_PER_LEVEL);
}

function getCritChancePrice(level) {
  return Math.round(2_500 * (11 ** Math.max(0, level)));
}

function getCritPowerPercent(level) {
  const safeLevel = Math.max(0, Number(level) || 0);
  if (safeLevel <= 0) return BASE_CRIT_POWER_PERCENT;
  if (safeLevel === 1) return 250;
  if (safeLevel === 2) return 1000;
  if (safeLevel === 3) return 25_000;
  if (safeLevel === 4) return 125_000;
  return Math.round(125_000 * (2.5 ** (safeLevel - 4)));
}

function getCritPowerPrice(level) {
  const safeLevel = Math.max(0, Number(level) || 0);
  const fiveLevelGate = 25 ** Math.floor(safeLevel / 5);
  return Math.round(6_000 * (6 ** safeLevel) * fiveLevelGate);
}

function getLuckPrice(nextLevel, discountPercent = 0) {
  const safeLevel = Math.max(1, Number(nextLevel) || 1);
  const rawPrice = Math.round(225 * (1.42 ** (safeLevel - 1)) + (90 * (safeLevel ** 1.65)));
  const discount = Math.min(90, Math.max(0, discountPercent || 0));
  return Math.max(1, Math.round(rawPrice * (1 - (discount / 100))));
}

function getRebirthInfo(nextTier) {
  return REBIRTHS[nextTier] || null;
}

function getRebirthCoinMultiplier(tier) {
  return getCurrentRebirthInfo(tier)?.coinMultiplier || 1;
}

function getRebirthLuckMultiplier(tier) {
  return getCurrentRebirthInfo(tier)?.luckMultiplier || 1;
}

function getRebirthUpgradeLevelValue(rebirthUpgrades, key) {
  const config = REBIRTH_UPGRADES[key];
  if (!config) return null;
  const level = Math.max(0, Number(rebirthUpgrades?.[key]) || 0);
  if (level <= 0) return null;
  return config.values[Math.min(level, config.values.length) - 1];
}

function getGlyphGrowthMultiplier(rebirthUpgrades, uniqueDiscoveries) {
  const percentPerGlyph = getRebirthUpgradeLevelValue(rebirthUpgrades, 'glyphGrowth') || 0;
  return 1 + ((Math.max(0, uniqueDiscoveries) * percentPerGlyph) / 100);
}

function getRarityJackpotMultiplier(rebirthUpgrades, chancePercent) {
  const jackpot = getRebirthUpgradeLevelValue(rebirthUpgrades, 'rarityJackpot') || 1;
  return chancePercent < 0.1 ? jackpot : 1;
}

function getLuckDiscountPercent(rebirthUpgrades) {
  return getRebirthUpgradeLevelValue(rebirthUpgrades, 'luckDiscount') || 0;
}

function getFortuneChargePercent(rebirthUpgrades) {
  return getRebirthUpgradeLevelValue(rebirthUpgrades, 'fortuneCharge') || 0;
}

function isMinefieldUnlocked(rebirthUpgrades) {
  return (Number(rebirthUpgrades?.minefieldFortune) || 0) >= 1;
}

function formatChance(chancePercent) {
  if (chancePercent >= 1) {
    return `${roundToThree(chancePercent)}%`;
  }
  if (chancePercent >= 0.01) {
    return `${chancePercent.toFixed(4)}%`;
  }
  return `${chancePercent.toExponential(2)}%`;
}

function getRareRollAccent(chancePercent) {
  if (chancePercent < 0.005) {
    return CYAN_ACCENT;
  }
  if (chancePercent < 0.03) {
    return YELLOW_ACCENT;
  }
  if (chancePercent < 0.2) {
    return GREEN_ACCENT;
  }
  return null;
}

function calculateMinefieldPayout(bet, difficultyConfig, safeFound) {
  const safe = Math.max(0, Number(safeFound) || 0);
  if (safe <= 0) return 0;

  const minSafe = difficultyConfig.minSafeForBetBack;
  if (safe < minSafe) {
    return Math.floor((bet / minSafe) * safe);
  }

  return Math.floor(bet * (difficultyConfig.bonusMultiplier ** (safe - minSafe)));
}

module.exports = {
  PRCOIN,
  RBCOIN,
  Y_MARK,
  N_MARK,
  PRCOIN_EMOJI,
  RBCOIN_EMOJI,
  WHITE_ACCENT,
  RED_ACCENT,
  GREEN_ACCENT,
  YELLOW_ACCENT,
  CYAN_ACCENT,
  LIGHT_PURPLE_ACCENT,
  MAX_LUCK_LEVEL,
  MAX_CRIT_CHANCE_LEVEL,
  MAX_CRIT_CHANCE_PERCENT,
  LETTER_REWARDS,
  REBIRTHS,
  REBIRTH_UPGRADES,
  REBIRTH_UPGRADE_ORDER,
  MINEFIELD_DIFFICULTIES,
  formatNumber,
  formatAbbreviated,
  getLuckPercent,
  getEffectiveLuckPercent,
  buildChances,
  getCritChancePercent,
  getCritChancePrice,
  getCritPowerPercent,
  getCritPowerPrice,
  getLuckPrice,
  getRebirthInfo,
  getRebirthCoinMultiplier,
  getRebirthLuckMultiplier,
  getRebirthUpgradeLevelValue,
  getGlyphGrowthMultiplier,
  getRarityJackpotMultiplier,
  getLuckDiscountPercent,
  getFortuneChargePercent,
  isMinefieldUnlocked,
  formatChance,
  getRareRollAccent,
  calculateMinefieldPayout,
};
