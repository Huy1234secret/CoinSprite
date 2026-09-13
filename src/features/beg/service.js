const crypto = require('node:crypto');
const { APPROACHES_BY_TIER, APPROACH_BY_ID, TIERS } = require('./data/approaches');

function systemRng() { return crypto.randomInt(0, 2 ** 32) / 2 ** 32; }

function normalizedRoll(rng) {
  return Math.max(0, Math.min(0.999999999999, Number(rng())));
}

function rollInteger(rng, minimum, maximum) {
  return minimum + Math.floor(normalizedRoll(rng) * (maximum - minimum + 1));
}

function weightedTier(rng, available) {
  const tiers = TIERS.filter(tier => available[tier.id]?.length);
  const total = tiers.reduce((sum, tier) => sum + tier.weight, 0);
  let roll = normalizedRoll(rng) * total;
  for (const tier of tiers) {
    if (roll < tier.weight) return tier;
    roll -= tier.weight;
  }
  return tiers.at(-1);
}

function selectApproaches(rng = systemRng) {
  const available = Object.fromEntries(TIERS.map(tier => [tier.id, [...APPROACHES_BY_TIER[tier.id]]]));
  const selected = [];
  while (selected.length < 4) {
    const tier = weightedTier(rng, available);
    const index = rollInteger(rng, 0, available[tier.id].length - 1);
    selected.push(available[tier.id].splice(index, 1)[0]);
  }
  return Object.freeze(selected);
}

function outcomeFor(approach, rng) {
  const roll = normalizedRoll(rng) * 100;
  if (roll < approach.successChance) return 'success';
  if (roll < approach.successChance + approach.lossChance) return 'loss';
  return 'fail';
}

class BegService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.rng = options.rng || systemRng;
    this.createId = options.createId || (() => crypto.randomBytes(9).toString('base64url'));
  }

  open(input) {
    const approaches = selectApproaches(this.rng);
    return this.repository.open({
      ...input,
      sessionId: this.createId(),
      approachIds: approaches.map(approach => approach.id),
    });
  }

  resolve(input) {
    const approach = APPROACH_BY_ID[input.approachId];
    if (!approach) return { status: 'invalid-approach' };
    const outcome = outcomeFor(approach, this.rng);
    const range = outcome === 'success' ? approach.reward : approach.loss;
    const amount = outcome === 'fail' ? 0 : rollInteger(this.rng, range[0], range[1]);
    return this.repository.resolve(input.sessionId, {
      ...input, approachId: approach.id, outcome, amount,
    });
  }
}

module.exports = {
  BegService, normalizedRoll, outcomeFor, rollInteger, selectApproaches, systemRng, weightedTier,
};
