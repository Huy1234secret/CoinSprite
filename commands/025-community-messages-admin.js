'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'admin', 'index.html');
const SCRIPT = [
  '  <script src="/admin/rich-message-editor.js?v=rich-editor-1" defer></script>',
  '  <script src="/admin/community-messages.js?v=community-messages-2" defer></script>',
].join('\\n');
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(TARGET);
}

function patchIndex(source) {
  const text = String(source || '');
  if (text.includes('/admin/rich-message-editor.js') && text.includes('/admin/community-messages.js')) return text;
  return text.replace('</body>', SCRIPT + '\n</body>');
}

function patchData(filePath, data, options) {
  if (!samePath(filePath)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchIndex(original);
  return patched === original ? data : encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCommunityMessages(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};

fs.readFileSync = function readFileSyncWithCommunityMessages(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchIndex };
