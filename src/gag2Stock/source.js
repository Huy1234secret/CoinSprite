const {
  ITEMS_API_URL,
  REQUEST_TIMEOUT_MS,
  SELL_API_URL,
  STOCK_API_URL,
  WEATHER_API_URL,
} = require('./config');
const {
  parseItemsPayload,
  parseSellPayload,
  parseStockPayload,
  parseWeatherPayload,
} = require('./stockPayload');

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable in this Node runtime');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,*/*',
        origin: 'https://www.gag2.gg',
        referer: options.referer || 'https://www.gag2.gg/stock',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
    });
    if (!response?.ok) throw new Error(`${url}: HTTP ${response?.status || 'unknown'}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStockPayload(options = {}) {
  return parseStockPayload(await fetchJson(options.url || STOCK_API_URL, options));
}

async function fetchWeatherPayload(options = {}) {
  return parseWeatherPayload(await fetchJson(options.url || WEATHER_API_URL, {
    ...options,
    referer: 'https://www.gag2.gg/stock/weather',
  }));
}

async function fetchSellPayload(options = {}) {
  return parseSellPayload(await fetchJson(options.url || SELL_API_URL, {
    ...options,
    referer: 'https://www.gag2.gg/stock/sell',
  }));
}

async function fetchItemsPayload(options = {}) {
  return parseItemsPayload(await fetchJson(options.url || ITEMS_API_URL, options));
}

module.exports = {
  fetchItemsPayload,
  fetchJson,
  fetchSellPayload,
  fetchStockPayload,
  fetchWeatherPayload,
};
