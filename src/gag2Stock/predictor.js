const {
  CATEGORY_CONFIG,
  COMPONENTS_V2_FLAG,
  GREEN,
  MAX_UPCOMING_ITEMS,
  RED,
} = require('./config');

const NO_MENTIONS = { parse: [] };
const RARITY_RANK = {
  common: 1,
  uncommon: 2,
  rare: 3,
  epic: 4,
  legendary: 5,
  mythic: 6,
  super: 7,
  divine: 8,
};

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function parseStockApiResponse(payload) {
  if (typeof payload === 'string') {
    return validateStockApiData(JSON.parse(payload));
  }
  return validateStockApiData(payload);
}

function validateStockApiData(data) {
  if (!data || typeof data !== 'object') throw new Error('invalid GAG2 stock API payload');
  const period = toNumber(data.period);
  if (!period || period < 1) throw new Error('invalid GAG2 stock period');
  if (!data.upcoming || typeof data.upcoming !== 'object') throw new Error('missing GAG2 upcoming stock');

  for (const category of CATEGORY_CONFIG) {
    const windows = data.upcoming[category.key];
    if (!Array.isArray(windows)) throw new Error(`missing ${category.key} stock windows`);
    for (const window of windows) {
      if (!Number.isFinite(toNumber(window?.time, NaN))) throw new Error(`invalid ${category.key} stock time`);
      if (!Array.isArray(window?.items)) throw new Error(`invalid ${category.key} stock items`);
    }
  }

  return data;
}

function getRarityRank(rarity) {
  return RARITY_RANK[String(rarity || '').toLowerCase()] || 0;
}

function normalizeStockItem(item, extra = {}) {
  return {
    name: String(item?.name || 'Unknown Item'),
    quantity: Math.max(0, Math.floor(toNumber(item?.qty ?? item?.quantity))),
    rarity: String(item?.rarity || 'Unknown'),
    ...extra,
  };
}

function compareImportantItems(left, right) {
  return getRarityRank(right.rarity) - getRarityRank(left.rarity)
    || right.quantity - left.quantity
    || left.name.localeCompare(right.name);
}

function getSortedWindows(data, categoryKey) {
  return [...(data?.upcoming?.[categoryKey] || [])]
    .map((window) => ({
      timeSeconds: Math.floor(toNumber(window?.time)),
      items: Array.isArray(window?.items) ? window.items : [],
    }))
    .filter((window) => Number.isFinite(window.timeSeconds))
    .sort((left, right) => left.timeSeconds - right.timeSeconds);
}

function getSourceWindow(data) {
  const periodSeconds = Math.max(1, Math.floor(toNumber(data?.period, 300)));
  const allTimes = CATEGORY_CONFIG
    .flatMap((category) => getSortedWindows(data, category.key).map((window) => window.timeSeconds));
  const startSeconds = allTimes.length ? Math.min(...allTimes) : 0;
  const endSeconds = allTimes.length ? Math.max(...allTimes) + periodSeconds : 0;

  return {
    endMs: endSeconds * 1000,
    periodSeconds,
    startMs: startSeconds * 1000,
  };
}

function findCurrentWindow(windows, nowSeconds, periodSeconds) {
  const exact = windows.find((window) => window.timeSeconds <= nowSeconds && nowSeconds < window.timeSeconds + periodSeconds);
  if (exact) return exact;

  const latestPast = [...windows].reverse().find((window) => window.timeSeconds <= nowSeconds);
  if (latestPast && nowSeconds < latestPast.timeSeconds + periodSeconds) return latestPast;
  return null;
}

function getCurrentItems(window) {
  return (window?.items || [])
    .map((item) => normalizeStockItem(item))
    .filter((item) => item.quantity > 0)
    .sort(compareImportantItems);
}

function getUpcomingItems(windows, currentWindow, nowSeconds) {
  const firstSeenByName = new Map();
  for (const window of windows) {
    if (window.timeSeconds <= (currentWindow?.timeSeconds ?? nowSeconds)) continue;
    for (const rawItem of window.items) {
      const item = normalizeStockItem(rawItem, { restockAtMs: window.timeSeconds * 1000 });
      if (item.quantity <= 0 || firstSeenByName.has(item.name)) continue;
      firstSeenByName.set(item.name, item);
    }
  }

  return [...firstSeenByName.values()]
    .sort((left, right) => (
      compareImportantItems(left, right)
      || left.restockAtMs - right.restockAtMs
    ))
    .slice(0, MAX_UPCOMING_ITEMS);
}

function buildCategoryStock(data, category, nowMs) {
  const periodSeconds = Math.max(1, Math.floor(toNumber(data.period, 300)));
  const nowSeconds = Math.floor(nowMs / 1000);
  const windows = getSortedWindows(data, category.key);
  const currentWindow = findCurrentWindow(windows, nowSeconds, periodSeconds);
  const nextWindow = windows.find((window) => window.timeSeconds > nowSeconds) || null;

  return {
    ...category,
    current: getCurrentItems(currentWindow),
    currentWindowEndsAtMs: currentWindow ? (currentWindow.timeSeconds + periodSeconds) * 1000 : null,
    currentWindowTimeMs: currentWindow ? currentWindow.timeSeconds * 1000 : null,
    nextRestockAtMs: nextWindow ? nextWindow.timeSeconds * 1000 : null,
    upcoming: getUpcomingItems(windows, currentWindow, nowSeconds),
    valid: Boolean(currentWindow),
  };
}

