const { randomInt } = require('node:crypto');
const { TOPICS, DIFFICULTY_TOPICS } = require('./types');
const LEGACY_IDS = require('./data/legacy-ids.json');

// Topic-tagged questions are local; gameplay never calls an external service.
// Attribution and licensing for each record's source: data/ATTRIBUTION.md.
const RECORDS = Object.fromEntries(Object.keys(DIFFICULTY_TOPICS).map(difficulty => {
  const entries = require('./data/' + difficulty + '.json');
  for (const entry of entries) {
    if (!DIFFICULTY_TOPICS[difficulty].includes(entry.type)) {
      throw new Error('Invalid Trivia topic for ' + difficulty + ': ' + entry.type);
    }
  }
  return [difficulty, entries];
}));
const BANK = Object.fromEntries(Object.entries(RECORDS).map(([difficulty, entries]) =>
  [difficulty, entries.map(entry => entry.row)]));

function question(difficulty, seen = [], random = randomInt) {
  const bank = RECORDS[difficulty];
  if (!bank) throw new Error('Unknown Trivia difficulty');
  // Old sessions used array positions. Translate those positions once; stable
  // IDs keep later edits and reclassification from changing question history.
  let history = [...new Set(seen.map(id => Number.isInteger(id)
    ? LEGACY_IDS[difficulty][id] : id).filter(id => typeof id === 'string'))];
  const used = new Set(history);
  let available = bank.filter(entry => !used.has(entry.id));
  if (!available.length) { history = []; available = bank; }
  const entry = available[random(available.length)];
  const [text, correct, ...wrong] = entry.row;
  const answers = [correct, ...wrong];
  for (let i = answers.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [answers[i], answers[j]] = [answers[j], answers[i]];
  }
  return { id: entry.id, type: entry.type, topic: TOPICS[entry.type], text, answers,
    correct: answers.indexOf(correct), seen: [...history, entry.id] };
}
module.exports = { BANK, RECORDS, LEGACY_IDS, question };
