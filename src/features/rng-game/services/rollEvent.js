function successfulRollEvent(userId, result, source = 'manual') {
  if (!result?.seed || !result?.item) return null;
  const item = Object.freeze({ ...result.item });
  return Object.freeze({
    userId: String(userId),
    seed: result.seed,
    item,
    isBig: Boolean(item.isBig),
    finalWeightUnits: Number(item.weightUnits),
    source: String(source),
  });
}

function emitSuccessfulRoll(callback, userId, result, source) {
  const event = successfulRollEvent(userId, result, source);
  if (!event) return;
  try {
    Promise.resolve(callback(event)).catch(() => {});
  } catch {
    // Post-roll listeners must never change a successfully persisted roll.
  }
}

module.exports = { emitSuccessfulRoll, successfulRollEvent };
