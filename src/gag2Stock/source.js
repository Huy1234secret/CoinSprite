const {
  ITEMS_API_URL,
  REQUEST_RETRY_COUNT,
  REQUEST_RETRY_DELAY_MS,
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

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function isAbortError(error) {
  return error?.name === 'AbortError' || /aborted|aborterror/i.test(String(error?.message || ''));
}

function sourceError(message, patch = {}) {
  const error = new Error(message);
  Object.assign(error, patch);
  return error;
}

function isRetryableSourceError(error) {
  if (error?.gag2Transient) return true;
  const status = Number(error?.status);
  if (status === 429 || status >= 500) return true;
  return isAbortError(error) || /fetch failed|network|socket|timeout/i.test(String(error?.message || ''));
}

function finalSourceError(error, attempts, timeoutMs) {
  if (!isAbortError(error) && !error?.gag2SourceTimeout) {
    if (error && typeof error === 'object') {
      error.attempts = attempts;
      error.timeoutMs ||= timeoutMs;
    }
    return error;
  }
  return sourceError(
    `GAG2 source timed out after ${attempts} attempts (${Math.round(timeoutMs / 1000)}s each)`,
    {
      cause: error,
      gag2SourceTimeout: true,
      gag2Transient: true,
      attempts,
      timeoutMs,
    },
  );
}

async function fetchJsonOnce(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('global fetch is unavailable in this Node runtime');

  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,*/*',
        'cache-control': 'no-cache',
        origin: 'https://www.gag2.gg',
        pragma: 'no-cache',
        referer: options.referer || 'https://www.gag2.gg/stock',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      },
    });
    if (!response?.ok) {
      const status = Number(response?.status) || 0;
      throw sourceError(`${url}: HTTP ${status || 'unknown'}`, {
        gag2Transient: status === 429 || status >= 500,
        status,
      });
    }
    return response.json();
  } catch (error) {
    if (isAbortError(error)) {
      throw sourceError(`GAG2 source timed out after ${Math.round(timeoutMs / 1000)}s`, {
        cause: error,
        gag2SourceTimeout: true,
        gag2Transient: true,
        timeoutMs,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const retries = Math.max(0, Number.isFinite(Number(options.retries)) ? Number(options.retries) : REQUEST_RETRY_COUNT);
  const retryDelayMs = Math.max(0, Number.isFinite(Number(options.retryDelayMs)) ? Number(options.retryDelayMs) : REQUEST_RETRY_DELAY_MS);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS);
  const attempts = retries + 1;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetchJsonOnce(url, { ...options, timeoutMs });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableSourceError(error)) break;
      await wait(retryDelayMs * (attempt + 1));
    }
  }

  throw finalSourceError(lastError, attempts, timeoutMs);
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
  isRetryableSourceError,
};
