const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  getBalance,
  spendBalance,
  getRebirthCoins,
  spendRebirthCoins,
  getRebirthTier,
  getUpgrades,
  setUpgrades,
  getRebirthUpgrades,
  setRebirthUpgrades,
} = require('../src/rngGameStore');
const {
  PRCOIN,
  RBCOIN,
  LIGHT_PURPLE_ACCENT,
  REBIRTH_UPGRADE_DEFS,
  formatNumber,
  getNextRebirthUpgradePrice,
  getRebirthUpgradeLevel,
  getLuckDiscountPercent,
} = require('../src/rngGameEconomy');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const RED_ACCENT = 0xED4245;
const PRCOIN_EMOJI = { id: '1497972406030176356', name: 'PRcoin' };
const RBCOIN_EMOJI = { id: '1498172292511825950', name: 'Rbcoin' };
const MAX_LUCK_PERCENT = 75;
const LUCK_GROWTH_RATE = 0.145;
const MAX_LUCK_LEVEL = 60;
const MAX_CRIT_CHANCE_LEVEL = 5;
const MAX_EXP_LEVEL = 60;
const MAX_EXP_PERCENT = 60;
const BASE_CRIT_POWER_PERCENT = 25;
const CRIT_POWER_PER_LEVEL = 5;
const CUSTOM_IDS = { luck: 'upgrades:luck', critChance: 'upgrades:critchance', critPower: 'upgrades:critpower', exp: 'upgrades:exp', switch: 'upgrades:switch', rb: 'upgrades:rb' };
function owned(id, userId) { return `${id}:${userId}`; }
function roundToOne(value) { return Math.round(value * 10) / 10; }
function priceLabel(value) { const text = formatNumber(value); return text.length > 80 ? Number(value).toExponential(2) : text; }
function getLuckPercent(level) { return level <= 0 ? 0 : roundToOne(MAX_LUCK_PERCENT * (1 - Math.pow(1 - LUCK_GROWTH_RATE, level))); }
function getLuckPrice(nextLevel, rbUpgrades = {}) { return Math.max(1, Math.round((500 + (350 * (nextLevel ** 1.7)) + (150 * nextLevel)) * (1 - (getLuckDiscountPercent(rbUpgrades) / 100)))); }
function getCritChancePercent(level) { return Math.min(25, level * 5); }
function getCritChancePrice(level) { return [1000, 10000, 110000, 1210000, 1513710000][level] ?? Math.round(1513710000 * (1251 ** Math.max(1, level - 4))); }
function getCritPowerPercent(level) { return BASE_CRIT_POWER_PERCENT + (level * CRIT_POWER_PER_LEVEL); }
function getCritPowerPrice(level) { return Math.round(750 * (1.45 ** level) * (25 ** Math.floor(level / 5))); }
function getExpPercent(level) { return Math.min(MAX_EXP_PERCENT, level); }
function getExpPrice(level) { return Math.round(1000 * (10 ** level)); }
function buttonStyle(balance, price) { return balance >= price ? 3 : 4; }
function getSnapshot(userId) {
  const upgrades = getUpgrades(userId);
  const rbUpgrades = getRebirthUpgrades(userId);
  const balance = getBalance(userId);
  const rbCoins = getRebirthCoins(userId);
  const rebirthTier = getRebirthTier(userId);
  return { upgrades, rbUpgrades, balance, rbCoins, rebirthTier };
}
function switchRow(userId, mode) {
  return { type: 1, components: [{ type: 3, custom_id: owned(CUSTOM_IDS.switch, userId), placeholder: 'Switch upgrade', options: [
    { label: 'Coin Upgrades', value: 'coin', default: mode === 'coin' },
    { label: 'Rebirth Upgrades', value: 'rebirth', default: mode === 'rebirth' },
  ] }] };
}
function coinPayload(user, s) {
  const u = s.upgrades;
  const luckPrice = getLuckPrice(u.luckLevel + 1, s.rbUpgrades);
  const critChancePrice = getCritChancePrice(u.critChanceLevel);
  const critPowerPrice = getCritPowerPrice(u.critPowerLevel);
  const expPrice = getExpPrice(u.expLevel);
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: RED_ACCENT, components: [
    { type: 10, content: [`## ${user.username}'s Upgrades`, `-# Balance: **${formatNumber(s.balance)}** ${PRCOIN}`, getLuckDiscountPercent(s.rbUpgrades) > 0 ? `-# Luck Discount: -${getLuckDiscountPercent(s.rbUpgrades)}%` : null].filter(Boolean).join('\n') },
    { type: 9, components: [{ type: 10, content: [`### Luck: +${getLuckPercent(u.luckLevel)}% higher-tier chance`, u.luckLevel < MAX_LUCK_LEVEL ? `-# Next: +${getLuckPercent(u.luckLevel + 1)}%` : '-# MAX'].join('\n') }], accessory: { type: 2, custom_id: owned(CUSTOM_IDS.luck, user.id), label: u.luckLevel < MAX_LUCK_LEVEL ? priceLabel(luckPrice) : 'MAX', ...(u.luckLevel < MAX_LUCK_LEVEL ? { emoji: PRCOIN_EMOJI } : {}), style: u.luckLevel < MAX_LUCK_LEVEL ? buttonStyle(s.balance, luckPrice) : 2, disabled: u.luckLevel >= MAX_LUCK_LEVEL || s.balance < luckPrice } },
    { type: 9, components: [{ type: 10, content: [`### Crit Chance: +${getCritChancePercent(u.critChanceLevel)}%`, u.critChanceLevel < MAX_CRIT_CHANCE_LEVEL ? `-# Next: +${getCritChancePercent(u.critChanceLevel + 1)}%` : '-# MAX', '-# Price jumps 1000% after upgrade 2 and 125000% after upgrade 4.'].join('\n') }], accessory: { type: 2, custom_id: owned(CUSTOM_IDS.critChance, user.id), label: u.critChanceLevel < MAX_CRIT_CHANCE_LEVEL ? priceLabel(critChancePrice) : 'MAX', ...(u.critChanceLevel < MAX_CRIT_CHANCE_LEVEL ? { emoji: PRCOIN_EMOJI } : {}), style: u.critChanceLevel < MAX_CRIT_CHANCE_LEVEL ? buttonStyle(s.balance, critChancePrice) : 2, disabled: u.critChanceLevel >= MAX_CRIT_CHANCE_LEVEL || s.balance < critChancePrice } },
    { type: 9, components: [{ type: 10, content: [`### Crit Power: +${getCritPowerPercent(u.critPowerLevel)}% reward`, `-# Next: +${getCritPowerPercent(u.critPowerLevel + 1)}%`, '-# Every 5 upgrades, price gets 25x harder.'].join('\n') }], accessory: { type: 2, custom_id: owned(CUSTOM_IDS.critPower, user.id), label: priceLabel(critPowerPrice), emoji: PRCOIN_EMOJI, style: buttonStyle(s.balance, critPowerPrice), disabled: s.balance < critPowerPrice } },
    { type: 9, components: [{ type: 10, content: [`### Exp Upgrade: +${getExpPercent(u.expLevel)}%`, u.expLevel < MAX_EXP_LEVEL ? `-# Next: +${getExpPercent(u.expLevel + 1)}%` : '-# MAX', '-# Price increases 10x every upgrade.'].join('\n') }], accessory: { type: 2, custom_id: owned(CUSTOM_IDS.exp, user.id), label: u.expLevel < MAX_EXP_LEVEL ? priceLabel(expPrice) : 'MAX', ...(u.expLevel < MAX_EXP_LEVEL ? { emoji: PRCOIN_EMOJI } : {}), style: u.expLevel < MAX_EXP_LEVEL ? buttonStyle(s.balance, expPrice) : 2, disabled: u.expLevel >= MAX_EXP_LEVEL || s.balance < expPrice } },
  ] }, switchRow(user.id, 'coin')] };
}
function rbRow(user, s, def) {
  const level = getRebirthUpgradeLevel(s.rbUpgrades, def.key);
  const current = level > 0 ? def.formatPerk(def.perks[level - 1]) : 'Not owned';
  const next = level < def.perks.length ? def.formatPerk(def.perks[level]) : null;
  const price = getNextRebirthUpgradePrice(s.rbUpgrades, def.key);
  const canBuy = s.rebirthTier > 0 && price !== null && s.rbCoins >= price;
  return { type: 9, components: [{ type: 10, content: [`### ${def.title}`, `-# ${def.description}`, `-# Current: ${current}`, next ? `-# Next: ${next}` : '-# MAX'].join('\n') }], accessory: { type: 2, custom_id: `${CUSTOM_IDS.rb}:${def.key}:${user.id}`, label: price === null ? 'MAX' : `${price}`, ...(price === null ? {} : { emoji: RBCOIN_EMOJI }), style: price === null ? 2 : (canBuy ? 3 : 4), disabled: !canBuy } };
}
function rbPayload(user, s) {
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: LIGHT_PURPLE_ACCENT, components: [
    { type: 10, content: [`## ${user.username}'s Rebirth Upgrades`, `-# Rebirth Coins: **${formatNumber(s.rbCoins)}** ${RBCOIN}`, s.rebirthTier > 0 ? null : '-# Locked: use `/rebirth` once to unlock these upgrades.', '-# Page 1 / 1'].filter(Boolean).join('\n') },
    ...REBIRTH_UPGRADE_DEFS.map((def) => rbRow(user, s, def)),
    { type: 9, components: [{ type: 10, content: '-# Page switch is disabled while there is only 1 page.' }], accessory: { type: 2, custom_id: `upgrades:page:${user.id}`, label: 'Switch page', style: 2, disabled: true } },
  ] }, switchRow(user.id, 'rebirth')] };
}
function buildPayload(user, mode = 'coin') { const s = getSnapshot(user.id); return mode === 'rebirth' ? rbPayload(user, s) : coinPayload(user, s); }
function applyCoinUpgrade(userId, kind) {
  const u = getUpgrades(userId);
  const rb = getRebirthUpgrades(userId);
  if (kind === 'luck') { if (u.luckLevel >= MAX_LUCK_LEVEL) return false; const p = getLuckPrice(u.luckLevel + 1, rb); if (!spendBalance(userId, p)) return false; u.luckLevel += 1; }
  else if (kind === 'critChance') { if (u.critChanceLevel >= MAX_CRIT_CHANCE_LEVEL) return false; const p = getCritChancePrice(u.critChanceLevel); if (!spendBalance(userId, p)) return false; u.critChanceLevel += 1; }
  else if (kind === 'critPower') { const p = getCritPowerPrice(u.critPowerLevel); if (!spendBalance(userId, p)) return false; u.critPowerLevel += 1; }
  else if (kind === 'exp') { if (u.expLevel >= MAX_EXP_LEVEL) return false; const p = getExpPrice(u.expLevel); if (!spendBalance(userId, p)) return false; u.expLevel += 1; }
  else return false;
  setUpgrades(userId, u); return true;
}
function applyRbUpgrade(userId, key) {
  if (getRebirthTier(userId) <= 0) return false;
  const def = REBIRTH_UPGRADE_DEFS.find((x) => x.key === key); if (!def) return false;
  const u = getRebirthUpgrades(userId); const level = getRebirthUpgradeLevel(u, key); if (level >= def.prices.length) return false;
  if (!spendRebirthCoins(userId, def.prices[level])) return false;
  u[key] = level + 1; setRebirthUpgrades(userId, u); return true;
}
async function render(target, user, mode = 'coin') {
  const payload = buildPayload(user, mode);
  if (typeof target.update === 'function') return target.update(payload);
  if (typeof target.reply === 'function') return target.reply(payload);
  return null;
}
module.exports = {
  data: new SlashCommandBuilder().setName('upgrades').setDescription('View and buy roll upgrades'),
  suppressCommandLog: true,
  async execute(interaction) { await render(interaction, interaction.user, 'coin'); },
  shouldLogInteraction(interaction) { return !(interaction?.customId && interaction.customId.startsWith('upgrades:')); },
  async handleInteraction(interaction) {
    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith(`${CUSTOM_IDS.switch}:`)) {
      const ownerId = interaction.customId.split(':').slice(2).join(':');
      if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own upgrades menu.', flags: MessageFlags.Ephemeral }); return true; }
      await render(interaction, interaction.user, interaction.values?.[0] === 'rebirth' ? 'rebirth' : 'coin'); return true;
    }
    if (!interaction.isButton?.() || !interaction.customId.startsWith('upgrades:')) return false;
    const parts = interaction.customId.split(':');
    if (parts[1] === 'rb') { if (parts[3] !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own upgrades menu.', flags: MessageFlags.Ephemeral }); return true; } applyRbUpgrade(interaction.user.id, parts[2]); await render(interaction, interaction.user, 'rebirth'); return true; }
    const ownerId = parts.slice(2).join(':');
    if (ownerId !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own upgrades menu.', flags: MessageFlags.Ephemeral }); return true; }
    const map = { luck: 'luck', critchance: 'critChance', critpower: 'critPower', exp: 'exp' };
    const kind = map[parts[1]]; if (!kind) return false;
    applyCoinUpgrade(interaction.user.id, kind); await render(interaction, interaction.user, 'coin'); return true;
  },
};
