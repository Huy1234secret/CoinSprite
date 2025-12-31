const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const {
  getUserProfile,
  updateUserProfile,
  addItemToInventory,
  setInventoryItemAmount,
  ITEMS_BY_ID,
  FIST_GEAR,
  normalizeGearItem,
} = require('../src/huntProfile');
const { addDigXp, getUserDigProfile } = require('../src/digProfile');
const { createDigThumbnail } = require('../src/digThumbnail');

const DIG_BUTTON_PREFIX = 'dig:';
const DIG_SELECT_PREFIX = 'dig-select:';
const DIG_THUMBNAIL = 'https://i.ibb.co/XkkgMzh5/SBDig.png';
const DIG_LAYER_THUMBNAIL = 'https://cdn.discordapp.com/emojis/1453258150697500702.png?size=240&quality=lossless';
const LAYER_EMOJI = '<:SBLayerDirt:1453258150697500702>';
const DIG_ACCENT_COLOR = 0xffffff;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;

function normalizeEmojiForComponent(emoji) {
  if (!emoji) {
    return null;
  }

  if (typeof emoji === 'object' && (emoji.id || emoji.name)) {
    const normalized = {};
    if (emoji.id) {
      const idString = String(emoji.id);
      const isSnowflake = /^\d{17,20}$/.test(idString);
      if (isSnowflake && emoji.name) {
        normalized.id = idString;
      }
    }
    if (emoji.name) {
      normalized.name = emoji.name;
    }
    if (typeof emoji.animated === 'boolean') {
      normalized.animated = emoji.animated;
    }
    if (!normalized.id && !normalized.name) {
      return null;
    }
    return normalized;
  }

  if (typeof emoji !== 'string') {
    return null;
  }

  const customMatch = emoji.match(/^<(a?):([^:>]+):(\d+)>$/);
  if (customMatch) {
    const [, animatedFlag, name, id] = customMatch;
    const safeName = name?.trim();
    const safeId = id?.trim();
    const isSnowflake = /^\d{17,20}$/.test(safeId ?? '');
    if (!safeName || !safeId || !isSnowflake) {
      return null;
    }
    return { id: safeId, name: safeName, animated: Boolean(animatedFlag) };
  }

  if (typeof emoji === 'string' && emoji.trim().length > 0) {
    return { name: emoji.trim() };
  }

  return null;
}

const DIG_DURATION_MS = 5 * 60 * 1000;
const DIG_INACTIVITY_MS = 30 * 1000;

const activeDigs = new Map();

const DROP_TABLE = [
  { id: 'ITBone', chance: 0.1, xp: [10, 20] },
  { id: 'ITLeaf', chance: 0.55, xp: [5, 10] },
  { id: 'ITFeather', chance: 0.35, xp: [6, 13] },
  { id: 'ITClay', chance: 0.08, xp: [12, 24] },
  { id: 'ITPebbles', chance: 0.25, xp: [8, 15] },
  { id: 'ITTwigs', chance: 0.25, xp: [8, 15] },
  { id: 'ITStone', chance: 0.35, xp: [7, 14] },
  { id: 'ITTreeBark', chance: 0.3, xp: [7, 14] },
  { id: 'ITAcorn', chance: 0.28, xp: [8, 14] },
];

const CHEST_TYPES = [
  { key: 'Common Treasure Chest', id: 'ITCommonChest', xp: [50, 80], emoji: '<:Layer2n1:1453261380667969557>' },
  { key: 'Rare Treasure Chest', id: 'ITRareChest', xp: [80, 150], emoji: '<:Layer2n2:1453261383734132889>' },
  { key: 'Epic Treasure Chest', id: 'ITEpicChest', xp: [200, 450], emoji: '<:Layer2n3:1453261387278061609>' },
  { key: 'Legendary Treasure Chest', id: 'ITLegendaryChest', xp: [500, 800], emoji: '<:Layer2n4:1453261390272790580>' },
  { key: 'Mythical Treasure Chest', id: 'ITMythicalChest', xp: [1000, 2500], emoji: '<:Layer2n5:1453261392852287499>' },
  { key: 'Secret Treasure Chest', id: 'ITSecretChest', xp: [3000, 5000], emoji: '<:Layer2n6:1453261404990865420>' },
];

function randomInRange([min, max]) {
  const low = Math.floor(Number(min) || 0);
  const high = Math.floor(Number(max) || 0);
  return Math.floor(Math.random() * (high - low + 1)) + low;
}

