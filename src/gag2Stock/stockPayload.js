const {
  CATEGORY_LABELS,
  COMPONENTS_V2_FLAG,
  FALL_ORANGE,
  GREEN,
  RED,
} = require('./config');
const {
  FALL_CRATE_ITEMS,
  FALL_GEAR_ITEMS,
  FALL_SEED_ITEMS,
  FALL_SELL_ITEMS,
  FALL_SELL_ONLY_SEED_KEYS,
  SELL_BONUS_COLORS,
  catalogEntry,
  colorForType,
  customEmojiImageUrl,
  displayNameForType,
  emojiForType,
  fallRoleTypeForStock,
  highestRarityColor,
  normalizeKey,
  roleKeyForType,
  roleSpecsForType,
  sellBonusRoleForEntry,
  sellMultiplierBucket,
  sortItemsForType,
} = require('./catalog');

const NO_MENTIONS = { parse: [], roles: [], users: [] };
const WHITE = 0xFFFFFF;
const HIDDEN_SELL_KEYS = new Set(['briar_rose']);
const SELL_ONLY_SEED_KEYS = new Set(['eclipse_bloom']);
const STOCK_RESTOCK_INTERVAL_MS = 5 * 60 * 1000;
const MAX_COMPONENT_DISPLAY_TEXT = 3_900;
const FALL_CONFIG_DASHBOARD_URL = 'https://panel.coin-sprite.com/';
const FALL_ONLY_KEYS = Object.freeze({
  seed: new Set(FALL_SELL_ITEMS.filter((item) => !catalogEntry('seed', item.key)).map((item) => item.key)),
  gear: new Set(FALL_GEAR_ITEMS.filter((item) => !catalogEntry('gear', item.key)).map((item) => item.key)),
  crate: new Set(FALL_CRATE_ITEMS.filter((item) => !catalogEntry('crate', item.key)).map((item) => item.key)),
  sell: new Set(FALL_SELL_ITEMS.filter((item) => !catalogEntry('sell', item.key)).map((item) => item.key)),
});
const FALL_WORLD_KEYS = Object.freeze({
  seed: new Set(FALL_SEED_ITEMS.map((item) => item.key)),
  gear: new Set(FALL_GEAR_ITEMS.map((item) => item.key)),
  crate: new Set(FALL_CRATE_ITEMS.map((item) => item.key)),
  sell: new Set(FALL_SELL_ITEMS.map((item) => item.key)),
});

function parseDateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoundaryMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return parseDateMs(value);
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function nextCycleRestockAtMs(nextRestockAtMs, restockedAtMs, nowMs = null) {
  const restockedAt = Number(restockedAtMs);
  let nextAt = Number(nextRestockAtMs);
  if (Number.isFinite(restockedAt) && (!Number.isFinite(nextAt) || nextAt <= restockedAt)) {
    nextAt = restockedAt + STOCK_RESTOCK_INTERVAL_MS;
  }
  const now = Number(nowMs);
  if (Number.isFinite(now) && (!Number.isFinite(nextAt) || nextAt <= now)) {
    nextAt = (Math.floor(now / STOCK_RESTOCK_INTERVAL_MS) + 1) * STOCK_RESTOCK_INTERVAL_MS;
  }
  return Number.isFinite(nextAt) ? nextAt : null;
}

function slugKey(value) {
  return normalizeKey(value);
}

function normalizeItem(item) {
  return {
    emoji: String(item?.emoji || '').trim(),
    key: slugKey(item?.key || item?.id || item?.slug || item?.name),
    name: String(item?.name || 'Unknown Item').trim(),
    quantity: Math.max(0, Math.floor(Number(item?.quantity) || 0)),
    rarity: String(item?.rarity || 'Unknown').trim(),
    type: String(item?.type || '').trim().toLowerCase(),
  };
}

