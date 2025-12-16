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
  addItemToInventory,
  getUserProfile,
  normalizeGearItem,
  updateUserProfile,
} = require('../src/huntProfile');
const { addCoinsToUser } = require('../src/userStats');
const { JUNGLE_BETTLE } = require('../src/creatures');
const {
  addPetToInventory,
  buildBattlePets,
  findPetInstance,
  getUserPetProfile,
  updateUserPetProfile,
} = require('../src/pets');

const HUNT_BUTTON_PREFIX = 'hunt:';
const HUNT_SELECT_PREFIX = 'hunt-select:';
const HUNT_ATTACK_SELECT_PREFIX = 'hunt-attack:';
const TEAM_SLOT_SELECT_PREFIX = 'hunt-team-slot:';
const TEAM_PET_SELECT_PREFIX = 'hunt-team-pet:';
const TEAM_TARGET_SELECT_PREFIX = 'hunt-team-target:';
const TEAM_SUBMIT_PREFIX = 'hunt-team-submit:';
const HUNT_THUMBNAIL = 'https://cdn.discordapp.com/emojis/1447497801033453589.png?size=128&quality=lossless';
const HEART_EMOJI = '<:SBHeart:1447532986378485882>';
const DEFENSE_EMOJI = '<:SBDefense:1447532983933472900>';
const COIN_EMOJI = '<:CRCoin:1447459216574124074>';
const UPGRADE_TOKEN_EMOJI = '<:ITUpgradeToken:1447502158059540481>';

const CREATURE_HEALTH_GROWTH = 0.5;
const CREATURE_DAMAGE_GROWTH = 0.35;
const CREATURE_REWARD_GROWTH = 0.25;

const HUNTING_DELAY_MS = 3000;
const CRIT_CHANCE = 0.15;
const ACTIONS_PER_TURN = 2;

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const activeHunts = new Map();
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

function createJungleBettle() {
  const level = pickCreatureLevel(JUNGLE_BETTLE.levelDistribution);
  const health = scaleStatForLevel(JUNGLE_BETTLE.baseHealth, level, CREATURE_HEALTH_GROWTH);
  const minDamage = scaleStatForLevel(JUNGLE_BETTLE.damage.min, level, CREATURE_DAMAGE_GROWTH);
  const maxDamage = scaleStatForLevel(JUNGLE_BETTLE.damage.max, level, CREATURE_DAMAGE_GROWTH);

  return {
    id: `${JUNGLE_BETTLE.name}-${Date.now()}-${Math.random()}`,
    name: JUNGLE_BETTLE.name,
    emoji: JUNGLE_BETTLE.emoji,
    rarity: JUNGLE_BETTLE.rarity,
    rarityEmoji: JUNGLE_BETTLE.rarityEmoji,
    level,
    maxHealth: health,
    health,
    damage: { min: minDamage, max: maxDamage },
    drops: JUNGLE_BETTLE.drops ?? [],
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
            type: 10,
            content: '-# Misc selection will be available later.',
          },
        ],
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
          { type: 14 },
          buildNavigationRow({ userId: user.id, view: 'team' }),
        ],
      },
    ],
  };
}

