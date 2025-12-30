const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const {
  CHAT_UPGRADE_TOKEN_ITEM,
  ITEMS_BY_ID,
  getUserProfile,
  setInventoryItemAmount,
  updateUserProfile,
} = require('../src/huntProfile');
const {
  HUNT_UPGRADE_TOKEN_EMOJI,
  HUNT_UPGRADE_TRACKS,
  DEFAULT_HUNT_UPGRADES,
  getHuntUpgradeStats,
  getMaxTier,
  getTotalUpgradeTiers,
  getUpgradeNextCost,
} = require('../src/huntUpgrades');
const { getUserDigProfile, updateUserDigProfile } = require('../src/digProfile');
const { getUserStats, setUserStats } = require('../src/userStats');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const UPGRADE_SELECT_ID = 'my-upgrades-select';
const UPGRADE_BUTTON_PREFIX = 'my-upgrades-buy';
const RESET_BUTTON_ID = 'my-upgrades-reset';

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function buildUpgradeSelect(userId) {
  return new ActionRowBuilder()
    .addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`${UPGRADE_SELECT_ID}:${userId}`)
        .setPlaceholder('Upgrades')
        .addOptions({ label: 'Hunt', value: 'hunt' })
    )
    .toJSON();
}

function buildUpgradeButton({ key, userId, currentTier, maxTier, cost, canAfford }) {
  const button = new ButtonBuilder()
    .setCustomId(`${UPGRADE_BUTTON_PREFIX}:${key}:${userId}`)
    .setEmoji(HUNT_UPGRADE_TOKEN_EMOJI)
    .setLabel(`${cost}`);

  if (currentTier >= maxTier) {
    return button.setLabel('MAXED').setStyle(ButtonStyle.Secondary).setDisabled(true).toJSON();
  }

  if (!canAfford) {
    return button.setStyle(ButtonStyle.Danger).setDisabled(true).toJSON();
  }

  return button.setStyle(ButtonStyle.Success).setDisabled(false).toJSON();
}

function buildResetRow(userId, resetUsed) {
  const label = resetUsed ? 'Reset Used' : 'Reset Upgrades (one-time)';
  const button = new ButtonBuilder()
    .setCustomId(`${RESET_BUTTON_ID}:${userId}`)
    .setStyle(ButtonStyle.Danger)
    .setDisabled(resetUsed)
    .setLabel(label);

  return new ActionRowBuilder().addComponents(button).toJSON();
}

function buildUpgradeRow({ label, value, button }) {
  return {
    type: 9,
    components: [{ type: 10, content: `### +${formatPercent(value)}% ${label}` }],
    accessory: button,
  };
}

function buildHuntUpgradeView(user, profile) {
  const { upgrades, huntXpPercent, itemLuckPercent, creatureLuckPercent, dungeonTokenChancePercent, critChancePercent, critDamagePercent } =
    getHuntUpgradeStats(profile);
  const totalPurchased = Object.values(upgrades).reduce((sum, tier) => sum + tier, 0);
  const totalMax = getTotalUpgradeTiers();
  const tokensAvailable = profile.upgrade_tokens ?? 0;

  const upgradeEntries = [
    { key: 'hunt_xp', label: 'Hunt XP', value: huntXpPercent },
    { key: 'item_luck', label: 'Item Luck', value: itemLuckPercent },
    { key: 'dungeon_token_chance', label: 'Dungeon Token Chance', value: dungeonTokenChancePercent },
    { key: 'creature_luck', label: 'Creature Luck', value: creatureLuckPercent },
    { key: 'crit_damage', label: 'Player / Allies Crit Damage', value: critDamagePercent },
    { key: 'crit_chance', label: 'Player / Allies Crit Chance', value: critChancePercent },
  ];

  const components = [
    {
      type: 10,
      content: `## ${user.username}'s Hunt Upgrades\n-# You have bought ${totalPurchased} / ${totalMax} Upgrades.`,
    },
    buildUpgradeSelect(user.id),
    buildResetRow(user.id, profile?.upgrade_reset_used),
  ];

  for (const entry of upgradeEntries) {
    const currentTier = upgrades[entry.key] ?? 0;
    const maxTier = getMaxTier(entry.key);
    const nextCost = getUpgradeNextCost(entry.key, currentTier);
    const canAfford = nextCost !== null && tokensAvailable >= nextCost;
    const button = buildUpgradeButton({
      key: entry.key,
      userId: user.id,
      currentTier,
      maxTier,
      cost: nextCost ?? 0,
      canAfford,
    });

    components.push(buildUpgradeRow({ label: entry.label, value: entry.value, button }));
  }

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components,
      },
    ],
  };
}

