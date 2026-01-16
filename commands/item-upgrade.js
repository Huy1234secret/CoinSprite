const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { safeErrorReply } = require('../src/utils/interactions');
const { getUserProfile, updateUserProfile } = require('../src/huntProfile');
const {
  ITEM_UPGRADES,
  ITEM_UPGRADE_MAX_SLOTS,
  getItemUpgradeDefinition,
  hasItemUpgrade,
} = require('../src/itemUpgrades');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2;
const ITEMS_PER_PAGE = 5;

const SLOT_SELECT_PREFIX = 'item-upgrade-slot:';
const PAGE_BUTTON_PREFIX = 'item-upgrade-page:';
const SEARCH_BUTTON_PREFIX = 'item-upgrade-search:';
const SEARCH_MODAL_PREFIX = 'item-upgrade-modal:';
const UPGRADE_BUTTON_PREFIX = 'item-upgrade-select:';
const UPGRADE_CONFIRM_PREFIX = 'item-upgrade-confirm:';
const CLAIM_BUTTON_PREFIX = 'item-upgrade-claim:';

const activeUpgradeViews = new Map();
const activeUpgradeStates = new Map();
const searchTimers = new Map();
const claimTimers = new Map();

let cachedClient = null;

function formatNumber(value) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return value.toLocaleString('en-US');
}

