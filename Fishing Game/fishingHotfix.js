const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const feature = require('./fishingFeature');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const FISHING_CHANNEL_ID = '1506684299934437517';
const LOCATION = 'Calm Fishing Lake';
const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const WOODEN_ROD_LABEL = 'Wooden Fishing Rod';
const WOODEN_ROD_UNICODE = '\uD83C\uDFA3';
const WOODEN_ROD_RAW = '<:IGWoodenFishingRod:1506709123646095430>';
const WOODEN_ROD_EMOJI = { name: 'IGWoodenFishingRod', id: '1506709123646095430' };
const FISH_GAME_LOCK_TIMEOUT_MS = 90_000;
const SEASONS = [
  { key: 'Spring', emoji: '\uD83C\uDF38' },
  { key: 'Summer', emoji: '\u2600\uFE0F' },
  { key: 'Fall', emoji: '\uD83C\uDF42' },
  { key: 'Winter', emoji: '\u2744\uFE0F' },
];
const TIMES = { Morning: '\uD83C\uDF05', Noon: '\u2600\uFE0F', Afternoon: '\uD83C\uDF07', Night: '\uD83C\uDF19' };
const WEATHER_CHANCES = {
  Spring: { Morning: [['Sunny', '\u2600', 40], ['Rain', '\u2614', 25], ['Storm', '\uD83C\uDF00', 10], ['Thunderstorm', '\u26A1', 5], ['Fog', '\u224b', 10], ['Windy', '\u219d', 10]], Noon: [['Sunny', '\u2600', 50], ['Rain', '\u2614', 25], ['Storm', '\uD83C\uDF00', 10], ['Thunderstorm', '\u26A1', 5], ['Windy', '\u219d', 10]], Afternoon: [['Sunny', '\u2600', 45], ['Rain', '\u2614', 25], ['Storm', '\uD83C\uDF00', 12], ['Thunderstorm', '\u26A1', 6], ['Windy', '\u219d', 12]], Night: [['Night Clear Sky', '\u2605', 40], ['Full Moon Night', '\u25cb', 8], ['Bloodmoon', '\u25cf', 1], ['Rain', '\u2614', 25], ['Storm', '\uD83C\uDF00', 10], ['Thunderstorm', '\u26A1', 5], ['Fog', '\u224b', 6], ['Windy', '\u219d', 5]] },
  Summer: { Morning: [['Sunny', '\u2600', 55], ['Rain', '\u2614', 15], ['Storm', '\uD83C\uDF00', 8], ['Thunderstorm', '\u26A1', 5], ['Fog', '\u224b', 7], ['Windy', '\u219d', 10]], Noon: [['Sunny', '\u2600', 45], ['Rain', '\u2614', 10], ['Storm', '\uD83C\uDF00', 5], ['Thunderstorm', '\u26A1', 5], ['Windy', '\u219d', 10], ['Heatwave', '\uD83D\uDD25', 25]], Afternoon: [['Sunny', '\u2600', 40], ['Rain', '\u2614', 12], ['Storm', '\uD83C\uDF00', 6], ['Thunderstorm', '\u26A1', 6], ['Windy', '\u219d', 10], ['Heatwave', '\uD83D\uDD25', 26]], Night: [['Night Clear Sky', '\u2605', 50], ['Full Moon Night', '\u25cb', 8], ['Bloodmoon', '\u25cf', 1], ['Rain', '\u2614', 15], ['Storm', '\uD83C\uDF00', 8], ['Thunderstorm', '\u26A1', 6], ['Fog', '\u224b', 5], ['Windy', '\u219d', 7]] },
  Fall: { Morning: [['Sunny', '\u2600', 35], ['Rain', '\u2614', 30], ['Storm', '\uD83C\uDF00', 12], ['Fog', '\u224b', 13], ['Windy', '\u219d', 10]], Noon: [['Sunny', '\u2600', 45], ['Rain', '\u2614', 30], ['Storm', '\uD83C\uDF00', 10], ['Windy', '\u219d', 15]], Afternoon: [['Sunny', '\u2600', 40], ['Rain', '\u2614', 30], ['Storm', '\uD83C\uDF00', 12], ['Windy', '\u219d', 18]], Night: [['Night Clear Sky', '\u2605', 35], ['Full Moon Night', '\u25cb', 10], ['Bloodmoon', '\u25cf', 2], ['Rain', '\u2614', 30], ['Storm', '\uD83C\uDF00', 10], ['Fog', '\u224b', 8], ['Windy', '\u219d', 5]] },
  Winter: { Morning: [['Sunny', '\u2600', 30], ['Snow', '\u2744', 30], ['Storm', '\uD83C\uDF00', 10], ['Fog', '\u224b', 20], ['Windy', '\u219d', 10]], Noon: [['Sunny', '\u2600', 40], ['Snow', '\u2744', 35], ['Storm', '\uD83C\uDF00', 10], ['Windy', '\u219d', 15]], Afternoon: [['Sunny', '\u2600', 35], ['Snow', '\u2744', 40], ['Storm', '\uD83C\uDF00', 10], ['Windy', '\u219d', 15]], Night: [['Night Clear Sky', '\u2605', 30], ['Full Moon Night', '\u25cb', 12], ['Bloodmoon', '\u25cf', 2], ['Snow', '\u2744', 35], ['Storm', '\uD83C\uDF00', 8], ['Fog', '\u224b', 8], ['Windy', '\u219d', 5]] },
};
const WEATHER_DURATIONS = { Sunny: [15, 30], Rain: [10, 22], Storm: [8, 16], Thunderstorm: [5, 12], Fog: [8, 18], Windy: [10, 20], Snow: [10, 24], Heatwave: [8, 15], 'Night Clear Sky': [15, 30], 'Full Moon Night': [10, 20], Bloodmoon: [5, 10] };
const WEATHER_TEXT = { Sunny: ['No effects.'], Rain: ['Fish become more abundant when it rains.', "It's harder to catch a fish.", 'Higher rarity fish chance.'], Storm: ['Becareful when go fishing, your fishing rod can BREAK easily!', "Fish doesn't like this weather... become less abundant.", "It's more harder to catch a fish.", 'Higher rarity fish chance.'], Thunderstorm: ['Why? Why go fishing during this time?', "It's rare to see a fish during this time.", "It's EVEN harder to catch a fish.", 'But Even higher rarity fish chance.'], Fog: ['Fish may not see your hook clearly.', 'Harder to catch a fish', 'Higher fish chance.'], Windy: ["It's hard to be balance, becareful with your fishing rod.", 'Those mini waves will make fish hard to bite your hook.', 'Hard to catch a fish', 'Fish has a chance to escape while trying to catch', 'Higher fish rarity chance'], Snow: ['Fishing rod is a little bit easier to break now.', 'Fish doesnt like cold woter.', 'Hard to catch a fish.', 'Higher rarity fish chance.'], Heatwave: ['Fishing rod is a little bit easier to break now.', 'Fish may not like being cooked alive.', 'Harder to catch a fish.', 'Higher fish rarity chance'], 'Night Clear Sky': ['Easier to catch a fish, wonder why?', 'Some fish that only catchable during night started appearing.'], 'Full Moon Night': ['Even higher fish rarity chance.', 'We have found out Golden variant started appearing.'], Bloodmoon: ["it's beautiful but dangerous, one mistake can make your fishing rod broke immediately", 'seems like fish doesnt really like this weather', 'Hard to catch fish', 'EVEN HIGHER fish rarity chance.'] };
let weatherTimerStarted = false;
let activeFishGame = null;
let activeFishGameTimer = null;

