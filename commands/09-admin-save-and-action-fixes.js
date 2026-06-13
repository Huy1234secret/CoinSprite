'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_FIXES_JS = path.join(__dirname, '..', 'admin', 'admin-fixes.js');
const TICKET_UI_JS = path.join(__dirname, '..', 'admin', 'ticket-ui-upgrade.js');

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
  if (resolved !== path.resolve(ADMIN_FIXES_JS) && resolved !== path.resolve(TICKET_UI_JS)) {
    return previousReadFile(filePath, ...args);
  }
  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, resolved === path.resolve(ADMIN_FIXES_JS)
      ? source + requestActionValueScript
      : patchTicketUi(source));
  };
  return previousReadFile(filePath, ...args);
};

module.exports = {};
