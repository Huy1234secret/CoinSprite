'use strict';

const moderationKeywords = require('../data/moderation-keywords.json');
const { recordUsage } = require('./aiTokenUsageStats');

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_AI_CHARS = 300;
const MIN_ALERT_SEVERITY_SCORE = 2;
const RULE_IDS = Object.freeze(['1.1', '1.5', '2.4', '3.1', '3.2', '3.3']);
const CATEGORY_RULES = Object.freeze({
  rule_1_1_respect: '1.1',
  rule_1_1_respect_or_rule_3_2_harassment: '1.1',
  rule_1_5_politics_religion: '1.5',
  rule_2_4_edating: '2.4',
  rule_3_1_nsfw: '3.1',
  rule_3_2_hate_harassment: '3.2',
  rule_3_3_sexual_misconduct: '3.3',
});
const RULE_GUIDE = '1.1 abuse/bullying/disruptive profanity; 1.5 politics/religion; 2.4 public dating/romance; 3.1 NSFW/gore; 3.2 hate/threats/dox/self-harm; 3.3 sexual misconduct/minors/coercion.';
const SYSTEM_PROMPT = [
  'Return JSON only.',
  'Clean or severity under 2: {"flagged":false,"s":0,"rules":[],"reason":""}.',
  'Violation severity 2-10: {"flagged":true,"s":2,"rules":["1.1"],"reason":"short"}.',
  'Rules must be numbers only; reason max 8 words.',
  RULE_GUIDE,
].join(' ');
const SEVERITY_POINTS = Object.freeze({ minor: 2, major: 5, severe: 9 });

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeForScan(value) {
  return compactWhitespace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[@$!|013457+]/g, (char) => ({
      '@': 'a',
      '$': 's',
      '!': 'i',
      '|': 'i',
      '0': 'o',
      '1': 'i',
      '3': 'e',
      '4': 'a',
      '5': 's',
      '7': 't',
      '+': 't',
    }[char] || char));
}

function normalizeRawForPattern(value) {
  return compactWhitespace(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '');
}

function compileKeywordRules() {
  const rules = [];
  for (const severity of ['minor', 'major', 'severe']) {
    for (const entry of moderationKeywords?.[severity] || []) {
      const patterns = (entry.patterns || []).map((pattern) => {
        try { return new RegExp(pattern, 'i'); } catch { return null; }
      }).filter(Boolean);
      if (patterns.length) rules.push({ ...entry, severity, patterns });
    }
  }
  return rules;
}

const KEYWORD_RULES = compileKeywordRules();

function keywordMatches(content) {
  const raw = normalizeRawForPattern(content);
  return KEYWORD_RULES.filter((entry) => entry.patterns.some((pattern) => pattern.test(raw)));
}

function shouldUseAiModeration(content) {
  return Boolean(compactWhitespace(content));
}

function ruleId(value) {
  const text = compactWhitespace(value);
  return RULE_IDS.find((rule) => text === rule || text.includes(rule)) || '';
}

function rulesFromCategories(categories = []) {
  const ids = [];
  for (const category of categories) {
    const mapped = CATEGORY_RULES[String(category || '')];
    if (mapped) ids.push(mapped);
    if (String(category || '').includes('rule_3_2')) ids.push('3.2');
  }
  return [...new Set(ids)].filter(Boolean);
}

function rulesFromMatches(matches = []) {
  const ids = rulesFromCategories(matches.map((entry) => entry.category).filter(Boolean));
  if (ids.length) return ids;
  return matches.length ? ['1.1'] : [];
}

function normalizeScore(value, fallback = 0) {
  const score = Number(value);
  const safe = Number.isFinite(score) ? score : fallback;
  return Math.max(0, Math.min(10, Math.round(safe * 100) / 100));
}

function severityFromScore(score, flagged = false) {
  if (!flagged || score < MIN_ALERT_SEVERITY_SCORE) return 'none';
  if (score >= 8) return 'critical';
  if (score >= 5) return 'high';
  return 'medium';
}

function cleanResult(source = 'clean') {
  return {
    flagged: false,
    severity: 'none',
    severityScore: 0,
    categories: [],
    brokenRules: [],
    matchedTerms: [],
    originalLanguage: '',
    englishTranslation: '',
    reason: '',
    source,
  };
}

function fallbackScore(matches = []) {
  return matches.reduce((score, entry) => Math.max(score, SEVERITY_POINTS[entry.severity] || 1), 0);
}

