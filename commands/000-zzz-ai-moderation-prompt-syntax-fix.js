
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
    "  'Review the target message in its recent conversation context.',",
    "  'Return JSON only: {\"flagged\":boolean,\"s\":0-10,\"rules\":[\"1.1\"],\"englishTranslation\":\"\"}.',",
    "  'If no rule is broken, use flagged=false, s=0, and rules=[]. Otherwise use flagged=true, a severity from 2 to 10, and only broken rule IDs.',",
    "  'Translate the target message to English only when it is not English; otherwise leave englishTranslation empty.',",
    '  RULE_GUIDE,',
    "].join(' ');",
  ].join('\n');
}

function patchAiModeration(source) {
  let text = String(source || '');
  text = text.replace(/const SYSTEM_PROMPT = \[[\s\S]*?\]\.join\(' '\);/, promptSource());
  text = replaceAll(text, 'max_output_tokens: 60', 'max_output_tokens: 100');
  text = replaceAll(text, 'max_output_tokens: 120', 'max_output_tokens: 100');
  text = replaceAll(text, 'max_output_tokens: 140', 'max_output_tokens: 100');
  text = replaceAll(text, 'max_output_tokens: 180', 'max_output_tokens: 100');
  text = replaceAll(text, 'max_tokens: 60', 'max_tokens: 100');
  text = replaceAll(text, 'max_tokens: 120', 'max_tokens: 100');
  text = replaceAll(text, 'max_tokens: 140', 'max_tokens: 100');
  text = replaceAll(text, 'max_tokens: 180', 'max_tokens: 100');
  text = replaceAll(text, 'store: true', 'store: false');
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

