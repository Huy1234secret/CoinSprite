const { RARITIES } = require('./seeds');

function pet(config) {
  if (!RARITIES[config.rarity]) throw new Error(`Unknown pet rarity: ${config.rarity}`);
  return Object.freeze({ ...config, effect: Object.freeze({ ...config.effect }) });
}

const PETS = Object.freeze([
  pet({ id: 'frog', displayName: 'Frog', emoji: '<:FrogPet:1537702944915325042>', rarity: 'Common', hatchWeight: 3_000, chanceText: '30', perk: 'Crop weight ×1.015', animation: 'CFrog.gif', effect: { kind: 'weight', weightBps: 10_150 } }),
  pet({ id: 'bunny', displayName: 'Bunny', emoji: '<:BunnyPet:1537702936778383391>', rarity: 'Common', hatchWeight: 3_000, chanceText: '30', perk: 'Stored crop value +1.5%', animation: 'CBunny.gif', effect: { kind: 'value', valueBonusBps: 150 } }),
  pet({ id: 'owl', displayName: 'Owl', emoji: '<:OwlPet:1537702951705907250>', rarity: 'Uncommon', hatchWeight: 1_800, chanceText: '18', perk: 'Rare-or-better crop chance ×1.02, excluding Secret', animation: 'UCOwl.gif', effect: { kind: 'rarity-group', minimumRarity: 'Rare', numerator: 102, denominator: 100, excludeSecret: true } }),
  pet({ id: 'deer', displayName: 'Deer', emoji: '<:DeerPet:1537702941253836945>', rarity: 'Rare', hatchWeight: 800, chanceText: '8', perk: 'Crop weight ×1.03', animation: 'MDeer.gif', effect: { kind: 'weight', weightBps: 10_300 } }),
  pet({ id: 'turtle', displayName: 'Turtle', emoji: '<:TurtlePet:1537702956411912192>', rarity: 'Rare', hatchWeight: 800, chanceText: '8', perk: 'BIG crop chance +0.15 percentage points', animation: 'RTurtle.gif', effect: { kind: 'big', bigBonusBps: 15 } }),
  pet({ id: 'robin', displayName: 'Robin', emoji: '<:RobinPet:1537702954306641920>', rarity: 'Legendary', hatchWeight: 160, chanceText: '1.6', perk: 'Epic-or-better crop chance ×1.05, excluding Secret', animation: 'LRobin.gif', effect: { kind: 'rarity-group', minimumRarity: 'Epic', numerator: 105, denominator: 100, excludeSecret: true } }),
  pet({ id: 'bee', displayName: 'Bee', emoji: '<:BeePet:1537702934211731546>', rarity: 'Legendary', hatchWeight: 140, chanceText: '1.4', perk: 'Crop weight ×1.05', animation: 'LBee.gif', effect: { kind: 'weight', weightBps: 10_500 } }),
  pet({ id: 'butterfly', displayName: 'Butterfly', emoji: '<:ButterflyPet:1537702939211206747>', rarity: 'Legendary', hatchWeight: 100, chanceText: '1.0', perk: 'BIG crop chance +0.35 percentage points', animation: 'LButterfly.gif', effect: { kind: 'big', bigBonusBps: 35 } }),
  pet({ id: 'monkey', displayName: 'Monkey', emoji: '<:MonkeyPet:1537702949764075590>', rarity: 'Mythic', hatchWeight: 50, chanceText: '0.5', perk: 'Stored crop value +5%', animation: 'MMonkey.gif', effect: { kind: 'value', valueBonusBps: 500 } }),
  pet({ id: 'firefly', displayName: 'Firefly', emoji: '<:firefly:1537702943044673618>', rarity: 'Mythic', hatchWeight: 50, chanceText: '0.5', perk: 'Mythic crop chance ×1.08', animation: 'MFirefly.gif', effect: { kind: 'rarity', rarity: 'Mythic', numerator: 108, denominator: 100 } }),
  pet({ id: 'golden_dragonfly', displayName: 'Golden Dragonfly', emoji: '<:GoldenDragonfly_Pet:1537702947104751746>', rarity: 'Mythic', hatchWeight: 40, chanceText: '0.4', perk: 'Super crop chance ×1.10', animation: 'MGoldenDragonfly.gif', effect: { kind: 'rarity', rarity: 'Super', numerator: 110, denominator: 100 } }),
  pet({ id: 'unicorn', displayName: 'Unicorn', emoji: '<:UnicornPet:1537702958404468746>', rarity: 'Mythic', hatchWeight: 35, chanceText: '0.35', perk: 'Epic-or-better crop chance ×1.05, excluding Secret', animation: 'MUnicorn.gif', effect: { kind: 'rarity-group', minimumRarity: 'Epic', numerator: 105, denominator: 100, excludeSecret: true } }),
  pet({ id: 'bear', displayName: 'Bear', emoji: '<:BearPet:1537702930864672768>', rarity: 'Mythic', hatchWeight: 25, chanceText: '0.25', perk: 'Crop weight ×1.08 and BIG chance +0.25 percentage points', animation: 'LBear.gif', effect: { kind: 'weight-big', weightBps: 10_800, bigBonusBps: 25 } }),
]);

if (PETS.reduce((sum, entry) => sum + entry.hatchWeight, 0) !== 10_000) {
  throw new Error('Pet hatch weights must total exactly 10,000 basis points.');
}

const PET_BY_ID = new Map(PETS.map((entry) => [entry.id, entry]));
const PET_SLOT_PRICES = Object.freeze({ 1: 0n, 2: 100_000n, 3: 1_000_000n });

module.exports = Object.freeze({ PETS, PET_BY_ID, PET_SLOT_PRICES });
