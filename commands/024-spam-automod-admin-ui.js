'use strict';

const fs = require('fs');
const path = require('path');

const TARGET = path.join(__dirname, '..', 'admin', 'moderator.js');
const MARKER = 'coinSpriteSpamAutoModAdminV1';
const previousReadFile = fs.readFile.bind(fs);
const previousReadFileSync = fs.readFileSync.bind(fs);

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(TARGET);
}

function replaceRequired(text, search, replacement) {
  if (!text.includes(search)) throw new Error('Spam AutoMod admin patch anchor was not found.');
  return text.replace(search, replacement);
}

function patchModeratorJs(source) {
  let text = String(source || '');
  if (text.includes(MARKER)) return text;

  text = replaceRequired(
    text,
    '    auto: {\n      link: {',
    `    auto: {
      /* ${MARKER} */
      spam: {
        enabled: false,
        messages: { enabled: true, count: 6, durationSeconds: 5 },
        lines: { enabled: true, maxLines: 12 },
        mentions: { enabled: true, maxMentions: 6 },
        deleteMessage: true,
        action: 'timeout',
        timeoutSeconds: 300,
      },
      link: {`,
  );

  text = replaceRequired(
    text,
    '    const link = config.moderation?.auto?.link || {};\n',
    `    const link = config.moderation?.auto?.link || {};
    const spam = config.moderation?.auto?.spam || {};
`,
  );

  text = replaceRequired(
    text,
    '      auto: {\n        link: {',
    `      auto: {
        spam: {
          enabled: Boolean(spam.enabled),
          messages: {
            enabled: spam.messages?.enabled !== false,
            count: Math.max(2, Math.min(50, Math.round(Number(spam.messages?.count) || 6))),
            durationSeconds: Math.max(1, Math.min(120, Math.round(Number(spam.messages?.durationSeconds) || 5))),
          },
          lines: {
            enabled: spam.lines?.enabled !== false,
            maxLines: Math.max(2, Math.min(100, Math.round(Number(spam.lines?.maxLines) || 12))),
          },
          mentions: {
            enabled: spam.mentions?.enabled !== false,
            maxMentions: Math.max(2, Math.min(100, Math.round(Number(spam.mentions?.maxMentions) || 6))),
          },
          deleteMessage: spam.deleteMessage !== false,
          action: ['none', 'warn', 'timeout'].includes(spam.action) ? spam.action : 'timeout',
          timeoutSeconds: Math.max(60, Math.min(2419200, Math.round(Number(spam.timeoutSeconds) || 300))),
          excludeChannelIds: uniqueIds(spam.excludeChannelIds),
          excludeRoleIds: uniqueIds(spam.excludeRoleIds),
          logChannelId: String(spam.logChannelId || ''),
        },
        link: {`,
  );

  const start = text.indexOf('  function renderAutoPanel() {');
  const end = text.indexOf('\n\nfunction caseStats()', start);
  if (start < 0 || end < 0) throw new Error('Spam AutoMod render anchor was not found.');
  const render = `  function renderSpamPanel() {
    const spam = moderatorState.auto.spam;
    return '<div class="panel moderator-ai-panel">'
      + '<div class="panel-heading"><h3>Spam moderation</h3><p>Detect message bursts, excessive line counts, and mass mentions.</p></div>'
      + '<label class="checkline"><input id="spamAutoEnabled" type="checkbox" ' + (spam.enabled ? 'checked' : '') + '> Enable Spam Auto-Moderator</label>'
      + '<div class="automod-action-list">'
      + '<div class="automod-action-row"><label class="checkline"><input id="spamMessagesEnabled" type="checkbox" ' + (spam.messages.enabled ? 'checked' : '') + '> Message burst</label><label>Messages <input id="spamMessageCount" type="number" min="2" max="50" value="' + spam.messages.count + '"></label><label>Duration seconds <input id="spamMessageSeconds" type="number" min="1" max="120" value="' + spam.messages.durationSeconds + '"></label></div>'
      + '<div class="automod-action-row"><label class="checkline"><input id="spamLinesEnabled" type="checkbox" ' + (spam.lines.enabled ? 'checked' : '') + '> Excessive lines</label><label>Maximum lines <input id="spamMaxLines" type="number" min="2" max="100" value="' + spam.lines.maxLines + '"></label></div>'
      + '<div class="automod-action-row"><label class="checkline"><input id="spamMentionsEnabled" type="checkbox" ' + (spam.mentions.enabled ? 'checked' : '') + '> Mass mention</label><label>Trigger at mentions <input id="spamMaxMentions" type="number" min="2" max="100" value="' + spam.mentions.maxMentions + '"></label></div>'
      + '</div><div class="settings-grid">'
      + '<label>Action <select id="spamAction">' + ['none', 'warn', 'timeout'].map((value) => '<option value="' + value + '" ' + (spam.action === value ? 'selected' : '') + '>' + value + '</option>').join('') + '</select></label>'
      + (spam.action === 'timeout' ? '<label>Timeout seconds <input id="spamTimeoutSeconds" type="number" min="60" max="2419200" value="' + spam.timeoutSeconds + '"></label>' : '')
      + '<label class="checkline"><input id="spamDeleteMessage" type="checkbox" ' + (spam.deleteMessage ? 'checked' : '') + '> Delete triggering message</label>'
      + '</div></div>';
  }

  function renderAutoPanel() {
    const link = moderatorState.auto.link;
    const spam = moderatorState.auto.spam;
    return '<div class="automod-grid">'
      + '<div class="automod-module-card active"><strong>Link</strong><span>' + (link.enabled ? 'Enabled' : 'Disabled') + ' · ' + (link.actions.map((action) => action.type).join(', ') || 'no actions') + '</span></div>'
      + '<div class="automod-module-card active"><strong>Spam</strong><span>' + (spam.enabled ? 'Enabled' : 'Disabled') + ' · burst, lines, mentions</span></div>'
      + renderLinkPanel() + renderSpamPanel() + '</div>';
  }`;
  text = text.slice(0, start) + render + text.slice(end);

  const snapshotStart = text.indexOf('  function autoSnapshot() {');
  const snapshotEnd = text.indexOf('\n  ensureModeratorTab();', snapshotStart);
  if (snapshotStart < 0 || snapshotEnd < 0) throw new Error('Spam AutoMod snapshot anchor was not found.');
  const oldSnapshot = text.slice(snapshotStart, snapshotEnd);
  const newSnapshot = oldSnapshot.replace(
    '    return {\n      link: {',
    `    const spam = moderatorState.auto.spam;
    return {
      spam: {
        enabled: Boolean(spam.enabled),
        messages: {
          enabled: Boolean(spam.messages.enabled),
          count: Math.max(2, Math.min(50, Math.round(Number(spam.messages.count) || 6))),
          durationSeconds: Math.max(1, Math.min(120, Math.round(Number(spam.messages.durationSeconds) || 5))),
        },
        lines: {
          enabled: Boolean(spam.lines.enabled),
          maxLines: Math.max(2, Math.min(100, Math.round(Number(spam.lines.maxLines) || 12))),
        },
        mentions: {
          enabled: Boolean(spam.mentions.enabled),
          maxMentions: Math.max(2, Math.min(100, Math.round(Number(spam.mentions.maxMentions) || 6))),
        },
        deleteMessage: Boolean(spam.deleteMessage),
        action: ['none', 'warn', 'timeout'].includes(spam.action) ? spam.action : 'timeout',
        timeoutSeconds: Math.max(60, Math.min(2419200, Math.round(Number(spam.timeoutSeconds) || 300))),
        excludeChannelIds: uniqueIds(spam.excludeChannelIds),
        excludeRoleIds: uniqueIds(spam.excludeRoleIds),
        logChannelId: spam.logChannelId || '',
      },
      link: {`,
  );
  if (oldSnapshot === newSnapshot) throw new Error('Spam AutoMod snapshot was not patched.');
  text = text.slice(0, snapshotStart) + newSnapshot + text.slice(snapshotEnd);

  const inputAnchor = `    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationMaxInputChars')`;
  text = replaceRequired(
    text,
    inputAnchor,
    `    const link = moderatorState.auto.link;
    const spam = moderatorState.auto.spam;
    if (event.target.id === 'spamMessageCount') spam.messages.count = Number(event.target.value) || 6;
    if (event.target.id === 'spamMessageSeconds') spam.messages.durationSeconds = Number(event.target.value) || 5;
    if (event.target.id === 'spamMaxLines') spam.lines.maxLines = Number(event.target.value) || 12;
    if (event.target.id === 'spamMaxMentions') spam.mentions.maxMentions = Number(event.target.value) || 6;
    if (event.target.id === 'spamTimeoutSeconds') spam.timeoutSeconds = Number(event.target.value) || 300;
    if (event.target.id === 'moderationMaxInputChars')`,
  );

  const changeAnchor = `    const link = moderatorState.auto.link;
    if (event.target.id === 'moderationAiEnabled')`;
  text = replaceRequired(
    text,
    changeAnchor,
    `    const link = moderatorState.auto.link;
    const spam = moderatorState.auto.spam;
    if (event.target.id === 'spamAutoEnabled') spam.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamMessagesEnabled') spam.messages.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamLinesEnabled') spam.lines.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamMentionsEnabled') spam.mentions.enabled = Boolean(event.target.checked);
    if (event.target.id === 'spamDeleteMessage') spam.deleteMessage = Boolean(event.target.checked);
    if (event.target.id === 'spamAction') spam.action = event.target.value;
    if (event.target.id === 'moderationAiEnabled')`,
  );

  text = replaceRequired(
    text,
    "if (['moderationAiEnabled', 'warningsEnabled', 'linkAutoEnabled', 'linkBlockInvites', 'domainMode'].includes(event.target.id)",
    "if (['moderationAiEnabled', 'warningsEnabled', 'linkAutoEnabled', 'linkBlockInvites', 'domainMode', 'spamAction'].includes(event.target.id)",
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

fs.readFile = function readFileWithSpamAutoMod(filePath, options, callback) {
  const readOptions = typeof options === 'function' ? undefined : options;
  const done = typeof options === 'function' ? options : callback;
  return previousReadFile(filePath, readOptions, (error, data) => {
    if (error || typeof done !== 'function') return done?.(error, data);
    try { done(null, patchData(filePath, data, readOptions)); } catch (patchError) { done(patchError); }
  });
};

fs.readFileSync = function readFileSyncWithSpamAutoMod(filePath, options) {
  return patchData(filePath, previousReadFileSync(filePath, options), options);
};

module.exports = { patchModeratorJs };