function normalizeCategory(entry, options = {}) {
  const category = String(entry?.category || '').trim().toLowerCase();
  const catalogType = options.catalogType || category;
  const world = String(options.world || entry?.world || 'main').trim().toLowerCase();
  const items = sortItemsForType(catalogType, (Array.isArray(entry?.items) ? entry.items : [])
    .map(normalizeItem)
    .filter((item) => item.name && item.quantity > 0)
    .filter((item) => category !== 'seed' || !SELL_ONLY_SEED_KEYS.has(item.key))
    .filter((item) => category !== 'seed' || !FALL_SELL_ONLY_SEED_KEYS.has(item.key))
    .filter((item) => world !== 'fall' || FALL_WORLD_KEYS[category]?.has(item.key))
    .filter((item) => world === 'fall' || !FALL_ONLY_KEYS[category]?.has(item.key)));

  const restockedAtMs = parseDateMs(entry?.restockedAt);
  const nextRestockAtMs = nextCycleRestockAtMs(parseDateMs(entry?.nextRestockAt), restockedAtMs);
  return {
    type: category,
    category,
    label: CATEGORY_LABELS[category] || category || 'Stock',
    items,
    nextRestockAtMs,
    restockedAtMs,
    world,
  };
}

function parseRestockPayload(payload, options = {}) {
  const world = String(options.world || payload?.world || 'main').trim().toLowerCase();
  const windowMs = parseBoundaryMs(payload?.window);
  const nextRestockAtMs = nextCycleRestockAtMs(
    parseBoundaryMs(payload?.nextRestock ?? payload?.nextRefresh),
    windowMs,
  );
  const sources = [
    ['seed', payload?.seeds],
    ['gear', payload?.gears],
    ['crate', payload?.props ?? payload?.crates],
  ];
  if (!sources.some(([, items]) => Array.isArray(items))) throw new Error('missing GAG2 restock lists');

  const stock = sources.map(([category, sourceItems]) => {
    const items = (Array.isArray(sourceItems) ? sourceItems : [])
      .map((entry) => {
        const lastStockedAtMs = parseBoundaryMs(entry?.lastStockedAt);
        const inStockNow = entry?.inStockNow === true
          || (Number.isFinite(windowMs) && Number.isFinite(lastStockedAtMs) && lastStockedAtMs >= windowMs);
        if (!inStockNow) return null;
        return {
          key: entry?.key || entry?.id || entry?.slug || entry?.name,
          name: entry?.name,
          quantity: entry?.lastQty ?? entry?.quantity ?? 0,
          rarity: entry?.rarity,
          type: category,
        };
      })
      .filter(Boolean);
    return normalizeCategory({
      category,
      items,
      nextRestockAt: Number.isFinite(nextRestockAtMs) ? new Date(nextRestockAtMs).toISOString() : null,
      restockedAt: Number.isFinite(windowMs) ? new Date(windowMs).toISOString() : null,
      world,
    }, {
      catalogType: world === 'fall' ? fallRoleTypeForStock(category) : category,
      world,
    });
  });

  return {
    fetchedAtMs: parseDateMs(payload?.fetchedAt) || Date.now(),
    world,
    windowMs,
    stock,
  };
}

function parseStockPayload(payload, options = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid GAG2 stock payload');
  if (!Array.isArray(payload.stock)) return parseRestockPayload(payload, options);

  const stock = payload.stock
    .map((entry) => normalizeCategory(entry, options))
    .filter((entry) => entry.category);
  if (!stock.length) throw new Error('empty GAG2 stock list');

  return {
    fetchedAtMs: parseDateMs(payload.fetchedAt) || Date.now(),
    world: String(options.world || payload?.world || 'main').trim().toLowerCase(),
    stock,
  };
}

function normalizeWeatherEvent(event) {
  if (!event || typeof event !== 'object') return null;
  return {
    key: slugKey(event.key || event.type || event.name),
    type: String(event.type || event.key || '').trim(),
    name: String(event.name || event.type || 'Unknown weather').trim(),
    emoji: String(event.emoji || '').trim(),
    color: String(event.color || '').trim(),
    blurb: String(event.blurb || '').trim(),
    boost: event.boost ?? null,
    startsAtMs: parseDateMs(event.startsAt),
    endsAtMs: parseDateMs(event.endsAt),
    lastSeenAtMs: parseDateMs(event.lastSeenAt),
  };
}

