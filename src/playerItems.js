const RARITY_EMOJIS = {
  common: '<:SBCommon:1500170919614873720>',
  rare: '<:SBRare:1500170929794449642>',
  epic: '<:SBEpic:1500170921623945356>',
  legendary: '<:SBLegendary:1500170923398008882>',
  mythical: '<:SBMythical:1500170927378534621>',
  secret: '<:SBSecret:1500170932235276398>',
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
