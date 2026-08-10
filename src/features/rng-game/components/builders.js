const { MessageFlags } = require('discord.js');
const { SEEDS, SEED_BY_ID } = require('../data/seeds');
const {
  RARITY_EMOJIS,
  SHECKLES_EMOJI,
  componentEmoji,
  customEmojiImageUrl,
} = require('../data/emojis');
const { filterInventory } = require('../utils/normalize');
const { autoRollSummaryEntries } = require('../services/autoRollService');
const {
  MAX_BIG_CROP_TIER,
  MAX_LUCK_TIER,
  bigChance,
} = require('../services/rngService');
const { formatMultiplier, formatPercent, romanTier } = require('../utils/upgrades');
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
  const isBig = Boolean(instance.item?.isBig ?? instance.isBig);
  const chance = instance.effectiveChance
    ? { ...seed, chanceNumerator: instance.effectiveChance.numerator, chanceDenominator: instance.effectiveChance.denominator }
    : seed;
  const content = `<@${userId}>, You have rolled ${isBig ? '**BIG** ' : ''}**${seed.displayName}**\n\n`
    + `-# Rarity: ${seed.rarityEmoji} • \`${formatChanceWithRatio(chance)}\`\n`
    + `-# Weight: \`${formatWeight(instance.item?.weightUnits ?? instance.weightUnits)}\` kg`;
  return v2Payload([{
    type: 17,
    accent_color: seed.rarityColor,
    components: [{
      type: 9,
      components: [{ type: 10, content }],
      accessory: { type: 11, media: { url: seedThumbnail(seed) } },
    }],
  }], options);
}

function secretRollAnnouncementPayload(event) {
  const { seed } = event;
  const cropName = `${event.isBig ? 'BIG ' : ''}${seed.displayName}`;
  const payload = v2Payload([{
    type: 17,
    accent_color: 0xFACC15,
    components: [{
      type: 9,
      components: [{
        type: 10,
        content: `### ${seed.rarityEmoji} <@${event.userId}> has rolled **${cropName}**, CONGRATS!\n`
          + '-# Chance: `1/1m`\n'
          + `-# Weight: ${formatWeight(event.finalWeightUnits)} kg`,
      }],
      accessory: { type: 11, media: { url: customEmojiImageUrl(seed.emoji) } },
    }],
  }]);
  payload.allowedMentions = {
    parse: [],
    users: [String(event.userId)],
    roles: [],
    repliedUser: false,
  };
  return payload;
}

function balancePayload(user, balance, options = {}) {
  return textContainer(
    `### <@${user.id}>'s Balance\n- Sheckles: ${formatInteger(balance)} ${SHECKLES_EMOJI}`,
    options,
  );
}

function statPayload(user, statistics, options = {}) {
  const highestRarity = statistics.highestRarity
    ? (RARITY_EMOJIS[statistics.highestRarity] || 'None')
    : 'None';
  const bestPlant = statistics.bestSeed
    ? `${statistics.bestSeed.emoji} ${statistics.bestSeed.displayName}`
    : 'None';
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      {
        type: 9,
        components: [{
          type: 10,
          content: `### <@${user.id}>'s Rollin stats\n\n`
            + `* Has done ${formatInteger(statistics.totalRolls)} rolls\n\n`
            + `-# ${formatInteger(statistics.autoRolls)} auto-rolls`,
        }],
        accessory: {
          type: 11,
          media: { url: user.displayAvatarURL({ extension: 'png', size: 256 }) },
        },
      },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 10,
        content: `- Highest rarity discovered: ${highestRarity}\n\n`
          + `* Best plant discovered: ${bestPlant}\n\n`
          + `-# * Best Plant's Highest weight: ${formatWeight(statistics.bestSeedHighestWeightUnits)} kg\n\n`
          + `* Highest weight discovered: ${formatWeight(statistics.highestWeightUnits)} kg`,
      },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 10,
        content: `- Earning all time: ${formatInteger(statistics.totalSaleEarnings)} ${SHECKLES_EMOJI}\n\n`
          + `* Highest earning in one sale: ${formatInteger(statistics.highestSingleSale)} ${SHECKLES_EMOJI}`,
      },
    ],
  }], options);
}