function buildTeamEditContent(user, petProfile, slot, state = {}) {
  const slotNumber = Number(slot);
  const selectedPetId = state.petInstanceId ?? petProfile.team?.[slotNumber - 1]?.petInstanceId ?? null;
  const selectedPet = selectedPetId ? findPetInstance(petProfile, selectedPetId) : null;
  const targetType = state.targetType ?? petProfile.team?.[slotNumber - 1]?.targetType ?? null;

  const hasPets = (petProfile.inventory ?? []).length > 0;
  const placeholderPet = hasPets ? 'Choose an army/pet' : "You don't have any pet/army";
  const petOptions = (petProfile.inventory ?? []).map((pet) => ({
    label: `${pet.name} (Lv ${pet.level})`,
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

  return {
    flags: MessageFlags.Ephemeral,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `## You are editting slot #${slotNumber}\n### Army/Pet selected: ${
              selectedPet ? `${selectedPet.name} ${selectedPet.emoji ?? ''}` : 'None'
            }\n-# Target type: ${targetType ?? 'Not selected'}`,
          },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${TEAM_PET_SELECT_PREFIX}${user.id}:${slotNumber}`,
                placeholder: placeholderPet,
                options: petOptions.length ? petOptions : [{ label: placeholderPet, value: 'none', default: true }],
                disabled: !hasPets,
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
                style: 3,
                custom_id: `${TEAM_SUBMIT_PREFIX}${user.id}:${slotNumber}`,
                label: 'SUBMIT',
                disabled: !(selectedPet && targetType),
              },
            ],
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
  const creatures = [createJungleBettle()];
  const pets = buildBattlePets(petProfile ?? { team: [], inventory: [] });

  return {
    userId: user.id,
    player: {
      name: user.globalName ?? user.username,
      level: profile.level,
      maxHealth,
      health: maxHealth,
      defense: profile.defense,
      actionsLeft: ACTIONS_PER_TURN,
      gear,
      pets,
    },
    creatures,
    initialCreatures: creatures.map((creature) => ({
      name: creature.name,
      level: creature.level,
      drops: creature.drops ?? [],
    })),
    pets,
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
  return state.creatures
    .filter((creature) => creature.health > 0)
    .map((creature) => ({
      label: `${creature.name} ${formatCreatureLevel(creature.level)} (${creature.health}/${creature.maxHealth})`,
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
  const rewards = { coins: 0, xp: 0 };
  for (const creature of creatures) {
    const level = creature.level ?? 1;
    const coinMin = scaleStatForLevel(JUNGLE_BETTLE.reward.coins.min, level, CREATURE_REWARD_GROWTH);
    const coinMax = scaleStatForLevel(JUNGLE_BETTLE.reward.coins.max, level, CREATURE_REWARD_GROWTH);
    const xpMin = scaleStatForLevel(JUNGLE_BETTLE.reward.xp.min, level, CREATURE_REWARD_GROWTH);
    const xpMax = scaleStatForLevel(JUNGLE_BETTLE.reward.xp.max, level, CREATURE_REWARD_GROWTH);

    rewards.coins += rollDamage(coinMin, coinMax);
    rewards.xp += rollDamage(xpMin, xpMax);
  }
  return rewards;
}

function rollCreatureDrops(creatures) {
  const drops = [];

  for (const creature of creatures) {
    for (const drop of creature.drops ?? []) {
      const chance = typeof drop.chance === 'number' ? drop.chance : 0;
      if (Math.random() > chance) {
        continue;
      }

      const amount = Number.isFinite(drop.amount) ? drop.amount : 1;
      const item = findItemById(drop.itemId);
      if (item) {
        drops.push({ item, amount });
      }
    }
  }

  return drops;
}

function applyRewards(userId, profile, rewards) {
  let leveledUp = 0;
  profile.coins = Math.max(0, profile.coins + rewards.coins);
  profile.xp = Math.max(0, profile.xp + rewards.xp);

  addCoinsToUser(userId, rewards.coins);

  while (profile.xp >= profile.next_level_xp) {
    profile.xp -= profile.next_level_xp;
    profile.level += 1;
    leveledUp += 1;
    profile.upgrade_tokens += 5;
  }

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

function resolveCreatureTurn(state) {
  const messages = [];
  for (const creature of state.creatures) {
    if (creature.health <= 0 || state.player.health <= 0) {
      continue;
    }
    const hits = Math.max(1, creature.hits ?? (creature.attackType === 'Multi' ? 2 : 1));
    for (let i = 0; i < hits; i++) {
      const damage = rollDamage(creature.damage.min, creature.damage.max);
      const mitigated = Math.max(0, damage - (state.player.defense ?? 0));
      const finalDamage = Math.max(1, mitigated);
      state.player.health = Math.max(0, state.player.health - finalDamage);
      messages.push(`${creature.name} has **Bitten** you and dealth **${finalDamage} damages**.`);
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
  }));

  const player = {
    name: state.player.name,
    avatar,
    level: state.player.level,
    maxHp: state.player.maxHealth,
    hp: state.player.health,
    defense: state.player.defense,
    shield: state.player.defense,
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
  }));

  const buffer = await createHuntBattleImage({ player, enemies });
  return new AttachmentBuilder(buffer, { name: 'hunt-battle.png' });
}

function buildBattleContent(state, user, attachment) {
  const creatures = state.creatures.filter((creature) => creature.health > 0);
  const thumbnail = getEmojiUrl(creatures[0]?.emoji ?? JUNGLE_BETTLE.emoji) ?? HUNT_THUMBNAIL;

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
          {
            type: 10,
            content: `-# You have \`${state.player.actionsLeft} action${
              state.player.actionsLeft === 1 ? '' : 's'
            }\` left`,
          },
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
  maybeGrantOwnerPet(interaction);
  const profile = getUserProfile(interaction.user.id);
  const petProfile = getUserPetProfile(interaction.user.id);
  const battleState = createBattleState(profile, interaction.user, petProfile);
  activeHunts.set(interaction.user.id, battleState);

  await interaction.update(buildHuntDelayContent());

  setTimeout(async () => {
    try {
      const attachment = await buildBattleAttachment(battleState, interaction.user);
      const content = buildBattleContent(battleState, interaction.user, attachment);
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

  const state = teamEditState.get(userId) ?? {};
  const petProfile = getUserPetProfile(userId);
  state.slot = Number(slot);
  state.petInstanceId = petInstanceId === 'none' ? null : petInstanceId;
  teamEditState.set(userId, state);

  await interaction.update(buildTeamEditContent(interaction.user, petProfile, slot, state));
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

  petProfile.team[slotIndex] = { petInstanceId: state.petInstanceId, targetType: state.targetType };
  updateUserPetProfile(userId, petProfile);
  teamEditState.delete(userId);

  const confirmation = buildTeamEditContent(interaction.user, petProfile, slot, {
    petInstanceId: state.petInstanceId,
    targetType: state.targetType,
  });

  try {
    const channel = await interaction.client.channels.fetch(state.channelId);
    const huntMessage = await channel.messages.fetch(state.huntMessageId);
    await huntMessage.edit(buildTeamContent(interaction.user, petProfile));
  } catch (error) {
    console.warn('Failed to update hunt team message:', error);
  }

  await interaction.update(confirmation);
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

  const petMessages = performPetTurn(state);
  if (petMessages.length) {
    state.actionMessages = [...state.actionMessages, ...petMessages];
  }

  if (!target) {
    await interaction.update(buildBattleContent(state, interaction.user, await buildBattleAttachment(state, interaction.user)));
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
    updateUserProfile(userId, profile);
    const successContent = buildSuccessContent(
      profile,
      userId,
      state.initialCreatures,
      rewards,
      leveledUp,
      grantedDrops
    );
    await interaction.update(successContent);
    activeHunts.delete(userId);
    return true;
  }

  if (state.player.actionsLeft <= 0) {
    const playerMessages = [...state.actionMessages];
    const enemyMessages = resolveCreatureTurn(state);

    if (state.player.health <= 0) {
      const failureContent = buildFailureContent(profile, userId, state.initialCreatures, 'You died...');
      await interaction.update(failureContent);
      activeHunts.delete(userId);
      return true;
    }

    state.player.actionsLeft = ACTIONS_PER_TURN;
    state.actionMessages = [
      ...playerMessages,
      ...enemyMessages,
      'Your actions have been refreshed for the next turn.',
    ];
  }

  const attachment = await buildBattleAttachment(state, interaction.user);
  const content = buildBattleContent(state, interaction.user, attachment);
  await interaction.update(content);
  return true;
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

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(HUNT_SELECT_PREFIX)) {
      const [, type, userId] = interaction.customId.split(':');
      return handleSelect(interaction, type, userId);
    }

    return false;
  }
};
