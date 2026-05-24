const fs = require('fs');
const path = require('path');
const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const weatherData = require('./Data/WeatherData');
const runtime = require('./fishingFeature');

const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const LOCATION = 'Calm Fishing Lake';
const EPH = MessageFlags.Ephemeral ?? 64;
const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const WHITE = 0xffffff;

function emptyState() { return { users: {}, weather: {}, forecasts: {}, events: { active: {} } }; }
function ensureStoreFile() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8'); }
function loadState() { ensureStoreFile(); try { return { ...emptyState(), ...JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) }; } catch { return emptyState(); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8'); }
function parseDuration(value, fallbackMs = weatherData.WEATHER_DURATION_MS) { const raw = String(value || '').trim().toLowerCase(); if (!raw) return fallbackMs; const match = raw.match(/^(\d+(?:\.\d+)?)(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days)?$/); if (!match) return fallbackMs; const n = Number(match[1]); const unit = match[2] || 'm'; const mult = unit.startsWith('s') ? 1000 : unit.startsWith('h') ? 3600000 : unit.startsWith('d') ? 86400000 : 60000; return Math.max(1000, Math.floor(n * mult)); }
function seasonTime(now = new Date()) { const utc7 = now.getTime() + (7 * 60 * 60 * 1000); const day = Math.floor(utc7 / 86_400_000); const hour = Math.floor((utc7 % 86_400_000) / 3_600_000); const season = weatherData.SEASONS[Math.floor(day / 2) % weatherData.SEASONS.length]; const timeKey = ['Morning', 'Noon', 'Afternoon', 'Night'][Math.floor((hour % 12) / 3)]; return { season, time: { key: timeKey, emoji: weatherData.TIMES[timeKey] } }; }
function emojiImageUrl(emoji) { const match = String(emoji || '').match(/<a?:([A-Za-z0-9_]+):(\d+)>/); return match ? `https://cdn.discordapp.com/emojis/${match[2]}.${String(emoji).startsWith('<a:') ? 'gif' : 'png'}?quality=lossless` : null; }
function payload(content, mediaUrl = null) { const text = { type: 10, content }; return { flags: COMPONENTS_V2_FLAG | EPH, components: [{ type: 17, accent_color: WHITE, components: [mediaUrl ? { type: 9, components: [text], accessory: { type: 11, media: { url: mediaUrl } } } : text] }] }; }
function isAdmin(interaction) { return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.Administrator)); }
function weatherChoices() { return [...Object.keys(weatherData.WEATHER_EMOJIS), ...Object.keys(runtime.ADMIN_WEATHER || {})].map((name) => ({ name, value: name })).slice(0, 25); }
function eventChoices() { return Object.entries(runtime.FISH_EVENTS || {}).map(([id, event]) => ({ name: event.name, value: id })).slice(0, 25); }

const fishWeatherStartCommand = {
  data: new SlashCommandBuilder()
    .setName('fish-weather-start')
    .setDescription('Admin: start a fish weather')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName('weather').setDescription('Weather to start').setRequired(true).addChoices(...weatherChoices()))
    .addStringOption((option) => option.setName('duration').setDescription('Optional duration like 30m, 2h, 45s').setRequired(false)),
  suppressCommandLog: true,
  async execute(interaction, client) {
    if (!isAdmin(interaction)) return interaction.reply(payload('Only administrators can start fish weather.'));
    const name = interaction.options.getString('weather', true);
    const durationMs = parseDuration(interaction.options.getString('duration'));
    const state = loadState();
    const now = Date.now();
    const { season, time } = seasonTime();
    const emoji = runtime.ADMIN_WEATHER?.[name]?.emoji || weatherData.WEATHER_EMOJIS[name] || '';
    state.weather = state.weather && typeof state.weather === 'object' ? state.weather : {};
    state.weather[LOCATION] = { location: LOCATION, season: season.key, seasonEmoji: season.emoji, time: time.key, timeEmoji: time.emoji, weather: name, weatherEmoji: emoji, startedAt: now, endsAt: now + durationMs, manual: true };
    state.forecasts = state.forecasts && typeof state.forecasts === 'object' ? state.forecasts : {};
    delete state.forecasts.lastForecastKey;
    saveState(state);
    await runtime.maybeEditWeatherForecast(client).catch(() => null);
    return interaction.reply(payload(`Started **${name} ${emoji}** for ${Math.ceil(durationMs / 60000)} minute(s).`));
  },
};

const fishEventStartCommand = {
  data: new SlashCommandBuilder()
    .setName('fish-event-start')
    .setDescription('Admin: start a fish event')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName('event').setDescription('Event to start').setRequired(true).addChoices(...eventChoices()))
    .addStringOption((option) => option.setName('duration').setDescription('Optional duration like 30m, 2h, 45s').setRequired(false)),
  suppressCommandLog: true,
  async execute(interaction, client) {
    if (!isAdmin(interaction)) return interaction.reply(payload('Only administrators can start fish events.'));
    const eventId = interaction.options.getString('event', true);
    const event = runtime.FISH_EVENTS?.[eventId];
    if (!event) return interaction.reply(payload('Unknown fish event.'));
    const durationMs = parseDuration(interaction.options.getString('duration'));
    const state = loadState();
    state.events = state.events && typeof state.events === 'object' ? state.events : { active: {} };
    state.events.active = state.events.active && typeof state.events.active === 'object' ? state.events.active : {};
    state.events.active[eventId] = { startedAt: Date.now(), endsAt: Date.now() + durationMs };
    state.forecasts = state.forecasts && typeof state.forecasts === 'object' ? state.forecasts : {};
    delete state.forecasts.lastForecastKey;
    saveState(state);
    await runtime.maybeEditWeatherForecast(client).catch(() => null);
    return interaction.reply(payload(`Started **${event.name}** for ${Math.ceil(durationMs / 60000)} minute(s).`, emojiImageUrl(event.emoji)));
  },
};

module.exports = { fishWeatherStartCommand, fishEventStartCommand };
