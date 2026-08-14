const fs = require('fs');
const path = require('path');
const { ITEM_BY_ID } = require('../data/items');
const { PET_BY_ID } = require('../data/pets');
const { RARITIES } = require('../data/seeds');
const {
  RARITY_EMOJIS,
  SHECKLES_EMOJI,
  componentEmoji,
  customEmojiImageUrl,
} = require('../data/emojis');
const { formatInteger } = require('../utils/format');
const { errorPayload, textContainer, v2Payload } = require('../../shared/components');

const WHITE = 0xFFFFFF;
const EGG_ANIMATION_DIRECTORY = path.join(__dirname, '..', '..', '..', '..', 'images', 'egg_open');

function shopSelectOption(item) {
  const out = BigInt(item.stockRemaining) <= 0n;
  const option = {
    label: `${item.displayName} — ${formatInteger(item.price)}`.slice(0, 100),
    description: `${out ? 'OUT OF STOCK' : `Stock: x${item.stockRemaining}`} • ${item.rarity}`.slice(0, 100),
    value: item.id,
  };
  const emoji = componentEmoji(item.emoji);
  if (emoji) option.emoji = emoji;
  return option;
}

function shopPayload(pageData, view, options = {}) {
  const files = pageData.cards.map(({ item, image }) => ({
    attachment: image,
    name: `shop-${item.id}-${pageData.restockEpoch}.png`,
  }));
  const components = [
    { type: 10, content: `### CoinSprite shop\n-# Personalized for Luck ${pageData.pricedLuckTier} • BIG ${pageData.pricedBigTier} • Restock <t:${Math.floor(pageData.nextRestockAt / 1_000)}:R>` },
    {
      type: 12,
      items: files.map((file) => ({ media: { url: `attachment://${file.name}` } })),
    },
    { type: 14, divider: true, spacing: 1 },
    {
      type: 1,
      components: [{
        type: 3,
        custom_id: `rng:shop:select:${view.id}`,
        placeholder: 'Select item to purchase',
        min_values: 1,
        max_values: 1,
        options: pageData.items.map(shopSelectOption),
      }],
    },
  ];
  if (pageData.maxPage > 1) {
    components.push({
      type: 1,
      components: [
        { type: 2, style: 2, label: 'Previous', custom_id: `rng:shop:prev:${view.id}`, disabled: pageData.page <= 1 },
        { type: 2, style: 2, label: `Page ${pageData.page} / ${pageData.maxPage}`, custom_id: `rng:shop:page:${view.id}`, disabled: true },
        { type: 2, style: 2, label: 'Next', custom_id: `rng:shop:next:${view.id}`, disabled: pageData.page >= pageData.maxPage },
      ],
    });
  }
  return {
    ...v2Payload([{ type: 17, accent_color: WHITE, components }], options),
    files,
    attachments: [],
  };
}

function pricingDecimal(numerator, denominator, places = 2) {
  const scale = 10n ** BigInt(places);
  const scaled = (BigInt(numerator) * scale) / BigInt(denominator);
  const whole = scaled / scale;
  const remainder = String(scaled % scale).padStart(places, '0').replace(/0+$/, '');
  return remainder ? `${whole}.${remainder}` : String(whole);
}

