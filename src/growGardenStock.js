const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { EmbedBuilder } = require('discord.js');
const { logCommandSystem } = require('./commandLogger');
const { getEnabledGuildIds, getGuildConfig } = require('./serverConfig');

const STATE_PATH = path.join(__dirname, '..', 'data', 'grow-garden-stock-state.json');
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 12 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TICK_INTERVAL_MS = 30 * 1000;
const CATEGORY_DEFINITIONS = [
  { key: 'seeds', label: 'Seed Stock', emoji: '🌱', aliases: ['seed_stock', 'seedStock', 'seeds', 'seed'] },
  { key: 'gear', label: 'Gear Stock', emoji: '⚙️', aliases: ['gear_stock', 'gearStock', 'gear', 'gears', 'tools'] },
  { key: 'eggs', label: 'Egg Stock', emoji: '🥚', aliases: ['egg_stock', 'eggStock', 'eggs', 'egg'] },
  { key: 'cosmetics', label: 'Cosmetic Stock', emoji: '✨', aliases: ['cosmetic_stock', 'cosmeticStock', 'cosmetics', 'cosmetic'] },
  { key: 'events', label: 'Event Stock', emoji: '🎉', aliases: ['eventshop_stock', 'event_stock', 'eventStock', 'events', 'event'] },
  { key: 'merchant', label: 'Traveling Merchant', emoji: '🛒', aliases: ['travelingmerchant_stock', 'merchant_stock', 'merchantStock', 'merchant'] },
];

let clientRef = null;
let timerRef = null;
let tickRunning = false;
const guildLocks = new Set();

function clamp(value, min, max, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function readRuntimeState() {
  try {
    const value = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8') || '{}');
    return value && typeof value === 'object' ? value : { guilds: {} };
  } catch {
    return { guilds: {} };
  }
}

function writeRuntimeState(state) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  fs.writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function updateRuntimeGuild(guildId, patch) {
  const state = readRuntimeState();
  state.guilds = state.guilds && typeof state.guilds === 'object' ? state.guilds : {};
  state.guilds[guildId] = { ...(state.guilds[guildId] || {}), ...patch };
  writeRuntimeState(state);
  return state.guilds[guildId];
}

function getRuntimeGuild(guildId) {
  return readRuntimeState().guilds?.[guildId] || {};
}

function getStockConfig(guildId) {
  const guildConfig = getGuildConfig(guildId);
  const stock = guildConfig?.growGardenStock || {};
  return {
    enabled: Boolean(stock.enabled),
    endpointUrl: String(stock.endpointUrl || process.env.GROW_GARDEN_2_STOCK_URL || '').trim(),
    pollIntervalMs: clamp(stock.pollIntervalMs, MIN_INTERVAL_MS, MAX_INTERVAL_MS, DEFAULT_INTERVAL_MS),
    updateMode: stock.updateMode === 'post' ? 'post' : 'edit',
    title: String(stock.title || 'Grow a Garden 2 Stock').trim().slice(0, 256) || 'Grow a Garden 2 Stock',
    channelId: String(guildConfig?.channels?.growGardenStock || '').trim(),
    pingRoleId: String(guildConfig?.roles?.growGardenStockPing || '').trim(),
  };
}

function isPrivateIpv4(hostname) {
  const parts = hostname.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

function isPrivateIpv6(hostname) {
  const clean = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  return clean === '::1'
    || clean === '::'
    || clean.startsWith('fc')
    || clean.startsWith('fd')
    || clean.startsWith('fe8')
    || clean.startsWith('fe9')
    || clean.startsWith('fea')
    || clean.startsWith('feb');
}

function assertSafeEndpointUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Stock endpoint must be a valid HTTPS URL.');
  }
  if (url.protocol !== 'https:') throw new Error('Stock endpoint must use HTTPS.');
  if (url.username || url.password) throw new Error('Stock endpoint cannot contain URL credentials.');
  if (url.toString().length > 1000) throw new Error('Stock endpoint URL is too long.');
  const hostname = url.hostname.toLowerCase();
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Stock endpoint must use a public hostname.');
  }
  const ipVersion = net.isIP(hostname.replace(/^\[|\]$/g, ''));
  if ((ipVersion === 4 && isPrivateIpv4(hostname)) || (ipVersion === 6 && isPrivateIpv6(hostname))) {
    throw new Error('Stock endpoint cannot use a private or loopback IP address.');
  }
  return url.toString();
}

function candidateRoots(payload) {
  const roots = [payload];
  for (const value of [payload?.data, payload?.result, payload?.stock, payload?.data?.stock, payload?.result?.stock]) {
    if (value && typeof value === 'object') roots.push(value);
  }
  return roots;
}

function findCategoryValue(payload, aliases) {
  for (const root of candidateRoots(payload)) {
    for (const alias of aliases) {
      if (root?.[alias] !== undefined && root?.[alias] !== null) return root[alias];
    }
  }
  return null;
}

function rawItems(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value.items)) return value.items;
  if (Array.isArray(value.stock)) return value.stock;
  return Object.entries(value).map(([name, item]) => {
    if (item && typeof item === 'object') return { __fallbackName: name, ...item };
    return { name, quantity: item };
  });
}

