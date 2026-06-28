'use strict';

const { sanitizeTemplate } = require('./messageTemplates');

const APPEAL_FIELD_TYPES = Object.freeze(['text', 'number', 'choice', 'checkbox', 'file']);
const DEFAULT_APPEAL_LOG_MESSAGE = Object.freeze({
  id: 'appeal-log-message',
  type: 'template',
  folderId: '',
  name: 'Appeal log message',
  content: '',
  containers: [{
    id: 'appeal-summary',
    accentColor: '#FEE75C',
    text: [
      '## Appeal <appeal-id>',
      '**User:** <@mention> (`<user-id>`)',
      '**Case:** `<case-id>`',
      '**Punishment:** <punishment>',
      '**Reason:** <case-reason>',
      '<separator>',
      '**Appeal answers**',
      '<form-answers>',
    ].join('\n'),
    thumbnailUrl: '<avatar_url>',
    imageUrl: '',
  }],
  componentRows: [],
});

const DEFAULT_APPEAL_CONFIG = Object.freeze({
  enabled: false,
  cooldownSeconds: 0,
  maxSubmissionsPerCase: null,
  logChannelId: '',
  questions: [{
    id: 'reconsideration-reason',
    order: 1,
    type: 'text',
    label: 'Why should this case be reconsidered?',
    description: '',
    required: true,
    style: 'paragraph',
    placeholder: 'Explain why staff should reconsider this case.',
    minLength: 20,
    maxLength: 4000,
  }],
  logMessage: DEFAULT_APPEAL_LOG_MESSAGE,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanString(value, fallback = '', maximum = 100) {
  const text = String(value ?? '').trim();
  return (text || String(fallback ?? '').trim()).slice(0, maximum);
}

function cleanOptional(value, maximum = 100) {
  return String(value ?? '').trim().slice(0, maximum);
}

function cleanId(value, fallback) {
  return cleanString(value, fallback, 60)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  const result = Number.isFinite(parsed) ? Math.round(parsed) : fallback;
  return Math.max(minimum, Math.min(maximum, result));
}

function finiteNumber(value, fallback = null) {
  if (value === '' || value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeExtensions(value) {
  return [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\s,]+/))
    .map((item) => String(item || '').trim().toLowerCase().replace(/^\./, ''))
    .filter((item) => /^[a-z0-9]{1,10}$/.test(item)))]
    .slice(0, 20);
}

function sanitizeOptions(value) {
  const result = (Array.isArray(value) ? value : [])
    .slice(0, 25)
    .map((option, index) => ({
      id: cleanId(option?.id || option?.value, 'option-' + (index + 1)),
      label: cleanString(option?.label || option?.name, 'Option ' + (index + 1), 100),
    }));
  while (result.length < 2) {
    const index = result.length + 1;
    result.push({ id: 'option-' + index, label: 'Option ' + index });
  }
  return result;
}

function sanitizeQuestion(value, index) {
  const source = value && typeof value === 'object' ? value : {};
  const type = APPEAL_FIELD_TYPES.includes(source.type) ? source.type : 'text';
  const base = {
    id: cleanId(source.id, 'question-' + (index + 1)),
    order: index + 1,
    type,
    label: cleanString(source.label || source.question, 'Question ' + (index + 1), 80),
    description: cleanOptional(source.description, 200),
    required: Boolean(source.required),
  };
  if (type === 'text') {
    base.style = source.style === 'short' ? 'short' : 'paragraph';
    base.placeholder = cleanOptional(source.placeholder, 150);
    base.minLength = integer(source.minLength, 0, 0, 4000);
    base.maxLength = integer(source.maxLength, base.style === 'short' ? 200 : 4000, Math.max(1, base.minLength), 4000);
  } else if (type === 'number') {
    base.placeholder = cleanOptional(source.placeholder, 100);
    base.minimum = finiteNumber(source.minimum);
    base.maximum = finiteNumber(source.maximum);
    if (base.minimum != null && base.maximum != null && base.maximum < base.minimum) base.maximum = base.minimum;
    base.step = Math.max(0.000001, finiteNumber(source.step, 1));
  } else if (type === 'choice') {
    base.options = sanitizeOptions(source.options);
    base.multiple = Boolean(source.multiple);
    base.minSelections = base.required ? integer(source.minSelections, 1, 1, base.options.length) : integer(source.minSelections, 0, 0, base.options.length);
    base.maxSelections = base.multiple
      ? integer(source.maxSelections, base.options.length, Math.max(1, base.minSelections), base.options.length)
      : 1;
  } else if (type === 'checkbox') {
    base.options = sanitizeOptions(source.options);
    const requestedDefault = cleanOptional(source.defaultOptionId, 60);
    base.defaultOptionId = base.options.some((option) => option.id === requestedDefault)
      ? requestedDefault
      : source.default === true
        ? base.options[0].id
        : '';
  } else if (type === 'file') {
    base.maxFiles = integer(source.maxFiles, 1, 1, 5);
    base.maxFileSizeMb = integer(source.maxFileSizeMb, 10, 1, 10);
    base.allowedExtensions = sanitizeExtensions(source.allowedExtensions);
  }
  return base;
}

function sanitizeQuestions(value) {
  const used = new Set();
  return (Array.isArray(value) ? value : DEFAULT_APPEAL_CONFIG.questions)
    .slice(0, 10)
    .map(sanitizeQuestion)
    .map((question, index) => {
      let id = question.id;
      let suffix = 2;
      while (used.has(id)) id = question.id.slice(0, 54) + '-' + suffix++;
      used.add(id);
      return { ...question, id, order: index + 1 };
    });
}

function sanitizeLogMessage(value) {
  const template = sanitizeTemplate(value || clone(DEFAULT_APPEAL_LOG_MESSAGE));
  return {
    ...template,
    id: 'appeal-log-message',
    name: 'Appeal log message',
    folderId: '',
    botDefault: false,
    defaultLocked: false,
    componentRows: [],
  };
}

function sanitizeAppealConfig(value) {
  const source = value && typeof value === 'object' ? value : {};
  const maximum = source.maxSubmissionsPerCase;
  return {
    enabled: Boolean(source.enabled),
    cooldownSeconds: integer(source.cooldownSeconds, 0, 0, 365 * 86400),
    maxSubmissionsPerCase: maximum === '' || maximum == null
      ? null
      : integer(maximum, 1, 1, 100),
    logChannelId: /^\d{16,20}$/.test(String(source.logChannelId || '')) ? String(source.logChannelId) : '',
    questions: sanitizeQuestions(source.questions),
    logMessage: sanitizeLogMessage(source.logMessage),
  };
}

module.exports = {
  APPEAL_FIELD_TYPES,
  DEFAULT_APPEAL_CONFIG,
  DEFAULT_APPEAL_LOG_MESSAGE,
  sanitizeAppealConfig,
  sanitizeQuestion,
  sanitizeQuestions,
};
