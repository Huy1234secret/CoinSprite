const { AttachmentBuilder, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const { createHuntBattleImage } = require('../src/huntImage');
const {
  DEFAULT_PROFILE,
  FIST_GEAR,
  KNOWN_GEAR,
  UPGRADE_TOKEN_ITEM,
  ITEMS_BY_ID,
  calculatePlayerMaxHealth,
  calculateNextLevelXp,
  addItemToInventory,
  getUserProfile,
  normalizeGearItem,
  updateUserProfile,
} = require('../src/huntProfile');
const { addCoinsToUser, addDiamondsToUser, addPrismaticToUser } = require('../src/userStats');
const {
  CREATURES,
  JUNGLE_BETTLE,
  MOSSBACK_MONKEY,
  VINE_SNAKE,
  THORNBACK_BOAR,
  LEAF_FROG,
  CLAWFOOT_BIRD,
  BRISTLE_JAGUAR,
  SPOREBACK_TORTOISE,
  RAZORWING_PARROT,
  MUDSCALE_LIZARD,
  ROOTED_APE,
  THUNDERFANG_PANTHER,
  BLOOM_SERPENT,
  EMERALD_STALKER,
  TOTEM_GUARDIAN,
  ANCIENT_HORNED_GORILLA,
  STORM_CANOPY_EAGLE,
  VINE_TITAN,
  SOLAR_JAGUAR,
  PHANTOM_ORCHID_WARDEN,
} = require('../src/creatures');
const { DUNGEONS, DUNGEON_DIFFICULTY_EMOJI, getDungeonStage } = require('../src/dungeons');
const { getUserDungeonProfile, updateUserDungeonProfile } = require('../src/dungeonProfile');
const {
  addPetToInventory,
  addXpToEquippedPets,
  buildBattlePets,
  findPetInstance,
  getUserPetProfile,
  updateUserPetProfile,
} = require('../src/pets');

const HUNT_BUTTON_PREFIX = 'hunt:';
const HUNT_SELECT_PREFIX = 'hunt-select:';
const HUNT_ATTACK_SELECT_PREFIX = 'hunt-attack:';
const DUNGEON_BUTTON_PREFIX = 'dungeon:';
const DUNGEON_SELECT_PREFIX = 'dungeon-select:';
const DUNGEON_ATTACK_SELECT_PREFIX = 'dungeon-attack:';
const TEAM_SLOT_SELECT_PREFIX = 'hunt-team-slot:';
const TEAM_PET_SELECT_PREFIX = 'hunt-team-pet:';
const TEAM_TARGET_SELECT_PREFIX = 'hunt-team-target:';
const TEAM_SUBMIT_PREFIX = 'hunt-team-submit:';
const TEAM_UNEQUIP_PREFIX = 'hunt-team-unequip:';
const HUNT_THUMBNAIL = 'https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless';
const DUNGEON_THUMBNAIL_EMOJI = '<:SBDUNGEON1:1451548437039550636>';
const HEART_EMOJI = '<:SBHeart:1447532986378485882>';
const DEFENSE_EMOJI = '<:SBDefense:1447532983933472900>';
const COIN_EMOJI = '<:CRCoin:1447459216574124074>';
const DIAMOND_EMOJI = '<:CRDiamond:1449260848705962005>';
const PRISMATIC_EMOJI = '<:CRPrismatic:1449260850945982606>';
const UPGRADE_TOKEN_EMOJI = '<:ITUpgradeToken:1447502158059540481>';

const CREATURE_HEALTH_GROWTH = 0.5;
const CREATURE_DAMAGE_GROWTH = 0.35;
const CREATURE_REWARD_GROWTH = 0.25;

const HUNTING_DELAY_MS = 3000;
const HUNT_END_COUNTDOWN_SECONDS = 5;
const HUNT_INACTIVITY_TIMEOUT_MS = 30 * 1000;
const DUNGEON_FLOOR_TIMEOUT_MS = 2 * 60 * 1000;
const DUNGEON_FLOOR_TRANSITION_SECONDS = 5;
const CRIT_CHANCE = 0.15;
const ACTIONS_PER_TURN = 2;
const POISON_STATUS = { type: 'Poison', name: 'Poison', emoji: '<:SBPoison:1450756566587543614>' };
const DEFENSE_STATUS = { type: 'Defense', name: 'Defense', emoji: DEFENSE_EMOJI };
const ACTION_LOCK_STATUS = { type: 'ActionLock', name: 'Root Trap', emoji: '⛓️' };
const PET_STUN_STATUS = { type: 'PetStun', name: 'Pet Stun', emoji: '💫' };
const CREATURE_RARITY_ORDER = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythical', 'Secret'];
const CREATURE_RARITY_WEIGHTS = {
  Common: 60,
  Rare: 25,
  Epic: 10,
  Legendary: 4,
  Mythical: 0.7,
  Secret: 0.3,
};
const CREATURE_WEIGHT_BY_RARITY = {
  Common: [
    { creature: MOSSBACK_MONKEY, weight: 24 },
    { creature: VINE_SNAKE, weight: 18 },
    { creature: THORNBACK_BOAR, weight: 12 },
    { creature: JUNGLE_BETTLE, weight: 10 },
    { creature: LEAF_FROG, weight: 20 },
    { creature: CLAWFOOT_BIRD, weight: 16 },
  ],
  Rare: [
    { creature: BRISTLE_JAGUAR, weight: 22 },
    { creature: SPOREBACK_TORTOISE, weight: 22 },
    { creature: RAZORWING_PARROT, weight: 18 },
    { creature: MUDSCALE_LIZARD, weight: 18 },
    { creature: ROOTED_APE, weight: 20 },
  ],
  Epic: [
    { creature: THUNDERFANG_PANTHER, weight: 28 },
    { creature: BLOOM_SERPENT, weight: 20 },
    { creature: EMERALD_STALKER, weight: 22 },
    { creature: TOTEM_GUARDIAN, weight: 30 },
  ],
  Legendary: [
    { creature: ANCIENT_HORNED_GORILLA, weight: 35 },
    { creature: STORM_CANOPY_EAGLE, weight: 30 },
    { creature: VINE_TITAN, weight: 35 },
  ],
  Mythical: [{ creature: SOLAR_JAGUAR, weight: 100 }],
  Secret: [{ creature: PHANTOM_ORCHID_WARDEN, weight: 100 }],
};

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const activeHunts = new Map();
const activeDungeons = new Map();
const teamEditState = new Map();

function findItemById(itemId) {
  return ITEMS_BY_ID[itemId] ?? null;
}

function maybeGrantOwnerPet(interaction) {
  if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
    return null;
  }

  const petProfile = getUserPetProfile(interaction.user.id);
  const alreadyHas = (petProfile.inventory ?? []).some((pet) => pet.id === 'PETUFO');
  if (alreadyHas) {
    return petProfile;
  }

  return addPetToInventory(interaction.user.id, 'PETUFO');
}

function scaleStatForLevel(base, level, growth = 0.5) {
  return Math.ceil(base * Math.pow(1 + growth, Math.max(0, level - 1)));
}

function pickCreatureLevel(distribution) {
  const roll = Math.random();
  let cumulative = 0;
  for (const entry of distribution) {
    cumulative += entry.chance;
    if (roll <= cumulative) {
      return entry.level;
    }
  }
  return distribution[distribution.length - 1]?.level ?? 1;
}

function pickWeightedEntry(entries = []) {
  if (!entries.length) {
    return null;
  }
  const total = entries.reduce((sum, entry) => sum + (Number(entry.weight) || 0), 0);
  if (total <= 0) {
    return entries[0];
  }
  const roll = Math.random() * total;
  let cumulative = 0;
  for (const entry of entries) {
    cumulative += Number(entry.weight) || 0;
    if (roll <= cumulative) {
      return entry;
    }
  }
  return entries[entries.length - 1];
}

function getMaxCreatureRarity(huntLevel) {
  const level = Math.max(0, Math.floor(Number(huntLevel) || 0));
  if (level >= 51) {
    return 'Secret';
  }
  if (level >= 31) {
    return 'Legendary';
  }
  if (level >= 16) {
    return 'Epic';
  }
  return 'Rare';
}

function getCreatureLevelDistribution(huntLevel) {
  const level = Math.max(0, Math.floor(Number(huntLevel) || 0));
  if (level >= 80) {
    return [
      { level: 1, chance: 0.24 },
      { level: 2, chance: 0.17 },
      { level: 3, chance: 0.15 },
      { level: 4, chance: 0.13 },
      { level: 5, chance: 0.1 },
      { level: 6, chance: 0.08 },
      { level: 7, chance: 0.06 },
      { level: 8, chance: 0.04 },
      { level: 9, chance: 0.02 },
      { level: 10, chance: 0.007 },
      { level: 11, chance: 0.0025 },
      { level: 12, chance: 0.0005 },
    ];
  }
  if (level >= 51) {
    return [
      { level: 1, chance: 0.31 },
      { level: 2, chance: 0.25 },
      { level: 3, chance: 0.18 },
      { level: 4, chance: 0.12 },
      { level: 5, chance: 0.08 },
      { level: 6, chance: 0.034 },
      { level: 7, chance: 0.018 },
      { level: 8, chance: 0.007 },
      { level: 9, chance: 0.001 },
    ];
  }
  if (level >= 36) {
    return [
      { level: 1, chance: 0.35 },
      { level: 2, chance: 0.25 },
      { level: 3, chance: 0.17 },
      { level: 4, chance: 0.13 },
      { level: 5, chance: 0.07 },
      { level: 6, chance: 0.025 },
      { level: 7, chance: 0.005 },
    ];
  }
  if (level >= 21) {
    return [
      { level: 1, chance: 0.5 },
      { level: 2, chance: 0.3 },
      { level: 3, chance: 0.12 },
      { level: 4, chance: 0.07 },
      { level: 5, chance: 0.01 },
    ];
  }
  if (level >= 11) {
    return [
      { level: 1, chance: 0.6 },
      { level: 2, chance: 0.35 },
      { level: 3, chance: 0.05 },
    ];
  }
  return [{ level: 1, chance: 1 }];
}
function scaleDamageRange(range, level) {
  const min = scaleStatForLevel(range?.min ?? 1, level, CREATURE_DAMAGE_GROWTH);
  const max = scaleStatForLevel(range?.max ?? min, level, CREATURE_DAMAGE_GROWTH);
  return { min, max };
}

function prepareActionsForLevel(actions = [], level) {
  return actions.map((action) => ({
    ...action,
    damage: scaleDamageRange(action.damage ?? { min: 1, max: 1 }, level),
    damageIfPoisoned: action.damageIfPoisoned
      ? scaleDamageRange(action.damageIfPoisoned, level)
      : null,
  }));
}

