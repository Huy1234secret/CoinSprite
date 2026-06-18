'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  aiModeration: path.join(ROOT, 'src', 'aiModeration.js'),
  messageTemplates: path.join(ROOT, 'src', 'messageTemplates.js'),
  moderatorCommand: path.join(ROOT, 'commands', 'moderator.js'),
  autoModeratorCommand: path.join(ROOT, 'commands', 'auto-moderator.js'),
  messageDefaultsFix: path.join(ROOT, 'commands', '00-message-template-defaults-fix.js'),
  adminMessages: path.join(ROOT, 'admin', 'messages.js'),
  adminWorkflow: path.join(ROOT, 'admin', 'message-template-workflow.js'),
  adminStyle: path.join(ROOT, 'admin', 'style.css'),
};

const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

const AI_ALERT_LINES = [
  '## AI moderation alert',
  '**User:** <@mention> (`<user-id>`)',
  '**Channel:** <channel>',
  '**Severity:** <severity>/10 (<severity-tier>)',
  '**Broken rule(s):**',
  '<broken-rules>',
  '<separator>',
  '**Reason**',
  '<moderation-reason>',
  '<separator>',
  '-# User message: “<message-content>”',
  '-# Message: <message-link>',
];

const OLD_AI_ALERT_LINES = [
  '## AI moderation alert',
  '**User:** <@mention> (<user-id>)',
  '**Channel:** <channel>',
  '**Severity:** <severity> <severity-tier>/10',
  '**Broken rule(s):**',
  '<broken-rules>',
  '<separator>',
  '**Reason**',
  '<moderation-reason>',
  '<separator>',
  '**English translation**',
  '<english-translation>',
  '<separator>',
  '-# Original language: <original-language>',
  '-# Matched terms: <matched-terms>',
  '-# Message: <message-link>',
];

const OLD_AI_ALERT_CODE_LINES = [
  '## AI moderation alert',
  '**User:** <@mention> (`<user-id>`)',
  '**Channel:** <channel>',
  '**Severity:** <severity> <severity-tier>/10',
  '**Broken rule(s):**',
  '<broken-rules>',
  '<separator>',
  '**Reason**',
  '<moderation-reason>',
  '<separator>',
  '**English translation**',
  '<english-translation>',
  '<separator>',
  '-# Original language: <original-language>',
  '-# Matched terms: <matched-terms>',
  '-# Message: <message-link>',
];

const USER_WARNING_LINES = [
  '## Message flagged',
  '<@mention>, your message in <channel> was flagged by AI moderation.',
  '<separator>',
  '**Severity:** <severity>/10 (<severity-tier>)',
  '**Broken rule(s):**',
  '<broken-rules>',
  '**Reason:** <moderation-reason>',
  '-# If this was a mistake, please contact staff.',
];

const OLD_USER_WARNING_LINES = [
  '## Message flagged',
  '<@mention>, your message in <channel> was flagged by AI moderation.',
  '<separator>',
  '**Severity:** <severity> <severity-tier>/10',
  '**Broken rule(s):**',
  '<broken-rules>',
  '**Reason:** <moderation-reason>',
  '-# If this was a mistake, please contact staff.',
];

const LINK_ALERT_LINES = [
  '## Link Auto-Moderator report',
  '**User:** <@mention> (`<user-id>`)',
  '**Channel:** <channel>',
  '**Action taken:** <moderation-action>',
  '**Reason:** <moderation-reason>',
  '<separator>',
  '**Blocked link**',
  '- Domain: `<blocked-domain>`',
  '- URL: <blocked-url>',
  '- Invite code: `<invite-code>`',
  '<separator>',
  '-# User message: “<message-content>”',
  '-# Report link: <message-link>',
];

const OLD_LINK_ALERT_LINES = [
  '## Link Auto-Moderator report',
  '**User:** <@mention> (`<user-id>`)',
  '**Channel:** <channel>',
  '**Action:** <moderation-action>',
  '**Reason:** <moderation-reason>',
  '<separator>',
  '**Domain:** `<blocked-domain>`',
  '**URL:** <blocked-url>',
  '**Invite code:** `<invite-code>`',
  '**Message:** <message-link>',
  '<separator>',
  '**Blocked message**',
  '```',
  '<message-content>',
  '```',
];

function escaped(lines) {
  return lines.join('\\n');
}

function replaceAll(text, oldValue, newValue) {
  return oldValue ? text.split(oldValue).join(newValue) : text;
}

function replaceOnce(text, oldValue, newValue) {
  const index = text.indexOf(oldValue);
  if (index < 0) return text;
  return `${text.slice(0, index)}${newValue}${text.slice(index + oldValue.length)}`;
}

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function linkDefaultSource(indent = '  ') {
  const lineIndent = `${indent}      `;
  const lines = LINK_ALERT_LINES.map((line) => `${lineIndent}'${line.replace(/'/g, "\\'")}',`).join('\n');
  return `${indent}{
${indent}  id: 'default-link-auto-moderation-alert',
${indent}  type: 'template',
${indent}  folderId: '',
${indent}  name: 'Default: Link Auto-Moderator alert',
${indent}  content: '',
${indent}  containers: [{
${indent}    id: 'link-auto-moderation-alert',
${indent}    accentColor: '#ED4245',
${indent}    text: [
${lines}
${indent}    ].join('\\n'),
${indent}    thumbnailUrl: '<avatar_url>',
${indent}    imageUrl: '',
${indent}  }],
${indent}  componentRows: [],
${indent}  botDefault: true,
${indent}  defaultLocked: true,
${indent}  updatedAt: new Date(0).toISOString(),
${indent}}`;
}

function patchDefaultTemplateText(source) {
  let text = String(source || '');
  text = replaceAll(text, escaped(OLD_AI_ALERT_LINES), escaped(AI_ALERT_LINES));
  text = replaceAll(text, escaped(OLD_AI_ALERT_CODE_LINES), escaped(AI_ALERT_LINES));
  text = replaceAll(text, escaped(OLD_USER_WARNING_LINES), escaped(USER_WARNING_LINES));
  text = replaceAll(text, escaped(OLD_LINK_ALERT_LINES), escaped(LINK_ALERT_LINES));
  text = replaceAll(text, '**Severity:** <severity> <severity-tier>/10', '**Severity:** <severity>/10 (<severity-tier>)');
  text = text.replace(
    /(\s*)'\*\*English translation\*\*',\n\s*'<english-translation>',\n\s*'<separator>',\n\s*'-# Original language: <original-language>',\n\s*'-# Matched terms: <matched-terms>',\n\s*'-# Message: <message-link>',/g,
    `$1'-# User message: "<message-content>"',\n$1'-# Message: <message-link>',`,
  );
  text = text.replace(
    /(\s*)'\*\*Action:\*\* <moderation-action>',\n\s*'\*\*Reason:\*\* <moderation-reason>',\n\s*'<separator>',\n\s*'\*\*Domain:\*\* `<blocked-domain>`',\n\s*'\*\*URL:\*\* <blocked-url>',\n\s*'\*\*Invite code:\*\* `<invite-code>`',\n\s*'\*\*Message:\*\* <message-link>',\n\s*'<separator>',\n\s*'\*\*Blocked message\*\*',\n\s*'```',\n\s*'<message-content>',\n\s*'```',/g,
    `$1'**Action taken:** <moderation-action>',\n$1'**Reason:** <moderation-reason>',\n$1'<separator>',\n$1'**Blocked link**',\n$1'- Domain: \`<blocked-domain>\`',\n$1'- URL: <blocked-url>',\n$1'- Invite code: \`<invite-code>\`',\n$1'<separator>',\n$1'-# User message: "<message-content>"',\n$1'-# Report link: <message-link>',`,
  );
  return text;
}

