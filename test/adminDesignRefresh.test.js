'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('admin loads the refresh after the existing design layers', () => {
  const html = read('admin/index.html');
  const baseIndex = html.indexOf('/admin/style.css');
  const unifiedIndex = html.indexOf('/admin/unified-design.css');
  const refreshIndex = html.indexOf('/admin/design-refresh.css');
  const workspaceIndex = html.indexOf('/admin/design-workspaces.css');

  assert.ok(baseIndex >= 0);
  assert.ok(unifiedIndex > baseIndex);
  assert.ok(refreshIndex > unifiedIndex);
  assert.ok(workspaceIndex > refreshIndex);
});

test('refresh is presentation-only, responsive, and motion-aware', () => {
  const css = read('admin/design-refresh.css');

  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /button:focus-visible/);
  assert.doesNotMatch(css, /url\(|data:/);
  const backdropFilters = css.match(/backdrop-filter:[^;]+;/g) || [];
  assert.ok(backdropFilters.every((rule) => /backdrop-filter:\s*none\s*!important;/.test(rule)));
});

test('workspace layer covers every major admin surface without remote assets', () => {
  const html = read('admin/index.html');
  const css = read('admin/design-workspaces.css');

  for (const selector of [
    '#ticketEditorRoot', '#messageTemplatesRoot', '#moderatorRoot', '#userDataRoot',
    '#appealAdminRoot', '.owner-panel-page', '.site-info-page', '.channel-rule-editor',
  ]) assert.ok(css.includes(selector), `missing workspace coverage for ${selector}`);

  assert.match(html, /class="sidebar-nav-label"/);
  assert.match(css, /@media \(max-width: 600px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(css, /url\(|data:/);
  const backdropFilters = css.match(/backdrop-filter:[^;]+;/g) || [];
  assert.ok(backdropFilters.every((rule) => /backdrop-filter:\s*none\s*!important;/.test(rule)));
});

test('login improvements preserve the OAuth and session hooks', () => {
  const html = read('admin/index.html');

  assert.match(html, /id="loginPanel"/);
  assert.match(html, /id="loginStatus"/);
  assert.match(html, /href="\/auth\/discord"/);
  assert.match(html, /class="login-eyebrow"/);
  assert.match(html, /class="login-trust"/);
});
