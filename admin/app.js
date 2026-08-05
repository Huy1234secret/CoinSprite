(() => {
  'use strict';

  const CHANNELS = [
    ['seed', 'Seed stock', 'Fresh seed inventory', '♧'],
    ['gear', 'Gear stock', 'Tools and equipment', '⚙'],
    ['crate', 'Crate stock', 'Cosmetic crate restocks', '◇'],
    ['weather', 'Weather', 'Active weather alerts', '☂'],
    ['moon', 'Moon events', 'Moon and sky events', '◐'],
    ['sell', 'Sell prices', 'Garden Guide price changes', '↗'],
    ['roleAssign', 'Role selector', 'Self-serve alert roles', '@'],
    ['updates', 'Update notes', 'GAG content announcements', '✦'],
  ];
  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'super', 'secret'];
  const FALL_TYPES = [
    ['seed', 'Fall seeds', '♧'], ['gear', 'Fall gear', '⚙'], ['crate', 'Fall crates', '◇'], ['sell', 'Fall sell', '↗'],
  ];

  const state = {
    me: null,
    csrfToken: '',
    guilds: [],
    guildId: '',
    config: null,
    directory: { channels: [], gag2StockPermissions: { usable: true, missing: [] } },
    catalog: { items: {}, fallItems: {} },
    savedSnapshot: '',
    currentView: 'stock',
    saving: false,
    progressTimer: null,
    consoleTimer: null,
    consolePaused: false,
    consoleEntries: [],
    consoleAfter: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const elements = {
    appShell: $('#appShell'), loginPanel: $('#loginPanel'), loginStatus: $('#loginStatus'),
    logoutButton: $('#logoutButton'), userChip: $('#userChip'), userAvatar: $('#userAvatar'), sessionLabel: $('#sessionLabel'),
    guildSelect: $('#guildSelect'), serverMeta: $('#serverMeta'), ownerNav: $('#ownerNav'),
    stockView: $('#stockView'), ownerView: $('#ownerView'), toast: $('#toast'),
    stockEnabled: $('#stockEnabled'), channelGrid: $('#channelGrid'), filterGrid: $('#filterGrid'),
    multiplierFilters: $('#multiplierFilters'), fallFilters: $('#fallFilters'), engineTitle: $('#engineTitle'),
    engineMessage: $('#engineMessage'), saveButton: $('#saveButton'), mobileSaveButton: $('#mobileSaveButton'),
    saveState: $('#saveState'), mobileSaveState: $('#mobileSaveState'), ownerOverview: $('#ownerOverview'),
    ownerRefresh: $('#ownerRefresh'), consoleOutput: $('#consoleOutput'), consoleClear: $('#consoleClear'),
    consoleToggle: $('#consoleToggle'), dialog: $('#confirmDialog'), dialogTitle: $('#dialogTitle'), dialogCopy: $('#dialogCopy'),
    dialogInputWrap: $('#dialogInputWrap'), dialogInput: $('#dialogInput'), dialogConfirm: $('#dialogConfirm'),
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function avatarUrl(user) {
    if (user?.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
    return 'https://cdn.discordapp.com/embed/avatars/0.png';
  }

  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.headers || {}) };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.csrfToken && !['GET', 'HEAD'].includes(String(options.method || 'GET').toUpperCase())) {
      headers['X-CSRF-Token'] = state.csrfToken;
    }
    const response = await fetch(path, { credentials: 'same-origin', ...options, headers });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Request failed (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  let toastTimer = null;
  function showToast(message, kind = '') {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.className = `toast${kind ? ` ${kind}` : ''}`;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3800);
  }

  function renderSession() {
    const user = state.me?.user;
    elements.loginPanel.hidden = Boolean(user);
    elements.appShell.hidden = !user;
    elements.logoutButton.hidden = !user;
    elements.userChip.hidden = !user;
    elements.ownerNav.hidden = !state.me?.owner;
    if (!user) return;

    elements.sessionLabel.textContent = user.globalName || user.username;
    elements.userAvatar.src = avatarUrl(user);
    elements.userAvatar.alt = `${user.globalName || user.username} avatar`;
    elements.guildSelect.replaceChildren();
    if (!state.guilds.length) {
      elements.guildSelect.append(new Option('No editable servers', ''));
      elements.guildSelect.disabled = true;
      elements.engineTitle.textContent = 'No communities found';
      elements.engineMessage.textContent = 'Administrator access is required to configure a server.';
      return;
    }
    for (const guild of state.guilds) elements.guildSelect.append(new Option(guild.name, guild.id));
    elements.guildSelect.disabled = false;
  }

  function normalizeStockConfig(config) {
    const source = clone(config?.gag2Stock || {});
    source.enabled = source.enabled !== false;
    source.channels ||= {};
    source.filters ||= {};
    source.filters.rarities ||= {};
    source.filters.roleItems ||= {};
    source.filters.sellMultipliers ||= ['normal', '2x', '4x'];
    source.fall ||= {};
    source.fall.enabledTypes ||= [];
    source.fall.roleItems ||= {};
    for (const type of ['seed', 'gear', 'crate']) source.filters.rarities[type] ||= RARITIES.filter((rarity) => rarity !== 'secret');
    source.filters.rarities.sell ||= [...RARITIES];
    return source;
  }

  function channelOptions(selected) {
    const options = ['<option value="">Not routed</option>'];
    let lastParent = null;
    for (const channel of state.directory.channels.filter((item) => !item.archived)) {
      if (channel.parentName && channel.parentName !== lastParent) {
        options.push(`<option disabled>── ${escapeHtml(channel.parentName)} ──</option>`);
        lastParent = channel.parentName;
      }
      const prefix = channel.kind === 'thread' ? '⌁' : channel.kind === 'forum' ? '▦' : '#';
      options.push(`<option value="${channel.id}" ${channel.id === selected ? 'selected' : ''}>${prefix} ${escapeHtml(channel.name)}</option>`);
    }
    return options.join('');
  }

  function renderChannels() {
    const channels = state.config.gag2Stock.channels;
    elements.channelGrid.innerHTML = CHANNELS.map(([key, label, description, icon]) => `
      <label class="channel-card">
        <span class="feed-icon" aria-hidden="true">${icon}</span>
        <span class="feed-copy"><strong>${label}</strong><small>${description}</small></span>
        <select data-channel="${key}" aria-label="${label} channel">${channelOptions(channels[key] || '')}</select>
      </label>`).join('');
  }

  function selectedRarities(type) {
    return new Set(state.config.gag2Stock.filters.rarities[type] || []);
  }

  function renderFilters() {
    const types = ['seed', 'gear', 'crate', 'sell'];
    elements.filterGrid.innerHTML = types.map((type) => {
      const selected = selectedRarities(type);
      const allowed = type === 'sell' ? RARITIES : RARITIES.filter((rarity) => rarity !== 'secret');
      return `<article class="filter-card" data-filter-card="${type}">
        <div class="filter-card-head"><strong>${type} alerts</strong><button type="button" data-select-all="${type}">Select all</button></div>
        <div class="chip-row">${allowed.map((rarity) => `<label class="filter-chip rarity-${rarity}"><input type="checkbox" data-rarity="${type}" value="${rarity}" ${selected.has(rarity) ? 'checked' : ''}><span>${rarity}</span></label>`).join('')}</div>
      </article>`;
    }).join('');

    const selectedMultipliers = new Set(state.config.gag2Stock.filters.sellMultipliers || []);
    elements.multiplierFilters.innerHTML = ['normal', '2x', '4x'].map((value) => `<label class="filter-chip"><input type="checkbox" data-multiplier value="${value}" ${selectedMultipliers.has(value) ? 'checked' : ''}><span>${value}</span></label>`).join('');
  }

  function renderFall() {
    const selected = new Set(state.config.gag2Stock.fall.enabledTypes || []);
    elements.fallFilters.innerHTML = FALL_TYPES.map(([type, label, icon]) => `<label class="event-toggle"><input type="checkbox" data-fall-type value="${type}" ${selected.has(type) ? 'checked' : ''}><span><b>${icon}</b>${label}</span></label>`).join('');
  }

  function snapshot() {
    if (!state.config) return '';
    const stock = state.config.gag2Stock;
    return JSON.stringify({
      enabled: stock.enabled,
      channels: stock.channels,
      rarities: stock.filters.rarities,
      sellMultipliers: stock.filters.sellMultipliers,
      fallTypes: stock.fall.enabledTypes,
    });
  }

  function refreshDirty() {
    const dirty = snapshot() !== state.savedSnapshot;
    const label = dirty ? 'Unsaved changes' : 'All changes saved';
    elements.saveState.textContent = label;
    elements.mobileSaveState.textContent = label;
    elements.saveState.classList.toggle('dirty', dirty);
    elements.saveButton.disabled = !dirty || state.saving;
    elements.mobileSaveButton.disabled = !dirty || state.saving;
  }

  function renderEngine(progress = null) {
    const permissions = state.directory.gag2StockPermissions || { usable: true, missing: [] };
    if (!permissions.usable) {
      elements.engineTitle.textContent = 'Permissions needed';
      elements.engineMessage.textContent = `Grant the bot: ${permissions.missing.map((item) => item.label).join(', ')}.`;
      return;
    }
    if (progress?.status === 'running') {
      elements.engineTitle.textContent = progress.action === 'removing' ? 'Removing alert roles' : 'Syncing alert roles';
      elements.engineMessage.textContent = `${Math.max(0, Number(progress.remaining) || 0)} changes remaining.`;
      return;
    }
    if (progress?.status === 'error') {
      elements.engineTitle.textContent = 'Sync needs attention';
      elements.engineMessage.textContent = progress.message || 'Role setup could not finish.';
      return;
    }
    const routed = Object.values(state.config?.gag2Stock?.channels || {}).filter(Boolean).length;
    elements.engineTitle.textContent = state.config?.gag2Stock?.enabled === false ? 'Engine paused' : 'Stock engine online';
    elements.engineMessage.textContent = `${routed} of ${CHANNELS.length} destinations routed${progress?.status === 'complete' ? ' · roles synced' : ''}.`;
  }

  function renderStock(progress = null) {
    elements.stockEnabled.checked = state.config.gag2Stock.enabled;
    renderChannels();
    renderFilters();
    renderFall();
    renderEngine(progress);
    refreshDirty();
  }

  async function loadGuild(guildId) {
    if (!guildId) return;
    state.guildId = guildId;
    elements.guildSelect.value = guildId;
    const guild = state.guilds.find((item) => item.id === guildId);
    elements.serverMeta.textContent = guild ? `Guild ${guild.id}` : `Guild ${guildId}`;
    elements.engineTitle.textContent = 'Tuning into stock feeds';
    elements.engineMessage.textContent = 'Loading channels and alert configuration…';
    elements.saveButton.disabled = true;
    elements.mobileSaveButton.disabled = true;

    try {
      const [directoryPayload, configPayload, catalogPayload, progressPayload] = await Promise.all([
        api(`/api/guilds/${guildId}/directory`),
        api(`/api/guilds/${guildId}/config`),
        api(`/api/guilds/${guildId}/gag2-stock/catalog`),
        api(`/api/guilds/${guildId}/gag2-stock/setup-progress`).catch(() => null),
      ]);
      if (state.guildId !== guildId) return;
      state.directory = directoryPayload.directory;
      state.catalog = catalogPayload;
      state.config = { ...configPayload.config, gag2Stock: normalizeStockConfig(configPayload.config) };
      state.savedSnapshot = snapshot();
      renderStock(progressPayload?.progress);
      if (progressPayload?.progress?.status === 'running') pollProgress();
    } catch (error) {
      showToast(error.message, 'error');
      elements.engineTitle.textContent = 'Could not load this community';
      elements.engineMessage.textContent = error.message;
    }
  }

  function updateRoleItemsForChangedRarities(stock, previous) {
    for (const type of ['seed', 'gear', 'crate']) {
      const before = JSON.stringify(previous.filters.rarities[type] || []);
      const after = JSON.stringify(stock.filters.rarities[type] || []);
      if (before === after) continue;
      const selected = new Set(stock.filters.rarities[type]);
      stock.filters.roleItems[type] = (state.catalog.items[type] || [])
        .filter((item) => selected.has(item.rarity))
        .map((item) => item.key);
    }
  }

  async function saveStock() {
    if (!state.config || state.saving || snapshot() === state.savedSnapshot) return;
    state.saving = true;
    elements.saveButton.disabled = true;
    elements.mobileSaveButton.disabled = true;
    elements.saveState.textContent = 'Applying changes…';
    elements.mobileSaveState.textContent = 'Applying changes…';
    try {
      const stock = clone(state.config.gag2Stock);
      const previous = normalizeStockConfig((await api(`/api/guilds/${state.guildId}/config`)).config);
      updateRoleItemsForChangedRarities(stock, previous);
      const payload = await api(`/api/guilds/${state.guildId}/config`, {
        method: 'PATCH',
        body: JSON.stringify({ gag2Stock: stock }),
      });
      state.config = { ...payload.config, gag2Stock: normalizeStockConfig(payload.config) };
      state.savedSnapshot = snapshot();
      renderStock(payload.progress);
      showToast('Stock routing updated.');
      pollProgress();
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      state.saving = false;
      refreshDirty();
    }
  }

  async function pollProgress() {
    window.clearTimeout(state.progressTimer);
    if (!state.guildId) return;
    try {
      const payload = await api(`/api/guilds/${state.guildId}/gag2-stock/setup-progress`);
      renderEngine(payload.progress);
      if (payload.progress?.status === 'running') state.progressTimer = window.setTimeout(pollProgress, 1100);
    } catch (error) {
      renderEngine({ status: 'error', message: error.message });
    }
  }

  function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value) || 0);
  }

  function formatUptime(ms) {
    const totalMinutes = Math.floor((Number(ms) || 0) / 60000);
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor(totalMinutes % 1440 / 60);
    const minutes = totalMinutes % 60;
    return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  }

  function guildIcon(guild) {
    return guild.iconURL
      ? `<img src="${escapeHtml(guild.iconURL)}" alt="">`
      : `<span class="guild-fallback">${escapeHtml(guild.name.slice(0, 1).toUpperCase())}</span>`;
  }

  function renderOwnerOverview(payload) {
    const metrics = [
      ['Bot ping', `${formatNumber(payload.bot.pingMs)} ms`, 'Discord gateway'],
      ['Uptime', formatUptime(payload.bot.uptimeMs), payload.bot.tag],
      ['Communities', formatNumber(payload.bot.guildCount), `${formatNumber(payload.bot.totalUsers)} members`],
      ['Heap', payload.bot.memory.heapUsedLabel, 'Current process'],
      ['Storage', payload.storage.label, 'Data and logs'],
    ];
    const rows = (payload.guilds || []).map((guild) => `<tr>
      <td><div class="guild-cell">${guildIcon(guild)}<span><strong>${escapeHtml(guild.name)}</strong><small>${guild.id}</small></span></div></td>
      <td>${formatNumber(guild.totalUsers)}</td>
      <td><span class="status-pill ${guild.enabled ? '' : 'off'}">${guild.enabled ? 'Online' : 'Disabled'}</span></td>
      <td>${guild.stock.configuredChannels}/${guild.stock.totalChannels}</td>
      <td>${guild.stock.rolesSyncedAt ? new Date(guild.stock.rolesSyncedAt).toLocaleDateString() : 'Not yet'}</td>
      <td><div class="row-actions"><button class="text-button" type="button" data-owner-load="${guild.id}">Open</button><button class="text-button" type="button" data-owner-toggle="${guild.id}" data-enabled="${guild.enabled}">${guild.enabled ? 'Disable' : 'Enable'}</button></div></td>
    </tr>`).join('');
    elements.ownerOverview.innerHTML = `
      <section class="metric-grid">${metrics.map(([label, value, detail]) => `<article class="metric-card"><small>${label}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></article>`).join('')}</section>
      <section class="fleet-panel"><header class="fleet-head"><h2>Community fleet</h2><span>${payload.guilds.length} connected</span></header><div class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th>Community</th><th>Members</th><th>Status</th><th>Routes</th><th>Role sync</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No communities available.</td></tr>'}</tbody></table></div></section>`;
  }

  async function loadOwner() {
    if (!state.me?.owner) return;
    elements.ownerOverview.innerHTML = '<section class="metric-card"><small>OWNER PANEL</small><strong>Loading…</strong></section>';
    try {
      renderOwnerOverview(await api('/api/owner/overview'));
      await pollConsole(true);
      startConsolePolling();
    } catch (error) {
      elements.ownerOverview.innerHTML = `<section class="metric-card"><small>ERROR</small><strong>Unavailable</strong><span>${escapeHtml(error.message)}</span></section>`;
    }
  }

  function renderConsole() {
    if (!state.consoleEntries.length) {
      elements.consoleOutput.innerHTML = '<p class="console-empty">Waiting for bot activity…</p>';
      return;
    }
    elements.consoleOutput.innerHTML = state.consoleEntries.map((entry) => `<div class="console-line ${escapeHtml(entry.level)}"><span class="console-time">${escapeHtml(entry.time)}</span><span class="console-source">${escapeHtml(entry.source)}</span><span class="console-message">${escapeHtml(entry.message)}</span></div>`).join('');
    elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;
  }

  function addConsoleEntries(entries) {
    for (const entry of entries || []) {
      if (state.consoleEntries.some((existing) => existing.id === entry.id)) continue;
      state.consoleEntries.push(entry);
      state.consoleAfter = Math.max(state.consoleAfter, Number(entry.id) || 0);
    }
    if (state.consoleEntries.length > 500) state.consoleEntries.splice(0, state.consoleEntries.length - 500);
    renderConsole();
  }

  async function pollConsole(reset = false) {
    if (state.consolePaused || state.currentView !== 'owner') return;
    if (reset) {
      state.consoleEntries = [];
      state.consoleAfter = 0;
    }
    const payload = await api(`/api/owner/console?after=${state.consoleAfter}&limit=${reset ? 250 : 100}`);
    addConsoleEntries(payload.entries || payload.items || payload);
  }

  function startConsolePolling() {
    window.clearInterval(state.consoleTimer);
    state.consoleTimer = window.setInterval(() => pollConsole().catch(() => null), 2200);
  }

  function stopConsolePolling() {
    window.clearInterval(state.consoleTimer);
    state.consoleTimer = null;
  }

  function setView(view) {
    if (view === 'owner' && !state.me?.owner) return;
    state.currentView = view;
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    if (view === 'owner') loadOwner();
    else stopConsolePolling();
  }

  function confirmAction({ title, copy, input = false, confirmLabel = 'Confirm' }) {
    elements.dialogTitle.textContent = title;
    elements.dialogCopy.textContent = copy;
    elements.dialogInputWrap.hidden = !input;
    elements.dialogInput.value = '';
    elements.dialogConfirm.textContent = confirmLabel;
    elements.dialog.showModal();
    if (input) elements.dialogInput.focus();
    return new Promise((resolve) => {
      const onClose = () => {
        elements.dialog.removeEventListener('close', onClose);
        const confirmed = elements.dialog.returnValue === 'confirm';
        resolve(confirmed ? (input ? elements.dialogInput.value.trim() : true) : false);
      };
      elements.dialog.addEventListener('close', onClose);
    });
  }

  async function handleOwnerToggle(button) {
    const guildId = button.dataset.ownerToggle;
    const enabled = button.dataset.enabled === 'true';
    let reason = '';
    if (enabled) {
      reason = await confirmAction({ title: 'Disable this community?', copy: 'Stock posts and role interactions will stop immediately. The guild owner will be notified.', input: true, confirmLabel: 'Disable' });
      if (!reason) return;
    } else {
      const confirmed = await confirmAction({ title: 'Enable this community?', copy: 'CoinSprite will resume its GAG stock services for this server.', confirmLabel: 'Enable' });
      if (!confirmed) return;
    }
    await api(`/api/owner/guilds/${guildId}/${enabled ? 'disable' : 'enable'}`, {
      method: 'POST', body: JSON.stringify(enabled ? { reason } : {}),
    });
    showToast(`Community ${enabled ? 'disabled' : 'enabled'}.`);
    await loadOwner();
  }

  function updateConfigFromControl(target) {
    if (!state.config) return;
    const stock = state.config.gag2Stock;
    if (target === elements.stockEnabled) stock.enabled = target.checked;
    if (target.matches('[data-channel]')) stock.channels[target.dataset.channel] = target.value;
    if (target.matches('[data-rarity]')) {
      const type = target.dataset.rarity;
      stock.filters.rarities[type] = [...document.querySelectorAll(`[data-rarity="${type}"]:checked`)].map((input) => input.value);
    }
    if (target.matches('[data-multiplier]')) stock.filters.sellMultipliers = [...document.querySelectorAll('[data-multiplier]:checked')].map((input) => input.value);
    if (target.matches('[data-fall-type]')) stock.fall.enabledTypes = [...document.querySelectorAll('[data-fall-type]:checked')].map((input) => input.value);
    renderEngine();
    refreshDirty();
  }

  async function loadSession() {
    try {
      const payload = await api('/api/me');
      state.me = payload;
      state.csrfToken = payload.csrfToken || '';
      state.guilds = payload.guilds || [];
      renderSession();
      if (state.guilds.length) await loadGuild(state.guilds[0].id);
    } catch (error) {
      state.me = null;
      state.guilds = [];
      renderSession();
      elements.loginStatus.textContent = error.status === 401 ? 'Sign in to open your stock station.' : error.message;
    }
  }

  elements.guildSelect.addEventListener('change', () => loadGuild(elements.guildSelect.value));
  elements.saveButton.addEventListener('click', saveStock);
  elements.mobileSaveButton.addEventListener('click', saveStock);
  elements.logoutButton.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null);
    location.assign('/admin');
  });
  elements.stockEnabled.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.channelGrid.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.filterGrid.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.multiplierFilters.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.fallFilters.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.filterGrid.addEventListener('click', (event) => {
    const button = event.target.closest('[data-select-all]');
    if (!button) return;
    const boxes = [...document.querySelectorAll(`[data-rarity="${button.dataset.selectAll}"]`)];
    const shouldSelect = boxes.some((input) => !input.checked);
    for (const input of boxes) input.checked = shouldSelect;
    if (boxes[0]) updateConfigFromControl(boxes[0]);
  });
  document.querySelector('.nav-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-view]');
    if (button) setView(button.dataset.view);
  });
  elements.ownerRefresh.addEventListener('click', loadOwner);
  elements.ownerOverview.addEventListener('click', async (event) => {
    const load = event.target.closest('[data-owner-load]');
    if (load) {
      const guildId = load.dataset.ownerLoad;
      if (!state.guilds.some((guild) => guild.id === guildId)) state.guilds.push({ id: guildId, name: `Guild ${guildId}` });
      renderSession();
      setView('stock');
      await loadGuild(guildId);
      return;
    }
    const toggle = event.target.closest('[data-owner-toggle]');
    if (toggle) handleOwnerToggle(toggle).catch((error) => showToast(error.message, 'error'));
  });
  elements.consoleClear.addEventListener('click', () => { state.consoleEntries = []; renderConsole(); });
  elements.consoleToggle.addEventListener('click', () => {
    state.consolePaused = !state.consolePaused;
    elements.consoleToggle.textContent = state.consolePaused ? 'Resume' : 'Pause';
    if (!state.consolePaused) pollConsole().catch(() => null);
  });
  window.addEventListener('beforeunload', (event) => {
    if (snapshot() === state.savedSnapshot) return;
    event.preventDefault();
    event.returnValue = '';
  });

  loadSession();
})();
