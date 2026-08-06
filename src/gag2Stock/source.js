const https = require('https');
const {
  FALL_SELL_API_URL,
  FALL_STOCK_API_URL,
  REQUEST_RETRY_COUNT,
  REQUEST_RETRY_DELAY_MS,
  REQUEST_TIMEOUT_MS,
  SELL_API_URL,
  STOCK_API_URL,
  WEATHER_API_URL,
} = require('./config');
const {
  parseSellPayload,
  parseStockPayload,
  parseWeatherPayload,
} = require('./stockPayload');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

function nodeHttpsFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: options.headers || {},
      signal: options.signal,
    }, (response) => {
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > 5 * 1024 * 1024) {
          request.destroy(sourceError('GAG2 source response is too large', { gag2Transient: true }));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: Number(response.statusCode) >= 200 && Number(response.statusCode) < 300,
          status: Number(response.statusCode) || 0,
          json: async () => JSON.parse(body),
        });
      });
    });
    request.on('error', reject);
  });
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
  if (status === 403 || status === 429 || status >= 500) return true;
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
  // Native HTTPS avoids the intermittent Cloudflare challenge that Node's
  // browser-style global fetch receives for these otherwise public endpoints.
  const fetchImpl = options.fetchImpl || nodeHttpsFetch;

  const controller = new AbortController();
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || REQUEST_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      cache: 'no-store',
      signal: controller.signal,
      headers: {
        accept: 'application/json,text/plain,*/*',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        referer: options.referer || 'https://gag.gg/seed-restock/',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
        ...(options.headers || {}),
      },
    });
    if (!response?.ok) {
      const status = Number(response?.status) || 0;
      throw sourceError(`${url}: HTTP ${status || 'unknown'}`, {
        // Cloudflare can challenge the first otherwise-valid API request with
        // a 403 and accept the immediate retry with the same safe headers.
        gag2Transient: status === 403 || status === 429 || status >= 500,
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
  let attempted = 0;
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    attempted = attempt + 1;
    try {
      return await fetchJsonOnce(url, { ...options, timeoutMs });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableSourceError(error)) break;
      await wait(retryDelayMs * (attempt + 1));
    }
  }

  throw finalSourceError(lastError, attempted, timeoutMs);
}

async function fetchStockPayload(options = {}) {
  const world = String(options.world || 'main').trim().toLowerCase();
  const url = options.url || (world === 'fall' ? FALL_STOCK_API_URL : STOCK_API_URL);
  return parseStockPayload(await fetchJson(url, options), { world });
}

async function fetchFallStockPayload(options = {}) {
  return fetchStockPayload({ ...options, world: 'fall', url: options.url || FALL_STOCK_API_URL });
}

async function fetchWeatherPayload(options = {}) {
  return parseWeatherPayload(await fetchJson(options.url || WEATHER_API_URL, {
    ...options,
    referer: 'https://gag.gg/seed-restock/',
  }));
}

async function fetchSellPayload(options = {}) {
  const world = String(options.world || 'main').trim().toLowerCase();
  const url = options.url || (world === 'fall' ? FALL_SELL_API_URL : SELL_API_URL);
  return parseSellPayload(await fetchJson(url, {
    ...options,
    referer: 'https://gag.gg/seed-restock/',
  }), { world });
}

async function fetchFallSellPayload(options = {}) {
  return fetchSellPayload({ ...options, world: 'fall', url: options.url || FALL_SELL_API_URL });
}

module.exports = {
  fetchFallSellPayload,
  fetchFallStockPayload,
  fetchJson,
  fetchSellPayload,
  fetchStockPayload,
  fetchWeatherPayload,
  isRetryableSourceError,
};