function inventoryCropFields(items) {
  const fields = [];
  (items || []).forEach((item, index) => {
    const seed = SEED_BY_ID.get(item.seedId);
    fields.push({
      name: `${item.isBig ? '**BIG** ' : ''}${item.cropName} ${seed?.emoji || ''}`.trim().slice(0, 256),
      value: `-# * ${seed?.rarityEmoji || ''}\n-# * ${formatWeight(item.weightUnits)} kg`.slice(0, 1_024),
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
  const cropGroups = new Map();
  for (const item of selectedItems) {
    const cropKey = item.seedId;
    if (!cropGroups.has(cropKey)) cropGroups.set(cropKey, new Map());
    const weightMap = cropGroups.get(cropKey);
    const weightKey = item.weightUnits;
    const current = weightMap.get(weightKey) || { item, count: 0 };
    current.count += 1;
    weightMap.set(weightKey, current);
  }
  const lines = [...cropGroups.values()].map((weightMap) => {
    const firstItem = [...weightMap.values()][0].item;
    const emoji = SEED_BY_ID.get(firstItem.seedId)?.emoji || '';
    const parts = [...weightMap.values()].map(({ item, count }) => {
      return `\`[${formatWeight(item.weightUnits)} kg]\`${count > 1 ? ` ×${count}` : ''}`;
    });
    return `${emoji} ${parts.join(', ')}`.trim();
  });
  const shown = [];
  let length = 0;
  for (const line of lines) {
    if (length + line.length + 1 > maximumLength) break;
    shown.push(line);
    length += line.length + 1;
  }
  if (shown.length < lines.length) shown.push(`-# …and ${lines.length - shown.length} more crop(s).`);
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
      { type: 2, style: 2, label: 'Previous', custom_id: `rng:sale:prev:${session.id}`, disabled: session.currentPage <= 1 },
      { type: 2, style: 2, label: `Page ${session.currentPage} / ${page.maxPage}`, custom_id: `rng:sale:page:${session.id}`, disabled: true },
      { type: 2, style: 2, label: 'Next', custom_id: `rng:sale:next:${session.id}`, disabled: session.currentPage >= page.maxPage },
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
      { type: 10, content: '-# * Every upgrade gives +10 capacity.' },
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

function autoRollSubmitPayload(action, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: '### Submit a duration' },
      { type: 1, components: [{ type: 2, style: 2, label: 'Submit', custom_id: `rng:auto:form:${action.id}` }] },
    ],
  }], options);
}

function autoRollStatusPayload(job, options = {}) {
  return textContainer(
    `### Auto Roll already running\n\nYour current Auto Roll ends <t:${Math.ceil(job.endsAt / 1_000)}:R> (<t:${Math.ceil(job.endsAt / 1_000)}:F>).`,
    options,
  );
}

function autoRollPreviewPayload(action, balance, options = {}) {
  const affordable = BigInt(balance) >= action.totalCost;
  const missing = affordable ? 0n : action.totalCost - BigInt(balance);
  const autoSell = action.selectedAutoSellRarities.length
    ? action.selectedAutoSellRarities.join(', ')
    : 'None — Auto Roll will stop when inventory is full';
  return v2Payload([{
    type: 17,
    accent_color: 0x22C55E,
    components: [
      { type: 10, content: `### Auto roll for ${action.normalized}\n\n-# * Cost: ${formatInteger(action.totalCost)} ${SHECKLES_EMOJI}\n-# * Auto sell: ${autoSell}` },
      { type: 1, components: [{
        type: 2,
        style: affordable ? 3 : 4,
        label: affordable ? 'Start' : `You need ${formatInteger(missing)} more Sheckles!`.slice(0, 80),
        custom_id: `rng:auto:start:${action.id}`,
        disabled: !affordable,
      }] },
    ],
  }], options);
}

function autoRollStartedPayload(job, options = {}) {
  return textContainer(
    `Auto Roll started\nYour first roll is <t:${Math.floor(job.nextTickAt / 1_000)}:R> and the purchased duration ends <t:${Math.floor(job.endsAt / 1_000)}:F>.`,
    { color: 0x22C55E, ...options },
  );
}

