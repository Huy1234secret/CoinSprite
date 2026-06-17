'use strict';

const moderationKeywords = require('../data/moderation-keywords.json');
const { recordUsage } = require('./aiTokenUsageStats');

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_MAX_AI_CHARS = 1500;
const RULE_LABELS = Object.freeze({
  '1.1': '1.1┆🤝 Be Respectful',
  '1.5': '1.5┆🗣️ No Political or Religious Discussions',
  '2.4': '2.4┆❤️ No E-Dating',
  '3.1': '3.1┆🔞 No NSFW Content',
  '3.2': '3.2┆🚨 No Hate Speech or Harassment',
  '3.3': '3.3┆❤️‍🔥 No Sexual Misconduct',
});
const CATEGORY_RULES = Object.freeze({
  rule_1_1_respect: '1.1',
  rule_1_1_respect_or_rule_3_2_harassment: '1.1',
  rule_1_5_politics_religion: '1.5',
  rule_2_4_edating: '2.4',
  rule_3_1_nsfw: '3.1',
  rule_3_2_hate_harassment: '3.2',
  rule_3_3_sexual_misconduct: '3.3',
});
const SERVER_RULE_SUMMARY = [
  'Rules: swearing is allowed unless targeted, excessive, sexual, hateful, threatening, disruptive, or intentionally obfuscated.',
  'No politics/religion, public e-dating or romantic roleplay, NSFW/gore, hate speech, bullying, discrimination, threats, sexual conversations, sexual roleplay, or inappropriate advances.',
].join(' ');
const FALLBACK_TERMS = [
  'kill yourself', 'kys', 'nigger', 'faggot', 'retard',
  'fuck you', 'you are a bitch', 'youre a bitch', 'you are an idiot', 'youre an idiot',
  'idiota', 'dumbass', 'moron', 'imbecile', 'estupido', 'estupida', 'imbecil',
];
const OBFUSCATED_FALLBACK_PATTERNS = [
  { term: 'nigger', pattern: /\bn[\W_]*[i1!|][\W_]*g(?:[\W_]*g[\W_]*[e3][\W_]*r)?\b/i },
  { term: 'faggot', pattern: /\bf[\W_]*[@a4][\W_]*g[\W_]*g[\W_]*[o0][\W_]*t\b/i },
  { term: 'retard', pattern: /\br[\W_]*[e3][\W_]*t[\W_]*[@a4][\W_]*r[\W_]*d\b/i },
  { term: 'fuck', pattern: /\bf[\W_]*@[\W_]*c[\W_]*k\b/i },
  { term: 'fuck you', pattern: /\bf[\W_]*[u@][\W_]*c[\W_]*k[\W_]+(?:y[\W_]*[o0][\W_]*u|u)\b/i },
  { term: 'cock', pattern: /\bc[\W_]*[o0][\W_]*c[\W_]*k\b/i },
];
const FALLBACK_TRANSLATIONS = [
  { pattern: /\beres\s+un\s+idiota\b/i, english: 'you are an idiot' },
  { pattern: /\beres\s+una\s+idiota\b/i, english: 'you are an idiot' },
  { pattern: /\beres\s+estupido\b/i, english: 'you are stupid' },
  { pattern: /\beres\s+estupida\b/i, english: 'you are stupid' },
];
const URL_PATTERN = /(?:https?:\/\/|www\.)\S+|\b(?:discord\.gg|discord(?:app)?\.com\/invite)\/\S+/i;
const DISCORD_INVITE_PATTERN = /\b(?:discord\.gg|discord(?:app)?\.com\/invite)\/([a-z0-9-]+)/i;
const NON_ASCII_PATTERN = /[^\x00-\x7F]/;
const CAPS_SPAM_PATTERN = /[A-Z]{12,}/;
const REPEATED_SYMBOL_PATTERN = /([!?@#$%^&*])\1{5,}/;
const SAFE_SHORT_PATTERN = /^[\w\s.,!?'-]{1,160}$/;

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
      rules.push({ ...entry, severity, patterns });
    }
  }
  return rules;
}

const KEYWORD_RULES = compileKeywordRules();

function keywordMatches(content) {
  const raw = normalizeRawForPattern(content);
  return KEYWORD_RULES.filter((entry) => entry.patterns.some((pattern) => pattern.test(raw)));
}