function randomInt(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function weightedPick(entries) { const valid = entries.filter((entry) => Number(entry.weight) > 0); const total = valid.reduce((sum, entry) => sum + Number(entry.weight), 0); if (total <= 0) return valid[0]?.value ?? null; let roll = Math.random() * total; for (const entry of valid) { roll -= Number(entry.weight); if (roll <= 0) return entry.value; } return valid[valid.length - 1]?.value ?? null; }
function emptyState() { return { users: {}, weather: {}, forecasts: {} }; }
function ensureStoreFile() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8'); }
function loadState() { ensureStoreFile(); try { const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); return { ...emptyState(), ...(state && typeof state === 'object' ? state : {}) }; } catch { return emptyState(); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8'); }
function containerPayload(accent, innerComponents) { return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: accent, components: innerComponents.filter(Boolean) }] }; }
function seasonTime(now = new Date()) { const utc7 = now.getTime() + (7 * 60 * 60 * 1000); const day = Math.floor(utc7 / 86_400_000); const hour = Math.floor((utc7 % 86_400_000) / 3_600_000); const season = SEASONS[Math.floor(day / 2) % SEASONS.length]; const timeKey = ['Morning', 'Noon', 'Afternoon', 'Night'][Math.floor((hour % 12) / 3)]; return { season, time: { key: timeKey, emoji: TIMES[timeKey] } }; }
function rollWeather(seasonKey, timeKey) { const choices = WEATHER_CHANCES[seasonKey]?.[timeKey] || WEATHER_CHANCES.Spring.Morning; const picked = weightedPick(choices.map(([name, emoji, chance]) => ({ value: { name, emoji }, weight: chance }))) || { name: 'Sunny', emoji: '\u2600' }; const [min, max] = WEATHER_DURATIONS[picked.name] || WEATHER_DURATIONS.Sunny; let durationMinutes = randomInt(min, max); if (durationMinutes < 10) durationMinutes += (10 - durationMinutes) + 10; else if (durationMinutes % 10 !== 0) durationMinutes += 10 - (durationMinutes % 10); return { ...picked, durationMinutes }; }
function getCurrentWeather(state) { const { season, time } = seasonTime(); const now = Date.now(); const slotStart = Math.floor(now / 600_000) * 600_000; const current = state.weather[LOCATION]; if (!current || current.endsAt <= now || current.season !== season.key || current.time !== time.key) { const weather = rollWeather(season.key, time.key); state.weather[LOCATION] = { location: LOCATION, season: season.key, seasonEmoji: season.emoji, time: time.key, timeEmoji: time.emoji, weather: weather.name, weatherEmoji: weather.emoji, startedAt: slotStart, endsAt: slotStart + (weather.durationMinutes * 60_000) }; } return state.weather[LOCATION]; }
function formatForecast(weather) { const effects = WEATHER_TEXT[weather.weather] || WEATHER_TEXT.Sunny; return ['## Fishy Weather Forecast \uD83D\uDC1F', `* Season: ${weather.season} ${weather.seasonEmoji}`, `* Time: ${weather.time} ${weather.timeEmoji}`, `* Todays weather: ${weather.weather} ${weather.weatherEmoji}`, '', '-# Effects:', effects.map((effect) => `- ${effect}`).join('\n')].join('\n'); }
async function findForecastMessage(channel) { const messages = await channel.messages?.fetch?.({ limit: 50 }).catch(() => null); if (!messages) return null; return messages.find((message) => message.author?.id === channel.client?.user?.id && message.components?.some((component) => JSON.stringify(component).includes('Fishy Weather Forecast'))) || null; }
async function maybeEditWeatherForecast(client) { const state = loadState(); const weather = getCurrentWeather(state); const key = `${weather.location}:${weather.startedAt}:${weather.weather}`; if (state.forecasts.lastForecastKey === key && state.forecasts.forecastMessageId) { saveState(state); return; } const channel = await client.channels.fetch(FISHING_CHANNEL_ID).catch(() => null); if (!channel?.isTextBased?.()) { saveState(state); return; } let message = state.forecasts.forecastMessageId ? await channel.messages.fetch(state.forecasts.forecastMessageId).catch(() => null) : null; if (!message) message = await findForecastMessage(channel); const payload = containerPayload(WHITE_ACCENT, [{ type: 10, content: formatForecast(weather) }]); message = message ? await message.edit(payload).catch(() => null) : await channel.send(payload).catch(() => null); if (message?.id) state.forecasts.forecastMessageId = message.id; state.forecasts.lastForecastKey = key; saveState(state); }
function startWeatherEditTimer(client) { if (weatherTimerStarted) return; weatherTimerStarted = true; maybeEditWeatherForecast(client).catch(() => null); setInterval(() => maybeEditWeatherForecast(client).catch(() => null), 60_000); }

