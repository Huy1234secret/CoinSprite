const {
  CATEGORY_LABELS,
  COMPONENTS_V2_FLAG,
  GREEN,
  RARITY_RANK,
  RED,
  STOCK_API_URL,
} = require('./config');

const NO_MENTIONS = { parse: [] };

function parseDateMs(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? parsed : null;
}

function getRarityRank(rarity) {
  return RARITY_RANK[String(rarity || '').toLowerCase()] || 0;
}

function normalizeItem(item) {
  return {
    emoji: String(item?.emoji || '').trim(),
    key: String(item?.key || item?.name || '').trim(),
    name: String(item?.name || 'Unknown Item').trim(),
    quantity: Math.max(0, Math.floor(Number(item?.quantity) || 0)),
    rarity: String(item?.rarity || 'Unknown').trim(),
  };
}

function normalizeCategory(entry) {
  const category = String(entry?.category || '').trim().toLowerCase();
  const items = (Array.isArray(entry?.items) ? entry.items : [])
    .map(normalizeItem)
    .filter((item) => item.name && item.quantity > 0)
    .sort((left, right) => (
      getRarityRank(right.rarity) - getRarityRank(left.rarity)
      || right.quantity - left.quantity
      || left.name.localeCompare(right.name)
    ));

  return {
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

function buildPostKey(stockPayload) {
  return stockPayload.stock
    .map((entry) => [
      entry.category,
      entry.restockedAtMs || 'none',
      entry.nextRestockAtMs || 'none',
      entry.items.map((item) => `${item.key}:${item.quantity}`).join(','),
    ].join(':'))
    .join('|');
}

function formatTimestamp(ms, style = 'R') {
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'unknown';
}

function formatItem(item) {
  const emoji = item.emoji ? `${item.emoji} ` : '';
  return `* ${emoji}**${item.name}** x${item.quantity} - ${item.rarity}`;
}

function formatCategory(entry) {
  return [
    `### ${entry.label}`,
    `* Next restock: ${formatTimestamp(entry.nextRestockAtMs)}`,
    '',
    entry.items.length ? entry.items.map(formatItem).join('\n') : '* Nothing listed right now.',
  ].join('\n');
}

function buildStockPayload(stockPayload, options = {}) {
  const nextRestockAtMs = Math.min(...stockPayload.stock
    .map((entry) => entry.nextRestockAtMs)
    .filter(Number.isFinite));
  const components = [
    {
      type: 10,
      content: [
        '## GAG2 Stock',
        `* Next restock: ${formatTimestamp(nextRestockAtMs)}`,
        `* Source: ${options.sourceUrl || STOCK_API_URL}`,
      ].join('\n'),
    },
    { type: 14, divider: true, spacing: 1 },
  ];

  for (const entry of stockPayload.stock) {
    components.push({ type: 10, content: formatCategory(entry) });
    components.push({ type: 14, divider: true, spacing: 1 });
  }

  components.push({
    type: 10,
    content: '-# Stock data from gag2.gg. Third-party live stock feeds are best-effort.',
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
  buildUnavailablePayload,
  formatCategory,
  parseStockPayload,
};
