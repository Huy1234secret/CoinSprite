const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, SlashCommandBuilder, MessageFlags } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const { createHuntBattleImage } = require('../src/huntImage');

const HUNT_BUTTON_PREFIX = 'hunt:';
const HUNT_SELECT_PREFIX = 'hunt-select:';
const HUNT_ATTACK_SELECT_PREFIX = 'hunt-attack:';
const HUNT_THUMBNAIL = 'https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless';
const HEART_EMOJI = '<:SBHeart:1447532986378485882>';
const DEFENSE_EMOJI = '<:SBDefense:1447532983933472900>';
const COIN_EMOJI = '<:SBCoin:1447468020152463411>';
const UPGRADE_TOKEN_EMOJI = '<:ITUpgradeToken:1447502158059540481>';

const HUNTING_DELAY_MS = 3000;
const CRIT_CHANCE = 0.15;

const FIST_GEAR = {
  id: 'ITFist',
  name: 'Fist',
  emoji: '<:ITFist:1449009707355476069>',
  rarity: 'Common',
  value: 0,
  sellPrice: 0,
  tradable: false,
  durability: Infinity,
  maxDurability: Infinity,
  damage: { min: 1, max: 5 },
  info: 'Useable as a gear in Hunt, deal 1 - 5 damages per hit.'
};

const WOODEN_SWORD_GEAR = {
  id: 'ITWoodenSword',
  name: 'Wooden Sword',
  emoji: '<:ITWoodenSword:1448987035363704955>',
  rarity: 'Common',
  value: 13,
  sellPrice: 100,
  tradable: true,
  durability: 50,
  maxDurability: 50,
  damage: { min: 3, max: 8 },
  info: 'Useable as a gear in Hunt, deal 3 - 8 damages per hit. Lose 1 durability per hit.'
};

const UPGRADE_TOKEN_ITEM = {
  id: 'ITUpgradeToken',
  name: 'Upgrade Token',
  emoji: '<:ITUpgradeToken:1447502158059540481>',
  rarity: 'Rare',
  value: 300,
  sellPrice: null,
  tradable: false,
  durability: null,
  info: 'Coming soon'
};

const KNOWN_GEAR = {
  [FIST_GEAR.name]: FIST_GEAR,
  [WOODEN_SWORD_GEAR.name]: WOODEN_SWORD_GEAR
};

const JUNGLE_BETTLE = {
  name: 'Jungle Bettle',
  emoji: '<:MCJungleBettle:1448989040509452338>',
  baseHealth: 15,
  damage: { min: 1, max: 2 },
  reward: { coins: { min: 50, max: 200 }, xp: { min: 10, max: 40 } },
  levelDistribution: [
    { level: 1, chance: 0.65 },
    { level: 2, chance: 0.3 },
    { level: 3, chance: 0.045 },
    { level: 4, chance: 0.005 }
  ]
};

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const activeHunts = new Map();

const HUNT_DATA_FILE = path.join(__dirname, '..', 'data', 'hunt_profiles.json');
const DEFAULT_PROFILE = {
  level: 1,
  xp: 0,
  next_level_xp: 100,
  health: 100,
  max_health: 100,
  defense: 0,
  coins: 0,
  upgrade_tokens: 0,
  gear_equipped: null,
  misc_equipped: null,
  gear_inventory: [WOODEN_SWORD_GEAR],
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
  const normalizedGearInventory = normalizeGearInventory(
    Array.isArray(profile.gear_inventory) ? profile.gear_inventory : []
  );
  const normalizedEquipped = profile.gear_equipped ? normalizeGearItem(profile.gear_equipped) : null;
  const gearEquipped = normalizedEquipped || normalizedGearInventory[0] || null;
  return {
    ...DEFAULT_PROFILE,
    ...profile,
    gear_equipped: gearEquipped,
    gear_inventory: normalizedGearInventory,
    misc_inventory: Array.isArray(profile.misc_inventory) ? profile.misc_inventory : [],
    max_health: typeof profile.max_health === 'number' ? profile.max_health : DEFAULT_PROFILE.max_health,
    coins: typeof profile.coins === 'number' ? profile.coins : DEFAULT_PROFILE.coins,
    upgrade_tokens:
      typeof profile.upgrade_tokens === 'number' ? profile.upgrade_tokens : DEFAULT_PROFILE.upgrade_tokens,
  };
}

