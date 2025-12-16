const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const {
  RARITY_EMOJIS,
  addPetToInventory,
  getPetDefinition,
  getUserPetProfile,
} = require('../src/pets');
const { buildProgressBar } = require('../src/userStats');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const RARITY_SELECT_PREFIX = 'pet-army:rarity:';
const PET_SELECT_PREFIX = 'pet-army:pet:';
const ACTION_BUTTON_PREFIX = 'pet-army:action-btn:';
const ACTION_SELECT_PREFIX = 'pet-army:action-select:';
const ACTION_ITEM_SELECT_PREFIX = 'pet-army:item-select:';

const activePetArmyStates = new Map();
const activePetArmyActions = new Map();

function maybeGrantOwnerPet(interaction) {
  if (!interaction.guild || interaction.user.id !== interaction.guild.ownerId) {
    return;
  }

  const petProfile = getUserPetProfile(interaction.user.id);
  const hasUfo = (petProfile.inventory ?? []).some((pet) => pet.id === 'PETUFO');
  if (!hasUfo) {
    addPetToInventory(interaction.user.id, 'PETUFO');
  }
}

function buildRaritySelect(userId, selected) {
  const options = Object.keys(RARITY_EMOJIS).map((rarity) => ({
    label: rarity,
    value: rarity,
    emoji: RARITY_EMOJIS[rarity],
    default: rarity === selected,
  }));

  return {
    type: 3,
    custom_id: `${RARITY_SELECT_PREFIX}${userId}`,
    placeholder: ' Filter rarity',
    options,
    min_values: 1,
    max_values: 1,
  };
}

function buildPetSelect(userId, pets, selectedPetId, enabled) {
  const placeholder = enabled ? 'Choose an army/pet' : 'Filter Rarity first';
  const options = pets.map((pet) => ({
    label: `${pet.name} (Lv ${pet.level})`,
    value: pet.instanceId,
    emoji: pet.emoji,
    default: pet.instanceId === selectedPetId,
  }));

  return {
    type: 3,
    custom_id: `${PET_SELECT_PREFIX}${userId}`,
    placeholder: pets.length ? placeholder : 'You don\'t have any',
    options: pets.length ? options : [{ label: 'You don\'t have any', value: 'none', default: true }],
    disabled: !enabled || !pets.length,
    min_values: 1,
    max_values: 1,
  };
}

function formatSkills(petDefinition) {
  const attacks = petDefinition?.attacks ?? [];
  if (!attacks.length) {
    return '- None';
  }

  return attacks
    .map((attack) => `* ${attack.name}: ${attack.damage?.min ?? 0} - ${attack.damage?.max ?? 0} damage (${attack.type ?? 'Singular'})`)
    .join('\n');
}

function formatPetDetails(user, pet, totalCount = 0) {
  const definition = getPetDefinition(pet.id) ?? pet;
  const nextXp = pet.nextLevelXp ?? null;
  const percent = nextXp ? Math.min(100, (pet.xp / Math.max(1, nextXp)) * 100) : 100;
  const progressBar = nextXp ? buildProgressBar(pet.xp, nextXp) : buildProgressBar(1, 1);

  return {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 10,
        content: `## ${user.username}'s Pet/Army\n-# You have ${totalCount} pet/army\n### ${pet.name}\n* Lv ${pet.level}\n-# ${progressBar} \`${pet.xp} / ${nextXp ?? 'Max'} - ${percent.toFixed(2)}%\``,
      },
      { type: 14 },
      {
        type: 10,
        content: `Stat:\n* Damage ⚔️: ${definition.attacks?.[0]?.damage?.min ?? 0} - ${definition.attacks?.[0]?.damage?.max ?? 0}\n* Defense <:SBDefense:1447532983933472900>: ${pet.defense ?? 0}\n* Skills:\n${formatSkills(definition)}`,
      },
    ],
    accessory: {
      type: 11,
      media: { url: pet.emoji ? `https://cdn.discordapp.com/emojis/${pet.emoji.replace(/[^\d]/g, '')}.png` : '' },
      description: 'Pet/Army avatar',
    },
  };
}

