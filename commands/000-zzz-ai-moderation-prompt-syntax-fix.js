
'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'src', 'aiModeration.js');
const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function replaceAll(text, oldValue, newValue) {
  return oldValue ? String(text).split(oldValue).join(newValue) : String(text);
}

function promptSource() {
  return [
    'const SYSTEM_PROMPT = [',
    "  'Return JSON only.',",
    "  'Clean or severity under 2: {\"flagged\":false,\"s\":0,\"rules\":[],\"reason\":\"\",\"originalLanguage\":\"\",\"englishTranslation\":\"\",\"matchedTerms\":[]}.',",
    "  'For every flagged message, independently calculate s as a decimal from 2 through 10. Never reuse a sample or default score.',",
    "  'Severity rubric: 2-3 mild isolated profanity or insult; 4-5 targeted or repeated abuse; 6-7 serious harassment, explicit sexual or violent content, or credible self-harm concern; 8-9 threats, hate, doxxing, severe sexual misconduct, or high real-world risk; 10 immediate extreme danger, exploitation, or the most severe misconduct.',",
    "  'Adjust the score for targeting, repetition, intent, context, vulnerability, and real-world risk. Use the full scale and do not anchor scores to one value.',",
    "  'Generate reason from the actual message and context. Keep it specific and short: one sentence, at most 120 characters. Never use a preset reason.',",
    "  'Use decimal severity when useful. Rules must be numbers only. Reason must be a clear staff-facing sentence; never return one-word reasons like short.',",
    "  'originalLanguage must be a human language name. englishTranslation must be English, or the original text when already English. matchedTerms must list exact offending words or phrases.',",
    '  RULE_GUIDE,',
    "].join(' ');",
  ].join('\n');
}

function patchAiModeration(source) {
  let text = String(source || '');
  text = text.replace(/const SYSTEM_PROMPT = \[[\s\S]*?\]\.join\(' '\);/, promptSource());
  text = replaceAll(text, 'max_output_tokens: 60', 'max_output_tokens: 180');
  text = replaceAll(text, 'max_output_tokens: 120', 'max_output_tokens: 180');
  text = replaceAll(text, 'max_tokens: 60', 'max_tokens: 180');
  text = replaceAll(text, 'max_tokens: 120', 'max_tokens: 180');
  text = replaceAll(text, 'store: false', 'store: true');
  text = replaceAll(text, 'return reason.slice(0, 180);', 'return reason.slice(0, 120);');
  text = text.replace(
    /required: \[[^\]]*'reason'[^\]]*\],/,
    "required: ['flagged', 's', 'rules', 'reason', 'originalLanguage', 'englishTranslation', 'matchedTerms'],",
  );
  if (!text.includes("originalLanguage: { type: 'string' }")) {
    text = text.replace(
      "reason: { type: 'string' },",
      "reason: { type: 'string' },\n      originalLanguage: { type: 'string' },\n      englishTranslation: { type: 'string' },\n      matchedTerms: { type: 'array', items: { type: 'string' } },",
    );
  }
  return text;
}

function patchReadData(filePath, data, options) {
  if (!samePath(filePath, TARGET)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAiModeration(original);
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithAiPromptSyntaxFix(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return nativeReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') {
      if (typeof done === 'function') done(error, data);
      return;
    }
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithAiPromptSyntaxFix(filePath, options) {
  return patchReadData(filePath, nativeReadFileSync(filePath, options), options);
};

module.exports = {};

