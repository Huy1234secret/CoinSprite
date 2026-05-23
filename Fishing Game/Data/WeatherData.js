const WEATHER_DURATION_MS = 30 * 60 * 1000;

const WEATHER_EMOJIS = {
  Windy: '<:SBWWind:1507648034996228157>',
  Thunderstorm: '<:SBWThunderstorm:1507648033007992832>',
  Sunny: '<:SBWSunny:1507648031053582390>',
  Storm: '<:SBWStorm:1507648028490862662>',
  Snow: '<:SBWSnow:1507648026288590898>',
  Rain: '<:SBWRain:1507648024279777402>',
  'Night Clear Sky': '<:SBWNightClearSky:1507648022270578708>',
  Heatwave: '<:SBWHeatwave:1507648020051660941>',
  'Full Moon Night': '<:SBWFullMoon:1507648017740595270>',
  Fog: '<:SBWFog:1507648015974928424>',
  Bloodmoon: '<:SBWBloodMoon:1507648014125236315>',
};

const TIME_EMOJIS = {
  Night: '<:SBTNight:1507648012359303168>',
  Morning: '<:SBTMorning:1507648010434117753>',
  Afternoon: '<:SBTAfternoon:1507707451770667009>',
  Noon: '<:SBSNoon:1507647998119772171>',
};

const SEASONS = [
  { key: 'Spring', emoji: '<:SBSSpring:1507648001156317214>' },
  { key: 'Summer', emoji: '<:SBSSummer:1507648004130082906>' },
  { key: 'Fall', emoji: '<:SBSAutumn:1507647996483997797>' },
  { key: 'Winter', emoji: '<:SBSWinter:1507648006298664990>' },
];

const TIMES = { ...TIME_EMOJIS };

const WEATHER_CHANCES = {
  Spring: {
    Morning: [['Sunny', 40], ['Rain', 25], ['Storm', 10], ['Thunderstorm', 5], ['Fog', 10], ['Windy', 10]],
    Noon: [['Sunny', 50], ['Rain', 25], ['Storm', 10], ['Thunderstorm', 5], ['Windy', 10]],
    Afternoon: [['Sunny', 45], ['Rain', 25], ['Storm', 12], ['Thunderstorm', 6], ['Windy', 12]],
    Night: [['Night Clear Sky', 40], ['Full Moon Night', 8], ['Bloodmoon', 1], ['Rain', 25], ['Storm', 10], ['Thunderstorm', 5], ['Fog', 6], ['Windy', 5]],
  },
  Summer: {
    Morning: [['Sunny', 55], ['Rain', 15], ['Storm', 8], ['Thunderstorm', 5], ['Fog', 7], ['Windy', 10]],
    Noon: [['Sunny', 45], ['Rain', 10], ['Storm', 5], ['Thunderstorm', 5], ['Windy', 10], ['Heatwave', 25]],
    Afternoon: [['Sunny', 40], ['Rain', 12], ['Storm', 6], ['Thunderstorm', 6], ['Windy', 10], ['Heatwave', 26]],
    Night: [['Night Clear Sky', 50], ['Full Moon Night', 8], ['Bloodmoon', 1], ['Rain', 15], ['Storm', 8], ['Thunderstorm', 6], ['Fog', 5], ['Windy', 7]],
  },
  Fall: {
    Morning: [['Sunny', 35], ['Rain', 30], ['Storm', 12], ['Fog', 13], ['Windy', 10]],
    Noon: [['Sunny', 45], ['Rain', 30], ['Storm', 10], ['Windy', 15]],
    Afternoon: [['Sunny', 40], ['Rain', 30], ['Storm', 12], ['Windy', 18]],
    Night: [['Night Clear Sky', 35], ['Full Moon Night', 10], ['Bloodmoon', 2], ['Rain', 30], ['Storm', 10], ['Fog', 8], ['Windy', 5]],
  },
  Winter: {
    Morning: [['Sunny', 30], ['Snow', 30], ['Storm', 10], ['Fog', 20], ['Windy', 10]],
    Noon: [['Sunny', 40], ['Snow', 35], ['Storm', 10], ['Windy', 15]],
    Afternoon: [['Sunny', 35], ['Snow', 40], ['Storm', 10], ['Windy', 15]],
    Night: [['Night Clear Sky', 30], ['Full Moon Night', 12], ['Bloodmoon', 2], ['Snow', 35], ['Storm', 8], ['Fog', 8], ['Windy', 5]],
  },
};

