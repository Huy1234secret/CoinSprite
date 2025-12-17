const { RARITY_EMOJIS } = require('./pets');

const JUNGLE_BETTLE = {
  name: 'Jungle Bettle',
  emoji: '<:MCJungleBettle:1448989040509452338>',
  baseHealth: 100000,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  damage: { min: 1, max: 2 },
  attackType: 'Singular',
  reward: { coins: { min: 50, max: 200 }, xp: { min: 10, max: 40 } },
  levelDistribution: [
    { level: 1, chance: 0.65 },
    { level: 2, chance: 0.3 },
    { level: 3, chance: 0.045 },
    { level: 4, chance: 0.005 },
  ],
  drops: [
    { itemId: 'ITBeastMeat', chance: 0.4 },
    { itemId: 'ITMossyShavings', chance: 0.25 },
  ],
};

const CREATURES = [JUNGLE_BETTLE];

module.exports = {
  CREATURES,
  JUNGLE_BETTLE,
};
