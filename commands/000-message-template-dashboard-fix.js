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
const ADMIN_PATCH_MARKER = '__coinSpriteDashboardTemplateDefaultsFix';
const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultTemplates() {
  const sourceDefaults = Array.isArray(messageTemplates.DEFAULT_BOT_TEMPLATES) ? messageTemplates.DEFAULT_BOT_TEMPLATES : [];
  const byId = new Map(sourceDefaults.filter((template) => template?.id).map((template) => [template.id, template]));
  byId.set(LINK_AUTO_MODERATION_TEMPLATE.id, LINK_AUTO_MODERATION_TEMPLATE); // ADDED: guarantee the third bot default exists even when older loaders omit it.
  return [...byId.values()];
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

function defaultTemplateById(templateId) {
  return defaultTemplates().find((template) => template.id === templateId) || null;
}

function withDefaultTemplates(templates) {
  const byId = new Map((Array.isArray(templates) ? templates : []).filter((template) => template?.id).map((template) => [template.id, template]));
  for (const template of defaultTemplates()) {
    byId.set(template.id, mergeDefaultTemplate(template, byId.get(template.id))); // FIXED: dashboards and APIs always include all three default templates.
  }
  return [...byId.values()];
}

function patchMessageTemplateExports(exportsObject) {
  if (!exportsObject || exportsObject.__coinSpriteDashboardDefaultsPatched) return exportsObject;
  const nativeListTemplates = exportsObject.listTemplates.bind(exportsObject);
  const nativeFindTemplate = exportsObject.findTemplate.bind(exportsObject);
  const nativeSaveTemplate = exportsObject.saveTemplate.bind(exportsObject);
  const nativeDeleteTemplate = exportsObject.deleteTemplate.bind(exportsObject);

  exportsObject.DEFAULT_BOT_TEMPLATES = Object.freeze(withDefaultTemplates(exportsObject.DEFAULT_BOT_TEMPLATES)); // FIXED: command-side default metadata now exposes all seeded templates.
  exportsObject.DEFAULT_LINK_AUTO_MODERATION_TEMPLATE = LINK_AUTO_MODERATION_TEMPLATE;
  exportsObject.listTemplates = (guildId) => withDefaultTemplates(nativeListTemplates(guildId)); // FIXED: empty guild storage still returns bot defaults.
  exportsObject.findTemplate = (guildId, templateId) => {
    if (defaultTemplateById(templateId)) return exportsObject.listTemplates(guildId).find((template) => template.id === templateId && template.type !== 'folder') || null; // FIXED: link default is findable before it has been saved.
    return nativeFindTemplate(guildId, templateId);
  };
  exportsObject.saveTemplate = (guildId, value) => {
    const baseDefault = defaultTemplateById(value?.id);
    return nativeSaveTemplate(guildId, baseDefault ? mergeDefaultTemplate(baseDefault, value) : value); // FIXED: edited defaults remain locked and keep their canonical names.
  };
  exportsObject.deleteTemplate = (guildId, templateId) => {
    if (defaultTemplateById(templateId)) return false; // FIXED: seeded defaults cannot be deleted from the dashboard.
    return nativeDeleteTemplate(guildId, templateId);
  };
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
  if (text.includes(ADMIN_PATCH_MARKER)) return text;

  if (!text.includes(LINK_AUTO_MODERATION_TEMPLATE.id)) {
    text = text.replace('  ];\n  let popover = null;', `,\n${clientDefaultObjectSource()}\n  ];\n  let popover = null;`); // FIXED: browser-side fallback now has the same third default as the bot.
  }

  text = text.replace(
    "          ${showingDefaults ? '' : '<div class=\"message-create-wrap\"><button class=\"button primary\" type=\"button\" data-message-action=\"create-open\">Create template</button>' + createMenu() + '</div>'}",
    "          ${showingDefaults ? '' : '<div class=\"message-create-wrap\"><button class=\"button primary\" type=\"button\" data-message-action=\"create-message\">Create template</button><button class=\"button subtle\" type=\"button\" data-message-action=\"create-folder\">New folder</button></div>'} // FIXED: main create button now creates a template immediately.",
  );
  text = text.replace(
    "    const shown = showingDefaults ? defaults : userTemplates;",
    "    const shown = showingDefaults ? (defaults.length ? defaults : withBuiltInDefaults([]).filter((item) => isDefaultTemplate(item) && item.type !== 'folder')) : userTemplates; // FIXED: defaults tab never renders empty when the API omits seeded templates.",
  );
  text = text.replace(
    "    if (action === 'create-open') { root.querySelector('#messageCreateMenu')?.toggleAttribute('hidden'); return; }",
    "    if (action === 'create-open') { button.dataset.messageAction = 'create-message'; button.click(); return; } // FIXED: cached dashboard markup falls back to direct template creation.",
  );
  return `${text}\n;(() => { window.${ADMIN_PATCH_MARKER} = true; })();\n`;
}

function patchAdminFile(filePath, source) {
  const resolved = path.resolve(String(filePath || ''));
  if (resolved === path.resolve(ADMIN_MESSAGES_PATH)) return patchAdminMessages(source);
  return source;
}

function patchReadData(filePath, data, options) {
  const encoding = typeof options === 'string' ? options : options?.encoding;
  const originalText = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
  const patched = patchAdminFile(filePath, originalText);
  if (patched === originalText) return data;
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
    try {
      done(null, patchReadData(filePath, data, readOptions));
    } catch (patchError) {
      done(patchError);
    }
  });
};

fs.readFileSync = function readFileSyncWithDashboardTemplateFix(filePath, options) {
  const data = nativeReadFileSync(filePath, options);
  return patchReadData(filePath, data, options); // FIXED: synchronous admin reads receive the same dashboard patch.
};

module.exports = {};
