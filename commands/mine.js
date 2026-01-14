const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const {
  getUserProfile,
  updateUserProfile,
  addItemToInventory,
  setInventoryItemAmount,
  ITEMS_BY_ID,
  normalizeGearItem,
} = require('../src/huntProfile');
const { addMineXp, getUserMineProfile } = require('../src/mineProfile');
const { createDigThumbnail } = require('../src/digThumbnail');

const MINE_BUTTON_PREFIX = 'mine:';
const MINE_SELECT_PREFIX = 'mine-select:';
const MINE_THUMBNAIL = 'https://i.ibb.co/XkkgMzh5/SBDig.png';
const MINE_LAYER_THUMBNAIL =
  'https://cdn.discordapp.com/emojis/1456946445818007657.png?size=240&quality=lossless';
const LAYER_EMOJI = '<:SBStoneLayer:1456946445818007657>';
const MINE_ACCENT_COLOR = 0xffffff;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;

function normalizeEmojiForComponent(emoji) {
  if (!emoji) {
    return null;
  }

  if (typeof emoji === 'object' && (emoji.id || emoji.name)) {
    if (emoji.id) {
      return null;
    }
    if (emoji.name) {
      const trimmed = String(emoji.name).trim();
      return trimmed.length > 0 ? { name: trimmed } : null;
    }
    return null;
  }

  if (typeof emoji !== 'string') {
    return null;
  }

  const customMatch = emoji.match(/^<(a?):([^:>]+):(\d+)>$/);
  if (customMatch) {
    return null;
  }

  if (typeof emoji === 'string' && emoji.trim().length > 0) {
    return { name: emoji.trim() };
  }

  return null;
}

const MINE_DURATION_MS = 5 * 60 * 1000;
const MINE_INACTIVITY_MS = 30 * 1000;

const activeMines = new Map();

const EARLY_LAYER_ORES = [
  { id: 'ITCoal', chance: 15 },
  { id: 'ITFossil', chance: 20 },
  { id: 'ITCopperOre', chance: 9 },
  { id: 'ITIronOre', chance: 6 },
  { id: 'ITGoldOre', chance: 2.5 },
];

const DEEP_LAYER_ORES = [
  { id: 'ITCoal', chance: 25 },
  { id: 'ITFossil', chance: 35 },
  { id: 'ITCopperOre', chance: 15 },
  { id: 'ITIronOre', chance: 10 },
  { id: 'ITGoldOre', chance: 5 },
  { id: 'ITDiamond', chance: 0.00525 },
  { id: 'ITEmerald', chance: 0.015 },
  { id: 'ITSapphire', chance: 0.1 },
  { id: 'ITRuby', chance: 0.065 },
  { id: 'ITAmethyst', chance: 0.5 },
];

function randomInRange([min, max]) {
  const low = Math.floor(Number(min) || 0);
  const high = Math.floor(Number(max) || 0);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function calculateMineDamage(gear, mineLevel) {
  const fallback = randomInRange([2, 5]);
  if (!gear) {
    return fallback;
  }

  const basePower = Number(gear.power);
  if (!Number.isFinite(basePower)) {
    return fallback;
  }

  const perLevel = Number(gear.MinePow);
  const level = Math.max(0, Math.floor(Number(mineLevel) || 0));
  const scaling = Number.isFinite(perLevel) ? perLevel : 0;
  return Math.max(1, Math.floor(basePower + scaling * level));
}

function getLayerHealth(layer) {
  return 10 + Math.max(0, layer) * 5;
}

function formatProgressBar(health, maxHealth) {
  const clamped = Math.max(0, Math.min(maxHealth, health));
  const filled = maxHealth > 0 ? Math.round((clamped / maxHealth) * 20) : 0;
  const safeFilled = Math.max(0, Math.min(20, filled));
  return `${'█'.repeat(safeFilled)}${'░'.repeat(20 - safeFilled)}`;
}

function formatCountdown(target) {
  return `<t:${Math.floor(target / 1000)}:R>`;
}

function getOreTableForLayer(layer) {
  if (layer <= 50) {
    return EARLY_LAYER_ORES;
  }
  if (layer <= 100) {
    return DEEP_LAYER_ORES;
  }
  return DEEP_LAYER_ORES;
}

const ORE_XP_BY_RARITY = {
  Common: [6, 12],
  Rare: [14, 20],
  Epic: [20, 28],
  Legendary: [30, 45],
};

function rollLoot(layer) {
  const items = [];
  const stoneAmount = randomInRange([3, 5]);
  if (ITEMS_BY_ID.ITStone) {
    items.push({ item: ITEMS_BY_ID.ITStone, amount: stoneAmount });
  }

  let xp = randomInRange([5, 12]);
  const oreTable = getOreTableForLayer(layer);
  for (const entry of oreTable) {
    if (Math.random() * 100 <= entry.chance) {
      const item = ITEMS_BY_ID[entry.id];
      if (item) {
        items.push({ item, amount: 1 });
        const xpRange = ORE_XP_BY_RARITY[item.rarity] ?? [10, 20];
        xp += randomInRange(xpRange);
      }
    }
  }

  return { items, xp, thumbnailEmoji: LAYER_EMOJI };
}

function buildHomeMessage() {
  const container = {
    type: 17,
    accent_color: MINE_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: '## Mining\n-# Press MINE to start mining...',
          },
        ],
        accessory: {
          type: 11,
          media: { url: MINE_THUMBNAIL },
        },
      },
      { type: 14 },
      {
        type: 1,
        components: [
          { type: 2, style: 4, custom_id: `${MINE_BUTTON_PREFIX}start`, label: 'MINE' },
          { type: 2, style: 2, custom_id: `${MINE_BUTTON_PREFIX}stats`, label: 'Mine Stat' },
          { type: 2, style: 2, custom_id: `${MINE_BUTTON_PREFIX}equipment`, label: 'Equipment' },
        ],
      },
    ],
  };

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [container],
  };
}