function getLayerHealth(layer) {
  return 10 + Math.floor(Math.max(0, layer) / 2) * 5;
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

function getTreasureRoll(layer) {
  if (layer >= 200) {
    return [
      { type: 'Normal Layout', chance: 0.8 },
      { type: 'Common Treasure Chest', chance: 0.12 },
      { type: 'Rare Treasure Chest', chance: 0.06 },
      { type: 'Epic Treasure Chest', chance: 0.015 },
      { type: 'Legendary Treasure Chest', chance: 0.0045 },
      { type: 'Mythical Treasure Chest', chance: 0.00049 },
      { type: 'Secret Treasure Chest', chance: 0.00001 },
    ];
  }

  if (layer >= 136) {
    return [
      { type: 'Normal Layout', chance: 0.85 },
      { type: 'Common Treasure Chest', chance: 0.1 },
      { type: 'Rare Treasure Chest', chance: 0.04 },
      { type: 'Epic Treasure Chest', chance: 0.0075 },
      { type: 'Legendary Treasure Chest', chance: 0.0024 },
      { type: 'Mythical Treasure Chest', chance: 0.0001 },
    ];
  }

  if (layer >= 71) {
    return [
      { type: 'Normal Layout', chance: 0.86 },
      { type: 'Common Treasure Chest', chance: 0.1 },
      { type: 'Rare Treasure Chest', chance: 0.035 },
      { type: 'Epic Treasure Chest', chance: 0.005 },
    ];
  }

  if (layer >= 26) {
    return [
      { type: 'Normal Layout', chance: 0.9 },
      { type: 'Common Treasure Chest', chance: 0.075 },
      { type: 'Rare Treasure Chest', chance: 0.025 },
    ];
  }

  return [
    { type: 'Normal Layout', chance: 0.95 },
    { type: 'Common Treasure Chest', chance: 0.05 },
  ];
}

function pickTreasureType(layer) {
  const entries = getTreasureRoll(layer);
  const roll = Math.random();
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += entry.chance;
    if (roll <= cumulative) {
      return entry.type;
    }
  }
  return 'Normal Layout';
}

function rollLoot(layer) {
  const treasure = pickTreasureType(layer);
  if (treasure !== 'Normal Layout') {
    const chest = CHEST_TYPES.find((c) => c.key === treasure);
    if (chest) {
      return {
        items: [{ item: ITEMS_BY_ID[chest.id], amount: 1 }],
        xp: randomInRange(chest.xp),
        thumbnailEmoji: chest.emoji,
      };
    }
  }

  const items = [{ item: ITEMS_BY_ID.ITDirt, amount: 1 }];
  let xp = randomInRange([1, 3]);
  for (const entry of DROP_TABLE) {
    if (Math.random() <= entry.chance) {
      const item = ITEMS_BY_ID[entry.id];
      if (item) {
        items.push({ item, amount: 1 });
        xp += randomInRange(entry.xp);
      }
    }
  }

  return { items, xp, thumbnailEmoji: LAYER_EMOJI };
}

function buildHomeMessage() {
  const container = {
    type: 17,
    accent_color: DIG_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: '## Digging\n-# Press DIG to start digging...',
          },
        ],
        accessory: {
          type: 11,
          media: { url: DIG_THUMBNAIL },
        },
      },
      { type: 14 },
      {
        type: 1,
        components: [
          { type: 2, style: 4, custom_id: `${DIG_BUTTON_PREFIX}start`, label: 'DIG' },
          { type: 2, style: 2, custom_id: `${DIG_BUTTON_PREFIX}stats`, label: 'Dig Stat' },
          { type: 2, style: 2, custom_id: `${DIG_BUTTON_PREFIX}equipment`, label: 'Equipment' },
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
      { type: 2, style: 4, custom_id: `${DIG_BUTTON_PREFIX}start`, label: 'DIG' },
      { type: 2, style: 2, custom_id: `${DIG_BUTTON_PREFIX}stats`, label: 'Dig Stat' },
      { type: 2, style: 2, custom_id: `${DIG_BUTTON_PREFIX}equipment`, label: 'Equipment' },
    ];
  }

  return [
    { type: 2, style: 2, custom_id: `${DIG_BUTTON_PREFIX}home`, label: 'Back' },
    { type: 2, style: view === 'stats' ? 4 : 2, custom_id: `${DIG_BUTTON_PREFIX}stats`, label: 'Dig Stat', disabled: view === 'stats' },
    {
      type: 2,
      style: view === 'equipment' ? 4 : 2,
      custom_id: `${DIG_BUTTON_PREFIX}equipment`,
      label: 'Equipment',
      disabled: view === 'equipment',
    },
  ];
}

