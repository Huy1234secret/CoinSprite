const PLACEHOLDER = null;
const JUNGLE_SLIME_EMOJI = '<:ENJungleSlime:1501095601432170506>';
const JUNGLE_SLIME_IMAGE_URL = 'https://cdn.discordapp.com/emojis/1501095601432170506.png?size=256&quality=lossless';
const JUNGLE_GOO_EMOJI = '<:ITJungleGoo:1501156916737609798>';

function attack(name, action, notes = '') {
  return { name, powerRequired: PLACEHOLDER, damage: PLACEHOLDER, effectStatusTier: PLACEHOLDER, action, notes };
}
function loot(id, name, chance, emoji = '') { return { id, name, chance, emoji }; }
function enemy(id, name, rarity, attacks, drops, extra = {}) {
  return { id, name, rarity, emoji: extra.emoji || '', imageUrl: extra.imageUrl || '', baseHealth: PLACEHOLDER, baseShield: PLACEHOLDER, xpGiven: PLACEHOLDER, attacks, loot: drops };
}

const ENEMIES = [
  enemy('jungle_slime', 'Jungle Slime', 'Common', [
    attack('Goo Bump', '{enemy} bounces forward and bumps into {target}, dealing {damage} damage!', 'Deal 3 - 4 damage.'),
    attack('Leaf Shield', '{enemy} gathers jungle leaves around itself and gains {shield} shield!', 'Gain 2 shield.'),
    attack('Sticky Splash', '{enemy} splashes sticky goo onto {target}, dealing {damage} damage and slowing them!', 'Deal 3 damage and apply Weakness for 1 turn.'),
  ], [loot('jungle_goo', 'Jungle Goo', 65, JUNGLE_GOO_EMOJI), loot('jungle_leaf', 'Jungle Leaf', 25), loot('vine_rope', 'Vine Rope', 15), loot('slime_core', 'Slime Core', 25)], { emoji: JUNGLE_SLIME_EMOJI, imageUrl: JUNGLE_SLIME_IMAGE_URL }),
  enemy('poison_slime', 'Poison Slime', 'Common', [
    attack('Poison Bump', '{enemy} slams its toxic body into {target}, dealing {damage} damage!', 'Deal 5 damage.'),
    attack('Toxic Splash', '{enemy} spits toxic slime at {target}, dealing {damage} damage and poisoning them!', 'Deal 4 damage and apply Poison for 2 turns.'),
    attack('Poison Puddle', '{enemy} spreads a poisonous puddle across the battlefield, damaging and poisoning everyone caught in it!', 'Deal 2 damage to all enemies and apply Poison for 1 turn.'),
  ], [loot('jungle_goo', 'Jungle Goo', 20, JUNGLE_GOO_EMOJI), loot('toxic_goo', 'Toxic Goo', 60), loot('slime_core', 'Slime Core', 18), loot('venom_slime_core', 'Venom Slime Core', 6), loot('poison_puddle_flask', 'Poison Puddle Flask', 22)]),
  enemy('giant_mosquito', 'Giant Mosquito', 'Common', [
    attack('Needle Bite', '{enemy} darts forward and stabs {target} with its needle, dealing {damage} damage!', 'Deal 6 damage.'),
    attack('Blood Drain', '{enemy} drains blood from {target}, dealing {damage} damage and healing itself for 3 HP!', 'Deal 5 damage and heal itself for 3 HP.'),
    attack('Buzzing Dodge', '{enemy} buzzes rapidly through the air, becoming harder to hit!', 'Gain Dodge for 1 turn.'),
  ], [loot('toxic_goo', 'Toxic Goo', 10), loot('mosquito_wing', 'Mosquito Wing', 58), loot('needle_stinger', 'Needle Stinger', 25), loot('buzzing_essence', 'Buzzing Essence', 5)]),
  enemy('horned_beetle', 'Horned Beetle', 'Uncommon', [
    attack('Horn Jab', '{enemy} jabs {target} with its sharp horn, dealing {damage} damage!', 'Deal 7 damage.'),
    attack('Shell Guard', '{enemy} lowers its armored shell and gains {shield} shield!', 'Gain 5 shield.'),
    attack('Horn Charge', '{enemy} charges forward with its horn, crashing into {target} for {damage} damage!', 'Deal 12 damage. If shield is active, deal +3 bonus damage.'),
  ], [loot('beetle_shell', 'Beetle Shell', 55), loot('beetle_horn', 'Beetle Horn', 24), loot('armored_carapace', 'Armored Carapace', 7), loot('charging_charm', 'Charging Charm', 4)]),
  enemy('venom_snake', 'Venom Snake', 'Uncommon', [
    attack('Snake Bite', '{enemy} strikes quickly and bites {target}, dealing {damage} damage!', 'Deal 7 damage.'),
    attack('Venom Fang', '{enemy} sinks its venomous fangs into {target}, dealing {damage} damage and poisoning them!', 'Deal 6 damage and apply Poison for 2 turns.'),
    attack('Coil Trap', '{enemy} coils around {target}, dealing {damage} damage and trapping them in place!', 'Deal 4 damage and apply Rooted for 1 turn.'),
  ], [loot('toxic_goo', 'Toxic Goo', 20), loot('sharp_fang', 'Sharp Fang', 30), loot('snake_scale', 'Snake Scale', 50), loot('venom_fang', 'Venom Fang', 25)]),
  enemy('wild_boar', 'Wild Boar', 'Uncommon', [
    attack('Tusk Hit', '{enemy} swings its tusks at {target}, dealing {damage} damage!', 'Deal 8 damage.'),
    attack('Wild Charge', '{enemy} stomps the ground and charges into {target}, dealing {damage} damage!', 'Deal 14 damage.'),
    attack('Thick Skin', '{enemy} braces itself with its tough hide and gains {shield} shield!', 'Gain 2 shield and reduce next damage taken.'),
  ], [loot('jungle_leaf', 'Jungle Leaf', 12), loot('sharp_fang', 'Sharp Fang', 18), loot('tough_hide', 'Tough Hide', 28), loot('boar_tusk', 'Boar Tusk', 55), loot('boar_meat', 'Boar Meat', 40), loot('charging_charm', 'Charging Charm', 7)]),
  enemy('moss_goblin', 'Moss Goblin', 'Uncommon', [
    attack('Spear Poke', '{enemy} pokes {target} with a mossy spear, dealing {damage} damage!', 'Deal 8 damage.'),
    attack('Vine Snare', '{enemy} throws a jungle vine around {target}, dealing {damage} damage and slowing them!', 'Deal 5 damage and apply Slow for 1 turn.'),
    attack('Goblin Ambush', '{enemy} leaps from the bushes and ambushes {target}, dealing {damage} damage!', 'Deal 11 damage. Deals +3 damage if the target has a debuff.'),
  ], [loot('jungle_leaf', 'Jungle Leaf', 25), loot('vine_rope', 'Vine Rope', 30), loot('moss_cloth', 'Moss Cloth', 45), loot('goblin_spear_tip', 'Goblin Spear Tip', 30), loot('goblin_charm', 'Goblin Charm', 6), loot('tribal_bead', 'Tribal Bead', 10)]),
  enemy('the_cat', 'The Cat', 'Rare', [
    attack('Cat Scratch', '{enemy} scratches {target} with sharp claws, dealing {damage} damage!', 'Deal 9 damage.'),
    attack('Lucky Pounce', '{enemy} pounces with strange luck, striking {target} for {damage} damage!', 'Deal 10 damage with higher crit chance.'),
    attack('Cute Stare', '{enemy} gives {target} an overwhelmingly cute stare, making them feel weak!', 'Apply Weak for 2 turns.'),
  ], [loot('sharp_fang', 'Sharp Fang', 10), loot('tough_hide', 'Tough Hide', 12), loot('soft_cat_fur', 'Soft Cat Fur', 45), loot('lucky_whisker', 'Lucky Whisker', 10), loot('royal_cat_bell', 'Royal Cat Bell', 2)]),
  enemy('totem_spirit', 'Totem Spirit', 'Rare', [
    attack('Spirit Zap', '{enemy} releases a ghostly spark at {target}, dealing {damage} magic damage!', 'Deal 10 magic damage.'),
    attack('Cursed Gaze', '{enemy} stares into {target} with cursed eyes, weakening them!', 'Apply Weak for 2 turns.'),
    attack('Totem Curse', '{enemy} chants an ancient curse, damaging {target} and weakening their shield!', 'Deal 8 damage and reduce target shield by 50%.'),
  ], [loot('monster_essence', 'Monster Essence', 35), loot('goblin_charm', 'Goblin Charm', 4), loot('cursed_mask_shard', 'Cursed Mask Shard', 45), loot('spirit_dust', 'Spirit Dust', 18), loot('totem_eye', 'Totem Eye', 5), loot('cursed_coin', 'Cursed Coin', 2)]),
  enemy('mud_golem', 'Mud Golem', 'Rare', [
    attack('Mud Punch', '{enemy} swings a heavy muddy fist at {target}, dealing {damage} damage!', 'Deal 11 damage.'),
    attack('Mud Wall', '{enemy} raises a thick wall of mud and gains {shield} shield!', 'Gain 18 shield.'),
    attack('Heavy Slam', '{enemy} slams the ground with massive force, crushing {target} for {damage} damage!', 'Deal 18 damage, but loses 5 shield after attacking.'),
  ], [loot('monster_essence', 'Monster Essence', 20), loot('mud_chunk', 'Mud Chunk', 60), loot('clay_core', 'Clay Core', 28), loot('golem_heart', 'Golem Heart', 7)]),
  enemy('jungle_mimic_chest', 'Jungle Mimic Chest', 'Rare', [
    attack('Bite', '{enemy} snaps open and bites {target}, dealing {damage} damage!', 'Deal 12 damage.'),
    attack('Fake Treasure', '{enemy} flashes fake treasure to distract {target}, confusing them!', 'Apply Confuse for 1 turn.'),
    attack('Chest Chomp', '{enemy} lunges forward with a massive chomp, dealing {damage} damage to {target}!', 'Deal 20 damage.'),
  ], [loot('vine_rope', 'Vine Rope', 15), loot('monster_essence', 'Monster Essence', 15), loot('mimic_wood', 'Mimic Wood', 50), loot('rusty_lock', 'Rusty Lock', 30), loot('fake_gold_tooth', 'Fake Gold Tooth', 10), loot('cursed_coin', 'Cursed Coin', 4), loot('mimic_key', 'Mimic Key', 1.5)]),
  enemy('ape_warrior_chief', 'Ape Warrior Chief', 'Epic Boss', [
    attack('Club Smash', '{enemy} smashes its heavy club into {target}, dealing {damage} damage!', 'Deal 16 damage.'),
    attack('Warrior Guard', '{enemy} raises its tribal armor and gains {shield} shield!', 'Gain 25 shield.'),
    attack('Jungle Roar', '{enemy} lets out a powerful jungle roar, weakening all opponents!', 'Apply Weak to all enemies for 1 turn.'),
    attack('Chief Combo', '{enemy} unleashes a brutal warrior combo on {target}, dealing {damage} damage!', 'Deal 26 damage.'),
  ], [loot('jungle_leaf', 'Jungle Leaf', 20), loot('vine_rope', 'Vine Rope', 25), loot('tough_hide', 'Tough Hide', 18), loot('moss_cloth', 'Moss Cloth', 15), loot('tribal_bead', 'Tribal Bead', 45), loot('warrior_club_handle', 'Warrior Club Handle', 22), loot('chief_armor_plate', 'Chief Armor Plate', 10), loot('ape_chief_crown', 'Ape Chief Crown', 3)]),
  enemy('king_cobra', 'King Cobra', 'Epic Boss', [
    attack('Royal Bite', '{enemy} strikes with royal speed and bites {target}, dealing {damage} damage!', 'Deal 17 damage.'),
    attack('Venom Spray', '{enemy} sprays deadly venom at {target}, dealing {damage} damage and poisoning them!', 'Deal 10 damage and apply Poison for 3 turns.'),
    attack('Cobra Guard', '{enemy} spreads its hood defensively and gains {shield} shield!', 'Gain 18 shield.'),
    attack('Execution Fang', '{enemy} delivers an execution bite with its royal fangs, dealing {damage} damage to {target}!', 'Deal 28 damage. Deals +8 damage if target is poisoned.'),
  ], [loot('toxic_goo', 'Toxic Goo', 35), loot('sharp_fang', 'Sharp Fang', 45), loot('snake_scale', 'Snake Scale', 60), loot('venom_fang', 'Venom Fang', 45), loot('cobra_hood_scale', 'Cobra Hood Scale', 25), loot('royal_venom', 'Royal Venom', 10), loot('serpent_crown_jewel', 'Serpent Crown Jewel', 3), loot('crown_jewel', 'Crown Jewel', 2)]),
  enemy('king_slime', 'King Slime', 'Epic Boss', [
    attack('Royal Bounce', '{enemy} bounces high and crashes down onto {target}, dealing {damage} damage!', 'Deal 15 damage.'),
    attack('Goo Wave', '{enemy} releases a massive wave of slime across the battlefield!', 'Deal 10 damage to all enemies.'),
    attack('Slime Shield', '{enemy} hardens its royal slime body and gains {shield} shield!', 'Gain 25 shield.'),
    attack('Royal Split', '{enemy} splits into royal goo, healing itself and calling slime support!', 'Heal 25 HP and summon slime support.'),
  ], [loot('jungle_goo', 'Jungle Goo', 80, JUNGLE_GOO_EMOJI), loot('monster_essence', 'Monster Essence', 25), loot('slime_core', 'Slime Core', 50), loot('venom_slime_core', 'Venom Slime Core', 12), loot('royal_gel', 'Royal Gel', 35), loot('slime_crown_fragment', 'Slime Crown Fragment', 5), loot('crown_jewel', 'Crown Jewel', 2)]),
  enemy('king_maxwell', 'King Maxwell', 'Secret Boss', [
    attack('Royal Paw', '{enemy} lazily swipes its royal paw at {target}, dealing {damage} damage!', 'Deal 20 damage.'),
    attack('Crown Bonk', '{enemy} bonks {target} with its crown, dealing {damage} damage and stunning them!', 'Deal 24 damage and apply Stun for 1 turn.'),
    attack('Maxwell Stare', '{enemy} stares silently at {target}. Something feels very wrong...', 'Apply Weak and Confuse for 1 turn.'),
    attack("King's Luck", '{enemy} is blessed by royal cat luck, gaining {shield} shield and sharper strikes!', 'Gain 30 shield and increase crit chance for 2 turns.'),
  ], [loot('soft_cat_fur', 'Soft Cat Fur', 35), loot('lucky_whisker', 'Lucky Whisker', 20), loot('royal_cat_bell', 'Royal Cat Bell', 10), loot('crown_jewel', 'Crown Jewel', 4), loot('maxwell_crown', 'Maxwell Crown', 0.1)]),
];

const ENEMY_BY_ID = Object.fromEntries(ENEMIES.map((item) => [item.id, item]));
function getEnemy(enemyId) { return ENEMY_BY_ID[enemyId] || null; }
function createStageEnemy(enemyId, count = 1, overrides = {}) {
  const base = getEnemy(enemyId);
  if (!base) throw new Error(`Unknown journey enemy id: ${enemyId}`);
  return { ...base, ...overrides, id: base.id, enemyId: base.id, count: Math.max(1, Math.floor(Number(count) || 1)) };
}

module.exports = { PLACEHOLDER, ENEMIES, ENEMY_BY_ID, getEnemy, createStageEnemy };
