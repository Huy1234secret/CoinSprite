'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
  moderatorCss: path.join(ROOT, 'admin', 'moderator.css'),
};
const MARKER = 'coinSpriteModeratorCaseLayoutV2';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

const CASE_LAYOUT = String.raw`
/* coinSpriteModeratorCaseLayoutV2 */
function caseLayoutRelative(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(1, Math.round(Math.abs(Date.now() - date.getTime()) / 1000));
  const units = [['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]];
  const [unit, size] = units.find((item) => seconds >= item[1]) || units[units.length - 1];
  const count = Math.max(1, Math.floor(seconds / size));
  return count + ' ' + unit + (count === 1 ? '' : 's') + (date.getTime() > Date.now() ? ' from now' : ' ago');
}

function caseLayoutRow(label, valueHtml, helper = '') {
  return '<div class="case-info-row"><dt>' + escapeHtml(label) + '</dt><dd><div>' + valueHtml + '</div>' + (helper ? '<small>' + escapeHtml(helper) + '</small>' : '') + '</dd></div>';
}

function caseLayoutPerson(profile) {
  const avatar = profile.avatarUrl ? '<img src="' + escapeHtml(profile.avatarUrl) + '" alt="">' : '<span>' + escapeHtml((profile.name || '?').slice(0, 1).toUpperCase()) + '</span>';
  return '<span class="case-user-chip">' + avatar + '<strong>' + escapeHtml(profile.name) + '</strong><small>@' + escapeHtml(profile.username) + '</small><small>' + escapeHtml(profile.id || 'not recorded') + '</small></span>';
}

function caseLayoutState(status) {
  const value = caseFallbackText(status, 'active').toLowerCase();
  const label = value === 'active' || value === 'open' ? 'Open' : 'Closed';
  return '<span class="case-state-line"><span class="case-state-dot ' + escapeHtml(value) + '"></span><span>' + escapeHtml(label) + '</span></span>';
}

function caseLayoutRef(label, reference = {}) {
  return '<span class="case-linkish">' + escapeHtml(label) + ' · channel ' + escapeHtml(reference.channelId || 'not recorded') + ' · message ' + escapeHtml(reference.messageId || 'not recorded') + '</span>';
}

function renderCaseDetail(record) {
  const target = caseProfile(record.profiles?.target, record.targetUserId || record.memberId || record.userId);
  const author = caseProfile(record.profiles?.author, record.authorId);
  const notification = record.references?.notification || {};
  const staffLog = record.references?.staffLog || {};
  const sourceRef = record.references?.source || {};
  const editable = record.status !== 'pardoned';
  const closed = !['active', 'open'].includes(String(record.status || 'active').toLowerCase());
  const points = Math.max(0, Number(record.points) || 0);
  const events = [...(record.events || [])].reverse();
  const closeEvent = events.find((event) => /pardon|expire|close/i.test(String(event.type || ''))) || null;
  const closeData = closeEvent?.data && typeof closeEvent.data === 'object' ? closeEvent.data : {};
  const closedBy = caseProfile(record.profiles?.closedBy, closeEvent?.actorId || record.closedById || '');
  const history = events.map((event) => {
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const summary = data.reason || data.action || data.status || data.error || '';
    return '<li><time>' + escapeHtml(formatCaseDetailDate(event.createdAt)) + '<small>' + escapeHtml(caseLayoutRelative(event.createdAt)) + '</small></time><div><strong>' + escapeHtml(formatCaseEventType(event.type)) + '</strong><span>' + escapeHtml(event.actorId ? 'Actor ' + event.actorId : 'System') + (summary ? ' · ' + escapeHtml(summary) : '') + '</span></div></li>';
  }).join('') || '<li class="case-history-empty">No edits recorded.</li>';

  return '<div class="case-detail case-detail-refresh case-layout-v2">'
    + '<div class="panel case-actions-bar"><h3>Actions</h3><div><button class="button small" type="button" data-moderator-action="back-to-cases">Back</button><button class="button small" type="button" disabled>View message history</button>' + (editable ? '<button class="button small danger" type="button" data-moderator-action="pardon-case">Pardon</button><a class="button small primary" href="#caseEditPanel">Edit</a>' : '<button class="button small" type="button" disabled>Closed</button>') + '</div></div>'
    + '<div id="caseDetailError" class="inline-error" role="alert" hidden></div>'
    + '<div id="caseDetailForm" class="case-layout-stack" data-case-id="' + escapeHtml(record.id) + '">'
    + '<section class="panel case-info-panel"><div class="case-panel-title"><span>ⓘ</span><div><h3>General information</h3><p>Core case facts, delivery references, and closure context.</p></div></div><dl>'
    + caseLayoutRow('ID', '<code>' + escapeHtml(record.id) + '</code>')
    + caseLayoutRow('State', caseLayoutState(record.status))
    + caseLayoutRow('Type', '<strong>' + escapeHtml(formatCaseType(record.type)) + '</strong>')
    + caseLayoutRow('User', caseLayoutPerson(target))
    + caseLayoutRow('Reason', '<strong>' + escapeHtml(caseFallbackText(record.reason)) + '</strong>')
    + caseLayoutRow('Points', '<strong>' + escapeHtml(String(points)) + '</strong>')
    + caseLayoutRow('Duration', '<strong>' + escapeHtml(record.expiresAt ? formatCaseDetailDate(record.expiresAt) : 'Permanent / not set') + '</strong>')
    + caseLayoutRow('Created', '<strong>' + escapeHtml(formatCaseDetailDate(record.createdAt)) + '</strong>', caseLayoutRelative(record.createdAt))
    + caseLayoutRow('Author', caseLayoutPerson(author))
    + caseLayoutRow('Log message', caseLayoutRef('staff log', staffLog))
    + caseLayoutRow('User notification message', caseLayoutRef(notification.status || 'notice', notification))
    + caseLayoutRow('Source message', caseLayoutRef(record.source || 'source', sourceRef))
    + caseLayoutRow('Evidence', record.evidence ? '<span class="case-linkish">' + escapeHtml(record.evidence) + '</span>' : '<span class="case-muted-text">Not recorded</span>')
    + (closed ? caseLayoutRow('Closed', '<strong>' + escapeHtml(formatCaseDetailDate(closeEvent?.createdAt || record.updatedAt)) + '</strong>', caseLayoutRelative(closeEvent?.createdAt || record.updatedAt)) : '')
    + (closed ? caseLayoutRow('Closed by', caseLayoutPerson(closedBy)) : '')
    + (closed ? caseLayoutRow('Close reason', '<strong>' + escapeHtml(caseFallbackText(closeData.reason || record.pardonReason || 'No reason recorded')) + '</strong>') : '')
    + '</dl></section>'
    + '<section class="panel case-notes-panel"><div class="case-panel-title"><span>▣</span><div><h3>Moderator notes</h3><p>Private notes visible only to other moderators.</p></div></div><label class="case-field-block"><span>Add note</span><textarea data-case-field="staffNotes" maxlength="1000" rows="4" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label></section>'
    + '<section id="caseEditPanel" class="panel case-edit-panel"><div class="case-panel-title"><span>✎</span><div><h3>Edit case</h3><p>Edits append an actor-aware audit event.</p></div></div><label class="case-field-block"><span>Reason</span><textarea data-case-field="reason" maxlength="1000" rows="5" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.reason) + '</textarea></label><div class="case-edit-grid"><label><span>Points</span><input data-case-field="points" type="number" min="1" max="10" value="' + points + '" ' + (editable ? '' : 'disabled') + '></label><label><span>New expiry</span><input data-case-field="expires" data-case-optional="true" placeholder="Leave unchanged, 30d, or never" ' + (editable ? '' : 'disabled') + '></label></div><label class="case-field-block"><span>Evidence</span><input data-case-field="evidence" value="' + escapeHtml(record.evidence || '') + '" ' + (editable ? '' : 'disabled') + '></label>' + (editable ? '<div class="case-actions"><button class="button primary" type="button" data-moderator-action="save-case">Save changes</button><button class="button danger" type="button" data-moderator-action="pardon-case">Pardon case</button></div>' : '<p class="case-pardon-note">This case is closed and cannot be edited.</p>') + '</section></div>'
    + '<details class="panel case-history-panel" open><summary><span class="case-panel-title"><span>✎</span><span><h3>Edit history (' + escapeHtml(String(events.length)) + ')</h3><p>All changes moderators have made to this case.</p></span></span><span>›</span></summary><ol>' + history + '</ol></details></div>';
}
`;