function shouldUseAiModeration(content, context = {}) {
  const text = compactWhitespace(content);
  if (!text) return false;
  const maxInputChars = Number(context.maxInputChars) || DEFAULT_MAX_AI_CHARS;
  if (text.length > maxInputChars) return true;
  if (URL_PATTERN.test(text) || DISCORD_INVITE_PATTERN.test(text)) return true;
  if (NON_ASCII_PATTERN.test(text)) return true;
  if (CAPS_SPAM_PATTERN.test(text) || REPEATED_SYMBOL_PATTERN.test(text)) return true;
  const matches = keywordMatches(text);
  if (matches.length) return matches.some((entry) => entry.aiRequired !== false) || matches.some((entry) => entry.severity !== 'severe');
  return !SAFE_SHORT_PATTERN.test(text);
}

function matchedFallbackTerms(content, normalized) {
  const terms = FALLBACK_TERMS.filter((term) => normalized.includes(term));
  const raw = normalizeRawForPattern(content);
  for (const entry of OBFUSCATED_FALLBACK_PATTERNS) {
    if (entry.pattern.test(raw)) terms.push(entry.term);
  }
  for (const entry of keywordMatches(content)) terms.push(entry.term);
  return [...new Set(terms.map(String).filter(Boolean))];
}

function fallbackEnglish(content, normalized) {
  for (const entry of FALLBACK_TRANSLATIONS) {
    if (entry.pattern.test(normalized)) return entry.english;
  }
  return compactWhitespace(content).slice(0, 1000);
}

function fallbackLanguage(normalized) {
  if (/\b(eres|idiota|estupido|estupida|tonto|tonta|imbecil)\b/i.test(normalized)) return 'Spanish';
  if (/\b(aishitemasu|aishiteru|suki\s*desu|daisuki)\b/i.test(normalized)) return 'Japanese romanized';
  return 'unknown';
}

function defaultScoreForSeverity(severity, flagged = false) {
  if (!flagged) return 0;
  if (severity === 'critical' || severity === 'severe') return 9;
  if (severity === 'high') return 6.5;
  if (severity === 'medium' || severity === 'major') return 3.5;
  return 1.25;
}

function severityFromScore(score, flagged = false) {
  if (!flagged || score <= 0) return 'none';
  if (score >= 8) return 'critical';
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

function normalizeScore(value, severity, flagged) {
  const score = Number(value);
  if (Number.isFinite(score)) return Math.max(0, Math.min(10, Math.round(score * 100) / 100));
  return defaultScoreForSeverity(severity, flagged);
}

function normalizeRuleLabel(value) {
  const text = compactWhitespace(value);
  const key = Object.keys(RULE_LABELS).find((rule) => text.includes(rule));
  return key ? RULE_LABELS[key] : '';
}

function brokenRulesFromCategories(categories = []) {
  const keys = [];
  for (const category of categories) {
    const mapped = CATEGORY_RULES[String(category || '')];
    if (mapped) keys.push(mapped);
    if (String(category || '').includes('rule_3_2')) keys.push('3.2');
  }
  return [...new Set(keys)].map((key) => RULE_LABELS[key]).filter(Boolean);
}

function fallbackRules(matchedTerms, categories = []) {
  const terms = new Set(matchedTerms);
  const rules = new Set(brokenRulesFromCategories(categories).map((label) => Object.keys(RULE_LABELS).find((key) => RULE_LABELS[key] === label)).filter(Boolean));
  const respectTerms = ['fuck', 'fuck you', 'you are a bitch', 'youre a bitch', 'you are an idiot', 'youre an idiot', 'idiota', 'dumbass', 'moron', 'imbecile', 'estupido', 'estupida', 'imbecil', 'targeted profanity', 'idiot', 'obfuscated profanity'];
  const hateTerms = ['kill yourself', 'kys', 'nigger', 'faggot', 'retard', 'self harm command', 'racial slur', 'anti-gay slur', 'ableist slur', 'threat language'];
  const sexualTerms = ['cock', 'sexual terms'];
  if ([...terms].some((term) => respectTerms.includes(term) || hateTerms.includes(term))) rules.add('1.1');
  if ([...terms].some((term) => hateTerms.includes(term))) rules.add('3.2');
  if ([...terms].some((term) => sexualTerms.includes(term))) {
    rules.add('3.1');
    rules.add('3.3');
  }
  if ([...terms].some((term) => term === 'romanized affection')) rules.add('2.4');
  if (!rules.size && terms.size) rules.add('1.1');
  return [...rules].map((key) => RULE_LABELS[key]);
}

function fallbackAnalyze(content) {
  const normalized = normalizeForScan(content);
  const matchedTerms = matchedFallbackTerms(content, normalized);
  const matches = keywordMatches(content);
  const categories = [...new Set(matches.map((entry) => entry.category).filter(Boolean))];
  const severe = matchedTerms.some((term) => ['kill yourself', 'kys', 'nigger', 'faggot', 'retard', 'self harm command', 'racial slur', 'anti-gay slur', 'ableist slur'].includes(term));
  const sexual = matchedTerms.some((term) => ['cock', 'sexual terms'].includes(term));
  const severity = severe ? 'high' : sexual || matchedTerms.length > 1 ? 'medium' : matchedTerms.length ? 'low' : 'none';
  return {
    flagged: matchedTerms.length > 0,
    severity,
    severityScore: matchedTerms.length ? (severe ? 6.5 : sexual || matchedTerms.length > 1 ? 3.5 : 1.25) : 0,
    categories: matchedTerms.length
      ? (categories.length ? categories : severe
        ? ['rule_1_1_respect', 'rule_3_2_hate_harassment']
        : sexual
          ? ['rule_3_1_nsfw', 'rule_3_3_sexual_misconduct']
          : ['rule_1_1_respect'])
      : [],
    brokenRules: matchedTerms.length ? fallbackRules(matchedTerms, categories) : [],
    matchedTerms,
    originalLanguage: matchedTerms.length ? fallbackLanguage(normalized) : 'unknown',
    englishTranslation: fallbackEnglish(content, normalized),
    reason: matchedTerms.length
      ? 'Local moderation scan matched abusive, sexual, hateful, romantic, or obfuscated wording.'
      : '',
    source: 'fallback',
  };
}

function parseJsonObject(value) {
  const text = String(value || '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI moderation response did not contain JSON.');
    return JSON.parse(match[0]);
  }
}