const COLUMN_MAP = {
  Spring: { Morning: { Sunny: 'C', Rain: 'D', Storm: 'E', Thunderstorm: 'F', Fog: 'G', Windy: 'H' }, Noon: { Sunny: 'I', Rain: 'J', Storm: 'K', Thunderstorm: 'L', Windy: 'M' }, Afternoon: { Sunny: 'N', Rain: 'O', Storm: 'P', Thunderstorm: 'Q', Windy: 'R' }, Night: { 'Night Clear Sky': 'S', 'Full Moon Night': 'T', Bloodmoon: 'U', Rain: 'V', Storm: 'W', Thunderstorm: 'X', Fog: 'Y', Windy: 'Z' } },
  Summer: { Morning: { Sunny: 'AA', Rain: 'AB', Storm: 'AC', Thunderstorm: 'AD', Fog: 'AE', Windy: 'AF' }, Noon: { Sunny: 'AG', Rain: 'AH', Storm: 'AI', Thunderstorm: 'AJ', Windy: 'AK', Heatwave: 'AL' }, Afternoon: { Sunny: 'AM', Rain: 'AN', Storm: 'AO', Thunderstorm: 'AP', Windy: 'AQ', Heatwave: 'AR' }, Night: { 'Night Clear Sky': 'AS', 'Full Moon Night': 'AT', Bloodmoon: 'AU', Rain: 'AV', Storm: 'AW', Thunderstorm: 'AX', Fog: 'AY', Windy: 'AZ' } },
  Fall: { Morning: { Sunny: 'BA', Rain: 'BB', Storm: 'BC', Fog: 'BD', Windy: 'BE' }, Noon: { Sunny: 'BF', Rain: 'BG', Storm: 'BH', Windy: 'BI' }, Afternoon: { Sunny: 'BJ', Rain: 'BK', Storm: 'BL', Windy: 'BM' }, Night: { 'Night Clear Sky': 'BN', 'Full Moon Night': 'BO', Bloodmoon: 'BP', Rain: 'BQ', Storm: 'BR', Fog: 'BS', Windy: 'BT' } },
  Winter: { Morning: { Sunny: 'BU', Snow: 'BV', Storm: 'BW', Fog: 'BX', Windy: 'BY' }, Noon: { Sunny: 'BZ', Snow: 'CA', Storm: 'CB', Windy: 'CC' }, Afternoon: { Sunny: 'CD', Snow: 'CE', Storm: 'CF', Windy: 'CG' }, Night: { 'Night Clear Sky': 'CH', 'Full Moon Night': 'CI', Bloodmoon: 'CJ', Snow: 'CK', Storm: 'CL', Fog: 'CM', Windy: 'CN' } },
};

const WEATHER_EFFECTS = {
  Sunny: {},
  Rain: { lureSeconds: -2, powerMultiplier: 1.05 },
  Storm: { lureSeconds: 4, powerMultiplier: 1.2, durMultiplier: 1.5 },
  Thunderstorm: { lureSeconds: 10, powerMultiplier: 1.4, durMultiplier: 2, lightningBreakChance: 0.15 },
  Fog: { lureSeconds: 2, powerMultiplier: 1.1 },
  Windy: { lureSeconds: 1, powerMultiplier: 1.25, durMultiplier: 1.4, escapeChance: 0.1 },
  Snow: { lureSeconds: 6, powerMultiplier: 1.1, durMultiplier: 1.1 },
  Heatwave: { lureSeconds: 2, powerMultiplier: 1.15, durMultiplier: 1.25 },
  'Night Clear Sky': { powerMultiplier: 0.85 },
  'Full Moon Night': { goldenBonus: 0.1 },
  Bloodmoon: { lureSeconds: 5, powerMultiplier: 1.6, durMultiplier: 3, escapeChance: 0.25 },
};

