const { CARROT_STAGE_EMOJIS, PLOT_EMOJIS } = require('../data/growth');
const { ITEM_BY_ID, getItem } = require('../data/items');
const {
  ALLOWED_MENTIONS,
  formatInteger,
  safeUsername,
} = require('../../shared/format');
const {
  EPHEMERAL_FLAG,
  WHITE,
  errorPayload,
  textContainer,
  v2Payload,
} = require('../../shared/components');
const { componentEmoji } = require('../../shared/emojis');
const { inventoryPageData } = require('../utils/inventory');

const FARMING_CURRENCY_EMOJI = '🪙';
const FALLBACK_AVATAR_URL = 'https://cdn.discordapp.com/embed/avatars/0.png';

function farmStatusText(state) {
  const occupied = (state?.plots || []).filter((plot) => plot.occupied).sort((a, b) => a.plotNumber - b.plotNumber);
  if (!occupied.length) return '* Your farm seems empty...';
  return occupied.map((plot) => {
    if (plot.ready) {
      return `-# **#${plot.plotNumber}** - ${CARROT_STAGE_EMOJIS[6]} ***Carrot is FULLY grown!***`;
    }
    const readyUnix = Math.floor(plot.readyAt / 1000);
    return `-# **#${plot.plotNumber}** - ${CARROT_STAGE_EMOJIS[plot.stage]} **Carrot** will fully grow <t:${readyUnix}:R>.`;
  }).join('\n');
}

function plotSelectOption(plotNumber, selected) {
  const option = { label: `#${plotNumber}`, value: String(plotNumber), default: selected.has(plotNumber) };
  const emoji = componentEmoji(PLOT_EMOJIS[plotNumber - 1]);
  if (emoji) option.emoji = emoji;
  return option;
}

function farmActionOptions(state, selectedPlots) {
  const selected = new Set([...selectedPlots].map(Number));
  if (!selected.size) return [{ label: 'Use Gear/Tool', value: 'gear' }];
  const plots = (state?.plots || []).filter((plot) => selected.has(plot.plotNumber));
  const options = [];
  if (plots.some((plot) => plot.ready)) options.push({ label: 'Harvest', value: 'harvest' });
  if (plots.length === selected.size && plots.every((plot) => plot.empty)) options.push({ label: 'Plant', value: 'plant' });
  if (plots.some((plot) => plot.occupied)) options.push({ label: 'Shovel', value: 'shovel' });
  options.push({ label: 'Use Gear/Tool', value: 'gear' });
  return options;
}

function farmPayload(userId, state, view, image, options = {}) {
  const selected = new Set([...view.selectedPlots].map(Number));
  const actionOptions = farmActionOptions(state, selected);
  const filename = 'farm.png';
  return {
    ...v2Payload([{
      type: 17,
      accent_color: WHITE,
      components: [
        { type: 10, content: `### <@${userId}>'s Farm` },
        { type: 12, items: [{ media: { url: `attachment://${filename}` } }] },
        { type: 14, divider: true, spacing: 1 },
        { type: 10, content: farmStatusText(state) },
        { type: 14, divider: true, spacing: 1 },
        {
          type: 1,
          components: [{
            type: 3,
            custom_id: `farm:plot:select:${view.id}`,
            placeholder: 'Select Plots',
            min_values: 0,
            max_values: 9,
            options: Array.from({ length: 9 }, (_, index) => plotSelectOption(index + 1, selected)),
          }],
        },
        {
          type: 1,
          components: [{
            type: 3,
            custom_id: `farm:plot:action:${view.id}`,
            placeholder: 'Actions',
            min_values: 1,
            max_values: 1,
            disabled: !selected.size,
            options: actionOptions,
          }],
        },
      ],
    }], options),
    files: [{ attachment: image, name: filename }],
    attachments: [],
  };
}

function inventoryTypeRow(view) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `farm:inv:type:${view.id}`,
      placeholder: 'Inventory type',
      min_values: 1,
      max_values: 1,
      options: [
        { label: 'Crops', value: 'crops', default: view.type === 'crops' },
        { label: 'Other', value: 'other', default: view.type === 'other' },
      ],
    }],
  };
}

function farmingInventoryFields(stacks) {
  return (stacks || []).map((stack) => {
    const item = stack.item || getItem(stack.itemId);
    if (!item) return null;
    return {
      name: `${item.emoji} ${item.name} ×${formatInteger(stack.quantity)}`.slice(0, 256),
      value: `-# Rarity: ${item.rarity} • Type: ${item.itemTypes.join(', ')}\n`
        + `-# Unit value: ${formatInteger(item.value)} ${FARMING_CURRENCY_EMOJI}`,
      inline: false,
    };
  }).filter(Boolean);
}

function myInventoryPayload(user, farmingStacks, view, options = {}) {
  const page = inventoryPageData(farmingStacks, view);
  const label = page.category === 'crops' ? 'Crops' : 'Other';
  const fields = farmingInventoryFields(page.pageItems);
  if (!fields.length) {
    fields.push({
      name: page.category === 'crops' ? 'No crops found' : 'No items found',
      value: `-# Adjust or clear your ${label} inventory filters.`,
      inline: false,
    });
  }
  const currentPage = page.category === 'crops' ? view.cropPage : view.otherPage;
  return {
    content: null,
    allowedMentions: ALLOWED_MENTIONS,
    embeds: [{
      color: WHITE,
      title: `${safeUsername(user?.username)}'s Inventory — ${label}`.slice(0, 256),
      description: page.category === 'crops'
        ? '* Harvested Farming Game crops'
        : '* Farming Game seed packages, tools, gear, consumables, and items',
      thumbnail: { url: user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || FALLBACK_AVATAR_URL },
      fields,
    }],
    components: [
      inventoryTypeRow(view),
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: `Page ${currentPage} / ${page.maxPage}`, custom_id: `farm:inv:page:${view.id}` },
          { type: 2, style: 2, label: 'Filter', custom_id: `farm:inv:filter:${view.id}` },
        ],
      },
    ],
    ...(options.ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
}

function inventoryPageCount(farmingStacks, view) {
  return inventoryPageData(farmingStacks, view).maxPage;
}

function successPayload(content, options = {}) {
  return textContainer(content, { color: 0x22C55E, ...options });
}

module.exports = {
  FARMING_CURRENCY_EMOJI,
  ITEM_BY_ID,
  errorPayload,
  farmActionOptions,
  farmPayload,
  farmStatusText,
  farmingInventoryFields,
  inventoryPageCount,
  inventoryTypeRow,
  myInventoryPayload,
  successPayload,
  textContainer,
};
