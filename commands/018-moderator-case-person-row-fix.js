'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
};

const MARKER_V3 = 'coinSpriteModeratorCaseLayoutV3';
const MARKER_FIX = 'coinSpriteModeratorCasePersonRowsFix';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER_FIX) || !text.includes(MARKER_V3)) return text;

  text = text.replace('/* coinSpriteModeratorCaseLayoutV3 */', '/* coinSpriteModeratorCaseLayoutV3 */\n/* coinSpriteModeratorCasePersonRowsFix */');

  const cssNeedle = "    '.case-user-copy small { color: var(--muted, #b7bdc8); font-size: 11px; overflow-wrap: anywhere; }',";
  const cssPatch = [
    cssNeedle,
    "    'body #moderatorRoot .case-layout-v3 .case-info-row { grid-template-columns: minmax(112px,126px) minmax(0,1fr) !important; gap: 14px !important; align-items: center !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-info-row dd { display: block !important; min-width: 0 !important; max-width: 100% !important; overflow: visible !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-info-row dd > div.case-person-cell { min-width: 0 !important; max-width: 100% !important; overflow: visible !important; overflow-wrap: normal !important; word-break: normal !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-chip { display: flex !important; align-items: center !important; gap: 10px !important; width: 100% !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-chip img, body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-fallback { width: 32px !important; height: 32px !important; max-width: 32px !important; max-height: 32px !important; min-width: 32px !important; flex: 0 0 32px !important; border-radius: 999px !important; object-fit: cover !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-copy { display: block !important; flex: 1 1 auto !important; width: calc(100% - 42px) !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-copy strong, body #moderatorRoot .case-layout-v3 .case-user-copy small { display: block !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; overflow-wrap: normal !important; word-break: normal !important; }',",
    "    'body #moderatorRoot .case-layout-v3 .case-user-copy small { margin-top: 2px !important; color: var(--muted, #b7bdc8) !important; font-size: 11px !important; line-height: 1.2 !important; }',",
  ].join('\n');
  text = text.replace(cssNeedle, cssPatch);

  const oldRow = `function caseLayoutRow(label, valueHtml, helper = '') {
  return '<div class="case-info-row"><dt>' + escapeHtml(label) + '</dt><dd><div>' + valueHtml + '</div>' + (helper ? '<small>' + escapeHtml(helper) + '</small>' : '') + '</dd></div>';
}`;
  const newRow = `function caseLayoutRow(label, valueHtml, helper = '', valueClass = '') {
  const cellClass = valueClass ? ' class="' + escapeHtml(valueClass) + '"' : '';
  return '<div class="case-info-row"><dt>' + escapeHtml(label) + '</dt><dd><div' + cellClass + '>' + valueHtml + '</div>' + (helper ? '<small>' + escapeHtml(helper) + '</small>' : '') + '</dd></div>';
}`;
  text = text.replace(oldRow, newRow);

  const oldPerson = `function caseLayoutPerson(profile) {
  const name = caseFallbackText(profile.name, 'Unknown user');
  const username = caseFallbackText(profile.username, 'unknown');
  const id = caseFallbackText(profile.id, 'not recorded');
  const avatar = profile.avatarUrl
    ? '<img src="' + escapeHtml(profile.avatarUrl) + '" alt="">'
    : '<span class="case-user-fallback" aria-hidden="true">' + escapeHtml(name.slice(0, 1).toUpperCase()) + '</span>';
  return '<span class="case-user-chip">' + avatar + '<span class="case-user-copy"><strong>' + escapeHtml(name) + '</strong><small>@' + escapeHtml(username) + '</small><small>' + escapeHtml(id) + '</small></span></span>';
}`;
  const newPerson = `function caseLayoutPerson(profile) {
  const source = profile || {};
  const name = caseFallbackText(source.name, 'Unknown user');
  const username = caseFallbackText(source.username, 'unknown');
  const id = caseFallbackText(source.id, 'not recorded');
  const handle = username && username !== 'unknown' ? '@' + username : '@unknown';
  const meta = id && id !== 'not recorded' ? handle + ' · ' + id : handle + ' · not recorded';
  const avatar = source.avatarUrl
    ? '<img src="' + escapeHtml(source.avatarUrl) + '" alt="">'
    : '<span class="case-user-fallback" aria-hidden="true">' + escapeHtml(name.slice(0, 1).toUpperCase()) + '</span>';
  return '<span class="case-user-chip">' + avatar + '<span class="case-user-copy"><strong class="case-user-name">' + escapeHtml(name) + '</strong><small class="case-user-meta">' + escapeHtml(meta) + '</small></span></span>';
}`;
  text = text.replace(oldPerson, newPerson);

  text = text
    .replace("caseLayoutRow('User', caseLayoutPerson(target))", "caseLayoutRow('User', caseLayoutPerson(target), '', 'case-person-cell')")
    .replace("caseLayoutRow('Author', caseLayoutPerson(author))", "caseLayoutRow('Author', caseLayoutPerson(author), '', 'case-person-cell')")
    .replace("caseLayoutRow('Closed by', caseLayoutPerson(closedBy))", "caseLayoutRow('Closed by', caseLayoutPerson(closedBy), '', 'case-person-cell')");

  return text;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCasePersonRowsFix(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return previousReadFile(filePath, readOptions, (error, data) => {
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

fs.readFileSync = function readFileSyncWithCasePersonRowsFix(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
