'use strict';

const fs = require('fs');
const path = require('path');
const messageTemplates = require('../src/messageTemplates');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = {
  aiModeration: path.join(ROOT, 'src', 'aiModeration.js'),
  messageTemplates: path.join(ROOT, 'src', 'messageTemplates.js'),
  moderatorCommand: path.join(ROOT, 'commands', 'moderator.js'),
  messageDefaultsFix: path.join(ROOT, 'commands', '00-message-template-defaults-fix.js'),
  dashboardDefaultsFix: path.join(ROOT, 'commands', '000-message-template-dashboard-fix.js'),
  adminMessages: path.join(ROOT, 'admin', 'messages.js'),
  adminWorkflow: path.join(ROOT, 'admin', 'message-template-workflow.js'),
  adminInlineEditor: path.join(ROOT, 'admin', 'message-inline-editor.js'),
};

const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

const AI_ALERT_LINES = [
  '## AI moderation alert',
  '**User:** <@mention> (`<user-id>`)',
  '**Channel:** <channel>',
  '**Severity:** <severity>/10',
  '**Broken rule(s):**',
  '<broken-rules>',
  '<separator>',
  '**Reason**',
  '<moderation-reason>',
  '<separator>',
  'English translation: "<english-translation>"',
  'Original language: <original-language>',
  'Matched terms: "<matched-terms>"',
  'Message: <message-link> "<message-content>"',
];

const USER_WARNING_LINES = [
  '## Message flagged',
  '<@mention>, your message in <channel> was flagged by AI moderation.',
  '<separator>',
  '**Severity:** <severity>/10',
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
  '-# User message: "<message-content>"',
  '-# Report link: <message-link>',
];

