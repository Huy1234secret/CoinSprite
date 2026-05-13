const MIN_RARE_ANNOUNCE_DENOMINATOR = 1_000;

function getBaseRollDenominator(rollOrDenominator) {
  if (rollOrDenominator && typeof rollOrDenominator === 'object') {
    return Math.max(0, Math.floor(Number(rollOrDenominator.denominator) || 0));
  }
  return Math.max(0, Math.floor(Number(rollOrDenominator) || 0));
}

function shouldAnnounceRareRoll(rollOrDenominator, minimumDenominator = MIN_RARE_ANNOUNCE_DENOMINATOR) {
  const baseDenominator = getBaseRollDenominator(rollOrDenominator);
  const minimum = getBaseRollDenominator(minimumDenominator);
  return baseDenominator >= minimum;
}

function shouldMentionAtThreshold(threshold, rollOrDenominator) {
  const baseDenominator = getBaseRollDenominator(rollOrDenominator);
  const normalizedThreshold = threshold === null || threshold === undefined
    ? null
    : getBaseRollDenominator(threshold);
  return normalizedThreshold === null || baseDenominator >= normalizedThreshold;
}

module.exports = {
  MIN_RARE_ANNOUNCE_DENOMINATOR,
  getBaseRollDenominator,
  shouldAnnounceRareRoll,
  shouldMentionAtThreshold,
};
