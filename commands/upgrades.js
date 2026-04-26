const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { getBalance, spendBalance, getUpgrades, setUpgrades } = require('../src/rngGameStore');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const RED_ACCENT = 0xED4245;
const PRCOIN = '<:PRcoin:1497972406030176356>';
const PRCOIN_EMOJI = { id: '1497972406030176356', name: 'PRcoin' };

const MAX_LUCK_PERCENT = 75;
const LUCK_GROWTH_RATE = 0.145;
const BASE_CRIT_POWER_PERCENT = 25;
const CRIT_CHANCE_PER_LEVEL = 5;
const CRIT_POWER_PER_LEVEL = 5;
const MAX_CRIT_CHANCE_LEVEL = 5;
const MAX_LUCK_LEVEL = 60;
const MAX_EXP_LEVEL = 60;
const MAX_EXP_PERCENT = 60;

const CUSTOM_IDS = {
  luck: 'upgrades:luck',
  critChance: 'upgrades:critchance',
  critPower: 'upgrades:critpower',
  exp: 'upgrades:exp',
};

function toOwnedCustomId(baseId, ownerId) {
  return `${baseId}:${ownerId}`;
}

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

  return roundToOne(MAX_LUCK_PERCENT * (1 - Math.pow(1 - LUCK_GROWTH_RATE, level)));
}

function getLuckPrice(nextLevel) {
  return Math.round((25 * (nextLevel ** 1.55)) + (8 * nextLevel));
}

function getCritChancePercent(level) {
  return Math.min(MAX_CRIT_CHANCE_LEVEL * CRIT_CHANCE_PER_LEVEL, level * CRIT_CHANCE_PER_LEVEL);
}

function getCritChancePrice(level) {
  return Math.round(650 * (2 ** level));
}

function getCritPowerPercent(level) {
  return BASE_CRIT_POWER_PERCENT + (level * CRIT_POWER_PER_LEVEL);
}

function getCritPowerPrice(level) {
  return Math.round((450 * (1.28 ** level)) + (75 * (level ** 1.35)));
}

function getExpPercent(level) {
  return Math.min(MAX_EXP_PERCENT, level);
}

function getExpPrice(level) {
  return Math.round((450 * (1.18 ** level)) + (60 * (level ** 1.45)));
}

function getButtonStyle(balance, price) {
  return balance >= price ? 3 : 4;
}

function getUpgradeSnapshot(userId) {
  const upgrades = getUpgrades(userId);
  const balance = getBalance(userId);

  const luckCanUpgrade = upgrades.luckLevel < MAX_LUCK_LEVEL;
  const luckNextLevel = upgrades.luckLevel + 1;
  const luckPrice = getLuckPrice(luckNextLevel);

  const critChanceCanUpgrade = upgrades.critChanceLevel < MAX_CRIT_CHANCE_LEVEL;
  const critChancePrice = getCritChancePrice(upgrades.critChanceLevel);

  const critPowerPrice = getCritPowerPrice(upgrades.critPowerLevel);

  const expCanUpgrade = upgrades.expLevel < MAX_EXP_LEVEL;
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
      luckCanUpgrade,
      critChanceCanUpgrade,
      expCanUpgrade,
    },
  };
}

