const { MessageFlags } = require('discord.js');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const CHECKBOX_GROUP_COMPONENT_TYPE = 22;
const TEXT_INPUT_COMPONENT_TYPE = 4;

const FILTER_RARITIES = [
  ['all', 'All'],
  ['secret', 'Secret'],
  ['mythical', 'Mythical'],
  ['legendary', 'Legendary'],
  ['epic', 'Epic'],
  ['rare', 'Rare'],
  ['uncommon', 'Uncommon'],
  ['common', 'Common'],
];

function rarityOptions() {
  return FILTER_RARITIES.map(([value, label]) => ({ label, value }));
}

function getField(interaction, customId) {
  try {
    return interaction.fields.getTextInputValue(customId);
  } catch {}

  let found = null;
  const visit = (value) => {
    if (!value || typeof value !== 'object' || found !== null) return;
    if ((value.customId === customId || value.custom_id === customId) && value.value !== undefined) {
      found = value.value;
      return;
    }
    if (value.component) visit(value.component);
    if (Array.isArray(value.components)) value.components.forEach(visit);
    if (Array.isArray(value.data?.components)) value.data.components.forEach(visit);
    if (value.fields && typeof value.fields.values === 'function') Array.from(value.fields.values()).forEach(visit);
    if (value.fields?.fields && typeof value.fields.fields.values === 'function') Array.from(value.fields.fields.values()).forEach(visit);
  };

  try { visit(interaction.fields?.getField?.(customId)); } catch {}
  try { visit(interaction.toJSON?.()); } catch {}
  visit(interaction);
  return found;
}

function pageModal(kind, userId, minPage = 1, maxPage = 1, currentPage = 1, customIdSuffix = '') {
  const safeMin = Math.max(1, Math.floor(Number(minPage) || 1));
  const safeMax = Math.max(safeMin, Math.floor(Number(maxPage) || safeMin));
  const safeCurrent = Math.max(safeMin, Math.min(safeMax, Math.floor(Number(currentPage) || safeMin)));

  return {
    custom_id: `fm:${kind}pagesubmit:${userId}${customIdSuffix || ''}`,
    title: 'Switch page',
    components: [{
      type: 18,
      label: `Page (${safeMin}-${safeMax})`,
      component: {
        type: TEXT_INPUT_COMPONENT_TYPE,
        custom_id: `fm_${kind}_page`,
        style: 1,
        required: true,
        min_length: 1,
        max_length: Math.max(1, String(safeMax).length),
        value: String(safeCurrent),
        placeholder: `Enter page ${safeMin}-${safeMax}`,
      },
    }],
  };
}

// fishyMarket.js references these helpers as free variables. Define them before
// requiring it so existing page buttons stop throwing ReferenceError.
globalThis.getField = globalThis.getField || getField;
globalThis.pageModal = globalThis.pageModal || pageModal;

const original = require('./fishyMarket');

function checkboxFilterForm(kind, userId) {
  const isFish = kind === 'fish';
  return {
    custom_id: `fm:${kind}filtersubmit:${userId}`,
    title: isFish ? 'Sell fish filter' : 'Sell item filter',
    components: [{
      type: 18,
      label: isFish ? 'Select fish rarity to sell' : 'Select item rarity to sell',
      component: {
        type: CHECKBOX_GROUP_COMPONENT_TYPE,
        custom_id: `${kind}_rarities`,
        min_values: 1,
        max_values: FILTER_RARITIES.length,
        required: true,
        options: rarityOptions(),
      },
    }],
  };
}

function isOwner(interaction, userId) {
  if (interaction.user.id === userId) return true;
  interaction.reply({ content: 'Only the command owner can use this control.', flags: EPHEMERAL_FLAG }).catch(() => null);
  return false;
}

function wrapCommand(command) {
  return {
    ...command,
    async handleInteraction(interaction, client) {
      const id = interaction.customId || '';
      const parts = id.split(':');
      const action = parts[1];
      const userId = parts[2];

      if (id.startsWith('fm:') && (action === 'sellfilter' || action === 'itemfilter')) {
        if (!isOwner(interaction, userId)) return true;
        await interaction.showModal(checkboxFilterForm(action === 'sellfilter' ? 'fish' : 'item', userId));
        return true;
      }

      return command.handleInteraction(interaction, client);
    },
  };
}

module.exports = {
  fishyMarketCommand: wrapCommand(original.fishyMarketCommand),
  inventoryCommand: wrapCommand(original.inventoryCommand),
  fishBarrelCommand: wrapCommand(original.fishBarrelCommand),
};