function formatCountdown(endTimestampMs) {
  const remaining = Math.max(0, Math.ceil((endTimestampMs - Date.now()) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  if (minutes <= 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function getProfileUpgradeSlots(profile) {
  const rawSlots = Array.isArray(profile.item_upgrade_slots) ? profile.item_upgrade_slots : [];
  return rawSlots
    .map((slot) => ({
      slot: Number.isFinite(slot?.slot) ? Math.max(1, Math.floor(slot.slot)) : null,
      upgradeKey: typeof slot?.upgradeKey === 'string' ? slot.upgradeKey : null,
      startedAt: Number.isFinite(slot?.startedAt) ? slot.startedAt : null,
      endsAt: Number.isFinite(slot?.endsAt) ? slot.endsAt : null,
    }))
    .filter((slot) => slot.slot && slot.upgradeKey && slot.endsAt);
}

function setProfileUpgradeSlots(profile, slots) {
  profile.item_upgrade_slots = slots;
}

function getInventoryItemNames(profile) {
  const names = new Set();
  for (const item of profile.gear_inventory ?? []) {
    if (item?.name) {
      names.add(item.name);
    }
  }
  for (const item of profile.misc_inventory ?? []) {
    if (item?.name) {
      names.add(item.name);
    }
  }
  return names;
}

function buildSlotSelect(userId, usedSlots) {
  const hasAvailable = usedSlots < ITEM_UPGRADE_MAX_SLOTS;
  const options = Array.from({ length: ITEM_UPGRADE_MAX_SLOTS }).map((_, index) => {
    const slotNumber = index + 1;
    return { label: `Slot ${slotNumber}`, value: String(slotNumber), default: false };
  });

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${SLOT_SELECT_PREFIX}${userId}`)
      .setPlaceholder('Choose slot')
      .setOptions(options)
      .setDisabled(!hasAvailable)
  );
}

function getAvailableUpgrades(profile, searchValue) {
  const search = searchValue ? searchValue.toLowerCase() : '';
  const inventoryNames = getInventoryItemNames(profile);
  const activeSlots = getProfileUpgradeSlots(profile);
  const activeKeys = new Set(activeSlots.map((slot) => slot.upgradeKey));

  return ITEM_UPGRADES.filter((upgrade) => {
    if (hasItemUpgrade(profile, upgrade.key)) {
      return false;
    }
    if (activeKeys.has(upgrade.key)) {
      return false;
    }
    if (upgrade.requirementKey && !hasItemUpgrade(profile, upgrade.requirementKey)) {
      return false;
    }
    if (!upgrade.alwaysAvailable && !inventoryNames.has(upgrade.name)) {
      return false;
    }
    if (search && !upgrade.name.toLowerCase().includes(search)) {
      return false;
    }
    return true;
  });
}

function paginateUpgrades(list, page) {
  const totalPages = Math.max(1, Math.ceil(list.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * ITEMS_PER_PAGE;
  return {
    totalPages,
    page: safePage,
    slice: list.slice(start, start + ITEMS_PER_PAGE),
  };
}

function buildUpgradeRow(userId, slotNumber, upgrade) {
  const button = new ButtonBuilder()
    .setCustomId(`${UPGRADE_BUTTON_PREFIX}${userId}:${slotNumber}:${upgrade.key}`)
    .setStyle(ButtonStyle.Success)
    .setEmoji('🛠️');

  return {
    type: 9,
    components: [{ type: 10, content: `### ${upgrade.name}` }],
    accessory: button.toJSON(),
  };
}

function buildNavigationRow(userId, slotNumber, page, totalPages) {
  const prevButton = new ButtonBuilder()
    .setCustomId(`${PAGE_BUTTON_PREFIX}${userId}:${slotNumber}:prev`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('⬅️')
    .setDisabled(page <= 1);
  const searchButton = new ButtonBuilder()
    .setCustomId(`${SEARCH_BUTTON_PREFIX}${userId}:${slotNumber}`)
    .setStyle(ButtonStyle.Secondary)
    .setLabel('Search');
  const nextButton = new ButtonBuilder()
    .setCustomId(`${PAGE_BUTTON_PREFIX}${userId}:${slotNumber}:next`)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji('➡️')
    .setDisabled(page >= totalPages);

  return new ActionRowBuilder().addComponents(prevButton, searchButton, nextButton).toJSON();
}

function buildHomeMessage(user, profile) {
  const slots = getProfileUpgradeSlots(profile);
  const usedSlots = slots.length;
  const lines = [];

  if (usedSlots === 0) {
    lines.push('## You have no active upgrade.');
  } else {
    lines.push('## Item Upgrade');
  }

  lines.push(`-# You have used ${usedSlots} / ${ITEM_UPGRADE_MAX_SLOTS}`);

  if (usedSlots === 0) {
    lines.push('Select a slot to start upgrading!');
  } else if (usedSlots >= ITEM_UPGRADE_MAX_SLOTS) {
    lines.push('You have no upgrade slot left!');
  }

  const components = [{ type: 10, content: lines.join('\n') }];

  if (slots.length > 0) {
    components.push({ type: 14 });
    for (const slot of slots) {
      const upgrade = getItemUpgradeDefinition(slot.upgradeKey);
      if (!upgrade) {
        continue;
      }
      const isReady = Date.now() >= slot.endsAt;
      const content = `## Slot ${slot.slot} - ${upgrade.name}'s Upgrade\n-# Upgrade time: ${formatCountdown(
        slot.endsAt
      )}`;
      if (isReady) {
        const claimButton = new ButtonBuilder()
          .setCustomId(`${CLAIM_BUTTON_PREFIX}${user.id}:${slot.slot}`)
          .setStyle(ButtonStyle.Success)
          .setLabel('Claim!');
        components.push({
          type: 9,
          components: [{ type: 10, content }],
          accessory: claimButton.toJSON(),
        });
      } else {
        components.push({ type: 10, content });
      }
    }
  }

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [...components, buildSlotSelect(user.id, usedSlots).toJSON()],
      },
    ],
  };
}

function buildUpgradeListMessage(user, profile, state) {
  const { slotNumber, page, search } = state;
  const upgrades = getAvailableUpgrades(profile, search);
  const { totalPages, page: safePage, slice } = paginateUpgrades(upgrades, page);
  const headerLines = [
    `## Slot ${slotNumber} - Select an item to upgrade`,
    `-# Page ${safePage} / ${totalPages}`,
  ];
  if (search) {
    headerLines.push(`* Searching: \"${search}\"`);
  }

  const components = [{ type: 10, content: headerLines.join('\n') }, { type: 14 }];

  if (slice.length === 0) {
    components.push({ type: 10, content: 'No result.' });
  } else {
    for (const upgrade of slice) {
      components.push(buildUpgradeRow(user.id, slotNumber, upgrade));
    }
  }

  components.push(buildNavigationRow(user.id, slotNumber, safePage, totalPages));

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

function buildUpgradeModal(userId, slotNumber) {
  return new ModalBuilder()
    .setCustomId(`${SEARCH_MODAL_PREFIX}${userId}:${slotNumber}`)
    .setTitle('Item Upgrade Search')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('search')
          .setLabel('What are item-upgrade you searching?')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(' Example: Bag, {Your tool name}, etc')
          .setRequired(true)
      )
    );
}

function buildUpgradeCostLines(costs) {
  if (!Array.isArray(costs) || costs.length === 0) {
    return ['* None'];
  }
  return costs.map((cost) => {
    const emoji = cost.emoji ? ` ${cost.emoji}` : '';
    const amount = formatNumber(cost.amount);
    return `* ${amount} ${cost.label}${emoji}`;
  });
}

function hasFreeSlot(profile) {
  const slots = getProfileUpgradeSlots(profile);
  return slots.length < ITEM_UPGRADE_MAX_SLOTS;
}

