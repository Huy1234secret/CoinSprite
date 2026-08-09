const { MessageFlags } = require('discord.js');
const { SEED_BY_ID } = require('../data/seeds');
const { SHECKLES_EMOJI, componentEmoji } = require('../data/emojis');
const { filterInventory } = require('../utils/normalize');
const {
  ALLOWED_MENTIONS,
  clampPage,
  formatChanceWithRatio,
  formatInteger,
  formatWeight,
  safeUsername,
  seedThumbnail,
} = require('../utils/format');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const INVENTORY_PAGE_SIZE = 12;
const SELL_PAGE_SIZE = 25;
const WHITE = 0xFFFFFF;

function v2Payload(components, options = {}) {
  const payload = {
    content: null,
    embeds: [],
    allowedMentions: ALLOWED_MENTIONS,
    components,
  };
  if (options.initial !== false) {
    payload.flags = COMPONENTS_V2_FLAG | (options.ephemeral ? EPHEMERAL_FLAG : 0);
  }
  return payload;
}

function textContainer(content, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: options.color ?? WHITE,
    components: [{ type: 10, content: String(content).slice(0, 4_000) }],
  }], options);
}

function errorPayload(content, options = {}) {
  return textContainer(`### ${content}`, { color: 0xEF4444, ...options });
}

function rollPayload(userId, instance, options = {}) {
  const seed = instance.seed;
  const content = `<@${userId}>, You have rolled **${seed.displayName}**\n\n`
    + `-# Rarity: ${seed.rarity} • \`${formatChanceWithRatio(seed)}\`\n`
    + `-# Weight: \`${formatWeight(instance.item?.weightUnits ?? instance.weightUnits)}\` kg`;
  return v2Payload([{
    type: 17,
    accent_color: seed.rarityColor,
    components: [{
      type: 9,
      components: [{ type: 10, content }],
      accessory: { type: 11, media: { url: seedThumbnail(seed) }, description: `${seed.displayName} crop` },
    }],
  }], options);
}

function balancePayload(user, balance, options = {}) {
  const avatar = user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || seedThumbnail(null);
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [{
      type: 9,
      components: [{ type: 10, content: `* ${formatInteger(balance)} ${SHECKLES_EMOJI}` }],
      accessory: { type: 11, media: { url: avatar }, description: `${safeUsername(user?.username)} avatar` },
    }],
  }], options);
}

function inventoryCropFields(items) {
  const fields = [];
  (items || []).forEach((item, index) => {
    const seed = SEED_BY_ID.get(item.seedId);
    fields.push({
      name: `${item.cropName} ${seed?.emoji || ''}`.trim().slice(0, 256),
      value: `-# * ${seed?.rarityEmoji || ''} ${item.rarity}\n-# * ${formatWeight(item.weightUnits)} kg`.slice(0, 1_024),
      inline: true,
    });
    if ((index + 1) % 2 === 0) fields.push({ name: '\u200b', value: '\u200b', inline: true });
  });
  return fields;
}

function inventoryPageData(state, view) {
  const filtered = filterInventory(state.items, view.filters);
  const maxPage = Math.max(1, Math.ceil(filtered.length / INVENTORY_PAGE_SIZE));
  view.page = clampPage(view.page, maxPage);
  const start = (view.page - 1) * INVENTORY_PAGE_SIZE;
  return { filtered, maxPage, pageItems: filtered.slice(start, start + INVENTORY_PAGE_SIZE) };
}

function inventoryPayload(user, state, view, options = {}) {
  const page = inventoryPageData(state, view);
  const fields = inventoryCropFields(page.pageItems);
  if (!fields.length) fields.push({ name: 'No crops found', value: '-# Adjust your filters or roll a crop.', inline: false });
  return {
    content: null,
    allowedMentions: ALLOWED_MENTIONS,
    embeds: [{
      color: WHITE,
      title: `${safeUsername(user?.username)}'s Inventory`.slice(0, 256),
      description: `* Capacity: ${state.count} / ${state.player.inventoryCapacity}\n* Total value: ${formatInteger(state.totalValue)} ${SHECKLES_EMOJI}`,
      thumbnail: { url: user?.displayAvatarURL?.({ extension: 'png', size: 256 }) || seedThumbnail(null) },
      fields,
    }],
    components: [{
      type: 1,
      components: [
        { type: 2, style: 2, label: `Page ${view.page} / ${page.maxPage}`, custom_id: `rng:inv:page:${view.id}` },
        { type: 2, style: 2, label: 'Filter', custom_id: `rng:inv:filter:${view.id}` },
        { type: 2, style: 3, label: 'Upgrade', custom_id: `rng:inv:upgrade:${view.id}` },
      ],
    }],
    ...(options.ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
  };
}

function groupedSaleSummary(selectedItems, maximumLength = 3_000) {
  if (!selectedItems.length) return '-# No crops selected.';
  const groups = new Map();
  for (const item of selectedItems) {
    const key = `${item.seedId}:${item.weightUnits}`;
    const current = groups.get(key) || { item, count: 0 };
    current.count += 1;
    groups.set(key, current);
  }
  const lines = [...groups.values()].map(({ item, count }) => {
    const emoji = SEED_BY_ID.get(item.seedId)?.emoji || '';
    return `${emoji} \`[${formatWeight(item.weightUnits)} kg]\`${count > 1 ? ` ×${count}` : ''}`.trim();
  });
  const shown = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > maximumLength) break;
    shown.push(line);
    length += line.length + 1;
  }
  if (shown.length < lines.length) shown.push(`-# …and ${lines.length - shown.length} more weight group(s).`);
  return shown.join('\n');
}