function clearFishGameLock() {
  activeFishGame = null;
  if (activeFishGameTimer) clearTimeout(activeFishGameTimer);
  activeFishGameTimer = null;
}

function getActiveFishGame() {
  if (!activeFishGame) return null;
  if (Date.now() >= activeFishGame.expiresAt) clearFishGameLock();
  return activeFishGame;
}

function startFishGameLock(userId) {
  clearFishGameLock();
  activeFishGame = { userId, expiresAt: Date.now() + FISH_GAME_LOCK_TIMEOUT_MS };
  activeFishGameTimer = setTimeout(clearFishGameLock, FISH_GAME_LOCK_TIMEOUT_MS);
  activeFishGameTimer.unref?.();
}

function refreshFishGameLock() {
  if (!activeFishGame) return;
  activeFishGame.expiresAt = Date.now() + FISH_GAME_LOCK_TIMEOUT_MS;
  if (activeFishGameTimer) clearTimeout(activeFishGameTimer);
  activeFishGameTimer = setTimeout(clearFishGameLock, FISH_GAME_LOCK_TIMEOUT_MS);
  activeFishGameTimer.unref?.();
}

function collectPayloadText(payload, out = []) {
  if (!payload || typeof payload !== 'object') return out;
  if (payload.type === 10 && typeof payload.content === 'string') out.push(payload.content);
  if (Array.isArray(payload.components)) payload.components.forEach((component) => collectPayloadText(component, out));
  return out;
}

