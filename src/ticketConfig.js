const COMPONENTS_V2_FLAG = 32768;

const DEFAULT_TICKET_MESSAGE = Object.freeze({
  content: [
    '<@mention> Welcome!',
    '## <ticket_name> ticket',
    'Our staff will be with you soon. Please provide the information needed to help us resolve your request.',
    '<separator>',
    '<form-answer>',
  ].join('\n'),
  accentColor: '#FFFFFF',
  thumbnailUrl: '<avatar_url>',
  imageUrl: '',
});

const DEFAULT_LAUNCHER_MESSAGE = Object.freeze({
  content: [
    '## Support Ticket',
    'Choose the ticket type that best matches your request.',
    '<separator>',
    '-# Please do not open joke, false, or duplicate tickets.',
    '-# Staff will respond as soon as they are available.',
  ].join('\n'),
  accentColor: '#FFFFFF',
  thumbnailUrl: '',
  imageUrl: '',
});

const DEFAULT_STAFF_PERMISSIONS = Object.freeze([
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'ManageMessages',
  'AttachFiles',
  'EmbedLinks',
]);

const DEFAULT_AUTHOR_PERMISSIONS = Object.freeze([
  'ViewChannel',
  'SendMessages',
  'ReadMessageHistory',
  'AttachFiles',
  'EmbedLinks',
]);

const ALLOWED_PERMISSIONS = Object.freeze([
  'CreateInstantInvite',
  'KickMembers',
  'BanMembers',
  'Administrator',
  'ManageChannels',
  'ManageGuild',
  'AddReactions',
  'ViewAuditLog',
  'PrioritySpeaker',
  'Stream',
  'ViewChannel',
  'SendMessages',
  'SendTTSMessages',
  'ManageMessages',
  'EmbedLinks',
  'AttachFiles',
  'ReadMessageHistory',
  'MentionEveryone',
  'UseExternalEmojis',
  'ViewGuildInsights',
  'Connect',
  'Speak',
  'MuteMembers',
  'DeafenMembers',
  'MoveMembers',
  'UseVAD',
  'ChangeNickname',
  'ManageNicknames',
  'ManageRoles',
  'ManageWebhooks',
  'ManageEmojisAndStickers',
  'ManageGuildExpressions',
  'UseApplicationCommands',
  'RequestToSpeak',
  'ManageEvents',
  'ManageThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'UseExternalStickers',
  'SendMessagesInThreads',
  'UseEmbeddedActivities',
  'ModerateMembers',
  'ViewCreatorMonetizationAnalytics',
  'UseSoundboard',
  'CreateGuildExpressions',
  'CreateEvents',
  'UseExternalSounds',
  'SendVoiceMessages',
  'SendPolls',
  'UseExternalApps',
  'PinMessages',
  'BypassSlowmode',
]);

const FORM_TYPES = Object.freeze([
  'string_select',
  'text_input',
  'user_select',
  'role_select',
  'channel_select',
  'file_upload',
  'radio_group',
  'checkbox_group',
  'checkbox',
  'text_display',
]);

const ADMIN_ACTIONS = Object.freeze(['close', 'transcript', 'delete', 'blacklist', 'move_to']);
const BUTTON_STYLES = Object.freeze(['primary', 'secondary', 'success', 'danger']);
const LAUNCHER_STYLES = Object.freeze(['select', 'buttons']);

const DEFAULT_ADMIN_CONTROLS = Object.freeze([
  {
    id: 'close',
    name: 'Close Ticket',
    emoji: '⛔',
    description: 'Close, transcript, and delete this ticket.',
    buttonStyle: 'danger',
    url: '',
    actions: ['close', 'transcript', 'delete'],
    moveToTicketTypeId: '',
  },
  {
    id: 'blacklist',
    name: 'Blacklist User',
    emoji: '🚫',
    description: 'Blacklist the ticket author, then close the ticket.',
    buttonStyle: 'secondary',
    url: '',
    actions: ['close', 'blacklist', 'transcript', 'delete'],
    moveToTicketTypeId: '',
  },
]);