const WEATHER_TEXT = {
  Sunny: ['No effects.'],
  Rain: ['Fish become more abundant when it rains.', "It's harder to catch a fish.", 'Higher rarity fish chance.'],
  Storm: ['Becareful when go fishing, your fishing rod can BREAK easily!', "Fish doesn't like this weather... become less abundant.", "It's more harder to catch a fish.", 'Higher rarity fish chance.'],
  Thunderstorm: ['Why? Why go fishing during this time?', "It's rare to see a fish during this time.", "It's EVEN harder to catch a fish.", 'But Even higher rarity fish chance.'],
  Fog: ['Fish may not see your hook clearly.', 'Harder to catch a fish', 'Higher fish chance.'],
  Windy: ["It's hard to be balance, becareful with your fishing rod.", 'Those mini waves will make fish hard to bite your hook.', 'Hard to catch a fish', 'Fish has a chance to escape while trying to catch', 'Higher fish rarity chance'],
  Snow: ['Fishing rod is a little bit easier to break now.', 'Fish doesnt like cold woter.', 'Hard to catch a fish.', 'Higher rarity fish chance.'],
  Heatwave: ['Fishing rod is a little bit easier to break now.', 'Fish may not like being cooked alive.', 'Harder to catch a fish.', 'Higher fish rarity chance'],
  'Night Clear Sky': ['Easier to catch a fish, wonder why?', 'Some fish that only catchable during night started appearing.'],
  'Full Moon Night': ['Even higher fish rarity chance.', 'We have found out Golden variant started appearing.'],
  Bloodmoon: ["it's beautiful but dangerous, one mistake can make your fishing rod broke immediately", 'seems like fish doesnt really like this weather', 'Hard to catch fish', 'EVEN HIGHER fish rarity chance.'],
};

