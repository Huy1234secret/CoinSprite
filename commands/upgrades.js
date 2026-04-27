const {
  SlashCommandBuilder,
  MessageFlags,
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  getBalance,
  spendBalance,
  getUpgrades,
  setUpgrades,
  getRebirthBalance,
  spendRebirthBalance,
  getRebirthTier,
  getRebirthUpgrades,
  setRebirthUpgrades,
  getDiscoveredLetters,
} = require('../src/rngGameStore');
const {
  PRCOIN,
  RBCOIN,
  PRCOIN_EMOJI,
  RBCOIN_EMOJI,
  RED_ACCENT,
  LIGHT_PURPLE_ACCENT,
  MAX_LUCK_LEVEL,
  MAX_CRIT_CHANCE_LEVEL,
  REBIRTH_UPGRADES,
  REBIRTH_UPGRADE_ORDER,
  formatNumber,
  getLuckPercent,
  getLuckPrice,
  getCritChancePercent,
  getCritChancePrice,
  getCritPowerPercent,
  getCritPowerPrice,
  getLuckDiscountPercent,
  getGlyphGrowthMultiplier,
} = require('../src/rngConfig');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const PAGE_SIZE = 5;

const CUSTOM_IDS = {
  luck: 'upgrades:coin:luck',
  critChance: 'upgrades:coin:critchance',
  critPower: 'upgrades:coin:critpower',
  switch: 'upgrades:switch',
  page: 'upgrades:page',
  pageModal: 'upgrades:page-modal',
  rebirthPrefix: 'upgrades:rebirth',
};

function toOwnedCustomId(baseId, ownerId, extra = []) {
  return [baseId, ownerId, ...extra].join(':');
}

function getButtonStyle(balance, price) {
  return balance >= price ? 3 : 4;
}

function buildSwitchSelect(userId, mode) {
  return {
    type: 1,
    components: [
      {
        type: 3,
        custom_id: `${CUSTOM_IDS.switch}:${userId}`,
        placeholder: 'Switch upgrade',
        options: [
          {
            label: 'Coin Upgrades',
            value: 'coin',
            default: mode === 'coin',
            emoji: { name: '🪙' },
          },
          {
            label: 'Rebirth Upgrades',
            value: 'rebirth',
            default: mode === 'rebirth',
            emoji: { name: '♻️' },
          },
        ],
      },
    ],
  };
}

function getCoinUpgradeSnapshot(userId) {
  const upgrades = getUpgrades(userId);
  const balance = getBalance(userId);
  const rebirthUpgrades = getRebirthUpgrades(userId);
  const luckDiscountPercent = getLuckDiscountPercent(rebirthUpgrades);

  const luckCanUpgrade = upgrades.luckLevel < MAX_LUCK_LEVEL;
  const luckNextLevel = upgrades.luckLevel + 1;
  const luckPrice = getLuckPrice(luckNextLevel, luckDiscountPercent);

  const critChanceCanUpgrade = upgrades.critChanceLevel < MAX_CRIT_CHANCE_LEVEL;
  const critChancePrice = getCritChancePrice(upgrades.critChanceLevel);

  const critPowerPrice = getCritPowerPrice(upgrades.critPowerLevel);

  return {
    upgrades,
    balance,
    rebirthUpgrades,
    luckDiscountPercent,
    prices: {
      luck: luckPrice,
      critChance: critChancePrice,
      critPower: critPowerPrice,
    },
    limits: {
      luckCanUpgrade,
      critChanceCanUpgrade,
    },
  };
}

function buildCoinPayload(user, snapshot) {
  const { upgrades, balance, prices, limits, luckDiscountPercent } = snapshot;
  const luckPercent = getLuckPercent(upgrades.luckLevel);
  const nextLuckPercent = getLuckPercent(upgrades.luckLevel + 1);
  const critChancePercent = getCritChancePercent(upgrades.critChanceLevel);
  const nextCritChancePercent = getCritChancePercent(upgrades.critChanceLevel + 1);
  const critPowerPercent = getCritPowerPercent(upgrades.critPowerLevel);
  const nextCritPowerPercent = getCritPowerPercent(upgrades.critPowerLevel + 1);
  const canAffordLuck = balance >= prices.luck;
  const canAffordCritChance = balance >= prices.critChance;
  const canAffordCritPower = balance >= prices.critPower;

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
              `## ${user.username}'s Coin Upgrades`,
              `-# Balance: **${formatNumber(balance)}** ${PRCOIN}`,
              luckDiscountPercent > 0 ? `-# 💸 Luck Discount active: **-${luckDiscountPercent}%** Luck price` : null,
            ].filter(Boolean).join('\n'),
          },
          {
            type: 9,
            components: [
              {
                type: 10,
                content: [
                  `### 🍀 Luck: +${luckPercent}% higher-tier chance`,
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
                  `### 🎯 Crit Chance: ${critChancePercent}%`,
                  limits.critChanceCanUpgrade ? `-# Next: ${nextCritChancePercent}%` : '-# MAX',
                  '-# Price grows by 1000%+ each upgrade so it cannot be rushed early.',
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
                  `### 💥 Crit Damage: +${formatNumber(critPowerPercent)}% reward`,
                  `-# Next: +${formatNumber(nextCritPowerPercent)}%`,
                  '-# Every 5 upgrades adds a 25x price gate.',
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
          { type: 14, divider: true, spacing: 1 },
          buildSwitchSelect(user.id, 'coin'),
        ],
      },
    ],
  };
}