function buildNavRow(view) {
  if (view === 'home') {
    return [
      { type: 2, style: 4, custom_id: `${MINE_BUTTON_PREFIX}start`, label: 'MINE' },
      { type: 2, style: 2, custom_id: `${MINE_BUTTON_PREFIX}stats`, label: 'Mine Stat' },
      { type: 2, style: 2, custom_id: `${MINE_BUTTON_PREFIX}equipment`, label: 'Equipment' },
    ];
  }

  return [
    { type: 2, style: 2, custom_id: `${MINE_BUTTON_PREFIX}home`, label: 'Back' },
    { type: 2, style: view === 'stats' ? 4 : 2, custom_id: `${MINE_BUTTON_PREFIX}stats`, label: 'Mine Stat', disabled: view === 'stats' },
    {
      type: 2,
      style: view === 'equipment' ? 4 : 2,
      custom_id: `${MINE_BUTTON_PREFIX}equipment`,
      label: 'Equipment',
      disabled: view === 'equipment',
    },
  ];
}

function buildStatsMessage(mineProfile) {
  const { level, xp, next_level_xp: nextLevel, upgrade_tokens: tokens } = mineProfile;
  const progressBar = formatProgressBar(xp, nextLevel);
  const percent = Math.min(100, Math.max(0, (xp / Math.max(nextLevel, 1)) * 100));
  const container = {
    type: 17,
    accent_color: MINE_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Mine Stat\n### Mine Level: ${level}\n-# ${progressBar} \`${xp} / ${nextLevel} - ${percent.toFixed(2)}%\`\n* Mine Upgrade Tokens: ${tokens}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: MINE_THUMBNAIL },
        },
      },
      { type: 14 },
      { type: 1, components: buildNavRow('stats') },
    ],
  };

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [container],
  };
}

function itemSupportsMineActivity(item) {
  return (item?.activityTags ?? []).some((tag) => {
    if (typeof tag !== 'string') return false;
    const lowered = tag.toLowerCase();
    return lowered === 'mine' || lowered === 'dig';
  });
}

function gearSupportsMine(item) {
  return itemSupportsMineActivity(item) && (item?.name ?? '').toLowerCase() !== 'fist';
}

function getEquippedMineGear(profile) {
  const equipped = normalizeGearItem(profile.gear_equipped);
  if (gearSupportsMine(equipped)) {
    return equipped;
  }
  const mineGear = (profile.gear_inventory ?? [])
    .map(normalizeGearItem)
    .filter((item) => gearSupportsMine(item) && (item.amount === undefined || item.amount > 0));
  return mineGear[0] ?? null;
}

function buildGearPlaceholder(profile) {
  const gear = getEquippedMineGear(profile);
  if (!gear) {
    return 'No mining gear equipped';
  }
  return `${gear.emoji ?? ''} ${gear.name ?? 'Gear'}`.trim();
}

