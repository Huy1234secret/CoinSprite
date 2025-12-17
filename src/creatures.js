const { RARITY_EMOJIS } = require('./pets');

const JUNGLE_BETTLE = {
  name: 'Jungle Bettle',
  emoji: '<:MCJungleBettle:1448989040509452338>',
  baseHealth: 65,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  damage: { min: 1, max: 3 },
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

const VINE_SNAKE = {
  name: 'Vine Snake',
  emoji: '<:CMVineSnake:1450727558604914799>',
  baseHealth: 25,
  rarity: 'Common',
  rarityEmoji: RARITY_EMOJIS.Common,
  rarityIcon: RARITY_EMOJIS.Common,
  attackType: 'Singular',
  reward: { coins: { min: 100, max: 350 }, xp: { min: 25, max: 50 } },
  levelDistribution: [
    { level: 1, chance: 0.55 },
    { level: 2, chance: 0.3 },
    { level: 3, chance: 0.13 },
    { level: 4, chance: 0.017 },
    { level: 5, chance: 0.003 },
  ],
  actions: [
    {
      key: 'poisonousBite',
      name: 'Poisonous Bite',
      chance: 0.2,
      damage: { min: 8, max: 10 },
      damageIfPoisoned: { min: 10, max: 15 },
      poison: { percent: 0.25, duration: Infinity },
      message: 'The Vine Snake bit you with it poisonous teeth, dealt {amount} damages and poisoned you forever.',
      alreadyPoisonedMessage: 'The Vine Snake bit you with it poisonous teeth, dealt {amount} damages',
    },
    {
      key: 'tailWipe',
      name: 'Tail Wipe',
      chance: 0.8,
      damage: { min: 4, max: 6 },
      message: 'The Vine Snake wiped you with it tail, dealt {amount} damages',
    },
  ],
  drops: [
    { itemId: 'ITVineFiber', chance: 0.5 },
    { itemId: 'ITWeakVenomGland', chance: 0.45 },
    { itemId: 'ITSharpFang', chance: 0.1 },
  ],
};

const CREATURES = [JUNGLE_BETTLE, VINE_SNAKE];

module.exports = {
  CREATURES,
  JUNGLE_BETTLE,
  VINE_SNAKE,
};