function buildStatsMessage(digProfile) {
  const { level, xp, next_level_xp: nextLevel, upgrade_tokens: tokens } = digProfile;
  const progressBar = formatProgressBar(xp, nextLevel);
  const percent = Math.min(100, Math.max(0, (xp / Math.max(nextLevel, 1)) * 100));
  const container = {
    type: 17,
    accent_color: DIG_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Dig Stat\n### Dig Level: ${level}\n-# ${progressBar} \`${xp} / ${nextLevel} - ${percent.toFixed(2)}%\`\n* Dig Upgrade Tokens: ${tokens}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: DIG_THUMBNAIL },
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

function itemSupportsDigActivity(item) {
  return (item?.activityTags ?? []).some((tag) => typeof tag === 'string' && tag.toLowerCase() === 'dig');
}

function gearSupportsDig(item) {
  return itemSupportsDigActivity(item);
}

function getEquippedDigGear(profile) {
  const equipped = profile.gear_equipped;
  if (gearSupportsDig(equipped)) {
    return equipped;
  }
  return null;
}

function buildGearPlaceholder(profile) {
  const gear = getEquippedDigGear(profile);
  if (!gear) {
    return `${FIST_GEAR.emoji} ${FIST_GEAR.name}`;
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
  const equippedName = getEquippedDigGear(profile)?.name ?? null;
  const options = [
    {
      label: FIST_GEAR.name,
      value: FIST_GEAR.name,
      default: equippedName === null || equippedName === FIST_GEAR.name,
    },
  ];

  const fistEmoji = normalizeEmojiForComponent(FIST_GEAR.emoji);
  if (fistEmoji) {
    options[0].emoji = fistEmoji;
  }

  const digGear = (profile.gear_inventory ?? []).filter(
    (item) => itemSupportsDigActivity(item) && (item.amount === undefined || item.amount > 0)
  );
  for (const item of digGear) {
    const name = item?.name ?? 'Gear';
    const option = {
      label: name,
      value: name,
      default: equippedName === name,
    };

    const emoji = normalizeEmojiForComponent(item?.emoji);
    if (emoji) {
      option.emoji = emoji;
    }

    options.push(option);
  }

  return options;
}

function buildMiscOptions(profile) {
  const miscItems = (profile.misc_inventory ?? []).filter(
    (item) => itemSupportsDigActivity(item) && (item.amount === undefined || item.amount > 0)
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
  const gear = getEquippedDigGear(profile) ?? { name: FIST_GEAR.name, emoji: FIST_GEAR.emoji };
  const misc = profile.misc_equipped ?? { name: 'None', emoji: '—' };
  const infoContainer = {
    type: 17,
    accent_color: DIG_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Dig Equipment\n### * Gear equipped: ${gear.name} ${gear.emoji ?? ''}\n### * Misc equipped: ${misc.name} ${misc.emoji ?? ''}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: DIG_THUMBNAIL },
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
            content: '### Selection Panel\n- Choose gear and misc options below to update your digging loadout.',
          },
        ],
        accessory: {
          type: 11,
          media: { url: DIG_THUMBNAIL },
        },
      },
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${DIG_SELECT_PREFIX}gear:${userId}`,
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
            custom_id: `${DIG_SELECT_PREFIX}misc:${userId}`,
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
    accent_color: DIG_ACCENT_COLOR,
    components: [
      {
        type: 9,
        components: [{ type: 10, content: 'You are going for a dig...' }],
        accessory: {
          type: 11,
          media: { url: DIG_LAYER_THUMBNAIL },
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
      layerImageUrl: DIG_LAYER_THUMBNAIL,
      items: (lootForThumbnail?.items ?? []).map((entry) => entry.item).filter(Boolean),
    });
    session.thumbnailAttachmentLayer = session.layer;
  }
  const thumbnailAttachment = session.thumbnailAttachment;
  const mediaUrl = thumbnailAttachment ? `attachment://${thumbnailAttachment.name}` : DIG_LAYER_THUMBNAIL;

  const messageLines = [
    `## You are digging - Layer ${layer}`,
    `-# ${progressBar} - ${health}`,
    `-# Reset ${countdown}`,
  ];

  if (loot?.items?.length) {
    messageLines.push(`-# You earned these item from layer ${layer - 1}:`);
    for (const entry of loot.items) {
      const emoji = entry.item?.emoji ? `${entry.item.emoji} ` : '';
      messageLines.push(`-# ${emoji}${entry.item?.name ?? 'Unknown'} x${entry.amount}`);
    }
  }

  const container = {
    type: 17,
    accent_color: DIG_ACCENT_COLOR,
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
          { type: 2, style: 3, custom_id: `${DIG_BUTTON_PREFIX}swing`, label: 'DIG' },
          { type: 2, style: 2, custom_id: `${DIG_BUTTON_PREFIX}stop`, label: 'Stop dig' },
          { type: 2, style: 2, custom_id: `${DIG_BUTTON_PREFIX}misc`, label: 'Use Misc', disabled: true },
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
  const session = activeDigs.get(userId);
  if (!session) return;
  clearTimeout(session.inactivityTimer);
  activeDigs.delete(userId);
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
  }, DIG_INACTIVITY_MS);
}

async function startDigging(interaction) {
  const userId = interaction.user.id;
  const existingSession = activeDigs.get(userId);
  if (existingSession && Date.now() < existingSession.expiresAt) {
    await safeErrorReply(
      interaction,
      'You already have an active dig. Please finish it or wait for it to end before starting another.'
    );
    return;
  }

  if (existingSession && Date.now() >= existingSession.expiresAt) {
    endSession(userId);
  }

  const now = Date.now();
  const session = {
    userId,
    channelId: interaction.channelId,
    messageId: interaction.message?.id,
    layer: 0,
    health: getLayerHealth(0),
    maxHealth: getLayerHealth(0),
    startedAt: now,
    expiresAt: now + DIG_DURATION_MS,
    loot: null,
    pendingLoot: rollLoot(0),
    thumbnailAttachment: null,
    thumbnailAttachmentLayer: null,
    inactivityTimer: null,
  };

  activeDigs.set(userId, session);
  await interaction.update(buildStartingMessage());

  setTimeout(async () => {
    const current = activeDigs.get(userId);
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
  const session = activeDigs.get(userId);
  if (!session) {
    await interaction.update(buildHomeMessage());
    return true;
  }

  if (Date.now() >= session.expiresAt) {
    endSession(userId);
    await interaction.update(buildHomeMessage());
    return true;
  }

  const damage = randomInRange([2, 5]);
  session.health = Math.max(0, session.health - damage);

  if (session.health <= 0) {
    const loot = session.pendingLoot ?? rollLoot(session.layer);
    session.layer += 1;
    session.maxHealth = getLayerHealth(session.layer);
    session.health = session.maxHealth;
    session.loot = loot;
    session.pendingLoot = rollLoot(session.layer);

    const profile = getUserProfile(userId);
    for (const entry of loot.items) {
      if (entry.item) {
        addItemToInventory(profile, entry.item, entry.amount);
      }
    }
    updateUserProfile(userId, profile);

    const digProfile = addDigXp(userId, loot.xp);
    const digToken = ITEMS_BY_ID.ITDigUpgradeToken;
    if (digToken) {
      const refreshedProfile = getUserProfile(userId);
      setInventoryItemAmount(refreshedProfile, digToken, digProfile.upgrade_tokens);
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
  const digProfile = getUserDigProfile(interaction.user.id);
  const huntProfile = getUserProfile(interaction.user.id);
  if (target === 'stats') {
    await interaction.update(buildStatsMessage(digProfile));
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
    if (value === FIST_GEAR.name) {
      profile.gear_equipped = null;
      return profile;
    }

    const selected = (profile.gear_inventory ?? []).find(
      (item) =>
        item?.name === value && itemSupportsDigActivity(item) && (item.amount === undefined || item.amount > 0)
    );
    if (selected) {
      const normalized = normalizeGearItem(selected);
      profile.gear_equipped = normalized;
    }
    return profile;
  }

  if (type === 'misc') {
    const selected = (profile.misc_inventory ?? []).find(
      (item) => item?.name === value && itemSupportsDigActivity(item) && (item.amount === undefined || item.amount > 0)
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
    await interaction.reply({ content: "This isn't your dig session.", ephemeral: true });
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
  data: new SlashCommandBuilder().setName('dig').setDescription('Start digging for treasure.'),
  async execute(interaction) {
    try {
      const response = buildHomeMessage();
      await interaction.reply({ ...response, fetchReply: true });
    } catch (error) {
      await safeErrorReply(interaction, 'Unable to start digging right now.');
    }
  },
  async handleComponent(interaction) {
    const isDigButton = interaction.isButton() && interaction.customId.startsWith(DIG_BUTTON_PREFIX);
    const isDigSelect = interaction.isStringSelectMenu() && interaction.customId.startsWith(DIG_SELECT_PREFIX);
    if (!isDigButton && !isDigSelect) {
      return false;
    }

    const customParts = interaction.customId.split(':');
    const ownerFromCustomId = customParts[customParts.length - 1];
    const ownerId = interaction.message.interaction?.user?.id;

    if (interaction.user.id !== ownerId && interaction.user.id !== ownerFromCustomId) {
      await interaction.reply({ content: "This isn't your dig session.", ephemeral: true });
      return true;
    }

    if (isDigSelect) {
      const [, type, userId] = interaction.customId.split(':');
      return handleSelect(interaction, type, userId);
    }

    const action = interaction.customId.slice(DIG_BUTTON_PREFIX.length);
    if (action === 'start') {
      await startDigging(interaction);
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