function patchAiModeration(source) {
  let text = String(source || '');
  const prompt = `const SYSTEM_PROMPT = [
  'Return JSON only.',
  'Clean or severity under 2: {"flagged":false,"s":0,"rules":[],"reason":""}.',
  'Violation severity 2-10: {"flagged":true,"s":2.2,"rules":["1.1"],"reason":"Clear one-sentence explanation for staff."}.',
  'Use decimal severity when useful. Rules must be numbers only. Reason must explain the specific problem in under 160 chars; never return generic one-word reasons like "short".',
  RULE_GUIDE,
].join(' ');`;
  text = text.replace(/const SYSTEM_PROMPT = \[[\s\S]*?\]\.join\(' '\);/, prompt);
  text = replaceAll(text, 'max_output_tokens: 60', 'max_output_tokens: 120');
  text = replaceAll(text, 'max_tokens: 60', 'max_tokens: 120');
  text = replaceOnce(
    text,
    "reason: 'Local rule match.',",
    "reason: matchedTerms.length ? `Matched local moderation term(s): ${matchedTerms.slice(0, 3).join(', ')}.` : 'Matched local moderation rules.',",
  );
  if (!text.includes('function normalizeModerationReason(')) {
    const helper = [
      'function normalizeModerationReason(value, brokenRules = [], categories = []) {',
      '  const reason = compactWhitespace(value);',
      '  const lower = reason.toLowerCase();',
      "  const generic = new Set(['short', 'bad', 'rude', 'abuse', 'violation', 'rule violation']);",
      '  if (!reason || reason.length < 12 || generic.has(lower)) {',
      "    const ruleText = brokenRules.length ? 'rule ' + brokenRules.join(', ') : 'server conduct rules';",
      "    const categoryText = categories.length ? ' (' + categories.slice(0, 2).join(', ') + ')' : '';",
      "    return ('Message appears to violate ' + ruleText + categoryText + '; staff should review the wording and context.').slice(0, 180);",
      '  }',
      '  return reason.slice(0, 180);',
      '}',
      '',
    ].join('\n');
    text = replaceOnce(text, "function normalizeResult(value = {}, source = 'ai') {", `${helper}function normalizeResult(value = {}, source = 'ai') {`);
  }
  text = replaceOnce(
    text,
    "reason: compactWhitespace(value.reason || 'Rule violation.').slice(0, 120),",
    "reason: normalizeModerationReason(value.reason, brokenRules, categories),",
  );
  return text;
}

function patchMessageTemplates(source) {
  let text = patchDefaultTemplateText(source);
  if (!text.includes("id: 'default-link-auto-moderation-alert'")) {
    text = replaceOnce(text, '\n]);\n\nfunction clone(value)', `,\n${linkDefaultSource('  ')}\n]);\n\nfunction clone(value)`);
  }
  return text;
}

function patchModeratorCommand(source) {
  let text = patchDefaultTemplateText(source);
  if (!text.includes('function moderationMessagePreview(')) {
    const helper = [
      'function moderationMessagePreview(message, max = 900) {',
      "  const text = String(message?.content || '').replace(/\\s+/g, ' ').trim();",
      "  if (!text) return '[no text content]';",
      "  const safe = text.replace(/[`*_~|>]/g, '').replace(/\"/g, \"'\");",
      "  return safe.length > max ? safe.slice(0, Math.max(0, max - 3)) + '...' : safe;",
      '}',
      '',
    ].join('\n');
    text = replaceOnce(text, 'function moderationValues(message, result, screenshot = null) {', `${helper}function moderationValues(message, result, screenshot = null) {`);
  }
  text = replaceOnce(
    text,
    "['severity-tier', formatSeverityScore(result.severityScore)],",
    "['severity-tier', result.severity || 'medium'],",
  );
  text = replaceOnce(
    text,
    "['moderation-reason', result.reason || 'Rule violation.'],",
    "['moderation-reason', result.reason || 'Rule violation.'],\n    ['message-content', moderationMessagePreview(message)],",
  );
  text = replaceOnce(text, 'const screenshot = await moderationScreenshot(message, result);', 'const screenshot = null;');
  return text;
}

