const CURRENCIES = [
  {
    key: 'coins',
    name: 'Coins',
    emoji: '<:CRCoin:1447459216574124074>',
  },
  {
    key: 'diamonds',
    name: 'Diamonds',
    emoji: '<:CRDiamond:1449260848705962005>',
  },
  {
    key: 'prismatic',
    name: 'Prismatic',
    emoji: '<:CRPrismatic:1449260850945982606>',
  },
  {
    key: 'jagmc',
    name: 'JAGMC Token',
    emoji: '<:JAGMC:1463373057795035186>',
    value: 499,
    rarity: 'epic',
    itemType: 'n/a',
  },
];

const CURRENCIES_BY_KEY = CURRENCIES.reduce((acc, currency) => {
  acc[currency.key] = currency;
  return acc;
}, {});

module.exports = {
  CURRENCIES,
  CURRENCIES_BY_KEY,
};