function buildStockSnapshot(data, nowMs = Date.now()) {
  const sourceWindow = getSourceWindow(data);
  const categories = CATEGORY_CONFIG.map((category) => buildCategoryStock(data, category, nowMs));
  const validCategories = categories.filter((category) => category.valid);
  const nextRestockAtMs = validCategories.length
    ? Math.min(...validCategories.map((category) => category.nextRestockAtMs).filter(Number.isFinite))
    : null;
  const currentWindowEndsAtMs = validCategories.length
    ? Math.min(...validCategories.map((category) => category.currentWindowEndsAtMs).filter(Number.isFinite))
    : null;
  const apiNowSeconds = toNumber(data?.now, 0);

  return {
    apiNowMs: apiNowSeconds ? apiNowSeconds * 1000 : null,
    categories,
    currentWindowEndsAtMs,
    nextRestockAtMs,
    periodSeconds: sourceWindow.periodSeconds,
    sourceEndsAtMs: sourceWindow.endMs,
    sourceStale: validCategories.length === 0 && nowMs >= sourceWindow.endMs,
    sourceStartsAtMs: sourceWindow.startMs,
    sourceWaiting: validCategories.length === 0 && nowMs < sourceWindow.startMs,
  };
}

function buildPostKey(snapshot) {
  if (!snapshot || snapshot.sourceStale) {
    return `stale:${snapshot?.sourceEndsAtMs || 'unknown'}:${snapshot?.apiNowMs || 'unknown'}`;
  }
  if (snapshot.sourceWaiting) {
    return `waiting:${snapshot.sourceStartsAtMs || 'unknown'}:${snapshot.apiNowMs || 'unknown'}`;
  }
  return `stock:${snapshot.categories.map((category) => `${category.key}:${category.currentWindowTimeMs || 'none'}`).join('|')}`;
}

function formatTimestamp(ms, style = 'R') {
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'unknown';
}

function formatStockLine(item) {
  return `* **${item.name}** x${item.quantity} - ${item.rarity}`;
}

function formatUpcomingLine(item) {
  return `* **${item.name}** x${item.quantity} - ${item.rarity} - ${formatTimestamp(item.restockAtMs)}`;
}

function formatList(items, formatter, fallback) {
  if (!Array.isArray(items) || !items.length) return fallback;
  return items.map(formatter).join('\n');
}

function formatCategorySection(category) {
  if (!category.valid) {
    return `### ${category.title} stock\n* Stock unavailable for this category in the current API window.`;
  }

  return [
    `### ${category.title} stock`,
    `* Window ends: ${formatTimestamp(category.currentWindowEndsAtMs)}`,
    '',
    '**In stock now:**',
    formatList(category.current, formatStockLine, '* None listed right now.'),
    '',
    '**Next notable:**',
    formatList(category.upcoming, formatUpcomingLine, '* No later stock found in this API window.'),
  ].join('\n');
}

function buildStockPayload(snapshot, options = {}) {
  if (snapshot?.sourceStale) {
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
                '## GAG2 Stock',
                '* Status: **source data stale**',
                `* Source valid until: ${formatTimestamp(snapshot.sourceEndsAtMs, 'F')}`,
                options.sourceUrl ? `* Source: ${options.sourceUrl}` : null,
                '',
                '-# No stock was posted because the API data no longer covers the current time.',
              ].filter(Boolean).join('\n'),
            },
          ],
        },
      ],
    };
  }

  const header = [
    '## GAG2 Stock',
    `* Current window ends: ${formatTimestamp(snapshot?.currentWindowEndsAtMs)}`,
    `* Next restock: ${formatTimestamp(snapshot?.nextRestockAtMs)}`,
  ];
  if (options.sourceUrl) header.push(`* Source: ${options.sourceUrl}`);

  const components = [
    { type: 10, content: header.join('\n') },
    { type: 14, divider: true, spacing: 1 },
  ];

  for (const category of snapshot?.categories || []) {
    components.push({ type: 10, content: formatCategorySection(category) });
    components.push({ type: 14, divider: true, spacing: 1 });
  }

  components.push({
    type: 10,
    content: '-# Stock data from game.guide API. GAG2 stock is server-sided, so treat third-party stock feeds as best-effort.',
  });

  return {
    allowedMentions: NO_MENTIONS,
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

function buildUnavailablePayload(errorMessage, nowMs = Date.now()) {
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
              '## GAG2 Stock',
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
  buildStockSnapshot,
  buildUnavailablePayload,
  formatCategorySection,
  getSourceWindow,
  parseStockApiResponse,
  validateStockApiData,
};
