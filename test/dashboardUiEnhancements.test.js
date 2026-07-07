'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function source(file) {
  return fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
}

test('dashboard bundle loads the shared rich editor and UI enhancements', () => {
  const bundle = source('src/adminServer.js');
  assert.match(bundle, /rich-message-editor\.js/);
  assert.match(bundle, /dashboard-ui-enhancements\.js/);
  assert.ok(bundle.indexOf('rich-message-editor.js') < bundle.indexOf('dashboard-ui-enhancements.js'));
});

test('live previews share container controls, root text, and complete placeholder help', () => {
  const script = source('admin/dashboard-ui-enhancements.js');
  const richEditor = source('admin/rich-message-editor.js');
  const messages = source('admin/messages.js');
  assert.match(richEditor, /className = 'rich-container-remove'/);
  assert.match(richEditor, /container\.append\(remove\)/);
  assert.match(script, /rich-add-container/);
  assert.match(script, /message-root-content\.message-root-empty/);
  assert.match(messages, /message-root-gap-line/);
  assert.doesNotMatch(messages, /<strong>Add message<\/strong>/);
  assert.match(messages, /message-preview-remove-container/);
  assert.match(messages, />Add Container<\/button>/);
  assert.match(script, /dashboard-placeholder-reference/);
  for (const token of ['<server>', '<channel>', '<@mention>', '<level>', '<ticket_id>', '<appeal-id>', '<moderation-action>', '<moderator-id>', '<notice-delivery>', '<severity-tier>', '<channel-rule>', '<separator>']) {
    assert.ok(script.includes(token), 'missing placeholder ' + token);
  }
  assert.match(script, /collectPatch = wrapped/);
  assert.match(script, /containers: current\.containers/);
  assert.match(script, /Supported operators/);
  assert.match(script, /&gt;=/);
  assert.match(script, /&lt;=/);
});

test('old message placeholder palette is removed in favor of shared compact syntax help', () => {
  const components = source('admin/message-components.js');
  const enhancements = source('admin/dashboard-ui-enhancements.js');
  assert.doesNotMatch(components, /tokenPalette|data-placeholder-token|Message formats/);
  assert.match(enhancements, /\.message-placeholder-palette/);
  assert.match(enhancements, /dashboard-placeholder-token-row/);
  assert.match(enhancements, /dashboard-placeholder-usage/);
});

test('dashboard section tabs stay in normal flow and owner escaped-newline artifacts are removed', () => {
  const script = source('admin/dashboard-ui-enhancements.js');
  const baseStyles = source('admin/style.css');
  const bootstrap = source('admin/bootstrap.js');
  assert.match(script, /dashboard-section-tabs/);
  assert.match(script, /position: static !important/);
  assert.doesNotMatch(script, /dashboard-sticky-tabs|position: sticky/);
  assert.match(baseStyles, /\.mini-tabs\s*\{[\s\S]*?position: static/);
  assert.doesNotMatch(bootstrap, /position: sticky/);
  assert.match(script, /removeEscapedNewlineArtifacts/);
  assert.match(script, /\\\\n/);
});
