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

function parsePredictorScript(scriptSource) {
  if (typeof scriptSource !== 'string' || !scriptSource.trim()) {
    throw new Error('empty predictor script');
  }

  const match = scriptSource.match(/let\s+DATA\s*=\s*([\s\S]*?);\s*let\s+PERIOD\b/);
  if (!match) throw new Error('DATA object not found in predictor script');

  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    data = Function('"use strict"; return (' + match[1] + ');')();
  }

  return validatePredictorData(data);
}

function validatePredictorData(data) {
  if (!data || typeof data !== 'object') throw new Error('invalid predictor data');
  const period = toNumber(data.period);
  if (!period || period < 1) throw new Error('invalid predictor period');

  for (const category of CATEGORY_CONFIG) {
    if (!Array.isArray(data[category.key])) throw new Error(`missing ${category.key} list`);
    if (!Number.isFinite(toNumber(data[category.anchorKey], NaN))) {
      throw new Error(`missing ${category.anchorKey}`);
    }
  }

  return data;
}

function getCount(data) {
  const configuredCount = Math.floor(toNumber(data?.count));
  if (configuredCount > 0) return configuredCount;
  return Math.max(
    0,
    ...CATEGORY_CONFIG.flatMap((category) => (
      Array.isArray(data?.[category.key])
        ? data[category.key].map((item) => Array.isArray(item?.q) ? item.q.length : 0)
        : [0]
    )),
  );
}

function getSourceWindow(data) {
  const periodSeconds = Math.max(1, Math.floor(toNumber(data?.period, 300)));
  const count = getCount(data);
  const anchors = CATEGORY_CONFIG
    .map((category) => toNumber(data?.[category.anchorKey], NaN))
    .filter(Number.isFinite);
  const startSeconds = anchors.length ? Math.min(...anchors) : 0;
  const endSeconds = anchors.length ? Math.max(...anchors.map((anchor) => anchor + (count * periodSeconds))) : 0;

  return {
    count,
    endMs: endSeconds * 1000,
    periodSeconds,
    startMs: startSeconds * 1000,
  };
}

function getRarityRank(rarity) {
  return RARITY_RANK[String(rarity || '').toLowerCase()] || 0;
}

function getQuantityAt(item, index) {
  if (!item || !Array.isArray(item.q) || index < 0 || index >= item.q.length) return 0;
  return Math.max(0, Math.floor(toNumber(item.q[index])));
}

function normalizeStockItem(item, quantity, extra = {}) {
  return {
    name: String(item?.name || 'Unknown Item'),
    price: Math.max(0, Math.floor(toNumber(item?.price))),
    quantity,
    rarity: String(item?.rarity || 'Unknown'),
    ...extra,
  };
}

function compareImportantItems(left, right) {
  return getRarityRank(right.rarity) - getRarityRank(left.rarity)
    || right.price - left.price
    || left.name.localeCompare(right.name);
}

function getCurrentItems(items, windowIndex) {
  return items
    .map((item) => normalizeStockItem(item, getQuantityAt(item, windowIndex)))
    .filter((item) => item.quantity > 0)
    .sort(compareImportantItems);
}

function findNextStock(item, startIndex, count, anchorSeconds, periodSeconds) {
  for (let index = Math.max(0, startIndex); index < count; index += 1) {
    const quantity = getQuantityAt(item, index);
    if (quantity > 0) {
      return {
        index,
        quantity,
        restockAtMs: (anchorSeconds + (index * periodSeconds)) * 1000,
      };
    }
  }
  return null;
}

function getUpcomingItems(items, windowIndex, count, anchorSeconds, periodSeconds) {
  return items
    .map((item) => {
      const next = findNextStock(item, windowIndex + 1, count, anchorSeconds, periodSeconds);
      return next ? normalizeStockItem(item, next.quantity, next) : null;
    })
    .filter(Boolean)
    .sort((left, right) => (
      compareImportantItems(left, right)
      || left.restockAtMs - right.restockAtMs
    ))
    .slice(0, MAX_UPCOMING_ITEMS);
}

function buildCategoryPrediction(data, category, nowMs) {
  const periodSeconds = Math.max(1, Math.floor(toNumber(data.period, 300)));
  const count = getCount(data);
  const anchorSeconds = toNumber(data[category.anchorKey]);
  const nowSeconds = Math.floor(nowMs / 1000);
  const windowIndex = Math.floor((nowSeconds - anchorSeconds) / periodSeconds);
  const valid = windowIndex >= 0 && windowIndex < count;
  const nextWindowIndex = nowSeconds < anchorSeconds ? 0 : windowIndex + 1;
  const nextRestockAtMs = (anchorSeconds + (nextWindowIndex * periodSeconds)) * 1000;
  const items = Array.isArray(data[category.key]) ? data[category.key] : [];

  return {
    ...category,
    current: valid ? getCurrentItems(items, windowIndex) : [],
    nextRestockAtMs,
    upcoming: valid ? getUpcomingItems(items, windowIndex, count, anchorSeconds, periodSeconds) : [],
    valid,
    windowIndex,
  };
}