function isTerminalFishingPayload(payload) {
  const text = collectPayloadText(payload).join('\n');
  return text.includes('has been caught!')
    || text.includes('has escaped!')
    || text.includes('Fish Barrel is full!');
}

function rejectActiveFishGame(interaction) {
  return interaction.reply({
    content: 'A fishing minigame is already active. Please wait until it ends.',
    flags: EPHEMERAL_FLAG,
  }).catch(() => null);
}

function patchTextDisplay(component) {
  if (component?.type !== 10 || typeof component.content !== 'string') return;
  component.content = component.content.replaceAll(`${WOODEN_ROD_LABEL} ${WOODEN_ROD_UNICODE}`, `${WOODEN_ROD_LABEL} ${WOODEN_ROD_RAW}`);
}

function parseOptionEmoji(emoji) {
  if (!emoji) return null;
  if (typeof emoji === 'object' && emoji.id) return emoji;
  const raw = typeof emoji === 'string' ? emoji : emoji.name;
  const match = String(raw || '').match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/);
  if (match) return { name: match[1], id: match[2], animated: String(raw).startsWith('<a:') };
  return raw ? { name: raw } : null;
}

function patchSelect(component) {
  if (component?.type !== 3 || !Array.isArray(component.options)) return;
  for (const option of component.options) {
    if (option?.label === WOODEN_ROD_LABEL) option.emoji = { ...WOODEN_ROD_EMOJI };
    else if (option?.emoji) option.emoji = parseOptionEmoji(option.emoji);
  }
}

function patchContainer(component) {
  if (component?.type !== 17 || !Array.isArray(component.components)) return;
  const [first, second] = component.components;
  const media = first?.type === 12 ? first.items?.[0]?.media : null;
  if (media && second?.type === 10) {
    component.components.splice(0, 2, {
      type: 9,
      components: [second],
      accessory: { type: 11, media },
    });
  }
}

function patchComponents(components) {
  if (!Array.isArray(components)) return;
  for (const component of components) {
    patchContainer(component);
    patchTextDisplay(component);
    patchSelect(component);
    patchComponents(component.components);
  }
}

function patchPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  patchComponents(payload.components);
  if (isTerminalFishingPayload(payload)) clearFishGameLock();
  return payload;
}

function patchMessage(message) {
  if (!message || typeof message !== 'object') return message;
  return new Proxy(message, {
    get(target, prop, receiver) {
      if (prop === 'edit' && typeof target.edit === 'function') {
        return (payload, ...args) => target.edit(patchPayload(payload), ...args);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function patchInteraction(interaction) {
  return new Proxy(interaction, {
    get(target, prop, receiver) {
      if (prop === 'message') return patchMessage(target.message);
      if (['reply', 'update', 'editReply', 'followUp'].includes(prop) && typeof target[prop] === 'function') {
        return (payload, ...args) => target[prop](patchPayload(payload), ...args);
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function shouldLockFishStart(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('fish:start:')) return false;
  return interaction.user?.id === id.split(':')[2];
}

function shouldRefreshFishLock(interaction) {
  const active = getActiveFishGame();
  return Boolean(active && (interaction.customId || '').startsWith('fish:reel:') && interaction.user?.id === active.userId);
}

function wrapCommand(command, init) {
  return {
    ...command,
    init,
    async execute(interaction, client) {
      return command.execute(patchInteraction(interaction), client);
    },
    async handleInteraction(interaction, client) {
      const lockFishStart = shouldLockFishStart(interaction);
      if (lockFishStart && getActiveFishGame()) {
        await rejectActiveFishGame(interaction);
        return true;
      }

      if (lockFishStart) startFishGameLock(interaction.user.id);
      else if (shouldRefreshFishLock(interaction)) refreshFishGameLock();

      try {
        return await command.handleInteraction(patchInteraction(interaction), client);
      } catch (error) {
        if (lockFishStart) clearFishGameLock();
        throw error;
      }
    },
  };
}

module.exports = {
  fishCommand: wrapCommand(feature.fishCommand, startWeatherEditTimer),
  inventoryCommand: wrapCommand(feature.inventoryCommand),
  fishBarrelCommand: wrapCommand(feature.fishBarrelCommand),
  fishBalanceCommand: wrapCommand(feature.fishBalanceCommand),
};