function buildPetArmyContent(user, petProfile, state) {
  const rarity = state.rarity ?? null;
  const filteredPets = rarity
    ? (petProfile.inventory ?? []).filter((pet) => pet.rarity === rarity)
    : [];
  const selectedPet = filteredPets.find((pet) => pet.instanceId === state.selectedPetId);

  const baseContainer = {
    type: 17,
    accent_color: 0xffffff,
    components: [
      {
        type: 10,
        content: `## ${user.username}'s Pet/Army\n-# You have ${(petProfile.inventory ?? []).length} pet/army.`,
      },
      {
        type: 1,
        components: [buildRaritySelect(user.id, rarity ?? undefined)],
      },
      {
        type: 1,
        components: [buildPetSelect(user.id, filteredPets, state.selectedPetId, Boolean(rarity))],
      },
    ],
  };

  if (!selectedPet) {
    return {
      flags: COMPONENTS_V2_FLAG,
      components: [baseContainer],
    };
  }

  const detailContainer = formatPetDetails(user, selectedPet, (petProfile.inventory ?? []).length);

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      detailContainer,
      baseContainer,
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            custom_id: `${ACTION_BUTTON_PREFIX}${user.id}:${selectedPet.instanceId}`,
            label: 'Choose action',
          },
        ],
      },
    ],
  };
}

function buildActionPrompt(userId) {
  return {
    flags: MessageFlags.Ephemeral,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          { type: 10, content: 'Choose and action' },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${ACTION_SELECT_PREFIX}${userId}`,
                placeholder: 'Actions',
                options: [
                  { label: 'Feed', value: 'Feed' },
                  { label: 'Promote', value: 'Promote' },
                ],
                min_values: 1,
                max_values: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

function buildActionDetail(userId, action) {
  const hasItems = false;
  const placeholder = hasItems ? 'Choose' : "You don't have any";
  const messageTitle = action === 'Promote' ? '## Promoting' : '## Feeding';
  const actionMsg = hasItems ? `${action} item selected` : '';

  return {
    flags: MessageFlags.Ephemeral,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `${messageTitle}\n* ${actionMsg}`,
          },
          {
            type: 1,
            components: [
              {
                type: 3,
                custom_id: `${ACTION_ITEM_SELECT_PREFIX}${userId}:${action}`,
                placeholder,
                options: hasItems
                  ? [{ label: 'Item', value: 'item-1' }]
                  : [{ label: "You don't have any", value: 'none', default: true }],
                disabled: !hasItems,
                min_values: 1,
                max_values: 1,
              },
            ],
          },
        ],
      },
    ],
  };
}

module.exports = {
  data: new SlashCommandBuilder().setName('my-pet-army').setDescription("Check your pet/army collection."),
  async execute(interaction) {
    maybeGrantOwnerPet(interaction);
    const petProfile = getUserPetProfile(interaction.user.id);
    const state = { rarity: null, selectedPetId: null };
    activePetArmyStates.set(interaction.user.id, state);
    await interaction.reply(buildPetArmyContent(interaction.user, petProfile, state));
  },

  async handleComponent(interaction) {
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(RARITY_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(RARITY_SELECT_PREFIX, '');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      const selected = interaction.values?.[0];
      const state = activePetArmyStates.get(userId) ?? { rarity: null, selectedPetId: null };
      state.rarity = selected;
      state.selectedPetId = null;
      activePetArmyStates.set(userId, state);
      const petProfile = getUserPetProfile(userId);
      await interaction.update(buildPetArmyContent(interaction.user, petProfile, state));
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(PET_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(PET_SELECT_PREFIX, '');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      const selectedPetId = interaction.values?.[0];
      if (selectedPetId === 'none') {
        await safeErrorReply(interaction, 'You do not have any pets of this rarity.');
        return true;
      }

      const state = activePetArmyStates.get(userId) ?? { rarity: null, selectedPetId: null };
      state.selectedPetId = selectedPetId;
      activePetArmyStates.set(userId, state);

      const petProfile = getUserPetProfile(userId);
      await interaction.update(buildPetArmyContent(interaction.user, petProfile, state));
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(ACTION_BUTTON_PREFIX)) {
      const [userId, petId] = interaction.customId.replace(ACTION_BUTTON_PREFIX, '').split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      activePetArmyActions.set(userId, { petId });
      await interaction.reply(buildActionPrompt(userId));
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(ACTION_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(ACTION_SELECT_PREFIX, '');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      const action = interaction.values?.[0];
      const state = activePetArmyActions.get(userId) ?? {};
      state.action = action;
      activePetArmyActions.set(userId, state);
      await interaction.update(buildActionDetail(userId, action));
      return true;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(ACTION_ITEM_SELECT_PREFIX)) {
      const [, action] = interaction.customId.replace(ACTION_ITEM_SELECT_PREFIX, '').split(':');
      await interaction.update(buildActionDetail(interaction.user.id, action));
      return true;
    }

    return false;
  },
};