function normalizeQuantity(value) {
  if (value === undefined || value === null || value === '') return '1';
  const text = String(value).trim().replace(/^x\s*/i, '');
  return text || '1';
}

function quantityIsAvailable(value) {
  const numeric = Number(String(value).replace(/,/g, ''));
  return !Number.isFinite(numeric) || numeric > 0;
}

function normalizeItem(value, fallbackName = '') {
  if (typeof value === 'string') return { name: value.trim(), quantity: '1', icon: '' };
  if (!value || typeof value !== 'object') return null;
  const name = String(
    value.display_name
      || value.displayName
      || value.item_name
      || value.itemName
      || value.name
      || value.__fallbackName
      || fallbackName
      || value.item_id
      || value.id
      || '',
  ).trim();
  if (!name) return null;
  const quantity = normalizeQuantity(value.quantity ?? value.stock ?? value.count ?? value.amount ?? value.value);
  if (!quantityIsAvailable(quantity)) return null;
  return {
    name: name.slice(0, 120),
    quantity: quantity.slice(0, 40),
    icon: String(value.icon || value.icon_url || value.iconUrl || value.image || '').trim().slice(0, 1000),
  };
}

function humanizeCategory(key) {
  return String(key || 'Stock')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function extractUpdatedAt(payload, categories) {
  const candidates = [
    payload?.updatedAt,
    payload?.updated_at,
    payload?.timestamp,
    payload?.data?.updatedAt,
    payload?.data?.updated_at,
    ...categories.flatMap((category) => category.rawItems || []).map((item) => item?.start_date_unix || item?.startDateUnix || item?.updated_at),
  ];
  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'number' || /^\d+$/.test(String(value))) {
      const numeric = Number(value);
      const milliseconds = numeric > 10_000_000_000 ? numeric : numeric * 1000;
      if (Number.isFinite(milliseconds) && milliseconds > 0) return milliseconds;
    }
    const parsed = Date.parse(String(value));
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function normalizeStockPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Stock provider returned an invalid JSON object.');
  const categories = [];
  const usedKeys = new Set();
  for (const definition of CATEGORY_DEFINITIONS) {
    const value = findCategoryValue(payload, definition.aliases);
    if (value === null) continue;
    const raw = rawItems(value);
    const items = raw.map((item) => normalizeItem(item)).filter(Boolean);
    categories.push({
      key: definition.key,
      label: definition.label,
      emoji: definition.emoji,
      items,
      rawItems: raw,
    });
    definition.aliases.forEach((alias) => usedKeys.add(alias));
  }

  const categoryObject = payload.categories || payload.data?.categories;
  if (categoryObject && typeof categoryObject === 'object' && !Array.isArray(categoryObject)) {
    for (const [key, value] of Object.entries(categoryObject)) {
      if (usedKeys.has(key) || categories.some((category) => category.key === key)) continue;
      const raw = rawItems(value);
      const items = raw.map((item) => normalizeItem(item)).filter(Boolean);
      categories.push({ key, label: humanizeCategory(key), emoji: '📦', items, rawItems: raw });
    }
  }

  const visible = categories.filter((category) => category.items.length > 0);
  if (visible.length === 0) throw new Error('Stock provider returned no available items in a supported stock category.');
  const updatedAt = extractUpdatedAt(payload, categories);
  return {
    updatedAt,
    categories: visible.map(({ rawItems: ignored, ...category }) => category),
  };
}

