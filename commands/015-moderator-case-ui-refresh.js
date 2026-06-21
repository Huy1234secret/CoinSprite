'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
  moderatorCss: path.join(ROOT, 'admin', 'moderator.css'),
};

const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

const CASE_DETAIL_SOURCE = String.raw`
function formatCaseDetailDate(value) {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function caseFallbackText(value, fallback = 'Not recorded') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatCaseType(value) {
  return caseFallbackText(value, 'case').replace(/_/g, ' ');
}

function caseMetricCard(label, value, helper) {
  return '<div class="case-metric-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong><small>' + escapeHtml(helper) + '</small></div>';
}

function caseReferenceCard(label, primary, reference = {}) {
  const channel = caseFallbackText(reference.channelId);
  const message = caseFallbackText(reference.messageId);
  return '<div class="case-reference-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(primary) + '</strong><small>Channel ' + escapeHtml(channel) + '</small><small>Message ' + escapeHtml(message) + '</small></div>';
}

function casePersonRow(label, profile) {
  return '<div class="case-person-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(profile.name) + '</strong><small>@' + escapeHtml(profile.username) + ' · ' + escapeHtml(profile.id || 'not recorded') + '</small></div>';
}

function formatCaseEventType(value) {
  return caseFallbackText(value, 'event').replace(/\./g, ' · ').replace(/_/g, ' ');
}

function renderCaseDetail(record) {
  const target = caseProfile(record.profiles?.target, record.targetUserId);
  const author = caseProfile(record.profiles?.author, record.authorId);
  const notification = record.references?.notification || {};
  const staffLog = record.references?.staffLog || {};
  const sourceRef = record.references?.source || {};
  const editable = record.status !== 'pardoned';
  const points = Number(record.points) || 0;
  const createdAt = formatCaseDetailDate(record.createdAt);
  const updatedAt = formatCaseDetailDate(record.updatedAt);
  const expiresAt = record.expiresAt ? formatCaseDetailDate(record.expiresAt) : 'Never / not set';
  const avatar = target.avatarUrl
    ? '<img src="' + escapeHtml(target.avatarUrl) + '" alt="">'
    : '<span class="case-avatar-fallback" aria-hidden="true">' + escapeHtml((target.name || '?').slice(0, 1).toUpperCase()) + '</span>';
  const actions = editable
    ? '<div class="case-actions case-actions-sticky"><button class="button primary" type="button" data-moderator-action="save-case">Save case</button><button class="button danger" type="button" data-moderator-action="pardon-case">Pardon</button></div>'
    : '<p class="case-pardon-note">Pardoned: ' + escapeHtml(record.pardonReason || 'No reason recorded.') + '</p>';
  const events = [...(record.events || [])].reverse().map((event) => {
    const data = event.data && typeof event.data === 'object' ? event.data : {};
    const summary = data.reason || data.action || data.status || data.error || '';
    return '<li><time>' + escapeHtml(formatCaseDetailDate(event.createdAt)) + '</time><div><strong>'
      + escapeHtml(formatCaseEventType(event.type)) + '</strong><span>'
      + escapeHtml(event.actorId ? 'Actor ' + event.actorId : 'System')
      + (summary ? ' · ' + escapeHtml(summary) : '') + '</span></div></li>';
  }).join('') || '<li class="case-audit-empty"><span>No audit events recorded.</span></li>';

  return '<div class="case-detail case-detail-refresh">'
    + '<div class="case-detail-topbar"><button class="button small case-back" type="button" data-moderator-action="back-to-cases">← Back to cases</button><span>Last updated ' + escapeHtml(updatedAt) + '</span></div>'
    + '<div class="panel case-detail-hero case-detail-hero-refresh"><div class="case-profile case-profile-refresh">' + avatar + '<div><span class="field-label">Target member</span><h2>' + escapeHtml(target.name) + '</h2><p>@' + escapeHtml(target.username) + ' · ' + escapeHtml(target.id) + '</p></div></div>'
    + '<div class="case-detail-heading case-heading-refresh"><span class="case-status ' + escapeHtml(record.status) + '">' + escapeHtml(record.status) + '</span><h2>' + escapeHtml(record.id) + '</h2><p>' + escapeHtml(formatCaseType(record.type)) + ' · ' + escapeHtml(record.source || 'manual') + '</p></div></div>'
    + '<div class="case-metric-grid">'
    + caseMetricCard('Points', String(points), 'Current active severity value')
    + caseMetricCard('Expiry', expiresAt, record.expiresAt ? 'Automatically expires when due' : 'No expiry is currently set')
    + caseMetricCard('Created', createdAt, 'Original case creation time')
    + caseMetricCard('Audit events', String((record.events || []).length), 'Append-only history entries')
    + '</div>'
    + '<div id="caseDetailError" class="inline-error" role="alert" hidden></div>'
    + '<div id="caseDetailForm" class="case-detail-grid case-detail-grid-refresh" data-case-id="' + escapeHtml(record.id) + '">'
    + '<section class="panel case-edit-panel"><div class="panel-heading"><h3>Review & edit</h3><p>Keep the outcome, reason, evidence, and private context clear for future staff.</p></div>'
    + '<label class="case-field-block"><span>Reason</span><textarea data-case-field="reason" maxlength="1000" rows="5" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.reason) + '</textarea></label>'
    + '<div class="case-edit-grid"><label><span>Points</span><input data-case-field="points" type="number" min="1" max="10" value="' + points + '" ' + (editable ? '' : 'disabled') + '></label>'
    + '<label><span>New expiry</span><input data-case-field="expires" data-case-optional="true" placeholder="Leave unchanged, 30d, or never" ' + (editable ? '' : 'disabled') + '></label></div>'
    + '<label class="case-field-block"><span>Evidence</span><input data-case-field="evidence" value="' + escapeHtml(record.evidence || '') + '" placeholder="Message link, transcript, or attachment URL" ' + (editable ? '' : 'disabled') + '></label>'
    + '<label class="case-field-block"><span>Private staff notes</span><textarea data-case-field="staffNotes" maxlength="1000" rows="4" placeholder="Internal context visible to staff only" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label>' + actions + '</section>'
    + '<aside class="case-side-stack"><section class="panel case-people-panel"><div class="panel-heading"><h3>People</h3><p>Who the case is for and who created it.</p></div><div class="case-person-list">' + casePersonRow('Target', target) + casePersonRow('Author', author) + '</div></section>'
    + '<section class="panel case-reference-panel"><div class="panel-heading"><h3>References</h3><p>Delivery, log, and source messages retained with the case.</p></div><div class="case-reference-grid">'
    + caseReferenceCard('Notice', notification.status || 'pending', notification)
    + caseReferenceCard('Staff log', 'Staff record', staffLog)
    + caseReferenceCard('Source', record.source || 'Source message', sourceRef)
    + '</div></section></aside></div>'
    + '<div class="panel case-audit-panel case-audit-panel-refresh"><div class="panel-heading"><h3>Audit trail</h3><p>Append-only lifecycle and action history.</p></div><ol class="case-audit-list case-audit-list-refresh">' + events + '</ol></div></div>';
}
`;

