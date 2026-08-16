const { componentEmoji } = require('../../shared/emojis');

const SHECKLES_EMOJI = '<:sheckles:1525368044824825976>';

// Crop art supplied for the RNG game. Keep every Discord emoji identifier in
// this one registry so deployments can replace art without touching game logic.
const CROP_EMOJIS = Object.freeze({
  eclipse_bloom: '<:eclipsebloomfruit:1536043923816841296>',
  star_fruit: '<:starfruitfruit:1536043971233587332>',
  dragons_breath: '<:Dragons_BreathFruit:1536043921380089886>',
  hypno_bloom: '<:Hypno_BloomFruit:1536043951910293516>',
  sun_bloom: '<:sunbloomfruit:1536043975625146500>',
  moon_bloom: '<:Moon_BloomFruit:1536043956415238164>',
  briar_rose: '<:BriarRoseFruit:1536254839263068200>',
  venom_spitter: '<:Venom_SpitterFruit:1536043986748448841>',
  poison_apple: '<:Poison_AppleFruit:1536043962593185862>',
  pomegranate: '<:PomegranateFruit:1536043966968107110>',
  venus_flytrap: '<:Venus_Fly_TrapFruit:1536043989285994506>',
  fire_fern: '<:Fire_FernFruit:1536043936722980914>',
  sunflower: '<:SunflowerFruit:1536043978296786954>',
  cherry: '<:CherryFruit:1536043912085643294>',
  acorn: '<:AcornFruit:1536043894679142500>',
  dragon_fruit: '<:Dragon_FruitFruit:1536043918813036574>',
  rocket_pop: '<:rocketpopfruit:1536043969220317194>',
  mango: '<:MangoFruit:1536043953760108586>',
  coconut: '<:CoconutFruit:1536043914333786123>',
  grape: '<:GrapeFruit:1536043945094676480>',
  banana: '<:BananaFruit:1536043903239594205>',
  green_bean: '<:GreenBeanFruit:1536043947540095107>',
  mushroom: '<:MushroomFruit:1536043958399012944>',
  pineapple: '<:PineappleFruit:1536043960533778522>',
  cactus: '<:CactusFruit:1536043907429695540>',
  corn: '<:CornFruit:1536043916867018782>',
  bamboo: '<:BambooFruit:1536043901314535645>',
  apple: '<:AppleFruit:1536043897115910274>',
  tomato: '<:TomatoFruit:1536043980465381416>',
  tulip: '<:TulipFruit:1536043984223207534>',
  blueberry: '<:BlueberryFruit:1536043905316036658>',
  strawberry: '<:StrawberryFruit:1536043973292982323>',
  carrot: '<:CarrotFruit:1536043909548085308>',
});

// Central rarity badge registry. Deployments may override these defaults
// without changing the inventory or filter builders.
const RARITY_EMOJIS = Object.freeze({
  Common: process.env.RNG_RARITY_COMMON_EMOJI || '<:RCommon:1536072829148336128>',
  Uncommon: process.env.RNG_RARITY_UNCOMMON_EMOJI || '<:RUncommon:1536072831299747951>',
  Rare: process.env.RNG_RARITY_RARE_EMOJI || '<:RRare:1536072820826570955>',
  Epic: process.env.RNG_RARITY_EPIC_EMOJI || '<:REpic:1536072823687348244>',
  Legendary: process.env.RNG_RARITY_LEGENDARY_EMOJI || '<:RLegendary:1536072819237060650>',
  Mythic: process.env.RNG_RARITY_MYTHIC_EMOJI || '<:RMythic:1536072827105443871>',
  Super: process.env.RNG_RARITY_SUPER_EMOJI || '<a:RSUPER:1536072842800537600>',
  Secret: process.env.RNG_RARITY_SECRET_EMOJI || '<a:RSecret:1536073173165146344>',
});

const FALLBACK_THUMBNAIL_URL = process.env.RNG_FALLBACK_THUMBNAIL_URL
  || 'https://cdn.discordapp.com/embed/avatars/0.png';

function customEmojiImageUrl(emoji) {
  const match = String(emoji || '').match(/^<a?:[a-z0-9_]+:(\d{16,20})>$/i);
  if (!match) return FALLBACK_THUMBNAIL_URL;
  const animated = String(emoji).startsWith('<a:');
  return `https://cdn.discordapp.com/emojis/${match[1]}.${animated ? 'gif' : 'png'}?size=256&quality=lossless`;
}

module.exports = {
  CROP_EMOJIS,
  FALLBACK_THUMBNAIL_URL,
  RARITY_EMOJIS,
  SHECKLES_EMOJI,
  componentEmoji,
  customEmojiImageUrl,
};