function parseWeatherPayload(payload) {
  const source = payload?.weather || payload;
  if (!source || typeof source !== 'object') throw new Error('invalid GAG2 weather payload');
  const current = normalizeWeatherEvent(source.current);
  const upcomingMoons = (Array.isArray(source.upcomingMoons) ? source.upcomingMoons : [])
    .map((entry) => ({
      key: slugKey(entry?.key || entry?.name),
      name: String(entry?.name || 'Unknown moon').trim(),
      boundaryMs: parseBoundaryMs(entry?.boundary),
    }))
    .filter((entry) => entry.name && Number.isFinite(entry.boundaryMs))
    .sort((left, right) => left.boundaryMs - right.boundaryMs);
  const recent = (Array.isArray(source.recent) ? source.recent : [])
    .map(normalizeWeatherEvent)
    .filter(Boolean)
    .sort((left, right) => (right.lastSeenAtMs || 0) - (left.lastSeenAtMs || 0));

  return {
    fetchedAtMs: parseDateMs(payload?.fetchedAt) || Date.now(),
    current,
    upcomingMoons,
    recent,
  };
}

function parseSellPayload(payload, options = {}) {
  const source = payload?.sell && typeof payload.sell === 'object' ? payload.sell : payload;
  const entries = source?.entries;
  if (!Array.isArray(entries)) throw new Error('missing GAG2 sell price list');
  const world = String(options.world || source?.world || payload?.world || 'main').trim().toLowerCase();
  const normalized = entries
    .map((entry) => ({
      key: slugKey(entry?.key || entry?.id || entry?.slug || entry?.name),
      name: String(entry?.name || 'Unknown item').trim(),
      multiplier: Number(entry?.multiplier),
      rarity: String(entry?.rarity || '').trim(),
      tier: String(entry?.tier || '').trim(),
    }))
    .filter((entry) => entry.name && Number.isFinite(entry.multiplier) && !HIDDEN_SELL_KEYS.has(entry.key))
    .filter((entry) => world !== 'fall' || FALL_WORLD_KEYS.sell.has(entry.key))
    .filter((entry) => world === 'fall' || !FALL_ONLY_KEYS.sell.has(entry.key));
  if (!normalized.length) throw new Error('empty GAG2 sell price list');
  return {
    fetchedAtMs: parseDateMs(source?.fetchedAt) || parseDateMs(payload?.fetchedAt) || Date.now(),
    nextRefreshAtMs: parseBoundaryMs(source?.nextRefreshUnix ?? source?.nextRefreshAt ?? source?.nextRefresh ?? payload?.nextRefreshUnix ?? payload?.nextRefreshAt ?? payload?.nextRefresh),
    windowMs: parseBoundaryMs(source?.window ?? payload?.window),
    world,
    entries: sortItemsForType(world === 'fall' ? 'fallSell' : 'sell', normalized),
  };
}

function parseItemsPayload(payload) {
  const items = payload?.items || payload;
  if (!Array.isArray(items)) throw new Error('missing GAG2 item list');
  return items
    .map((item) => ({
      key: slugKey(item?.id || item?.key || item?.slug || item?.name),
      name: String(item?.name || '').trim(),
      type: String(item?.type || '').trim().toLowerCase(),
      rarity: String(item?.rarity || '').trim(),
    }))
    .filter((item) => item.key && item.name);
}

function buildStockCategoryKey(entry) {
  const cycleAtMs = Number.isFinite(Number(entry.deliveryCycleAtMs))
    ? Number(entry.deliveryCycleAtMs)
    : Number(entry.restockedAtMs);
  return [
    entry.category,
    Number.isFinite(cycleAtMs) ? Math.floor(cycleAtMs / 1000) : 'unknown-cycle',
    entry.items.map((item) => `${item.key}:${item.quantity}`).join(','),
  ].join(':');
}

function buildPostKey(stockPayload) {
  return stockPayload.stock.map(buildStockCategoryKey).join('|');
}