function buildPrediction(data, nowMs = Date.now()) {
  const sourceWindow = getSourceWindow(data);
  const categories = CATEGORY_CONFIG.map((category) => buildCategoryPrediction(data, category, nowMs));
  const validCategories = categories.filter((category) => category.valid);
  const nextRestockAtMs = validCategories.length
    ? Math.min(...validCategories.map((category) => category.nextRestockAtMs).filter(Number.isFinite))
    : null;
  const generatedAtSeconds = toNumber(data?.generatedAt, 0);

  return {
    categories,
    generatedAtMs: generatedAtSeconds ? generatedAtSeconds * 1000 : null,
    nextRestockAtMs,
    periodSeconds: sourceWindow.periodSeconds,
    sourceEndsAtMs: sourceWindow.endMs,
    sourceExpired: validCategories.length === 0 && nowMs >= sourceWindow.endMs,
    sourceStartsAtMs: sourceWindow.startMs,
    sourceWaiting: validCategories.length === 0 && nowMs < sourceWindow.startMs,
  };
}

function buildPostKey(prediction) {
  if (!prediction || prediction.sourceExpired) {
    return `expired:${prediction?.sourceEndsAtMs || 'unknown'}:${prediction?.generatedAtMs || 'unknown'}`;
  }
  if (prediction.sourceWaiting) {
    return `waiting:${prediction.sourceStartsAtMs || 'unknown'}:${prediction.generatedAtMs || 'unknown'}`;
  }
  return `stock:${prediction.generatedAtMs || 'unknown'}:${prediction.categories.map((category) => `${category.key}:${category.windowIndex}`).join('|')}`;
}

function formatTimestamp(ms, style = 'R') {
  return Number.isFinite(ms) ? `<t:${Math.floor(ms / 1000)}:${style}>` : 'unknown';
}

function formatMoney(value) {
  const amount = Math.max(0, Math.floor(toNumber(value)));
  return `$${amount.toLocaleString('en-US')}`;
}

function formatStockLine(item) {
  return `* **${item.name}** x${item.quantity} - ${item.rarity} - ${formatMoney(item.price)}`;
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
    return `### ${category.title} prediction\n* Prediction unavailable for this category in the current source window.`;
  }

  return [
    `### ${category.title} prediction`,
    '**Predicted now:**',
    formatList(category.current, formatStockLine, '* None predicted right now.'),
    '',
    '**Next notable:**',
    formatList(category.upcoming, formatUpcomingLine, '* No later stock found in this source window.'),
  ].join('\n');
}

function buildStockPayload(prediction, options = {}) {
  if (prediction?.sourceExpired) {
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
                '## GAG2 Stock Prediction',
                '* Status: **source data expired**',
                `* Source valid until: ${formatTimestamp(prediction.sourceEndsAtMs, 'F')}`,
                options.sourceUrl ? `* Source: ${options.sourceUrl}` : null,
                '',
                '-# No stock prediction was posted because the public predictor data no longer covers the current time.',
              ].filter(Boolean).join('\n'),
            },
          ],
        },
      ],
    };
  }

  const header = [
    '## GAG2 Stock Prediction',
    `* Next restock: ${formatTimestamp(prediction?.nextRestockAtMs)}`,
    `* Source valid until: ${formatTimestamp(prediction?.sourceEndsAtMs, 'F')}`,
  ];
  if (options.sourceUrl) header.push(`* Source: ${options.sourceUrl}`);

  const components = [
    { type: 10, content: header.join('\n') },
    { type: 14, divider: true, spacing: 1 },
  ];

  for (const category of prediction?.categories || []) {
    components.push({ type: 10, content: formatCategorySection(category) });
    components.push({ type: 14, divider: true, spacing: 1 });
  }

  components.push({
    type: 10,
    content: '-# Prediction only. GAG2 stock is server-sided; this uses the public GAG-2-Predictor dataset.',
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
              '## GAG2 Stock Prediction',
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
  buildPrediction,
  buildStockPayload,
  buildUnavailablePayload,
  formatCategorySection,
  getSourceWindow,
  parsePredictorScript,
  validatePredictorData,
};