const OLD_AI_ALERT_LINES = [
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

const OLD_AI_ALERT_LINES_NO_TICKS = [
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

const SIMPLIFIED_AI_ALERT_LINES = [
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
  '-# User message: "<message-content>"',
  '-# Message: <message-link>',
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

const SIMPLIFIED_USER_WARNING_LINES = [
  '## Message flagged',
  '<@mention>, your message in <channel> was flagged by AI moderation.',
  '<separator>',
  '**Severity:** <severity>/10 (<severity-tier>)',
  '**Broken rule(s):**',
  '<broken-rules>',
  '**Reason:** <moderation-reason>',
  '-# If this was a mistake, please contact staff.',
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function escaped(lines) {
  return lines.join('\\n');
}

function replaceAll(text, oldValue, newValue) {
  return oldValue ? String(text).split(oldValue).join(newValue) : String(text);
}

function replaceOnce(text, oldValue, newValue) {
  const source = String(text);
  const index = source.indexOf(oldValue);
  if (index < 0) return source;
  return source.slice(0, index) + newValue + source.slice(index + oldValue.length);
}

function samePath(left, right) {
  return path.resolve(String(left || '')) === path.resolve(right);
}

function makeTemplate(id, name, accentColor, lines, thumbnailUrl = '') {
  return Object.freeze({
    id,
    type: 'template',
    folderId: '',
    name,
    content: '',
    containers: [{
      id: id.replace(/^default-/, '').slice(0, 40),
      accentColor,
      text: lines.join('\n'),
      thumbnailUrl,
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
    updatedAt: new Date(0).toISOString(),
  });
}

const DEFAULTS = new Map([
  ['default-ai-moderation-alert', makeTemplate('default-ai-moderation-alert', 'Default: AI moderation alert', '#9B59B6', AI_ALERT_LINES, '<avatar_url>')],
  ['default-ai-moderation-user-warning', makeTemplate('default-ai-moderation-user-warning', 'Default: AI moderation user warning', '#9B59B6', USER_WARNING_LINES)],
  ['default-link-auto-moderation-alert', makeTemplate('default-link-auto-moderation-alert', 'Default: Link Auto-Moderator alert', '#ED4245', LINK_ALERT_LINES, '<avatar_url>')],
]);

function mergeDefaultTemplate(base, saved) {
  const value = saved && typeof saved === 'object' ? saved : {};
  return {
    ...clone(base),
    ...value,
    id: base.id,
    type: 'template',
    folderId: '',
    name: base.name,
    content: '',
    containers: clone(base.containers),
    componentRows: Array.isArray(value.componentRows) ? clone(value.componentRows) : clone(base.componentRows),
    botDefault: true,
    defaultLocked: true,
  };
}

function patchTemplateObject(template) {
  if (!template || !DEFAULTS.has(template.id)) return template;
  return mergeDefaultTemplate(DEFAULTS.get(template.id), template);
}

function withCanonicalDefaults(templates) {
  const byId = new Map((Array.isArray(templates) ? templates : []).filter((item) => item?.id).map((item) => [item.id, item]));
  for (const base of DEFAULTS.values()) byId.set(base.id, mergeDefaultTemplate(base, byId.get(base.id)));
  return [...byId.values()];
}

function patchMessageTemplateExports(exportsObject) {
  if (!exportsObject || exportsObject.__coinSpriteAiAlertFormatPatched) return exportsObject;
  const nativeListTemplates = exportsObject.listTemplates.bind(exportsObject);
  const nativeFindTemplate = exportsObject.findTemplate.bind(exportsObject);
  const nativeSaveTemplate = exportsObject.saveTemplate.bind(exportsObject);
  const nativeDeleteTemplate = exportsObject.deleteTemplate.bind(exportsObject);

  exportsObject.DEFAULT_BOT_TEMPLATES = Object.freeze([...DEFAULTS.values()].map(clone));
  exportsObject.DEFAULT_LINK_AUTO_MODERATION_TEMPLATE = clone(DEFAULTS.get('default-link-auto-moderation-alert'));
  exportsObject.listTemplates = (guildId) => withCanonicalDefaults(nativeListTemplates(guildId));
  exportsObject.findTemplate = (guildId, templateId) => {
    if (DEFAULTS.has(templateId)) {
      return exportsObject.listTemplates(guildId).find((template) => template.id === templateId && template.type !== 'folder') || null;
    }
    return patchTemplateObject(nativeFindTemplate(guildId, templateId));
  };
  exportsObject.saveTemplate = (guildId, value) => patchTemplateObject(nativeSaveTemplate(guildId, patchTemplateObject(value)));
  exportsObject.deleteTemplate = (guildId, templateId) => DEFAULTS.has(templateId) ? false : nativeDeleteTemplate(guildId, templateId);
  Object.defineProperty(exportsObject, '__coinSpriteAiAlertFormatPatched', { value: true });
  return exportsObject;
}

function sourceArrayLines(lines, indent) {
  return lines.map((line) => indent + "'" + line.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "',").join('\n');
}

function patchDefaultTemplateText(source) {
  let text = String(source || '');
  text = replaceAll(text, escaped(OLD_AI_ALERT_LINES), escaped(AI_ALERT_LINES));
  text = replaceAll(text, escaped(OLD_AI_ALERT_LINES_NO_TICKS), escaped(AI_ALERT_LINES));
  text = replaceAll(text, escaped(SIMPLIFIED_AI_ALERT_LINES), escaped(AI_ALERT_LINES));
  text = replaceAll(text, escaped(OLD_USER_WARNING_LINES), escaped(USER_WARNING_LINES));
  text = replaceAll(text, escaped(SIMPLIFIED_USER_WARNING_LINES), escaped(USER_WARNING_LINES));
  text = replaceAll(text, '**Severity:** <severity>/10 (<severity-tier>)', '**Severity:** <severity>/10');
  text = replaceAll(text, '**Severity:** <severity> <severity-tier>/10', '**Severity:** <severity>/10');
  text = replaceAll(text, '**Action:** <moderation-action>', '**Action taken:** <moderation-action>');
  text = replaceAll(text, '## Link Auto-Moderator alert', '## Link Auto-Moderator report');
  text = text.replace(
    /(\s*)'\*\*English translation\*\*',\n\s*'<english-translation>',\n\s*'<separator>',\n\s*'-# Original language: <original-language>',\n\s*'-# Matched terms: <matched-terms>',\n\s*'-# Message: <message-link>',/g,
    (match, indent) => sourceArrayLines(AI_ALERT_LINES.slice(10), indent),
  );
  text = text.replace(
    /(\s*)'-# User message: "<message-content>"',\n\s*'-# Message: <message-link>',/g,
    (match, indent) => sourceArrayLines(AI_ALERT_LINES.slice(10), indent),
  );
  text = text.replace(
    /(\s*)'\*\*Severity:\*\* <severity>(?: <severity-tier>)?\/10(?: \(<severity-tier>\))?',/g,
    "$1'**Severity:** <severity>/10',",
  );
  return text;
}

function moderationPromptSource() {
  return [
    'const SYSTEM_PROMPT = [',
    "  'Return JSON only.'",
    "  'Clean or severity under 2: {\"flagged\":false,\"s\":0,\"rules\":[],\"reason\":\"\",\"originalLanguage\":\"\",\"englishTranslation\":\"\",\"matchedTerms\":[]}.'",
    "  'Violation severity 2-10: {\"flagged\":true,\"s\":2.2,\"rules\":[\"1.1\"],\"reason\":\"The message contains direct profanity or harassment that breaks the respect rule.\",\"originalLanguage\":\"English\",\"englishTranslation\":\"same text in English\",\"matchedTerms\":[\"exact offending term\"]}.'",
    "  'Use decimal severity when useful. Rules must be numbers only. Reason must be a clear staff-facing sentence; never return one-word reasons like short.'",
    "  'originalLanguage must be a human language name. englishTranslation must be English, or the original text when already English. matchedTerms must list exact offending words or phrases.'",
    '  RULE_GUIDE,',
    "].join(' ');",
  ].join('\n').replace(/'$/m, "',");
}

function normalizeReasonHelperSource() {
  return [
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
}

function normalizeFieldHelperSource() {
  return [
    'function normalizeModerationField(value, fallback = \'\') {',
    '  return compactWhitespace(value || fallback).slice(0, 180);',
    '}',
    '',
    'function normalizeModerationTerms(value = []) {',
    "  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\\n]/);",
    '  return [...new Set(raw.map((entry) => compactWhitespace(entry).slice(0, 80)).filter(Boolean))].slice(0, 10);',
    '}',
    '',
  ].join('\n');
}

function patchAiModeration(source) {
  let text = String(source || '');
  text = text.replace(/const SYSTEM_PROMPT = \[[\s\S]*?\]\.join\(' '\);/, moderationPromptSource());
  text = replaceAll(text, 'max_output_tokens: 60', 'max_output_tokens: 180');
  text = replaceAll(text, 'max_output_tokens: 120', 'max_output_tokens: 180');
  text = replaceAll(text, 'max_tokens: 60', 'max_tokens: 180');
  text = replaceAll(text, 'max_tokens: 120', 'max_tokens: 180');
  text = replaceAll(text, 'store: false', 'store: true');
  text = replaceOnce(
    text,
    "reason: 'Local rule match.',",
    "reason: matchedTerms.length ? `Matched local moderation term(s): ${matchedTerms.slice(0, 3).join(', ')}.` : 'Matched local moderation rules.',",
  );
  text = replaceOnce(
    text,
    "matchedTerms,\n    originalLanguage: '',\n    englishTranslation: '',\n    reason:",
    "matchedTerms,\n    originalLanguage: 'Unknown',\n    englishTranslation: text,\n    reason:",
  );
  text = text.replace(
    /required: \[[^\]]*'reason'[^\]]*\],/,
    "required: ['flagged', 's', 'rules', 'reason', 'originalLanguage', 'englishTranslation', 'matchedTerms'],",
  );
  if (!text.includes("originalLanguage: { type: 'string' }")) {
    text = replaceOnce(
      text,
      "reason: { type: 'string' },",
      "reason: { type: 'string' },\n      originalLanguage: { type: 'string' },\n      englishTranslation: { type: 'string' },\n      matchedTerms: { type: 'array', items: { type: 'string' } },",
    );
  }
  if (!text.includes('function normalizeModerationReason(')) {
    text = replaceOnce(text, "function normalizeResult(value = {}, source = 'ai') {", normalizeReasonHelperSource() + "function normalizeResult(value = {}, source = 'ai') {");
  }
  if (!text.includes('function normalizeModerationField(')) {
    text = replaceOnce(text, "function normalizeResult(value = {}, source = 'ai') {", normalizeFieldHelperSource() + "function normalizeResult(value = {}, source = 'ai') {");
  }
  text = replaceOnce(
    text,
    "reason: compactWhitespace(value.reason || 'Rule violation.').slice(0, 120),",
    "reason: normalizeModerationReason(value.reason, brokenRules, categories),",
  );
  text = text.replace(
    /(  return \{\n    flagged: true,\n    severity: severityFromScore\(score, true\),\n    severityScore: score,\n    brokenRules,\n    categories,\n)    matchedTerms: \[\],\n    originalLanguage: '',\n    englishTranslation: '',\n    reason:/,
    "$1    matchedTerms: normalizeModerationTerms(value.matchedTerms ?? value.matched_terms ?? value.terms),\n    originalLanguage: normalizeModerationField(value.originalLanguage ?? value.original_language ?? value.language, 'Unknown'),\n    englishTranslation: normalizeModerationField(value.englishTranslation ?? value.english_translation ?? value.translation, ''),\n    reason:",
  );
  return text;
}

function moderationMessagePreviewHelper() {
  return [
    'function moderationMessagePreview(message, max = 900) {',
    "  const text = String(message?.content || '').replace(/\\s+/g, ' ').trim();",
    "  if (!text) return '[no text content]';",
    "  const safe = text.replace(/[`*_~|>]/g, '').replace(/\"/g, \"'\");",
    "  return safe.length > max ? safe.slice(0, Math.max(0, max - 3)) + '...' : safe;",
    '}',
    '',
  ].join('\n');
}

function patchModeratorCommand(source) {
  let text = patchDefaultTemplateText(source);
  if (!text.includes('function moderationMessagePreview(')) {
    text = replaceOnce(text, 'function moderationValues(message, result, screenshot = null) {', moderationMessagePreviewHelper() + 'function moderationValues(message, result, screenshot = null) {');
  }
  text = replaceAll(text, "['severity-tier', formatSeverityScore(result.severityScore)],", "['severity-tier', result.severity || 'medium'],");
  if (!text.includes("['message-content',")) {
    text = replaceOnce(
      text,
      "['moderation-reason', result.reason || 'Rule violation.'],",
      "['moderation-reason', result.reason || 'Rule violation.'],\n    ['message-content', moderationMessagePreview(message)],",
    );
  }
  text = replaceAll(text, "['original-language', result.originalLanguage || ''],", "['original-language', result.originalLanguage || 'Unknown'],");
  text = replaceAll(text, "['english-translation', result.englishTranslation || ''],", "['english-translation', result.englishTranslation || moderationMessagePreview(message)],");
  text = replaceAll(text, 'const screenshot = await moderationScreenshot(message, result);', 'const screenshot = null;');
  return text;
}

function patchAdminInlineEditor(source) {
  let text = String(source || '');
  text = replaceAll(
    text,
    "if (qs('#messageTemplatesRoot') && !qs('script[src=\"/admin/messages.js\"]')) {",
    "if (qs('#messageTemplatesRoot') && !window.__coinSpriteAdminBundleIncludesMessages && !qs('script[src=\"/admin/messages.js\"]')) {",
  );
  if (!text.includes('__coinSpriteMessagesTabSyncInit')) {
    text = replaceOnce(
      text,
      'new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });\n  schedule();',
      "new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });\n  window.__coinSpriteMessagesTabSyncInit = true;\n  ensureMessagesTab();\n  schedule();",
    );
  }
  return text;
}

function patchFile(filePath, source) {
  if (samePath(filePath, TARGETS.aiModeration)) return patchAiModeration(source);
  if (samePath(filePath, TARGETS.moderatorCommand)) return patchModeratorCommand(source);
  if (samePath(filePath, TARGETS.messageTemplates)) return patchDefaultTemplateText(source);
  if (samePath(filePath, TARGETS.messageDefaultsFix)) return patchDefaultTemplateText(source);
  if (samePath(filePath, TARGETS.dashboardDefaultsFix)) return patchDefaultTemplateText(source);
  if (samePath(filePath, TARGETS.adminMessages)) return patchDefaultTemplateText(source);
  if (samePath(filePath, TARGETS.adminWorkflow)) return patchDefaultTemplateText(source);
  if (samePath(filePath, TARGETS.adminInlineEditor)) return patchAdminInlineEditor(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const original = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchFile(filePath, original);
  if (patched === original) return data;
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

patchMessageTemplateExports(messageTemplates);

fs.readFile = function readFileWithAiModerationFormatFix(filePath, options, callback) {
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

fs.readFileSync = function readFileSyncWithAiModerationFormatFix(filePath, options) {
  return patchReadData(filePath, nativeReadFileSync(filePath, options), options);
};

module.exports = {};