function buildTypePostKey(type, entry) {
  if (!entry) return `${type}:empty`;
  let key = '';
  if (['seed', 'gear', 'crate'].includes(type)) key = buildStockCategoryKey(entry);
  if (type === 'weather') {
    const current = entry.current || {};
    key = `weather:${current.key || 'none'}`;
  }
  if (type === 'moon') {
    key = `moon:${(entry.upcomingMoons || []).slice(0, 12).map((item) => `${item.key}:${item.boundaryMs}`).join(',')}`;
  }
  if (type === 'sell') {
    key = `sell:${(entry.entries || []).map((item) => `${item.key}:${item.multiplier.toFixed(4)}`).join(',')}`;
  }
  if (!key) key = `${type}:${JSON.stringify(entry).slice(0, 500)}`;
  if (!entry.fall) return key;
  const fallKey = type === 'sell'
    ? (entry.fall.entries || []).map((item) => `${item.key}:${item.multiplier.toFixed(4)}`).join(',')
    : (entry.fall.items || []).map((item) => `${item.key}:${item.quantity}`).join(',');
  return `${key}|fall:${fallKey}`;
}

function formatTimestamp(ms, style = 'R') {
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'unknown';
}

function displayableTextSize(component) {
  if (!component || typeof component !== 'object') return 0;
  const own = typeof component.content === 'string' ? component.content.length : 0;
  return own + (Array.isArray(component.components)
    ? component.components.reduce((total, child) => total + displayableTextSize(child), 0)
    : 0);
}

function fallConfigButtonRow() {
  return {
    type: 1,
    components: [{
      type: 2,
      style: 5,
      label: 'Config Fall Harvest stock notify! [NEW]',
      emoji: { name: '\u{1F342}' },
      url: FALL_CONFIG_DASHBOARD_URL,
    }],
  };
}

function splitTextDisplay(component, maxText) {
  const lines = String(component.content || '').split('\n');
  const chunks = [];
  let current = [];
  let size = 0;
  for (const line of lines) {
    const pieces = line.length <= maxText
      ? [line]
      : line.match(new RegExp(`.{1,${maxText}}`, 'g')) || [''];
    for (const piece of pieces) {
      const added = piece.length + (current.length ? 1 : 0);
      if (current.length && size + added > maxText) {
        chunks.push({ ...component, content: current.join('\n') });
        current = [];
        size = 0;
      }
      current.push(piece);
      size += piece.length + (current.length > 1 ? 1 : 0);
    }
  }
  if (current.length) chunks.push({ ...component, content: current.join('\n') });
  return chunks;
}

function splitDisplayComponent(component, maxText) {
  if (displayableTextSize(component) <= maxText) return [component];
  if (component.type === 10 && typeof component.content === 'string') {
    return splitTextDisplay(component, maxText);
  }
  if (!Array.isArray(component.components)) return [component];
  const children = component.components.flatMap((child) => splitDisplayComponent(child, maxText));
  const groups = [];
  let current = [];
  let size = 0;
  for (const child of children) {
    const childSize = displayableTextSize(child);
    if (current.length && size + childSize > maxText) {
      while (current[0]?.type === 14) current.shift();
      while (current.at(-1)?.type === 14) current.pop();
      if (current.length) groups.push({ ...component, components: current });
      current = [];
      size = 0;
    }
    current.push(child);
    size += childSize;
  }
  while (current[0]?.type === 14) current.shift();
  while (current.at(-1)?.type === 14) current.pop();
  if (current.length) groups.push({ ...component, components: current });
  return groups;
}

function splitPayloadByDisplayText(payload, maxText = MAX_COMPONENT_DISPLAY_TEXT) {
  const limit = Math.max(100, Math.min(4_000, Number(maxText) || MAX_COMPONENT_DISPLAY_TEXT));
  const components = (payload.components || []).flatMap((component) => splitDisplayComponent(component, limit));
  const payloads = [];
  let current = [];
  let size = 0;
  for (const component of components) {
    const componentSize = displayableTextSize(component);
    if (current.length && size + componentSize > limit) {
      payloads.push({ ...payload, components: current });
      current = [];
      size = 0;
    }
    current.push(component);
    size += componentSize;
  }
  if (current.length || !payloads.length) payloads.push({ ...payload, components: current });
  return payloads;
}

function roleIdForItem(roleIds, item, type = '') {
  const catalogKey = roleKeyForType(type || item?.type || '', item);
  return roleIds?.[catalogKey] || roleIds?.[item?.key] || roleIds?.[slugKey(item?.name)];
}

