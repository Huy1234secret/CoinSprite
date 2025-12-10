const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const { createHuntBattleImage } = require('../src/huntImage');

const HUNT_BUTTON_PREFIX = 'hunt:';
const HUNT_SELECT_PREFIX = 'hunt-select:';
const HUNT_THUMBNAIL = 'https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless';
const HEART_EMOJI = '<:SBHeart:1447532986378485882>';
const DEFENSE_EMOJI = '<:SBDefense:1447532983933472900>';

const HUNT_DATA_FILE = path.join(__dirname, '..', 'data', 'hunt_profiles.json');
const DEFAULT_PROFILE = {
  level: 1,
  xp: 0,
  next_level_xp: 100,
  health: 100,
  defense: 0,
  gear_equipped: null,
  misc_equipped: null,
  gear_inventory: [],
  misc_inventory: [],
};

function loadProfiles() {
  if (!fs.existsSync(HUNT_DATA_FILE)) {
    return {};
  }

  try {
    const raw = fs.readFileSync(HUNT_DATA_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return typeof data === 'object' && data !== null ? data : {};
  } catch (error) {
    console.warn('Failed to read hunt profiles; starting fresh.', error);
    return {};
  }
}

function saveProfiles(profiles) {
  const safeProfiles = typeof profiles === 'object' && profiles !== null ? profiles : {};
  fs.mkdirSync(path.dirname(HUNT_DATA_FILE), { recursive: true });
  fs.writeFileSync(HUNT_DATA_FILE, JSON.stringify(safeProfiles));
}

function ensureProfileShape(profile = {}) {
  return {
    ...DEFAULT_PROFILE,
    ...profile,
    gear_inventory: Array.isArray(profile.gear_inventory) ? profile.gear_inventory : [],
    misc_inventory: Array.isArray(profile.misc_inventory) ? profile.misc_inventory : [],
  };
}

function getUserProfile(userId) {
  const profiles = loadProfiles();
  const userKey = String(userId);
  const existing = ensureProfileShape(profiles[userKey]);
  profiles[userKey] = existing;
  saveProfiles(profiles);
  return existing;
}

function updateUserProfile(userId, profile) {
  const profiles = loadProfiles();
  profiles[String(userId)] = ensureProfileShape(profile);
  saveProfiles(profiles);
}

function buildProgressBar(current, total, width = 20) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function userHasHuntingTools(profile) {
  return Boolean((profile.gear_inventory ?? []).length || (profile.misc_inventory ?? []).length);
}

function buildNavigationRow({
  userId,
  view,
}) {
  if (view === 'home') {
    return {
      type: 1,
      components: [
        {
          type: 2,
          style: 4,
          custom_id: `${HUNT_BUTTON_PREFIX}start:${userId}`,
          label: 'HUNT',
        },
        {
          type: 2,
          style: 2,
          custom_id: `${HUNT_BUTTON_PREFIX}stats:${userId}`,
          label: 'Hunt Stat',
        },
        {
          type: 2,
          style: 2,
          custom_id: `${HUNT_BUTTON_PREFIX}equipment:${userId}`,
          label: 'Equipment',
        },
      ],
    };
  }

  if (view === 'stats') {
    return {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          custom_id: `${HUNT_BUTTON_PREFIX}home:${userId}`,
          label: 'Back',
        },
        {
          type: 2,
          style: 4,
          custom_id: `${HUNT_BUTTON_PREFIX}stats:${userId}`,
          label: 'Hunt Stat',
          disabled: true,
        },
        {
          type: 2,
          style: 2,
          custom_id: `${HUNT_BUTTON_PREFIX}equipment:${userId}`,
          label: 'Equipment',
        },
      ],
    };
  }

  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        custom_id: `${HUNT_BUTTON_PREFIX}home:${userId}`,
        label: 'Back',
      },
      {
        type: 2,
        style: 2,
        custom_id: `${HUNT_BUTTON_PREFIX}stats:${userId}`,
        label: 'Hunt Stat',
      },
      {
        type: 2,
        style: 4,
        custom_id: `${HUNT_BUTTON_PREFIX}equipment:${userId}`,
        label: 'Equipment',
        disabled: true,
      },
    ],
  };
}