function autoRollEndedPayload(job, options = {}) {
  const summary = autoRollSummaryEntries(job)
    .map(({ seed, count }) => `-# * ${seed.rarityEmoji} - ${seed.emoji} ${seed.displayName} ×${count}`)
    .join('\n') || '-# * No crops were rolled.';
  const stopped = job.stoppedReason
    ? `\n\n-# * Stopped: ${job.stoppedReason}\n-# * Refund: ${formatInteger(job.refundPaid)} ${SHECKLES_EMOJI}`
    : '';
  return textContainer(
    `<@${job.userId}> Your auto roll has ended! Purchase again to continue.\n\nSummary:\n\n${summary}${stopped}`,
    { color: 0x22C55E, ...options },
  );
}

function upgradeButton(kind, tier, balance, cost, actionId, maximumTier) {
  if (tier >= maximumTier) {
    return {
      type: 2,
      style: 2,
      label: 'MAX',
      custom_id: `rng:power:max:${kind}`,
      disabled: true,
    };
  }
  const affordable = BigInt(balance) >= cost;
  const button = {
    type: 2,
    style: affordable ? 3 : 4,
    label: formatInteger(cost),
    custom_id: `rng:power:buy:${actionId}`,
    disabled: !affordable,
  };
  const emoji = componentEmoji(SHECKLES_EMOJI);
  if (emoji) button.emoji = emoji;
  return button;
}

function powerUpgradePayload(user, player, controls, options = {}) {
  const luckAtMax = player.luckTier >= MAX_LUCK_TIER;
  const luckHeading = luckAtMax
    ? `* **Luck** Tier ${romanTier(player.luckTier)} — Maximum`
    : `* **Luck** Tier ${romanTier(player.luckTier)} → ${romanTier(player.luckTier + 1)}`;
  const luckText = `${luckHeading}\n-# Current luck: ×${formatMultiplier(player.luckTier + 1)}`;
  const currentBig = bigChance(player.bigCropTier);
  const bigAtMax = player.bigCropTier >= MAX_BIG_CROP_TIER;
  const bigText = `* **BIG** Crop chance ${romanTier(player.bigCropTier)}${bigAtMax ? ' — Maximum' : ` → ${romanTier(player.bigCropTier + 1)}`}\n`
    + `-# Current: ${formatPercent((currentBig.numerator * 100) / currentBig.denominator)}%`;
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### <@${user.id}>'s Upgrades` },
      {
        type: 9,
        components: [{ type: 10, content: luckText }],
        accessory: upgradeButton('luck', player.luckTier, player.balance, controls.luckCost, controls.luckActionId, MAX_LUCK_TIER),
      },
      {
        type: 9,
        components: [{ type: 10, content: bigText }],
        accessory: upgradeButton('big', player.bigCropTier, player.balance, controls.bigCost, controls.bigActionId, MAX_BIG_CROP_TIER),
      },
    ],
  }], options);
}

function indexPayload(userId, discoveredCount, view, image, options = {}) {
  const filename = `rng-index-${view.id}.png`;
  return {
    ...v2Payload([{
      type: 17,
      accent_color: WHITE,
      components: [
        { type: 10, content: `### <@${userId}>'s Index\n\n- You have discovered: ${discoveredCount} / ${SEEDS.length} crops!` },
        { type: 14, divider: true, spacing: 1 },
        { type: 12, items: [{ media: { url: `attachment://${filename}` } }] },
        { type: 1, components: [{ type: 2, style: 2, label: `Page ${view.page} / ${view.maxPage}`, custom_id: `rng:index:page:${view.id}` }] },
      ],
    }], options),
    files: [{ attachment: image, name: filename }],
    attachments: [],
  };
}

module.exports = {
  COMPONENTS_V2_FLAG,
  EPHEMERAL_FLAG,
  INVENTORY_PAGE_SIZE,
  SELL_PAGE_SIZE,
  balancePayload,
  autoRollEndedPayload,
  autoRollPreviewPayload,
  autoRollStartedPayload,
  autoRollStatusPayload,
  autoRollSubmitPayload,
  errorPayload,
  groupedSaleSummary,
  inventoryCropFields,
  inventoryPageData,
  inventoryPayload,
  indexPayload,
  powerUpgradePayload,
  rollPayload,
  secretRollAnnouncementPayload,
  statPayload,
  saleDeniedPayload,
  saleFinishedPayload,
  salePageData,
  salePayload,
  textContainer,
  upgradePromptPayload,
  v2Payload,
};
