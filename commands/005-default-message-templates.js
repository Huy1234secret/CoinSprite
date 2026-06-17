'use strict';

const messageTemplates = require('../src/messageTemplates');

const DEFAULT_BOT_TEMPLATES = Object.freeze([
  {
    id: 'default-ai-moderation-alert',
    type: 'template',
    folderId: '',
    name: 'Default: AI moderation alert',
    content: '',
    containers: [{
      id: 'ai-moderation-alert',
      accentColor: '#9B59B6',
      text: [
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
      ].join('\n'),
      thumbnailUrl: '<avatar_url>',
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
    updatedAt: new Date(0).toISOString(),
  },
  {
    id: 'default-ai-moderation-user-warning',
    type: 'template',
    folderId: '',
    name: 'Default: AI moderation user warning',
    content: '',
    containers: [{
      id: 'ai-moderation-user-warning',
      accentColor: '#9B59B6',
      text: [
        '## Message flagged',
        '<@mention>, your message in <channel> was flagged by AI moderation.',
        '<separator>',
        '**Severity:** <severity> <severity-tier>/10',
        '**Broken rule(s):**',
        '<broken-rules>',
        '**Reason:** <moderation-reason>',
        '-# If this was a mistake, please contact staff.',
      ].join('\n'),
      thumbnailUrl: '',
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
    updatedAt: new Date(0).toISOString(),
  },
]);

const nativeListTemplates = messageTemplates.listTemplates.bind(messageTemplates);
const nativeFindTemplate = messageTemplates.findTemplate.bind(messageTemplates);
const nativeSaveTemplate = messageTemplates.saveTemplate.bind(messageTemplates);
const nativeDeleteTemplate = messageTemplates.deleteTemplate.bind(messageTemplates);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function defaultTemplateById(templateId) {
  return DEFAULT_BOT_TEMPLATES.find((template) => template.id === templateId) || null;
}

function mergeDefaultTemplate(baseDefault, saved) {
  return {
    ...clone(baseDefault),
    ...(saved || {}),
    id: baseDefault.id,
    type: 'template',
    folderId: '',
    name: baseDefault.name,
    botDefault: true,
    defaultLocked: true,
  };
}

function mergeDefaults(savedTemplates) {
  const byId = new Map((savedTemplates || []).map((template) => [template.id, template]));
  for (const template of DEFAULT_BOT_TEMPLATES) {
    byId.set(template.id, mergeDefaultTemplate(template, byId.get(template.id)));
  }
  return [...byId.values()];
}

messageTemplates.listTemplates = function listTemplatesWithDefaults(guildId) {
  return mergeDefaults(nativeListTemplates(guildId));
};

messageTemplates.findTemplate = function findTemplateWithDefaults(guildId, templateId) {
  const defaultTemplate = defaultTemplateById(templateId);
  if (defaultTemplate) return mergeDefaultTemplate(defaultTemplate, nativeFindTemplate(guildId, templateId));
  return nativeFindTemplate(guildId, templateId);
};

messageTemplates.saveTemplate = function saveTemplateWithDefaults(guildId, value) {
  const defaultTemplate = defaultTemplateById(value?.id);
  if (!defaultTemplate) return nativeSaveTemplate(guildId, value);
  return nativeSaveTemplate(guildId, mergeDefaultTemplate(defaultTemplate, value));
};

messageTemplates.deleteTemplate = function deleteTemplateWithDefaults(guildId, templateId) {
  if (defaultTemplateById(templateId)) return false;
  return nativeDeleteTemplate(guildId, templateId);
};

module.exports = { DEFAULT_BOT_TEMPLATES };
