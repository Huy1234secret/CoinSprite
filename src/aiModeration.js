'use strict';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4o-mini';
const FALLBACK_TERMS = [
  'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'dick', 'pussy', 'cunt',
  'kill yourself', 'kys', 'nigger', 'faggot', 'retard', 'whore', 'slut',
  'idiot', 'idiota', 'stupid', 'dumbass', 'moron', 'imbecile',
  'estupido', 'estupida', 'tonto', 'tonta', 'imbecil',
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
    .replace(/[@$!|]/g, (char) => ({ '@': 'a', '$': 's', '!': 'i', '|': 'i' }[char] || char));
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

function fallbackAnalyze(content) {
  const normalized = normalizeForScan(content);
  const matchedTerms = FALLBACK_TERMS.filter((term) => normalized.includes(term));
  return {
    flagged: matchedTerms.length > 0,
    severity: matchedTerms.length > 1 ? 'high' : matchedTerms.length ? 'medium' : 'none',
    categories: matchedTerms.length ? ['profanity_or_abuse'] : [],
    matchedTerms,
    originalLanguage: matchedTerms.length ? fallbackLanguage(normalized) : 'unknown',
    englishTranslation: fallbackEnglish(content, normalized),
    reason: matchedTerms.length
      ? 'Fallback moderation scan matched abusive wording. Configure OPENAI_API_KEY for stronger multilingual AI review.'
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
  return {
    flagged: Boolean(value.flagged),
    severity: ['low', 'medium', 'high', 'critical'].includes(value.severity) ? value.severity : (value.flagged ? 'medium' : 'none'),
    categories: Array.isArray(value.categories) ? value.categories.map(String).slice(0, 8) : [],
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

async function analyzeWithOpenAI(content) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || typeof fetch !== 'function') return null;

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODERATION_MODEL || DEFAULT_MODEL,
      input: [
        {
          role: 'system',
          content: [
            'You are a Discord moderation classifier.',
            'Translate the user message to English when it is not English.',
            'Flag profanity, hate or harassment, sexual insults, self-harm encouragement, threats, direct personal insults, and attempts to bypass filters.',
            'Direct insults like calling someone an idiot or stupid should be flagged as low or medium severity, even in non-English languages.',
            'Return only compact JSON with keys: flagged boolean, severity low|medium|high|critical, categories array, matchedTerms array, originalLanguage string, englishTranslation string, reason string.',
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
  return normalizeResult(parseJsonObject(responseText(payload)), 'ai');
}

async function analyzeModerationMessage(content) {
  const text = compactWhitespace(content);
  if (!text) return normalizeResult({ flagged: false, severity: 'none' }, 'empty');
  try {
    const aiResult = await analyzeWithOpenAI(text);
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