function purchasePreviewPayload(action, item, options = {}) {
  const pricing = action.pricing;
  const total = BigInt(action.amount) * BigInt(action.price);
  const probability = (units) => `${pricingDecimal(units, 10_000_000n, 6)}%`;
  const multiplier = (bps) => `×${pricingDecimal(bps, 10_000n, 3)}`;
  const percentBps = (bps) => `${pricingDecimal(bps, 100n, 2)}%`;
  let relevant;
  if (item.effect.kind === 'rarity' || item.effect.kind === 'rarity-flat') {
    relevant = `${item.effect.rarity} odds: **${probability(pricing.baseline.rarityUnits[item.effect.rarity])} → ${probability(pricing.boosted.rarityUnits[item.effect.rarity])}**`;
  } else if (item.effect.kind === 'sprinkler') {
    relevant = `Weight: **${multiplier(pricing.baseline.weightMultiplierBps)} → ${multiplier(pricing.boosted.weightMultiplierBps)}**\n- BIG chance: **${percentBps(pricing.baseline.effectiveBigChanceBps)} → ${percentBps(pricing.boosted.effectiveBigChanceBps)}**`;
  } else if (item.effect.kind === 'watering-can') {
    relevant = `Weight on the next successful roll: **${multiplier(pricing.baseline.weightMultiplierBps)} → ${multiplier(pricing.boosted.weightMultiplierBps)}**`;
  } else {
    relevant = 'Result: **1 random permanent pet**';
  }
  const duration = item.durationMs >= 60 * 60 * 1_000
    ? `${item.durationMs / (60 * 60 * 1_000)} hour`
    : item.durationMs > 0
      ? `${item.durationMs / (60 * 1_000)} minutes`
      : item.effect.kind === 'watering-can' ? '1 charge' : 'Instant';
  const content = [
    '### Confirm purchase',
    `${item.emoji} **${item.displayName} x${action.amount}**`,
    '',
    `- Permanent tiers: **Luck ${pricing.pricedLuckTier} • BIG ${pricing.pricedBigTier}**`,
    `- ${relevant}`,
    `- Duration: **${duration}** • Estimated affected rolls: **${pricing.affectedRolls}**`,
    '',
    '### Price breakdown',
    `- Minimum price: ${formatInteger(pricing.minimumPrice)} ${SHECKLES_EMOJI}`,
    `- Permanent-tier scaling (${multiplier(pricing.tierScaleBps)}): ${formatInteger(pricing.progressionFloor)} ${SHECKLES_EMOJI}`,
    `- Expected-effect pricing (+${pricingDecimal(BigInt(pricing.priceMarginBps) - 10_000n, 100n, 2)}% margin): ${formatInteger(pricing.upliftPrice)} ${SHECKLES_EMOJI}`,
    `- Final rounded price: **${formatInteger(pricing.price)}** ${SHECKLES_EMOJI} each`,
    `- Exact total: **${formatInteger(total)}** ${SHECKLES_EMOJI}`,
    '',
    '-# Stock, permanent tiers, configuration, and price will be checked again when you confirm.',
  ].join('\n');
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content },
      { type: 1, components: [
        { type: 2, style: 3, label: 'Confirm', custom_id: `rng:shop:confirm:${action.id}` },
        { type: 2, style: 2, label: 'Cancel', custom_id: `rng:shop:cancel:${action.id}` },
      ] },
    ],
  }], { ...options, ephemeral: true });
}

function purchaseResultPayload(result, options = {}) {
  const item = ITEM_BY_ID.get(result.itemId);
  return textContainer(
    `### Purchase complete\n${item?.emoji || ''} **${item?.displayName || result.itemId} x${result.amount}** was added to your item inventory.\n\n- Spent: ${formatInteger(result.total)} ${SHECKLES_EMOJI}\n- Balance: ${formatInteger(result.balance)} ${SHECKLES_EMOJI}\n- Shop stock: x${result.stock}`,
    { color: 0x22C55E, ...options },
  );
}

function useResultPayload(item, result, options = {}) {
  let effect;
  if (result.kind === 'watering-can') {
    effect = `${item.description}\n- Remaining charges: **${result.charges}**\n-# One charge is consumed only after a crop is successfully stored; crop weight is capped at ×2.50.`;
  } else {
    effect = `${item.description}\n- Active until: <t:${Math.floor(result.endsAt / 1_000)}:R>\n-# Reusing the same item extends duration without increasing strength${item.type === 'Sprinkler' ? '; only one sprinkler can be active' : ''}.`;
  }
  return v2Payload([{
    type: 17,
    accent_color: RARITIES[item.rarity]?.color || WHITE,
    components: [{
      type: 9,
      components: [{ type: 10, content: `### Item used\n${item.emoji} **${item.displayName} x${result.amount}**\n\n${effect}` }],
      accessory: { type: 11, media: { url: customEmojiImageUrl(item.emoji) } },
    }],
  }], options);
}