const MUTATIONS_BY_WEATHER = {
  Sunny: [
    { name: 'Sunlit', chance: 3.5, multiplier: 1.12, emoji: '<:SBMutSunlit:1507421827494973520>' },
    { name: 'Golden Tint', chance: 1.75, multiplier: 1.25, emoji: '<:SBMutGoldenTin:1507421797916868719>' },
    { name: 'Solar Shine', chance: 0.75, multiplier: 1.5, emoji: null },
  ],
  Rain: [
    { name: 'Rainsoaked', chance: 5, multiplier: 1.2, emoji: '<:SBMutRainSoaked:1507421814916386936>' },
    { name: 'Muddy', chance: 2.75, multiplier: 1.15, emoji: '<:SBMutMuddy:1507421811556749463>' },
    { name: 'Pearlscale', chance: 1.25, multiplier: 1.55, emoji: '<:SBMutPearlScale:1507421813205110936>' },
  ],
  Storm: [
    { name: 'Stormborn', chance: 6, multiplier: 1.45, emoji: '<:SBMutStormBorn:1507421823208394792>' },
    { name: 'Turbulent', chance: 4, multiplier: 1.35, emoji: '<:SBMutTurbulent:1507421842606915715>' },
    { name: 'Cyclone', chance: 2, multiplier: 1.9, emoji: '<:SBMutCyclone:1507421787871248555>' },
  ],
  Thunderstorm: [
    { name: 'Charged', chance: 8, multiplier: 1.75, emoji: '<:SBMutCharged:1507421777402265833>' },
    { name: 'Voltfin', chance: 6, multiplier: 2.1, emoji: '<:SBMutVoltFin:1507421844142166026>' },
    { name: 'Thunderstruck', chance: 4, multiplier: 2.75, emoji: '<:SBMutThunderstruck:1507421840786722816>' },
  ],
  Fog: [
    { name: 'Mistveil', chance: 6, multiplier: 1.5, emoji: '<:SBMutMistVeil:1507421805189792016>' },
    { name: 'Ghostscale', chance: 4, multiplier: 1.85, emoji: '<:SBMutGhostScale:1507421795559538769>' },
    { name: 'Hidden', chance: 2, multiplier: 2.3, emoji: '<:SBMutHidden:1507421799741395005>' },
  ],
  Windy: [
    { name: 'Galescale', chance: 4.5, multiplier: 1.3, emoji: '<:SBMutGaleScale:1507421793303138385>' },
    { name: 'Sharpfin', chance: 2.5, multiplier: 1.45, emoji: '<:SBMutSharpfin:1507421818825343196>' },
    { name: 'Swift', chance: 1, multiplier: 1.25, emoji: '<:SBMutSwift:1507421838664532018>' },
  ],
  Snow: [
    { name: 'Frosted', chance: 5, multiplier: 1.45, emoji: '<:SBMutFrosted:1507421791512039495>' },
    { name: 'Icebound', chance: 3.5, multiplier: 1.75, emoji: '<:SBMutIcebound:1507421801549009076>' },
    { name: 'Crystalfin', chance: 1.5, multiplier: 2.2, emoji: '<:SBMutCrystalfin:1507421783987585075>' },
  ],
  Heatwave: [
    { name: 'Scorched', chance: 5.5, multiplier: 1.55, emoji: '<:SBMutScorched:1507421816757555310>' },
    { name: 'Sunburnt', chance: 4, multiplier: 1.3, emoji: '<:SBMutSunburnt:1507421825204883496>' },
    { name: 'Molten', chance: 2.5, multiplier: 2.35, emoji: '<:SBMutMolten:1507421807324434624>' },
  ],
  'Night Clear Sky': [
    { name: 'Starlit', chance: 5, multiplier: 1.55, emoji: null },
    { name: 'Darkscale', chance: 2.75, multiplier: 1.4, emoji: '<:SBMutDarkscale:1507421789695901870>' },
    { name: 'Cosmic', chance: 1.25, multiplier: 2.4, emoji: '<:SBMutCosmic:1507421779298095285>' },
  ],
  'Full Moon Night': [
    { name: 'Moonblessed', chance: 10, multiplier: 2, emoji: '<:SBMutMoonblessed:1507421809530765343>' },
    { name: 'Silvermoon', chance: 8, multiplier: 2.3, emoji: '<:SBMutSilvermoon:1507421820767309968>' },
    { name: 'Lunar', chance: 6, multiplier: 3, emoji: '<:SBMutLunar:1507421803360944228>' },
  ],
  Bloodmoon: [
    { name: 'Bloodscale', chance: 12, multiplier: 3, emoji: '<:SBMutBloodscale:1507421775649046590>' },
    { name: 'Cursed', chance: 9, multiplier: 2.5, emoji: '<:SBMutCursed:1507421785967165460>' },
    { name: 'Crimson Soul', chance: 8, multiplier: 4, emoji: '<:SBMutCrimsonscale:1507421781588443326>' },
    { name: 'Abyssal Blood', chance: 6, multiplier: 5, emoji: '<:SBMutAbyssalBloodscal:1507421773824790609>' },
  ],
};

function getFallbackWeather(timeKey) {
  return timeKey === 'Night' ? 'Night Clear Sky' : 'Sunny';
}

function weatherResult(name) {
  return { name, emoji: WEATHER_EMOJIS[name] || '' };
}

function rollWeather(seasonKey, timeKey, random = Math.random) {
  const fallback = getFallbackWeather(timeKey);
  const choices = WEATHER_CHANCES[seasonKey]?.[timeKey] || WEATHER_CHANCES.Spring.Morning;
  const specialChoices = choices.filter(([name]) => name !== fallback);
  let roll = random() * 100;
  for (const [name, chance] of specialChoices) {
    roll -= Number(chance) || 0;
    if (roll < 0) return { ...weatherResult(name), durationMinutes: 30 };
  }
  return { ...weatherResult(fallback), durationMinutes: 30 };
}

function rollMutation(weatherName, random = Math.random) {
  const choices = MUTATIONS_BY_WEATHER[weatherName] || [];
  let roll = random() * 100;
  for (const mutation of choices) {
    roll -= Number(mutation.chance) || 0;
    if (roll < 0) return { ...mutation };
  }
  return null;
}

module.exports = {
  COLUMN_MAP,
  MUTATIONS_BY_WEATHER,
  SEASONS,
  TIMES,
  WEATHER_CHANCES,
  WEATHER_DURATION_MS,
  WEATHER_EFFECTS,
  WEATHER_EMOJIS,
  WEATHER_TEXT,
  getFallbackWeather,
  rollMutation,
  rollWeather,
};
