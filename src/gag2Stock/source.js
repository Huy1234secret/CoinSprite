const { REQUEST_TIMEOUT_MS, STOCK_API_URLS } = require('./config');
const { parseStockApiResponse } = require('./predictor');

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable in this Node runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        'user-agent': 'CoinSprite GAG2 stock predictor',
      },
    });
    if (!response?.ok) {
      throw new Error(`HTTP ${response?.status || 'unknown'}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadStockData(options = {}) {
  const urls = Array.isArray(options.urls) && options.urls.length ? options.urls : STOCK_API_URLS;
  const errors = [];

  for (const url of urls) {
    try {
      const payload = await fetchJson(url, options);
      return {
        data: parseStockApiResponse(payload),
        sourceUrl: url,
      };
    } catch (error) {
      errors.push(`${url}: ${error?.message || 'unknown error'}`);
    }
  }

  throw new Error(`All GAG2 stock API sources failed: ${errors.join('; ')}`);
}

module.exports = {
  fetchJson,
  loadStockData,
};