function normalizeResult(value, source = 'ai') {
  const categories = Array.isArray(value.categories) ? value.categories.map(String).slice(0, 8) : [];
  const score = normalizeScore(value.severityScore ?? value.severity_score ?? value.score, value.severity, Boolean(value.flagged));
  const severity = ['low', 'medium', 'high', 'critical'].includes(value.severity)
    ? value.severity
    : severityFromScore(score, Boolean(value.flagged));
  const brokenRules = Array.isArray(value.brokenRules || value.broken_rules)
    ? (value.brokenRules || value.broken_rules).map(normalizeRuleLabel).filter(Boolean)
    : [];
  return {
    flagged: Boolean(value.flagged),
    severity,
    severityScore: score,
    brokenRules: [...new Set([...brokenRules, ...brokenRulesFromCategories(categories)])].slice(0, 6),
    categories,
    matchedTerms: Array.isArray(value.matchedTerms) ? value.matchedTerms.map(String).slice(0, 10) : [],
    originalLanguage: compactWhitespace(value.originalLanguage || 'unknown').slice(0, 80),
    englishTranslation: compactWhitespace(value.englishTranslation || '').slice(0, 1000),
    reason: compactWhitespace(value.reason || '').slice(0, 1000),
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

async function analyzeWithOpenAI(content, context = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return null;
  const model = process.env.OPENAI_MODERATION_MODEL || DEFAULT_MODEL;
  const maxInputChars = Number(context.maxInputChars) || DEFAULT_MAX_AI_CHARS;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content: [
            'You are CoinSprite Discord moderation JSON classifier.',
            SERVER_RULE_SUMMARY,
            'Judge only the single provided message. Translate non-English or romanized text before judging.',
            'Treat obvious bypass spellings, leetspeak, inserted spaces, punctuation, or symbols as intended words.',
            'Return compact JSON: flagged, severity low|medium|high|critical, severityScore 0-10, brokenRules, categories, matchedTerms, originalLanguage, englishTranslation, reason.',
            `Use exact brokenRules labels only: ${Object.values(RULE_LABELS).join('; ')}.`,
          ].join(' '),
        },
        { role: 'user', content: String(content || '').slice(0, maxInputChars) },
      ],
      text: { format: { type: 'json_object' } },
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
  if (!text) return normalizeResult({ flagged: false, severity: 'none' }, 'empty');
  const fallback = fallbackAnalyze(text);
  const needsAi = shouldUseAiModeration(text, context);
  const localOnly = fallback.flagged && !keywordMatches(text).some((entry) => entry.aiRequired !== false) && fallback.severityScore >= 3.5;
  if (!needsAi || localOnly) return fallback.flagged ? fallback : normalizeResult({ flagged: false, severity: 'none' }, 'local-skip');
  try {
    const aiResult = await analyzeWithOpenAI(text, context);
    if (aiResult) return aiResult;
  } catch (error) {
    fallback.reason = fallback.flagged
      ? `${fallback.reason}\nAI check failed: ${error.message}`.trim()
      : `AI check failed: ${error.message}`;
    return fallback;
  }
  return fallback;
}

module.exports = { analyzeModerationMessage, fallbackAnalyze, shouldUseAiModeration };