function pickCreatureDefinition(huntLevel = 0) {
  if (!Array.isArray(CREATURES) || CREATURES.length === 0) {
    return JUNGLE_BETTLE;
  }

  const maxRarity = getMaxCreatureRarity(huntLevel);
  const maxIndex = CREATURE_RARITY_ORDER.indexOf(maxRarity);
  const allowedRarities =
    maxIndex >= 0 ? CREATURE_RARITY_ORDER.slice(0, maxIndex + 1) : CREATURE_RARITY_ORDER;
  const rarityEntries = allowedRarities
    .map((rarity) => ({
      rarity,
      weight: CREATURE_RARITY_WEIGHTS[rarity] ?? 0,
      creatures: CREATURE_WEIGHT_BY_RARITY[rarity] ?? [],
    }))
    .filter((entry) => entry.weight > 0 && entry.creatures.length);

  const chosenRarity = pickWeightedEntry(rarityEntries)?.rarity ?? 'Common';
  const creatureEntry = pickWeightedEntry(CREATURE_WEIGHT_BY_RARITY[chosenRarity] ?? []);
  return creatureEntry?.creature ?? CREATURES[0] ?? JUNGLE_BETTLE;
}

function createCreatureInstance(definition = JUNGLE_BETTLE, huntLevel = 0) {
  const level = pickCreatureLevel(getCreatureLevelDistribution(huntLevel));
  const health = scaleStatForLevel(definition.baseHealth ?? 1, level, CREATURE_HEALTH_GROWTH);

  const baseDamage = definition.damage
    ? scaleDamageRange(definition.damage, level)
    : { min: 1, max: 1 };

  const actions = prepareActionsForLevel(definition.actions ?? [], level);

  const statuses = Array.isArray(definition.statuses) ? [...definition.statuses] : [];
  if (Number.isFinite(definition.defense) && definition.defense > 0) {
    statuses.push({ ...DEFENSE_STATUS, percent: definition.defense, remaining: Infinity });
  }

  return {
    id: `${definition.name}-${Date.now()}-${Math.random()}`,
    name: definition.name,
    emoji: definition.emoji,
    rarity: definition.rarity,
    rarityEmoji: definition.rarityEmoji ?? definition.rarityIcon,
    level,
    maxHealth: health,
    health,
    damage: baseDamage,
    attackType: definition.attackType ?? 'Singular',
    actions,
    statuses,
    drops: definition.drops ?? [],
    reward: definition.reward ?? JUNGLE_BETTLE.reward,
  };
}

function createCreatureInstanceAtLevel(definition = JUNGLE_BETTLE, level = 1) {
  const safeLevel = Math.max(1, Math.floor(Number(level) || 1));
  const health = scaleStatForLevel(definition.baseHealth ?? 1, safeLevel, CREATURE_HEALTH_GROWTH);
  const baseDamage = definition.damage
    ? scaleDamageRange(definition.damage, safeLevel)
    : { min: 1, max: 1 };
  const actions = prepareActionsForLevel(definition.actions ?? [], safeLevel);
  const statuses = Array.isArray(definition.statuses) ? [...definition.statuses] : [];
  if (Number.isFinite(definition.defense) && definition.defense > 0) {
    statuses.push({ ...DEFENSE_STATUS, percent: definition.defense, remaining: Infinity });
  }

  return {
    id: `${definition.name}-${Date.now()}-${Math.random()}`,
    name: definition.name,
    emoji: definition.emoji,
    rarity: definition.rarity,
    rarityEmoji: definition.rarityEmoji ?? definition.rarityIcon,
    level: safeLevel,
    maxHealth: health,
    health,
    damage: baseDamage,
    attackType: definition.attackType ?? 'Singular',
    actions,
    statuses,
    drops: definition.drops ?? [],
    reward: definition.reward ?? JUNGLE_BETTLE.reward,
  };
}

function formatCreatureLevel(level) {
  return `Lv${level}`;
}

function selectGear(profile) {
  const equipped = profile.gear_equipped;
  if (equipped && KNOWN_GEAR[equipped.name]) {
    return normalizeGearItem(equipped);
  }
  return { ...FIST_GEAR };
}

function buildProgressBar(current, total, width = 20) {
  const safeTotal = Math.max(total, 1);
  const ratio = Math.max(0, Math.min(1, current / safeTotal));
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(empty)}`;
}

function userHasHuntingTools(profile) {
  return true;
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
        {
          type: 2,
          style: 2,
          custom_id: `${HUNT_BUTTON_PREFIX}team:${userId}`,
          label: 'Team',
        },
      ],
    };
  }

  const views = [
    { key: 'stats', label: 'Hunt Stat' },
    { key: 'equipment', label: 'Equipment' },
    { key: 'team', label: 'Team' },
  ];

  return {
    type: 1,
    components: [
      {
        type: 2,
        style: 2,
        custom_id: `${HUNT_BUTTON_PREFIX}home:${userId}`,
        label: 'Back',
      },
      ...views.map((entry) => ({
        type: 2,
        style: entry.key === view ? 4 : 2,
        custom_id: `${HUNT_BUTTON_PREFIX}${entry.key}:${userId}`,
        label: entry.label,
        disabled: entry.key === view,
      })),
    ],
  };
}

function buildHomeContainer(profile, userId, options = {}) {
  const { message, accentColor = 0xffffff } = options;
  const messageText = message
    ? message
    : userHasHuntingTools(profile)
      ? '-# Press **HUNT** button to start hunting.'
      : "-# You don't have any HUNTING tool...";

  return {
    type: 17,
    accent_color: accentColor,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Hunting\n${messageText}`,
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
  if (!profile.gear_equipped) {
    return 'Select your gear';
  }
  const { name, emoji } = profile.gear_equipped;
  return `${emoji ?? ''} ${name ?? 'Gear'}`.trim();
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

function buildSelectOptions(items, equippedName, includeFist = false) {
  const selectedName = equippedName ?? null;
  const options = [];
  if (includeFist) {
    options.push({
      label: FIST_GEAR.name,
      value: FIST_GEAR.name,
      emoji: FIST_GEAR.emoji,
      default: selectedName === FIST_GEAR.name,
    });
  }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const name = item.name ?? 'Item';
    options.push({
      label: name,
      value: name,
      emoji: item.emoji,
      default: selectedName === name,
    });
  }

  if (!options.length) {
    options.push({ label: 'No items available', value: 'none', default: true });
  }

  return options;
}

function buildEquipmentContainers(profile, userId) {
  const equippedGearName = profile.gear_equipped?.name ?? FIST_GEAR.name;
  const gearName = profile.gear_equipped?.name ?? FIST_GEAR.name;
  const gearEmoji = profile.gear_equipped?.emoji ?? FIST_GEAR.emoji;
  const infoContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Hunting Equipment\n### * Gear equipped: ${gearName} ${gearEmoji}\n### * Misc equipped: Not available yet`,
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
            options: buildSelectOptions(
              profile.gear_inventory ?? [],
              equippedGearName,
              true
            ),
            disabled: false,
            min_values: 1,
            max_values: 1,
          },
        ],
      },
      {
        type: 10,
        content: '-# Misc selection will be available later.',
      },
    ],
  };

  return [infoContainer, selectionContainer];
}

function buildHomeContent(profile, userId, options = {}) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [buildHomeContainer(profile, userId, options)],
  };
}

function buildStatsContent(profile, userId) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [buildStatsContainer(profile, userId)],
  };
}

function buildEquipmentContent(profile, userId) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: buildEquipmentContainers(profile, userId),
  };
}

function getDungeonThumbnail() {
  return getEmojiUrl(DUNGEON_THUMBNAIL_EMOJI) ?? HUNT_THUMBNAIL;
}

function getDungeonStageKey(dungeonLevel, stage) {
  return `${dungeonLevel}-${stage}`;
}

function getDungeonStageSelection(profile, dungeonLevel) {
  const selected =
    profile.currentStageByDungeon?.[String(dungeonLevel)] ?? 1;
  const dungeon = DUNGEONS[dungeonLevel];
  if (!dungeon?.stages?.[selected]) {
    return 1;
  }
  return selected;
}

function buildDungeonRequirementLines(stageData) {
  const requirement = stageData?.requirement;
  if (!requirement) {
    return '- None';
  }

  const item = findItemById(requirement.itemId);
  const label = item ? `${item.name} ${item.emoji ?? ''}`.trim() : requirement.itemId;
  return `- x${requirement.amount ?? 1} ${label}`.trim();
}

function buildDungeonStageSelect(dungeonProfile, dungeonLevel, currentStage, userId) {
  const completedStages =
    dungeonProfile.completedStagesByDungeon?.[String(dungeonLevel)] ?? [];

  if (!completedStages.length) {
    return {
      type: 3,
      custom_id: `${DUNGEON_SELECT_PREFIX}${dungeonLevel}:${userId}`,
      placeholder: 'locked',
      options: [{ label: 'Locked', value: 'locked', default: true }],
      disabled: true,
      min_values: 1,
      max_values: 1,
    };
  }

  const options = completedStages
    .slice()
    .sort((a, b) => a - b)
    .map((stage) => ({
      label: `Stage ${stage}`,
      value: String(stage),
      default: Number(stage) === Number(currentStage),
    }));

  return {
    type: 3,
    custom_id: `${DUNGEON_SELECT_PREFIX}${dungeonLevel}:${userId}`,
    placeholder: 'Change stage',
    options,
    disabled: false,
    min_values: 1,
    max_values: 1,
  };
}

function buildDungeonHomeContainer(userId, dungeonProfile, dungeonLevel = 1) {
  const dungeon = DUNGEONS[dungeonLevel];
  const stage = getDungeonStageSelection(dungeonProfile, dungeonLevel);
  const stageData = getDungeonStage(dungeonLevel, stage);
  const completedStages =
    dungeonProfile.completedStagesByDungeon?.[String(dungeonLevel)] ?? [];
  const completedCount = completedStages.length;
  const totalStages = Object.keys(dungeon?.stages ?? {}).length;
  const requirementLines = stageData ? buildDungeonRequirementLines(stageData) : '- None';

  return {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 9,
        components: [
          {
            type: 10,
            content: `## Dungeon ${dungeonLevel} - Stage ${stage}\n-# You have completed ${completedCount} / ${totalStages}`,
          },
        ],
        accessory: {
          type: 11,
          media: { url: getDungeonThumbnail() },
          description: 'Dungeon icon',
        },
      },
      { type: 14 },
      {
        type: 10,
        content: `Requirement:\n${requirementLines}`,
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            custom_id: `${DUNGEON_BUTTON_PREFIX}start:${userId}:${dungeonLevel}`,
            label: 'Start Dungeon',
          },
          {
            type: 2,
            style: 2,
            custom_id: `${DUNGEON_BUTTON_PREFIX}info:${userId}:${dungeonLevel}`,
            label: 'View Stage',
          },
        ],
      },
      {
        type: 1,
        components: [buildDungeonStageSelect(dungeonProfile, dungeonLevel, stage, userId)],
      },
    ],
  };
}

function buildDungeonHomeContent(userId, dungeonProfile, dungeonLevel = 1) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [buildDungeonHomeContainer(userId, dungeonProfile, dungeonLevel)],
  };
}

