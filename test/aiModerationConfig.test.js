const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('AI moderation uses the concise case-and-reason schema', () => {
  const ai = fs.readFileSync(path.join(root, 'src', 'aiModeration.js'), 'utf8');
  const prompt = ai.match(/const SYSTEM_PROMPT = \[[\s\S]*?\]\.join\(' '\);/)?.[0] || '';

  assert.match(prompt, /Review only the target Message/);
  assert.match(prompt, /every language.*Burmese.*non-Latin scripts/i);
  assert.match(prompt, /severity rating.*case label.*reason/i);
  assert.doesNotMatch(prompt, /matchedTerms|originalLanguage|englishTranslation/);
  assert.match(ai, /required: \['s', 'case', 'reason'\]/);
  assert.doesNotMatch(ai.match(/function moderationSchema\(\) \{[\s\S]*?\n\}/)?.[0] || '', /flagged|translated/);
  assert.match(ai, /const text = `Message: \$\{target\}/);
  assert.equal((ai.match(/store: true/g) || []).length, 2);
});

test('AI report contains the requested fields and only sends flagged results', () => {
  const moderator = fs.readFileSync(path.join(root, 'commands', 'moderator.js'), 'utf8');
  const templates = fs.readFileSync(path.join(root, 'src', 'messageTemplates.js'), 'utf8');
  const report = templates.match(/id: 'ai-moderation-alert',[\s\S]*?componentRows:/)?.[0] || '';

  for (const field of ['User', 'Channel', 'Severity', 'Case', 'Reason', 'Message']) {
    assert.match(report, new RegExp(`\\*\\*${field}:\\*\\*`));
  }
  assert.doesNotMatch(report, /\*\*Rules:\*\*|translation-section|matched-terms|original-language/);
  assert.match(moderator, /\['moderation-case', moderationCase\]/);
  assert.match(moderator, /if \(!result\.flagged\) return;/);
  assert.match(moderator, /moderationLogChannelId\(result, settings\)/);
  assert.doesNotMatch(moderator, /messageScreenshot|moderationScreenshot|attachScreenshotToPayload/);
});