const CASE_CSS = String.raw`

/* coinSpriteModeratorCaseLayoutV2 */
.case-layout-v2 { gap: 10px; }
.case-layout-v2 .panel { border-color: rgba(255,255,255,.08); background: rgba(35,41,49,.94); box-shadow: none; border-radius: 8px; }
.case-actions-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 40px; padding: 0 12px 0 18px; }
.case-actions-bar h3 { margin: 0; font-size: 18px; }
.case-actions-bar > div { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; }
.case-layout-stack { display: grid; gap: 10px; }
.case-info-panel, .case-notes-panel, .case-edit-panel, .case-history-panel { padding: 16px 18px; }
.case-panel-title { display: flex; align-items: flex-start; gap: 14px; margin-bottom: 12px; }
.case-panel-title h3 { margin: 0; font-size: 18px; }
.case-panel-title p { margin: 2px 0 0; color: var(--muted); line-height: 1.25; }
.case-panel-title > span:first-child { width: 20px; min-width: 20px; text-align: center; font-size: 16px; }
.case-info-panel dl { display: grid; margin: 0; }
.case-info-row { display: grid; grid-template-columns: minmax(86px,.14fr) minmax(0,1fr); gap: 18px; min-height: 35px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,.09); }
.case-info-row:last-child { border-bottom: 0; }
.case-info-row dt { margin: 0; font-weight: 800; color: var(--text); }
.case-info-row dd { display: grid; gap: 2px; min-width: 0; margin: 0; }
.case-info-row dd > div, .case-info-row strong, .case-info-row code { overflow-wrap: anywhere; color: var(--text); }
.case-info-row small, .case-muted-text { color: var(--muted); }
.case-linkish { color: #00b0f4; font-weight: 800; overflow-wrap: anywhere; }
.case-state-line { display: inline-flex; align-items: center; gap: 6px; }
.case-state-dot { width: 10px; height: 10px; border-radius: 99px; background: #43b581; }
.case-state-dot.pardoned, .case-state-dot.expired, .case-state-dot.closed { background: #747f8d; }
.case-user-chip { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px 7px; }
.case-user-chip img, .case-user-chip > span { width: 24px; height: 24px; border-radius: 99px; }
.case-user-chip > span { display: inline-grid; place-items: center; color: #fff; background: rgba(255,255,255,.18); font-size: 12px; font-weight: 800; }
.case-user-chip small { color: var(--muted); font-size: 11px; }
.case-notes-panel textarea, .case-edit-panel input, .case-edit-panel textarea { border-radius: 8px; border-color: rgba(255,255,255,.12); background: rgba(10,15,22,.72); }
.case-field-block, .case-edit-panel label { display: grid; gap: 8px; }
.case-field-block > span, .case-edit-panel label > span { font-weight: 800; }
.case-edit-grid { display: grid; grid-template-columns: minmax(120px,.34fr) minmax(240px,.66fr); gap: 12px; margin: 12px 0; }
.case-history-panel summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; cursor: pointer; list-style: none; }
.case-history-panel summary::-webkit-details-marker { display: none; }
.case-history-panel summary .case-panel-title { margin: 0; }
.case-history-panel summary > span:last-child { font-size: 30px; transition: transform .16s ease; }
.case-history-panel[open] summary > span:last-child { transform: rotate(90deg); }
.case-history-panel ol { margin-top: 14px; padding: 0; list-style: none; }
.case-history-panel li { display: grid; grid-template-columns: minmax(170px,.28fr) minmax(0,1fr); gap: 16px; padding: 11px 0; border-top: 1px solid rgba(255,255,255,.09); }
.case-history-panel time, .case-history-panel li div { display: grid; gap: 2px; min-width: 0; }
.case-history-panel time { font-size: 12px; font-weight: 800; }
.case-history-panel time small, .case-history-panel li span { color: var(--muted); overflow-wrap: anywhere; }
.case-history-empty { display: block !important; color: var(--muted); }
@media (max-width: 760px) { .case-actions-bar, .case-history-panel summary { align-items: stretch; flex-direction: column; } .case-actions-bar > div { justify-content: flex-start; } .case-info-row, .case-edit-grid, .case-history-panel li { grid-template-columns: 1fr; gap: 6px; } }
`;

function patchModeratorJs(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  const pattern = /function renderCaseDetail\(record\) \{[\s\S]*?\n\}\n\nfunction renderCasesPanel\(\) \{/;
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `${CASE_LAYOUT}\nfunction renderCasesPanel() {`);
}

function patchModeratorCss(source) {
  const text = String(source || '');
  if (text.includes(MARKER)) return text;
  return `${text.replace(/\s*$/u, '')}${CASE_CSS}\n`;
}

function patchAdminAsset(filePath, source) {
  if (samePath(filePath, TARGETS.moderatorJs)) return patchModeratorJs(source);
  if (samePath(filePath, TARGETS.moderatorCss)) return patchModeratorCss(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminAsset(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithCaseLayout(filePath, options, callback) {
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

fs.readFileSync = function readFileSyncWithCaseLayout(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