function patchAutoModeratorCommand(source) {
  let text = patchDefaultTemplateText(source);
  text = replaceOnce(
    text,
    "'## Auto-Moderator report',",
    "'## Link Auto-Moderator report',",
  );
  text = text.replace(
    /\['message-content', limitText\(message\.content \|\| '\[empty message\]', 1200\)\.replace\(\/```\/g, '``(?:\\\\u200b|\\u200b)`'\)\],/,
    "['message-content', safeInline(String(message.content || '[empty message]').replace(/\\s+/g, ' '), '[empty message]')],",
  );
  return text;
}

function patchAdminMessages(source) {
  let text = patchDefaultTemplateText(source);
  if (!text.includes('root.dataset.messageSection')) {
    text = replaceOnce(
      text,
      "root.dataset.folderEnhanced = 'true';\n    root.dataset.defaultTemplateCount = String(defaults.length);",
      "root.dataset.folderEnhanced = 'true';\n    root.dataset.messageSection = showingDefaults ? 'defaults' : 'templates';\n    root.dataset.defaultTemplateCount = String(defaults.length);",
    );
  }
  text = replaceOnce(
    text,
    "if (action === 'section-templates') { view.section = 'templates'; view.folderId = ''; view.query = ''; render(); return; }",
    "if (action === 'section-templates') { event.preventDefault(); view.section = 'templates'; view.folderId = ''; view.query = ''; render(); return; }",
  );
  text = replaceOnce(
    text,
    "if (action === 'section-defaults') { view.section = 'defaults'; view.folderId = ''; view.query = ''; render(); return; }",
    "if (action === 'section-defaults') { event.preventDefault(); view.section = 'defaults'; view.folderId = ''; view.query = ''; render(); return; }",
  );
  return text;
}

function patchAdminWorkflow(source) {
  let text = patchDefaultTemplateText(source);
  const oldCss = '.message-template-grid .message-default-card{display:grid!important;min-height:92px!important;visibility:visible!important;opacity:1!important}';
  const newCss = '#messageTemplatesRoot .message-template-grid .message-default-card[data-id^="default-"]{display:grid!important;min-height:92px!important;visibility:visible!important;opacity:1!important}.message-template-grid .message-default-card{display:grid!important;min-height:92px!important;visibility:visible!important;opacity:1!important}.message-section-tabs{position:relative;z-index:20;pointer-events:auto}.message-section-tabs button{position:relative;z-index:21;touch-action:manipulation;pointer-events:auto}';
  if (!text.includes('message-section-tabs{position:relative;z-index:20')) text = replaceOnce(text, oldCss, newCss);
  return text;
}

function patchAdminStyle(source) {
  let text = String(source || '');
  text = text.replace(
    /#messageTemplatesRoot \.message-template-card\[data-id\^="default-"\] \{\n\s*display: none !important;\n\}/,
    '#messageTemplatesRoot:not([data-message-section="defaults"]) .message-template-card[data-id^="default-"] {\n  display: none !important;\n}',
  );
  if (!text.includes('coinSpriteAiModerationAlertFix')) {
    text += `

/* coinSpriteAiModerationAlertFix */
#messageTemplatesRoot[data-message-section="defaults"] .message-template-card[data-id^="default-"],
#messageTemplatesRoot .message-template-grid .message-default-card[data-id^="default-"] {
  display: grid !important;
  visibility: visible !important;
  opacity: 1 !important;
}

.message-section-tabs {
  position: relative !important;
  z-index: 20 !important;
  pointer-events: auto !important;
}

.message-section-tabs button {
  position: relative !important;
  z-index: 21 !important;
  touch-action: manipulation;
  pointer-events: auto !important;
}
`;
  }
  return text;
}

function patchAdminFile(filePath, source) {
  if (samePath(filePath, TARGETS.aiModeration)) return patchAiModeration(source);
  if (samePath(filePath, TARGETS.messageTemplates)) return patchMessageTemplates(source);
  if (samePath(filePath, TARGETS.moderatorCommand)) return patchModeratorCommand(source);
  if (samePath(filePath, TARGETS.autoModeratorCommand)) return patchAutoModeratorCommand(source);
  if (samePath(filePath, TARGETS.messageDefaultsFix)) return patchDefaultTemplateText(source);
  if (samePath(filePath, TARGETS.adminMessages)) return patchAdminMessages(source);
  if (samePath(filePath, TARGETS.adminWorkflow)) return patchAdminWorkflow(source);
  if (samePath(filePath, TARGETS.adminStyle)) return patchAdminStyle(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminFile(filePath, originalText);
  if (patched === originalText) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

fs.readFile = function readFileWithAiModerationAlertFix(filePath, options, callback) {
  let readOptions = options;
  let done = callback;
  if (typeof options === 'function') {
    done = options;
    readOptions = undefined;
  }
  return nativeReadFile(filePath, readOptions, (error, data) => {
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

fs.readFileSync = function readFileSyncWithAiModerationAlertFix(filePath, options) {
  const data = nativeReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
