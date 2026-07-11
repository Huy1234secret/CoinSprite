const {
  CATEGORY_LABELS,
  COMPONENTS_V2_FLAG,
  GREEN,
  RED,
} = require('./config');
const {
  SELL_BONUS_COLORS,
  colorForType,
  customEmojiImageUrl,
  displayNameForType,
  emojiForType,
  highestRarityColor,
  normalizeKey,
  roleKeyForType,
  sellBonusRoleForEntry,
  sellMultiplierBucket,
  sortItemsForType,
} = require('./catalog');

const NO_MENTIONS = { parse: [], roles: [], users: [] };
const WHITE = 0xFFFFFF;

function parseDateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBoundaryMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return parseDateMs(value);
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
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

function normalizeCategory(entry) {
  const category = String(entry?.category || '').trim().toLowerCase();
  const items = sortItemsForType(category, (Array.isArray(entry?.items) ? entry.items : [])
    .map(normalizeItem)
    .filter((item) => item.name && item.quantity > 0));

  return {
    type: category,
    category,
    label: CATEGORY_LABELS[category] || category || 'Stock',
    items,
    nextRestockAtMs: parseDateMs(entry?.nextRestockAt),
    restockedAtMs: parseDateMs(entry?.restockedAt),
  };
}

function parseStockPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('invalid GAG2 stock payload');
  if (!Array.isArray(payload.stock)) throw new Error('missing GAG2 stock list');

  const stock = payload.stock
    .map(normalizeCategory)
    .filter((entry) => entry.category);
  if (!stock.length) throw new Error('empty GAG2 stock list');

  return {
    fetchedAtMs: parseDateMs(payload.fetchedAt) || Date.now(),
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

function parseSellPayload(payload) {
  const entries = payload?.sell?.entries || payload?.entries;
  if (!Array.isArray(entries)) throw new Error('missing GAG2 sell price list');
  const normalized = entries
    .map((entry) => ({
      key: slugKey(entry?.key || entry?.id || entry?.name),
      name: String(entry?.name || 'Unknown item').trim(),
      multiplier: Number(entry?.multiplier),
      rarity: String(entry?.rarity || '').trim(),
      tier: String(entry?.tier || '').trim(),
    }))
    .filter((entry) => entry.name && Number.isFinite(entry.multiplier));
  if (!normalized.length) throw new Error('empty GAG2 sell price list');
  return {
    fetchedAtMs: parseDateMs(payload?.fetchedAt) || Date.now(),
    entries: sortItemsForType('sell', normalized),
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
  return [
    entry.category,
    entry.restockedAtMs || 'none',
    entry.nextRestockAtMs || 'none',
    entry.items.map((item) => `${item.key}:${item.quantity}`).join(','),
  ].join(':');
}

function buildPostKey(stockPayload) {
  return stockPayload.stock.map(buildStockCategoryKey).join('|');
}

function buildTypePostKey(type, entry) {
  if (!entry) return `${type}:empty`;
  if (['seed', 'gear', 'crate'].includes(type)) return buildStockCategoryKey(entry);
  if (type === 'weather') {
    const current = entry.current || {};
    return [
      'weather',
      current.key || 'none',
      current.startsAtMs || 'none',
      current.endsAtMs || 'none',
      entry.recent?.slice(0, 8).map((item) => `${item.key}:${item.lastSeenAtMs || 0}`).join(',') || '',
    ].join(':');
  }
  if (type === 'moon') {
    return `moon:${(entry.upcomingMoons || []).slice(0, 12).map((item) => `${item.key}:${item.boundaryMs}`).join(',')}`;
  }
  if (type === 'sell') {
    return `sell:${(entry.entries || []).slice(0, 40).map((item) => `${item.key}:${item.multiplier.toFixed(4)}:${item.tier}`).join(',')}`;
  }
  return `${type}:${JSON.stringify(entry).slice(0, 500)}`;
}

function formatTimestamp(ms, style = 'R') {
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'unknown';
}

function roleIdForItem(roleIds, item, type = '') {
  const catalogKey = roleKeyForType(type || item?.type || '', item);
  return roleIds?.[catalogKey] || roleIds?.[item?.key] || roleIds?.[slugKey(item?.name)];
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

function formatStockCategory(entry, roleIds = {}) {
  return [
    `## GAG2 ${entry.label}`,
    `* Next restock: ${formatTimestamp(entry.nextRestockAtMs)}`,
    '',
    entry.items.length ? entry.items.map((item) => formatItem(entry.category, item, roleIds)).join('\n') : '* Nothing listed right now.',
  ].join('\n');
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
  return `${prefix}${emojiPrefix('sell', item)}**${displayNameForType('sell', item)}** x${formatMultiplier(item.multiplier)}`;
}

function formatSell(entry, roleIds = {}) {
  const lines = ['## GAG2 Sell Price Track'];
  const normalEntries = (entry.entries || []).filter((item) => !sellMultiplierBucket(item.multiplier));
  for (const item of normalEntries.slice(0, 25)) {
    lines.push(formatSellLine(item, roleIds));
  }
  if (lines.length === 1) lines.push('* No normal sell price entries listed right now.');
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

function accentColorForType(type, entry) {
  if (['seed', 'gear', 'crate'].includes(type)) return highestRarityColor(type, entry?.items || [], GREEN);
  if (type === 'weather') return colorForType('weather', entry?.current) || GREEN;
  if (type === 'moon') return colorForType('moon', entry?.upcomingMoons?.[0]) || GREEN;
  if (type === 'sell') {
    return WHITE;
  }
  return GREEN;
}

function bonusRoleDisplayForSellItem(roleIds, item) {
  const bonusRole = sellBonusRoleForEntry(item);
  if (!bonusRole) return '';
  return roleMention(roleIds, bonusRole, 'sell').trim() || bonusRole.roleName;
}

function sellBonusContainers(entry, roleIds = {}) {
  const entries = (entry?.entries || []).filter((item) => sellMultiplierBucket(item.multiplier));
  const buckets = ['4x', '2x'].filter((bucket) => entries.some((item) => sellMultiplierBucket(item.multiplier) === bucket));
  return buckets.map((bucket) => {
    const bucketEntries = entries.filter((item) => sellMultiplierBucket(item.multiplier) === bucket);
    const bonusRoles = [...new Set(bucketEntries.map((item) => bonusRoleDisplayForSellItem(roleIds, item)).filter(Boolean))];
    const title = `## ${bonusRoles.length ? bonusRoles.join(' ') : bucket} Sell Price`;
    const lines = bucketEntries.map((item) => formatSellLine(item, roleIds));
    return {
      type: 17,
      accent_color: SELL_BONUS_COLORS[bucket],
      components: [{ type: 10, content: [title, ...lines].join('\n') }],
    };
  });
}

function buildTypePayload(type, entry, options = {}) {
  const roleIds = options.roleIds || {};
  return {
    allowedMentions: type === 'moon' ? NO_MENTIONS : allowedMentionsForRoles(roleIds),
    flags: COMPONENTS_V2_FLAG,
    components: [
      ...((type === 'sell') ? sellBonusContainers(entry, roleIds) : []),
      {
        type: 17,
        accent_color: accentColorForType(type, entry),
        components: [
          textComponentForType(type, entry, roleIds),
        ],
      },
    ],
  };
}

function buildStockPayload(stockPayload, options = {}) {
  const combinedRoleIds = Object.assign({}, ...Object.values(options.roleIds || {}));
  const components = [];
  for (const entry of stockPayload.stock) {
    if (components.length) components.push({ type: 14, divider: true, spacing: 1 });
    components.push({ type: 10, content: contentForType(entry.category, entry, options.roleIds?.[entry.category] || {}) });
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
  buildTypePostKey,
  buildUnavailablePayload,
  formatStockCategory,
  parseItemsPayload,
  parseSellPayload,
  parseStockPayload,
  parseWeatherPayload,
  slugKey,
};