function buildHomeContainer(profile, userId) {
  const message = userHasHuntingTools(profile)
    ? 'Press **HUNT** button to start hunting.'
    : "You don't have any HUNTING tool...";

  return {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Hunting\n-# ${message}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: HUNT_THUMBNAIL },
          description: 'Hunt icon',
        },
      },
      { type: 14 },
      buildNavigationRow({ userId, view: 'home' }),
    ],
  };
}

function buildStatsContainer(profile, userId) {
  const { level, xp, next_level_xp: nextLevel, health, defense } = profile;
  const progressBar = buildProgressBar(xp, nextLevel);
  const percent = Math.min(100, Math.max(0, (xp / Math.max(nextLevel, 1)) * 100));

  return {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Hunting Stat\n### Hunt Level: ${level}\n-# ${progressBar} \`${xp} / ${nextLevel} - ${percent.toFixed(2)}%\`\n* User Health: ${health} ${HEART_EMOJI}\n* User Defense: ${defense} ${DEFENSE_EMOJI}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: HUNT_THUMBNAIL },
          description: 'Hunt stats icon',
        },
      },
      { type: 14 },
      buildNavigationRow({ userId, view: 'stats' }),
    ],
  };
}

function gearPlaceholder(profile) {
  if (!(profile.gear_inventory ?? []).length) {
    return "You don't have any Gear";
  }
  if (!profile.gear_equipped) {
    return 'No Gear equipped';
  }
  const { name, emoji } = profile.gear_equipped;
  return `${name ?? 'Gear'} ${emoji ?? ''}`.trim();
}

function miscPlaceholder(profile) {
  if (!(profile.misc_inventory ?? []).length) {
    return "You don't have any Misc";
  }
  if (!profile.misc_equipped) {
    return 'No Misc equipped';
  }
  const { name, emoji } = profile.misc_equipped;
  return `${name ?? 'Misc'} ${emoji ?? ''}`.trim();
}

function buildSelectOptions(items, equippedName) {
  const options = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const name = item.name ?? 'Item';
    options.push({
      label: name,
      value: name,
      emoji: item.emoji,
      default: equippedName ? equippedName === name : undefined,
    });
  }

  if (!options.length) {
    options.push({ label: 'No items available', value: 'none', default: true });
  }

  return options;
}