function buildDungeonInfoContent(dungeonProfile, dungeonLevel, stage) {
  const stageData = getDungeonStage(dungeonLevel, stage);
  const completedKey = getDungeonStageKey(dungeonLevel, stage);
  const completedDifficulties =
    dungeonProfile.completedDifficultiesByStage?.[completedKey] ?? [];
  const difficultyLine = completedDifficulties.length
    ? completedDifficulties.join(' ')
    : 'None';

  if (!stageData) {
    return {
      flags: MessageFlags.Ephemeral,
      content: 'Dungeon stage info is unavailable.',
    };
  }

  const uniqueCreatures = new Set(
    stageData.floors.flatMap((floor) => floor.map((entry) => entry.creature?.name)).filter(Boolean)
  );
  const rewardItems = stageData.rewards.items ?? [];
  const rewardLines = [
    `- ${COIN_EMOJI} ${stageData.rewards.coins.min} - ${stageData.rewards.coins.max} coins`,
    `- 🎯 ${stageData.rewards.xp.min} - ${stageData.rewards.xp.max} Hunt XP`,
    stageData.rewards.diamonds
      ? `- ${DIAMOND_EMOJI} ${stageData.rewards.diamonds.min} - ${stageData.rewards.diamonds.max} diamonds \`[first win]\``
      : null,
    ...rewardItems.map((item) => {
      const rewardItem = findItemById(item.itemId);
      return `- ${rewardItem?.emoji ?? '🎁'} ${item.amount} ${
        rewardItem?.name ?? item.itemId
      } \`[first win]\``;
    }),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    flags: MessageFlags.Ephemeral | COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 9,
            components: [
              {
                type: 10,
                content: `## Dungeon ${dungeonLevel} - Stage ${stage} info:\n-# Total floors: ${
                  stageData.totalFloors
                }\n-# Creature Variety: ${uniqueCreatures.size}\n-# Danger: ${
                  stageData.danger
                }\n### Reward:\n${rewardLines}\n### Completed Difficulty: ${difficultyLine}`,
              },
            ],
            accessory: {
              type: 11,
              media: { url: getDungeonThumbnail() },
              description: 'Dungeon icon',
            },
          },
        ],
      },
    ],
  };
}

function formatTeamMessage(user, petProfile) {
  const lines = (petProfile.team ?? [])
    .map((slot, index) => {
      const pet = findPetInstance(petProfile, slot?.petInstanceId);
      if (!pet) {
        return null;
      }

      return `### ${pet.emoji ?? ''} ${pet.name} - Lv ${pet.level}\n-# Target: ${slot?.targetType ?? 'Random'}`;
    })
    .filter(Boolean);

  if (!lines.length) {
    return "You haven't equipped any army/pet.";
  }

  return lines.join('\n');
}

function buildTeamContent(user, petProfile) {
  const teamMessage = formatTeamMessage(user, petProfile);
  const slotOptions = [1, 2, 3].map((slot) => ({ label: `#${slot}`, value: String(slot) }));

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `## ${user.username}'s Team\n${teamMessage}`,
          },
          { type: 14 },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${TEAM_SLOT_SELECT_PREFIX}${user.id}`,
                placeholder: 'Select a slot to edit',
                options: slotOptions,
                min_values: 1,
                max_values: 1,
              },
            ],
          },
          buildNavigationRow({ userId: user.id, view: 'team' }),
        ],
      },
    ],
  };
}

function buildTeamEditContent(user, petProfile, slot, state = {}, statusMessage = '') {
  const slotNumber = Number(slot);
  const slotIndex = Math.max(0, slotNumber - 1);
  const selectedPetId = state.petInstanceId ?? petProfile.team?.[slotIndex]?.petInstanceId ?? null;
  const selectedPet = selectedPetId ? findPetInstance(petProfile, selectedPetId) : null;
  const targetType = state.targetType ?? petProfile.team?.[slotIndex]?.targetType ?? null;
  const hasEquipped = Boolean(petProfile.team?.[slotIndex]?.petInstanceId);

  const availablePets = (petProfile.inventory ?? []).filter(Boolean);
  const hasSelectablePets = availablePets.length > 0;
  const placeholderPet = hasSelectablePets ? 'Choose an army/pet' : "You don't have any pet";
  const petOptions = availablePets.map((pet) => ({
    label: `${pet.name} (Lv ${pet.level})${(() => {
      const equippedSlot = (petProfile.team ?? []).findIndex(
        (entry, index) => index !== slotIndex && entry?.petInstanceId === pet.instanceId
      );
      return equippedSlot !== -1 ? ` (Equipped in #${equippedSlot + 1})` : '';
    })()}`,
    value: pet.instanceId,
    emoji: pet.emoji,
    default: selectedPetId === pet.instanceId,
  }));

  const canPickTargets = Boolean(selectedPet);
  const targetPlaceholder = canPickTargets ? 'Choose target type' : 'Select an army/pet first';
  const targetOptions = ['Weakest', 'Strongest', 'Random'].map((label) => ({
    label,
    value: label,
    default: targetType === label,
  }));

  const statusLine = statusMessage ? `\n-# ${statusMessage}` : '';

  return {
    flags: MessageFlags.Ephemeral,
    content: `## You are editting slot #${slotNumber}\n### Army/Pet selected: ${
      selectedPet ? `${selectedPet.name} ${selectedPet.emoji ?? ''}` : 'None'
    }\n-# Target type: ${targetType ?? 'Not selected'}${statusLine}`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `${TEAM_PET_SELECT_PREFIX}${user.id}:${slotNumber}`,
            placeholder: placeholderPet,
            options: petOptions.length ? petOptions : [{ label: placeholderPet, value: 'none', default: true }],
            disabled: !hasSelectablePets,
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
            custom_id: `${TEAM_TARGET_SELECT_PREFIX}${user.id}:${slotNumber}`,
            placeholder: targetPlaceholder,
            options: targetOptions,
            disabled: !canPickTargets,
            min_values: 1,
            max_values: 1,
          },
        ],
      },
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 4,
            custom_id: `${TEAM_UNEQUIP_PREFIX}${user.id}:${slotNumber}`,
            label: 'UNEQUIP',
            disabled: !hasEquipped,
          },
          {
            type: 2,
            style: 3,
            custom_id: `${TEAM_SUBMIT_PREFIX}${user.id}:${slotNumber}`,
            label: 'SUBMIT',
            disabled: !(selectedPet && targetType),
          },
        ],
      },
    ],
  };
}

function buildHuntDelayContent() {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x808080,
        components: [
          {
            type: 10,
            content: '### You are going for a hunt...'
          }
        ]
      }
    ]
  };
}

function buildDungeonDelayContent() {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x808080,
        components: [
          {
            type: 10,
            content: '### Starting...'
          }
        ]
      }
    ]
  };
}

function getEmojiUrl(emoji) {
  const match = emoji?.match(/<:[^:]+:(\d+)>/);
  if (!match) {
    return null;
  }
  return `https://cdn.discordapp.com/emojis/${match[1]}.png?size=128&quality=lossless`;
}

function createBattleState(profile, user, petProfile) {
  const gear = selectGear(profile);
  const maxHealth = calculatePlayerMaxHealth(profile.level, DEFAULT_PROFILE.max_health);
  const creatures = [createCreatureInstance(pickCreatureDefinition(profile.level), profile.level)];
  const pets = buildBattlePets(petProfile ?? { team: [], inventory: [] });

  return {
    mode: 'hunt',
    attackSelectPrefix: HUNT_ATTACK_SELECT_PREFIX,
    userId: user.id,
    player: {
      name: user.globalName ?? user.username,
      level: profile.level,
      maxHealth,
      health: maxHealth,
      defense: profile.defense,
      actionsLeft: ACTIONS_PER_TURN,
      gear,
      statuses: [],
      pets,
    },
    creatures,
    initialCreatures: creatures.map((creature) => ({
      name: creature.name,
      level: creature.level,
      drops: creature.drops ?? [],
      reward: creature.reward,
    })),
    pets,
    actionMessages: [],
    miscInventory: profile.misc_inventory ?? [],
  };
}

function buildDungeonCreatures(stageData, floorNumber) {
  const floorIndex = Math.max(0, floorNumber - 1);
  const floor = stageData.floors?.[floorIndex] ?? [];
  const creatures = [];

  for (const entry of floor) {
    const count = Math.max(0, Number(entry?.count) || 0);
    for (let i = 0; i < count; i += 1) {
      creatures.push(createCreatureInstanceAtLevel(entry.creature, entry.level));
    }
  }

  return creatures;
}

function createDungeonBattleState(profile, user, petProfile, dungeonLevel, stageData) {
  const gear = selectGear(profile);
  const maxHealth = calculatePlayerMaxHealth(profile.level, DEFAULT_PROFILE.max_health);
  const pets = buildBattlePets(petProfile ?? { team: [], inventory: [] });
  const creatures = buildDungeonCreatures(stageData, 1);

  return {
    mode: 'dungeon',
    attackSelectPrefix: DUNGEON_ATTACK_SELECT_PREFIX,
    userId: user.id,
    dungeon: {
      level: dungeonLevel,
      stage: stageData.stage,
      floor: 1,
      totalFloors: stageData.totalFloors,
    },
    player: {
      name: user.globalName ?? user.username,
      level: profile.level,
      maxHealth,
      health: maxHealth,
      defense: profile.defense,
      actionsLeft: ACTIONS_PER_TURN,
      gear,
      statuses: [],
      pets,
    },
    creatures,
    pets,
    actionMessages: [],
    miscInventory: profile.misc_inventory ?? [],
    floorEndsAt: null,
    floorTimeout: null,
    isTransitioning: false,
  };
}

function rollDamage(min, max) {
  return Math.max(1, Math.floor(Math.random() * (max - min + 1)) + min);
}

function calculateGearDamage(gear) {
  const min = gear?.damage?.min ?? 1;
  const max = gear?.damage?.max ?? min;
  const crit = Math.random() < CRIT_CHANCE;
  if (crit) {
    return { amount: Math.ceil(max * 1.25), crit };
  }
  return { amount: rollDamage(min, max), crit };
}

function calculatePetDamageAmount(pet) {
  const min = pet?.damage?.min ?? 1;
  const max = pet?.damage?.max ?? min;
  const crit = Math.random() < CRIT_CHANCE;
  if (crit) {
    return { amount: Math.ceil(max * 1.25), crit };
  }
  return { amount: rollDamage(min, max), crit };
}

function decrementGearDurability(profile, gear) {
  if (!gear || !Number.isFinite(gear.durability) || gear.durability === Infinity) {
    return;
  }

  const inventory = profile.gear_inventory ?? [];
  const target = inventory.find((item) => item && item.name === gear.name);
  if (!target) {
    return;
  }

  const currentDurability = Number.isFinite(target.durability) ? target.durability : gear.durability;
  target.durability = Math.max(0, currentDurability - 1);
  target.maxDurability = target.maxDurability ?? gear.maxDurability;

  if (profile.gear_equipped?.name === target.name) {
    profile.gear_equipped = target;
  }

  if (target.durability <= 0) {
    profile.gear_inventory = inventory.filter((item) => item && item.name !== gear.name);
    if (profile.gear_equipped?.name === gear.name) {
      profile.gear_equipped = null;
    }
  }
}

