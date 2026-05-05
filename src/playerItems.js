const RARITY_EMOJIS = {
  common: '<:SBCommon:1501152350189125662>',
  rare: '<:SBRare:1501152357403201537>',
  epic: '<:SBEpic:1501152351862394890>',
  legendary: '<:SBLegendary:1501152353896632411>',
  mythical: '<:SBMythical:1501152359164940419>',
  secret: '<:SBSecret:1501152355624947853>',
};

const RARITY_LABELS = {
  common: 'Common',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
  mythical: 'Mythical',
  secret: 'Secret',
};

const ITEM_TYPES = {
  gear: 'Gear',
  material: 'Material',
  consumable: 'Consumable',
  accessory: 'Accessory',
};

const ITEMS = [
  {
    id: 'jungle_goo',
    name: 'Jungle Goo',
    emoji: '<:ITJungleGoo:1501156916737609798>',
    rarity: 'common',
    sellValue: 8,
    type: ITEM_TYPES.material,
  },
];

const ITEM_BY_ID = Object.fromEntries(ITEMS.map((item) => [item.id, item]));

function rarityLabel(rarity) {
  const key = String(rarity || 'common').toLowerCase();
  return RARITY_LABELS[key] || RARITY_LABELS.common;
}

function rarityEmoji(rarity) {
  const key = String(rarity || 'common').toLowerCase();
  return RARITY_EMOJIS[key] || RARITY_EMOJIS.common;
}

module.exports = {
  RARITY_EMOJIS,
  RARITY_LABELS,
  ITEM_TYPES,
  ITEMS,
  ITEM_BY_ID,
  rarityLabel,
  rarityEmoji,
};