function supportedRoleIdsForType(type, roleIds = {}) {
  const supportedKeys = new Set(roleSpecsForType(type).map((spec) => spec.key));
  return Object.fromEntries(Object.entries(roleIds)
    .filter(([key]) => supportedKeys.has(key)));
}

function roleMention(roleIds, item, type = '') {
  const roleId = roleIdForItem(roleIds, item, type);
  return roleId ? ` <@&${roleId}>` : '';
}

function roleDisplay(roleIds, item, type = '') {
  const mention = roleMention(roleIds, item, type).trim();
  return mention || `**${displayNameForType(type || item?.type || '', item)}**`;
}

function allowedMentionsForRoles(roleIds = {}) {
  return {
    parse: [],
    users: [],
    roles: [...new Set(Object.values(roleIds).map((roleId) => String(roleId || '').trim()).filter((roleId) => /^\d{16,20}$/.test(roleId)))],
  };
}

function emojiPrefix(type, item) {
  const emoji = emojiForType(type, item);
  return emoji ? `${emoji} ` : '';
}

function formatItem(type, item, roleIds = {}) {
  return `* ${emojiPrefix(type, item)}${roleDisplay(roleIds, item, type)} x${item.quantity}`;
}

function formatStockCategoryHeader(entry) {
  const nextRestockAtMs = nextCycleRestockAtMs(entry.nextRestockAtMs, entry.restockedAtMs, Date.now());
  return [
    `## GAG2 ${entry.label}`,
    `-# Restock ${formatTimestamp(nextRestockAtMs)}`,
    '-# **🌿GARDEN VALLEY🌻**',
  ].join('\n');
}

function formatStockCategoryItems(entry, roleIds = {}, catalogType = entry.category) {
  return entry.items.length
    ? entry.items.map((item) => formatItem(catalogType, item, roleIds)).join('\n')
    : '* Nothing listed right now.';
}

function formatStockCategory(entry, roleIds = {}) {
  return [
    formatStockCategoryHeader(entry),
    formatStockCategoryItems(entry, roleIds),
  ].join('\n');
}

function stockCategoryComponents(entry, roleIds = {}, fallRoleIds = {}) {
  const components = [
    { type: 10, content: formatStockCategoryHeader(entry) },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: formatStockCategoryItems(entry, roleIds) },
  ];
  if (entry?.fall) {
    const fallType = fallRoleTypeForStock(entry.category);
    components.push(
      { type: 14, divider: true, spacing: 1 },
      {
        type: 10,
        content: [
          '-# **🍂FALL HARVEST🍁**',
          formatStockCategoryItems(entry.fall, fallRoleIds, fallType),
        ].join('\n'),
      },
    );
  }
  return components;
}

function formatWeather(entry, roleIds = {}) {
  const current = entry.current;
  if (!current) {
    return '## GAG2 Weather\n* No current weather listed right now.';
  }
  const lines = [
    '## GAG2 Weather',
    `* Current: ${emojiPrefix('weather', current)}${roleDisplay(roleIds, current, 'weather')}`,
  ];
  if (current.endsAtMs) lines.push(`* Ends: ${formatTimestamp(current.endsAtMs)}`);
  if (current.blurb) lines.push('', current.blurb);
  if (entry.recent?.length) {
    lines.push('', '### Recent');
    for (const item of entry.recent.slice(0, 8)) {
      lines.push(`* ${emojiPrefix('weather', item)}**${displayNameForType('weather', item)}**${item.lastSeenAtMs ? ` - ${formatTimestamp(item.lastSeenAtMs)}` : ''}`);
    }
  }
  return lines.join('\n');
}

function formatMoon(entry, roleIds = {}) {
  const lines = ['## GAG2 Moon Prediction'];
  if (!entry.upcomingMoons?.length) {
    lines.push('* No moon predictions listed right now.');
    return lines.join('\n');
  }
  for (const item of entry.upcomingMoons.slice(0, 12)) {
    lines.push(`* ${emojiPrefix('moon', item)}${roleDisplay(roleIds, item, 'moon')} - ${formatTimestamp(item.boundaryMs, 'F')} (${formatTimestamp(item.boundaryMs)})`);
  }
  return lines.join('\n');
}

