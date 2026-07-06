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
  const workflows = getGuildWorkflows(guildId);
  const id = String(ticketId || '');
  const aliases = id.startsWith('request-')
    ? [id, id.slice('request-'.length)]
    : [id, `request-${id}`];
  for (const alias of aliases) {
    const workflow = workflows?.[alias]?.[controlId];
    if (workflow) return workflow;
  }
  return null;
}

module.exports = { getControlWorkflow, getGuildWorkflows, saveGuildWorkflows, sanitizeGuild };


// Consolidated command runtime fixes. These execute with their original virtual
// filenames so relative imports and module hooks retain their established behavior.
;(function installConsolidatedCommandFixes() {
  const ConsolidatedFixModule = require('module');
  const fixes = [
    ["05-admin-workflow-view-fixes.js", function (module, exports, require, __filename, __dirname) {
const fs = require('fs');
const path = require('path');

const originalReadFile = fs.readFile.bind(fs);
const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const ADMIN_APP_JS = path.resolve(ADMIN_DIR, 'app.js');
const ADMIN_STYLE_CSS = path.resolve(ADMIN_DIR, 'style.css');

const VIEW_FIX_SCRIPT = `
(() => {
  let selectedTicketId = '';
  let pendingView = null;

  function currentTicketId() {
    if (selectedTicketId) return selectedTicketId;
    const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim();
    if (!heading) return '';
    try {
      return ensureTicketEditor().getValue().tickets.types
        .find((type) => heading.endsWith(type.name))?.id || '';
    } catch {
      return '';
    }
  }

  function captureView() {
    if (state.activeTab !== 'tickets') return null;
    const ticketId = currentTicketId();
    if (!ticketId) return null;
    return {
      ticketId,
      section: document.querySelector('#ticketEditorRoot .ticket-type-tabs .mini-tab.active')?.dataset.value || 'admin',
      scrollTop: elements.configForm.scrollTop,
    };
  }

  function restoreView(view) {
    if (!view?.ticketId || state.activeTab !== 'tickets') return;
    const root = document.querySelector('#ticketEditorRoot');
    if (!root) return;

    root.querySelector('[data-action="main-mini"][data-value="ticket"]')?.click();
    const card = [...root.querySelectorAll('.ticket-type-card')]
      .find((item) => item.dataset.ticketId === view.ticketId);
    if (!card) return;
    card.click();
    root.querySelector('.ticket-type-tabs [data-action="type-section"][data-value="' + view.section + '"]')?.click();
    selectedTicketId = view.ticketId;
    requestAnimationFrame(() => { elements.configForm.scrollTop = view.scrollTop || 0; });
  }

  document.addEventListener('click', (event) => {
    const card = event.target.closest('.ticket-type-card');
    if (card) selectedTicketId = card.dataset.ticketId || '';
    if (event.target.closest('[data-action="back-list"]')) selectedTicketId = '';
  }, true);

  elements.saveButton.addEventListener('click', () => {
    pendingView = captureView();
  }, true);

  const nativeFillConfig = fillConfig;
  fillConfig = function preserveTicketView(config) {
    nativeFillConfig(config);
    if (!pendingView) return;
    const view = pendingView;
    pendingView = null;
    queueMicrotask(() => restoreView(view));
  };
})();
`;

const VIEW_FIX_CSS = `
.sequence-item.workflow-condition-step {
  align-items: start;
}
.sequence-item.workflow-condition-step > strong {
  min-width: 0;
  padding-top: 7px;
}
.sequence-item.workflow-condition-step > .request-condition-inline {
  display: grid !important;
  grid-column: 1 / -1;
  width: 100%;
  min-width: 0;
  margin-top: 6px;
}
.sequence-item.workflow-condition-step .request-condition-grid,
.sequence-item.workflow-condition-step .condition-action {
  width: 100%;
  min-width: 0;
}
.sequence-item.workflow-condition-step .request-condition-grid > label,
.sequence-item.workflow-condition-step .condition-action > label {
  min-width: 0;
}
`;

fs.readFile = function patchedAdminReadFile(filePath, ...args) {
  const callback = args.pop();
  return originalReadFile(filePath, ...args, (error, data) => {
    if (error || typeof callback !== 'function') {
      callback?.(error, data);
      return;
    }
    const resolved = path.resolve(String(filePath));
    if (resolved !== ADMIN_APP_JS && resolved !== ADMIN_STYLE_CSS) {
      callback(null, data);
      return;
    }
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, `${source}\n${resolved === ADMIN_APP_JS ? VIEW_FIX_SCRIPT : VIEW_FIX_CSS}`);
  });
};

module.exports = {};
    }],
    ["06-admin-workflow-option-fixes.js", function (module, exports, require, __filename, __dirname) {

const fs = require('fs');
const path = require('path');

const originalReadFile = fs.readFile.bind(fs);
const ADMIN_APP_JS = path.resolve(__dirname, '..', 'admin', 'app.js');

const OPTION_FIX_SCRIPT = `
(() => {
  if (window.__coinSpriteWorkflowOptionFixV2) return;
  window.__coinSpriteWorkflowOptionFixV2 = true;
  let scheduled = false;
  let loadedGuildId = '';
  let loadingGuildId = '';
  let retryAfter = 0;
  let templates = [];
  let workflowValues = {};

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');

  function activeRequestType() {
    const root = document.querySelector('#ticketEditorRoot');
    const heading = root?.querySelector('.ticket-editor-head h3')?.textContent?.trim();
    if (!heading) return null;
    try {
      return ensureTicketEditor().getValue().tickets.types
        .find((type) => heading.endsWith(type.name)) || null;
    } catch {
      return null;
    }
  }

  function templateOptions(selected = '') {
    return '<option value="">None</option>' + templates.map((template) =>
      '<option value="' + escapeHtml(template.id) + '" ' + (template.id === selected ? 'selected' : '') + '>'
        + escapeHtml(template.name) + '</option>',
    ).join('');
  }

  async function loadGuildData() {
    const guildId = String(state.guildId || '');
    if (!guildId || guildId === loadedGuildId || guildId === loadingGuildId || Date.now() < retryAfter) return;
    loadingGuildId = guildId;
    try {
      const [templateResponse, workflowResponse] = await Promise.all([
        fetch('/api/guilds/' + guildId + '/message-templates'),
        fetch('/api/guilds/' + guildId + '/request-control-workflows'),
      ]);
      templates = templateResponse.ok ? (await templateResponse.json()).templates || [] : [];
      workflowValues = workflowResponse.ok ? (await workflowResponse.json()).workflows || {} : {};
      loadedGuildId = guildId;
      retryAfter = 0;
    } catch (error) {
      retryAfter = Date.now() + 5000;
      console.warn('Request workflow options could not be loaded:', error);
    } finally {
      loadingGuildId = '';
    }
  }

  function hideDuplicateConditionOptions(select) {
    const options = [...select.options].filter((option) =>
      option.textContent.trim() === 'Condition' || String(option.value).startsWith('condition_'));
    options.forEach((option, index) => {
      const duplicate = index < options.length - 1;
      option.hidden = duplicate;
      option.disabled = duplicate;
    });
  }

  function ensureDmTemplateFields() {
    const type = activeRequestType();
    if (!type) return;
    document.querySelectorAll('#ticketEditorRoot .ticket-control-card').forEach((card, controlIndex) => {
      const control = type.adminPanel?.controls?.[controlIndex];
      if (!control) return;
      const labels = [...card.querySelectorAll('.sequence-item > strong')]
        .map((node) => node.textContent.trim().toLowerCase());
      const hasDm = (control.actions || []).includes('transcript') || labels.includes('dm message');
      if (!hasDm || card.querySelector('.request-template-field')) return;

      const selected = workflowValues[type.id]?.[control.id]?.dmTemplateId || '';
      const field = document.createElement('label');
      field.className = 'request-template-field';
      field.innerHTML = '<span class="field-label">DM message template</span>'
        + '<select data-workflow-dm-template="' + controlIndex + '">' + templateOptions(selected) + '</select>'
        + '<span class="request-action-note">Choose a saved Messages template. If None is saved, the DM action is removed when settings are saved.</span>';
      card.querySelector('.action-sequence')?.append(field);
    });
  }

  async function repairWorkflowOptions() {
    try {
      document.querySelectorAll('#ticketEditorRoot select[data-action-select]').forEach(hideDuplicateConditionOptions);
      await loadGuildData();
      ensureDmTemplateFields();
    } finally {
      scheduled = false;
    }
  }

  function scheduleRepair() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(repairWorkflowOptions);
  }

  function preserveWorkflowScroll(target) {
    if (!target.matches?.('[data-workflow-dm-template], [data-workflow-field], [data-condition-action-field], select[data-action-select]')) return;
    const scrollTop = elements.configForm.scrollTop;
    const restore = () => { elements.configForm.scrollTop = scrollTop; };
    queueMicrotask(restore);
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
  }

  document.addEventListener('input', (event) => preserveWorkflowScroll(event.target), true);
  document.addEventListener('change', (event) => {
    const target = event.target;
    preserveWorkflowScroll(target);
    if (target.dataset.workflowDmTemplate === undefined) return;
    const type = activeRequestType();
    const control = type?.adminPanel?.controls?.[Number(target.dataset.workflowDmTemplate)];
    if (!type || !control) return;
    workflowValues[type.id] ||= {};
    workflowValues[type.id][control.id] ||= { dmTemplateId: '', sequence: [], conditions: [] };
    workflowValues[type.id][control.id].dmTemplateId = target.value;
  }, true);

  document.addEventListener('click', (event) => {
    if (event.target.closest('#ticketEditorRoot, [data-tab="tickets"]')) scheduleRepair();
  }, true);

  document.querySelector('#guildSelect')?.addEventListener('change', () => {
    loadedGuildId = '';
    templates = [];
    workflowValues = {};
    scheduleRepair();
  }, true);

  const root = document.querySelector('#ticketEditorRoot');
  if (root) new MutationObserver(scheduleRepair).observe(root, { childList: true, subtree: true });
  scheduleRepair();
})();
`;

fs.readFile = function patchedWorkflowOptionRead(filePath, ...args) {
  const callback = args.pop();
  return originalReadFile(filePath, ...args, (error, data) => {
    if (error || typeof callback !== 'function') {
      callback?.(error, data);
      return;
    }
    if (path.resolve(String(filePath)) !== ADMIN_APP_JS) {
      callback(null, data);
      return;
    }
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, `${source}\n${OPTION_FIX_SCRIPT}`);
  });
};

module.exports = {};
    }],
    ["08-admin-ui-state-bridge.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');


const bridgeScript = String.raw`
;(() => {
  window.state = state;
  window.TAB_NAMES = TAB_NAMES;
  window.ensureTicketEditor = ensureTicketEditor;
  window.setStatus = setStatus;
  window.refreshDirtyState = refreshDirtyState;
  window.setActiveTab = setActiveTab;

  const iconStyle = document.createElement('style');
  iconStyle.textContent =
    '.tab .tab-icon{' +
      '--tab-icon-outline:#b5bac1;' +
      'width:34px!important;height:34px!important;flex:0 0 34px!important;' +
      'box-sizing:border-box!important;padding:5px!important;' +
      'border:2px solid var(--tab-icon-outline)!important;border-radius:8px!important;' +
      'background:#111318!important;box-shadow:none!important;filter:none!important;' +
      'transform:none!important;transition:border-color 160ms ease,background 160ms ease!important' +
    '}' +
    '.tab:hover .tab-icon,.tab.active .tab-icon{' +
      'background:#171a20!important;box-shadow:none!important;filter:none!important;transform:none!important' +
    '}' +
    '.tab[data-tab="leveling"] .tab-icon{--tab-icon-outline:#57f287}' +
    '.tab[data-tab="tickets"] .tab-icon{--tab-icon-outline:#ed4245}' +
    '.tab[data-tab="messages"] .tab-icon{--tab-icon-outline:#63b8ff}' +
    '@media(max-width:740px){.tab .tab-icon{' +
      'width:30px!important;height:30px!important;flex-basis:30px!important;padding:4px!important;border-radius:7px!important' +
    '}}';
  document.head.append(iconStyle);

  function captureResetView() {
    const view = {
      tab: state.activeTab,
      levelingTab: state.activeLevelingTab,
      scrollTop: elements.configForm?.scrollTop || 0,
      ticketId: '',
      ticketSection: '',
    };
    if (view.tab !== 'tickets') return view;
    const heading = document.querySelector('#ticketEditorRoot .ticket-editor-head h3')?.textContent?.trim() || '';
    const types = ensureTicketEditor().getValue()?.tickets?.types || [];
    view.ticketId = types.find((type) => heading.endsWith(type.name))?.id || '';
    view.ticketSection = document.querySelector('#ticketEditorRoot .ticket-type-tabs .mini-tab.active')?.dataset.value || '';
    return view;
  }

  function restoreResetView(view) {
    if (!view) return;
    if (view.tab === 'leveling' && view.levelingTab) {
      document.querySelector('[data-leveling-tab="' + CSS.escape(view.levelingTab) + '"]')?.click();
    }
    if (view.tab === 'tickets' && view.ticketId) {
      document.querySelector('.ticket-type-card[data-ticket-id="' + CSS.escape(view.ticketId) + '"]')?.click();
      if (view.ticketSection) {
        document.querySelector('#ticketEditorRoot .ticket-type-tabs [data-value="' + CSS.escape(view.ticketSection) + '"]')?.click();
      }
    }
    requestAnimationFrame(() => {
      if (elements.configForm) elements.configForm.scrollTop = view.scrollTop;
      refreshDirtyState();
    });
  }

  let automaticResetPass = false;
  document.addEventListener('click', (event) => {
    const resetButton = event.target.closest('#resetTabButton');
    if (!resetButton || automaticResetPass) return;
    const view = captureResetView();

    setTimeout(() => {
      refreshDirtyState();
      if (state.dirtyTabs.has(view.tab)) {
        automaticResetPass = true;
        resetButton.click();
        automaticResetPass = false;
      }
      setTimeout(() => restoreResetView(view), 0);
    }, 0);
  }, true);
})();
`;

const previousReadFile = fs.readFile.bind(fs);
const ADMIN_APP_JS = path.resolve(__dirname, '..', 'admin', 'app.js');
fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (path.resolve(String(filePath)) !== path.resolve(ADMIN_APP_JS) || typeof callback !== 'function') {
    return previousReadFile(filePath, ...args);
  }

  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, source + bridgeScript);
  };
  return previousReadFile(filePath, ...args);
};

