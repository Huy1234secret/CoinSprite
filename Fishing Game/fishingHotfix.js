const fs = require('fs');
const path = require('path');
const { AttachmentBuilder, MessageFlags } = require('discord.js');
const { trackMessage } = require('../src/actionTimeouts');
const feature = require('./fishingFeature');
const weatherData = require('./Data/WeatherData');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE_ACCENT = 0xffffff;
const YELLOW_ACCENT = 0xffd84d;
const LOCATION = 'Calm Fishing Lake';
const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const FISHING_CHANNEL_ID = '1506684299934437517';
const FISH_GAME_LOCK_TIMEOUT_MS = 90_000;
const FORECAST_SEARCH_LIMIT = 50;

const WOODEN_ROD_LABEL = 'Wooden Fishing Rod';
const WOODEN_ROD_RAW = '<:IGWoodenFishingRod:1506709123646095430>';
const WOODEN_ROD_EMOJI = { name: 'IGWoodenFishingRod', id: '1506709123646095430' };

const ADMIN_WEATHER = {
  'Golden Rain': { emoji: '<:SBWGoldenRain:1507787645403791420>', goldenBonus: 0.8, text: ['The ocean is shining with gold!'] },
  Rainbow: { emoji: '<:SBWRainbow:1507787647450480680>', goldenBonus: 0.2, text: ['Rainbow skies bless the waters!'] },
};

const FISH_EVENTS = {
  strength_blessing: { name: 'Strength Blessing', emoji: '<:SBEStrenghtBoost:1507787642811711589>', description: 'You have a feeling that your muscle are stronger! Catching hard fish isnt a problem now!', powerMultiplier: 2 },
  fish_hotspot: { name: 'Fish Hotspot', emoji: '<:SBEFishHotspot:1507787640529879144>', description: 'Suddenly fish being really active, is this fish festival???', instantBite: true },
  attack_of_fish: { name: 'Attack of Fish', emoji: '<:SBEAttackOfFish:150778638848098454>', description: 'Fish getting fat!', giantChance: 0.5 },
};

const activeFishGames = new Map();
let weatherEditTimerStarted = false;
const attemptWeather = new Map();

