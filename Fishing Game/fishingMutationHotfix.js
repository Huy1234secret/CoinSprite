const fs = require('fs');
const path = require('path');
const { MessageFlags } = require('discord.js');
const baseCommands = require('./fishingHotfix');
const { WEATHER_DURATION_MS, WEATHER_TEXT, rollMutation, rollWeather } = require('./Data/WeatherData');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const WHITE_ACCENT = 0xffffff;
const FISHING_CHANNEL_ID = '1506684299934437517';
const LOCATION = 'Calm Fishing Lake';
const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const FORECAST_SEARCH_LIMIT = 50;
const WEATHER_TIMER_MS = 60_000;

let weatherTimerStarted = false;
const attemptWeather = new Map();

function emptyState() {
  return { users: {}, weather: {}, forecasts: {} };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8');
}

function loadState() {
  ensureStoreFile();
  try {
    const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return { ...emptyState(), ...(state && typeof state === 'object' ? state : {}) };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8');
}

function seasonTime(now = new Date()) {
  const utc7 = now.getTime() + (7 * 60 * 60 * 1000);
  const day = Math.floor(utc7 / 86_400_000);
  const hour = Math.floor((utc7 % 86_400_000) / 3_600_000);
  const season = ['Spring', 'Summer', 'Fall', 'Winter'][Math.floor(day / 2) % 4];
  const time = ['Morning', 'Noon', 'Afternoon', 'Night'][Math.floor((hour % 12) / 3)];
  return { season, time };
}

function getSeasonEmoji(season) {
  return { Spring: '<:SBSSpring:1507648001156317214>', Summer: '<:SBSSummer:1507648004130082906>', Fall: '<:SBSAutumn:1507647996483997797>', Winter: '<:SBSWinter:1507648006298664990>' }[season] || '';
}

function getTimeEmoji(time) {
  return { Morning: '<:SBTMorning:1507648010434117753>', Noon: '<:SBSNoon:1507647998119772171>', Afternoon: '<:SBTAfternoon:1507648008538423397>', Night: '<:SBTNight:1507648012359303168>' }[time] || '';
}

function syncCurrentWeather(state = loadState()) {
  const now = Date.now();
  const current = state.weather?.[LOCATION];
  const { season, time } = seasonTime();
  if (current && Number(current.endsAt) > now) {
    current.season = season;
    current.seasonEmoji = getSeasonEmoji(season);
    current.time = time;
    current.timeEmoji = getTimeEmoji(time);
    return current;
  }

  const weather = rollWeather(season, time);
  const slotStart = Math.floor(now / WEATHER_DURATION_MS) * WEATHER_DURATION_MS;
  state.weather = state.weather && typeof state.weather === 'object' ? state.weather : {};
  state.weather[LOCATION] = {
    location: LOCATION,
    season,
    seasonEmoji: getSeasonEmoji(season),
    time,
    timeEmoji: getTimeEmoji(time),
    weather: weather.name,
    weatherEmoji: weather.emoji,
    startedAt: slotStart,
    endsAt: slotStart + WEATHER_DURATION_MS,
  };
  return state.weather[LOCATION];
}

function formatForecast(weather) {
  const effects = WEATHER_TEXT[weather.weather] || WEATHER_TEXT.Sunny;
  return ['## Fishy Weather Forecast', `* Season: ${weather.season} ${weather.seasonEmoji}`, `* Time: ${weather.time} ${weather.timeEmoji}`, `* Todays weather: ${weather.weather} ${weather.weatherEmoji}`, '', '-# Effects:', effects.map((effect) => `- ${effect}`).join('\n')].join('\n');
}

function containerPayload(accent, innerComponents) {
  return { flags: COMPONENTS_V2_FLAG, components: [{ type: 17, accent_color: accent, components: innerComponents.filter(Boolean) }] };
}

async function findForecastMessage(channel) {
  const messages = await channel.messages?.fetch?.({ limit: FORECAST_SEARCH_LIMIT }).catch(() => null);
  if (!messages) return null;
  return messages.find((message) => message.author?.id === channel.client?.user?.id && JSON.stringify(message.components || []).includes('Fishy Weather Forecast')) || null;
}

async function updateWeatherForecast(client) {
  const state = loadState();
  state.forecasts = state.forecasts && typeof state.forecasts === 'object' ? state.forecasts : {};
  const weather = syncCurrentWeather(state);
  const key = `${weather.location}:${weather.startedAt}:${weather.weather}`;
  const channel = await client.channels.fetch(FISHING_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) {
    saveState(state);
    return;
  }

  let message = state.forecasts.forecastMessageId ? await channel.messages.fetch(state.forecasts.forecastMessageId).catch(() => null) : null;
  if (!message) message = await findForecastMessage(channel);
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

function startWeatherTimer(client) {
  if (weatherTimerStarted) return;
  weatherTimerStarted = true;
  updateWeatherForecast(client).catch(() => null);
  setInterval(() => updateWeatherForecast(client).catch(() => null), WEATHER_TIMER_MS);
}

function isCaughtPayload(payload) {
  return JSON.stringify(payload || {}).includes('has been caught!');
}

function applyMutation(userId) {
  const state = loadState();
  const user = state.users?.[userId];
  if (!user || !Array.isArray(user.fishBarrel) || !user.fishBarrel.length) return null;
  const caught = user.fishBarrel[user.fishBarrel.length - 1];
  if (!caught || caught.mutation) return caught || null;
  const weatherName = attemptWeather.get(userId) || syncCurrentWeather(state).weather;
  const mutation = rollMutation(weatherName);
  caught.mutation = mutation?.name || null;
  caught.mutationEmoji = mutation?.emoji || null;
  caught.mutationMultiplier = mutation?.multiplier || 1;
  saveState(state);
  attemptWeather.delete(userId);
  return caught;
}

function patchCaughtPayload(payload, caught) {
  if (!caught || !payload || typeof payload !== 'object') return payload;
  const label = caught.mutation ? `${caught.mutation} ${caught.mutationEmoji || ''}`.trim() : 'None';
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.type === 10 && typeof value.content === 'string' && value.content.includes('has been caught!') && !value.content.includes('* Mutation:')) {
      value.content = value.content.replace('\n-# * Weigh:', `\n-# * Mutation: ${label}\n-# * Weigh:`);
    }
    if (Array.isArray(value.components)) value.components.forEach(visit);
  };
  visit(payload);
  return payload;
}

function patchInteraction(interaction) {
  return new Proxy(interaction, {
    get(target, prop, receiver) {
      if (['update', 'reply', 'editReply', 'followUp'].includes(prop) && typeof target[prop] === 'function') {
        return (payload, ...args) => {
          if (isCaughtPayload(payload)) payload = patchCaughtPayload(payload, applyMutation(target.user?.id));
          return target[prop](payload, ...args);
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function wrapFishCommand(command) {
  return {
    ...command,
    init: startWeatherTimer,
    async execute(interaction, client) {
      const state = loadState();
      syncCurrentWeather(state);
      saveState(state);
      return command.execute(patchInteraction(interaction), client);
    },
    async handleInteraction(interaction, client) {
      const id = interaction.customId || '';
      if (id.startsWith('fish:start:')) {
        const state = loadState();
        const weather = syncCurrentWeather(state);
        saveState(state);
        attemptWeather.set(interaction.user.id, weather.weather);
      }
      return command.handleInteraction(patchInteraction(interaction), client);
    },
  };
}

module.exports = {
  ...baseCommands,
  fishCommand: wrapFishCommand(baseCommands.fishCommand),
  fishBalanceCommand: baseCommands.fishBalanceCommand,
};