module.exports = {};
    }],
    ["09-admin-save-and-action-fixes.js", function (module, exports, require, __filename, __dirname) {
'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_APP_JS = path.join(__dirname, '..', 'admin', 'app.js');


const requestActionValueScript = String.raw`
;(() => {
  if (window.__coinSpriteRequestActionValues) return;
  window.__coinSpriteRequestActionValues = true;
  const nativeValues = {
    accept: 'close',
    deny: 'delete',
    dm_message: 'transcript',
    role_add: 'move_to',
    blacklist: 'blacklist',
  };
  document.addEventListener('click', (event) => {
    const button = event.target.closest('#ticketEditorRoot [data-action="add-action"]');
    if (!button) return;
    const select = button.closest('.ticket-control-card')?.querySelector('[data-action-select]');
    const nativeValue = nativeValues[select?.value];
    if (!select || !nativeValue || nativeValue === select.value) return;
    let option = [...select.options].find((item) => item.value === nativeValue);
    if (!option) {
      option = new Option(select.selectedOptions[0]?.textContent || nativeValue, nativeValue);
      option.hidden = true;
      select.add(option);
    }
    select.value = nativeValue;
  }, true);
})();
`;

const levelingSaveScript = String.raw`
  async function saveUpgradeState() {
    if (!state.dirty || state.customSaving || !state.configUrl) return;
    state.customSaving = true;
    const save = document.querySelector('#saveButton');
    const status = document.querySelector('#statusBox');
    if (save) { save.disabled = true; save.textContent = 'Saving...'; }
    if (status) { status.textContent = 'Saving changes...'; status.className = 'status'; }
    try {
      const xpChanged = JSON.stringify([...state.xpIds].sort()) !== JSON.stringify([...state.savedXpIds].sort());
      const gameChanged = state.gameEnabled !== state.savedGameEnabled || state.gameChannel !== state.savedGameChannel;
      const body = {};
      if (xpChanged) {
        body.xp = {
          channels: [
            ...state.xpIds,
            ...state.xpOverrides.filter((rule) => rule?.channelId && !state.xpIds.includes(String(rule.channelId))),
          ],
        };
      }
      if (gameChanged) {
        body.channels = { wordChain: state.gameEnabled ? state.gameChannel : '' };
        body.wordChain = { enabled: state.gameEnabled };
      }
      const response = await nativeFetch(state.configUrl, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Request failed with ' + response.status);
      const split = splitXp(payload.config);
      state.xpIds = split.ids;
      state.savedXpIds = [...split.ids];
      state.xpOverrides = split.overrides;
      state.gameChannel = String(payload.config?.channels?.wordChain || '');
      state.savedGameChannel = state.gameChannel;
      state.gameEnabled = Boolean(payload.config?.wordChain?.enabled ?? state.gameChannel);
      state.savedGameEnabled = state.gameEnabled;
      state.dirty = false;
      const bar = document.querySelector('#unsavedBar');
      const label = document.querySelector('#savedState');
      if (bar) bar.hidden = true;
      if (label) label.textContent = 'Saved';
      if (status) { status.textContent = 'Changes saved.'; status.className = 'status ok'; }
      renderDashboard();
    } catch (error) {
      if (status) { status.textContent = error.message; status.className = 'status error'; }
    } finally {
      state.customSaving = false;
      if (save) { save.disabled = !state.dirty; save.textContent = 'Save changes'; }
    }
  }
  document.addEventListener('click', (event) => {
    if (!event.target.closest('#saveButton') || !state.dirty) return;
    const patchStarted = state.patchStarted;
    setTimeout(() => {
      if (state.dirty && state.patchStarted === patchStarted) saveUpgradeState();
    }, 0);
  }, true);
`;

function patchTicketUi(source) {
  const resetListener = "  document.querySelector('#resetTabButton')?.addEventListener('click',()=>{if(!state.dirty)return;state.xpIds=[...state.savedXpIds];state.gameChannel=state.savedGameChannel;state.gameEnabled=state.savedGameEnabled;state.dirty=false;setTimeout(renderDashboard,0);},true);";
  return source
    .replace(
      "xpIds: [], savedXpIds: [], gameChannel: '', savedGameChannel: '',\n    gameEnabled: false, savedGameEnabled: false, dirty: false, reloaded: false,",
      "xpIds: [], savedXpIds: [], xpOverrides: [], gameChannel: '', savedGameChannel: '',\n    gameEnabled: false, savedGameEnabled: false, dirty: false, reloaded: false,\n    configUrl: '', patchStarted: 0, customSaving: false,",
    )
    .replace('    let options = init;', "    if (configRequest) state.configUrl = url;\n    let options = init;")
    .replace(
      "    if (configRequest && method === 'PATCH' && init.body) {\n      const body",
      "    if (configRequest && method === 'PATCH' && init.body) {\n      state.patchStarted += 1;\n      const body",
    )
    .replace(
      '      state.xpIds = split.ids; state.savedXpIds = [...split.ids];',
      '      state.xpIds = split.ids; state.savedXpIds = [...split.ids]; state.xpOverrides = split.overrides;',
    )
    .replace(resetListener, levelingSaveScript + resetListener);
}

const previousReadFile = fs.readFile.bind(fs);
fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (typeof callback !== 'function') return previousReadFile(filePath, ...args);
  const resolved = path.resolve(String(filePath));
  if (resolved !== path.resolve(ADMIN_APP_JS)) {
    return previousReadFile(filePath, ...args);
  }
  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, `${patchTicketUi(source)}\n${requestActionValueScript}`);
  };
  return previousReadFile(filePath, ...args);
};

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