function buildEquipmentContainers(profile, userId) {
  const gearName = profile.gear_equipped?.name ?? 'None';
  const gearEmoji = profile.gear_equipped?.emoji ?? '';
  const miscName = profile.misc_equipped?.name ?? 'None';
  const miscEmoji = profile.misc_equipped?.emoji ?? '';

  const infoContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Hunting Equipment\n### * Gear equipped: ${gearName} ${gearEmoji}\n### * Misc equipped: ${miscName} ${miscEmoji}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: HUNT_THUMBNAIL },
          description: 'Equipment icon',
        },
      },
      { type: 14 },
      buildNavigationRow({ userId, view: 'equipment' }),
    ],
  };

  const selectionContainer = {
    type: 17,
    accent_color: 0x000000,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${HUNT_SELECT_PREFIX}gear:${userId}`,
            placeholder: gearPlaceholder(profile),
            options: buildSelectOptions(profile.gear_inventory ?? [], profile.gear_equipped?.name),
            disabled: !(profile.gear_inventory ?? []).length,
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
            custom_id: `${HUNT_SELECT_PREFIX}misc:${userId}`,
            placeholder: miscPlaceholder(profile),
            options: buildSelectOptions(profile.misc_inventory ?? [], profile.misc_equipped?.name),
            disabled: !(profile.misc_inventory ?? []).length,
            min_values: 1,
            max_values: 1,
          },
        ],
      },
    ],
  };

  return [infoContainer, selectionContainer];
}

function buildHomeContent(profile, userId) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [buildHomeContainer(profile, userId)],
  };
}

function buildStatsContent(profile, userId) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [buildStatsContainer(profile, userId)],
  };
}

function buildEquipmentContent(profile, userId) {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: buildEquipmentContainers(profile, userId),
  };
}

async function handleStartHunt(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const profile = getUserProfile(interaction.user.id);
  const playerName = interaction.user.globalName ?? interaction.user.username;
  const playerAvatar = interaction.user.displayAvatarURL({ extension: 'png', size: 256 });

  const enemies = [
    {
      label: 'Goblin Raider',
      level: Math.max(1, profile.level - 1),
      health: 75,
      maxHealth: 90,
      shield: 0,
      accentColor: '#f35b5b',
    },
    {
      label: 'Forest Wisp',
      level: profile.level,
      health: 60,
      maxHealth: 80,
      shield: 1,
      accentColor: '#8be9fd',
    },
    {
      label: 'Stone Guardian',
      level: profile.level + 1,
      health: 120,
      maxHealth: 140,
      shield: 2,
      accentColor: '#f9c74f',
    },
  ].slice(0, Math.max(1, Math.min(5, profile.level % 5 || 3)));

  const player = {
    name: playerName,
    avatar: playerAvatar,
    level: profile.level,
    maxHealth: profile.health,
    health: profile.health,
    defense: profile.defense,
    shield: profile.defense,
    team: [
      { label: 'Pet', level: profile.level, health: 85, accentColor: '#7b8ab8' },
      { label: 'Companion', level: profile.level - 1, health: 70, accentColor: '#89f0d0' },
      { label: 'Support', level: profile.level, health: 90, accentColor: '#f78c6c' },
    ],
  };

  const buffer = await createHuntBattleImage({ player, enemies });
  const attachment = new AttachmentBuilder(buffer, { name: 'hunt-battle.png' });

  await interaction.editReply({
    content: 'Your hunt is ready. Here is your battle preview!',
    files: [attachment],
  });
}

async function handleNavigation(interaction, action, userId) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const profile = getUserProfile(userId);

  if (action === 'home') {
    await interaction.update(buildHomeContent(profile, userId));
    return true;
  }

  if (action === 'stats') {
    await interaction.update(buildStatsContent(profile, userId));
    return true;
  }

  if (action === 'equipment') {
    await interaction.update(buildEquipmentContent(profile, userId));
    return true;
  }

  if (action === 'start') {
    await handleStartHunt(interaction);
    return true;
  }

  await safeErrorReply(interaction, 'Unknown hunting action.');
  return true;
}

function applySelection(profile, type, value) {
  if (!value || value === 'none') {
    return profile;
  }

  const key = type === 'gear' ? 'gear_inventory' : 'misc_inventory';
  const equippedKey = type === 'gear' ? 'gear_equipped' : 'misc_equipped';
  const list = profile[key] ?? [];
  const selectedItem = list.find((item) => item && item.name === value);

  if (selectedItem) {
    profile[equippedKey] = selectedItem;
  }

  return profile;
}

async function handleSelect(interaction, selectType, userId) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const profile = getUserProfile(userId);
  const selectedValue = interaction.values?.[0];
  applySelection(profile, selectType, selectedValue);
  updateUserProfile(userId, profile);

  await interaction.update(buildEquipmentContent(profile, userId));
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hunt')
    .setDescription("Open the hunting menu using Discord's components v2."),

  async execute(interaction) {
    const profile = getUserProfile(interaction.user.id);
    const content = buildHomeContent(profile, interaction.user.id);
    await interaction.reply(content);
  },

  async handleComponent(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith(HUNT_BUTTON_PREFIX)) {
      const [, action, userId] = interaction.customId.split(':');
      return handleNavigation(interaction, action, userId);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(HUNT_SELECT_PREFIX)) {
      const [, type, userId] = interaction.customId.split(':');
      return handleSelect(interaction, type, userId);
    }

    return false;
  }
};
