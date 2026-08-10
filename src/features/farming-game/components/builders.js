const { MessageFlags } = require('discord.js');
const { CARROT_STAGE_EMOJIS, PLOT_EMOJIS } = require('../data/growth');
const { ITEM_BY_ID, getItem } = require('../data/items');
const { RARITY_EMOJIS, SHECKLES_EMOJI, componentEmoji } = require('../../rng-game/data/emojis');
const {
  ALLOWED_MENTIONS,
  formatInteger,
  safeUsername,
  seedThumbnail,
} = require('../../rng-game/utils/format');
const {
  errorPayload,
  inventoryCropFields,
  inventoryPageData,
  textContainer,
  v2Payload,
} = require('../../rng-game/components/builders');
const { otherInventoryPageData } = require('../utils/inventory');

const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xFFFFFF;

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

function cropPageData(state, view) {
  const adapter = { page: view.cropPage, filters: view.cropFilters };
  const page = inventoryPageData(state, adapter);
  view.cropPage = adapter.page;
  return page;
}

function cropsInventoryPayload(user, state, view, options = {}) {
  const page = cropPageData(state, view);
  const fields = inventoryCropFields(page.pageItems);
  if (!fields.length) fields.push({ name: 'No crops found', value: '-# Adjust your filters or roll a crop.', inline: false });
  return {
    content: null,
    allowedMentions: ALLOWED_MENTIONS,
    embeds: [{
      color: WHITE,
      title: `${safeUsername(user?.username)}'s Inventory — Crops`.slice(0, 256),
      description: `* Capacity: ${state.count} / ${state.player.inventoryCapacity}\n* Total value: ${formatInteger(state.totalValue)} ${SHECKLES_EMOJI}`,
      thumbnail: { url: user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || seedThumbnail(null) },
      fields,
    }],
    components: [
      inventoryTypeRow(view),
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: `Page ${view.cropPage} / ${page.maxPage}`, custom_id: `farm:inv:page:${view.id}` },
          { type: 2, style: 2, label: 'Filter', custom_id: `farm:inv:filter:${view.id}` },
          { type: 2, style: 3, label: 'Upgrade', custom_id: `farm:inv:upgrade:${view.id}` },
        ],
      },
    ],
    ...(options.ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
}

function otherInventoryFields(stacks) {
  return (stacks || []).map((stack) => {
    const item = stack.item || getItem(stack.itemId);
    const rarityEmoji = RARITY_EMOJIS[item.rarity] || '';
    return {
      name: `${item.emoji} ${item.name} ×${formatInteger(stack.quantity)}`.slice(0, 256),
      value: `-# Type: ${item.itemTypes.join(', ')} - ${rarityEmoji}\n-# Value: ${formatInteger(item.value)} ${SHECKLES_EMOJI}`.slice(0, 1_024),
      inline: false,
    };
  });
}

function otherInventoryPayload(user, stacks, view, options = {}) {
  const page = otherInventoryPageData(stacks, view);
  const fields = otherInventoryFields(page.pageItems);
  if (!fields.length) fields.push({ name: 'No items found', value: '-# Adjust or clear your Other inventory filters.', inline: false });
  return {
    content: null,
    allowedMentions: ALLOWED_MENTIONS,
    embeds: [{
      color: WHITE,
      title: `${safeUsername(user?.username)}'s Inventory — Other`.slice(0, 256),
      description: '* Stack-based farming items',
      thumbnail: { url: user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || seedThumbnail(null) },
      fields,
    }],
    components: [
      inventoryTypeRow(view),
      {
        type: 1,
        components: [
          { type: 2, style: 2, label: `Page ${view.otherPage} / ${page.maxPage}`, custom_id: `farm:inv:page:${view.id}` },
          { type: 2, style: 2, label: 'Filter', custom_id: `farm:inv:filter:${view.id}` },
        ],
      },
    ],
    ...(options.ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
}

function myInventoryPayload(user, cropState, farmingStacks, view, options = {}) {
  return view.type === 'other'
    ? otherInventoryPayload(user, farmingStacks, view, options)
    : cropsInventoryPayload(user, cropState, view, options);
}

function inventoryPageCount(cropState, farmingStacks, view) {
  if (view.type === 'other') return otherInventoryPageData(farmingStacks, view).maxPage;
  return cropPageData(cropState, view).maxPage;
}

function inventoryUpgradePromptPayload(action, player, options = {}) {
  const affordable = player.balance >= action.cost;
  const missing = affordable ? 0n : action.cost - player.balance;
  const label = affordable ? 'Upgrade' : `You need ${formatInteger(missing)} more!`;
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### Upgrade inventory\n\nYou'll need:\n\n-# * ${formatInteger(action.cost)} ${SHECKLES_EMOJI}` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: '-# * Every upgrade gives +10 capacity.' },
      { type: 1, components: [{
        type: 2,
        style: affordable ? 3 : 4,
        label: label.slice(0, 80),
        custom_id: `farm:inv:upgrade-confirm:${action.id}`,
        disabled: !affordable,
      }] },
    ],
  }], { ...options, ephemeral: true });
}

function successPayload(content, options = {}) {
  return textContainer(content, { color: 0x22C55E, ...options });
}

module.exports = {
  ITEM_BY_ID,
  cropPageData,
  cropsInventoryPayload,
  errorPayload,
  farmActionOptions,
  farmPayload,
  farmStatusText,
  inventoryPageCount,
  inventoryTypeRow,
  inventoryUpgradePromptPayload,
  myInventoryPayload,
  otherInventoryFields,
  otherInventoryPayload,
  successPayload,
  textContainer,
};
