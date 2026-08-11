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
const { formatCarrotWeight } = require('../utils/crops');
const { FARMING_CURRENCY_EMOJI, formatFarmingCurrency } = require('../utils/currency');
const { farmingUpgradeState } = require('../services/upgradeService');

const FARM_ACTION_EMOJIS = Object.freeze({
  gear: '<:SBusetoolgear:1536645344413220914>',
  plant: '<:SBplant:1536645341452177478>',
  harvest: '<:SBharvest:1536645338356645918>',
});
const FARMING_SALE_PAGE_SIZE = 25;
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
  const actionOption = (label, value) => {
    const option = { label, value };
    const emoji = componentEmoji(FARM_ACTION_EMOJIS[value]);
    if (emoji) option.emoji = emoji;
    return option;
  };
  const selected = new Set([...selectedPlots].map(Number));
  if (!selected.size) return [actionOption('Use Tool/Gear', 'gear')];
  const plots = (state?.plots || []).filter((plot) => selected.has(plot.plotNumber));
  const options = [];
  if (plots.some((plot) => plot.ready)) options.push(actionOption('Harvest', 'harvest'));
  if (plots.length === selected.size && plots.every((plot) => plot.empty)) options.push(actionOption('Plant', 'plant'));
  if (plots.some((plot) => plot.occupied)) options.push({ label: 'Shovel', value: 'shovel' });
  options.push(actionOption('Use Tool/Gear', 'gear'));
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

function farmingInventoryFields(crops) {
  const fields = [];
  (crops || []).forEach((crop, index) => {
    const item = crop.item || getItem(crop.cropId);
    if (!item) return;
    fields.push({
      name: `${item.emoji} ${item.name}`.slice(0, 256),
      value: `-# ${formatCarrotWeight(crop.weightUnits)} kg - ${item.rarityEmoji || ''}`.slice(0, 1_024),
      inline: true,
    });
    if ((index + 1) % 2 === 0) fields.push({ name: '\u200b', value: '\u200b', inline: true });
  });
  return fields;
}

function farmingStackFields(stacks) {
  return (stacks || []).map((stack) => {
    const item = stack.item || getItem(stack.itemId);
    if (!item) return null;
    return {
      name: `${item.emoji} ${item.name} ×${formatInteger(stack.quantity)}`.slice(0, 256),
      value: `-# Rarity: ${item.rarity} • Type: ${item.itemTypes.join(', ')}\n`
        + `-# Unit value: ${formatFarmingCurrency(item.value)}`,
      inline: false,
    };
  }).filter(Boolean);
}