function fallbackAnalyze(content) {
  const text = compactWhitespace(content);
  const matches = keywordMatches(text);
  const score = matches.length ? fallbackScore(matches) : 0;
  const flagged = score >= MIN_ALERT_SEVERITY_SCORE;
  if (!flagged) return cleanResult(matches.length ? 'fallback-low' : 'fallback');

  const categories = [...new Set(matches.map((entry) => entry.category).filter(Boolean))];
  const matchedTerms = [...new Set(matches.map((entry) => entry.term).filter(Boolean))].slice(0, 10);
  return {
    flagged: true,
    severity: severityFromScore(score, true),
    severityScore: score,
    categories,
    brokenRules: rulesFromMatches(matches),
    matchedTerms,
    originalLanguage: '',
    englishTranslation: '',
    reason: 'Local rule match.',
    source: 'fallback',
  };
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  if (!text) return { flagged: false, s: 0, rules: [], reason: '' };
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI moderation response did not contain JSON.');
    return JSON.parse(match[0]);
  }
}

function normalizeResult(value = {}, source = 'ai') {
  const score = Boolean(value.flagged)
    ? normalizeScore(value.s ?? value.score ?? value.severityScore ?? value.severity_score, 0)
    : 0;
  if (!value.flagged || score < MIN_ALERT_SEVERITY_SCORE) return cleanResult(source);

  const ruleSource = Array.isArray(value.rules)
    ? value.rules
    : Array.isArray(value.ruleIds)
      ? value.ruleIds
      : Array.isArray(value.brokenRules || value.broken_rules)
        ? (value.brokenRules || value.broken_rules)
        : [];
  const categories = Array.isArray(value.categories) ? value.categories.map(String).slice(0, 8) : [];
  const brokenRules = [...new Set([
    ...ruleSource.map(ruleId).filter(Boolean),
    ...rulesFromCategories(categories),
  ])].slice(0, 6);

  return {
    flagged: true,
    severity: severityFromScore(score, true),
    severityScore: score,
    brokenRules,
    categories,
    matchedTerms: [],
    originalLanguage: '',
    englishTranslation: '',
    reason: compactWhitespace(value.reason || 'Rule violation.').slice(0, 120),
    source,
  };
}

function responseText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  const parts = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) parts.push(content.text);
      if (content.type === 'text' && content.text) parts.push(content.text);
    }
  }
  return parts.join('\n');
}

function aiInputText(content, context = {}) {
  const configured = Number(context.maxInputChars) || DEFAULT_MAX_AI_CHARS;
  const maxInputChars = Math.max(20, Math.min(configured, DEFAULT_MAX_AI_CHARS));
  const text = String(content || '').trim();
  return text.length > maxInputChars ? text.slice(0, maxInputChars) : text;
}

async function analyzeWithOpenAI(content, context = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return null;
  const model = process.env.OPENAI_MODERATION_MODEL || DEFAULT_MODEL;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: aiInputText(content, context) },
      ],
      max_output_tokens: 60,
      temperature: 0,
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: 'moderation_result',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['flagged', 's', 'rules', 'reason'],
            properties: {
              flagged: { type: 'boolean' },
              s: { type: 'number' },
              rules: { type: 'array', items: { type: 'string', enum: RULE_IDS } },
              reason: { type: 'string' },
            },
          },
        },
        verbosity: 'low',
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI moderation request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const payload = await response.json();
  const result = normalizeResult(parseJsonObject(responseText(payload)), 'ai');
  try {
    recordUsage({ guildId: context.guildId, model, usage: payload.usage, source: 'openai' });
  } catch {}
  return result;
}

async function analyzeModerationMessage(content, context = {}) {
  const text = compactWhitespace(content);
  if (!text) return cleanResult('empty');

  const fallback = fallbackAnalyze(text);
  try {
    const aiResult = await analyzeWithOpenAI(text, context);
    if (aiResult) return aiResult;
  } catch (error) {
    if (fallback.flagged) {
      fallback.reason = compactWhitespace(`AI unavailable; ${fallback.reason || error.message}`).slice(0, 120);
      return fallback;
    }
    return cleanResult('ai-error');
  }

  return fallback.flagged ? fallback : cleanResult('local-skip');
}

module.exports = { analyzeModerationMessage, fallbackAnalyze, shouldUseAiModeration };
