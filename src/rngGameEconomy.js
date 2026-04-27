const PRCOIN = '<:PRcoin:1497972406030176356>';
const RBCOIN = '<:Rbcoin:1498172292511825950>';
const YES_MARK = '<:Y_:1498173245981986869>';
const NO_MARK = '<:N_:1498173244031631400>';
const LIGHT_PURPLE_ACCENT = 0xC084FC;
const SUFFIXES = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No'];
const REBIRTH_TIERS = [
  { tier: 1, cost: 25000, requiredLetter: 'Z', coinMultiplier: 2, luckMultiplier: 1.05, unlocks: ['Rebirth Upgrades'] },
  { tier: 2, cost: 475000, requiredLetter: '1Z', coinMultiplier: 4, luckMultiplier: 1.1, unlocks: [] },
  { tier: 3, cost: 2000000, requiredLetter: '3H', coinMultiplier: 8, luckMultiplier: 1.15, unlocks: [] },
  { tier: 4, cost: 125000000, requiredLetter: '5Z', coinMultiplier: 16, luckMultiplier: 1.2, unlocks: [] },
  { tier: 5, cost: 1000000000, requiredLetter: '7Z', coinMultiplier: 32, luckMultiplier: 1.25, unlocks: ['Challenges'] },
];
const REBIRTH_UPGRADE_DEFS = [
  { key: 'glyphGrowthLevel', title: '✨ Glyph Growth', description: 'Every unique alphabet discovered increases coin gain.', perks: [0.1, 0.25, 0.5, 1], prices: [1, 1, 2, 4], formatPerk: (value) => `+${value}% per unique alphabet` },
  { key: 'rarityJackpotLevel', title: '💎 Rarity Jackpot', description: 'Rolls below 0.1% chance earn jackpot coins.', perks: [5, 10, 25, 50], prices: [1, 1, 2, 4], formatPerk: (value) => `${value}x coins below 0.1% chance` },
  { key: 'luckDiscountLevel', title: '💸 Luck Discount', description: 'Reduces Luck upgrade prices.', perks: [5, 10], prices: [1, 2], formatPerk: (value) => `-${value}% Luck cost` },
  { key: 'fortuneChargeLevel', title: '⚡ Fortune Charge', description: 'Every 25th roll charges a one-time Luck boost for the next roll.', perks: [100, 200, 300], prices: [1, 2, 3], formatPerk: (value) => `+${value}% Luck on charged rolls` },
  { key: 'minefieldFortuneLevel', title: '💣 Minefield Fortune', description: 'Unlocks the Mines gambling game.', perks: ['unlock'], prices: [1], formatPerk: () => 'Unlock /minefield' },
];
function formatNumber(value) { return Number(Math.floor(value || 0)).toLocaleString('en-US'); }
function formatAbbreviated(amount) {
  if (!Number.isFinite(amount) || amount <= 0) return '0';
  let tier = 0; let scaled = Math.min(amount, 999 * (10 ** ((SUFFIXES.length - 1) * 3)));
  while (scaled >= 1000 && tier < SUFFIXES.length - 1) { scaled /= 1000; tier += 1; }
  const decimals = scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return `${Number(scaled.toFixed(decimals)).toString()}${SUFFIXES[tier]}`;
}
function getCurrentRebirthTierInfo(rebirthTier) {
  if (rebirthTier <= 0) return { tier: 0, coinMultiplier: 1, luckMultiplier: 1, unlocks: [] };
  return REBIRTH_TIERS[Math.min(rebirthTier, REBIRTH_TIERS.length) - 1] || REBIRTH_TIERS[REBIRTH_TIERS.length - 1];
}
function getNextRebirthTierInfo(rebirthTier) { return REBIRTH_TIERS.find((tier) => tier.tier === rebirthTier + 1) || null; }
function getRebirthCoinMultiplier(rebirthTier) { return getCurrentRebirthTierInfo(rebirthTier).coinMultiplier; }
function getRebirthLuckMultiplier(rebirthTier) { return getCurrentRebirthTierInfo(rebirthTier).luckMultiplier; }
function getRebirthUpgradeDef(key) { return REBIRTH_UPGRADE_DEFS.find((def) => def.key === key) || null; }
function getRebirthUpgradeLevel(upgrades, key) { const def = getRebirthUpgradeDef(key); if (!def) return 0; return Math.min(def.perks.length, Math.max(0, Math.floor(Number(upgrades?.[key]) || 0))); }
function getCurrentRebirthUpgradePerk(upgrades, key) { const def = getRebirthUpgradeDef(key); const level = getRebirthUpgradeLevel(upgrades, key); if (!def || level <= 0) return null; return def.perks[level - 1]; }
function getNextRebirthUpgradePrice(upgrades, key) { const def = getRebirthUpgradeDef(key); const level = getRebirthUpgradeLevel(upgrades, key); if (!def || level >= def.prices.length) return null; return def.prices[level]; }
function getGlyphGrowthPercent(upgrades) { return Number(getCurrentRebirthUpgradePerk(upgrades, 'glyphGrowthLevel') || 0); }
function getRarityJackpotMultiplier(upgrades) { return Number(getCurrentRebirthUpgradePerk(upgrades, 'rarityJackpotLevel') || 1); }
function getLuckDiscountPercent(upgrades) { return Number(getCurrentRebirthUpgradePerk(upgrades, 'luckDiscountLevel') || 0); }
function getFortuneChargeLuckPercent(upgrades) { return Number(getCurrentRebirthUpgradePerk(upgrades, 'fortuneChargeLevel') || 0); }
function hasMinefieldUnlocked(upgrades) { return getRebirthUpgradeLevel(upgrades, 'minefieldFortuneLevel') > 0; }
module.exports = { PRCOIN, RBCOIN, YES_MARK, NO_MARK, LIGHT_PURPLE_ACCENT, REBIRTH_TIERS, REBIRTH_UPGRADE_DEFS, formatNumber, formatAbbreviated, getCurrentRebirthTierInfo, getNextRebirthTierInfo, getRebirthCoinMultiplier, getRebirthLuckMultiplier, getRebirthUpgradeDef, getRebirthUpgradeLevel, getCurrentRebirthUpgradePerk, getNextRebirthUpgradePrice, getGlyphGrowthPercent, getRarityJackpotMultiplier, getLuckDiscountPercent, getFortuneChargeLuckPercent, hasMinefieldUnlocked };
