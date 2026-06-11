(() => {
  const MS_KEYS = ['messageCooldownMs','turnTimeoutMs','punishmentMs','gameCooldownMs','minClaimMs','maxClaimMs','minDurationMs','maxDurationMs'];
  const originalFetch = window.fetch.bind(window);
  function copy(value) { return value && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value; }
  function mapMs(value, mapper) {
    if (!value || typeof value !== 'object') return value;
    for (const key of MS_KEYS) if