function eggAnimationSource(instance, directory = EGG_ANIMATION_DIRECTORY) {
  const pet = instance.pet || PET_BY_ID.get(instance.petId);
  const expected = pet ? path.join(directory, pet.animation) : '';
  if (expected && fs.existsSync(expected)) return { path: expected, fallback: false };
  const generic = path.join(directory, 'default.gif');
  if (fs.existsSync(generic)) return { path: generic, fallback: true };
  return { url: customEmojiImageUrl(pet?.emoji), fallback: true };
}

function eggOpeningPayload(egg, instances, options = {}) {
  const files = [];
  const media = instances.map((instance, index) => {
    const source = eggAnimationSource(instance, options.animationDirectory);
    if (source.path) {
      const name = `egg-opening-${index + 1}.gif`;
      files.push({ attachment: source.path, name });
      return { media: { url: `attachment://${name}` } };
    }
    return { media: { url: source.url } };
  });
  return {
    ...v2Payload([{
      type: 17,
      accent_color: WHITE,
      components: [
        { type: 10, content: `### Opening x${instances.length} ${egg.displayName}` },
        { type: 12, items: media },
      ],
    }], options),
    files,
    attachments: [],
  };
}

function petResultContent(instance, includeHeader) {
  const pet = instance.pet || PET_BY_ID.get(instance.petId);
  const rarityEmoji = RARITY_EMOJIS[pet.rarity] || '';
  return `${includeHeader || ''}### Pet hatched: ${pet.displayName}\n-# Rarity: ${rarityEmoji} ${pet.rarity}\n-# Chance: \`${pet.chanceText}%\``;
}

function hatchedPetsPayload(instances, options = {}) {
  const normalized = instances.map((instance) => ({ ...instance, pet: instance.pet || PET_BY_ID.get(instance.petId) }));
  const components = normalized.map((instance, index) => ({
    type: 17,
    accent_color: RARITIES[instance.pet.rarity]?.color || WHITE,
    components: [{
      type: 9,
      components: [{
        type: 10,
        content: petResultContent(
          instance,
          normalized.length > 1 && index === 0 ? `### Pets hatched: x${normalized.length}\n\n` : '',
        ),
      }],
      accessory: { type: 11, media: { url: customEmojiImageUrl(instance.pet.emoji) } },
    }],
  }));
  return v2Payload(components, options);
}

function unlockPreviewPayload(action, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### Unlock pet slot ${action.slotNumber}?\nThis permanently unlocks the slot for **${formatInteger(action.cost)}** ${SHECKLES_EMOJI}.` },
      { type: 1, components: [
        { type: 2, style: 3, label: 'Unlock', custom_id: `rng:pet:unlock:${action.id}` },
        { type: 2, style: 2, label: 'Cancel', custom_id: `rng:pet:cancel:${action.id}` },
      ] },
    ],
  }], { ...options, ephemeral: true });
}

function itemUseError(result, options = {}) {
  if (result.status === 'insufficient-items') {
    return errorPayload(`Not enough items\nYou own **${result.owned || 0}** and tried to use more.`, options);
  }
  if (result.status === 'sprinkler-conflict') {
    const active = ITEM_BY_ID.get(result.activeItemId);
    return errorPayload(`Sprinkler already active\n${active?.emoji || ''} **${active?.displayName || 'Another sprinkler'}** is active until <t:${Math.floor(result.endsAt / 1_000)}:R>. The selected item was not consumed.`, options);
  }
  if (result.status === 'too-many-eggs') return errorPayload('Too many eggs\nOpen at most **10** eggs per command.', options);
  return errorPayload('Item could not be used\nYour inventory was not changed.', options);
}

module.exports = {
  EGG_ANIMATION_DIRECTORY,
  eggAnimationSource,
  eggOpeningPayload,
  hatchedPetsPayload,
  itemUseError,
  purchasePreviewPayload,
  purchaseResultPayload,
  shopPayload,
  shopSelectOption,
  unlockPreviewPayload,
  useResultPayload,
};