function normalizeGearItem(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }

  const lookupKey = item.name ?? item.id;
  const known = lookupKey ? KNOWN_GEAR[lookupKey] : null;
  const base = known ? { ...known } : { ...item };
  const durability = Number.isFinite(item.durability) ? item.durability : base.durability;

  return {
    ...base,
    ...item,
    durability,
    maxDurability:
      item.maxDurability ?? (Number.isFinite(base.maxDurability) ? base.maxDurability : durability),
  };
}

function normalizeGearInventory(list) {
  const normalized = list.map(normalizeGearItem).filter(Boolean);
  const hasWoodenSword = normalized.some((item) => item?.name === WOODEN_SWORD_GEAR.name);
  if (!hasWoodenSword) {
    normalized.unshift({ ...WOODEN_SWORD_GEAR });
  }
  return normalized;
}

function calculatePlayerMaxHealth(level, baseHealth = DEFAULT_PROFILE.max_health) {
  return Math.round(baseHealth * Math.pow(1.25, Math.max(0, level - 1)));
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

function createJungleBettle() {
  const level = pickCreatureLevel(JUNGLE_BETTLE.levelDistribution);
  const health = scaleStatForLevel(JUNGLE_BETTLE.baseHealth, level, 0.5);
  const minDamage = scaleStatForLevel(JUNGLE_BETTLE.damage.min, level, 0.5);
  const maxDamage = scaleStatForLevel(JUNGLE_BETTLE.damage.max, level, 0.5);

  return {
    id: `${JUNGLE_BETTLE.name}-${Date.now()}-${Math.random()}`,
    name: JUNGLE_BETTLE.name,
    emoji: JUNGLE_BETTLE.emoji,
    level,
    maxHealth: health,
    health,
    damage: { min: minDamage, max: maxDamage },
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

function getUserProfile(userId) {
  const profiles = loadProfiles();
  const userKey = String(userId);
  const existing = ensureProfileShape(profiles[userKey]);
  const scaledHealth = calculatePlayerMaxHealth(existing.level, DEFAULT_PROFILE.max_health);
  existing.health = scaledHealth;
  existing.max_health = scaledHealth;
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
  if (!profile.gear_equipped) {
    return `${FIST_GEAR.name} ${FIST_GEAR.emoji}`;
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

function buildSelectOptions(items, equippedName, includeFist = false) {
  const options = [];
  if (includeFist) {
    options.push({
      label: FIST_GEAR.name,
      value: FIST_GEAR.name,
      emoji: FIST_GEAR.emoji,
      default: equippedName ? equippedName === FIST_GEAR.name : undefined,
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
      default: equippedName ? equippedName === name : undefined,
    });
  }

  if (!options.length) {
    options.push({ label: 'No items available', value: 'none', default: true });
  }

  return options;
}

function buildEquipmentContainers(profile, userId) {
  const gearName = profile.gear_equipped?.name ?? FIST_GEAR.name;
  const gearEmoji = profile.gear_equipped?.emoji ?? FIST_GEAR.emoji;
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
            options: buildSelectOptions(
              profile.gear_inventory ?? [],
              profile.gear_equipped?.name,
              true
            ),
            disabled: false,
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
    flags: COMPONENTS_V2_FLAG,
    components: [buildHomeContainer(profile, userId)],
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

function getEmojiUrl(emoji) {
  const match = emoji?.match(/<:[^:]+:(\d+)>/);
  if (!match) {
    return null;
  }
  return `https://cdn.discordapp.com/emojis/${match[1]}.png?size=128&quality=lossless`;
}

function createBattleState(profile, user) {
  const gear = selectGear(profile);
  const maxHealth = calculatePlayerMaxHealth(profile.level, DEFAULT_PROFILE.max_health);
  const creatures = [createJungleBettle()];

  return {
    userId: user.id,
    player: {
      name: user.globalName ?? user.username,
      level: profile.level,
      maxHealth,
      health: maxHealth,
      defense: profile.defense,
      actionsLeft: 2,
      gear,
    },
    creatures,
    initialCreatures: creatures.map((creature) => ({ name: creature.name })),
    actionMessages: [],
    miscInventory: profile.misc_inventory ?? [],
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

  if (target.durability <= 0) {
    profile.gear_inventory = inventory.filter((item) => item && item.name !== gear.name);
    if (profile.gear_equipped?.name === gear.name) {
      profile.gear_equipped = null;
    }
  }
}

function buildCreatureOptions(state) {
  return state.creatures
    .filter((creature) => creature.health > 0)
    .map((creature) => ({
      label: `${creature.name} ${formatCreatureLevel(creature.level)} (${creature.health}/${creature.maxHealth})`,
      value: creature.id,
      emoji: creature.emoji,
    }));
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
  const rewards = { coins: 0, xp: 0 };
  for (const creature of creatures) {
    rewards.coins += rollDamage(JUNGLE_BETTLE.reward.coins.min, JUNGLE_BETTLE.reward.coins.max);
    rewards.xp += rollDamage(JUNGLE_BETTLE.reward.xp.min, JUNGLE_BETTLE.reward.xp.max);
  }
  return rewards;
}

function applyRewards(profile, rewards) {
  let leveledUp = 0;
  profile.coins = Math.max(0, profile.coins + rewards.coins);
  profile.xp = Math.max(0, profile.xp + rewards.xp);

  while (profile.xp >= profile.next_level_xp) {
    profile.xp -= profile.next_level_xp;
    profile.level += 1;
    leveledUp += 1;
    profile.upgrade_tokens += 5;
  }

  const scaledHealth = calculatePlayerMaxHealth(profile.level, DEFAULT_PROFILE.max_health);
  profile.max_health = scaledHealth;
  profile.health = scaledHealth;
  return leveledUp;
}

function rewardLines(rewards, leveledUp) {
  const lines = [
    `-# * ${rewards.coins} coins ${COIN_EMOJI}`,
    `-# * ${rewards.xp} Hunt XP`,
  ];
  if (leveledUp > 0) {
    lines.push(`-# * ${leveledUp * 5} Upgrade Tokens ${UPGRADE_TOKEN_EMOJI}`);
  }
  return lines.join('\n');
}

function buildSuccessContent(profile, userId, creatures, rewards, leveledUp) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x2ecc71,
        components: [
          {
            type: 10,
            content: `## Hunting\nYou have successfully hunted ${creatureListText(creatures)} and got:\n${rewardLines(rewards, leveledUp)}`,
          },
        ],
      },
      { type: 14 },
      buildHomeContainer(profile, userId),
    ],
  };
}

function buildFailureContent(profile, userId, creatures, diedReason) {
  const failureLine = diedReason ?? 'You ran out of actions...';
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xe74c3c,
        components: [
          {
            type: 10,
            content: `## Hunting\nYou have failed hunting ${creatureListText(creatures)}.\n-# ${failureLine}`,
          },
        ],
      },
      { type: 14 },
      buildHomeContainer(profile, userId),
    ],
  };
}

