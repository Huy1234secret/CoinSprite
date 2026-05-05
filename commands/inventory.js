const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { WHITE_ACCENT, COIN, formatNumber } = require('../src/gamblingConfig');
const { getInventoryEntries } = require('../src/playerInventoryStore');
const { rarityEmoji, rarityLabel, ITEM_TYPES } = require('../src/playerItems');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const ITEMS_PER_PAGE = 8;
const filters = new Map();

function text(content) { return { type: 10, content }; }
function separator() { return { type: 14, divider: true, spacing: 1 }; }
function row(...components) { return { type: 1, components }; }
function button(customId, label, style = 2, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function key(userId) { return String(userId); }
function getFilter(userId) { return filters.get(key(userId)) || { types: [], letters: '' }; }
function setFilter(userId, value) { filters.set(key(userId), value); }
function itemLine(entry) {
  const item = entry.item;
  return [
    `${item.emoji} ×${formatNumber(entry.amount)} ${item.name}`,
    `-# * Rarity: **${rarityLabel(item.rarity)} ${rarityEmoji(item.rarity)}**`,
    `-# * Value: **${formatNumber(item.sellValue || 0)} ${COIN}**`,
  ].join('\n');
}
function inventoryPayload(interaction, page = 0) {
  const filter = getFilter(interaction.user.id);
  const entries = getInventoryEntries(interaction.user.id, filter);
  const maxPage = Math.max(1, Math.ceil(entries.length / ITEMS_PER_PAGE));
  const safePage = Math.min(Math.max(0, Math.floor(Number(page) || 0)), maxPage - 1);
  const shown = entries.slice(safePage * ITEMS_PER_PAGE, (safePage + 1) * ITEMS_PER_PAGE);
  const list = shown.length ? shown.map(itemLine).join('\n\n') : '-# * Empty inventory';
  const filterNote = filter.types.length || filter.letters ? `\n-# Filter: ${filter.types.join(', ') || 'Any type'}${filter.letters ? ` / ${filter.letters}` : ''}` : '';
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: WHITE_ACCENT,
      components: [
        text(`## ${interaction.user.username}'s Inventory\n${list}${filterNote}`),
        separator(),
        row(button(`inventory:page:${interaction.user.id}:${safePage}:${maxPage}`, `Switch page ${safePage + 1}/${maxPage}`, 2, maxPage <= 1), button(`inventory:sort:${interaction.user.id}`, 'Sort', 2)),
      ],
    }],
  };
}
async function showSortModal(interaction) {
  await interaction.showModal({
    custom_id: `inventory:sortmodal:${interaction.user.id}`,
    title: 'Sort Inventory',
    components: [
      {
        type: 18,
        label: 'Sort by Item Type',
        component: {
          type: 22,
          custom_id: 'item_types',
          required: false,
          min_values: 0,
          max_values: 4,
          options: [
            { label: 'Gear', value: ITEM_TYPES.gear },
            { label: 'Material', value: ITEM_TYPES.material },
            { label: 'Consumable', value: ITEM_TYPES.consumable },
            { label: 'Accessory', value: ITEM_TYPES.accessory },
          ],
        },
      },
      {
        type: 18,
        label: 'Sort by letters',
        component: {
          type: 4,
          custom_id: 'letters',
          style: 1,
          required: false,
          max_length: 40,
          placeholder: 'Example: goo',
        },
      },
    ],
  });
}
function readModalComponent(interaction, customId) {
  for (const label of interaction.components || []) {
    const child = label.component || label.components?.[0];
    if (child?.customId === customId || child?.custom_id === customId) return child;
  }
  return null;
}
module.exports = {
  bypassGlobalCooldown: true,
  data: new SlashCommandBuilder().setName('inventory').setDescription('View your inventory.'),
  async execute(interaction) { await interaction.reply(inventoryPayload(interaction)); },
  async handleInteraction(interaction) {
    if (!interaction.customId?.startsWith('inventory:')) return false;
    const parts = interaction.customId.split(':');
    const action = parts[1];
    if (parts[2] && parts[2] !== interaction.user.id) { await interaction.reply({ content: 'You can only use your own inventory controls.', flags: EPHEMERAL_FLAG }); return true; }
    if (action === 'page') { await interaction.reply({ content: 'Page switching will be expanded once more inventory pages are added.', flags: EPHEMERAL_FLAG }); return true; }
    if (action === 'sort') { await showSortModal(interaction); return true; }
    if (action === 'sortmodal') {
      const typesComponent = readModalComponent(interaction, 'item_types');
      const lettersComponent = readModalComponent(interaction, 'letters');
      setFilter(interaction.user.id, { types: typesComponent?.values || [], letters: lettersComponent?.value || '' });
      await interaction.reply(inventoryPayload(interaction));
      return true;
    }
    return false;
  },
};