const DEFAULT_TICKETS_CONFIG = Object.freeze({
  enabled: true,
  launcherStyle: 'select',
  launcherMessage: DEFAULT_LAUNCHER_MESSAGE,
  types: [],
});

function legacyTicketType(id, name, emoji, description, workflow, createQuestions = [], closeQuestions = []) {
  return {
    id,
    workflow,
    name,
    emoji,
    description,
    buttonStyle: 'primary',
    staffRoleIds: [],
    blacklistRoleId: '',
    staffPermissions: [...DEFAULT_STAFF_PERMISSIONS],
    authorPermissions: [...DEFAULT_AUTHOR_PERMISSIONS],
    transcriptEnabled: true,
    transcriptChannelId: '',
    categoryChannelId: '',
    message: { ...DEFAULT_TICKET_MESSAGE },
    adminPanel: {
      enabled: true,
      style: 'select',
      controls: DEFAULT_ADMIN_CONTROLS.map((control) => ({ ...control, actions: [...control.actions] })),
    },
    forms: {
      enabled: createQuestions.length > 0 || closeQuestions.length > 0,
      create: createQuestions,
      close: closeQuestions,
    },
  };
}

const LEGACY_DEFAULT_TICKET_TYPES = Object.freeze([
  legacyTicketType(
    'guild_support',
    'Guild Support',
    '🛡️',
    'Guild help, member issues, questions, or other guild-related support.',
    'guild_support',
    [{
      id: 'support_type',
      order: 1,
      type: 'radio_group',
      question: 'What type of support do you need?',
      required: true,
      options: [
        { name: 'Member Report', description: '', emoji: '' },
        { name: 'Other Support', description: '', emoji: '' },
      ],
    }],
  ),
  legacyTicketType(
    'request_giveaway',
    'Request Giveaway',
    '🎁',
    'Request a giveaway ticket.',
    'request_giveaway',
    [],
    [{
      id: 'winner_claim_proof',
      order: 1,
      type: 'file_upload',
      question: 'Upload proof that winners claimed prizes',
      required: true,
      maxFiles: 10,
    }],
  ),
  legacyTicketType(
    'request_role_crew_member_plus',
    'Guild Join Request',
    '⭐',
    'Verify your stats to join the guild.',
    'request_role_crew_member_plus',
    [
      {
        id: 'game',
        order: 1,
        type: 'radio_group',
        question: 'What game are you playing?',
        required: true,
        options: [
          { name: 'Universe Tower Defense X', description: '', emoji: '' },
          { name: 'Sailor Piece', description: '', emoji: '' },
        ],
      },
      {
        id: 'roblox_username',
        order: 2,
        type: 'text_input',
        question: 'What is your Roblox username?',
        required: true,
        placeholder: '',
        textStyle: 'paragraph',
        minLength: 0,
        maxLength: 300,
      },
      {
        id: 'evidence',
        order: 3,
        type: 'file_upload',
        question: 'Upload proof you meet role requirements',
        required: false,
        maxFiles: 10,
      },
    ],
  ),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function boundedString(value, fallback = '', maxLength = 100) {
  const clean = String(value ?? '').trim();
  return (clean || String(fallback ?? '').trim()).slice(0, maxLength);
}

function optionalString(value, fallback = '', maxLength = 100) {
  if (value === undefined) return String(fallback ?? '').trim().slice(0, maxLength);
  return String(value ?? '').trim().slice(0, maxLength);
}

function boundedInteger(value, fallback, min, max) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? Math.floor(numeric) : Number(fallback);
  return Math.max(min, Math.min(max, Number.isFinite(resolved) ? resolved : min));
}

function enumValue(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeId(value, fallback = 'item', maxLength = 40) {
  const clean = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength);
  return clean || fallback;
}

function sanitizeSnowflake(value, fallback = '') {
  const clean = String(value ?? '').trim();
  return /^\d{16,20}$/.test(clean) ? clean : fallback;
}

function sanitizeAccentColor(value, fallback = '#FFFFFF') {
  const clean = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean.toUpperCase() : fallback;
}

function sanitizeHttpUrl(value, fallback = '', maxLength = 1000) {
  const clean = optionalString(value, fallback, maxLength);
  if (!clean || /^<[^>]+>$/.test(clean)) return clean;
  try {
    const url = new URL(clean);
    return url.protocol === 'https:' || url.protocol === 'http:' ? clean : '';
  } catch {
    return '';
  }
}

function sanitizeTicketMessage(value, fallback = DEFAULT_TICKET_MESSAGE) {
  const source = isObject(value) ? value : {};
  const base = isObject(fallback) ? fallback : DEFAULT_TICKET_MESSAGE;
  const fallbackContainer = {
    id: 'container-1',
    text: boundedString(source.content, base.content || DEFAULT_TICKET_MESSAGE.content, 4000),
    accentColor: sanitizeAccentColor(source.accentColor, sanitizeAccentColor(base.accentColor)),
    thumbnailUrl: sanitizeHttpUrl(source.thumbnailUrl, base.thumbnailUrl, 1000),
    imageUrl: sanitizeHttpUrl(source.imageUrl, base.imageUrl, 1000),
  };
  const rawContainers = Array.isArray(source.containers) ? source.containers : [fallbackContainer];
  const containers = rawContainers.slice(0, 8).map((value, index) => {
    const container = isObject(value) ? value : {};
    const legacy = index === 0 ? fallbackContainer : {};
    return {
      id: boundedString(container.id, `container-${index + 1}`, 80),
      text: boundedString(container.text, legacy.text || '', 4000),
      accentColor: sanitizeAccentColor(container.accentColor, legacy.accentColor || '#5865F2'),
      thumbnailUrl: sanitizeHttpUrl(container.thumbnailUrl, legacy.thumbnailUrl || '', 1000),
      imageUrl: sanitizeHttpUrl(container.imageUrl, legacy.imageUrl || '', 1000),
    };
  });
  const first = containers[0] || fallbackContainer;
  return {
    content: first.text,
    outsideContent: optionalString(source.outsideContent, '', 2000),
    accentColor: first.accentColor,
    thumbnailUrl: first.thumbnailUrl,
    imageUrl: first.imageUrl,
    containers,
  };
}

function sanitizeOption(value, index) {
  const source = isObject(value) ? value : {};
  return {
    name: boundedString(source.name ?? source.label, `Option ${index + 1}`, 100),
    description: optionalString(source.description, '', 100),
    emoji: optionalString(source.emoji, '', 100),
  };
}

function sanitizeOptions(value, maxOptions, minimum = 1) {
  const source = Array.isArray(value) ? value : [];
  const options = source.slice(0, maxOptions).map(sanitizeOption);
  while (options.length < minimum) options.push(sanitizeOption({}, options.length));
  return options;
}

function sanitizeFormQuestion(value, index) {
  const source = isObject(value) ? value : {};
  const type = enumValue(source.type, FORM_TYPES, 'text_input');
  const question = type === 'text_display'
    ? boundedString(source.question ?? source.content, 'Information', 4000)
    : boundedString(source.question, `Question ${index + 1}`, 45);
  const base = {
    id: sanitizeId(source.id, `question-${index + 1}`, 40),
    order: boundedInteger(source.order, index + 1, 1, 5),
    type,
    question,
    required: type === 'text_display' || type === 'checkbox' ? false : Boolean(source.required),
  };

  if (type === 'text_input') {
    base.placeholder = optionalString(source.placeholder, '', 100);
    base.textStyle = enumValue(source.textStyle, ['short', 'paragraph'], 'paragraph');
    base.minLength = boundedInteger(source.minLength, 0, 0, 4000);
    base.maxLength = boundedInteger(source.maxLength, 4000, Math.max(1, base.minLength), 4000);
  } else if (type === 'string_select') {
    base.placeholder = optionalString(source.placeholder, '', 150);
    base.options = sanitizeOptions(source.options, 25, 1);
    base.minValues = boundedInteger(source.minValues, base.required ? 1 : 0, base.required ? 1 : 0, base.options.length);
    base.maxValues = boundedInteger(source.maxValues, 1, Math.max(1, base.minValues), base.options.length);
  } else if (type === 'radio_group') {
    base.options = sanitizeOptions(source.options, 10, 2);
  } else if (type === 'checkbox_group') {
    base.options = sanitizeOptions(source.options, 10, 1);
    base.minValues = boundedInteger(source.minValues, base.required ? 1 : 0, base.required ? 1 : 0, base.options.length);
    base.maxValues = boundedInteger(source.maxValues, base.options.length, Math.max(1, base.minValues), base.options.length);
  } else if (['user_select', 'role_select', 'channel_select'].includes(type)) {
    base.placeholder = optionalString(source.placeholder, '', 150);
    base.minValues = boundedInteger(source.minValues, base.required ? 1 : 0, base.required ? 1 : 0, 25);
    base.maxValues = boundedInteger(source.maxValues, 1, Math.max(1, base.minValues), 25);
  } else if (type === 'file_upload') {
    base.maxFiles = boundedInteger(source.maxFiles, 1, 1, 10);
  } else if (type === 'checkbox') {
    base.default = Boolean(source.default);
  }

  return base;
}

function sanitizeQuestionList(value) {
  const usedIds = new Set();
  const questions = (Array.isArray(value) ? value : [])
    .slice(0, 5)
    .map(sanitizeFormQuestion)
    .sort((a, b) => a.order - b.order);
  for (const [index, question] of questions.entries()) {
    let id = question.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${question.id.slice(0, 35)}-${suffix}`;
      suffix += 1;
    }
    question.id = id;
    question.order = index + 1;
    usedIds.add(id);
  }
  return questions;
}

function sanitizePermissions(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((permission) => ALLOWED_PERMISSIONS.includes(permission)))];
}

function sanitizeAdminControl(value, index) {
  const source = isObject(value) ? value : {};
  const url = sanitizeHttpUrl(source.url, '', 512);
  const actions = url
    ? []
    : [...new Set((Array.isArray(source.actions) ? source.actions : []).filter((action) => ADMIN_ACTIONS.includes(action)))].slice(0, 5);
  if (!url && actions.length === 0) actions.push('close');
  return {
    id: sanitizeId(source.id, `control-${index + 1}`, 32),
    name: boundedString(source.name, `Action ${index + 1}`, 80),
    emoji: url ? '' : optionalString(source.emoji, '', 100),
    description: optionalString(source.description, '', 100),
    buttonStyle: enumValue(source.buttonStyle, BUTTON_STYLES, 'secondary'),
    url,
    actions,
    moveToTicketTypeId: actions.includes('move_to') ? sanitizeId(source.moveToTicketTypeId, '', 40) : '',
  };
}

function sanitizeAdminPanel(value, fallback = {}) {
  const source = isObject(value) ? value : {};
  const base = isObject(fallback) ? fallback : {};
  const rawControls = Array.isArray(source.controls)
    ? source.controls
    : (Array.isArray(base.controls) ? base.controls : DEFAULT_ADMIN_CONTROLS);
  const usedIds = new Set();
  const controls = rawControls.slice(0, 25).map((control, index) => {
    const sanitized = sanitizeAdminControl(control, index);
    let id = sanitized.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${sanitized.id.slice(0, 27)}-${suffix}`;
      suffix += 1;
    }
    sanitized.id = id;
    usedIds.add(id);
    return sanitized;
  });
  return {
    enabled: 'enabled' in source ? Boolean(source.enabled) : (base.enabled ?? true),
    style: enumValue(source.style, LAUNCHER_STYLES, enumValue(base.style, LAUNCHER_STYLES, 'select')),
    controls,
  };
}