function resolveCreatureTurn(state) {
  const messages = [];
  for (const creature of state.creatures) {
    if (creature.health <= 0 || state.player.health <= 0) {
      continue;
    }
    const damage = rollDamage(creature.damage.min, creature.damage.max);
    const mitigated = Math.max(0, damage - (state.player.defense ?? 0));
    const finalDamage = Math.max(1, mitigated);
    state.player.health = Math.max(0, state.player.health - finalDamage);
    messages.push(`${creature.name} attacked you and dealt **${finalDamage} damages**.`);
  }
  state.actionMessages = messages;
  return messages;
}

async function buildBattleAttachment(state, user) {
  const avatar = user.displayAvatarURL({ extension: 'png', size: 256 });
  const player = {
    name: state.player.name,
    avatar,
    level: state.player.level,
    maxHp: state.player.maxHealth,
    hp: state.player.health,
    defense: state.player.defense,
    shield: state.player.defense,
    team: [],
  };

  const enemies = state.creatures.map((creature) => ({
    label: `${creature.name} ${formatCreatureLevel(creature.level)}`,
    level: creature.level,
    hp: creature.health,
    maxHp: creature.maxHealth,
    shield: 0,
    accentColor: '#1abc9c',
    avatar: getEmojiUrl(creature.emoji) ?? HUNT_THUMBNAIL,
  }));

  const buffer = await createHuntBattleImage({ player, enemies });
  return new AttachmentBuilder(buffer, { name: 'hunt-battle.png' });
}

