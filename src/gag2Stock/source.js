const { REQUEST_TIMEOUT_MS, STOCK_API_HEADER_PROFILES, STOCK_API_URLS } = require('./config');
const { parseStockApiResponse } = require('./predictor');

async function requestJson(url, headers, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('global fetch is unavailable in this Node runtime');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      headers,
    });
    if (!response?.ok) {
      throw new Error(`HTTP ${response?.status || 'unknown'}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const headerProfiles = Array.isArray(options.headerProfiles) && options.headerProfiles.length
    ? options.headerProfiles
    : STOCK_API_HEADER_PROFILES;
  const errors = [];

  for (const profile of headerProfiles) {
    try {
      return await requestJson(url, profile.headers || {}, options);
    } catch (error) {
      errors.push(`${profile.label || 'headers'}: ${error?.message || 'unknown error'}`);
    }
  }

  throw new Error(`API request rejected (${errors.join('; ')})`);
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
  requestJson,
  loadStockData,
};