function normalizeId(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function emptyState() { return { users: {}, weather: {}, forecasts: {}, events: { active: {} } }; }
function ensureStoreFile() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8'); }
function loadState() { ensureStoreFile(); try { const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); return { ...emptyState(), ...(state && typeof state === 'object' ? state : {}) }; } catch { return emptyState(); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8'); }
function ensureUser(state, userId) { if (!state.users[userId]) state.users[userId] = { fishCoins: 0, inventory: {}, fishBarrel: [], fishCapacity: 10, fishIndex: {}, mutationIndex: {} }; const user = state.users[userId]; user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {}; user.fishBarrel = Array.isArray(user.fishBarrel) ? user.fishBarrel : []; user.fishIndex = user.fishIndex && typeof user.fishIndex === 'object' ? user.fishIndex : {}; user.mutationIndex = user.mutationIndex && typeof user.mutationIndex === 'object' ? user.mutationIndex : {}; return user; }
function cleanupEvents(state = loadState(), now = Date.now()) { state.events = state.events && typeof state.events === 'object' ? state.events : { active: {} }; state.events.active = state.events.active && typeof state.events.active === 'object' ? state.events.active : {}; for (const [eventId, event] of Object.entries(state.events.active)) if (!event || Number(event.endsAt) <= now || !FISH_EVENTS[eventId]) delete state.events.active[eventId]; return state.events.active; }
function activeEvents(state = loadState()) { return cleanupEvents(state); }
function hasEvent(state, eventId) { return Boolean(activeEvents(state)[eventId]); }
function seasonTime(now = new Date()) { const utc7 = now.getTime() + (7 * 60 * 60 * 1000); const day = Math.floor(utc7 / 86_400_000); const hour = Math.floor((utc7 % 86_400_000) / 3_600_000); const season = weatherData.SEASONS[Math.floor(day / 2) % weatherData.SEASONS.length]; const timeKey = ['Morning', 'Noon', 'Afternoon', 'Night'][Math.floor((hour % 12) / 3)]; return { season, time: { key: timeKey, emoji: weatherData.TIMES[timeKey] } }; }
function weatherEmoji(name) { return ADMIN_WEATHER[name]?.emoji || weatherData.WEATHER_EMOJIS[name] || ''; }
function rollWeather(seasonKey, timeKey) { return weatherData.rollWeather(seasonKey, timeKey); }
function getCurrentWeather(state = loadState()) { const { season, time } = seasonTime(); const now = Date.now(); const slotStart = Math.floor(now / weatherData.WEATHER_DURATION_MS) * weatherData.WEATHER_DURATION_MS; const current = state.weather[LOCATION]; if (current && Number(current.endsAt) > now) { current.season = season.key; current.seasonEmoji = season.emoji; current.time = time.key; current.timeEmoji = time.emoji; current.weatherEmoji = current.weatherEmoji || weatherEmoji(current.weather); return current; } const weather = rollWeather(season.key, time.key); state.weather[LOCATION] = { location: LOCATION, season: season.key, seasonEmoji: season.emoji, time: time.key, timeEmoji: time.emoji, weather: weather.name, weatherEmoji: weather.emoji, startedAt: slotStart, endsAt: slotStart + weatherData.WEATHER_DURATION_MS }; return state.weather[LOCATION]; }
function formatDuration(ms) { const sec = Math.max(0, Math.ceil(ms / 1000)); const h = Math.floor(sec / 3600); const m = Math.floor((sec % 3600) / 60); const s = sec % 60; return h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`; }
function formatForecast(weather) { const effects = ADMIN_WEATHER[weather.weather]?.text || weatherData.WEATHER_TEXT[weather.weather] || weatherData.WEATHER_TEXT.Sunny; return ['## Fishy Weather Forecast 🐟', `* Season: ${weather.season} ${weather.seasonEmoji}`, `* Time: ${weather.time} ${weather.timeEmoji}`, `* Todays weather: ${weather.weather} ${weather.weatherEmoji || weatherEmoji(weather.weather)}`, '', '-# Effects:', effects.map((effect) => `- ${effect}`).join('\n')].join('\n'); }
function emojiImageUrl(emoji) { const match = String(emoji || '').match(/<a?:([A-Za-z0-9_]+):(\d+)>/); return match ? `https://cdn.discordapp.com/emojis/${match[2]}.${String(emoji).startsWith('<a:') ? 'gif' : 'png'}?quality=lossless` : null; }
function forecastPayload(weather, state) { cleanupEvents(state); const components = [{ type: 17, accent_color: WHITE_ACCENT, components: [{ type: 10, content: formatForecast(weather) }] }]; const now = Date.now(); for (const [eventId, active] of Object.entries(state.events.active || {})) { const event = FISH_EVENTS[eventId]; if (!event) continue; const text = `### ${event.name} has started!\n-# Duration: ${formatDuration(Number(active.endsAt) - now)}\n-# ${event.description}`; const media = emojiImageUrl(event.emoji); components.push({ type: 17, accent_color: YELLOW_ACCENT, components: [{ type: 9, components: [{ type: 10, content: text }], accessory: media ? { type: 11, media: { url: media } } : undefined }] }); }
 return { flags: COMPONENTS_V2_FLAG, components };
}
function collectPayloadText(payload, out = []) { if (!payload || typeof payload !== 'object') return out; if (payload.type === 10 && typeof payload.content === 'string') out.push(payload.content); if (Array.isArray(payload.components)) payload.components.forEach((component) => collectPayloadText(component, out)); return out; }
async function findForecastMessage(channel) { const messages = await channel.messages?.fetch?.({ limit: FORECAST_SEARCH_LIMIT }).catch(() => null); if (!messages) return null; return messages.find((message) => message.author?.id === channel.client?.user?.id && JSON.stringify(message.components || []).includes('Fishy Weather Forecast')) || null; }
async function getForecastMessage(channel, state) { const savedId = state.forecasts?.forecastMessageId; if (savedId) { const saved = await channel.messages.fetch(savedId).catch(() => null); if (saved) return saved; } return findForecastMessage(channel); }
async function maybeEditWeatherForecast(client) { const state = loadState(); state.forecasts = state.forecasts && typeof state.forecasts === 'object' ? state.forecasts : {}; const weather = getCurrentWeather(state); cleanupEvents(state); const key = `${weather.location}:${weather.startedAt}:${weather.weather}:${Object.keys(state.events.active || {}).join(',')}:${Math.floor(Date.now() / 60000)}`; const channel = await client.channels.fetch(FISHING_CHANNEL_ID).catch(() => null); if (!channel?.isTextBased?.()) { saveState(state); return; } let message = await getForecastMessage(channel, state); if (message?.id) state.forecasts.forecastMessageId = message.id; if (message && state.forecasts.lastForecastKey === key) { saveState(state); return; } const payload = forecastPayload(weather, state); message = message ? await message.edit(payload).catch(() => null) : await channel.send(payload).catch(() => null); if (message?.id) { state.forecasts.forecastMessageId = message.id; state.forecasts.lastForecastKey = key; } saveState(state); }
function startWeatherEditTimer(client) { if (weatherEditTimerStarted) return; weatherEditTimerStarted = true; maybeEditWeatherForecast(client).catch(() => null); setInterval(() => maybeEditWeatherForecast(client).catch(() => null), 60_000); }
function startFishGameLock(userId) { clearFishGameLock(userId); const timer = setTimeout(() => clearFishGameLock(userId), FISH_GAME_LOCK_TIMEOUT_MS); timer.unref?.(); activeFishGames.set(userId, { expiresAt: Date.now() + FISH_GAME_LOCK_TIMEOUT_MS, timer }); }
function clearFishGameLock(userId) { const active = activeFishGames.get(userId); if (active?.timer) clearTimeout(active.timer); activeFishGames.delete(userId); }
function getActiveFishGame(userId) { const active = activeFishGames.get(userId); if (!active) return null; if (Date.now() >= active.expiresAt) { clearFishGameLock(userId); return null; } return active; }
function refreshFishGameLock(userId) { if (!activeFishGames.has(userId)) return; startFishGameLock(userId); }
function isCaughtPayload(payload) { return collectPayloadText(payload).join('\n').includes('has been caught!'); }
function isTerminalFishingPayload(payload) { const text = collectPayloadText(payload).join('\n'); return text.includes('has been caught!') || text.includes('has escaped!') || text.includes('Fish Barrel is full!'); }
function rememberMutation(user, caught) { if (!caught?.mutation || String(caught.mutation).toLowerCase() === 'none') return; user.mutationIndex = user.mutationIndex && typeof user.mutationIndex === 'object' ? user.mutationIndex : {}; const key = normalizeId(caught.mutation); const previous = user.mutationIndex[key] && typeof user.mutationIndex[key] === 'object' ? user.mutationIndex[key] : {}; user.mutationIndex[key] = { discoveredAt: previous.discoveredAt || caught.caughtAt || Date.now(), count: Math.max(0, Math.floor(Number(previous.count) || 0)) + 1, lastCaughtAt: caught.caughtAt || Date.now() };
}
function applyMutation(userId) { const state = loadState(); const user = ensureUser(state, userId); if (!Array.isArray(user.fishBarrel) || !user.fishBarrel.length) return null; const caught = user.fishBarrel[user.fishBarrel.length - 1]; if (!caught || caught.mutation) return caught || null; const weatherName = attemptWeather.get(userId) || getCurrentWeather(state).weather; let mutation = weatherData.rollMutation(weatherName); if (!mutation && hasEvent(state, 'attack_of_fish') && Math.random() < FISH_EVENTS.attack_of_fish.giantChance) mutation = { name: 'GIANT', emoji: FISH_EVENTS.attack_of_fish.emoji, multiplier: 1, weightMultiplier: 2 };
 if (mutation) { caught.mutation = mutation.name; caught.mutationEmoji = mutation.emoji || null; caught.mutationMultiplier = Number(mutation.multiplier) || 1; if (mutation.weightMultiplier) { caught.weight = Number((Number(caught.weight || 0) * mutation.weightMultiplier).toFixed(2)); caught.weightMultiplier = mutation.weightMultiplier; } rememberMutation(user, caught); } else { caught.mutation = null; caught.mutationEmoji = null; caught.mutationMultiplier = 1; }
 saveState(state); attemptWeather.delete(userId); return caught; }
function patchCaughtPayload(payload, caught) { if (!caught || !payload || typeof payload !== 'object') return payload; const label = caught.mutation ? `${caught.mutation} ${caught.mutationEmoji || ''}`.trim() : 'None'; const visit = (value) => { if (!value || typeof value !== 'object') return; if (value.type === 10 && typeof value.content === 'string' && value.content.includes('has been caught!')) { if (!value.content.includes('* Mutation:')) value.content = value.content.replace('\n-# * Weigh:', `\n-# * Mutation: ${label}\n-# * Weigh:`); value.content = value.content.replace(/-# \* Weigh: [^\n]+/, `-# * Weigh: ${caught.weight} kg`); } if (Array.isArray(value.components)) value.components.forEach(visit); }; visit(payload); return payload; }
function rejectActiveFishGame(interaction) { return interaction.reply({ content: 'You already have a fishing minigame active. Finish it before starting another one.', flags: EPHEMERAL_FLAG }).catch(() => null); }
function patchFishNames(component) { if (component?.type !== 10 || typeof component.content !== 'string') return; component.content = component.content.replace(/\bF[1-7]\s+(?=[A-Z])/g, ''); }
function patchTextDisplay(component) { if (component?.type !== 10 || typeof component.content !== 'string') return; component.content = component.content.replaceAll(`${WOODEN_ROD_LABEL} 🎣`, `${WOODEN_ROD_LABEL} ${WOODEN_ROD_RAW}`); }
function parseOptionEmoji(emoji) { if (!emoji) return null; if (typeof emoji === 'object' && emoji.id) return emoji; const raw = typeof emoji === 'string' ? emoji : emoji.name; const match = String(raw || '').match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/); if (match) return { name: match[1], id: match[2], animated: String(raw).startsWith('<a:') }; return raw ? { name: raw } : null; }
function patchOption(option) { if (!option || typeof option !== 'object') return; if (option.label === WOODEN_ROD_LABEL) option.emoji = { ...WOODEN_ROD_EMOJI }; else if (option.emoji) option.emoji = parseOptionEmoji(option.emoji); if (option.data?.emoji) option.data.emoji = parseOptionEmoji(option.data.emoji); }
function patchSelect(component) { if (component?.type !== 3) return; if (Array.isArray(component.options)) component.options.forEach(patchOption); if (Array.isArray(component.data?.options)) component.data.options.forEach(patchOption); }
function patchContainer(component) { if (component?.type !== 17 || !Array.isArray(component.components)) return; const [first, second] = component.components; const media = first?.type === 12 ? first.items?.[0]?.media : null; if (media && second?.type === 10) component.components.splice(0, 2, { type: 9, components: [second], accessory: { type: 11, media } }); }
function patchComponents(components) { if (!Array.isArray(components)) return; for (const component of components) { patchContainer(component); patchFishNames(component); patchTextDisplay(component); patchSelect(component); patchComponents(component.components); } }
function patchPayload(payload, userId = null) { if (!payload || typeof payload !== 'object') return payload; patchComponents(payload.components); if (userId && isCaughtPayload(payload)) patchCaughtPayload(payload, applyMutation(userId)); if (userId && isTerminalFishingPayload(payload)) clearFishGameLock(userId); return payload; }
function patchMessage(message) { if (!message || typeof message !== 'object') return message; return new Proxy(message, { get(target, prop, receiver) { if (prop === 'edit' && typeof target.edit === 'function') return async (payload, ...args) => { const userId = collectPayloadText(payload).join('\n').includes('has been caught!') ? null : undefined; const result = await target.edit(patchPayload(payload, userId), ...args); trackMessage(result?.id ? result : target); return result; }; const value = Reflect.get(target, prop, receiver); return typeof value === 'function' ? value.bind(target) : value; } }); }
function patchInteraction(interaction) { return new Proxy(interaction, { get(target, prop, receiver) { if (prop === 'message') return patchMessage(target.message); if (['reply', 'update', 'editReply', 'followUp'].includes(prop) && typeof target[prop] === 'function') return (payload, ...args) => target[prop](patchPayload(payload, target.user?.id), ...args); const value = Reflect.get(target, prop, receiver); return typeof value === 'function' ? value.bind(target) : value; } }); }
function shouldLockFishStart(interaction) { const id = interaction.customId || ''; return id.startsWith('fish:start:') && interaction.user?.id === id.split(':')[2]; }
function shouldRefreshFishLock(interaction) { const id = interaction.customId || ''; return id.startsWith('fish:reel:') && Boolean(getActiveFishGame(interaction.user?.id)); }
function wrapCommand(command, init) { return { ...command, init, disableActionTimeout: false, async execute(interaction, client) { if (typeof command.execute !== 'function') return undefined; return command.execute(patchInteraction(interaction), client); }, async handleInteraction(interaction, client) { if (typeof command.handleInteraction !== 'function') return false; const lockFishStart = shouldLockFishStart(interaction); if (lockFishStart && getActiveFishGame(interaction.user.id)) { await rejectActiveFishGame(interaction); return true; } if (lockFishStart) { const state = loadState(); const weather = getCurrentWeather(state); saveState(state); attemptWeather.set(interaction.user.id, weather.weather); startFishGameLock(interaction.user.id); } else if (shouldRefreshFishLock(interaction)) refreshFishGameLock(interaction.user.id); try { return await command.handleInteraction(patchInteraction(interaction), client); } catch (error) { if (lockFishStart) clearFishGameLock(interaction.user.id); throw error; } } }; }

module.exports = {
  ADMIN_WEATHER,
  FISH_EVENTS,
  activeEvents,
  cleanupEvents,
  getCurrentWeather,
  maybeEditWeatherForecast,
  fishCommand: wrapCommand(feature.fishCommand, startWeatherEditTimer),
  inventoryCommand: wrapCommand(feature.inventoryCommand),
  fishBarrelCommand: wrapCommand(feature.fishBarrelCommand),
  fishBalanceCommand: wrapCommand(feature.fishBalanceCommand),
};
