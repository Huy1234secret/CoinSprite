'use strict';

const { recordUsage } = require('./aiTokenUsageStats');

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o-mini';
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
  'Server rules:',
  `${RULE_LABELS['1.1']}: Swearing is allowed, but excessive swearing, targeted insults, provocation, harassment, or disruptive arguments are not allowed.`,
  `${RULE_LABELS['1.5']}: Political or religious discussions are prohibited.`,
  `${RULE_LABELS['2.4']}: Public e-dating, romantic roleplay, or seeking romantic partners is prohibited.`,
  `${RULE_LABELS['3.1']}: NSFW, explicit sexual, gory, or highly inappropriate content is banned.`,
  `${RULE_LABELS['3.2']}: Hate speech, bullying, discrimination, targeted abuse, and threats are zero tolerance.`,
  `${RULE_LABELS['3.3']}: Sexual conversations, sexual roleplay, or inappropriate advances toward members are prohibited.`,
  'Use the rules to decide whether the message really breaks policy. Do not flag casual non-targeted swearing by itself.',
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
  { term: 'fuck you', pattern: /\bf[\W_]*[u@][\W_]*c[\W_]*k[\W_]+(?:y[\W_]*[o0][\W_]*u|u)\b/i },
  { term: 'cock', pattern: /\bc[\W_]*[o0][\W_]*c[\W_]*k\b/i },
];
const FALLBACK_TRANSLATIONS = [
  { pattern: /\beres\s+un\s+idiota\b/i, english: 'you are an idiot' },
  { pattern: /\beres\s+una\s+idiota\b/i, english: 'you are an idiot' },
  { pattern: /\beres\s+estupido\b/i, english: 'you are stupid' },
  { pattern: /\beres\s+estupida\b/i, english: 'you are stupid' },
];

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

function matchedFallbackTerms(content, normalized) {
  const terms = FALLBACK_TERMS.filter((term) => normalized.includes(term));
  const raw = normalizeRawForPattern(content);
  for (const entry of OBFUSCATED_FALLBACK_PATTERNS) {
    if (entry.pattern.test(raw)) terms.push(entry.term);
  }
  return [...new Set(terms)];
}

function fallbackEnglish(content, normalized) {
  for (const entry of FALLBACK_TRANSLATIONS) {
    if (entry.pattern.test(normalized)) return entry.english;
  }
  return compactWhitespace(content).slice(0, 1000);
}

function fallbackLanguage(normalized) {
  if (/\b(eres|idiota|estupido|estupida|tonto|tonta|imbecil)\b/i.test(normalized)) return 'Spanish';
  return 'unknown';
}

function defaultScoreForSeverity(severity, flagged = false) {
  if (!flagged) return 0;
  if (severity === 'critical') return 9;
  if (severity === 'high') return 6.5;
  if (severity === 'medium') return 3.5;
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

function fallbackRules(matchedTerms) {
  const terms = new Set(matchedTerms);
  const rules = new Set();
  const respectTerms = ['fuck you', 'you are a bitch', 'youre a bitch', 'you are an idiot', 'youre an idiot', 'idiota', 'dumbass', 'moron', 'imbecile', 'estupido', 'estupida', 'imbecil'];
  const hateTerms = ['kill yourself', 'kys', 'nigger', 'faggot', 'retard'];
  const sexualTerms = ['cock'];
  if ([...terms].some((term) => respectTerms.includes(term) || hateTerms.includes(term))) rules.add('1.1');
  if ([...terms].some((term) => hateTerms.includes(term))) rules.add('3.2');
  if ([...terms].some((term) => sexualTerms.includes(term))) {
    rules.add('3.1');
    rules.add('3.3');
  }
  if (!rules.size && terms.size) rules.add('1.1');
  return [...rules].map((key) => RULE_LABELS[key]);
}

function fallbackAnalyze(content) {
  const normalized = normalizeForScan(content);
  const matchedTerms = matchedFallbackTerms(content, normalized);
  const severe = matchedTerms.some((term) => ['kill yourself', 'kys', 'nigger', 'faggot', 'retard'].includes(term));
  const sexual = matchedTerms.some((term) => ['cock'].includes(term));
  const severity = severe ? 'high' : sexual || matchedTerms.length > 1 ? 'medium' : matchedTerms.length ? 'low' : 'none';
  return {
    flagged: matchedTerms.length > 0,
    severity,
    severityScore: matchedTerms.length ? (severe ? 6.5 : sexual || matchedTerms.length > 1 ? 3.5 : 1.25) : 0,
    categories: matchedTerms.length
      ? (severe
        ? ['rule_1_1_respect', 'rule_3_2_hate_harassment']
        : sexual
          ? ['rule_3_1_nsfw', 'rule_3_3_sexual_misconduct']
          : ['rule_1_1_respect'])
      : [],
    brokenRules: matchedTerms.length ? fallbackRules(matchedTerms) : [],
    matchedTerms,
    originalLanguage: matchedTerms.length ? fallbackLanguage(normalized) : 'unknown',
    englishTranslation: fallbackEnglish(content, normalized),
    reason: matchedTerms.length
      ? 'Fallback moderation scan matched abusive, sexual, hateful, or obfuscated wording. Configure OPENAI_API_KEY for full rule-aware review.'
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
            'You are a Discord moderation classifier for CoinSprite.',
            SERVER_RULE_SUMMARY,
            'Review only the single message provided by the user. Do not use or request previous messages for context.',
            'Translate non-English text to English before judging.',
            'Treat obvious bypass spellings, leetspeak, inserted spaces, punctuation, or symbols as the intended word when judging.',
            'Flag only if the message violates a listed rule. Swearing alone is allowed when not targeted, excessive, sexual, hateful, threatening, or disruptive.',
            'Return only compact JSON with keys: flagged boolean, severity low|medium|high|critical, severityScore number from 0 to 10, brokenRules array, categories array, matchedTerms array, originalLanguage string, englishTranslation string, reason string.',
            'severityScore examples: low 1.25, medium 3.5, high 6.5, critical 9.0. Use decimals when useful.',
            `brokenRules must contain exact labels from this list only: ${Object.values(RULE_LABELS).join('; ')}. Include multiple labels if multiple rules are broken.`,
            'Use category values like rule_1_1_respect, rule_1_5_politics_religion, rule_2_4_edating, rule_3_1_nsfw, rule_3_2_hate_harassment, rule_3_3_sexual_misconduct.',
          ].join(' '),
        },
        { role: 'user', content: String(content || '').slice(0, 4000) },
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
  try {
    const aiResult = await analyzeWithOpenAI(text, context);
    if (aiResult) return aiResult;
  } catch (error) {
    const fallback = fallbackAnalyze(text);
    fallback.reason = fallback.flagged
      ? `${fallback.reason}\nAI check failed: ${error.message}`.trim()
      : `AI check failed: ${error.message}`;
    return fallback;
  }
  return fallbackAnalyze(text);
}

module.exports = { analyzeModerationMessage, fallbackAnalyze };
