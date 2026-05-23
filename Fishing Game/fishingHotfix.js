const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const { trackMessage } = require('../src/actionTimeouts');
const feature = require('./fishingFeature');
const weatherData = require('./Data/WeatherData');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const WOODEN_ROD_LABEL = 'Wooden Fishing Rod';
const WOODEN_ROD_UNICODE = '\uD83C\uDFA3';
const WOODEN_ROD_RAW = '<:IGWoodenFishingRod:1506709123646095430>';
const WOODEN_ROD_EMOJI = { name: 'IGWoodenFishingRod', id: '1506709123646095430' };
const FISH_GAME_LOCK_TIMEOUT_MS = 90_000;
const FISHING_CHANNEL_ID = '1506684299934437517';
const LOCATION = 'Calm Fishing Lake';
const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const FORECAST_SEARCH_LIMIT = 50;

let activeFishGame = null;
let activeFishGameTimer = null;
let weatherEditTimerStarted = false;
const attemptWeather = new Map();

function emptyState() { return { users: {}, weather: {}, forecasts: {} }; }
function ensureStoreFile() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8'); }
function loadState() { ensureStoreFile(); try { const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); return { ...emptyState(), ...(state && typeof state === 'object' ? state : {}) }; } catch { return emptyState(); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8'); }
function seasonTime(now = new Date()) { const utc7 = now.getTime() + (7 * 60 * 60 * 1000); const day = Math.floor(utc7 / 86_400_000); const hour = Math.floor((utc7 % 86_400_000) / 3_600_000); const season = weatherData.SEASONS[Math.floor(day / 2) % weatherData.SEASONS.length]; const timeKey = ['Morning', 'Noon', 'Afternoon', 'Night'][Math.floor((hour % 12) / 3)]; return { season, time: { key: timeKey, emoji: weatherData.TIMES[timeKey] } }; }
function rollWeather(seasonKey, timeKey) { return weatherData.rollWeather(seasonKey, timeKey); }
function getCurrentWeather(state = loadState()) { const { season, time } = seasonTime(); const now = Date.now(); const slotStart = Math.floor(now / weatherData.WEATHER_DURATION_MS) * weatherData.WEATHER_DURATION_MS; const current = state.weather[LOCATION]; if (current && Number(current.endsAt) > now) { current.season = season.key; current.seasonEmoji = season.emoji; current.time = time.key; current.timeEmoji = time.emoji; return current; } const weather = rollWeather(season.key, time.key); state.weather[LOCATION] = { location: LOCATION, season: season.key, seasonEmoji: season.emoji, time: time.key, timeEmoji: time.emoji, weather: weather.name, weatherEmoji: weather.emoji, startedAt: slotStart, endsAt: slotStart + weatherData.WEATHER_DURATION_MS }; return state.weather[LOCATION]; }
function formatForecast(weather) { const effects = weatherData.WEATHER_TEXT[weather.weather] || weatherData.WEATHER_TEXT.Sunny; return ['## Fishy Weather Forecast \uD83D\uDC1F', `* Season: ${weather.season} ${weather.seasonEmoji}`, `* Time: ${weather.time} ${weather.timeEmoji}`, `* Todays weather: ${weather.weather} ${weather.weatherEmoji}`, '', '-# Effects:', effects.map((effect) => `- ${effect}`).join('\n')].join('\n'); }
function containerPayload(accent, innerComponents, files = []) { return { flags: COMPONENTS_V2_FLAG, files, components: [{ type: 17, accent_color: accent, components: innerComponents.filter(Boolean) }] }; }

async function findForecastMessage(channel) {
  const messages = await channel.messages?.fetch?.({ limit: FORECAST_SEARCH_LIMIT }).catch(() => null);
  if (!messages) return null;
  return messages.find((message) => message.author?.id === channel.client?.user?.id && JSON.stringify(message.components || []).includes('Fishy Weather Forecast')) || null;
}

async function getForecastMessage(channel, state) {
  const savedId = state.forecasts?.forecastMessageId;
  if (savedId) {
    const saved = await channel.messages.fetch(savedId).catch(() => null);
    if (saved) return saved;
  }
  return findForecastMessage(channel);
}

async function maybeEditWeatherForecast(client) {
  const state = loadState();
  state.forecasts = state.forecasts && typeof state.forecasts === 'object' ? state.forecasts : {};
  const weather = getCurrentWeather(state);
  const key = `${weather.location}:${weather.startedAt}:${weather.weather}`;
  const channel = await client.channels.fetch(FISHING_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) { saveState(state); return; }

  let message = await getForecastMessage(channel, state);
  if (message?.id) state.forecasts.forecastMessageId = message.id;

  if (message && state.forecasts.lastForecastKey === key) {
    saveState(state);
    return;
  }

  const payload = containerPayload(WHITE_ACCENT, [{ type: 10, content: formatForecast(weather) }]);
  message = message ? await message.edit(payload).catch(() => null) : await channel.send(payload).catch(() => null);

  if (message?.id) {
    state.forecasts.forecastMessageId = message.id;
    state.forecasts.lastForecastKey = key;
  }
  saveState(state);
}

function startWeatherEditTimer(client) {
  if (weatherEditTimerStarted) return;
  weatherEditTimerStarted = true;
  maybeEditWeatherForecast(client).catch(() => null);
  setInterval(() => maybeEditWeatherForecast(client).catch(() => null), 60_000);
}

function clearFishGameLock() { activeFishGame = null; if (activeFishGameTimer) clearTimeout(activeFishGameTimer); activeFishGameTimer = null; }
function getActiveFishGame() { if (!activeFishGame) return null; if (Date.now() >= activeFishGame.expiresAt) clearFishGameLock(); return activeFishGame; }
function startFishGameLock(userId) { clearFishGameLock(); activeFishGame = { userId, expiresAt: Date.now() + FISH_GAME_LOCK_TIMEOUT_MS }; activeFishGameTimer = setTimeout(clearFishGameLock, FISH_GAME_LOCK_TIMEOUT_MS); activeFishGameTimer.unref?.(); }
function refreshFishGameLock() { if (!activeFishGame) return; activeFishGame.expiresAt = Date.now() + FISH_GAME_LOCK_TIMEOUT_MS; if (activeFishGameTimer) clearTimeout(activeFishGameTimer); activeFishGameTimer = setTimeout(clearFishGameLock, FISH_GAME_LOCK_TIMEOUT_MS); activeFishGameTimer.unref?.(); }

function collectPayloadText(payload, out = []) { if (!payload || typeof payload !== 'object') return out; if (payload.type === 10 && typeof payload.content === 'string') out.push(payload.content); if (Array.isArray(payload.components)) payload.components.forEach((component) => collectPayloadText(component, out)); return out; }
function isCaughtPayload(payload) { return collectPayloadText(payload).join('\n').includes('has been caught!'); }
function isTerminalFishingPayload(payload) { const text = collectPayloadText(payload).join('\n'); return text.includes('has been caught!') || text.includes('has escaped!') || text.includes('Fish Barrel is full!'); }
function applyMutation(userId) { const state = loadState(); const user = state.users?.[userId]; if (!user || !Array.isArray(user.fishBarrel) || !user.fishBarrel.length) return null; const caught = user.fishBarrel[user.fishBarrel.length - 1]; if (!caught || caught.mutation) return caught || null; const weatherName = attemptWeather.get(userId) || getCurrentWeather(state).weather; const mutation = weatherData.rollMutation(weatherName); caught.mutation = mutation?.name || null; caught.mutationEmoji = mutation?.emoji || null; caught.mutationMultiplier = mutation?.multiplier || 1; saveState(state); attemptWeather.delete(userId); return caught; }
function patchCaughtPayload(payload, caught) { if (!caught || !payload || typeof payload !== 'object') return payload; const label = caught.mutation ? `${caught.mutation} ${caught.mutationEmoji || ''}`.trim() : 'None'; const visit = (value) => { if (!value || typeof value !== 'object') return; if (value.type === 10 && typeof value.content === 'string' && value.content.includes('has been caught!') && !value.content.includes('* Mutation:')) value.content = value.content.replace('\n-# * Weigh:', `\n-# * Mutation: ${label}\n-# * Weigh:`); if (Array.isArray(value.components)) value.components.forEach(visit); }; visit(payload); return payload; }
function rejectActiveFishGame(interaction) { return interaction.reply({ content: 'A fishing minigame is already active. Please wait until it ends.', flags: EPHEMERAL_FLAG }).catch(() => null); }
function patchFishNames(component) { if (component?.type !== 10 || typeof component.content !== 'string') return; component.content = component.content.replace(/\bF[1-7]\s+(?=[A-Z])/g, ''); }
function patchTextDisplay(component) { if (component?.type !== 10 || typeof component.content !== 'string') return; component.content = component.content.replaceAll(`${WOODEN_ROD_LABEL} ${WOODEN_ROD_UNICODE}`, `${WOODEN_ROD_LABEL} ${WOODEN_ROD_RAW}`); }
function parseOptionEmoji(emoji) { if (!emoji) return null; if (typeof emoji === 'object' && emoji.id) return emoji; const raw = typeof emoji === 'string' ? emoji : emoji.name; const match = String(raw || '').match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/); if (match) return { name: match[1], id: match[2], animated: String(raw).startsWith('<a:') }; return raw ? { name: raw } : null; }
function patchOption(option) { if (!option || typeof option !== 'object') return; if (option.label === WOODEN_ROD_LABEL) option.emoji = { ...WOODEN_ROD_EMOJI }; else if (option.emoji) option.emoji = parseOptionEmoji(option.emoji); if (option.data?.emoji) option.data.emoji = parseOptionEmoji(option.data.emoji); }
function patchSelect(component) { if (component?.type !== 3) return; if (Array.isArray(component.options)) component.options.forEach(patchOption); if (Array.isArray(component.data?.options)) component.data.options.forEach(patchOption); }
function patchContainer(component) { if (component?.type !== 17 || !Array.isArray(component.components)) return; const [first, second] = component.components; const media = first?.type === 12 ? first.items?.[0]?.media : null; if (media && second?.type === 10) component.components.splice(0, 2, { type: 9, components: [second], accessory: { type: 11, media } }); }
function patchComponents(components) { if (!Array.isArray(components)) return; for (const component of components) { patchContainer(component); patchFishNames(component); patchTextDisplay(component); patchSelect(component); patchComponents(component.components); } }
function patchPayload(payload, userId = null) { if (!payload || typeof payload !== 'object') return payload; patchComponents(payload.components); if (userId && isCaughtPayload(payload)) patchCaughtPayload(payload, applyMutation(userId)); if (isTerminalFishingPayload(payload)) clearFishGameLock(); return payload; }
function patchMessage(message) { if (!message || typeof message !== 'object') return message; return new Proxy(message, { get(target, prop, receiver) { if (prop === 'edit' && typeof target.edit === 'function') return async (payload, ...args) => { const result = await target.edit(patchPayload(payload), ...args); trackMessage(result?.id ? result : target); return result; }; const value = Reflect.get(target, prop, receiver); return typeof value === 'function' ? value.bind(target) : value; } }); }
function patchInteraction(interaction) { return new Proxy(interaction, { get(target, prop, receiver) { if (prop === 'message') return patchMessage(target.message); if (['reply', 'update', 'editReply', 'followUp'].includes(prop) && typeof target[prop] === 'function') return (payload, ...args) => target[prop](patchPayload(payload, target.user?.id), ...args); const value = Reflect.get(target, prop, receiver); return typeof value === 'function' ? value.bind(target) : value; } }); }
function shouldLockFishStart(interaction) { const id = interaction.customId || ''; if (!id.startsWith('fish:start:')) return false; return interaction.user?.id === id.split(':')[2]; }
function shouldRefreshFishLock(interaction) { const active = getActiveFishGame(); return Boolean(active && (interaction.customId || '').startsWith('fish:reel:') && interaction.user?.id === active.userId); }