function salePageData(state, session) {
  const filtered = filterInventory(state.items, session.filters);
  const maxPage = Math.max(1, Math.ceil(filtered.length / SELL_PAGE_SIZE));
  session.currentPage = clampPage(session.currentPage, maxPage);
  const start = (session.currentPage - 1) * SELL_PAGE_SIZE;
  const pageItems = filtered.slice(start, start + SELL_PAGE_SIZE);
  const itemMap = new Map(state.items.map((item) => [item.id, item]));
  for (const selectedId of [...session.selectedItemIds]) {
    if (!itemMap.has(selectedId)) session.selectedItemIds.delete(selectedId);
  }
  const selectedItems = [...session.selectedItemIds].map((id) => itemMap.get(id)).filter(Boolean);
  const total = selectedItems.reduce((sum, item) => sum + item.value, 0n);
  return { filtered, maxPage, pageItems, selectedItems, total };
}

function saleSelectOption(item, selected) {
  const seed = SEED_BY_ID.get(item.seedId);
  const option = {
    label: `${item.cropName} • ${formatWeight(item.weightUnits)} kg`.slice(0, 100),
    description: `${item.rarity} • ${formatInteger(item.value)} Sheckles`.slice(0, 100),
    value: item.id,
    default: selected,
  };
  const emoji = componentEmoji(seed?.emoji);
  if (emoji) option.emoji = emoji;
  return option;
}

function salePayload(state, session, options = {}) {
  const page = salePageData(state, session);
  const inner = [{
    type: 10,
    content: `### Select crop to sell\n\n- Crop selected:\n${groupedSaleSummary(page.selectedItems)}\n\n- Total value: ${formatInteger(page.total)} ${SHECKLES_EMOJI}`,
  }, { type: 14, divider: true, spacing: 1 }];
  if (page.pageItems.length) {
    inner.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `rng:sale:select:${session.id}`,
        placeholder: `Crop ${session.currentPage} / ${page.maxPage}`,
        min_values: 0,
        max_values: page.pageItems.length,
        options: page.pageItems.map((item) => saleSelectOption(item, session.selectedItemIds.has(item.id))),
      }],
    });
  } else {
    inner.push({ type: 10, content: '-# No inventory items match the current sell filter.' });
  }
  inner.push({
    type: 1,
    components: [
      { type: 2, style: 2, emoji: { name: '‹' }, custom_id: `rng:sale:prev:${session.id}`, disabled: session.currentPage <= 1 },
      { type: 2, style: 2, label: `Page ${session.currentPage} / ${page.maxPage}`, custom_id: `rng:sale:page:${session.id}`, disabled: true },
      { type: 2, style: 2, emoji: { name: '›' }, custom_id: `rng:sale:next:${session.id}`, disabled: session.currentPage >= page.maxPage },
      { type: 2, style: 2, label: 'Sell filter', custom_id: `rng:sale:filter:${session.id}` },
    ],
  }, {
    type: 1,
    components: [
      { type: 2, style: 4, label: 'Deny', custom_id: `rng:sale:deny:${session.id}` },
      { type: 2, style: 3, label: 'Sell', custom_id: `rng:sale:confirm:${session.id}`, disabled: !session.selectedItemIds.size },
    ],
  });
  return v2Payload([{ type: 17, accent_color: WHITE, components: inner }], options);
}

function upgradePromptPayload(action, player, options = {}) {
  const affordable = player.balance >= action.cost;
  const missing = affordable ? 0n : action.cost - player.balance;
  const label = affordable ? 'Upgrade' : `You need ${formatInteger(missing)} more!`;
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### Upgrade inventory\n\nYou'll need:\n\n-# * ${formatInteger(action.cost)} ${SHECKLES_EMOJI}` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: '-# * Every upgrade gives +25 capacity.' },
      { type: 1, components: [{
        type: 2,
        style: affordable ? 3 : 4,
        label: label.slice(0, 80),
        custom_id: `rng:upgrade:confirm:${action.id}`,
        disabled: !affordable,
      }] },
    ],
  }], { ...options, ephemeral: true });
}

function saleFinishedPayload(itemCount, total, options = {}) {
  return textContainer(`Sale complete\nSold **${itemCount}** crop${itemCount === 1 ? '' : 's'} for **${formatInteger(total)}** ${SHECKLES_EMOJI}.`, { color: 0x22C55E, ...options });
}

function saleDeniedPayload(options = {}) {
  return textContainer('Sale cancelled\nYour crops were not changed.', { color: 0xEF4444, ...options });
}

module.exports = {
  COMPONENTS_V2_FLAG,
  EPHEMERAL_FLAG,
  INVENTORY_PAGE_SIZE,
  SELL_PAGE_SIZE,
  balancePayload,
  errorPayload,
  groupedSaleSummary,
  inventoryCropFields,
  inventoryPageData,
  inventoryPayload,
  rollPayload,
  saleDeniedPayload,
  saleFinishedPayload,
  salePageData,
  salePayload,
  textContainer,
  upgradePromptPayload,
  v2Payload,
};