function formatMultiplier(multiplier) {
  const value = Number(multiplier);
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatSellLine(item, roleIds = {}, options = {}) {
  const prefix = options.heading ? '## ' : '* ';
  const type = options.type || 'sell';
  const display = options.itemRoles
    ? roleDisplay(roleIds, item, type)
    : `**${displayNameForType(type, item)}**`;
  return `${prefix}${emojiPrefix(type, item)}${display} x${formatMultiplier(item.multiplier)}`;
}

function formatSell(entry, roleIds = {}) {
  const lines = [
    '## GAG2 Sell Price Track',
    `-# Refresh ${formatTimestamp(entry.nextRefreshAtMs)}`,
    '-# **\u{1F33F}GARDEN VALLEY\u{1F33B}**',
  ];
  const normalEntries = (entry.entries || []).filter((item) => !sellMultiplierBucket(item.multiplier));
  for (const item of normalEntries) {
    lines.push(formatSellLine(item, roleIds));
  }
  if (!normalEntries.length) lines.push('* No normal sell price entries listed right now.');
  return lines.join('\n');
}

function contentForType(type, entry, roleIds = {}) {
  if (['seed', 'gear', 'crate'].includes(type)) return formatStockCategory(entry, roleIds);
  if (type === 'weather') return formatWeather(entry, roleIds);
  if (type === 'moon') return formatMoon(entry, roleIds);
  if (type === 'sell') return formatSell(entry, roleIds);
  return `## GAG2 Stock\n* Unknown stock type: ${type}`;
}

function textComponentForType(type, entry, roleIds = {}) {
  const content = contentForType(type, entry, roleIds);
  if (type !== 'weather') return { type: 10, content };
  const thumbnailUrl = customEmojiImageUrl(emojiForType('weather', entry?.current));
  if (!thumbnailUrl) return { type: 10, content };
  return {
    type: 9,
    components: [{ type: 10, content }],
    accessory: { type: 11, media: { url: thumbnailUrl } },
  };
}

function componentsForType(type, entry, roleIds = {}) {
  if (['seed', 'gear', 'crate'].includes(type)) return stockCategoryComponents(entry, roleIds);
  return [textComponentForType(type, entry, roleIds)];
}

function accentColorForType(type, entry) {
  if (['seed', 'gear', 'crate'].includes(type)) return highestRarityColor(type, entry?.items || [], GREEN);
  if (type === 'weather') return colorForType('weather', entry?.current) || GREEN;
  if (type === 'moon') return colorForType('moon', entry?.upcomingMoons?.[0]) || GREEN;
  if (type === 'sell') {
    return WHITE;
  }
  return GREEN;
}

function bonusRoleDisplayForSellItem(roleIds, item, type = 'sell') {
  const bonusRole = sellBonusRoleForEntry(item, type);
  if (!bonusRole) return '';
  return roleMention(roleIds, bonusRole, 'sell').trim() || bonusRole.roleName;
}

function sellBonusContainers(entry, roleIds = {}, type = 'sell') {
  const entries = (entry?.entries || []).filter((item) => sellMultiplierBucket(item.multiplier));
  const buckets = ['4x', '2x'].filter((bucket) => entries.some((item) => sellMultiplierBucket(item.multiplier) === bucket));
  return buckets.map((bucket) => {
    const bucketEntries = entries.filter((item) => sellMultiplierBucket(item.multiplier) === bucket);
    const bonusRoles = [...new Set(bucketEntries.map((item) => bonusRoleDisplayForSellItem(roleIds, item, type)).filter(Boolean))];
    const title = `## ${bonusRoles.length ? bonusRoles.join(' ') : bucket} Sell Price`;
    const lines = bucketEntries.map((item) => formatSellLine(item, roleIds, { type }));
    return {
      type: 17,
      accent_color: SELL_BONUS_COLORS[bucket],
      components: [{ type: 10, content: [title, ...lines].join('\n') }],
    };
  });
}

function fallSellContainers(entry, roleIds = {}) {
  if (!entry?.entries?.length) return [];
  const eventHeader = ['-# **\u{1F342}FALL HARVEST\u{1F341}**'];
  const bonusContainers = sellBonusContainers(entry, roleIds, 'fallSell').map((container) => ({
    ...container,
    components: container.components.map((component) => ({
      ...component,
      content: [...eventHeader, component.content].join('\n'),
    })),
  }));
  const normalEntries = entry.entries.filter((item) => !sellMultiplierBucket(item.multiplier));
  if (!normalEntries.length) return bonusContainers;
  return [...bonusContainers, {
    type: 17,
    accent_color: FALL_ORANGE,
    components: [{
      type: 10,
      content: [
        '-# **🍂FALL HARVEST🍁**',
        ...normalEntries.map((item) => formatSellLine(item, {}, { type: 'fallSell' })),
      ].join('\n'),
    }],
  }];
}

function buildTypePayload(type, entry, options = {}) {
  const roleIds = supportedRoleIdsForType(type, options.roleIds || {});
  const fallType = fallRoleTypeForStock(type);
  const fallRoleIds = fallType ? supportedRoleIdsForType(fallType, options.fallRoleIds || {}) : {};
  const bonusContainers = type === 'sell' ? sellBonusContainers(entry, roleIds) : [];
  const includeMainContainer = type !== 'sell'
    || !Array.isArray(entry?.enabledMultipliers)
    || entry.enabledMultipliers.includes('normal');
  const mainContainer = {
    type: 17,
    accent_color: accentColorForType(type, entry),
    components: ['seed', 'gear', 'crate'].includes(type)
      ? stockCategoryComponents(entry, roleIds, fallRoleIds)
      : componentsForType(type, entry, roleIds),
  };
  const eventContainers = type === 'sell' ? fallSellContainers(entry?.fall, roleIds) : [];
  return {
    allowedMentions: type === 'moon'
      ? NO_MENTIONS
      : allowedMentionsForRoles(type === 'sell' ? roleIds : { ...roleIds, ...fallRoleIds }),
    flags: COMPONENTS_V2_FLAG,
    components: [
      ...bonusContainers,
      ...(includeMainContainer || !bonusContainers.length ? [mainContainer] : []),
      ...eventContainers,
      fallConfigButtonRow(),
    ],
  };
}

function buildTypePayloads(type, entry, options = {}) {
  return splitPayloadByDisplayText(buildTypePayload(type, entry, options));
}

function buildStockPayload(stockPayload, options = {}) {
  const roleIdsByType = Object.fromEntries((stockPayload.stock || []).map((entry) => [
    entry.category,
    supportedRoleIdsForType(entry.category, options.roleIds?.[entry.category] || {}),
  ]));
  const combinedRoleIds = Object.assign({}, ...Object.values(roleIdsByType));
  const components = [];
  for (const entry of stockPayload.stock) {
    if (components.length) components.push({ type: 14, divider: true, spacing: 1 });
    components.push(...stockCategoryComponents(entry, roleIdsByType[entry.category] || {}));
  }
  return {
    allowedMentions: allowedMentionsForRoles(combinedRoleIds),
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: GREEN,
        components,
      },
      fallConfigButtonRow(),
    ],
  };
}

