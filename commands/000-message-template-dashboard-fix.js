'use strict';

const fs = require('fs');
const path = require('path');
const messageTemplates = require('../src/messageTemplates');

const LINK_AUTO_MODERATION_TEMPLATE = Object.freeze({
  id: 'default-link-auto-moderation-alert',
  type: 'template',
  folderId: '',
  name: 'Default: Link auto moderation alert',
  content: '',
  containers: [{
    id: 'link-auto-moderation-alert',
    accentColor: '#ED4245',
    text: [
      '## Link Auto-Moderator alert',
      '**User:** <@mention> (`<user-id>`)',
      '**Channel:** <channel>',
      '**Action:** <moderation-action>',
      '**Reason:** <moderation-reason>',
      '<separator>',
      '**Domain:** <blocked-domain>',
      '**URL:** <blocked-url>',
      '-# Message: <message-link>',
    ].join('\n'),
    thumbnailUrl: '<avatar_url>',
    imageUrl: '',
  }],
  componentRows: [],
  botDefault: true,
  defaultLocked: true,
  updatedAt: new Date(0).toISOString(),
});

const ADMIN_MESSAGES_PATH = path.join(__dirname, '..', 'admin', 'messages.js');
const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function allDefaultTemplates() {
  const byId = new Map((Array.isArray(messageTemplates.DEFAULT_BOT_TEMPLATES) ? messageTemplates.DEFAULT_BOT_TEMPLATES : []).filter((template) => template?.id).map((template) => [template.id, template]));
  byId.set(LINK_AUTO_MODERATION_TEMPLATE.id, LINK_AUTO_MODERATION_TEMPLATE); // ADDED: preserve the third default template everywhere.
  return [...byId.values()];
}

function defaultTemplateById(templateId) {
  return allDefaultTemplates().find((template) => template.id === templateId) || null;
}

function mergeDefaultTemplate(baseDefault, saved) {
  const merged = {
    ...clone(baseDefault),
    ...(saved || {}),
    id: baseDefault.id,
    type: 'template',
    folderId: '',
    name: baseDefault.name,
    botDefault: true,
    defaultLocked: true,
  };
  const rootContent = String(merged.content || '').trim();
  merged.content = '';
  if (rootContent) {
    const containers = Array.isArray(merged.containers) && merged.containers.length ? merged.containers : clone(baseDefault.containers);
    containers[0] = {
      ...clone(baseDefault.containers[0]),
      ...(containers[0] || {}),
      text: String(containers[0]?.text || '').trim() || rootContent,
    };
    merged.containers = containers;
  }
  return merged;
}

function withDefaultTemplates(templates) {
  const byId = new Map((Array.isArray(templates) ? templates : []).filter((template) => template?.id).map((template) => [template.id, template]));
  for (const template of allDefaultTemplates()) byId.set(template.id, mergeDefaultTemplate(template, byId.get(template.id))); // FIXED: empty guild lists still contain all defaults.
  return [...byId.values()];
}

function patchMessageTemplateExports(exportsObject) {
  if (!exportsObject || exportsObject.__coinSpriteDashboardDefaultsPatched) return exportsObject;
  const nativeListTemplates = exportsObject.listTemplates.bind(exportsObject);
  const nativeFindTemplate = exportsObject.findTemplate.bind(exportsObject);
  const nativeSaveTemplate = exportsObject.saveTemplate.bind(exportsObject);
  const nativeDeleteTemplate = exportsObject.deleteTemplate.bind(exportsObject);
  exportsObject.DEFAULT_BOT_TEMPLATES = Object.freeze(withDefaultTemplates(exportsObject.DEFAULT_BOT_TEMPLATES)); // FIXED: shared default metadata now has three templates.
  exportsObject.DEFAULT_LINK_AUTO_MODERATION_TEMPLATE = LINK_AUTO_MODERATION_TEMPLATE;
  exportsObject.listTemplates = (guildId) => withDefaultTemplates(nativeListTemplates(guildId)); // FIXED: API responses include bot defaults for every guild.
  exportsObject.findTemplate = (guildId, templateId) => defaultTemplateById(templateId)
    ? exportsObject.listTemplates(guildId).find((template) => template.id === templateId && template.type !== 'folder') || null
    : nativeFindTemplate(guildId, templateId);
  exportsObject.saveTemplate = (guildId, value) => {
    const baseDefault = defaultTemplateById(value?.id);
    return nativeSaveTemplate(guildId, baseDefault ? mergeDefaultTemplate(baseDefault, value) : value); // FIXED: edited defaults stay locked and canonical.
  };
  exportsObject.deleteTemplate = (guildId, templateId) => defaultTemplateById(templateId) ? false : nativeDeleteTemplate(guildId, templateId); // FIXED: default templates cannot be deleted.
  Object.defineProperty(exportsObject, '__coinSpriteDashboardDefaultsPatched', { value: true });
  return exportsObject;
}

function clientDefaultObjectSource() {
  return JSON.stringify(clone(LINK_AUTO_MODERATION_TEMPLATE), null, 6)
    .replace(/^      \{/m, '    {')
    .replace(/\n      \}/, '\n    }');
}

function patchAdminMessages(source) {
  let text = String(source || '');
  if (!text.includes(LINK_AUTO_MODERATION_TEMPLATE.id)) {
    text = text.replace('  ];\n  let popover = null;', `,\n${clientDefaultObjectSource()}\n  ];\n  let popover = null;`); // FIXED: client fallback default list has all three bot defaults.
  }
  text = text.replace('data-message-action="create-open">Create template</button>', 'data-message-action="create-message">Create template</button>'); // FIXED: Create template works as a direct create action.
  return text;
}

function patchReadData(filePath, data, options) {
  const resolved = path.resolve(String(filePath || ''));
  if (resolved !== path.resolve(ADMIN_MESSAGES_PATH)) return data;
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminMessages(originalText);
  return encoding ? patched : Buffer.from(patched, 'utf8');
}

patchMessageTemplateExports(messageTemplates);

fs.readFile = function readFileWithDashboardTemplateFix(filePath, options, callback) {
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
    done(null, patchReadData(filePath, data, readOptions));
  });
};

fs.readFileSync = function readFileSyncWithDashboardTemplateFix(filePath, options) {
  return patchReadData(filePath, nativeReadFileSync(filePath, options), options); // FIXED: sync admin reads match async patched assets.
};

module.exports = {};