function buildCreatureOptions(state) {
  const truncateLabel = (text) => (text.length > 25 ? `${text.slice(0, 22)}...` : text);
  const aliveCreatures = state.creatures.filter((creature) => creature.health > 0);

  if (!aliveCreatures.length) {
    return [
      {
        label: 'No creatures available',
        description: 'All targets have been defeated',
        value: 'none',
        emoji: '✅',
      },
    ];
  }

  return aliveCreatures
    .slice(0, 25)
    .map((creature) => ({
      label: truncateLabel(`${creature.name} ${formatCreatureLevel(creature.level)}`),
      description: `HP ${creature.health}/${creature.maxHealth}`,
      value: creature.id,
      emoji: creature.emoji,
    }));
}

function pickCreatureTarget(creatures, targetType) {
  const alive = creatures.filter((creature) => creature.health > 0);
  if (!alive.length) {
    return null;
  }

  if (targetType === 'Weakest') {
    return alive.reduce((lowest, creature) =>
      creature.health < (lowest?.health ?? Infinity) ? creature : lowest
    );
  }

  if (targetType === 'Strongest') {
    return alive.reduce((highest, creature) =>
      creature.health > (highest?.health ?? -Infinity) ? creature : highest
    );
  }

  const randomIndex = Math.floor(Math.random() * alive.length);
  return alive[randomIndex];
}

function performPetTurn(state) {
  const messages = [];
  if (!state.pets || !state.pets.length) {
    return messages;
  }

  for (const pet of state.pets) {
    if (!pet || pet.health <= 0) {
      continue;
    }

    const petStun = findStatus(pet, PET_STUN_STATUS.type);
    if (petStun) {
      const remaining = petStun.remaining ?? petStun.duration ?? 0;
      const nextRemaining = remaining === Infinity ? Infinity : Math.max(0, remaining - 1);
      const remainingStatuses = (pet.statuses ?? []).filter((status) => status?.type !== PET_STUN_STATUS.type);
      if (nextRemaining === Infinity || nextRemaining > 0) {
        remainingStatuses.push({ ...petStun, remaining: nextRemaining });
      }
      pet.statuses = remainingStatuses;
      messages.push(`${PET_STUN_STATUS.emoji} ${pet.name} is stunned and cannot act.`);
      continue;
    }

    const target = pickCreatureTarget(state.creatures, pet.targetType ?? 'Random');
    if (!target) {
      continue;
    }

    const hits = Math.max(1, pet.hits ?? 1);
    for (let i = 0; i < hits; i++) {
      const { amount, crit } = calculatePetDamageAmount(pet);
      target.health = Math.max(0, target.health - amount);
      const actionLine = crit
        ? `${pet.emoji ?? '🐾'} ${pet.name} unleashes a CRIT for **${amount}** on ${target.name}!`
        : `${pet.emoji ?? '🐾'} ${pet.name} hits ${target.name} for **${amount}** damages.`;
      messages.push(actionLine);

      if (target.health <= 0) {
        messages.push(`${target.name} has been taken down by ${pet.name}!`);
        break;
      }
    }
  }

  return messages;
}

function buildMiscOptions(profile) {
  return buildSelectOptions(profile.misc_inventory ?? [], profile.misc_equipped?.name);
}

function formatActionMessages(state) {
  if (!state.actionMessages.length) {
    return '{action msg} will appear here after your attacks.';
  }
  return state.actionMessages.join('\n');
}