function sanitizeTicketType(value, index, fallback = {}) {
  const source = isObject(value) ? value : {};
  const base = isObject(fallback) ? fallback : {};
  const workflow = enumValue(
    source.workflow,
    ['generic', 'guild_support', 'request_giveaway', 'request_role_crew_member_plus'],
    enumValue(base.workflow, ['generic', 'guild_support', 'request_giveaway', 'request_role_crew_member_plus'], 'generic'),
  );
  return {
    id: sanitizeId(source.id, sanitizeId(base.id, `ticket-${index + 1}`), 40),
    workflow,
    name: boundedString(source.name, base.name || `Ticket ${index + 1}`, 80),
    emoji: optionalString(source.emoji, base.emoji, 100),
    description: optionalString(source.description, base.description, 100),
    buttonStyle: enumValue(source.buttonStyle, BUTTON_STYLES, enumValue(base.buttonStyle, BUTTON_STYLES, 'primary')),
    staffRoleIds: [...new Set((Array.isArray(source.staffRoleIds) ? source.staffRoleIds : (base.staffRoleIds || []))
      .map((roleId) => sanitizeSnowflake(roleId))
      .filter(Boolean))].slice(0, 25),
    blacklistRoleId: sanitizeSnowflake(source.blacklistRoleId, sanitizeSnowflake(base.blacklistRoleId)),
    staffPermissions: sanitizePermissions(source.staffPermissions, base.staffPermissions || DEFAULT_STAFF_PERMISSIONS),
    authorPermissions: sanitizePermissions(source.authorPermissions, base.authorPermissions || DEFAULT_AUTHOR_PERMISSIONS),
    transcriptEnabled: 'transcriptEnabled' in source ? Boolean(source.transcriptEnabled) : (base.transcriptEnabled ?? true),
    transcriptChannelId: sanitizeSnowflake(source.transcriptChannelId, sanitizeSnowflake(base.transcriptChannelId)),
    categoryChannelId: sanitizeSnowflake(source.categoryChannelId, sanitizeSnowflake(base.categoryChannelId)),
    message: sanitizeTicketMessage(source.message, base.message || DEFAULT_TICKET_MESSAGE),
    adminPanel: sanitizeAdminPanel(source.adminPanel, base.adminPanel),
    forms: {
      enabled: isObject(source.forms) && 'enabled' in source.forms
        ? Boolean(source.forms.enabled)
        : Boolean(base.forms?.enabled),
      create: sanitizeQuestionList(source.forms?.create ?? base.forms?.create),
      close: sanitizeQuestionList(source.forms?.close ?? base.forms?.close),
    },
  };
}

function sanitizeTicketsConfig(value, fallback = DEFAULT_TICKETS_CONFIG) {
  const source = isObject(value) ? value : {};
  const base = isObject(fallback) ? fallback : DEFAULT_TICKETS_CONFIG;
  const fallbackById = new Map((Array.isArray(base.types) ? base.types : []).map((type) => [type.id, type]));
  const rawTypes = Array.isArray(source.types) ? source.types : (Array.isArray(base.types) ? base.types : []);
  const usedIds = new Set();
  const types = rawTypes.slice(0, 25).map((type, index) => {
    const sanitized = sanitizeTicketType(type, index, fallbackById.get(type?.id));
    let id = sanitized.id;
    let suffix = 2;
    while (usedIds.has(id)) {
      id = `${sanitized.id.slice(0, 35)}-${suffix}`;
      suffix += 1;
    }
    sanitized.id = id;
    usedIds.add(id);
    return sanitized;
  });
  return {
    enabled: 'enabled' in source ? Boolean(source.enabled) : (base.enabled ?? true),
    launcherStyle: enumValue(source.launcherStyle, LAUNCHER_STYLES, enumValue(base.launcherStyle, LAUNCHER_STYLES, 'select')),
    launcherMessage: sanitizeTicketMessage(source.launcherMessage, base.launcherMessage || DEFAULT_LAUNCHER_MESSAGE),
    types,
  };
}

function discordEmoji(value) {
  const clean = String(value || '').trim();
  if (!clean) return undefined;
  const custom = clean.match(/^<a?:([a-zA-Z0-9_]+):(\d{16,20})>$/);
  if (custom) return { name: custom[1], id: custom[2], animated: clean.startsWith('<a:') };
  return { name: clean };
}

function renderTicketTemplate(template, context = {}) {
  const replacements = {
    '@mention': context.mention,
    username: context.username,
    display_name: context.displayName,
    displayname: context.displayName,
    user_id: context.userId,
    userid: context.userId,
    ticket_name: context.ticketName,
    'ticket name': context.ticketName,
    ticket_id: context.ticketId,
    'ticket id': context.ticketId,
    channel: context.channel,
    server: context.server,
    avatar_url: context.avatarUrl,
    'form-answer': context.formAnswers,
    form_answer: context.formAnswers,
  };
  return String(template ?? '').replace(
    /<(@mention|username|display_name|displayname|user_id|userid|ticket_name|ticket name|ticket_id|ticket id|channel|server|avatar_url|form-answer|form_answer)>/gi,
    (match, key) => String(replacements[key.toLowerCase()] ?? ''),
  );
}

function mediaUrlFromTemplate(template, context) {
  const rendered = renderTicketTemplate(template, context).trim();
  if (!rendered) return null;
  try {
    const url = new URL(rendered);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildTextComponents(content, thumbnailUrl) {
  const rawSections = content.split(/<separator>/gi).map((section) => section.trim()).filter(Boolean);
  const sections = rawSections.length > 18
    ? [...rawSections.slice(0, 17), rawSections.slice(17).join('\n\n')]
    : rawSections;
  const components = [];
  sections.forEach((section, index) => {
    if (index > 0) components.push({ type: 14, divider: true, spacing: 1 });
    if (index === 0 && thumbnailUrl) {
      components.push({
        type: 9,
        components: [{ type: 10, content: section }],
        accessory: { type: 11, media: { url: thumbnailUrl } },
      });
    } else {
      components.push({ type: 10, content: section });
    }
  });
  return components;
}

function buildTicketMessagePayload(messageValue, context = {}, extraComponents = []) {
  const message = sanitizeTicketMessage(messageValue);
  const messageComponents = [];
  const outsideContent = renderTicketTemplate(message.outsideContent, context).trim();
  if (outsideContent) messageComponents.push(...buildTextComponents(outsideContent, null));

  for (const container of message.containers) {
    const rendered = renderTicketTemplate(container.text, context).trim();
    const components = rendered
      ? buildTextComponents(rendered, mediaUrlFromTemplate(container.thumbnailUrl, context))
      : [];
    const imageUrl = mediaUrlFromTemplate(container.imageUrl, context);
    if (imageUrl) components.push({ type: 12, items: [{ media: { url: imageUrl } }] });
    if (components.length) {
      messageComponents.push({
        type: 17,
        accent_color: Number.parseInt(container.accentColor.slice(1), 16),
        components,
      });
    }
  }

  if (!messageComponents.length) {
    const rendered = renderTicketTemplate(DEFAULT_TICKET_MESSAGE.content, context).trim();
    messageComponents.push({
      type: 17,
      accent_color: Number.parseInt(DEFAULT_TICKET_MESSAGE.accentColor.slice(1), 16),
      components: buildTextComponents(rendered, mediaUrlFromTemplate(DEFAULT_TICKET_MESSAGE.thumbnailUrl, context)),
    });
  }

  function componentCount(component) {
    if (!component || typeof component !== 'object') return 0;
    const children = Array.isArray(component.components)
      ? component.components.reduce((total, child) => total + componentCount(child), 0)
      : 0;
    const accessory = component.accessory ? componentCount(component.accessory) : 0;
    return 1 + children + accessory;
  }

  const totalCount = () => [...messageComponents, ...extraComponents].reduce(
    (total, component) => total + componentCount(component),
    0,
  );
  while (messageComponents.length > 1 && totalCount() > 40) messageComponents.pop();

  return {
    allowedMentions: context.userId ? { parse: [], users: [context.userId] } : { parse: [] },
    flags: COMPONENTS_V2_FLAG,
    components: [...messageComponents, ...extraComponents],
  };
}

function formatFormAnswers(questionAnswerPairs) {
  return (Array.isArray(questionAnswerPairs) ? questionAnswerPairs : [])
    .filter((entry) => entry && entry.type !== 'text_display' && String(entry.answer ?? '').trim())
    .sort((a, b) => Number(a.order) - Number(b.order))
    .map((entry, index) => {
      const answer = String(entry.answer ?? '').trim();
      const answerLines = answer.split('\n').map((line) => `-# ${line}`).join('\n');
      return `**${index + 1}# ${entry.question}**\n${answerLines}`;
    })
    .join('\n\n');
}

function orderAdminActions(actions) {
  const result = [...new Set((Array.isArray(actions) ? actions : []).filter((action) => ADMIN_ACTIONS.includes(action)))];
  const fixed = result.filter((action) => ['close', 'transcript', 'delete'].includes(action)).sort(
    (a, b) => ['close', 'transcript', 'delete'].indexOf(a) - ['close', 'transcript', 'delete'].indexOf(b),
  );
  let fixedIndex = 0;
  return result.map((action) => {
    if (!['close', 'transcript', 'delete'].includes(action)) return action;
    const replacement = fixed[fixedIndex];
    fixedIndex += 1;
    return replacement;
  });
}

module.exports = {
  ADMIN_ACTIONS,
  ALLOWED_PERMISSIONS,
  BUTTON_STYLES,
  DEFAULT_AUTHOR_PERMISSIONS,
  DEFAULT_LAUNCHER_MESSAGE,
  DEFAULT_STAFF_PERMISSIONS,
  DEFAULT_TICKET_MESSAGE,
  DEFAULT_TICKETS_CONFIG,
  FORM_TYPES,
  LEGACY_DEFAULT_TICKET_TYPES,
  buildTicketMessagePayload,
  clone,
  discordEmoji,
  formatFormAnswers,
  orderAdminActions,
  renderTicketTemplate,
  sanitizeTicketMessage,
  sanitizeTicketsConfig,
};


// Consolidated command runtime fixes. These execute with their original virtual
// filenames so relative imports and module hooks retain their established behavior.
;(function installConsolidatedCommandFixes() {
  const ConsolidatedFixModule = require('module');
  const fixes = [
    ["00-emoji-validation.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const ticketConfig = require('../src/ticketConfig');

const KEYCAP_EMOJI = /^[#*0-9]\uFE0F?\u20E3$/u;
const FLAG_EMOJI = /^\p{Regional_Indicator}{2}$/u;
const PICTOGRAPHIC_EMOJI = /\p{Extended_Pictographic}/u;

function isSingleGrapheme(value) {
  if (typeof Intl?.Segmenter !== 'function') return true;
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...segmenter.segment(value)].length === 1;
}

function safeDiscordEmoji(value) {
  const clean = String(value || '').trim();
  if (!clean || clean.length > 32 || /\s/u.test(clean)) return undefined;

  // Custom emoji strings can be valid-looking but still rejected if the bot
  // cannot use that emoji in the target guild. Keep component payloads to
  // Unicode emoji so request panels do not repeatedly hit the retry fallback.
  if (clean.startsWith('<') || clean.endsWith('>')) return undefined;
  if (!isSingleGrapheme(clean)) return undefined;
  if (!KEYCAP_EMOJI.test(clean) && !FLAG_EMOJI.test(clean) && !PICTOGRAPHIC_EMOJI.test(clean)) return undefined;

  return { name: clean };
}

ticketConfig.discordEmoji = safeDiscordEmoji;

module.exports = {};
    }],
    ["000-ticket-form-media-gallery.js", function (module, exports, require, __filename, __dirname) {
const ticketConfig = require('../src/ticketConfig');

const MEDIA_FILE_EXTENSIONS = new Set([
  '.apng', '.avif', '.gif', '.jpg', '.jpeg', '.png', '.webp',
  '.mp4', '.mov', '.m4v', '.webm', '.mpeg', '.mpg', '.ogg', '.ogv', '.avi', '.mkv',
]);

const mediaByFormAnswerText = new Map();

function uploadFileExtension(filename) {
  const clean = String(filename || '').toLowerCase().split('?')[0];
  const dotIndex = clean.lastIndexOf('.');
  return dotIndex === -1 ? '' : clean.slice(dotIndex);
}

function isValidUploadUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

function isMediaUpload(item) {
  const contentType = String(item?.contentType || '').toLowerCase();
  if (contentType.startsWith('image/') || contentType.startsWith('video/')) return true;
  return MEDIA_FILE_EXTENSIONS.has(uploadFileExtension(item?.filename || item?.url));
}

function sanitizeAttachmentName(filename, fallbackIndex = 0) {
  const base = String(filename || `upload-${fallbackIndex + 1}`).trim();
  const safe = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '');
  return safe || `upload-${fallbackIndex + 1}`;
}

function collectMediaUploads(questionAnswerPairs) {
  return (Array.isArray(questionAnswerPairs) ? questionAnswerPairs : [])
    .flatMap((entry) => Array.isArray(entry?.uploadedFiles) ? entry.uploadedFiles : [])
    .filter((item) => isValidUploadUrl(item?.url) && isMediaUpload(item))
    .slice(0, 10);
}

function buildMediaFiles(mediaUploads) {
  return mediaUploads.map((item, index) => ({
    attachment: item.url,
    name: sanitizeAttachmentName(item.filename, index),
  }));
}

function buildMediaGallery(mediaUploads) {
  const items = mediaUploads.map((item, index) => {
    const filename = sanitizeAttachmentName(item.filename, index);
    return {
      media: { url: `attachment://${filename}` },
      description: filename,
    };
  });
  return items.length ? { type: 12, items } : null;
}

function rememberMediaForAnswer(answerText, mediaUploads) {
  if (!answerText || mediaUploads.length === 0) return;
  if (mediaByFormAnswerText.size > 100) mediaByFormAnswerText.clear();
  mediaByFormAnswerText.set(answerText, mediaUploads);
}

function componentCount(component) {
  if (!component || typeof component !== 'object') return 0;
  const children = Array.isArray(component.components)
    ? component.components.reduce((total, child) => total + componentCount(child), 0)
    : 0;
  const accessory = component.accessory ? componentCount(component.accessory) : 0;
  return 1 + children + accessory;
}

function payloadComponentCount(payload) {
  return (Array.isArray(payload?.components) ? payload.components : [])
    .reduce((total, component) => total + componentCount(component), 0);
}

function attachMediaGallery(payload, mediaUploads) {
  const gallery = buildMediaGallery(mediaUploads);
  if (!gallery) return payload;
  const container = payload?.components?.find((component) => component?.type === 17 && Array.isArray(component.components));
  if (!container || payloadComponentCount(payload) + 2 > 40) return payload;
  container.components.push({ type: 14, divider: true, spacing: 1 }, gallery);
  payload.files = [...(Array.isArray(payload.files) ? payload.files : []), ...buildMediaFiles(mediaUploads)];
  return payload;
}

if (!ticketConfig.__coinSpriteTicketFormMediaGalleryPatch) {
  const originalFormatFormAnswers = ticketConfig.formatFormAnswers;
  const originalBuildTicketMessagePayload = ticketConfig.buildTicketMessagePayload;

  ticketConfig.formatFormAnswers = function patchedFormatFormAnswers(questionAnswerPairs) {
    const answerText = originalFormatFormAnswers(questionAnswerPairs);
    rememberMediaForAnswer(answerText, collectMediaUploads(questionAnswerPairs));
    return answerText;
  };

  ticketConfig.buildTicketMessagePayload = function patchedBuildTicketMessagePayload(messageValue, context = {}, extraComponents = []) {
    const payload = originalBuildTicketMessagePayload(messageValue, context, extraComponents);
    const mediaUploads = mediaByFormAnswerText.get(context.formAnswers) || [];
    mediaByFormAnswerText.delete(context.formAnswers);
    return attachMediaGallery(payload, mediaUploads);
  };

  Object.defineProperty(ticketConfig, '__coinSpriteTicketFormMediaGalleryPatch', {
    value: true,
    enumerable: false,
  });
}

module.exports = {};
    }],
  ];
  for (const [name, factory] of fixes) {
    const filename = require('path').join(__dirname, '..', 'commands', name);
    const fixModule = new ConsolidatedFixModule(filename, module);
    fixModule.filename = filename;
    fixModule.paths = ConsolidatedFixModule._nodeModulePaths(require('path').dirname(filename));
    require.cache[filename] = fixModule;
    factory.call(fixModule.exports, fixModule, fixModule.exports, fixModule.require.bind(fixModule), filename, require('path').dirname(filename));
    fixModule.loaded = true;
  }
})();