function myInventoryPayload(user, farmingInventory, view, options = {}) {
  const page = inventoryPageData(farmingInventory, view);
  const label = page.category === 'crops' ? 'Crops' : 'Other';
  const fields = page.category === 'crops'
    ? farmingInventoryFields(page.pageItems)
    : farmingStackFields(page.pageItems);
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

function inventoryPageCount(farmingInventory, view) {
  return inventoryPageData(farmingInventory, view).maxPage;
}

function farmingBalancePayload(user, profileOrBalance, view, options = {}) {
  const profile = profileOrBalance && typeof profileOrBalance === 'object'
    ? profileOrBalance
    : { balance: profileOrBalance, luckTier: 0, bigCropTier: 0 };
  const upgrades = farmingUpgradeState(profile);
  const bigHundredths = (upgrades.bigCropChance.numerator * 10_000n) / upgrades.bigCropChance.denominator;
  const bigPercentage = `${bigHundredths / 100n}.${String(bigHundredths % 100n).padStart(2, '0')}%`.replace('.00%', '%');
  const luckLine = upgrades.luckMaximum
    ? `- Luck: **×${upgrades.luckMultiplier} — MAX**`
    : `- Luck: **×${upgrades.luckMultiplier}** • Next: ${formatFarmingCurrency(upgrades.luckCost)}`;
  const bigLine = upgrades.bigCropMaximum
    ? `- BIG Crop Chance: **${bigPercentage} — MAX**`
    : `- BIG Crop Chance: **${bigPercentage}** • Next: ${formatFarmingCurrency(upgrades.bigCropCost)}`;
  const components = [{
    type: 10,
    content: `### <@${user.id}>'s Farming Balance\n- Balance: ${formatFarmingCurrency(profile.balance)}\n${luckLine}\n${bigLine}`,
  }];
  if (view) {
    components.push({ type: 14, divider: true, spacing: 1 }, {
      type: 1,
      components: [
        {
          type: 2,
          style: 2,
          label: upgrades.luckMaximum ? 'Luck MAX' : 'Upgrade Luck',
          custom_id: `farm:upgrade:luck:${view.id}`,
          disabled: upgrades.luckMaximum,
        },
        {
          type: 2,
          style: 2,
          label: upgrades.bigCropMaximum ? 'BIG MAX' : 'Upgrade BIG',
          custom_id: `farm:upgrade:big:${view.id}`,
          disabled: upgrades.bigCropMaximum,
        },
      ],
    });
  }
  return v2Payload([{ type: 17, accent_color: WHITE, components }], options);
}

function groupedCropSaleSummary(crops) {
  if (!crops.length) return '-# No crops selected.';
  const groups = new Map();
  for (const crop of crops) {
    const key = `${crop.cropId}:${crop.weightUnits}`;
    const current = groups.get(key) || { crop, count: 0 };
    current.count += 1;
    groups.set(key, current);
  }
  return [...groups.values()].map(({ crop, count }) => {
    const item = crop.item || getItem(crop.cropId);
    return `${item?.emoji || ''} \`[${formatCarrotWeight(crop.weightUnits)} kg]\`${count > 1 ? ` ×${count}` : ''}`.trim();
  }).join('\n').slice(0, 3_000);
}

function farmingSalePageData(farmingInventory, session) {
  const crops = farmingInventory?.crops || [];
  const maxPage = Math.max(1, Math.ceil(crops.length / FARMING_SALE_PAGE_SIZE));
  session.currentPage = Math.max(1, Math.min(maxPage, Number(session.currentPage) || 1));
  const start = (session.currentPage - 1) * FARMING_SALE_PAGE_SIZE;
  const pageCrops = crops.slice(start, start + FARMING_SALE_PAGE_SIZE);
  const cropMap = new Map(crops.map((crop) => [crop.id, crop]));
  for (const selectedId of [...session.selectedCropIds]) {
    if (!cropMap.has(selectedId)) session.selectedCropIds.delete(selectedId);
  }
  const selectedCrops = [...session.selectedCropIds].map((id) => cropMap.get(id)).filter(Boolean);
  const total = selectedCrops.reduce((sum, crop) => sum + crop.storedValue, 0n);
  return { crops, maxPage, pageCrops, selectedCrops, total };
}

function cropSaleOption(crop, selected) {
  const item = crop.item || getItem(crop.cropId);
  const option = {
    label: `${item?.name || crop.cropId} • ${formatCarrotWeight(crop.weightUnits)} kg`.slice(0, 100),
    description: `${crop.rarity} • ${formatFarmingCurrency(crop.storedValue)}`.slice(0, 100),
    value: crop.id,
    default: selected,
  };
  const emoji = componentEmoji(item?.emoji);
  if (emoji) option.emoji = emoji;
  return option;
}

function farmingSalePayload(farmingInventory, session, options = {}) {
  const page = farmingSalePageData(farmingInventory, session);
  const components = [{
    type: 10,
    content: `### Select crops to sell\n\n- Crops selected:\n${groupedCropSaleSummary(page.selectedCrops)}\n\n- Total value: ${formatFarmingCurrency(page.total)}`,
  }, { type: 14, divider: true, spacing: 1 }];
  if (page.pageCrops.length) {
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `farm:sale:select:${session.id}`,
        placeholder: `Crops ${session.currentPage} / ${page.maxPage}`,
        min_values: 0,
        max_values: page.pageCrops.length,
        options: page.pageCrops.map((crop) => cropSaleOption(crop, session.selectedCropIds.has(crop.id))),
      }],
    });
  } else {
    components.push({ type: 10, content: '-# No harvested Farming crops are available.' });
  }
  components.push({
    type: 1,
    components: [
      { type: 2, style: 2, label: 'Previous', custom_id: `farm:sale:prev:${session.id}`, disabled: session.currentPage <= 1 },
      { type: 2, style: 2, label: `Page ${session.currentPage} / ${page.maxPage}`, custom_id: `farm:sale:page:${session.id}`, disabled: true },
      { type: 2, style: 2, label: 'Next', custom_id: `farm:sale:next:${session.id}`, disabled: session.currentPage >= page.maxPage },
    ],
  }, {
    type: 1,
    components: [
      { type: 2, style: 4, label: 'Deny', custom_id: `farm:sale:deny:${session.id}` },
      { type: 2, style: 3, label: 'Sell', custom_id: `farm:sale:confirm:${session.id}`, disabled: !session.selectedCropIds.size },
    ],
  });
  return v2Payload([{ type: 17, accent_color: WHITE, components }], options);
}

