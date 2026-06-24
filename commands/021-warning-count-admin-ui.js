'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  moderatorJs: path.join(ROOT, 'admin', 'moderator.js'),
};
const MARKER = 'coinSpriteWarningCountAdminPatch';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function replaceEvery(text, search, replacement) {
  return String(text).split(search).join(replacement);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;

  text = text.replace('(() => {\n', '(() => {\n  /* ' + MARKER + ' */\n');

  text = replaceEvery(
    text,
    "{ threshold: 3, action: 'timeout', durationSeconds: 3600, enabled: true }",
    "{ threshold: 3, action: 'timeout', durationSeconds: 3600, reason: 'Reached 3 active warnings. Action: mute.', enabled: true }",
  );
  text = replaceEvery(
    text,
    "{ threshold: 5, action: 'timeout', durationSeconds: 86400, enabled: true }",
    "{ threshold: 5, action: 'timeout', durationSeconds: 86400, reason: 'Reached 5 active warnings. Action: mute.', enabled: true }",
  );
  text = replaceEvery(
    text,
    "{ threshold: 8, action: 'timeout', durationSeconds: 604800, enabled: true }",
    "{ threshold: 8, action: 'timeout', durationSeconds: 604800, reason: 'Reached 8 active warnings. Action: mute.', enabled: true }",
  );
  text = replaceEvery(
    text,
    "{ threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true }",
    "{ threshold: 10, action: 'staff_alert', durationSeconds: 0, reason: 'Reached 10 active warnings. Action: staff alert.', enabled: true }",
  );

  text = text.replace(
    "  function normalizeDomainMode(value, whitelist = []) {",
    "  function warningRuleReason(rule = {}) {\n"
      + "    const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));\n"
      + "    const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';\n"
      + "    const saved = String(rule.reason || '').trim();\n"
      + "    if (saved) return saved.slice(0, 500);\n"
      + "    const actionLabel = action === 'timeout' ? 'mute' : action === 'staff_alert' ? 'staff alert' : action;\n"
      + "    return ('Reached ' + threshold + ' active warnings. Action: ' + actionLabel + '.').slice(0, 500);\n"
      + "  }\n\n"
      + "  function normalizeDomainMode(value, whitelist = []) {",
  );

  text = text.replace(
    "      next.points = Math.max(1, Math.min(10, Math.round(Number(source.points) || 1)));\n",
    '',
  );
  text = text.replace(
    "        <label>Points <input data-link-action-field=\"points\" type=\"number\" min=\"1\" max=\"10\" step=\"1\" value=\"${Number(action.points) || 1}\"></label>\n",
    '',
  );

  text = text.replace(
    "        escalationRules: (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : defaultRules).map((rule) => ({\n"
      + "          threshold: Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1))),\n"
      + "          action: ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert',\n"
      + "          durationSeconds: clampSeconds(rule.durationSeconds, rule.action === 'staff_alert' ? 0 : 3600),\n"
      + "          enabled: rule.enabled !== false,\n"
      + "        })),",
    "        escalationRules: (Array.isArray(warnings.escalationRules) ? warnings.escalationRules : defaultRules).map((rule) => {\n"
      + "          const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));\n"
      + "          const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';\n"
      + "          return {\n"
      + "            threshold,\n"
      + "            action,\n"
      + "            durationSeconds: clampSeconds(rule.durationSeconds, action === 'staff_alert' ? 0 : 3600),\n"
      + "            reason: warningRuleReason({ ...rule, threshold, action }),\n"
      + "            enabled: rule.enabled !== false,\n"
      + "          };\n"
      + "        }),",
  );

  text = text.replace(/function caseStats\(\) \{[\s\S]*?\n\}\n\nfunction renderOverviewPanel\(\) \{/, () => `function caseStats() {
  const active = moderatorState.cases.filter((record) => record.status === 'active');
  const members = new Map();
  for (const record of active) members.set(record.memberId, (members.get(record.memberId) || 0) + 1);
  const near = [...members.values()].filter((warnings) => warnings >= 3).length;
  const failures = moderatorState.cases.flatMap((record) => record.enforcementEvents || []).filter((event) => event.success === false).length;
  return { active: active.length, members: members.size, near, failures };
}

function renderOverviewPanel() {`);

  text = text.replace(
    /recent\.length \? recent\.map\(\(record\) => `<div class="automod-action-row"><strong>\$\{escapeHtml\(record\.id\)\}<\/strong><span>&lt;@\$\{escapeHtml\(record\.memberId\)\}&gt;[\s\S]*?\$\{escapeHtml\(record\.status\)\}<\/span><span>\$\{escapeHtml\(record\.reason\)\}<\/span><\/div>`\)\.join\(''\) : '<p>No warning cases yet\.<\/p>'/,
    () => "recent.length ? recent.map((record) => `<div class=\"automod-action-row\"><strong>${escapeHtml(record.id)}</strong><span>&lt;@${escapeHtml(record.memberId)}&gt; - warning - ${escapeHtml(record.status)}</span><span>${escapeHtml(record.reason)}</span></div>`).join('') : '<p>No warning cases yet.</p>'",
  );

  text = text.replace(/function warningRuleRow\(rule, index\) \{[\s\S]*?\n\}\n\nfunction renderWarningsPanel\(\) \{/, () => `function warningRuleRow(rule, index) {
  const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';
  const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));
  const reason = warningRuleReason({ ...rule, threshold, action });
  return `<div class="automod-action-row warning-rule-row" data-warning-rule-index="${index}">
    <label>Warnings <input data-warning-rule-field="threshold" type="number" min="1" max="100" value="${threshold}"></label>
    <label>Action <select data-warning-rule-field="action">
      ${['timeout', 'kick', 'ban', 'staff_alert'].map((item) => `<option value="${item}" ${action === item ? 'selected' : ''}>${item.replace('_', ' ')}</option>`).join('')}
    </select></label>
    ${action === 'timeout' ? `<label>Duration seconds <input data-warning-rule-field="durationSeconds" type="number" min="1" max="2419200" value="${rule.durationSeconds || 3600}"></label>` : '<span></span>'}
    <label class="warning-rule-reason">Reason <input data-warning-rule-field="reason" type="text" maxlength="500" value="${escapeHtml(reason)}" placeholder="Reason used for this action"></label>
    <label class="checkline warning-rule-enabled"><input data-warning-rule-field="enabled" type="checkbox" ${rule.enabled !== false ? 'checked' : ''}> Enabled</label>
    <button class="button small danger ghost" type="button" data-moderator-action="remove-warning-rule">Remove</button>
  </div>`;
}

function renderWarningsPanel() {`);

  text = text.replace('Point-based warnings', 'Warning-count warnings');
  text = text.replace(
    '<div class="panel-heading"><h3>Warning-count warnings</h3><p>Cases remain auditable after they expire or are pardoned.</p></div>',
    '<div class="panel-heading"><h3>Warning-count warnings</h3><p>Each active warning counts once toward escalation thresholds.</p></div>',
  );
  text = text.replace(
    '      <label>Points <input id="warningCreatePoints" type="number" min="1" max="10" value="1"></label>\n',
    '',
  );
  text = text.replace(
    "            points: Number(document.querySelector('#warningCreatePoints')?.value) || 1,\n",
    '',
  );

  text = text.replace(
    "      moderatorState.warnings.escalationRules.push({ threshold: 10, action: 'staff_alert', durationSeconds: 0, enabled: true });",
    "      moderatorState.warnings.escalationRules.push({ threshold: 10, action: 'staff_alert', durationSeconds: 0, reason: warningRuleReason({ threshold: 10, action: 'staff_alert' }), enabled: true });",
  );

  text = text.replace(/function warningSnapshot\(\) \{[\s\S]*?\n\}\n\nasync function loadWarningCases\(force = false\) \{/, () => `function warningSnapshot() {
  return {
    enabled: Boolean(moderatorState.warnings.enabled),
    defaultExpiryDays: Math.max(0, Math.min(3650, Number(moderatorState.warnings.defaultExpiryDays) || 90)),
    fallbackChannelId: moderatorState.warnings.fallbackChannelId || '',
    staffLogChannelId: moderatorState.warnings.staffLogChannelId || '',
    escalationRules: moderatorState.warnings.escalationRules.map((rule) => {
      const threshold = Math.max(1, Math.min(100, Math.round(Number(rule.threshold) || 1)));
      const action = ['timeout', 'kick', 'ban', 'staff_alert'].includes(rule.action) ? rule.action : 'staff_alert';
      return {
        threshold,
        action,
        durationSeconds: Math.max(0, Math.min(2419200, Number(rule.durationSeconds) || 0)),
        reason: warningRuleReason({ ...rule, threshold, action }),
        enabled: rule.enabled !== false,
      };
    }).sort((a, b) => a.threshold - b.threshold),
  };
}

async function loadWarningCases(force = false) {`);

  text = text.replace(
    "    if (warningRuleField && warningRuleField !== 'action' && warningRuleField !== 'enabled') {\n"
      + "      const index = Number(event.target.closest('[data-warning-rule-index]')?.dataset.warningRuleIndex);\n"
      + "      const rule = moderatorState.warnings.escalationRules[index];\n"
      + "      if (rule) rule[warningRuleField] = Number(event.target.value) || 0;\n"
      + "    }",
    "    if (warningRuleField && warningRuleField !== 'action' && warningRuleField !== 'enabled') {\n"
      + "      const index = Number(event.target.closest('[data-warning-rule-index]')?.dataset.warningRuleIndex);\n"
      + "      const rule = moderatorState.warnings.escalationRules[index];\n"
      + "      if (rule) {\n"
      + "        if (warningRuleField === 'reason') rule.reason = String(event.target.value || '').slice(0, 500);\n"
      + "        else rule[warningRuleField] = Number(event.target.value) || 0;\n"
      + "      }\n"
      + "    }",
  );

  text = text.replace(
    "        if (warningRuleField === 'enabled') rule.enabled = Boolean(event.target.checked);\n        else if (warningRuleField === 'action') rule.action = event.target.value;",
    "        if (warningRuleField === 'enabled') rule.enabled = Boolean(event.target.checked);\n        else if (warningRuleField === 'action') {\n          const previousReason = String(rule.reason || '');\n          rule.action = event.target.value;\n          if (!previousReason.trim() || /^Reached \\d+ active warnings\\. Action: /.test(previousReason)) rule.reason = warningRuleReason(rule);\n        }",
  );

  text = text.replace(
    "    '.case-edit-grid { display: grid; grid-template-columns: minmax(120px,.34fr) minmax(240px,.66fr); gap: 12px; margin: 12px 0; }',",
    "    '.case-edit-grid { display: grid; grid-template-columns: minmax(120px,.34fr) minmax(240px,.66fr); gap: 12px; margin: 12px 0; }',\n    '.case-edit-grid.case-edit-grid-single { grid-template-columns: minmax(240px, 1fr); }',",
  );
  text = text.replace(
    "    + caseLayoutRow('Points', '<strong>' + escapeHtml(String(points)) + '</strong>')\n",
    '',
  );
  text = text.replace(
    "<div class=\"case-edit-grid\"><label><span>Points</span><input data-case-field=\"points\" type=\"number\" min=\"1\" max=\"10\" value=\"' + points + '\" ' + (editable ? '' : 'disabled') + '></label><label><span>New expiry</span><input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, 30d, or never\" ' + (editable ? '' : 'disabled') + '></label></div>",
    "<div class=\"case-edit-grid case-edit-grid-single\"><label><span>New expiry</span><input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, 30d, or never\" ' + (editable ? '' : 'disabled') + '></label></div>",
  );
  text = text.replace(
    "    + '<div class=\"settings-grid\"><label>Points <input data-case-field=\"points\" type=\"number\" min=\"1\" max=\"10\" value=\"' + Number(record.points) + '\" ' + (editable ? '' : 'disabled') + '></label>'\n    + '<label>New expiry <input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, or use 30d/never\" ' + (editable ? '' : 'disabled') + '></label></div>'\n",
    "    + '<div class=\"settings-grid\"><label>New expiry <input data-case-field=\"expires\" data-case-optional=\"true\" placeholder=\"Leave unchanged, or use 30d/never\" ' + (editable ? '' : 'disabled') + '></label></div>'\n",
  );

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

fs.readFile = function readFileWithWarningCountAdminPatch(filePath, options, callback) {
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

fs.readFileSync = function readFileSyncWithWarningCountAdminPatch(filePath, options) {
  const data = previousReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = { patchModeratorJs };