const CASE_CSS = String.raw`

/* coinSpriteModeratorCaseRefresh */
.case-detail-refresh {
  gap: 18px;
}

.case-detail-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--muted);
  font-size: 12px;
}

.case-detail-hero-refresh {
  position: relative;
  overflow: hidden;
  align-items: stretch;
  padding: 0;
  border-color: rgba(155, 89, 255, 0.32);
  background: linear-gradient(135deg, rgba(155, 89, 255, 0.14), rgba(88, 101, 242, 0.06) 48%, rgba(255, 255, 255, 0.025));
}

.case-detail-hero-refresh::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: linear-gradient(180deg, #b56cff, var(--primary));
}

.case-profile-refresh {
  padding: 22px 24px 22px 28px;
}

.case-profile-refresh img,
.case-profile-refresh .case-avatar-fallback {
  width: 64px;
  height: 64px;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow: 0 12px 30px rgba(0, 0, 0, 0.32);
}

.case-profile-refresh h2 {
  margin: 2px 0 4px;
}

.case-profile-refresh p,
.case-heading-refresh p {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.case-heading-refresh {
  display: grid;
  align-content: center;
  justify-items: end;
  min-width: 260px;
  padding: 22px 24px;
  background: rgba(0, 0, 0, 0.12);
}

.case-heading-refresh h2 {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  letter-spacing: -0.02em;
}

.case-metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.case-metric-card,
.case-reference-card,
.case-person-row {
  min-width: 0;
  border: 1px solid var(--line-soft);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.028);
}

.case-metric-card {
  display: grid;
  gap: 4px;
  min-height: 96px;
  padding: 14px;
}

.case-metric-card span,
.case-reference-card span,
.case-person-row span {
  color: var(--muted);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.case-metric-card strong {
  color: var(--text);
  font-size: 17px;
  overflow-wrap: anywhere;
}

.case-metric-card small,
.case-reference-card small,
.case-person-row small {
  color: var(--muted);
  overflow-wrap: anywhere;
}

.case-detail-grid-refresh {
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.75fr);
  align-items: start;
}

.case-edit-panel,
.case-side-stack {
  min-width: 0;
}

.case-edit-panel {
  display: grid;
  gap: 14px;
}

.case-edit-panel label,
.case-field-block {
  display: grid;
  gap: 8px;
}

.case-edit-panel label > span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.case-edit-panel textarea {
  min-height: 132px;
  resize: vertical;
}

.case-edit-panel input,
.case-edit-panel textarea {
  border-radius: 10px;
  border-color: rgba(155, 89, 255, 0.22);
  background: rgba(3, 6, 12, 0.48);
}

.case-edit-grid {
  display: grid;
  grid-template-columns: minmax(110px, 0.32fr) minmax(220px, 0.68fr);
  gap: 12px;
}

.case-side-stack,
.case-person-list,
.case-reference-grid {
  display: grid;
  gap: 12px;
}

.case-person-row,
.case-reference-card {
  display: grid;
  gap: 5px;
  padding: 12px;
}

.case-reference-card strong,
.case-person-row strong {
  overflow-wrap: anywhere;
}

.case-actions-sticky {
  position: sticky;
  bottom: 12px;
  justify-content: flex-end;
  padding-top: 4px;
  background: linear-gradient(180deg, transparent, var(--surface) 22%);
}

.case-audit-panel-refresh {
  overflow: hidden;
}

.case-audit-list-refresh li {
  grid-template-columns: minmax(170px, 0.4fr) minmax(0, 1fr);
  padding: 12px 0;
}

.case-audit-list-refresh time {
  color: var(--muted);
  font-size: 12px;
}

.case-audit-list-refresh div {
  display: grid;
  gap: 3px;
  min-width: 0;
}

.case-audit-list-refresh strong {
  text-transform: capitalize;
}

.case-audit-empty {
  display: block !important;
  color: var(--muted);
}

@media (max-width: 1120px) {
  .case-metric-grid,
  .case-detail-grid-refresh {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .case-side-stack {
    grid-column: 1 / -1;
  }
}

@media (max-width: 760px) {
  .case-detail-topbar,
  .case-detail-hero-refresh {
    align-items: flex-start;
    flex-direction: column;
  }

  .case-heading-refresh {
    justify-items: start;
    width: 100%;
    min-width: 0;
    text-align: left;
  }

  .case-metric-grid,
  .case-detail-grid-refresh,
  .case-edit-grid,
  .case-audit-list-refresh li {
    grid-template-columns: 1fr;
  }

  .case-profile-refresh {
    padding-right: 18px;
  }

  .case-actions-sticky {
    position: static;
    justify-content: stretch;
    flex-direction: column;
  }
}
`;

function patchModeratorJs(source) {
  const text = String(source || '');
  if (text.includes('coinSpriteModeratorCaseRefresh')) return text;
  const pattern = /function renderCaseDetail\(record\) \{[\s\S]*?\n\}\n\nfunction renderCasesPanel\(\) \{/;
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `${CASE_DETAIL_SOURCE}\nfunction renderCasesPanel() {`);
}

function patchModeratorCss(source) {
  const text = String(source || '');
  if (text.includes('coinSpriteModeratorCaseRefresh')) return text;
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

fs.readFile = function readFileWithModeratorCaseRefresh(filePath, options, callback) {
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

fs.readFileSync = function readFileSyncWithModeratorCaseRefresh(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
