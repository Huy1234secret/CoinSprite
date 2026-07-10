const { DATA_SOURCE_URLS, REQUEST_TIMEOUT_MS } = require('./config');
const { parsePredictorScript } = require('./predictor');

async function fetchText(url, options = {}) {
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
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadPredictorData(options = {}) {
  const urls = Array.isArray(options.urls) && options.urls.length ? options.urls : DATA_SOURCE_URLS;
  const errors = [];

  for (const url of urls) {
    try {
      const script = await fetchText(url, options);
      return {
        data: parsePredictorScript(script),
        sourceUrl: url,
      };
    } catch (error) {
      errors.push(`${url}: ${error?.message || 'unknown error'}`);
    }
  }

  throw new Error(`All GAG2 predictor sources failed: ${errors.join('; ')}`);
}

module.exports = {
  fetchText,
  loadPredictorData,
};