function buildMiscPlaceholder(profile) {
  if (!profile.misc_equipped) {
    return 'No Misc equipped';
  }
  return `${profile.misc_equipped.name ?? 'Misc'} ${profile.misc_equipped.emoji ?? ''}`.trim();
}

function buildGearOptions(profile) {
  const equippedName = getEquippedMineGear(profile)?.name ?? null;
  const mineGear = (profile.gear_inventory ?? [])
    .map(normalizeGearItem)
    .filter((item) => gearSupportsMine(item) && (item.amount === undefined || item.amount > 0));

  if (!mineGear.length) {
    return [{ label: 'No mining gear available', value: 'none', default: true }];
  }

  return mineGear.map((item) => {
    const name = item?.name ?? 'Gear';
    const option = { label: name, value: name, default: equippedName === name };
    const emoji = normalizeEmojiForComponent(item?.emoji);
    if (emoji) {
      option.emoji = emoji;
    }
    return option;
  });
}

function buildMiscOptions(profile) {
  const miscItems = (profile.misc_inventory ?? []).filter(
    (item) => itemSupportsMineActivity(item) && (item.amount === undefined || item.amount > 0)
  );
  if (!miscItems.length) {
    return [{ label: 'No misc available', value: 'none', default: true }];
  }

  const equippedName = profile.misc_equipped?.name ?? null;
  return miscItems.map((item) => {
    const option = {
      label: item?.name ?? 'Misc',
      value: item?.name ?? 'Misc',
      default: equippedName === item?.name,
    };

    const emoji = normalizeEmojiForComponent(item?.emoji);
    if (emoji) {
      option.emoji = emoji;
    }

    return option;
  });
}

function buildEquipmentContainers(profile, userId) {
  const gear = getEquippedMineGear(profile) ?? { name: 'None', emoji: '—' };
  const misc = profile.misc_equipped ?? { name: 'None', emoji: '—' };
  const infoContainer = {
    type: 17,
    accent_color: MINE_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Mine Equipment\n### * Gear equipped: ${gear.name} ${gear.emoji ?? ''}\n### * Misc equipped: ${misc.name} ${misc.emoji ?? ''}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: MINE_THUMBNAIL },
        },
      },
      { type: 14 },
      { type: 1, components: buildNavRow('equipment') },
    ],
  };

  const selectionContainer = {
    type: 17,
    accent_color: 0x000000,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: '### Selection Panel\n- Choose gear and misc options below to update your mining loadout.',
          },
        ],
        accessory: {
          type: 11,
          media: { url: MINE_THUMBNAIL },
        },
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${MINE_SELECT_PREFIX}gear:${userId}`,
            placeholder: buildGearPlaceholder(profile),
            options: buildGearOptions(profile),
            min_values: 1,
            max_values: 1,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${MINE_SELECT_PREFIX}misc:${userId}`,
            placeholder: buildMiscPlaceholder(profile),
            options: buildMiscOptions(profile),
            min_values: 1,
            max_values: 1,
          },
        ],
      },
    ],
  };

  return [infoContainer, selectionContainer];
}

function buildEquipmentMessage(profile, userId) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: buildEquipmentContainers(profile, userId),
  };
}

function buildStartingMessage() {
  const container = {
    type: 17,
    accent_color: MINE_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [{ type: 10, content: 'You are preparing to mine...' }],
        accessory: {
          type: 11,
          media: { url: MINE_LAYER_THUMBNAIL },
        },
      },
    ],
  };

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [container],
  };
}