function buildBattleContent(state, user, attachment, profile) {
  const creatures = state.creatures.filter((creature) => creature.health > 0);
  const thumbnail = getEmojiUrl(creatures[0]?.emoji ?? JUNGLE_BETTLE.emoji) ?? HUNT_THUMBNAIL;
  const miscOptions = buildMiscOptions(profile);

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `### You found a ${creatures[0]?.name ?? JUNGLE_BETTLE.name}`,
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
          { type: 10, content: `-# You have \`${state.player.actionsLeft} action\` left` },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${HUNT_ATTACK_SELECT_PREFIX}${user.id}`,
                placeholder: 'Select a creature to attack',
                options: buildCreatureOptions(state),
                disabled: !creatures.length || state.player.actionsLeft <= 0,
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
                custom_id: `${HUNT_SELECT_PREFIX}misc:${user.id}`,
                placeholder: (profile.misc_inventory ?? []).length
                  ? 'Use a misc'
                  : "You don't have any misc",
                options: miscOptions,
                disabled: !(profile.misc_inventory ?? []).length,
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
  creature.health = Math.max(0, creature.health - amount);
  state.player.actionsLeft = Math.max(0, state.player.actionsLeft - 1);

  const actionText = crit
    ? `### You have used **${gear.name}** on ${creature.name} and deal a CRIT damage of **${amount}**!`
    : `You have used **${gear.name}** on ${creature.name} and deal **${amount} damages**.`;

  state.actionMessages = [actionText];
  return creature;
}

async function handleStartHunt(interaction) {
  const profile = getUserProfile(interaction.user.id);
  const battleState = createBattleState(profile, interaction.user);
  activeHunts.set(interaction.user.id, battleState);

  await interaction.update(buildHuntDelayContent());

  setTimeout(async () => {
    try {
      const attachment = await buildBattleAttachment(battleState, interaction.user);
      const content = buildBattleContent(battleState, interaction.user, attachment, profile);
      await interaction.editReply(content);
    } catch (error) {
      console.error('Failed to start hunt:', error);
    }
  }, HUNTING_DELAY_MS);
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
  if (type === 'gear' && value === FIST_GEAR.name) {
    profile[equippedKey] = { ...FIST_GEAR };
    return profile;
  }

  const selectedItem = list.find((item) => item && item.name === value);

  if (selectedItem) {
    profile[equippedKey] = normalizeGearItem(selectedItem);
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

  const profile = getUserProfile(userId);
  state.player.gear = selectGear(profile);
  const target = performPlayerAttack(state, creatureId, state.player.gear);
  decrementGearDurability(profile, state.player.gear);
  updateUserProfile(userId, profile);

  if (!target) {
    await interaction.update(buildBattleContent(state, interaction.user, await buildBattleAttachment(state, interaction.user), profile));
    return true;
  }

  if (target.health <= 0) {
    state.actionMessages[0] += ' The creature has been defeated.';
  }

  const aliveCreatures = state.creatures.filter((creature) => creature.health > 0);
  if (!aliveCreatures.length) {
    const rewards = calculateRewards(state.initialCreatures);
    const leveledUp = applyRewards(profile, rewards);
    updateUserProfile(userId, profile);
    const successContent = buildSuccessContent(profile, userId, state.initialCreatures, rewards, leveledUp);
    await interaction.update(successContent);
    activeHunts.delete(userId);
    return true;
  }

  if (state.player.actionsLeft <= 0) {
    resolveCreatureTurn(state);

    if (state.player.health <= 0) {
      const failureContent = buildFailureContent(profile, userId, state.initialCreatures, 'You died...');
      await interaction.update(failureContent);
      activeHunts.delete(userId);
      return true;
    }

    const failureContent = buildFailureContent(profile, userId, state.initialCreatures, 'You ran out of actions...');
    await interaction.update(failureContent);
    activeHunts.delete(userId);
    return true;
  }

  const attachment = await buildBattleAttachment(state, interaction.user);
  const content = buildBattleContent(state, interaction.user, attachment, profile);
  await interaction.update(content);
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

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(HUNT_ATTACK_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(HUNT_ATTACK_SELECT_PREFIX, '');
      const selectedId = interaction.values?.[0];
      return handleAttackSelection(interaction, userId, selectedId);
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(HUNT_SELECT_PREFIX)) {
      const [, type, userId] = interaction.customId.split(':');
      return handleSelect(interaction, type, userId);
    }

    return false;
  }
};
