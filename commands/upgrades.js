const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, spendBalance, getUpgrades, setUpgrades } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const RED_ACCENT = 0xED4245;
const PRCOIN_EMOJI = { id: '1497972406030176356', name: 'PRcoin' };

const CUSTOM_IDS = {
  luck: 'upgrades:luck',
  critChance: 'upgrades:critchance',
  critPower: 'upgrades:critpower',
  exp: 'upgrades:exp',
};

function roundToOne(value) {
  return Math.round(value * 10) / 10;
}

function formatNumber(value) {
  return Number(Math.floor(value)).toLocaleString('en-US');
}

function getLuckPercent(level) {
  if (level <= 0) {
    return 0;
  }

  return roundToOne(10 * (level ** 1.1));
}

function getLuckPrice(nextLevel) {
  return Math.round(25 * (nextLevel ** 2));
}

function getCritChancePercent(level) {
  return Math.min(50, level * 10);
}

function getCritChancePrice(level) {
  return 1000000 + (450000 * level);
}

function getCritPowerPercent(level) {
  return level * 5;
}

function getCritPowerPrice(level) {
  return 1000 + (67 * level);
}

function getExpPercent(level) {
  return Math.min(100, level);
}

function getExpPrice(level) {
  return 1000 + (1000 * level);
}

function getButtonStyle(balance, price) {
  return balance >= price ? 3 : 4;
}

function getUpgradeSnapshot(userId) {
  const upgrades = getUpgrades(userId);
  const balance = getBalance(userId);

  const luckNextLevel = upgrades.luckLevel + 1;
  const luckPrice = getLuckPrice(luckNextLevel);

  const critChanceCanUpgrade = upgrades.critChanceLevel < 5;
  const critChancePrice = getCritChancePrice(upgrades.critChanceLevel);

  const critPowerPrice = getCritPowerPrice(upgrades.critPowerLevel);

  const expCanUpgrade = upgrades.expLevel < 100;
  const expPrice = getExpPrice(upgrades.expLevel);

  return {
    upgrades,
    balance,
    prices: {
      luck: luckPrice,
      critChance: critChancePrice,
      critPower: critPowerPrice,
      exp: expPrice,
    },
    limits: {
      critChanceCanUpgrade,
      expCanUpgrade,
    },
  };
}

function buildPayload(user, snapshot) {
  const { upgrades, balance, prices, limits } = snapshot;
  const luckPercent = getLuckPercent(upgrades.luckLevel);
  const critChancePercent = getCritChancePercent(upgrades.critChanceLevel);
  const critPowerPercent = getCritPowerPercent(upgrades.critPowerLevel);
  const expPercent = getExpPercent(upgrades.expLevel);
  const canAffordLuck = balance >= prices.luck;
  const canAffordCritChance = balance >= prices.critChance;
  const canAffordCritPower = balance >= prices.critPower;
  const canAffordExp = balance >= prices.exp;

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: RED_ACCENT,
        components: [
          {
            type: 10,
            content: `## ${user.username}'s Upgrades`,
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: `### Luck Upgrade: +${luckPercent}%`,
              },
            ],
            accessory: {
              type: 2,
              custom_id: CUSTOM_IDS.luck,
              label: `${formatNumber(prices.luck)}`,
              emoji: PRCOIN_EMOJI,
              style: getButtonStyle(balance, prices.luck),
              disabled: !canAffordLuck,
            },
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: `### Crit Chance: +${critChancePercent}%`,
              },
            ],
            accessory: {
              type: 2,
              custom_id: CUSTOM_IDS.critChance,
              label: limits.critChanceCanUpgrade ? `${formatNumber(prices.critChance)}` : 'MAX',
              ...(limits.critChanceCanUpgrade ? { emoji: PRCOIN_EMOJI } : {}),
              style: limits.critChanceCanUpgrade ? getButtonStyle(balance, prices.critChance) : 2,
              disabled: !limits.critChanceCanUpgrade || !canAffordCritChance,
            },
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: `### Crit Power: +${critPowerPercent}%`,
              },
            ],
            accessory: {
              type: 2,
              custom_id: CUSTOM_IDS.critPower,
              label: `${formatNumber(prices.critPower)}`,
              emoji: PRCOIN_EMOJI,
              style: getButtonStyle(balance, prices.critPower),
              disabled: !canAffordCritPower,
            },
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: `### Exp Upgrade: +${expPercent}%`,
              },
            ],
            accessory: {
              type: 2,
              custom_id: CUSTOM_IDS.exp,
              label: limits.expCanUpgrade ? `${formatNumber(prices.exp)}` : 'MAX',
              ...(limits.expCanUpgrade ? { emoji: PRCOIN_EMOJI } : {}),
              style: limits.expCanUpgrade ? getButtonStyle(balance, prices.exp) : 2,
              disabled: !limits.expCanUpgrade || !canAffordExp,
            },
          },
        ],
      },
    ],
  };
}

function applyUpgrade(userId, kind) {
  const upgrades = getUpgrades(userId);

  if (kind === 'luck') {
    const price = getLuckPrice(upgrades.luckLevel + 1);
    if (!spendBalance(userId, price)) return false;
    upgrades.luckLevel += 1;
    setUpgrades(userId, upgrades);
    return true;
  }

  if (kind === 'critChance') {
    if (upgrades.critChanceLevel >= 5) return false;
    const price = getCritChancePrice(upgrades.critChanceLevel);
    if (!spendBalance(userId, price)) return false;
    upgrades.critChanceLevel += 1;
    setUpgrades(userId, upgrades);
    return true;
  }

  if (kind === 'critPower') {
    const price = getCritPowerPrice(upgrades.critPowerLevel);
    if (!spendBalance(userId, price)) return false;
    upgrades.critPowerLevel += 1;
    setUpgrades(userId, upgrades);
    return true;
  }

  if (kind === 'exp') {
    if (upgrades.expLevel >= 100) return false;
    const price = getExpPrice(upgrades.expLevel);
    if (!spendBalance(userId, price)) return false;
    upgrades.expLevel += 1;
    setUpgrades(userId, upgrades);
    return true;
  }

  return false;
}

async function render(target, user) {
  const snapshot = getUpgradeSnapshot(user.id);
  const payload = buildPayload(user, snapshot);

  if (typeof target.update === 'function') {
    await target.update(payload);
    return;
  }

  if (typeof target.editReply === 'function' && (target.replied || target.deferred)) {
    await target.editReply(payload);
    return;
  }

  if (typeof target.reply === 'function') {
    await target.reply(payload);
    return;
  }
}

module.exports = {
  data: new SlashCommandBuilder().setName('upgrades').setDescription('View and buy roll upgrades'),

  async execute(interaction) {
    await render(interaction, interaction.user);
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton()) {
      return false;
    }

    const map = {
      [CUSTOM_IDS.luck]: 'luck',
      [CUSTOM_IDS.critChance]: 'critChance',
      [CUSTOM_IDS.critPower]: 'critPower',
      [CUSTOM_IDS.exp]: 'exp',
    };

    const upgradeKind = map[interaction.customId];
    if (!upgradeKind) {
      return false;
    }

    applyUpgrade(interaction.user.id, upgradeKind);
    await render(interaction, interaction.user);
    return true;
  },
};