function creatureListText(creatures) {
  const counts = creatures.reduce((acc, creature) => {
    acc[creature.name] = (acc[creature.name] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(', ');
}

function calculateRewards(creatures) {
  const rewards = { coins: 0, xp: 0, diamonds: 0, prismatic: 0 };
  for (const creature of creatures) {
    const level = creature.level ?? 1;
    const reward = creature.reward ?? JUNGLE_BETTLE.reward;

    rewards.coins += rollRewardAmount(reward.coins, level);
    rewards.xp += rollRewardAmount(reward.xp, level);

    if (reward.diamonds) {
      rewards.diamonds += rollRewardAmount(reward.diamonds, level);
    }

    if (reward.prismatic) {
      const chance = typeof reward.prismatic.chance === 'number' ? reward.prismatic.chance : 1;
      if (Math.random() <= chance) {
        rewards.prismatic += rollRewardAmount(reward.prismatic, level);
      }
    }
  }
  return rewards;
}

function rollRewardAmount(range, level) {
  if (!range) {
    return 0;
  }

  const minBase = Number.isFinite(range.min) ? range.min : Number.isFinite(range.max) ? range.max : 0;
  const maxBase = Number.isFinite(range.max) ? range.max : Number.isFinite(range.min) ? range.min : 0;
  const min = Math.max(0, scaleStatForLevel(minBase, level, CREATURE_REWARD_GROWTH));
  const max = Math.max(min, scaleStatForLevel(maxBase, level, CREATURE_REWARD_GROWTH));

  if (max <= 0 && min <= 0) {
    return 0;
  }

  return rollDamage(Math.max(1, min), Math.max(1, max));
}

function rollDropAmount(drop) {
  const amount = drop?.amount ?? 1;

  if (typeof amount === 'object' && amount !== null) {
    const min = Number.isFinite(amount.min) ? amount.min : Number.isFinite(amount.max) ? amount.max : 1;
    const max = Number.isFinite(amount.max) ? amount.max : min;
    return rollDamage(Math.max(1, min), Math.max(1, max));
  }

  return Number.isFinite(amount) ? Math.max(1, amount) : 1;
}

function rollCreatureDrops(creatures) {
  const drops = [];

  for (const creature of creatures) {
    for (const drop of creature.drops ?? []) {
      const chance = typeof drop.chance === 'number' ? drop.chance : 0;
      if (Math.random() > chance) {
        continue;
      }

      const amount = rollDropAmount(drop);
      const item = findItemById(drop.itemId);
      if (item) {
        drops.push({ item, amount });
      }
    }
  }

  return drops;
}

function findStatus(entity, type) {
  return (entity.statuses ?? []).find((status) => status?.type === type) ?? null;
}

function addStatusEffect(entity, status) {
  if (!status) {
    return null;
  }

  entity.statuses = Array.isArray(entity.statuses) ? [...entity.statuses] : [];
  const existing = findStatus(entity, status.type);
  if (existing) {
    existing.percent = Math.max(existing.percent ?? 0, status.percent ?? 0);
    const incomingRemaining = status.remaining ?? status.duration ?? 0;
    if (existing.remaining !== Infinity) {
      if (incomingRemaining === Infinity) {
        existing.remaining = Infinity;
      } else if (Number.isFinite(incomingRemaining)) {
        existing.remaining = Math.max(existing.remaining ?? 0, incomingRemaining);
      }
    }
    return existing;
  }

  const remaining = status.remaining ?? status.duration ?? 0;
  const newStatus = { ...status, remaining: remaining === undefined ? null : remaining };
  entity.statuses.push(newStatus);
  return newStatus;
}

function applyStatusEffects(state) {
  const messages = [];
  const player = state.player;
  const remainingStatuses = [];

  for (const status of player.statuses ?? []) {
    if (status.type === POISON_STATUS.type) {
      const percent = Math.max(0, status.percent ?? 0);
      const damage = Math.max(1, Math.floor(player.health * percent));
      player.health = Math.max(0, player.health - damage);
      messages.push(`${POISON_STATUS.emoji} Poison saps **${damage}** HP from you.`);
    }
    if (status.type === ACTION_LOCK_STATUS.type) {
      const penalty = Math.max(1, status.amount ?? 1);
      player.actionPenalty = Math.max(player.actionPenalty ?? 0, penalty);
      messages.push(`${ACTION_LOCK_STATUS.emoji} Roots bind you. You will lose ${penalty} action.`);
    }

    let remaining = status.remaining ?? status.duration;
    if (remaining !== Infinity) {
      remaining = Math.max(0, (remaining ?? 1) - 1);
    }

    const shouldKeep = player.health > 0 && (remaining === Infinity || remaining > 0);
    if (shouldKeep) {
      remainingStatuses.push({ ...status, remaining });
    }
  }

  player.statuses = remainingStatuses;
  return messages;
}

function formatStatusDuration(remaining) {
  if (remaining === Infinity) {
    return '∞';
  }
  if (!Number.isFinite(remaining)) {
    return 0;
  }
  return Math.max(0, remaining);
}

function formatStatusDisplayValue(status) {
  if (status.type === DEFENSE_STATUS.type) {
    const percent = Math.max(0, status.percent ?? 0);
    return Math.round(percent * 100);
  }
  return formatStatusDuration(status.remaining ?? status.duration ?? 0);
}

function statusEffectsForDisplay(statuses = []) {
  return (statuses ?? []).map((status) => ({
    emoji: status.emoji ?? POISON_STATUS.emoji,
    remaining: formatStatusDisplayValue(status),
  }));
}

function applyRewards(userId, profile, rewards) {
  let leveledUp = 0;
  const coinsReward = Math.max(0, rewards.coins ?? 0);
  const xpReward = Math.max(0, rewards.xp ?? 0);
  const diamondReward = Math.max(0, rewards.diamonds ?? 0);
  const prismaticReward = Math.max(0, rewards.prismatic ?? 0);

  profile.coins = Math.max(0, profile.coins + coinsReward);
  profile.xp = Math.max(0, profile.xp + xpReward);

  addCoinsToUser(userId, coinsReward);
  if (diamondReward) {
    addDiamondsToUser(userId, diamondReward);
  }
  if (prismaticReward) {
    addPrismaticToUser(userId, prismaticReward);
  }

  let nextLevelRequirement = calculateNextLevelXp(profile.level);
  while (profile.level < 100 && profile.xp >= nextLevelRequirement) {
    profile.xp -= nextLevelRequirement;
    profile.level += 1;
    leveledUp += 1;
    profile.upgrade_tokens += 5;
    nextLevelRequirement = calculateNextLevelXp(profile.level);
  }

  if (profile.level >= 100) {
    profile.level = 100;
    profile.xp = 0;
    nextLevelRequirement = calculateNextLevelXp(profile.level);
  }

  profile.next_level_xp = nextLevelRequirement;

  if (leveledUp > 0) {
    profile = addItemToInventory(profile, UPGRADE_TOKEN_ITEM, leveledUp * 5);
  }

  const scaledHealth = calculatePlayerMaxHealth(profile.level, DEFAULT_PROFILE.max_health);
  profile.max_health = scaledHealth;
  profile.health = scaledHealth;
  return leveledUp;
}

function applyDrops(profile, drops) {
  const granted = [];

  for (const drop of drops) {
    if (!drop?.item) {
      continue;
    }

    const amount = Number.isFinite(drop.amount) ? drop.amount : 1;
    addItemToInventory(profile, drop.item, amount);
    granted.push({ item: drop.item, amount });
  }

  return granted;
}

function rewardLines(rewards, leveledUp, drops = []) {
  const lines = [
    `-# * ${rewards.coins} coins ${COIN_EMOJI}`,
    `-# * ${rewards.xp} Hunt XP`,
  ];
  if (rewards.diamonds) {
    lines.push(`-# * ${rewards.diamonds} diamonds ${DIAMOND_EMOJI}`);
  }
  if (rewards.prismatic) {
    lines.push(`-# * ${rewards.prismatic} prismatic coins ${PRISMATIC_EMOJI}`);
  }
  if (leveledUp > 0) {
    lines.push(`-# * ${leveledUp * 5} Upgrade Tokens ${UPGRADE_TOKEN_EMOJI}`);
  }
  if (drops.length) {
    for (const drop of drops) {
      lines.push(`-# * ×${drop.amount} ${drop.item.name} ${drop.item.emoji ?? ''}`.trim());
    }
  }
  return lines.join('\n');
}

function getInventoryItemAmount(profile, itemId) {
  const item = findItemById(itemId);
  if (!item) {
    return 0;
  }
  const entry = (profile.misc_inventory ?? []).find((misc) => misc?.name === item.name);
  return Number.isFinite(entry?.amount) ? entry.amount : 0;
}

function consumeInventoryItem(profile, itemId, amount) {
  const item = findItemById(itemId);
  if (!item) {
    return profile;
  }
  const miscInventory = Array.isArray(profile.misc_inventory) ? [...profile.misc_inventory] : [];
  const index = miscInventory.findIndex((misc) => misc?.name === item.name);
  if (index === -1) {
    return profile;
  }
  const currentAmount = Number.isFinite(miscInventory[index].amount)
    ? miscInventory[index].amount
    : 0;
  const nextAmount = Math.max(0, currentAmount - amount);
  if (nextAmount === 0) {
    miscInventory.splice(index, 1);
  } else {
    miscInventory[index] = { ...miscInventory[index], amount: nextAmount };
  }
  profile.misc_inventory = miscInventory;
  return profile;
}

function rollDungeonRewardAmount(range) {
  if (!range) {
    return 0;
  }
  const min = Number.isFinite(range.min) ? range.min : 0;
  const max = Number.isFinite(range.max) ? range.max : min;
  return rollDamage(Math.max(1, min), Math.max(1, max));
}

function calculateDungeonRewards(stageData, isFirstWin) {
  const rewards = {
    coins: rollDungeonRewardAmount(stageData.rewards.coins),
    xp: rollDungeonRewardAmount(stageData.rewards.xp),
    diamonds: 0,
  };
  if (stageData.rewards.diamonds && isFirstWin) {
    rewards.diamonds = rollDungeonRewardAmount(stageData.rewards.diamonds);
  }
  return rewards;
}

function buildSuccessContent(profile, userId, creatures, rewards, leveledUp, drops) {
  const message = `-# You have successfully hunted ${creatureListText(creatures)} and got:\n${rewardLines(
    rewards,
    leveledUp,
    drops
  )}`;
  return buildHomeContent(profile, userId, { message, accentColor: 0x2ecc71 });
}

function buildFailureContent(profile, userId, creatures, diedReason) {
  const failureLine = diedReason ?? 'You were defeated.';
  const message = `-# You have failed hunting ${creatureListText(creatures)}.\n-# ${failureLine}`;
  return buildHomeContent(profile, userId, { message, accentColor: 0xe74c3c });
}

function pickCreatureAction(creature) {
  const actions = creature.actions ?? [];
  if (!actions.length) {
    return null;
  }

  const totalChance = actions.reduce((sum, action) => sum + (action.chance ?? 0), 0);
  const roll = Math.random() * (totalChance || 1);
  let cumulative = 0;

  for (const action of actions) {
    cumulative += action.chance ?? 0;
    if (roll <= cumulative) {
      return action;
    }
  }

  return actions[actions.length - 1];
}

function calculateCreatureDamage(creature, action, isPlayerPoisoned) {
  const damageRange = isPlayerPoisoned && action?.damageIfPoisoned ? action.damageIfPoisoned : action?.damage;
  if (damageRange) {
    return rollDamage(damageRange.min ?? 1, damageRange.max ?? damageRange.min ?? 1);
  }
  return rollDamage(creature.damage?.min ?? 1, creature.damage?.max ?? creature.damage?.min ?? 1);
}

function getAliveDefenders(state) {
  const defenders = [];

  if (state.player?.health > 0) {
    defenders.push({ type: 'player', entity: state.player, label: 'you' });
  }

  for (const pet of state.pets ?? []) {
    if (pet?.health > 0) {
      defenders.push({ type: 'pet', entity: pet, label: pet.name ?? 'your pet' });
    }
  }

  return defenders;
}

function formatCreatureActionMessage(action, creature, amount, targetLabel, isPlayerPoisoned) {
  const baseTemplate = isPlayerPoisoned && action?.alreadyPoisonedMessage
    ? action.alreadyPoisonedMessage
    : action?.message;

  const fallback = `${creature.name} attacked {target} for {amount} damages.`;
  return (baseTemplate ?? fallback)
    .replace('{amount}', amount)
    .replace('{target}', targetLabel ?? 'you');
}

function getDefensePercent(entity) {
  const status = findStatus(entity, DEFENSE_STATUS.type);
  return Math.max(0, status?.percent ?? 0);
}

function applyDefensePercent(amount, percent) {
  return Math.max(1, Math.floor(amount * (1 - percent)));
}

function performCreatureAction(state, creature, action, target) {
  const messages = [];
  if (!target) {
    return messages;
  }

  const isPlayerTarget = target.type === 'player';
  const isPlayerPoisoned = isPlayerTarget && Boolean(findStatus(state.player, POISON_STATUS.type));
  const noDamage = Boolean(action?.noDamage);
  let mitigated = 0;

  if (!noDamage) {
    const rawDamage = calculateCreatureDamage(creature, action, isPlayerPoisoned);
    const defensePercent = getDefensePercent(target.entity);
    const percentMitigated = applyDefensePercent(rawDamage, defensePercent);
    const defenseMitigation = isPlayerTarget ? state.player.defense ?? 0 : 0;
    mitigated = Math.max(1, percentMitigated - defenseMitigation);
    target.entity.health = Math.max(0, target.entity.health - mitigated);
  }

  if (action) {
    const actionMessage = formatCreatureActionMessage(
      action,
      creature,
      mitigated,
      target.label,
      isPlayerPoisoned
    );
    messages.push(actionMessage);

    if (isPlayerTarget && action.poison && !isPlayerPoisoned) {
      const status = addStatusEffect(state.player, {
        ...POISON_STATUS,
        percent: action.poison.percent,
        remaining: action.poison.duration ?? action.poison.remaining ?? Infinity,
        emoji: action.poison.emoji ?? POISON_STATUS.emoji,
      });
      const durationText = formatStatusDuration(status?.remaining ?? action.poison.duration ?? Infinity);
      messages.push(`${POISON_STATUS.emoji} You got poisoned for ${durationText} round`);
    }
    if (isPlayerTarget && action.actionPenalty) {
      addStatusEffect(state.player, {
        ...ACTION_LOCK_STATUS,
        amount: action.actionPenalty,
        remaining: 1,
      });
    }
    if (action.petStun) {
      const duration = action.petStun.duration ?? 1;
      for (const pet of state.pets ?? []) {
        if (!pet || pet.health <= 0) {
          continue;
        }
        addStatusEffect(pet, { ...PET_STUN_STATUS, remaining: duration });
      }
    }

    return messages;
  }

  const targetLabel = target.label ?? 'you';
  messages.push(`${creature.name} has **Bitten** ${targetLabel} and dealth **${mitigated} damages**.`);
  return messages;
}

function resolveCreatureTurn(state) {
  const messages = [];
  for (const creature of state.creatures) {
    if (creature.health <= 0 || state.player.health <= 0) {
      continue;
    }
    const hits = Math.max(1, creature.hits ?? 1);
    const action = pickCreatureAction(creature);
    for (let i = 0; i < hits; i++) {
      const defenders = getAliveDefenders(state);
      if (!defenders.length) {
        break;
      }

      if (creature.attackType === 'Multi') {
        for (const target of defenders) {
          messages.push(...performCreatureAction(state, creature, action, target));
        }
      } else {
        const targetIndex = Math.floor(Math.random() * defenders.length);
        messages.push(...performCreatureAction(state, creature, action, defenders[targetIndex]));
      }

      if (state.player.health <= 0) {
        break;
      }
    }
  }
  state.actionMessages = messages;
  return messages;
}

async function buildBattleAttachment(state, user) {
  const avatar = user.displayAvatarURL({ extension: 'png', size: 256 });
  const playerPets = (state.pets ?? []).map((pet) => ({
    name: pet.name,
    avatar: getEmojiUrl(pet.emoji) ?? HUNT_THUMBNAIL,
    level: pet.level,
    hp: pet.health,
    maxHp: pet.maxHealth,
    shield: 0,
    rarityEmoji: pet.rarityEmoji,
    rarityIcon: pet.rarityEmoji,
    effects: statusEffectsForDisplay(pet.statuses ?? []),
  }));

  const player = {
    name: state.player.name,
    avatar,
    level: state.player.level,
    maxHp: state.player.maxHealth,
    hp: state.player.health,
    defense: state.player.defense,
    shield: state.player.defense,
    effects: statusEffectsForDisplay(state.player.statuses),
    pets: playerPets,
  };

  const enemies = state.creatures.map((creature) => ({
    label: `${creature.name} ${formatCreatureLevel(creature.level)}`,
    level: creature.level,
    hp: creature.health,
    maxHp: creature.maxHealth,
    shield: 0,
    accentColor: '#1abc9c',
    rarity: creature.rarity,
    rarityEmoji: creature.rarityEmoji,
    avatar: getEmojiUrl(creature.emoji) ?? HUNT_THUMBNAIL,
    effects: statusEffectsForDisplay(creature.statuses ?? []),
  }));

  const buffer = await createHuntBattleImage({ player, enemies });
  return new AttachmentBuilder(buffer, { name: 'hunt-battle.png' });
}

function buildBattleContent(state, user, attachment) {
  const creatures = state.creatures.filter((creature) => creature.health > 0);
  const fallbackCreature = creatures[0] ?? state.creatures[0];
  const headerCreatureName = fallbackCreature?.name ?? JUNGLE_BETTLE.name;
  const headerCreatureRarity = fallbackCreature?.rarityEmoji ?? '';
  const headerCreatureLabel = headerCreatureRarity
    ? `${headerCreatureName} ${headerCreatureRarity}`
    : headerCreatureName;
  const thumbnail = getEmojiUrl(fallbackCreature?.emoji ?? JUNGLE_BETTLE.emoji) ?? HUNT_THUMBNAIL;
  const isDungeon = state.mode === 'dungeon';
  const dungeonHeader = (() => {
    if (!isDungeon) {
      return null;
    }
    if (state.isEnding) {
      return '### Dungeon ending soon';
    }
    const floorEndsAt = state.floorEndsAt;
    const timeLeft = floorEndsAt ? `<t:${floorEndsAt}:R>` : 'soon';
    return `## Dungeon Lv ${state.dungeon?.level ?? 1} - Stage ${state.dungeon?.stage ?? 1}\n-# Floor ${
      state.dungeon?.floor ?? 1
    } - time ${timeLeft}`;
  })();
  const headerLine = isDungeon
    ? dungeonHeader
    : state.isEnding
      ? '### Hunt ending soon'
      : creatures.length
        ? `### You found a ${headerCreatureLabel}`
        : '### Hunt cleared';
  const actionsLine = state.isEnding
    ? isDungeon
      ? '-# Dungeon ending...'
      : '-# Hunt ending...'
    : `-# You have \`${state.player.actionsLeft} action${state.player.actionsLeft === 1 ? '' : 's'}\` left`;
  const selectDisabled =
    state.isEnding || state.isTransitioning || !creatures.length || state.player.actionsLeft <= 0;
  const attackSelectPrefix = state.attackSelectPrefix ?? HUNT_ATTACK_SELECT_PREFIX;

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: headerLine,
          },
          {
            type: 12,
            items: [
              {
                media: { url: 'attachment://hunt-battle.png' },
              },
            ],
          },
        ],
        accessory: {
          type: 11,
          media: { url: thumbnail },
          description: 'Hunt target thumbnail',
        },
      },
      {
        type: 17,
        accent_color: 0x000000,
        components: [
          { type: 10, content: formatActionMessages(state) },
        ],
      },
      {
        type: 17,
        accent_color: 0x2ecc71,
        components: [
          {
            type: 10,
            content: actionsLine,
          },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${attackSelectPrefix}${user.id}`,
                placeholder: 'Select a creature to attack',
                options: buildCreatureOptions(state),
                disabled: selectDisabled,
                min_values: 1,
                max_values: 1,
              },
            ],
          },
        ],
      },
    ],
    files: [attachment],
  };
}

function performPlayerAttack(state, creatureId, gear) {
  const creature = state.creatures.find((item) => item.id === creatureId);
  if (!creature) {
    state.actionMessages = ['No creature found to attack.'];
    return null;
  }

  const { amount, crit } = calculateGearDamage(gear);
  const mitigated = applyDefensePercent(amount, getDefensePercent(creature));
  creature.health = Math.max(0, creature.health - mitigated);
  state.player.actionsLeft = Math.max(0, state.player.actionsLeft - 1);

  const actionText = crit
    ? `### You have used **${gear.name}** on ${creature.name} and deal a CRIT damage of **${mitigated}**!`
    : `You have used **${gear.name}** on ${creature.name} and deal **${mitigated} damages**.`;

  state.actionMessages = [actionText];
  return creature;
}

function clearHuntInactivityTimeout(userId) {
  const state = activeHunts.get(userId);
  if (!state?.inactivityTimeout) {
    return;
  }

  clearTimeout(state.inactivityTimeout);
  state.inactivityTimeout = null;
}

async function failHuntDueToInactivity(interaction, userId) {
  const state = activeHunts.get(userId);
  if (!state) {
    return;
  }

  clearHuntInactivityTimeout(userId);

  const targetInteraction = interaction ?? state.inactivityInteraction;
  if (!targetInteraction) {
    activeHunts.delete(userId);
    return;
  }

  const profile = getUserProfile(userId);
  const failureContent = buildFailureContent(
    profile,
    userId,
    state.initialCreatures ?? state.creatures ?? [],
    'The creature despawned after 30s of inactivity.'
  );

  try {
    await targetInteraction.editReply(failureContent);
  } catch (error) {
    console.warn('Failed to end hunt due to inactivity:', error);
  }

  activeHunts.delete(userId);
}

async function failDungeonDueToTimeout(interaction, userId) {
  const state = activeDungeons.get(userId);
  if (!state) {
    return;
  }

  clearDungeonFloorTimeout(userId);
  const targetInteraction = interaction ?? state.floorInteraction;
  if (!targetInteraction) {
    activeDungeons.delete(userId);
    return;
  }

  state.isEnding = true;
  await runDungeonEndCountdown(targetInteraction, state, (endTimestampSeconds) =>
    `You have failed Stage ${state.dungeon?.stage ?? 1}, exiting <t:${endTimestampSeconds}:R>.`
  );
  const dungeonProfile = getUserDungeonProfile(userId);
  const homeContent = buildDungeonHomeContent(userId, dungeonProfile, state.dungeon?.level ?? 1);

  try {
    await targetInteraction.editReply(homeContent);
  } catch (error) {
    console.warn('Failed to end dungeon due to timeout:', error);
  }

  activeDungeons.delete(userId);
}

function scheduleHuntInactivityTimeout(interaction, userId) {
  clearHuntInactivityTimeout(userId);
  const state = activeHunts.get(userId);
  if (!state) {
    return;
  }

  if (interaction) {
    state.inactivityInteraction = interaction;
  }

  const targetInteraction = state.inactivityInteraction;
  if (!targetInteraction) {
    return;
  }

  state.inactivityTimeout = setTimeout(
    () => failHuntDueToInactivity(targetInteraction, userId),
    HUNT_INACTIVITY_TIMEOUT_MS
  );
}

function recordHuntActivity(interaction, userId) {
  const state = activeHunts.get(userId);
  if (!state) {
    return;
  }

  state.inactivityInteraction = interaction;
  scheduleHuntInactivityTimeout(interaction, userId);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runHuntEndCountdown(interaction, state, countdownBuilder) {
  state.isEnding = true;
  const endTimestampSeconds = Math.floor(
    (Date.now() + HUNT_END_COUNTDOWN_SECONDS * 1000) / 1000
  );
  state.actionMessages = [
    ...(state.actionMessages ?? []),
    countdownBuilder(endTimestampSeconds),
  ];
  state.player.actionsLeft = 0;

  try {
    const attachment = await buildBattleAttachment(state, interaction.user);
    const content = buildBattleContent(state, interaction.user, attachment);
    content.components = content.components ?? [];
    await interaction.update(content);
  } catch (error) {
    console.error('Failed to update hunt ending countdown:', error);
  }

  await delay(HUNT_END_COUNTDOWN_SECONDS * 1000);
}

function clearDungeonFloorTimeout(userId) {
  const state = activeDungeons.get(userId);
  if (!state?.floorTimeout) {
    return;
  }
  clearTimeout(state.floorTimeout);
  state.floorTimeout = null;
}

function recordDungeonInteraction(interaction, userId) {
  const state = activeDungeons.get(userId);
  if (!state) {
    return;
  }
  state.floorInteraction = interaction;
}

function scheduleDungeonFloorTimeout(interaction, userId) {
  clearDungeonFloorTimeout(userId);
  const state = activeDungeons.get(userId);
  if (!state) {
    return;
  }

  if (interaction) {
    state.floorInteraction = interaction;
  }

  state.floorEndsAt = Math.floor((Date.now() + DUNGEON_FLOOR_TIMEOUT_MS) / 1000);
  const targetInteraction = state.floorInteraction;
  if (!targetInteraction) {
    return;
  }

  state.floorTimeout = setTimeout(
    () => failDungeonDueToTimeout(targetInteraction, userId),
    DUNGEON_FLOOR_TIMEOUT_MS
  );
}

async function runDungeonEndCountdown(interaction, state, messageBuilder) {
  state.isEnding = true;
  const endTimestampSeconds = Math.floor(
    (Date.now() + HUNT_END_COUNTDOWN_SECONDS * 1000) / 1000
  );
  state.actionMessages = [messageBuilder(endTimestampSeconds)];
  state.player.actionsLeft = 0;

  try {
    const attachment = await buildBattleAttachment(state, interaction.user);
    const content = buildBattleContent(state, interaction.user, attachment);
    await interaction.update(content);
  } catch (error) {
    console.error('Failed to update dungeon ending countdown:', error);
  }

  await delay(HUNT_END_COUNTDOWN_SECONDS * 1000);
}

async function runDungeonFloorTransition(interaction, state) {
  const currentFloor = state.dungeon?.floor ?? 1;
  const nextFloor = currentFloor + 1;
  state.isTransitioning = true;
  const endTimestampSeconds = Math.floor(
    (Date.now() + DUNGEON_FLOOR_TRANSITION_SECONDS * 1000) / 1000
  );
  state.actionMessages = [
    `You have cleared floor ${currentFloor}, moving to floor ${nextFloor} <t:${endTimestampSeconds}:R>.`,
  ];
  state.player.actionsLeft = 0;

  try {
    const attachment = await buildBattleAttachment(state, interaction.user);
    const content = buildBattleContent(state, interaction.user, attachment);
    await interaction.update(content);
  } catch (error) {
    console.error('Failed to update dungeon floor transition:', error);
  }

  await delay(DUNGEON_FLOOR_TRANSITION_SECONDS * 1000);
}

async function handleStartHunt(interaction) {
  maybeGrantOwnerPet(interaction);
  const profile = getUserProfile(interaction.user.id);
  const petProfile = getUserPetProfile(interaction.user.id);
  const battleState = createBattleState(profile, interaction.user, petProfile);
  clearHuntInactivityTimeout(interaction.user.id);
  activeHunts.set(interaction.user.id, battleState);

  await interaction.update(buildHuntDelayContent());

  setTimeout(async () => {
    try {
      const attachment = await buildBattleAttachment(battleState, interaction.user);
      const content = buildBattleContent(battleState, interaction.user, attachment);
      await interaction.editReply(content);
      recordHuntActivity(interaction, interaction.user.id);
    } catch (error) {
      console.error('Failed to start hunt:', error);
    }
  }, HUNTING_DELAY_MS);
}

function buildDungeonRewardSummary(rewards, firstWinItems) {
  const lines = [
    `- ${rewards.coins} coins ${COIN_EMOJI}`,
    `- ${rewards.xp} Hunt XP`,
  ];
  if (rewards.diamonds) {
    lines.push(`- ${rewards.diamonds} diamonds ${DIAMOND_EMOJI}`);
  }
  if (firstWinItems.length) {
    for (const drop of firstWinItems) {
      lines.push(`- ×${drop.amount} ${drop.item.name} ${drop.item.emoji ?? ''}`.trim());
    }
  }
  return lines.join('\n');
}

function markDungeonStageCompleted(dungeonProfile, dungeonLevel, stage) {
  const dungeonKey = String(dungeonLevel);
  const stageNumber = Number(stage);
  const completedStages = new Set(
    dungeonProfile.completedStagesByDungeon?.[dungeonKey] ?? []
  );
  completedStages.add(stageNumber);
  dungeonProfile.completedStagesByDungeon = {
    ...dungeonProfile.completedStagesByDungeon,
    [dungeonKey]: Array.from(completedStages),
  };

  const stageKey = getDungeonStageKey(dungeonLevel, stageNumber);
  const completedDifficulties = new Set(
    dungeonProfile.completedDifficultiesByStage?.[stageKey] ?? []
  );
  completedDifficulties.add(DUNGEON_DIFFICULTY_EMOJI);
  dungeonProfile.completedDifficultiesByStage = {
    ...dungeonProfile.completedDifficultiesByStage,
    [stageKey]: Array.from(completedDifficulties),
  };
}

function isDungeonFirstWin(dungeonProfile, dungeonLevel, stage) {
  const stageKey = getDungeonStageKey(dungeonLevel, stage);
  return !(dungeonProfile.firstWinStages ?? []).includes(stageKey);
}

function markDungeonFirstWin(dungeonProfile, dungeonLevel, stage) {
  const stageKey = getDungeonStageKey(dungeonLevel, stage);
  if (!(dungeonProfile.firstWinStages ?? []).includes(stageKey)) {
    dungeonProfile.firstWinStages = [...(dungeonProfile.firstWinStages ?? []), stageKey];
  }
}

async function handleDungeonStart(interaction, userId, dungeonLevel) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const dungeonProfile = getUserDungeonProfile(userId);
  const stage = getDungeonStageSelection(dungeonProfile, dungeonLevel);
  const stageData = getDungeonStage(dungeonLevel, stage);

  if (!stageData) {
    await safeErrorReply(interaction, 'This dungeon stage is not available yet.');
    return true;
  }

  const profile = getUserProfile(userId);
  const requiredAmount = stageData.requirement?.amount ?? 0;
  const requiredItemId = stageData.requirement?.itemId ?? null;
  if (requiredItemId && getInventoryItemAmount(profile, requiredItemId) < requiredAmount) {
    await safeErrorReply(interaction, `You don't meet the requirement: x${requiredAmount} Dungeon Tokens.`);
    return true;
  }

  if (requiredItemId && requiredAmount > 0) {
    consumeInventoryItem(profile, requiredItemId, requiredAmount);
    updateUserProfile(userId, profile);
  }

  const petProfile = getUserPetProfile(userId);
  const battleState = createDungeonBattleState(profile, interaction.user, petProfile, dungeonLevel, stageData);
  battleState.stageData = stageData;
  clearDungeonFloorTimeout(userId);
  activeDungeons.set(userId, battleState);

  await interaction.update(buildDungeonDelayContent());

  setTimeout(async () => {
    try {
      scheduleDungeonFloorTimeout(interaction, userId);
      const attachment = await buildBattleAttachment(battleState, interaction.user);
      const content = buildBattleContent(battleState, interaction.user, attachment);
      await interaction.editReply(content);
      recordDungeonInteraction(interaction, userId);
    } catch (error) {
      console.error('Failed to start dungeon:', error);
    }
  }, HUNTING_DELAY_MS);

  return true;
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

  if (action === 'team') {
    const petProfile = getUserPetProfile(userId);
    await interaction.update(buildTeamContent(interaction.user, petProfile));
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
  if (type === 'gear' && value === FIST_GEAR.name) {
    profile[equippedKey] = null;
    return profile;
  }

  const selectedItem = list.find((item) => item && item.name === value);

  if (selectedItem) {
    const normalized = normalizeGearItem(selectedItem);
    Object.assign(selectedItem, normalized);
    profile[equippedKey] = selectedItem;
  }

  return profile;
}

async function updateTeamSummaryMessage(interaction, state, petProfile) {
  if (!state?.channelId || !state?.huntMessageId) {
    return;
  }

  try {
    const channel = await interaction.client.channels.fetch(state.channelId);
    const huntMessage = await channel.messages.fetch(state.huntMessageId);
    await huntMessage.edit(buildTeamContent(interaction.user, petProfile));
  } catch (error) {
    console.warn('Failed to update hunt team message:', error);
  }
}

async function handleTeamSlotSelect(interaction, userId, slot) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const petProfile = getUserPetProfile(userId);
  const slotNumber = Number(slot);
  const initialState = {
    slot: slotNumber,
    petInstanceId: petProfile.team?.[slotNumber - 1]?.petInstanceId ?? null,
    targetType: petProfile.team?.[slotNumber - 1]?.targetType ?? null,
    huntMessageId: interaction.message?.id,
    channelId: interaction.channelId,
  };

  teamEditState.set(userId, initialState);
  await interaction.reply(buildTeamEditContent(interaction.user, petProfile, slotNumber, initialState));
  return true;
}

async function handleTeamPetSelection(interaction, userId, slot, petInstanceId) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const petProfile = getUserPetProfile(userId);
  const slotIndex = Math.max(0, Number(slot) - 1);
  const selectedPetId = petInstanceId === 'none' ? null : petInstanceId;
  const conflictSlot = selectedPetId
    ? (petProfile.team ?? []).findIndex(
        (entry, index) => index !== slotIndex && entry?.petInstanceId === selectedPetId
      )
    : -1;

  const state = teamEditState.get(userId) ?? {};
  state.slot = slotIndex + 1;
  state.petInstanceId = selectedPetId;
  teamEditState.set(userId, state);

  const statusMessage =
    conflictSlot !== -1
      ? `This pet is currently equipped in slot #${conflictSlot + 1}. It will be moved here when you submit.`
      : '';

  await interaction.update(
    buildTeamEditContent(interaction.user, petProfile, slot, state, statusMessage)
  );
  return true;
}

async function handleTeamTargetSelection(interaction, userId, slot, targetType) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const state = teamEditState.get(userId) ?? {};
  const petProfile = getUserPetProfile(userId);
  state.slot = Number(slot);
  state.targetType = targetType;
  teamEditState.set(userId, state);

  await interaction.update(buildTeamEditContent(interaction.user, petProfile, slot, state));
  return true;
}