async function buildActiveMessage(session) {
  const { layer, health, maxHealth, expiresAt, loot, pendingLoot } = session;
  const progressBar = formatProgressBar(health, maxHealth);
  const countdown = formatCountdown(expiresAt);
  const lootForThumbnail = pendingLoot ?? loot;
  const shouldRefreshThumbnail =
    !session.thumbnailAttachment || session.thumbnailAttachmentLayer !== session.layer;

  if (shouldRefreshThumbnail) {
    session.thumbnailAttachment = await createDigThumbnail({
      layerImageUrl: MINE_LAYER_THUMBNAIL,
      items: (lootForThumbnail?.items ?? []).map((entry) => entry.item).filter(Boolean),
    });
    session.thumbnailAttachmentLayer = session.layer;
  }
  const thumbnailAttachment = session.thumbnailAttachment;
  const mediaUrl = thumbnailAttachment ? `attachment://${thumbnailAttachment.name}` : MINE_LAYER_THUMBNAIL;

  const messageLines = [
    `## You are mining - Layer ${layer}`,
    `-# ${progressBar} - ${health}`,
    `-# Reset ${countdown}`,
  ];

  if (loot?.items?.length) {
    messageLines.push(`-# You earned these items from layer ${layer - 1}:`);
    for (const entry of loot.items) {
      const emoji = entry.item?.emoji ? `${entry.item.emoji} ` : '';
      messageLines.push(`-# ${emoji}${entry.item?.name ?? 'Unknown'} x${entry.amount}`);
    }
  }

  const container = {
    type: 17,
    accent_color: MINE_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [{ type: 10, content: messageLines.join('\n') }],
        accessory: { type: 11, media: { url: mediaUrl } },
      },
      { type: 14 },
      {
        type: 1,
        components: [
          { type: 2, style: 3, custom_id: `${MINE_BUTTON_PREFIX}swing`, label: 'MINE' },
          { type: 2, style: 2, custom_id: `${MINE_BUTTON_PREFIX}stop`, label: 'Stop mining' },
          { type: 2, style: 2, custom_id: `${MINE_BUTTON_PREFIX}misc`, label: 'Use Misc', disabled: true },
        ],
      },
    ],
  };

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [container],
    files: thumbnailAttachment ? [thumbnailAttachment] : [],
  };
}

function endSession(userId) {
  const session = activeMines.get(userId);
  if (!session) return;
  clearTimeout(session.inactivityTimer);
  activeMines.delete(userId);
}

function resetInactivity(interaction, session) {
  if (!session) return;
  if (session.inactivityTimer) {
    clearTimeout(session.inactivityTimer);
  }
  session.inactivityTimer = setTimeout(async () => {
    endSession(session.userId);
    try {
      const home = buildHomeMessage();
      await interaction.message.edit(home);
    } catch (error) {
      // ignore edit failures
    }
  }, MINE_INACTIVITY_MS);
}

async function startMining(interaction) {
  const userId = interaction.user.id;
  const existingSession = activeMines.get(userId);
  if (existingSession && Date.now() < existingSession.expiresAt) {
    await safeErrorReply(
      interaction,
      'You already have an active mine. Please finish it or wait for it to end before starting another.'
    );
    return;
  }

  if (existingSession && Date.now() >= existingSession.expiresAt) {
    endSession(userId);
  }

  const huntProfile = getUserProfile(userId);
  const equippedGear = getEquippedMineGear(huntProfile);
  if (!equippedGear) {
    await safeErrorReply(interaction, 'You need a mining tool equipped before you can mine.');
    return;
  }

  huntProfile.gear_equipped = equippedGear;
  updateUserProfile(userId, huntProfile);
  getUserMineProfile(userId);

  const now = Date.now();
  const session = {
    userId,
    channelId: interaction.channelId,
    messageId: interaction.message?.id,
    layer: 0,
    health: getLayerHealth(0),
    maxHealth: getLayerHealth(0),
    startedAt: now,
    expiresAt: now + MINE_DURATION_MS,
    loot: null,
    pendingLoot: rollLoot(0),
    thumbnailAttachment: null,
    thumbnailAttachmentLayer: null,
    gear: equippedGear,
    inactivityTimer: null,
  };

  activeMines.set(userId, session);
  await interaction.update(buildStartingMessage());

  setTimeout(async () => {
    const current = activeMines.get(userId);
    if (!current) return;
    try {
      await interaction.message.edit(await buildActiveMessage(current));
    } catch (error) {
      // ignore
    }
  }, 3000);

  resetInactivity(interaction, session);
}

