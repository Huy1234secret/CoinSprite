const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const { getUserProfile, updateUserProfile } = require('../src/huntProfile');
const {
  HUNT_UPGRADE_TOKEN_EMOJI,
  HUNT_UPGRADE_TRACKS,
  getHuntUpgradeStats,
  getMaxTier,
  getTotalUpgradeTiers,
  getUpgradeNextCost,
} = require('../src/huntUpgrades');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const UPGRADE_SELECT_ID = 'my-upgrades-select';
const UPGRADE_BUTTON_PREFIX = 'my-upgrades-buy';

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

function buildUpgradeIntro(user) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 10, content: `## ${user.username}'s Upgrades\n-# Select a type of upgrade.` },
          buildUpgradeSelect(user.id),
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('my-upgrades')
    .setDescription('View your upgrades!'),

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

      await interaction.update(buildUpgradeIntro(interaction.user));
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
