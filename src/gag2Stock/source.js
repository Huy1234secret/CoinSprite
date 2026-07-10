const { REQUEST_TIMEOUT_MS, STOCK_API_URL } = require('./config');
const { parseStockPayload } = require('./stockPayload');

async function fetchStockPayload(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable in this Node runtime');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(options.url || STOCK_API_URL, {
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,*/*',
        origin: 'https://www.gag2.gg',
        referer: 'https://www.gag2.gg/stock',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
    });
    if (!response?.ok) throw new Error(`HTTP ${response?.status || 'unknown'}`);
    return parseStockPayload(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  fetchStockPayload,
};