async function handleSwing(interaction) {
  const userId = interaction.user.id;
  const session = activeMines.get(userId);
  if (!session) {
    await interaction.update(buildHomeMessage());
    return true;
  }

  if (Date.now() >= session.expiresAt) {
    endSession(userId);
    await interaction.update(buildHomeMessage());
    return true;
  }

  const mineProfile = getUserMineProfile(userId);
  const damage = calculateMineDamage(session.gear, mineProfile.level);
  session.health = Math.max(0, session.health - damage);

  if (session.health <= 0) {
    const loot = session.pendingLoot ?? rollLoot(session.layer);
    session.layer += 1;
    session.maxHealth = getLayerHealth(session.layer);
    session.health = session.maxHealth;
    session.pendingLoot = rollLoot(session.layer);

    const profile = getUserProfile(userId);
    const awardedItems = [];
    for (const entry of loot.items) {
      if (entry.item) {
        const addedAmount = addItemToInventory(profile, entry.item, entry.amount);
        if (addedAmount > 0) {
          awardedItems.push({ ...entry, amount: addedAmount });
        }
      }
    }
    updateUserProfile(userId, profile);
    session.loot = { ...loot, items: awardedItems };

    const updatedMineProfile = addMineXp(userId, loot.xp);
    const mineToken = ITEMS_BY_ID.ITMineUpgradeToken;
    if (mineToken) {
      const refreshedProfile = getUserProfile(userId);
      setInventoryItemAmount(refreshedProfile, mineToken, updatedMineProfile.upgrade_tokens);
      updateUserProfile(userId, refreshedProfile);
    }
  }

  await interaction.update(await buildActiveMessage(session));
  resetInactivity(interaction, session);
  return true;
}

async function handleStop(interaction) {
  const userId = interaction.user.id;
  endSession(userId);
  await interaction.update(buildHomeMessage());
  return true;
}

async function handleNavigation(interaction, target) {
  const mineProfile = getUserMineProfile(interaction.user.id);
  const huntProfile = getUserProfile(interaction.user.id);
  if (target === 'stats') {
    await interaction.update(buildStatsMessage(mineProfile));
    return true;
  }
  if (target === 'equipment') {
    await interaction.update(buildEquipmentMessage(huntProfile, interaction.user.id));
    return true;
  }
  await interaction.update(buildHomeMessage());
  return true;
}

function applySelection(profile, type, value) {
  if (!value || value === 'none') {
    return profile;
  }

  if (type === 'gear') {
    const selected = (profile.gear_inventory ?? []).find(
      (item) =>
        item?.name === value && itemSupportsMineActivity(item) && (item.amount === undefined || item.amount > 0)
    );
    if (selected) {
      const normalized = normalizeGearItem(selected);
      profile.gear_equipped = normalized;
    }
    return profile;
  }

  if (type === 'misc') {
    const selected = (profile.misc_inventory ?? []).find(
      (item) => item?.name === value && itemSupportsMineActivity(item) && (item.amount === undefined || item.amount > 0)
    );
    if (selected) {
      profile.misc_equipped = selected;
    }
    return profile;
  }

  return profile;
}

async function handleSelect(interaction, type, ownerId) {
  if (interaction.user.id !== ownerId) {
    await interaction.reply({ content: "This isn't your mine session.", ephemeral: true });
    return true;
  }

  const selection = interaction.values?.[0];
  const profile = getUserProfile(ownerId);
  applySelection(profile, type, selection);
  updateUserProfile(ownerId, profile);

  await interaction.update(buildEquipmentMessage(profile, ownerId));
  return true;
}

module.exports = {
  data: new SlashCommandBuilder().setName('mine').setDescription('Start mining for ores!'),
  async execute(interaction) {
    try {
      const response = buildHomeMessage();
      await interaction.reply({ ...response, fetchReply: true });
    } catch (error) {
      await safeErrorReply(interaction, 'Unable to start mining right now.');
    }
  },
  async handleComponent(interaction) {
    const isMineButton = interaction.isButton() && interaction.customId.startsWith(MINE_BUTTON_PREFIX);
    const isMineSelect = interaction.isStringSelectMenu() && interaction.customId.startsWith(MINE_SELECT_PREFIX);
    if (!isMineButton && !isMineSelect) {
      return false;
    }

    const customParts = interaction.customId.split(':');
    const ownerFromCustomId = customParts[customParts.length - 1];
    const ownerId = interaction.message.interaction?.user?.id;

    if (interaction.user.id !== ownerId && interaction.user.id !== ownerFromCustomId) {
      await interaction.reply({ content: "This isn't your mine session.", ephemeral: true });
      return true;
    }

    if (isMineSelect) {
      const [, type, userId] = interaction.customId.split(':');
      return handleSelect(interaction, type, userId);
    }

    const action = interaction.customId.slice(MINE_BUTTON_PREFIX.length);
    if (action === 'start') {
      await startMining(interaction);
      return true;
    }

    if (action === 'swing') {
      return handleSwing(interaction);
    }

    if (action === 'stop') {
      return handleStop(interaction);
    }

    if (['stats', 'equipment', 'home'].includes(action)) {
      return handleNavigation(interaction, action);
    }

    return false;
  },
};