function farmingSaleFinishedPayload(itemCount, total, balance, options = {}) {
  const balanceLine = balance == null ? '' : `\nResulting balance: **${formatFarmingCurrency(balance)}**.`;
  return textContainer(
    `Sale complete\nSold **${itemCount}** Farming crop${itemCount === 1 ? '' : 's'} for **${formatFarmingCurrency(total)}**.${balanceLine}`,
    { color: 0x22C55E, ...options },
  );
}

function farmingDirectSalePayload(crop, itemCount, total, balance, options = {}) {
  const item = crop || {};
  return textContainer(
    `Sale complete\n- Crop: ${item.emoji || ''} **${item.name || 'Crop'}**\n`
      + `- Quantity sold: **${itemCount}**\n`
      + `- Earned: **${formatFarmingCurrency(total)}**\n`
      + `- Farming balance: **${formatFarmingCurrency(balance)}**`,
    { color: 0x22C55E, ...options },
  );
}

function farmingSaleDeniedPayload(options = {}) {
  return textContainer('Sale cancelled\nNo Farming crops were sold.', options);
}

function farmingIndexPayload(userId, view, image, options = {}) {
  const filename = `farming-index-${view.id}.png`;
  return {
    ...v2Payload([{
      type: 17,
      accent_color: WHITE,
      components: [
        { type: 12, items: [{ media: { url: `attachment://${filename}` } }] },
        { type: 14, divider: true, spacing: 1 },
        {
          type: 1,
          components: [
            { type: 2, style: 2, label: `Page ${view.page} / ${view.maxPage}`, custom_id: `farm:index:page:${view.id}` },
            { type: 2, style: 2, label: 'Search', custom_id: `farm:index:search:${view.id}` },
          ],
        },
      ],
    }], options),
    allowedMentions: { ...ALLOWED_MENTIONS, users: [String(userId)] },
    files: [{ attachment: image, name: filename }],
    attachments: [],
  };
}

function successPayload(content, options = {}) {
  return textContainer(content, { color: 0x22C55E, ...options });
}

module.exports = {
  FARM_ACTION_EMOJIS,
  FARMING_CURRENCY_EMOJI,
  FARMING_SALE_PAGE_SIZE,
  ITEM_BY_ID,
  errorPayload,
  farmActionOptions,
  farmPayload,
  farmStatusText,
  farmingBalancePayload,
  farmingDirectSalePayload,
  farmingIndexPayload,
  farmingInventoryFields,
  farmingSaleDeniedPayload,
  farmingSaleFinishedPayload,
  farmingSalePageData,
  farmingSalePayload,
  farmingStackFields,
  groupedCropSaleSummary,
  inventoryPageCount,
  inventoryTypeRow,
  myInventoryPayload,
  successPayload,
  textContainer,
};