function canStartUpgrade(profile, upgrade) {
  if (!upgrade) {
    return false;
  }
  if (hasItemUpgrade(profile, upgrade.key)) {
    return false;
  }
  if (upgrade.requirementKey && !hasItemUpgrade(profile, upgrade.requirementKey)) {
    return false;
  }
  if (!hasFreeSlot(profile)) {
    return false;
  }
  const totalCoins = (upgrade.cost ?? []).reduce((sum, cost) => {
    if (cost.type === 'coins') {
      return sum + (Number.isFinite(cost.amount) ? cost.amount : 0);
    }
    return sum;
  }, 0);
  if ((profile.coins ?? 0) < totalCoins) {
    return false;
  }
  return true;
}

function buildUpgradeDetailMessage(profile, upgrade, userId, slotNumber) {
  const canUpgrade = canStartUpgrade(profile, upgrade);
  const accentColor = canUpgrade ? 0x64ff64 : 0xff6464;
  const button = new ButtonBuilder()
    .setCustomId(`${UPGRADE_CONFIRM_PREFIX}${userId}:${slotNumber}:${upgrade.key}`)
    .setLabel(canUpgrade ? 'Upgrade?' : 'Requirement not met')
    .setStyle(canUpgrade ? ButtonStyle.Success : ButtonStyle.Danger)
    .setDisabled(!canUpgrade);

  return {
    flags: COMPONENTS_V2_FLAG,
    ephemeral: true,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [
          {
            type: 10,
            content: `## You are upgrading ${upgrade.name}\nUpgrading cost:\n${buildUpgradeCostLines(
              upgrade.cost
            ).join('\n')}`,
          },
          new ActionRowBuilder().addComponents(button).toJSON(),
        ],
      },
    ],
  };
}

async function updateUpgradeMessage(client, userId) {
  const view = activeUpgradeViews.get(userId);
  if (!view) {
    return;
  }

  try {
    const channel = await client.channels.fetch(view.channelId);
    if (!channel) {
      return;
    }
    const message = await channel.messages.fetch(view.messageId);
    if (!message) {
      return;
    }

    const profile = getUserProfile(userId);
    const state = activeUpgradeStates.get(userId);
    const user = await client.users.fetch(userId);
    const payload =
      state?.mode === 'list'
        ? buildUpgradeListMessage(user, profile, state)
        : buildHomeMessage(user, profile);
    await message.edit(payload);
  } catch (error) {
    console.warn('Failed to update item upgrade message:', error);
  }
}

function scheduleClaimUpdate(userId, endsAt) {
  if (!cachedClient) {
    return;
  }
  const remaining = Math.max(0, endsAt - Date.now());
  const existing = claimTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    updateUpgradeMessage(cachedClient, userId);
  }, remaining + 1000);
  claimTimers.set(userId, timer);
}

function scheduleSearchReset(userId) {
  if (!cachedClient) {
    return;
  }
  const existing = searchTimers.get(userId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    const state = activeUpgradeStates.get(userId);
    if (state?.mode !== 'list') {
      return;
    }
    state.search = '';
    state.page = 1;
    activeUpgradeStates.set(userId, state);
    updateUpgradeMessage(cachedClient, userId);
  }, 60000);
  searchTimers.set(userId, timer);
}

