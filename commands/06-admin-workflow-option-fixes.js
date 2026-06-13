const fs = require('fs');
const path = require('path');

const originalReadFile = fs.readFile.bind(fs);
const ADMIN_FIXES_JS = path.resolve(__dirname, '..', 'admin', 'admin-fixes.js');

const OPTION_FIX_SCRIPT = `
(() => {
  let scheduled = false;
  let loadedGuildId = '';
  let loadingGuildId = '';
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
    if (!guildId || guildId === loadedGuildId || guildId === loadingGuildId) return;
    loadingGuildId = guildId;
    try {
      const [templateResponse, workflowResponse] = await Promise.all([
        fetch('/api/guilds/' + guildId + '/message-templates'),
        fetch('/api/guilds/' + guildId + '/request-control-workflows'),
      ]);
      templates = templateResponse.ok ? (await templateResponse.json()).templates || [] : [];
      workflowValues = workflowResponse.ok ? (await workflowResponse.json()).workflows || {} : {};
      loadedGuildId = guildId;
    } finally {
      loadingGuildId = '';
    }
  }

  function dedupeConditionOptions(select) {
    const options = [...select.options].filter((option) =>
      option.textContent.trim() === 'Condition' || String(option.value).startsWith('condition_'));
    options.slice(0, -1).forEach((option) => option.remove());
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
    scheduled = false;
    document.querySelectorAll('#ticketEditorRoot select[data-action-select]').forEach(dedupeConditionOptions);
    await loadGuildData();
    ensureDmTemplateFields();
  }

  function scheduleRepair() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(repairWorkflowOptions);
  }

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (target.dataset.workflowDmTemplate === undefined) return;
    const type = activeRequestType();
    const control = type?.adminPanel?.controls?.[Number(target.dataset.workflowDmTemplate)];
    if (!type || !control) return;
    workflowValues[type.id] ||= {};
    workflowValues[type.id][control.id] ||= { dmTemplateId: '', sequence: [], conditions: [] };
    workflowValues[type.id][control.id].dmTemplateId = target.value;
  }, true);

  document.querySelector('#guildSelect')?.addEventListener('change', () => {
    loadedGuildId = '';
    templates = [];
    workflowValues = {};
    scheduleRepair();
  }, true);

  new MutationObserver(scheduleRepair).observe(document.body, { childList: true, subtree: true });
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
    if (path.resolve(String(filePath)) !== ADMIN_FIXES_JS) {
      callback(null, data);
      return;
    }
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, `${source}\n${OPTION_FIX_SCRIPT}`);
  });
};

module.exports = {};
