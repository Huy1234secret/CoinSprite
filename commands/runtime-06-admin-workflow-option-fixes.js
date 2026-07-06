
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
