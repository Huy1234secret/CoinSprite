const DEFAULT_GAG2_BROADCAST_CONCURRENCY = 25;
const MAX_GAG2_BROADCAST_CONCURRENCY = 40;

function normalizeConcurrency(value, fallback = DEFAULT_GAG2_BROADCAST_CONCURRENCY) {
  const number = Number(value);
  const normalized = Number.isFinite(number) ? Math.floor(number) : fallback;
  return Math.max(1, Math.min(MAX_GAG2_BROADCAST_CONCURRENCY, normalized));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const values = Array.from(items || []);
  if (!values.length) return [];

  const results = new Array(values.length);
  const workerCount = Math.min(values.length, normalizeConcurrency(concurrency));
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

module.exports = {
  DEFAULT_GAG2_BROADCAST_CONCURRENCY,
  MAX_GAG2_BROADCAST_CONCURRENCY,
  mapWithConcurrency,
  normalizeConcurrency,
};
