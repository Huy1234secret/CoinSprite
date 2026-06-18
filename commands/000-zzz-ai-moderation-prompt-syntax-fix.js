
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
    "  'JSON only. Score each message independently.',",
    "  'Below 2: unflagged with s=0 and empty detail fields. Otherwise flagged with a decimal s from 2 to 10.',",
    "  'Scale: 2-3 mild; 4-5 targeted or repeated; 6-7 serious; 8-9 threats, hate, doxxing, or high risk; 10 extreme danger or exploitation.',",
    "  'Reason: message-specific, one short sentence, max 80 chars. Use rule IDs only; include language, English translation, and exact matched terms.',",
    '  RULE_GUIDE,',
    "].join(' ');",
  ].join('\n');
}

function patchAiModeration(source) {
  let text = String(source || '');
  text = text.replace(/const SYSTEM_PROMPT = \[[\s\S]*?\]\.join\(' '\);/, promptSource());
  text = replaceAll(text, 'max_output_tokens: 60', 'max_output_tokens: 140');
  text = replaceAll(text, 'max_output_tokens: 120', 'max_output_tokens: 140');
  text = replaceAll(text, 'max_tokens: 60', 'max_tokens: 140');
  text = replaceAll(text, 'max_tokens: 120', 'max_tokens: 140');
  text = replaceAll(text, 'store: false', 'store: true');
  text = replaceAll(text, 'return reason.slice(0, 180);', 'return reason.slice(0, 80);');
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