function getRebirthUpgradeSnapshot(userId, page) {
  const upgrades = getRebirthUpgrades(userId);
  const balance = getRebirthBalance(userId);
  const rebirthTier = getRebirthTier(userId);
  const discoveries = getDiscoveredLetters(userId);
  const maxPage = Math.max(1, Math.ceil(REBIRTH_UPGRADE_ORDER.length / PAGE_SIZE));
  const finalPage = Math.min(Math.max(1, page || 1), maxPage);
  const start = (finalPage - 1) * PAGE_SIZE;
  const keys = REBIRTH_UPGRADE_ORDER.slice(start, start + PAGE_SIZE);

  return {
    upgrades,
    balance,
    rebirthTier,
    discoveries,
    keys,
    page: finalPage,
    maxPage,
  };
}

function buildRebirthUpgradeSection(user, snapshot, key) {
  const config = REBIRTH_UPGRADES[key];
  const level = Math.max(0, Number(snapshot.upgrades[key]) || 0);
  const maxLevel = config.values.length;
  const isMax = level >= maxLevel;
  const currentValue = level > 0 ? config.values[level - 1] : null;
  const nextValue = isMax ? null : config.values[level];
  const price = isMax ? 0 : config.prices[level];
  const canUse = snapshot.rebirthTier >= 1;
  const canAfford = snapshot.balance >= price;
  const currentText = currentValue === null ? 'Not owned' : config.formatValue(currentValue);
  const nextText = isMax ? 'MAX' : config.formatValue(nextValue);

  return {
    type: 9,
    components: [
      {
        type: 10,
        content: [
          `### ${config.emoji} ${config.name} [${level}/${maxLevel}]`,
          `-# ${level > 0 ? config.description(currentValue) : config.description(nextValue)}`,
          `-# Current: **${currentText}**${isMax ? '' : ` → Next: **${nextText}**`}`,
        ].join('\n'),
      },
    ],
    accessory: {
      type: 2,
      custom_id: `${CUSTOM_IDS.rebirthPrefix}:${key}:${user.id}:${snapshot.page}`,
      label: isMax ? 'MAX' : `${formatNumber(price)}`,
      ...(isMax ? {} : { emoji: RBCOIN_EMOJI }),
      style: isMax ? 2 : getButtonStyle(snapshot.balance, price),
      disabled: isMax || !canUse || !canAfford,
    },
  };
}

function buildPageButton(userId, page, maxPage) {
  return {
    type: 1,
    components: [
      {
        type: 2,
        custom_id: `${CUSTOM_IDS.page}:${userId}:${page}:${maxPage}`,
        label: 'Switch page',
        style: 2,
        disabled: maxPage <= 1,
      },
    ],
  };
}

function buildRebirthPayload(user, snapshot) {
  const glyphMultiplier = getGlyphGrowthMultiplier(snapshot.upgrades, snapshot.discoveries.length);
  const header = [
    `## ${user.username}'s Rebirth Upgrades`,
    `-# Balance: **${formatNumber(snapshot.balance)}** ${RBCOIN}`,
    `-# Rebirth Tier: **${snapshot.rebirthTier}**`,
    `-# Unique Alphabets: **${snapshot.discoveries.length}**`,
    glyphMultiplier > 1 ? `-# Current Glyph Growth total: **x${glyphMultiplier.toFixed(3)}** coins` : null,
    snapshot.rebirthTier < 1 ? `-# Rebirth Upgrades unlock after **Rebirth #1**.` : null,
  ].filter(Boolean).join('\n');

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: LIGHT_PURPLE_ACCENT,
        components: [
          { type: 10, content: header },
          { type: 14, divider: true, spacing: 1 },
          ...snapshot.keys.map((key) => buildRebirthUpgradeSection(user, snapshot, key)),
          buildPageButton(user.id, snapshot.page, snapshot.maxPage),
          buildSwitchSelect(user.id, 'rebirth'),
        ],
      },
    ],
  };
}