function buildUnavailablePayload(typeOrError, errorOrNow, maybeNow) {
  const hasType = typeof maybeNow !== 'undefined';
  const type = hasType ? typeOrError : 'stock';
  const errorMessage = hasType ? errorOrNow : typeOrError;
  const nowMs = hasType ? maybeNow : errorOrNow || Date.now();
  const label = CATEGORY_LABELS[type] || 'Stock';
  return {
    allowedMentions: NO_MENTIONS,
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: RED,
        components: [
          {
            type: 10,
            content: [
              `## GAG2 ${label}`,
              '* Status: **source unavailable**',
              `* Checked: ${formatTimestamp(nowMs, 'F')}`,
              '',
              `-# ${String(errorMessage || 'Unknown error').slice(0, 500)}`,
            ].join('\n'),
          },
        ],
      },
    ],
  };
}

module.exports = {
  buildPostKey,
  buildStockPayload,
  buildTypePayload,
  buildTypePayloads,
  buildTypePostKey,
  buildUnavailablePayload,
  formatStockCategory,
  displayableTextSize,
  nextCycleRestockAtMs,
  parseItemsPayload,
  parseRestockPayload,
  parseSellPayload,
  parseStockPayload,
  parseWeatherPayload,
  splitPayloadByDisplayText,
  slugKey,
};
