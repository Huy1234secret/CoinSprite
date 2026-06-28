'use strict';

const fs = require('fs');
const path = require('path');

const MODERATOR_TARGET = path.join(__dirname, '..', 'admin', 'moderator.js');
const INDEX_TARGET = path.join(__dirname, '..', 'admin', 'index.html');
const MARKER = 'coinsprite-appeal-workspace-v1';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function same(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function required(text, from, to) {
  if (!text.includes(from)) throw new Error('Appeal admin patch anchor was not found: ' + from.slice(0, 80));
  return text.replace(from, to);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;
  text = required(
    text,
    "    const moderationTabs = [['warnings', 'Warn System'], ['cases', 'Cases']];\n    const tabs = moderatorState.workspace === 'auto' ? autoTabs : moderationTabs;",
    "    const moderationTabs = [['warnings', 'Warn System'], ['cases', 'Cases']];\n    const appealTabs = [['appeal-settings', 'Settings'], ['appeal-form', 'Form'], ['appeal-message', 'Message']];\n    const tabs = moderatorState.workspace === 'auto' ? autoTabs : moderatorState.workspace === 'appeal' ? appealTabs : moderationTabs; /* " + MARKER + " */",
  );
  text = required(
    text,
    "    let panel = moderatorState.view === 'ai' ? renderAiPanel()\n      : moderatorState.view === 'auto' ? renderAutoPanel()\n        : moderatorState.view === 'text' ? renderTextPanel()\n          : moderatorState.view === 'warnings' ? renderWarningsPanel()\n            : renderCasesPanel();",
    "    let panel = moderatorState.workspace === 'appeal' ? '<div id=\"appealAdminRoot\"></div>'\n      : moderatorState.view === 'ai' ? renderAiPanel()\n        : moderatorState.view === 'auto' ? renderAutoPanel()\n          : moderatorState.view === 'text' ? renderTextPanel()\n            : moderatorState.view === 'warnings' ? renderWarningsPanel()\n              : renderCasesPanel();",
  );
  text = required(
    text,
    '<button class="moderator-workspace-tab \' + (moderatorState.workspace === \'moderation\' ? \'active\' : \'\') + \'" type="button" data-moderator-workspace="moderation"><strong>Moderation</strong><span>Warnings and cases</span></button></nav>',
    '<button class="moderator-workspace-tab \' + (moderatorState.workspace === \'moderation\' ? \'active\' : \'\') + \'" type="button" data-moderator-workspace="moderation"><strong>Moderation</strong><span>Warnings and cases</span></button>\'\n      + \'<button class="moderator-workspace-tab \' + (moderatorState.workspace === \'appeal\' ? \'active\' : \'\') + \'" type="button" data-moderator-workspace="appeal"><strong>Appeal</strong><span>Forms and review messages</span></button></nav>',
  );
  text = required(
    text,
    "    if (moderatorState.view === 'cases' && !moderatorState.casesLoaded) queueMicrotask(loadWarningCases);",
    "    if (moderatorState.view === 'cases' && !moderatorState.casesLoaded) queueMicrotask(loadWarningCases);\n    if (moderatorState.workspace === 'appeal') queueMicrotask(() => window.CoinSpriteAppealAdmin?.mount(root.querySelector('#appealAdminRoot'), document.querySelector('#guildSelect')?.value, moderatorState.view));",
  );
  text = required(
    text,
    "      moderatorState.workspace = workspace === 'moderation' ? 'moderation' : 'auto';\n      moderatorState.view = moderatorState.workspace === 'moderation' ? 'warnings' : 'ai';",
    "      moderatorState.workspace = ['auto', 'moderation', 'appeal'].includes(workspace) ? workspace : 'auto';\n      moderatorState.view = moderatorState.workspace === 'moderation' ? 'warnings' : moderatorState.workspace === 'appeal' ? 'appeal-settings' : 'ai';",
  );
  text = required(
    text,
    "moderatorState.view = ['warnings', 'auto', 'text', 'ai', 'cases'].includes(view) ? view : (moderatorState.workspace === 'auto' ? 'ai' : 'warnings');",
    "moderatorState.view = ['warnings', 'auto', 'text', 'ai', 'cases', 'appeal-settings', 'appeal-form', 'appeal-message'].includes(view) ? view : (moderatorState.workspace === 'auto' ? 'ai' : moderatorState.workspace === 'appeal' ? 'appeal-settings' : 'warnings');",
  );
  const basicNotesAnchor = "+ '<label>Private staff notes <textarea data-case-field=\"staffNotes\" maxlength=\"1000\" rows=\"3\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label>' + actions + '</div>'";
  if (text.includes(basicNotesAnchor)) {
    text = text.replace(
      basicNotesAnchor,
      "+ '<label>Public moderator note <textarea data-case-field=\"publicNote\" maxlength=\"1000\" rows=\"3\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.publicNote || '') + '</textarea></label>'\n    + '<label>Private staff notes <textarea data-case-field=\"staffNotes\" maxlength=\"1000\" rows=\"3\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.staffNotes || '') + '</textarea></label>' + actions + '</div>'",
    );
  } else {
    const composedNotesAnchor = "    + '<section class=\"panel case-notes-panel\">";
    text = required(
      text,
      composedNotesAnchor,
      "    + '<section class=\"panel case-notes-panel\"><div class=\"case-panel-title\"><span>◎</span><div><h3>Public moderator note</h3></div></div><label class=\"case-field-block\"><span>Note</span><textarea data-case-field=\"publicNote\" maxlength=\"1000\" rows=\"4\" ' + (editable ? '' : 'disabled') + '>' + escapeHtml(record.publicNote || '') + '</textarea></label></section>'\n" + composedNotesAnchor,
    );
  }
  text = text.replace('<h3>Point-based warnings</h3>', '<h3>Warning system</h3>');
  text = text.replace('      <label>Points <input id="warningCreatePoints" type="number" min="1" max="10" value="1"></label>\n', '');
  text = text.replace('<label>Expires <input id="warningCreateExpires" placeholder="90d, 4w, or never"></label>', '<label>Time <input id="warningCreateExpires" required placeholder="30m, 7d, 4w, or never"></label>');
  text = text.replace('      <label>Evidence URL <input id="warningCreateEvidence" type="url" placeholder="https://discord.com/channels/..."></label>', '      <label>Evidence URL <input id="warningCreateEvidence" type="url" placeholder="https://discord.com/channels/..."></label>\n      <label class="checkline"><input id="warningCreateAppealable" type="checkbox"> Appealable</label>');
  text = text.replace("            points: Number(document.querySelector('#warningCreatePoints')?.value) || 1,\n", '');
  text = text.replace("            evidence: document.querySelector('#warningCreateEvidence')?.value || '',", "            evidence: document.querySelector('#warningCreateEvidence')?.value || '',\n            appealable: Boolean(document.querySelector('#warningCreateAppealable')?.checked),");
  return text;
}

function patchIndex(source) {
  const text = String(source || '');
  if (text.includes('/admin/appeals.js')) return text;
  return text.replace('</body>', '  <script src="/admin/appeals.js?v=appeals-1" defer></script>\n</body>');
}

function patchData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = same(filePath, MODERATOR_TARGET) ? patchModeratorJs(original)
    : same(filePath, INDEX_TARGET) ? patchIndex(original)
      : original;
  return patched === original ? data : encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithAppeals(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};
fs.readFileSync = function readFileSyncWithAppeals(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchIndex, patchModeratorJs };
