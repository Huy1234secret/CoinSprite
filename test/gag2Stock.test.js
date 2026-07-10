const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildPostKey,
  buildPrediction,
  buildStockPayload,
  parsePredictorScript,
} = require('../src/gag2Stock/predictor');

function fixtureScript() {
  return `let DATA = {
    "seeds": [
      { "name": "Carrot", "rarity": "Common", "price": 1, "q": [3, 0, 2] },
      { "name": "Moon Bloom", "rarity": "Super", "price": 65000000, "q": [0, 1, 0] }
    ],
    "seedAnchor": 1000,
    "gears": [
      { "name": "Common Watering Can", "rarity": "Common", "price": 2000, "q": [2, 2, 0] },
      { "name": "Super Sprinkler", "rarity": "Super", "price": 3000000, "q": [0, 1, 0] }
    ],
    "gearAnchor": 1000,
    "crates": [
      { "name": "Light Crate", "rarity": "Uncommon", "price": 90000, "q": [0, 1, 0] },
      { "name": "Teleporter Pad Crate", "rarity": "Mythic", "price": 20000000, "q": [1, 0, 0] }
    ],
    "crateAnchor": 1000,
    "count": 3,
    "generatedAt": 999,
    "period": 300
  };
  let PERIOD = (DATA && DATA.period) ? DATA.period : 300;`;
}

test('GAG2 predictor parses static script data and builds category stock', () => {
  const data = parsePredictorScript(fixtureScript());
  const prediction = buildPrediction(data, 1000 * 1000);

  assert.equal(prediction.sourceExpired, false);
  assert.equal(prediction.nextRestockAtMs, 1300 * 1000);
  assert.equal(prediction.categories.length, 3);
  assert.deepEqual(prediction.categories[0].current.map((item) => item.name), ['Carrot']);
  assert.deepEqual(prediction.categories[0].upcoming.map((item) => item.name), ['Moon Bloom', 'Carrot']);
  assert.match(buildPostKey(prediction), /^stock:999000:/);
});

test('GAG2 stock payload is a Components V2 container with all categories', () => {
  const data = parsePredictorScript(fixtureScript());
  const prediction = buildPrediction(data, 1000 * 1000);
  const payload = buildStockPayload(prediction, { sourceUrl: 'https://example.invalid/script.js' });
  const container = payload.components[0];
  const content = container.components
    .filter((component) => component.type === 10)
    .map((component) => component.content)
    .join('\n');

  assert.equal(payload.flags, 32768);
  assert.equal(container.type, 17);
  assert.match(content, /## GAG2 Stock Prediction/);
  assert.match(content, /### Seed prediction/);
  assert.match(content, /### Gear prediction/);
  assert.match(content, /### Crate prediction/);
  assert.match(content, /Teleporter Pad Crate/);
});

test('GAG2 predictor marks expired source data instead of extending old stock', () => {
  const data = parsePredictorScript(fixtureScript());
  const prediction = buildPrediction(data, 2000 * 1000);
  const payload = buildStockPayload(prediction);
  const content = payload.components[0].components[0].content;

  assert.equal(prediction.sourceExpired, true);
  assert.match(buildPostKey(prediction), /^expired:/);
  assert.match(content, /source data expired/);
});