function applyCoinUpgrade(userId, kind) {
  const upgrades = getUpgrades(userId);
  const rebirthUpgrades = getRebirthUpgrades(userId);
  const luckDiscountPercent = getLuckDiscountPercent(rebirthUpgrades);

  if (kind === 'luck') {
    if (upgrades.luckLevel >= MAX_LUCK_LEVEL) return false;
    const price = getLuckPrice(upgrades.luckLevel + 1, luckDiscountPercent);
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

  return false;
}

function applyRebirthUpgrade(userId, key) {
  const config = REBIRTH_UPGRADES[key];
  if (!config || getRebirthTier(userId) < 1) return false;

  const upgrades = getRebirthUpgrades(userId);
  const level = Math.max(0, Number(upgrades[key]) || 0);
  if (level >= config.values.length) return false;

  const price = config.prices[level];
  if (!spendRebirthBalance(userId, price)) return false;

  upgrades[key] = level + 1;
  setRebirthUpgrades(userId, upgrades);
  return true;
}

function buildPayload(user, mode, page = 1) {
  if (mode === 'rebirth') {
    return buildRebirthPayload(user, getRebirthUpgradeSnapshot(user.id, page));
  }
  return buildCoinPayload(user, getCoinUpgradeSnapshot(user.id));
}

async function render(target, user, mode = 'coin', page = 1) {
  const payload = buildPayload(user, mode, page);

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
  }
}

module.exports = {
  data: new SlashCommandBuilder().setName('upgrades').setDescription('View and buy roll upgrades'),
  suppressCommandLog: true,

  async execute(interaction) {
    await render(interaction, interaction.user, 'coin', 1);
  },

  shouldLogInteraction(interaction) {
    return !(typeof interaction.customId === 'string' && interaction.customId.startsWith('upgrades:'));
  },

  async handleInteraction(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(`${CUSTOM_IDS.switch}:`)) {
      const [, , ownerId] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own upgrades command.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const selected = interaction.values?.[0] === 'rebirth' ? 'rebirth' : 'coin';
      await render(interaction, interaction.user, selected, 1);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${CUSTOM_IDS.page}:`)) {
      const [, , ownerId, pageRaw, maxPageRaw] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own upgrades command.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const maxPage = Math.max(1, Number(maxPageRaw) || 1);
      const page = Math.max(1, Number(pageRaw) || 1);
      if (maxPage <= 1) {
        await render(interaction, interaction.user, 'rebirth', page);
        return true;
      }

      const modal = new ModalBuilder()
        .setCustomId(`${CUSTOM_IDS.pageModal}:${ownerId}:${maxPage}`)
        .setTitle('Switch upgrade page');
      const input = new TextInputBuilder()
        .setCustomId('page_input')
        .setLabel('Which page do you want to switch to?')
        .setPlaceholder(`Page 1 - ${maxPage}`)
        .setRequired(true)
        .setStyle(TextInputStyle.Short);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(`${CUSTOM_IDS.pageModal}:`)) {
      const [, , ownerId, maxPageRaw] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own upgrades command.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const maxPage = Math.max(1, Number(maxPageRaw) || 1);
      const asked = Number(interaction.fields.getTextInputValue('page_input'));
      const page = Number.isFinite(asked) ? Math.min(Math.max(1, Math.floor(asked)), maxPage) : 1;
      await render(interaction, interaction.user, 'rebirth', page);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(`${CUSTOM_IDS.rebirthPrefix}:`)) {
      const [, , key, ownerId, pageRaw] = interaction.customId.split(':');
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use controls from your own upgrades command.', flags: MessageFlags.Ephemeral });
        return true;
      }

      applyRebirthUpgrade(interaction.user.id, key);
      await render(interaction, interaction.user, 'rebirth', Math.max(1, Number(pageRaw) || 1));
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith('upgrades:coin:')) {
      const customIdParts = interaction.customId.split(':');
      const kindRaw = customIdParts[2];
      const ownerId = customIdParts[3];
      if (ownerId !== interaction.user.id) {
        await interaction.reply({ content: 'You can only use buttons from your own upgrades command.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const map = {
        luck: 'luck',
        critchance: 'critChance',
        critpower: 'critPower',
      };

      const upgradeKind = map[kindRaw];
      if (!upgradeKind) {
        return false;
      }

      applyCoinUpgrade(interaction.user.id, upgradeKind);
      await render(interaction, interaction.user, 'coin', 1);
      return true;
    }

    return false;
  },
};
