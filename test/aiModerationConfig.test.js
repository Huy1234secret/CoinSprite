const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('AI moderation uses the concise context-aware schema', () => {
  const ai = fs.readFileSync(path.join(root, 'src', 'aiModeration.js'), 'utf8');
  const prompt = ai.match(/const SYSTEM_PROMPT = \[[\s\S]*?\]\.join\(' '\);/)?.[0] || '';

  assert.match(prompt, /recent conversation context/);
  assert.match(prompt, /flagged.*s.*rules.*englishTranslation/s);
  assert.doesNotMatch(prompt, /matchedTerms|originalLanguage|reason/);
  assert.match(ai, /required: \['flagged', 's', 'rules', 'englishTranslation'\]/);
  assert.match(ai, /Target message:.*Recent context:/s);
});

test('moderation report omits matched terms and reason', () => {
  const moderator = fs.readFileSync(path.join(root, 'commands', 'moderator.js'), 'utf8');
  const templates = fs.readFileSync(path.join(root, 'src', 'messageTemplates.js'), 'utf8');
  const report = templates.match(/id: 'ai-moderation-alert',[\s\S]*?componentRows:/)?.[0] || '';

  assert.match(moderator, /recentModerationContext/);
  assert.match(moderator, /translation-section/);
  assert.match(report, /AI moderation report/);
  assert.match(report, /\*\*Rules:\*\*/);
  assert.match(report, /<translation-section>/);
  assert.doesNotMatch(report, /matched-terms|moderation-reason|original-language/);
});