module.exports = {
  data: new SlashCommandBuilder().setName('item-upgrade').setDescription('Upgrade your items'),

  init(client) {
    cachedClient = client;
  },

  async execute(interaction) {
    const profile = getUserProfile(interaction.user.id);
    const payload = buildHomeMessage(interaction.user, profile);
    await interaction.reply(payload);
    const message = await interaction.fetchReply();
    activeUpgradeViews.set(interaction.user.id, {
      messageId: message.id,
      channelId: message.channelId,
    });
    activeUpgradeStates.set(interaction.user.id, { mode: 'home' });
  },

  async handleComponent(interaction) {
    if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) {
      return false;
    }

    if (interaction.isStringSelectMenu() && interaction.customId.startsWith(SLOT_SELECT_PREFIX)) {
      const userId = interaction.customId.replace(SLOT_SELECT_PREFIX, '');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      const slotNumber = Number(interaction.values?.[0] ?? '1');
      const profile = getUserProfile(userId);
      const state = { mode: 'list', slotNumber, page: 1, search: '' };
      activeUpgradeStates.set(userId, state);
      await interaction.update(buildUpgradeListMessage(interaction.user, profile, state));
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(PAGE_BUTTON_PREFIX)) {
      const [, userId, slotNumber, direction] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      const profile = getUserProfile(userId);
      const state = activeUpgradeStates.get(userId) ?? { mode: 'list', slotNumber: Number(slotNumber), page: 1, search: '' };
      const upgrades = getAvailableUpgrades(profile, state.search);
      const { totalPages } = paginateUpgrades(upgrades, state.page);
      const nextPage = direction === 'next' ? state.page + 1 : state.page - 1;
      state.page = Math.min(Math.max(1, nextPage), totalPages);
      state.mode = 'list';
      state.slotNumber = Number(slotNumber);
      activeUpgradeStates.set(userId, state);
      await interaction.update(buildUpgradeListMessage(interaction.user, profile, state));
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(SEARCH_BUTTON_PREFIX)) {
      const [, userId, slotNumber] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }

      await interaction.showModal(buildUpgradeModal(userId, slotNumber));
      return true;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith(SEARCH_MODAL_PREFIX)) {
      const [, userId, slotNumber] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      const searchValue = interaction.fields.getTextInputValue('search')?.trim() ?? '';
      const state = { mode: 'list', slotNumber: Number(slotNumber), page: 1, search: searchValue };
      activeUpgradeStates.set(userId, state);
      scheduleSearchReset(userId);
      await interaction.reply({ content: 'Search updated.', ephemeral: true });
      await updateUpgradeMessage(interaction.client, userId);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(UPGRADE_BUTTON_PREFIX)) {
      const [, userId, slotNumber, upgradeKey] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      const profile = getUserProfile(userId);
      const upgrade = getItemUpgradeDefinition(upgradeKey);
      if (!upgrade) {
        await safeErrorReply(interaction, 'That upgrade is not available.');
        return true;
      }
      await interaction.reply(buildUpgradeDetailMessage(profile, upgrade, userId, slotNumber));
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(UPGRADE_CONFIRM_PREFIX)) {
      const [, userId, slotNumber, upgradeKey] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      const profile = getUserProfile(interaction.user.id);
      const upgrade = getItemUpgradeDefinition(upgradeKey);
      if (!upgrade) {
        await safeErrorReply(interaction, 'That upgrade is not available.');
        return true;
      }
      if (!canStartUpgrade(profile, upgrade)) {
        await safeErrorReply(interaction, 'Requirement not met.');
        return true;
      }

      const totalCoins = (upgrade.cost ?? []).reduce((sum, cost) => {
        if (cost.type === 'coins') {
          return sum + (Number.isFinite(cost.amount) ? cost.amount : 0);
        }
        return sum;
      }, 0);
      profile.coins = Math.max(0, (profile.coins ?? 0) - totalCoins);

      const slots = getProfileUpgradeSlots(profile);
      const assignedSlot = Number(slotNumber) || slots.length + 1;
      const now = Date.now();
      const endsAt = now + upgrade.durationSeconds * 1000;
      slots.push({
        slot: assignedSlot,
        upgradeKey: upgrade.key,
        startedAt: now,
        endsAt,
      });
      setProfileUpgradeSlots(profile, slots);
      updateUserProfile(interaction.user.id, profile);

      scheduleClaimUpdate(interaction.user.id, endsAt);
      await interaction.update({ content: 'Upgrade started!', components: [] });
      activeUpgradeStates.set(interaction.user.id, { mode: 'home' });
      await updateUpgradeMessage(interaction.client, interaction.user.id);
      return true;
    }

    if (interaction.isButton() && interaction.customId.startsWith(CLAIM_BUTTON_PREFIX)) {
      const [, userId, slotNumber] = interaction.customId.split(':');
      if (interaction.user.id !== userId) {
        await safeErrorReply(interaction, 'Only the user who opened this menu can interact with it.');
        return true;
      }
      const profile = getUserProfile(userId);
      const slots = getProfileUpgradeSlots(profile);
      const slotIndex = slots.findIndex((slot) => slot.slot === Number(slotNumber));
      if (slotIndex === -1) {
        await safeErrorReply(interaction, 'That slot is no longer available.');
        return true;
      }
      const slot = slots[slotIndex];
      if (Date.now() < slot.endsAt) {
        await safeErrorReply(interaction, 'This upgrade is not finished yet.');
        return true;
      }
      const upgrade = getItemUpgradeDefinition(slot.upgradeKey);
      if (!upgrade) {
        await safeErrorReply(interaction, 'That upgrade is no longer available.');
        return true;
      }
      profile.item_upgrades = {
        ...(profile.item_upgrades ?? {}),
        [upgrade.key]: true,
      };
      if (Number.isFinite(upgrade.inventoryCapacity)) {
        profile.inventory_capacity = Math.max(profile.inventory_capacity ?? 0, upgrade.inventoryCapacity);
      }
      slots.splice(slotIndex, 1);
      setProfileUpgradeSlots(profile, slots);
      updateUserProfile(userId, profile);

      const timer = claimTimers.get(userId);
      if (timer) {
        clearTimeout(timer);
        claimTimers.delete(userId);
      }
      activeUpgradeStates.set(userId, { mode: 'home' });
      await interaction.update(buildHomeMessage(interaction.user, profile));
      return true;
    }

    return false;
  },
};
