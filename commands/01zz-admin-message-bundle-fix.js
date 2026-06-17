'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.resolve(__dirname, '02-admin-icon-assets.js');
const nativeReadFileSync = fs.readFileSync.bind(fs);

const CURRENT_BUNDLE_LIST = `const BUNDLED_ADMIN_SCRIPTS = [
  ['tickets.js'],
  ['app.js', (source) => patchTicketUpgradeScript(patchAppScript(source))],
  ['user-data.js'],
  ['emoji-picker.js'],
  ['message-inline-editor.js'],
  ['message-edit-shortcuts.js'],
  ['owner-panel.js'],
];`;

const FIXED_BUNDLE_LIST = `const BUNDLED_ADMIN_SCRIPTS = [
  ['tickets.js'],
  ['app.js', (source) => patchTicketUpgradeScript(patchAppScript(source))],
  ['user-data.js'],
  ['emoji-picker.js'],
  ['message-inline-editor.js'],
  ['message-template-workflow.js'],
  ['messages.js', patchMessagesScript],
  ['message-components.js'],
  ['message-component-actions.js'],
  ['message-tab-inline-editor.js'],
  ['message-edit-shortcuts.js'],
  ['owner-panel.js'],
];`;

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function patchSource(source) {
  let text = String(source || '');
  if (!text.includes("['messages.js', patchMessagesScript]")) {
    text = text.includes(CURRENT_BUNDLE_LIST)
      ? text.replace(CURRENT_BUNDLE_LIST, FIXED_BUNDLE_LIST)
      : text.replace(/const BUNDLED_ADMIN_SCRIPTS = \[[\s\S]*?\];/, FIXED_BUNDLE_LIST);
  }
  if (!text.includes('__coinSpriteAdminBundleIncludesMessages')) {
    text = text.replace(
      'const output = BUNDLED_ADMIN_SCRIPTS.map(([fileName, patch]) => {',
      "const output = 'window.__coinSpriteAdminBundleIncludesMessages = true;\\n' + BUNDLED_ADMIN_SCRIPTS.map(([fileName, patch]) => {",
    );
  }
  return text;
}

function patchReadData(filePath, data, options) {
  if (!samePath(filePath, TARGET)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchSource(original);
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFileSync = function readFileSyncWithAdminMessageBundleFix(filePath, options) {
  return patchReadData(filePath, nativeReadFileSync(filePath, options), options);
};

module.exports = {};
