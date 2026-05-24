const ADMIN_WEATHER = {
  'Golden Rain': {
    emoji: '<:SBWGoldenRain:1507787645403791420>',
    goldenBonus: 0.8,
    text: ['The ocean is shining with gold!'],
  },
  Rainbow: {
    emoji: '<:SBWRainbow:1507787647450480680>',
    goldenBonus: 0.2,
    text: ['Rainbow skies bless the waters!'],
  },
};

const FISH_EVENTS = {
  strength_blessing: {
    name: 'Strength Blessing',
    emoji: '<:SBEStrenghtBoost:1507787642811711589>',
    description: 'You have a feeling that your muscle are stronger! Catching hard fish isnt a problem now!',
    powerMultiplier: 2,
  },
  fish_hotspot: {
    name: 'Fish Hotspot',
    emoji: '<:SBEFishHotspot:1507787640529879144>',
    description: 'Suddenly fish being really active, is this fish festival???',
    instantBite: true,
  },
  attack_of_fish: {
    name: 'Attack of Fish',
    emoji: '<:SBEAttackOfFish:1507787638848098454>',
    description: 'Fish getting fat!',
    giantChance: 0.5,
  },
};

const GIANT_MUTATION = {
  name: 'GIANT',
  emoji: '<:SBEAttackOfFish:150778638848098454>',
  multiplier: 1,
  multiplierType: 'weigh',
  weightMultiplier: 2,
};

module.exports = {
  ADMIN_WEATHER,
  FISH_EVENTS,
  GIANT_MUTATION,
};
