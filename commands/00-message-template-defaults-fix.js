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
    ].join('\n'),
    thumbnailUrl: '<avatar_url>',
    imageUrl: '',
  }],
  componentRows: [],
  botDefault: true,
  defaultLocked: true,
  updatedAt: new Date(0).toISOString(),
});

const ADMIN_INDEX_PATH = path.join(__dirname, '..', 'admin', 'index.html');
const ADMIN_MESSAGES_PATH = path.join(__dirname, '..', 'admin', 'messages.js');
const ADMIN_PATCH_MARKER = '__coinSpriteDefaultMessagesCreateFix';
const HOTFIX_SCRIPT = '  <script src="/admin/message-template-defaults-fix.js?v=defaults-create-3" defer></script>';
const nativeReadFile = fs.readFile.bind(fs);
const nativeReadFileSync = fs.readFileSync.bind(fs);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeDefaultTemplate(saved) {
  const merged = {
    ...clone(LINK_AUTO_MODERATION_TEMPLATE),
    ...(saved || {}),
    id: LINK_AUTO_MODERATION_TEMPLATE.id,
    type: 'template',
    folderId: '',
    name: LINK_AUTO_MODERATION_TEMPLATE.name,
    botDefault: true,
    defaultLocked: true,
  };
  const rootContent = String(merged.content || '').trim();
  merged.content = '';
  if (rootContent) {
    const containers = Array.isArray(merged.containers) && merged.containers.length
      ? merged.containers
      : clone(LINK_AUTO_MODERATION_TEMPLATE.containers);
    containers[0] = {
      ...clone(LINK_AUTO_MODERATION_TEMPLATE.containers[0]),
      ...(containers[0] || {}),
      text: String(containers[0]?.text || '').trim() || rootContent,
    };
    merged.containers = containers;
  }
  return merged;
}

function withLinkDefault(templates) {
  const byId = new Map((Array.isArray(templates) ? templates : []).filter((template) => template?.id).map((template) => [template.id, template]));
  byId.set(LINK_AUTO_MODERATION_TEMPLATE.id, mergeDefaultTemplate(byId.get(LINK_AUTO_MODERATION_TEMPLATE.id)));
  return [...byId.values()];
}

function patchMessageTemplateExports(exportsObject) {
  if (!exportsObject || exportsObject.__coinSpriteLinkDefaultPatched) return exportsObject;
  const nativeListTemplates = exportsObject.listTemplates.bind(exportsObject);
  const nativeFindTemplate = exportsObject.findTemplate.bind(exportsObject);
  const nativeSaveTemplate = exportsObject.saveTemplate.bind(exportsObject);
  const nativeDeleteTemplate = exportsObject.deleteTemplate.bind(exportsObject);

  exportsObject.DEFAULT_LINK_AUTO_MODERATION_TEMPLATE = LINK_AUTO_MODERATION_TEMPLATE;
  exportsObject.listTemplates = (guildId) => withLinkDefault(nativeListTemplates(guildId));
  exportsObject.findTemplate = (guildId, templateId) => {
    if (templateId === LINK_AUTO_MODERATION_TEMPLATE.id) {
      return exportsObject.listTemplates(guildId).find((template) => template.id === templateId && template.type !== 'folder') || null;
    }
    return nativeFindTemplate(guildId, templateId);
  };
  exportsObject.saveTemplate = (guildId, value) => {
    if (value?.id === LINK_AUTO_MODERATION_TEMPLATE.id) return nativeSaveTemplate(guildId, mergeDefaultTemplate(value));
    return nativeSaveTemplate(guildId, value);
  };
  exportsObject.deleteTemplate = (guildId, templateId) => {
    if (templateId === LINK_AUTO_MODERATION_TEMPLATE.id) return false;
    return nativeDeleteTemplate(guildId, templateId);
  };
  Object.defineProperty(exportsObject, '__coinSpriteLinkDefaultPatched', { value: true });
  return exportsObject;
}

function clientDefaultObjectSource() {
  return JSON.stringify(clone(LINK_AUTO_MODERATION_TEMPLATE), null, 6)
    .replace(/^      \{/m, '    {')
    .replace(/\n      \}/, '\n    }');
}

function patchAdminIndex(source) {
  const text = String(source || '');
  if (text.includes('/admin/message-template-defaults-fix.js')) return text;
  return text.replace('</body>', `${HOTFIX_SCRIPT}\n</body>`);
}

function patchAdminMessages(source) {
  let text = String(source || '');
  if (text.includes(ADMIN_PATCH_MARKER)) return text;

  if (!text.includes(LINK_AUTO_MODERATION_TEMPLATE.id)) {
    text = text.replace(
      '  ];\n  let popover = null;',
      `,\n${clientDefaultObjectSource()}\n  ];\n  let popover = null;`,
    );
  }
  text = text.replace(
    'data-message-action="create-open">Create template</button>',
    'data-message-action="create-message">Create template</button>',
  );
  return `${text}\n;(() => { window.${ADMIN_PATCH_MARKER} = true; })();\n`;
}

function patchAdminFile(filePath, source) {
  const resolved = path.resolve(String(filePath || ''));
  if (resolved === path.resolve(ADMIN_INDEX_PATH)) return patchAdminIndex(source);
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

fs.readFile = function readFileWithMessageDefaultsPatch(filePath, options, callback) {
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

fs.readFileSync = function readFileSyncWithMessageDefaultsPatch(filePath, options) {
  const data = nativeReadFileSync(filePath, options);
  return patchReadData(filePath, data, options);
};

module.exports = {};