function wrapCommand(command, init) {
  return {
    ...command,
    init,
    disableActionTimeout: false,
    async execute(interaction, client) { if (typeof command.execute !== 'function') return undefined; return command.execute(patchInteraction(interaction), client); },
    async handleInteraction(interaction, client) {
      if (typeof command.handleInteraction !== 'function') return false;
      const lockFishStart = shouldLockFishStart(interaction);
      if (lockFishStart && getActiveFishGame()) { await rejectActiveFishGame(interaction); return true; }
      if (lockFishStart) { const state = loadState(); const weather = getCurrentWeather(state); saveState(state); attemptWeather.set(interaction.user.id, weather.weather); startFishGameLock(interaction.user.id); }
      else if (shouldRefreshFishLock(interaction)) refreshFishGameLock();
      try { return await command.handleInteraction(patchInteraction(interaction), client); }
      catch (error) { if (lockFishStart) clearFishGameLock(); throw error; }
    },
  };
}

module.exports = {
  fishCommand: wrapCommand(feature.fishCommand, startWeatherEditTimer),
  inventoryCommand: wrapCommand(feature.inventoryCommand),
  fishBarrelCommand: wrapCommand(feature.fishBarrelCommand),
  fishBalanceCommand: wrapCommand(feature.fishBalanceCommand),
};
