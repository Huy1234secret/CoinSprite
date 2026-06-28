'use strict';

const { sanitizeTemplate } = require('./messageTemplates');

const EVENT_NAMES = Object.freeze(['welcome', 'goodbye', 'booster']);
const DEFAULTS = Object.freeze({
  welcome: {
    accentColor: '#57F287',
    text: '## Welcome <@mention>\nWelcome to **<server-name>**! You are member **<member-count>**.',
  },
  goodbye: {
    accentColor: '#ED4245',
    text: '## Member left\n**<display-name>** has left **<server-name>**.',
  },
  booster: {
    accentColor: '#FF73FA',
    text: '## Server boosted\nThank you <@mention> for boosting **<server-name>**!',
  },
});

function defaultTemplate(eventName) {
  const defaults = DEFAULTS[eventName] || DEFAULTS.welcome;
  return {
    id: 'community-' + eventName,
    type: 'template',
    folderId: '',
    name: eventName + ' message',
    content: '',
    containers: [{
      id: eventName + '-container',
      accentColor: defaults.accentColor,
      text: defaults.text,
      thumbnailUrl: '<avatar_url>',
      imageUrl: '',
    }],
    componentRows: [],
  };
}

function legacyTemplate(eventName, value) {
  const template = defaultTemplate(eventName);
  const text = String(value || '').trim();
  if (text) template.containers[0].text = text;
  return template;
}

function sanitizeCommunityTemplate(eventName, value, legacyMessage = '') {
  const source = value && typeof value === 'object'
    ? value
    : legacyTemplate(eventName, legacyMessage || value);
  const template = sanitizeTemplate(source);
  return {
    ...template,
    id: 'community-' + eventName,
    name: eventName + ' message',
    folderId: '',
    botDefault: false,
    defaultLocked: false,
    componentRows: [],
  };
}

function sanitizeCommunityMessages(value) {
  const source = value && typeof value === 'object' ? value : {};
  return Object.fromEntries(EVENT_NAMES.map((eventName) => {
    const event = source[eventName] && typeof source[eventName] === 'object' ? source[eventName] : {};
    const channelId = String(event.channelId || '');
    return [eventName, {
      enabled: Boolean(event.enabled),
      channelId: /^\d{16,20}$/.test(channelId) ? channelId : '',
      messageTemplate: sanitizeCommunityTemplate(eventName, event.messageTemplate, event.message),
    }];
  }));
}

module.exports = {
  DEFAULTS,
  EVENT_NAMES,
  defaultTemplate,
  sanitizeCommunityMessages,
  sanitizeCommunityTemplate,
};
