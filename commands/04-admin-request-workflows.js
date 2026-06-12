const fs = require('fs');
const http = require('http');
const path = require('path');
const Module = require('module');
const { PermissionFlagsBits } = require('discord.js');
const { getGuildWorkflows, saveGuildWorkflows } = require('../src/requestControlWorkflows');

const previousCreateServer = http.createServer.bind(http);
const previousLoad = Module._load;
const ADMIN_FIXES_PATH = path.join(__dirname, '..', 'admin', 'admin-fixes.js');
const ADMIN_CSS_PATH = path.join(__dirname, '..', 'admin', 'admin-fixes.css');
const SESSION_PATH = path.join(__dirname, '..', 'data', 'admin-sessions.json');
let clientRef = null;

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}
function sessionUser(req) {
  try {
    const id = parseCookies(req.headers.cookie || '').coinsprite_admin;
    const session = JSON.parse(fs.readFileSync(SESSION_PATH, 'utf8') || '{}').sessions?.[id];
    return session?.user?.id && Number(session.expiresAt) > Date.now() ? session.user : null;
  } catch { return null; }
}
async function requireAdmin(req, res, guildId) {
  const user = sessionUser(req);
  const guild = clientRef?.guilds?.cache?.get(guildId) || await clientRef?.guilds?.fetch(guildId).catch(() => null);
  const member = user && guild ? await guild.members.fetch(user.id).catch(() => null) : null;
  if (!user) { sendJson(res, 401, { error: 'Not logged in.' }); return null; }
  if (!member?.permissions?.has(PermissionFlagsBits.Administrator)) { sendJson(res, 403, { error: 'Administrator permission is required.' }); return null; }
  return guild;
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function browserScript() {
  return String.raw`
(() => {
  let workflowGuildId = '';
  let workflows = {};
  let savedWorkflows = {};
  let templates = [];
  let activeTicketId = '';
  let rendering = false;
  let workflowObserver = null;
  const copy = (value) => JSON.parse(JSON.stringify(value || {}));
  const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  const id = (prefix) => prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
  const isRequest = (type) => Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
  const ticketValue = () => { try { return ensureTicketEditor().getValue().tickets; } catch { return { types: [] }; } };
  function activeType() {
    const types = ticketValue().types;
    let type = types.find((item) => item.id === activeTicketId) || null;
    if (!type) {
      const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim();
      type = types.find((item) => item.name === heading) || null;
      if (type) activeTicketId = type.id;
    }
    return type;
  }
  const workflow = (ticketId, controlId) => {
    workflows[ticketId] ||= {};
    workflows[ticketId][controlId] ||= { dmTemplateId: '', conditions: [] };
    return workflows[ticketId][controlId];
  };
  const roleOptionsHtml = (selected = '') => '<option value="">Select role</option>' + (state.directory.roles || []).map((role) => '<option value="' + esc(role.id) + '" ' + (role.id === selected ? 'selected' : '') + '>' + esc(role.name) + '</option>').join('');
  const templateOptionsHtml = (selected = '') => '<option value="">None</option>' + templates.map((template) => '<option value="' + esc(template.id) + '" ' + (template.id === selected ? 'selected' : '') + '>' + esc(template.name) + '</option>').join('');
  const questionOptionsHtml = (type, selected = '') => '<option value="">Select question</option>' + (type.forms?.create || []).filter((question) => question.type !== 'text_display').map((question, index) => '<option value="' + esc(question.id) + '" ' + (question.id === selected ? 'selected' : '') + '>Question ' + (index + 1) + ': ' + esc(question.question) + '</option>').join('');
  function defaultExpected(question) {
    if (question?.type === 'file_upload') return 'has_files';
    if (question?.type === 'checkbox') return 'checked';
    return '';
  }
  function answerInput(condition, type, conditionIndex, controlIndex) {
    const question = (type.forms?.create || []).find((item) => item.id === condition.questionId);
    const attrs = ' data-workflow-field="expected" data-control-index="' + controlIndex + '" data-condition-index="' + conditionIndex + '"';
    if (!question) return '<label>Expected answer<input type="text" disabled placeholder="Select a question first"></label>';
    if (question.type === 'file_upload') return '<label>File answer<select' + attrs + '><option value="has_files" ' + (condition.expected === 'has_files' ? 'selected' : '') + '>Has files</option><option value="no_files" ' + (condition.expected === 'no_files' ? 'selected' : '') + '>No files</option></select></label>';
    if (question.type === 'checkbox') return '<label>Expected answer<select' + attrs + '><option value="checked" ' + (condition.expected === 'checked' ? 'selected' : '') + '>Checked</option><option value="not_checked" ' + (condition.expected === 'not_checked' ? 'selected' : '') + '>Not checked</option></select></label>';
    if (['string_select', 'radio_group', 'checkbox_group'].includes(question.type)) return '<label>Expected answer<select' + attrs + '><option value="">Select answer</option>' + (question.options || []).map((option) => '<option value="' + esc(option.name) + '" ' + (option.name === condition.expected ? 'selected' : '') + '>' + esc(option.name) + '</option>').join('') + '</select></label>';
    return '<label>Exact answer<input type="text" value="' + esc(condition.expected) + '"' + attrs + '></label>';
  }
  function actionHtml(action, controlIndex, conditionIndex, actionIndex) {
    const attrs = ' data-control-index="' + controlIndex + '" data-condition-index="' + conditionIndex + '" data-condition-action-index="' + actionIndex + '"';
    let detail = '';
    if (action.type === 'dm_template') detail = '<label>Message template<select data-condition-action-field="templateId"' + attrs + '>' + templateOptionsHtml(action.templateId) + '</select></label>';
    if (action.type === 'role_add') detail = '<label>Role<select data-condition-action-field="roleId"' + attrs + '>' + roleOptionsHtml(action.roleId) + '</select></label>';
    return '<div class="condition-action"><label>Action<select data-condition-action-field="type"' + attrs + '><option value="dm_template" ' + (action.type === 'dm_template' ? 'selected' : '') + '>DM message template</option><option value="role_add" ' + (action.type === 'role_add' ? 'selected' : '') + '>Role add</option><option value="accept" ' + (action.type === 'accept' ? 'selected' : '') + '>Accept request</option><option value="deny" ' + (action.type === 'deny' ? 'selected' : '') + '>Deny request</option><option value="blacklist" ' + (action.type === 'blacklist' ? 'selected' : '') + '>Blacklist author</option></select></label>' + detail + '<button class="icon-button danger-text" type="button" data-workflow-action="remove-condition-action"' + attrs + '>&times;</button></div>';
  }
  function conditionHtml(condition, type, controlIndex, conditionIndex) {
    const attrs = ' data-control-index="' + controlIndex + '" data-condition-index="' + conditionIndex + '"';
    let criteria = '';
    if (condition.type === 'form_input') criteria = '<label>Question<select data-workflow-field="questionId"' + attrs + '>' + questionOptionsHtml(type, condition.questionId) + '</select></label>' + answerInput(condition, type, conditionIndex, controlIndex);
    if (condition.type === 'has_role') criteria = '<label>Required role<select data-workflow-field="roleId"' + attrs + '>' + roleOptionsHtml(condition.roleId) + '</select></label>';
    if (condition.type === 'level') criteria = '<label>Minimum level<input type="number" min="0" step="1" value="' + Number(condition.level || 0) + '" data-workflow-field="level"' + attrs + '></label>';
    return '<article class="request-condition"><div class="request-condition-head"><strong>Condition ' + (conditionIndex + 1) + '</strong><button class="icon-button danger-text" type="button" data-workflow-action="remove-condition"' + attrs + '>&times;</button></div><div class="request-condition-grid"><label>Condition type<select data-workflow-field="type"' + attrs + '><option value="form_input" ' + (condition.type === 'form_input' ? 'selected' : '') + '>Form input</option><option value="level" ' + (condition.type === 'level' ? 'selected' : '') + '>Level</option><option value="has_role" ' + (condition.type === 'has_role' ? 'selected' : '') + '>Has role</option></select></label>' + criteria + '</div><div class="condition-actions"><div class="sequence-head"><span class="field-label">Actions when true</span><button class="button small" type="button" data-workflow-action="add-condition-action"' + attrs + '>+ Add action</button></div>' + (condition.actions || []).map((action, index) => actionHtml(action, controlIndex, conditionIndex, index)).join('') + '</div></article>';
  }
  function observeWorkflowPanels() {
    const root = document.querySelector('#ticketEditorRoot');
    if (workflowObserver && root) workflowObserver.observe(root, { childList: true, subtree: true });
  }
  function renderWorkflowPanels() {
    if (rendering) return;
    const type = activeType();
    const root = document.querySelector('#ticketEditorRoot');
    if (!root || !isRequest(type) || !root.dataset.requestEditor) return;
    rendering = true;
    workflowObserver?.disconnect();
    try {
      root.querySelectorAll('.ticket-control-card').forEach((card, controlIndex) => {
        const control = type.adminPanel?.controls?.[controlIndex];
        if (!control) return;
        const data = workflow(type.id, control.id);
        const labels = [...card.querySelectorAll('.sequence-item strong')].map((node) => node.textContent.trim().toLowerCase());
        const hasDm = labels.includes('dm message');
        card.querySelector('.request-template-field')?.remove();
        card.querySelector('.request-conditions')?.remove();
        card.querySelector('.request-dm-field')?.remove();
        const nativeDescription = card.querySelector('[data-control-field="description"]')?.closest('label');
        if (nativeDescription) nativeDescription.hidden = hasDm;
        if (hasDm) {
          const field = document.createElement('label');
          field.className = 'request-template-field';
          field.innerHTML = '<span class="field-label">DM message template</span><select data-workflow-dm-template="' + controlIndex + '">' + templateOptionsHtml(data.dmTemplateId) + '</select><span class="request-action-note">Choose a saved Messages template. If None is saved, the DM action is removed.</span>';
          card.querySelector('.action-sequence')?.append(field);
        }
        const section = document.createElement('section');
        section.className = 'request-conditions';
        section.innerHTML = '<div class="request-conditions-head"><div><strong>Conditions</strong><span>Actions inside a condition run only when it matches.</span></div><button class="button small" type="button" data-workflow-action="add-condition" data-control-index="' + controlIndex + '">+ Add condition</button></div>' + (data.conditions || []).map((condition, index) => conditionHtml(condition, type, controlIndex, index)).join('');
        card.append(section);
      });
    } finally {
      rendering = false;
      observeWorkflowPanels();
    }
  }
  function markChanged() { refreshDirtyState(); queueMicrotask(renderWorkflowPanels); }
  document.addEventListener('click', (event) => {
    const ticketCard = event.target.closest('.ticket-type-card');
    if (ticketCard) activeTicketId = ticketCard.dataset.ticketId || '';
    const button = event.target.closest('[data-workflow-action]');
    if (!button) { queueMicrotask(renderWorkflowPanels); return; }
    const type = activeType();
    const control = type?.adminPanel?.controls?.[Number(button.dataset.controlIndex)];
    if (!type || !control) return;
    const data = workflow(type.id, control.id);
    const conditionIndex = Number(button.dataset.conditionIndex);
    if (button.dataset.workflowAction === 'add-condition') data.conditions.push({ id: id('condition'), type: 'form_input', questionId: '', expected: '', roleId: '', level: 0, actions: [] });
    if (button.dataset.workflowAction === 'remove-condition') data.conditions.splice(conditionIndex, 1);
    if (button.dataset.workflowAction === 'add-condition-action') data.conditions[conditionIndex].actions.push({ id: id('action'), type: 'dm_template', templateId: '', roleId: '' });
    if (button.dataset.workflowAction === 'remove-condition-action') data.conditions[conditionIndex].actions.splice(Number(button.dataset.conditionActionIndex), 1);
    markChanged();
  }, true);
  document.addEventListener('change', (event) => {
    const target = event.target;
    const type = activeType();
    if (!type) return;
    if (target.dataset.workflowDmTemplate !== undefined) {
      const control = type.adminPanel.controls[Number(target.dataset.workflowDmTemplate)];
      workflow(type.id, control.id).dmTemplateId = target.value;
      markChanged();
      return;
    }
    const controlIndex = Number(target.dataset.controlIndex);
    const conditionIndex = Number(target.dataset.conditionIndex);
    const control = type.adminPanel?.controls?.[controlIndex];
    const condition = control && workflow(type.id, control.id).conditions?.[conditionIndex];
    if (!condition) return;
    if (target.dataset.workflowField) {
      condition[target.dataset.workflowField] = target.dataset.workflowField === 'level' ? Number(target.value) : target.value;
      if (target.dataset.workflowField === 'type') Object.assign(condition, { questionId: '', expected: '', roleId: '', level: 0 });
      if (target.dataset.workflowField === 'questionId') {
        const question = (type.forms?.create || []).find((item) => item.id === target.value);
        condition.expected = defaultExpected(question);
      }
    }
    if (target.dataset.conditionActionField) {
      const action = condition.actions[Number(target.dataset.conditionActionIndex)];
      action[target.dataset.conditionActionField] = target.value;
      if (target.dataset.conditionActionField === 'type') Object.assign(action, { templateId: '', roleId: '' });
    }
    markChanged();
  }, true);
  const previousFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    const configMatch = url.match(/\/api\/guilds\/(\d{16,20})\/config$/);
    if (configMatch && method === 'GET') {
      const response = await previousFetch(input, init);
      if (!response.ok) return response;
      workflowGuildId = configMatch[1];
      const [metaResponse, templateResponse] = await Promise.all([
        previousFetch('/api/guilds/' + workflowGuildId + '/request-control-workflows'),
        previousFetch('/api/guilds/' + workflowGuildId + '/message-templates'),
      ]);
      workflows = metaResponse.ok ? (await metaResponse.json()).workflows || {} : {};
      savedWorkflows = copy(workflows);
      templates = templateResponse.ok ? (await templateResponse.json()).templates || [] : [];
      return response;
    }
    if (configMatch && method === 'PATCH' && init.body) {
      const body = JSON.parse(init.body);
      (body.tickets?.types || []).filter(isRequest).forEach((type) => {
        const keptControlIds = new Set();
        const controls = (type.adminPanel?.controls || []).filter((control) => {
          const data = workflows[type.id]?.[control.id];
          if ((control.actions || []).includes('transcript') && !data?.dmTemplateId) control.actions = control.actions.filter((action) => action !== 'transcript');
          const keep = Boolean(control.url || (control.actions || []).length || data?.conditions?.length);
          if (keep) keptControlIds.add(control.id);
          return keep;
        });
        if (type.adminPanel) type.adminPanel.controls = controls;
        if (workflows[type.id]) {
          Object.keys(workflows[type.id]).forEach((controlId) => { if (!keptControlIds.has(controlId)) delete workflows[type.id][controlId]; });
        }
      });
      const response = await previousFetch(input, { ...init, body: JSON.stringify(body) });
      if (!response.ok) return response;
      const metaResponse = await previousFetch('/api/guilds/' + configMatch[1] + '/request-control-workflows', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(workflows) });
      if (!metaResponse.ok) return new Response(JSON.stringify({ error: 'Ticket settings saved, but request workflows failed to save.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      workflows = (await metaResponse.json()).workflows || {};
      savedWorkflows = copy(workflows);
      return response;
    }
    return previousFetch(input, init);
  };
  const originalCollect = collectTabState;
  collectTabState = function workflowCollect(tabName) {
    const value = originalCollect(tabName);
    return tabName === 'tickets' ? { ...value, requestControlWorkflows: copy(workflows) } : value;
  };
  document.querySelector('#resetTabButton')?.addEventListener('click', () => {
    if (state.activeTab !== 'tickets') return;
    workflows = copy(savedWorkflows);
    queueMicrotask(renderWorkflowPanels);
  }, true);
  workflowObserver = new MutationObserver(() => queueMicrotask(renderWorkflowPanels));
  observeWorkflowPanels();
})();
`;
}
function browserCss() {
  return `
.request-template-field { display: grid; gap: 7px; margin-top: 12px; }
.request-conditions { display: grid; gap: 12px; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line-soft, #30343c); }
.request-conditions-head, .request-condition-head, .condition-actions .sequence-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.request-conditions-head > div { display: grid; gap: 3px; }
.request-conditions-head span { color: var(--muted, #aeb4c0); font-size: 12px; }
.request-condition { display: grid; gap: 12px; padding: 14px; border: 1px solid #343943; border-radius: 8px; background: rgba(0,0,0,.12); }
.request-condition-grid, .condition-action { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; align-items: end; }
.condition-actions { display: grid; gap: 9px; }
.condition-action { padding: 10px; border: 1px solid #2d323b; border-radius: 7px; background: #171a20; }
.condition-action > .icon-button { align-self: end; }
@media(max-width:760px){.request-condition-grid,.condition-action{grid-template-columns:1fr}.request-conditions-head,.request-condition-head,.condition-actions .sequence-head{align-items:flex-start;flex-direction:column}}
`;
}
function servePatched(res, filePath, contentType, append) {
  fs.readFile(filePath, 'utf8', (error, source) => {
    if (error) { sendJson(res, 404, { error: 'Not found.' }); return; }
    res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
    res.end(`${source}\n${append}`);
  });
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/admin/admin-fixes.js') { servePatched(res, ADMIN_FIXES_PATH, 'application/javascript; charset=utf-8', browserScript()); return true; }
  if (req.method === 'GET' && url.pathname === '/admin/admin-fixes.css') { servePatched(res, ADMIN_CSS_PATH, 'text/css; charset=utf-8', browserCss()); return true; }
  const match = url.pathname.match(/^\/api\/guilds\/(\d{16,20})\/request-control-workflows$/);
  if (!match) return false;
  if (!await requireAdmin(req, res, match[1])) return true;
  if (req.method === 'GET') { sendJson(res, 200, { guildId: match[1], workflows: getGuildWorkflows(match[1]) }); return true; }
  if (req.method === 'PUT') { sendJson(res, 200, { guildId: match[1], workflows: saveGuildWorkflows(match[1], await readBody(req)) }); return true; }
  sendJson(res, 405, { error: 'Method not allowed.' });
  return true;
}

http.createServer = function requestWorkflowServer(listener) {
  return previousCreateServer((req, res) => {
    handle(req, res).then((handled) => { if (!handled) listener(req, res); })
      .catch((error) => sendJson(res, error.statusCode || 500, { error: error.message || 'Internal server error.' }));
  });
};
Module._load = function captureClient(request, parent, isMain) {
  const exported = previousLoad.call(this, request, parent, isMain);
  if (!String(request).replace(/\\/g, '/').endsWith('/ticket-system.js') || exported.__requestWorkflowAdminCapture) return exported;
  const nativeInit = exported.init?.bind(exported);
  exported.init = async (client) => { clientRef = client; if (nativeInit) await nativeInit(client); };
  exported.__requestWorkflowAdminCapture = true;
  return exported;
};

module.exports = {};