function buildPayload(user, snapshot) {
  const { upgrades, balance, prices, limits } = snapshot;
  const luckPercent = getLuckPercent(upgrades.luckLevel);
  const nextLuckPercent = getLuckPercent(upgrades.luckLevel + 1);
  const critChancePercent = getCritChancePercent(upgrades.critChanceLevel);
  const nextCritChancePercent = getCritChancePercent(upgrades.critChanceLevel + 1);
  const critPowerPercent = getCritPowerPercent(upgrades.critPowerLevel);
  const nextCritPowerPercent = getCritPowerPercent(upgrades.critPowerLevel + 1);
  const expPercent = getExpPercent(upgrades.expLevel);
  const nextExpPercent = getExpPercent(upgrades.expLevel + 1);
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
            content: [
              `## ${user.username}'s Upgrades`,
              `-# Balance: **${formatNumber(balance)}** ${PRCOIN}`,
            ].join('\n'),
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: [
                  `### Luck: +${luckPercent}% higher-tier chance`,
                  limits.luckCanUpgrade ? `-# Next: +${nextLuckPercent}%` : '-# MAX',
                ].join('\n'),
              },
            ],
            accessory: {
              type: 2,
              custom_id: toOwnedCustomId(CUSTOM_IDS.luck, user.id),
              label: limits.luckCanUpgrade ? `${formatNumber(prices.luck)}` : 'MAX',
              ...(limits.luckCanUpgrade ? { emoji: PRCOIN_EMOJI } : {}),
              style: limits.luckCanUpgrade ? getButtonStyle(balance, prices.luck) : 2,
              disabled: !limits.luckCanUpgrade || !canAffordLuck,
            },
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: [
                  `### Crit Chance: +${critChancePercent}%`,
                  limits.critChanceCanUpgrade ? `-# Next: +${nextCritChancePercent}%` : '-# MAX',
                ].join('\n'),
              },
            ],
            accessory: {
              type: 2,
              custom_id: toOwnedCustomId(CUSTOM_IDS.critChance, user.id),
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
                content: [
                  `### Crit Power: +${critPowerPercent}% reward`,
                  `-# Next: +${nextCritPowerPercent}%`,
                ].join('\n'),
              },
            ],
            accessory: {
              type: 2,
              custom_id: toOwnedCustomId(CUSTOM_IDS.critPower, user.id),
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
                content: [
                  `### Exp Upgrade: +${expPercent}%`,
                  limits.expCanUpgrade ? `-# Next: +${nextExpPercent}%` : '-# MAX',
                ].join('\n'),
              },
            ],
            accessory: {
              type: 2,
              custom_id: toOwnedCustomId(CUSTOM_IDS.exp, user.id),
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
    if (upgrades.luckLevel >= MAX_LUCK_LEVEL) return false;
    const price = getLuckPrice(upgrades.luckLevel + 1);
    if (!spendBalance(userId, price)) return false;
    upgrades.luckLevel += 1;
    setUpgrades(userId, upgrades);
    return true;
  }

  if (kind === 'critChance') {
    if (upgrades.critChanceLevel >= MAX_CRIT_CHANCE_LEVEL) return false;
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
    if (upgrades.expLevel >= MAX_EXP_LEVEL) return false;
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
  suppressCommandLog: true,

  async execute(interaction) {
    await render(interaction, interaction.user);
  },

  shouldLogInteraction(interaction) {
    return !(
      interaction?.isButton?.()
      && typeof interaction.customId === 'string'
      && interaction.customId.startsWith('upgrades:')
    );
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton() || !interaction.customId.startsWith('upgrades:')) {
      return false;
    }

    const customIdParts = interaction.customId.split(':');
    const baseCustomId = customIdParts.length >= 2
      ? `${customIdParts[0]}:${customIdParts[1]}`
      : interaction.customId;

    const map = {
      [CUSTOM_IDS.luck]: 'luck',
      [CUSTOM_IDS.critChance]: 'critChance',
      [CUSTOM_IDS.critPower]: 'critPower',
      [CUSTOM_IDS.exp]: 'exp',
    };

    const upgradeKind = map[baseCustomId];
    if (!upgradeKind) {
      return false;
    }

    const ownerId = customIdParts.length >= 3 ? customIdParts.slice(2).join(':') : null;
    if (!ownerId) {
      return false;
    }

    if (ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'You can only use buttons from your own upgrades command.', flags: MessageFlags.Ephemeral });
      return true;
    }

    applyUpgrade(interaction.user.id, upgradeKind);
    await render(interaction, interaction.user);
    return true;
  },
};