function stockSignature(stock) {
  const stable = stock.categories.map((category) => ({
    key: category.key,
    items: category.items.map((item) => ({ name: item.name, quantity: item.quantity })),
  }));
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function chunkLines(lines, maxLength = 1000) {
  const chunks = [];
  let current = '';
  for (const sourceLine of lines) {
    const line = sourceLine.length > maxLength ? `${sourceLine.slice(0, maxLength - 3)}...` : sourceLine;
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function buildStockPayload(stock, config, options = {}) {
  const timestamp = Math.floor(stock.updatedAt / 1000);
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle(config.title || 'Grow a Garden 2 Stock')
    .setDescription(`Current shop availability. Provider update: <t:${timestamp}:R>.`)
    .setTimestamp(new Date(stock.updatedAt))
    .setFooter({ text: `Auto-refresh every ${Math.round(config.pollIntervalMs / 60000)} minute(s)` });

  let fieldCount = 0;
  for (const category of stock.categories) {
    const lines = category.items.map((item) => `**x${item.quantity}** ${item.name}`);
    const chunks = chunkLines(lines);
    for (let index = 0; index < chunks.length && fieldCount < 24; index += 1) {
      embed.addFields({
        name: `${category.emoji} ${category.label}${index ? ` (${index + 1})` : ''}`,
        value: chunks[index],
        inline: false,
      });
      fieldCount += 1;
    }
  }

  if (fieldCount === 24) embed.addFields({ name: 'More stock', value: 'Additional items were omitted to stay within Discord message limits.' });
  const shouldPing = Boolean(options.ping && /^\d{16,20}$/.test(config.pingRoleId));
  return {
    content: shouldPing ? `<@&${config.pingRoleId}> Stock updated.` : undefined,
    embeds: [embed],
    allowedMentions: { parse: [], roles: shouldPing ? [config.pingRoleId] : [] },
  };
}

async function fetchStockSnapshot(guildId) {
  const config = getStockConfig(guildId);
  const endpointUrl = assertSafeEndpointUrl(config.endpointUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const headers = {
    Accept: 'application/json',
    'User-Agent': 'CoinSprite-GrowGarden2-Stock/1.0',
  };
  const apiKey = String(process.env.GROW_GARDEN_2_STOCK_API_KEY || '').trim();
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
    headers['jstudio-key'] = apiKey;
  }

  try {
    const response = await fetch(endpointUrl, { headers, signal: controller.signal, redirect: 'error' });
    if (!response.ok) throw new Error(`Stock provider responded with HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) throw new Error('Stock provider response is too large.');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) throw new Error('Stock provider response is too large.');
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('Stock provider did not return valid JSON.');
    }
    return { config, stock: normalizeStockPayload(payload), endpointUrl };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Stock provider timed out.');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveStockChannel(guild, config) {
  if (!config.channelId) return null;
  const channel = guild.channels.cache.get(config.channelId) || await guild.channels.fetch(config.channelId).catch(() => null);
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return null;
  return channel;
}

async function editOrSendLiveMessage(channel, payload, runtime) {
  const existing = runtime.lastMessageId ? await channel.messages.fetch(runtime.lastMessageId).catch(() => null) : null;
  if (existing?.editable) {
    await existing.edit({ ...payload, content: undefined });
    return existing;
  }
  return channel.send({ ...payload, content: undefined });
}

async function publishGuildStock(guild, options = {}) {
  if (!guild?.id) throw new Error('Guild is required.');
  if (guildLocks.has(guild.id)) return { skipped: true, reason: 'busy' };
  guildLocks.add(guild.id);
  try {
    const { config, stock } = await fetchStockSnapshot(guild.id);
    if (!config.enabled && !options.allowDisabled) throw new Error('Grow a Garden 2 stock updates are disabled.');
    const channel = await resolveStockChannel(guild, config);
    if (!channel) throw new Error('The configured stock channel is missing or not text-based.');
    const signature = stockSignature(stock);
    const runtime = getRuntimeGuild(guild.id);
    const changed = signature !== runtime.signature;
    if (!changed && !options.force) {
      updateRuntimeGuild(guild.id, { lastCheckedAt: Date.now(), lastError: '' });
      return { changed: false, stock, channel };
    }

    const payload = buildStockPayload(stock, config, { ping: changed });
    let message;
    if (config.updateMode === 'post') {
      message = await channel.send(payload);
    } else {
      message = await editOrSendLiveMessage(channel, payload, runtime);
      if (changed && payload.content) {
        await channel.send({ content: payload.content, allowedMentions: payload.allowedMentions }).catch(() => null);
      }
    }
    updateRuntimeGuild(guild.id, {
      signature,
      lastMessageId: message.id,
      lastCheckedAt: Date.now(),
      lastPostedAt: Date.now(),
      lastProviderUpdateAt: stock.updatedAt,
      lastError: '',
    });
    return { changed, stock, channel, message };
  } catch (error) {
    updateRuntimeGuild(guild.id, { lastCheckedAt: Date.now(), lastError: error?.message || 'Unknown stock error' });
    throw error;
  } finally {
    guildLocks.delete(guild.id);
  }
}

async function tick() {
  if (!clientRef || tickRunning) return;
  tickRunning = true;
  try {
    for (const guildId of getEnabledGuildIds()) {
      const config = getStockConfig(guildId);
      if (!config.enabled || !config.endpointUrl || !config.channelId) continue;
      const runtime = getRuntimeGuild(guildId);
      if (Date.now() - Number(runtime.lastCheckedAt || 0) < config.pollIntervalMs) continue;
      const guild = clientRef.guilds.cache.get(guildId) || await clientRef.guilds.fetch(guildId).catch(() => null);
      if (!guild) continue;
      try {
        await publishGuildStock(guild);
      } catch (error) {
        logCommandSystem(`Grow a Garden 2 stock update failed for guild ${guildId}: ${error?.message || 'unknown error'}`);
      }
    }
  } finally {
    tickRunning = false;
  }
}

function init(client) {
  clientRef = client;
  if (timerRef) return;
  setTimeout(() => tick().catch(() => null), 5000);
  timerRef = setInterval(() => tick().catch(() => null), TICK_INTERVAL_MS);
}

module.exports = {
  DEFAULT_INTERVAL_MS,
  MAX_INTERVAL_MS,
  MIN_INTERVAL_MS,
  assertSafeEndpointUrl,
  buildStockPayload,
  fetchStockSnapshot,
  getRuntimeGuild,
  getStockConfig,
  init,
  normalizeStockPayload,
  publishGuildStock,
  stockSignature,
};