function resetAllUpgrades(userId) {
  const profile = getUserProfile(userId);
  if (profile.upgrade_reset_used) {
    return { success: false, profile };
  }

  updateUserProfile(userId, {
    ...profile,
    hunt_upgrades: { ...DEFAULT_HUNT_UPGRADES },
    hunt_upgrade_tokens_used: 0,
    upgrade_reset_used: true,
  });

  const digProfile = getUserDigProfile(userId);
  updateUserDigProfile(userId, { ...digProfile, dig_upgrade_tokens_used: 0 });

  setUserStats(userId, { ...getUserStats(userId), chat_upgrade_tokens_used: 0 });
  const refreshedStats = getUserStats(userId);
  const refreshedDig = getUserDigProfile(userId);
  const digTokenItem = ITEMS_BY_ID.ITDigUpgradeToken;

  if (digTokenItem) {
    const inventoryProfile = getUserProfile(userId);
    setInventoryItemAmount(inventoryProfile, digTokenItem, refreshedDig.upgrade_tokens);
    updateUserProfile(userId, inventoryProfile);
  }

  return { success: true, profile: getUserProfile(userId), stats: refreshedStats, dig: refreshedDig };
}

function buildUpgradeIntro(user, profile) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 10, content: `## ${user.username}'s Upgrades\n-# Select a type of upgrade.` },
          buildUpgradeSelect(user.id),
          buildResetRow(user.id, profile?.upgrade_reset_used),
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-upgrades')
    .setDescription('View and purchase your upgrades.'),

  async execute(interaction) {
    const profile = getUserProfile(interaction.user.id);
    await interaction.reply(buildUpgradeIntro(interaction.user, profile));
  },

  async handleComponent(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(UPGRADE_SELECT_ID)) {
      const [, userId] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      const value = interaction.values?.[0];
      if (value === 'hunt') {
        const profile = getUserProfile(userId);
        await interaction.update(buildHuntUpgradeView(interaction.user, profile));
        return true;
      }

      const profile = getUserProfile(userId);
      await interaction.update(buildUpgradeIntro(interaction.user, profile));
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(RESET_BUTTON_ID)) {
      const [, userId] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      const resetResult = resetAllUpgrades(userId);
      if (!resetResult.success) {
        await safeErrorReply(interaction, 'You have already used your one-time upgrade reset.');
        return true;
      }

      await interaction.update(buildUpgradeIntro(interaction.user, resetResult.profile));
      await interaction.followUp({
        content: 'All upgrades have been reset and upgrade tokens were restored based on your current levels.',
        ephemeral: true,
      });
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(UPGRADE_BUTTON_PREFIX)) {
      const [, upgradeKey, userId] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      const track = HUNT_UPGRADE_TRACKS[upgradeKey];
      if (!track) {
        await safeErrorReply(interaction, 'That upgrade is not available.');
        return true;
      }

      const profile = getUserProfile(userId);
      const { upgrades } = getHuntUpgradeStats(profile);
      const currentTier = upgrades[upgradeKey] ?? 0;
      const maxTier = getMaxTier(upgradeKey);

      if (currentTier >= maxTier) {
        await safeErrorReply(interaction, 'This upgrade is already maxed.');
        return true;
      }

      const cost = getUpgradeNextCost(upgradeKey, currentTier);
      if (cost === null || (profile.upgrade_tokens ?? 0) < cost) {
        await safeErrorReply(interaction, 'You do not have enough Hunt Upgrade Tokens.');
        return true;
      }

      profile.hunt_upgrades = {
        ...upgrades,
        [upgradeKey]: currentTier + 1,
      };
      profile.hunt_upgrade_tokens_used = (profile.hunt_upgrade_tokens_used ?? 0) + cost;
      updateUserProfile(userId, profile);

      const updatedProfile = getUserProfile(userId);
      await interaction.update(buildHuntUpgradeView(interaction.user, updatedProfile));
      return true;
    }

    return false;
  },
};
