'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'admin', 'moderator.js');
const MARKER = 'coinSpriteSanctionCaseUiV1';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(TARGET);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;

  text = text.replace(
    "const typeOptions = ['warning', 'automod_warning', 'note', 'appeal']",
    "const typeOptions = ['warning', 'automod_warning', 'mute', 'kick', 'ban', 'note', 'appeal']",
  );

  text = text.replace(
    "function caseLayoutDuration(record) {",
    `/* ${MARKER} */
function caseLayoutEvidence(record) {
  const attachments = Array.isArray(record.attachments) ? record.attachments : [];
  const links = attachments.map((attachment, index) => {
    const name = attachment.name || ('Evidence ' + (index + 1));
    const href = attachment.storedName
      ? '/api/guilds/' + encodeURIComponent(record.guildId) + '/moderation/evidence/' + encodeURIComponent(record.id) + '/' + encodeURIComponent(attachment.storedName)
      : attachment.url;
    if (!href) return '';
    return '<a class="case-linkish" href="' + escapeHtml(href) + '" target="_blank" rel="noopener">' + escapeHtml(name) + '</a>';
  }).filter(Boolean);
  if (!links.length && record.evidence) {
    links.push('<a class="case-linkish" href="' + escapeHtml(record.evidence) + '" target="_blank" rel="noopener">Open evidence</a>');
  }
  return links.length ? '<span class="case-evidence-list">' + links.join('') + '</span>' : '<span class="case-muted-text">Not recorded</span>';
}

function caseLayoutDuration(record) {`,
  );

  text = text.replace(
    "    + caseLayoutRow('Type', '<strong>' + escapeHtml(formatCaseType(record.type).toUpperCase()) + '</strong>')\n",
    "    + caseLayoutRow('Type', '<strong>' + escapeHtml(formatCaseType(record.type).toUpperCase()) + '</strong>')\n"
      + "    + caseLayoutRow('Appealable', '<strong>' + (record.appealable ? 'Yes' : 'No') + '</strong>')\n",
  );

  text = text.replace(
    "    + caseLayoutRow('Evidence', record.evidence ? '<span class=\"case-linkish\">' + escapeHtml(record.evidence) + '</span>' : '<span class=\"case-muted-text\">Not recorded</span>')",
    "    + caseLayoutRow('Evidence', caseLayoutEvidence(record))",
  );

  text = text.replace(
    "'.case-linkish { color: #00b0f4; font-weight: 800; overflow-wrap: anywhere; }',",
    "'.case-linkish { color: #00b0f4; font-weight: 800; overflow-wrap: anywhere; }',\n"
      + "    '.case-evidence-list { display: flex; flex-wrap: wrap; gap: 8px 14px; }',",
  );

  return text;
}

function patchData(filePath, data, options) {
  if (!samePath(filePath)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchModeratorJs(original);
  return patched === original ? data : encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithSanctionCaseUi(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};

fs.readFileSync = function readFileSyncWithSanctionCaseUi(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchModeratorJs };
