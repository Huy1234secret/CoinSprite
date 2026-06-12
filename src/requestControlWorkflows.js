const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'request-control-workflows.json');
const CONDITION_TYPES = new Set(['form_input', 'level', 'has_role']);
const ACTION_TYPES = new Set(['dm_template', 'role_add', 'accept', 'deny', 'blacklist']);
const NATIVE_ACTIONS = new Set(['close', 'transcript', 'delete', 'blacklist', 'move_to']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanId(value, max = 40) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max);
}
function cleanSnowflake(value) {
  const text = String(value || '').trim();
  return /^\d{16,20}$/.test(text) ? text : '';
}
function conditionIdFromStep(value) {
  const match = String(value || '').match(/^condition_([a-z0-9_-]{1,32})$/);
  return match?.[1] || '';
}
function loadAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function saveAll(value) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function sanitizeAction(value, index) {
  const source = value && typeof value === 'object' ? value : {};
  const type = ACTION_TYPES.has(source.type) ? source.type : 'dm_template';
  return {
    id: cleanId(source.id || `action-${index + 1}`, 32),
    type,
    templateId: type === 'dm_template' ? cleanId(source.templateId, 40) : '',
    roleId: type === 'role_add' ? cleanSnowflake(source.roleId) : '',
  };
}
function sanitizeCondition(value, index) {
  const source = value && typeof value === 'object' ? value : {};
  const type = CONDITION_TYPES.has(source.type) ? source.type : 'form_input';
  return {
    id: cleanId(source.id || `condition-${index + 1}`, 32),
    type,
    questionId: type === 'form_input' ? cleanId(source.questionId, 40) : '',
    expected: type === 'form_input' ? String(source.expected || '').trim().slice(0, 300) : '',
    roleId: type === 'has_role' ? cleanSnowflake(source.roleId) : '',
    level: type === 'level' ? Math.max(0, Math.min(1000000, Math.floor(Number(source.level) || 0))) : 0,
    actions: (Array.isArray(source.actions) ? source.actions : []).slice(0, 10).map(sanitizeAction),
  };
}
function sanitizeSequence(value, conditions) {
  const conditionIds = new Set(conditions.map((condition) => condition.id));
  const seenNative = new Set();
  const result = [];
  for (const step of Array.isArray(value) ? value : []) {
    if (NATIVE_ACTIONS.has(step)) {
      if (!seenNative.has(step)) {
        seenNative.add(step);
        result.push(step);
      }
    } else {
      const conditionId = conditionIdFromStep(step);
      if (conditionId && conditionIds.has(conditionId)) result.push(`condition_${conditionId}`);
    }
    if (result.length >= 20) break;
  }
  return result;
}
function sanitizeControl(value) {
  const source = value && typeof value === 'object' ? value : {};
  const conditions = (Array.isArray(source.conditions) ? source.conditions : []).slice(0, 10).map(sanitizeCondition);
  return {
    dmTemplateId: cleanId(source.dmTemplateId, 40),
    sequence: sanitizeSequence(source.sequence, conditions),
    conditions,
  };
}
function sanitizeGuild(value) {
  const source = value && typeof value === 'object' ? value : {};
  const result = {};
  for (const [ticketId, controlsValue] of Object.entries(source).slice(0, 25)) {
    const cleanTicketId = cleanId(ticketId, 40);
    if (!cleanTicketId || !controlsValue || typeof controlsValue !== 'object') continue;
    const controls = {};
    for (const [controlId, controlValue] of Object.entries(controlsValue).slice(0, 25)) {
      const cleanControlId = cleanId(controlId, 32);
      if (cleanControlId) controls[cleanControlId] = sanitizeControl(controlValue);
    }
    result[cleanTicketId] = controls;
  }
  return result;
}
function getGuildWorkflows(guildId) {
  return clone(loadAll()[String(guildId)] || {});
}
function saveGuildWorkflows(guildId, value) {
  const state = loadAll();
  state[String(guildId)] = sanitizeGuild(value);
  saveAll(state);
  return clone(state[String(guildId)]);
}
function getControlWorkflow(guildId, ticketId, controlId) {
  return getGuildWorkflows(guildId)?.[ticketId]?.[controlId] || null;
}

module.exports = { getControlWorkflow, getGuildWorkflows, saveGuildWorkflows, sanitizeGuild };
