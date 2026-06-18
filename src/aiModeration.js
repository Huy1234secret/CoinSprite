'use strict';

const moderationKeywords = require('../data/moderation-keywords.json');
const { recordUsage } = require('./aiTokenUsageStats');

const OPENAI_RESPONSES_API_URL = 'https://api.openai.com/v1/responses';
const OPENAI_CHAT_API_URL = 'https://api.openai.com/v1/chat/completions';
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
  'Judge Message using Context and the server rules.',
  'JSON only: {"flagged":false,"s":0,"case":"","reason":""}. Flag only a rule violation; if flagged, use s=2-10, a short case label such as NSFW, and a short reason.',
  RULE_GUIDE,
].join(' ');
const SEVERITY_POINTS = Object.freeze({ minor: 2, major: 5, severe: 9 });

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
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

function aiDebugEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.AI_MODERATION_DEBUG || '').toLowerCase());
}

function logAiModerationError(label, error) {
  if (!aiDebugEnabled()) return;
  const message = compactWhitespace(error?.message || error || 'unknown error').slice(0, 600);
  console.warn(`[AI MODERATION] ${label} ${message}`);
}

function moderationSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['flagged', 's', 'case', 'reason'],
    properties: {
      flagged: { type: 'boolean' },
      s: { type: 'number' },
      case: { type: 'string' },
      reason: { type: 'string' },
    },
  };
}

function responsesTextFormat() {
  return {
    type: 'json_schema',
    name: 'moderation_result',
    strict: true,
    schema: moderationSchema(),
  };
}

function chatResponseFormat() {
  return {
    type: 'json_schema',
    json_schema: {
      name: 'moderation_result',
      strict: true,
      schema: moderationSchema(),
    },
  };
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

const RULE_CASES = Object.freeze({
  '1.1': 'Abuse or disruption',
  '1.5': 'Politics or religion',
  '2.4': 'Public dating or romance',
  '3.1': 'NSFW or gore',
  '3.2': 'Harassment or high-risk harm',
  '3.3': 'Sexual misconduct',
});

function moderationCaseLabel(rules = []) {
  return RULE_CASES[String(rules[0] || '')] || 'Rule violation';
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
    case: '',
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
  const brokenRules = rulesFromMatches(matches);
  return {
    flagged: true,
    severity: severityFromScore(score, true),
    severityScore: score,
    categories,
    brokenRules,
    matchedTerms,
    originalLanguage: '',
    englishTranslation: '',
    case: moderationCaseLabel(brokenRules),
    reason: 'Matched a local server-rule pattern.',
    source: 'fallback',
  };
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  if (!text) return { flagged: false, s: 0, case: '', reason: '' };
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

  const moderationCase = compactWhitespace(value.case ?? value.category ?? value.label).slice(0, 80);
  const reason = compactWhitespace(value.reason).slice(0, 180);
  return {
    flagged: true,
    severity: severityFromScore(score, true),
    severityScore: score,
    brokenRules: [],
    categories: moderationCase ? [moderationCase] : [],
    matchedTerms: [],
    originalLanguage: '',
    englishTranslation: '',
    case: moderationCase || 'Rule violation',
    reason: reason || 'The message breaks a server rule.',
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

function chatText(payload) {
  return payload?.choices?.[0]?.message?.content || '';
}

function aiInputText(content, context = {}) {
  const configured = Number(context.maxInputChars) || DEFAULT_MAX_AI_CHARS;
  const maxInputChars = Math.max(20, Math.min(configured, DEFAULT_MAX_AI_CHARS));
  const target = compactWhitespace(content);
  const recentContext = compactWhitespace(context.recentContext);
  const text = recentContext
    ? `Message: ${target}\nContext: ${recentContext}`
    : `Message: ${target}`;
  return text.length > maxInputChars ? text.slice(0, maxInputChars) : text;
}

async function postOpenAI(url, apiKey, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`OpenAI request failed (${response.status}): ${bodyText.slice(0, 300)}`);
  }

  return response.json();
}

async function analyzeWithResponsesApi(apiKey, model, input, context) {
  const payload = await postOpenAI(OPENAI_RESPONSES_API_URL, apiKey, {
    model,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input },
    ],
    max_output_tokens: 80,
    store: true,
    text: { format: responsesTextFormat() },
  });
  try {
    recordUsage({ guildId: context.guildId, model, usage: payload.usage, source: 'openai-responses' });
  } catch {}
  return normalizeResult(parseJsonObject(responseText(payload)), 'ai');
}

async function analyzeWithChatApi(apiKey, model, input, context) {
  const payload = await postOpenAI(OPENAI_CHAT_API_URL, apiKey, {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: input },
    ],
    max_tokens: 80,
    store: true,
    response_format: chatResponseFormat(),
  });
  try {
    recordUsage({ guildId: context.guildId, model, usage: payload.usage, source: 'openai-chat' });
  } catch {}
  return normalizeResult(parseJsonObject(chatText(payload)), 'ai-chat');
}

async function analyzeWithOpenAI(content, context = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return null;
  const model = process.env.OPENAI_MODERATION_MODEL || DEFAULT_MODEL;
  const input = aiInputText(content, context);

  try {
    return await analyzeWithResponsesApi(apiKey, model, input, context);
  } catch (error) {
    logAiModerationError('responses-error', error);
    return analyzeWithChatApi(apiKey, model, input, context);
  }
}

async function analyzeModerationMessage(content, context = {}) {
  const text = compactWhitespace(content);
  if (!text) return cleanResult('empty');

  const fallback = fallbackAnalyze(text);
  try {
    const aiResult = await analyzeWithOpenAI(text, context);
    if (aiResult) return aiResult;
  } catch (error) {
    logAiModerationError('openai-error', error);
    if (fallback.flagged) {
      fallback.reason = compactWhitespace(`AI unavailable; ${fallback.reason || error.message}`).slice(0, 120);
      return fallback;
    }
    return cleanResult('ai-error');
  }

  return fallback.flagged ? fallback : cleanResult('local-skip');
}

module.exports = { analyzeModerationMessage, fallbackAnalyze, shouldUseAiModeration };