async function handleTeamSubmit(interaction, userId, slot) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const state = teamEditState.get(userId);
  if (!state || !state.petInstanceId || !state.targetType) {
    await safeErrorReply(interaction, 'Select an army/pet and target type before submitting.');
    return true;
  }

  const petProfile = getUserPetProfile(userId);
  const slotIndex = Number(slot) - 1;
  if (!findPetInstance(petProfile, state.petInstanceId)) {
    await safeErrorReply(interaction, 'The selected pet/army could not be found.');
    return true;
  }

  const removedSlots = [];
  (petProfile.team ?? []).forEach((entry, index) => {
    if (index !== slotIndex && entry?.petInstanceId === state.petInstanceId) {
      removedSlots.push(index);
      petProfile.team[index] = { petInstanceId: null, targetType: 'Random' };
    }
  });

  petProfile.team[slotIndex] = { petInstanceId: state.petInstanceId, targetType: state.targetType };
  updateUserPetProfile(userId, petProfile);

  const statusMessage = removedSlots.length
    ? `Auto-unequipped this pet from slot${removedSlots.length > 1 ? 's' : ''} ${
        removedSlots.map((idx) => `#${idx + 1}`).join(', ')
      } to avoid duplicates.`
    : '';

  const confirmation = buildTeamEditContent(
    interaction.user,
    petProfile,
    slot,
    {
      petInstanceId: state.petInstanceId,
      targetType: state.targetType,
    },
    statusMessage
  );

  await updateTeamSummaryMessage(interaction, state, petProfile);
  teamEditState.delete(userId);

  await interaction.update(confirmation);
  return true;
}

async function handleTeamUnequip(interaction, userId, slot) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const slotIndex = Number(slot) - 1;
  const petProfile = getUserPetProfile(userId);
  const currentSlot = petProfile.team?.[slotIndex];

  if (!currentSlot?.petInstanceId) {
    await safeErrorReply(interaction, 'There is no army/pet equipped in this slot.');
    return true;
  }

  petProfile.team[slotIndex] = { petInstanceId: null, targetType: 'Random' };
  updateUserPetProfile(userId, petProfile);

  const state = teamEditState.get(userId) ?? {};
  state.slot = slotIndex + 1;
  state.petInstanceId = null;
  state.targetType = null;
  teamEditState.set(userId, state);

  await updateTeamSummaryMessage(interaction, state, petProfile);

  await interaction.update(buildTeamEditContent(interaction.user, petProfile, slotIndex + 1, state));
  return true;
}

async function handleSelect(interaction, selectType, userId) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const profile = getUserProfile(userId);
  const selectedValue = interaction.values?.[0];
  if (selectType === 'misc' && activeHunts.has(userId)) {
    const message = (profile.misc_inventory ?? []).length
      ? 'Using misc items during hunts is coming soon.'
      : "You don't have any Misc";
    await safeErrorReply(interaction, message);
    return true;
  }
  applySelection(profile, selectType, selectedValue);
  updateUserProfile(userId, profile);

  await interaction.update(buildEquipmentContent(profile, userId));
  return true;
}

async function handleDungeonInfo(interaction, userId, dungeonLevel) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const dungeonProfile = getUserDungeonProfile(userId);
  const stage = getDungeonStageSelection(dungeonProfile, dungeonLevel);
  const infoContent = buildDungeonInfoContent(dungeonProfile, dungeonLevel, stage);

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(infoContent);
    return true;
  }

  await interaction.reply(infoContent);
  return true;
}

async function handleDungeonStageSelect(interaction, userId, dungeonLevel, stage) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  if (!stage || stage === 'locked') {
    await safeErrorReply(interaction, 'You have not unlocked any stages yet.');
    return true;
  }

  const dungeonProfile = getUserDungeonProfile(userId);
  dungeonProfile.currentStageByDungeon = {
    ...dungeonProfile.currentStageByDungeon,
    [String(dungeonLevel)]: Number(stage),
  };
  updateUserDungeonProfile(userId, dungeonProfile);

  await interaction.update(buildDungeonHomeContent(userId, dungeonProfile, dungeonLevel));
  return true;
}

async function handleDungeonAttackSelection(interaction, userId, creatureId) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const state = activeDungeons.get(userId);
  if (!state) {
    await safeErrorReply(interaction, 'This dungeon is no longer active.');
    return true;
  }

  if (state.isEnding || state.isTransitioning) {
    await safeErrorReply(interaction, 'This dungeon is not ready for actions yet.');
    return true;
  }

  recordDungeonInteraction(interaction, userId);

  const profile = getUserProfile(userId);
  state.player.gear = selectGear(profile);
  const target = performPlayerAttack(state, creatureId, state.player.gear);
  decrementGearDurability(profile, state.player.gear);
  updateUserProfile(userId, profile);

  const petMessages = performPetTurn(state);
  if (petMessages.length) {
    state.actionMessages = [...state.actionMessages, ...petMessages];
  }

  if (!target) {
    await interaction.update(
      buildBattleContent(state, interaction.user, await buildBattleAttachment(state, interaction.user))
    );
    recordDungeonInteraction(interaction, userId);
    return true;
  }

  if (target.health <= 0) {
    state.actionMessages[0] += ' The creature has been defeated.';
  }

  const aliveCreatures = state.creatures.filter((creature) => creature.health > 0);
  if (!aliveCreatures.length) {
    const stageData = state.stageData;
    const currentFloor = state.dungeon?.floor ?? 1;
    if (currentFloor < (stageData?.totalFloors ?? 1)) {
      clearDungeonFloorTimeout(userId);
      await runDungeonFloorTransition(interaction, state);
      const nextFloor = currentFloor + 1;
      state.dungeon.floor = nextFloor;
      state.creatures = buildDungeonCreatures(stageData, nextFloor);
      state.actionMessages = [];
      state.player.actionsLeft = ACTIONS_PER_TURN;
      state.isTransitioning = false;
      scheduleDungeonFloorTimeout(interaction, userId);
      const attachment = await buildBattleAttachment(state, interaction.user);
      await interaction.editReply(buildBattleContent(state, interaction.user, attachment));
      recordDungeonInteraction(interaction, userId);
      return true;
    }

    const dungeonProfile = getUserDungeonProfile(userId);
    const firstWin = isDungeonFirstWin(dungeonProfile, state.dungeon?.level ?? 1, state.dungeon?.stage ?? 1);
    const rewards = calculateDungeonRewards(stageData, firstWin);
    const leveledUp = applyRewards(userId, profile, rewards);
    const petProfile = getUserPetProfile(userId);
    const { profile: updatedPetProfile } = addXpToEquippedPets(petProfile, rewards.xp);
    updateUserPetProfile(userId, updatedPetProfile);
    const firstWinItems = [];
    if (firstWin) {
      for (const itemReward of stageData.rewards.items ?? []) {
        const item = findItemById(itemReward.itemId);
        if (!item) {
          continue;
        }
        addItemToInventory(profile, item, itemReward.amount);
        firstWinItems.push({ item, amount: itemReward.amount });
      }
    }
    updateUserProfile(userId, profile);

    markDungeonStageCompleted(dungeonProfile, state.dungeon?.level ?? 1, state.dungeon?.stage ?? 1);
    if (firstWin) {
      markDungeonFirstWin(dungeonProfile, state.dungeon?.level ?? 1, state.dungeon?.stage ?? 1);
    }
    updateUserDungeonProfile(userId, dungeonProfile);

    clearDungeonFloorTimeout(userId);
    await runDungeonEndCountdown(interaction, state, (endTimestampSeconds) =>
      `You have cleared Stage ${state.dungeon?.stage ?? 1}, exiting <t:${endTimestampSeconds}:R>.`
    );

    const homeContent = buildDungeonHomeContent(userId, dungeonProfile, state.dungeon?.level ?? 1);
    await interaction.editReply(homeContent);
    activeDungeons.delete(userId);

    try {
      await interaction.user.send(
        `## Dungeon ${state.dungeon?.level ?? 1} - Stage ${state.dungeon?.stage ?? 1} Rewards\n${buildDungeonRewardSummary(
          rewards,
          firstWinItems
        )}`
      );
    } catch (error) {
      console.warn('Failed to DM dungeon rewards:', error);
    }

    return true;
  }

  if (state.player.actionsLeft <= 0) {
    const playerMessages = [...state.actionMessages];
    const enemyMessages = resolveCreatureTurn(state);
    let diedReason = state.player.health <= 0 ? 'You died...' : null;
    const statusMessages = diedReason ? [] : applyStatusEffects(state);

    if (!diedReason && state.player.health <= 0) {
      diedReason = 'You died...';
    }

    if (diedReason) {
      clearDungeonFloorTimeout(userId);
      state.isEnding = true;
      await runDungeonEndCountdown(interaction, state, (endTimestampSeconds) =>
        `You have failed Stage ${state.dungeon?.stage ?? 1}, exiting <t:${endTimestampSeconds}:R>.`
      );
      const dungeonProfile = getUserDungeonProfile(userId);
      await interaction.editReply(buildDungeonHomeContent(userId, dungeonProfile, state.dungeon?.level ?? 1));
      activeDungeons.delete(userId);
      return true;
    }

    state.player.actionsLeft = ACTIONS_PER_TURN;
    if (state.player.actionPenalty) {
      state.player.actionsLeft = Math.max(0, state.player.actionsLeft - state.player.actionPenalty);
      state.player.actionPenalty = 0;
    }
    state.actionMessages = [
      ...playerMessages,
      ...enemyMessages,
      ...statusMessages,
      'Your actions have been refreshed for the next turn.',
    ];
  }

  const attachment = await buildBattleAttachment(state, interaction.user);
  const content = buildBattleContent(state, interaction.user, attachment);
  await interaction.update(content);
  recordDungeonInteraction(interaction, userId);
  return true;
}

async function handleAttackSelection(interaction, userId, creatureId) {
  if (interaction.user.id !== userId) {
    await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
    return true;
  }

  const state = activeHunts.get(userId);
  if (!state) {
    await safeErrorReply(interaction, 'This hunt is no longer active.');
    return true;
  }

  if (state.isEnding) {
    await safeErrorReply(interaction, 'This hunt is ending. Please wait for the result.');
    return true;
  }

  recordHuntActivity(interaction, userId);

  const profile = getUserProfile(userId);
  state.player.gear = selectGear(profile);
  const target = performPlayerAttack(state, creatureId, state.player.gear);
  decrementGearDurability(profile, state.player.gear);
  updateUserProfile(userId, profile);

  const petMessages = performPetTurn(state);
  if (petMessages.length) {
    state.actionMessages = [...state.actionMessages, ...petMessages];
  }

  if (!target) {
    await interaction.update(buildBattleContent(state, interaction.user, await buildBattleAttachment(state, interaction.user)));
    recordHuntActivity(interaction, userId);
    return true;
  }

  if (target.health <= 0) {
    state.actionMessages[0] += ' The creature has been defeated.';
  }

  const aliveCreatures = state.creatures.filter((creature) => creature.health > 0);
  if (!aliveCreatures.length) {
    const rewards = calculateRewards(state.initialCreatures);
    const drops = rollCreatureDrops(state.initialCreatures);
    const grantedDrops = applyDrops(profile, drops);
    const leveledUp = applyRewards(userId, profile, rewards);
    const petProfile = getUserPetProfile(userId);
    const { profile: updatedPetProfile } = addXpToEquippedPets(petProfile, rewards.xp);
    updateUserPetProfile(userId, updatedPetProfile);
    updateUserProfile(userId, profile);
    clearHuntInactivityTimeout(userId);
    state.isEnding = true;
    await runHuntEndCountdown(interaction, state, (endTimestampSeconds) =>
      `You have defeated all creatures. Hunt ending <t:${endTimestampSeconds}:R>.`
    );
    const successContent = buildSuccessContent(
      profile,
      userId,
      state.initialCreatures,
      rewards,
      leveledUp,
      grantedDrops
    );
    await interaction.editReply(successContent);
    activeHunts.delete(userId);
    return true;
  }

  if (state.player.actionsLeft <= 0) {
    const playerMessages = [...state.actionMessages];
    const enemyMessages = resolveCreatureTurn(state);
    let diedReason = state.player.health <= 0 ? 'You died...' : null;
    const statusMessages = diedReason ? [] : applyStatusEffects(state);

    if (!diedReason && state.player.health <= 0) {
      diedReason = 'You died...';
    }

    state.actionMessages = [...playerMessages, ...enemyMessages, ...statusMessages];

    if (diedReason) {
      clearHuntInactivityTimeout(userId);
      state.isEnding = true;
      await runHuntEndCountdown(interaction, state, (endTimestampSeconds) =>
        `You have died, hunt ending <t:${endTimestampSeconds}:R>.`
      );
      const failureContent = buildFailureContent(profile, userId, state.initialCreatures, diedReason);
      await interaction.editReply(failureContent);
      activeHunts.delete(userId);
      return true;
    }

    state.player.actionsLeft = ACTIONS_PER_TURN;
    if (state.player.actionPenalty) {
      state.player.actionsLeft = Math.max(0, state.player.actionsLeft - state.player.actionPenalty);
      state.player.actionPenalty = 0;
    }
    state.actionMessages = [
      ...state.actionMessages,
      'Your actions have been refreshed for the next turn.',
    ];
  }

  const attachment = await buildBattleAttachment(state, interaction.user);
  const content = buildBattleContent(state, interaction.user, attachment);
  await interaction.update(content);
  recordHuntActivity(interaction, userId);
  return true;
}

async function handleDungeonComponent(interaction) {
  if (interaction.isButton() && interaction.customId.startsWith(DUNGEON_BUTTON_PREFIX)) {
    const [, action, userId, dungeonLevel] = interaction.customId.split(':');
    if (action === 'start') {
      return handleDungeonStart(interaction, userId, Number(dungeonLevel));
    }
    if (action === 'info') {
      return handleDungeonInfo(interaction, userId, Number(dungeonLevel));
    }
    await safeErrorReply(interaction, 'Unknown dungeon action.');
    return true;
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(DUNGEON_SELECT_PREFIX)) {
    const [, dungeonLevel, userId] = interaction.customId.split(':');
    const stage = interaction.values?.[0];
    return handleDungeonStageSelect(interaction, userId, Number(dungeonLevel), stage);
  }

  if (interaction.isStringSelectMenu() && interaction.customId.startsWith(DUNGEON_ATTACK_SELECT_PREFIX)) {
    const userId = interaction.customId.replace(DUNGEON_ATTACK_SELECT_PREFIX, '');
    const selectedId = interaction.values?.[0];
    return handleDungeonAttackSelection(interaction, userId, selectedId);
  }

  return false;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('hunt')
    .setDescription("Open the hunting menu using Discord's components v2."),

  async execute(interaction) {
    maybeGrantOwnerPet(interaction);
    const profile = getUserProfile(interaction.user.id);
    getUserPetProfile(interaction.user.id);
    const content = buildHomeContent(profile, interaction.user.id);
    await interaction.reply(content);
  },

  async handleComponent(interaction) {
    if (interaction.isButton() && interaction.customId.startsWith(HUNT_BUTTON_PREFIX)) {
      const [, action, userId] = interaction.customId.split(':');
      return handleNavigation(interaction, action, userId);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(HUNT_ATTACK_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(HUNT_ATTACK_SELECT_PREFIX, '');
      const selectedId = interaction.values?.[0];
      return handleAttackSelection(interaction, userId, selectedId);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(TEAM_SLOT_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(TEAM_SLOT_SELECT_PREFIX, '');
      const slot = interaction.values?.[0];
      return handleTeamSlotSelect(interaction, userId, slot);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(TEAM_PET_SELECT_PREFIX)) {
      const [userId, slot] = interaction.customId.replace(TEAM_PET_SELECT_PREFIX, '').split(':');
      const selectedPet = interaction.values?.[0];
      return handleTeamPetSelection(interaction, userId, slot, selectedPet);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(TEAM_TARGET_SELECT_PREFIX)) {
      const [userId, slot] = interaction.customId.replace(TEAM_TARGET_SELECT_PREFIX, '').split(':');
      const targetType = interaction.values?.[0];
      return handleTeamTargetSelection(interaction, userId, slot, targetType);
    }

    if (interaction.isButton() && interaction.customId.startsWith(TEAM_SUBMIT_PREFIX)) {
      const [userId, slot] = interaction.customId.replace(TEAM_SUBMIT_PREFIX, '').split(':');
      return handleTeamSubmit(interaction, userId, slot);
    }

    if (interaction.isButton() && interaction.customId.startsWith(TEAM_UNEQUIP_PREFIX)) {
      const [userId, slot] = interaction.customId.replace(TEAM_UNEQUIP_PREFIX, '').split(':');
      return handleTeamUnequip(interaction, userId, slot);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(HUNT_SELECT_PREFIX)) {
      const [, type, userId] = interaction.customId.split(':');
      return handleSelect(interaction, type, userId);
    }

    return false;
  },

  buildDungeonHomeContent,
  handleDungeonComponent,
};
