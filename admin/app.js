(() => {
  'use strict';

  const discordEmoji = (id) => `https://cdn.discordapp.com/emojis/${id}.webp?size=32&quality=lossless`;
  const CHANNELS = [
    ['seed', 'Seed stock', 'Fresh seed inventory', discordEmoji('1525195207778373814')],
    ['gear', 'Gear stock', 'Tools and equipment', discordEmoji('1525198690707439736')],
    ['crate', 'Crate stock', 'Cosmetic crate restocks', discordEmoji('1525201479546441931')],
    ['weather', 'Weather', 'Active weather alerts', discordEmoji('1525203819775135764')],
    ['moon', 'Moon prediction', 'Accuracy 100%', discordEmoji('1525203812607070260')],
    ['sell', 'Sell prices', 'Garden Guide price changes', discordEmoji('1525368044824825976')],
    ['roleAssign', 'Role selector', 'Self-serve alert roles', '\u{1F3C5}'],
    ['updates', 'Update notes', 'GAG content announcements', discordEmoji('1525198707925057607')],
  ];
  const RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'super', 'secret'];
  const FALL_TYPES = [
    ['seed', 'Fall seeds', discordEmoji('1533299246315475045')],
    ['gear', 'Fall gear', discordEmoji('1533305562043781282')],
    ['crate', 'Fall crates', discordEmoji('1533306164018937936')],
    ['sell', 'Fall sell', '\u{1F341}'],
  ];

  const state = {
    me: null,
    csrfToken: '',
    guilds: [],
    guildId: '',
    config: null,
    directory: { channels: [], gag2StockPermissions: { usable: true, missing: [] } },
    catalog: { items: {}, fallItems: {}, fallHarvestEndsAt: '' },
    savedSnapshot: '',
    currentView: 'stock',
    saving: false,
    fallTimer: null,
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
    multiplierFilters: $('#multiplierFilters'), fallFilters: $('#fallFilters'), fallRoleFilters: $('#fallRoleFilters'),
    fallCountdown: $('#fallCountdown'), fallSection: $('#fallHarvestSection'), saveDock: $('#saveDock'),
    saveButton: $('#saveButton'), saveState: $('#saveState'), ownerOverview: $('#ownerOverview'),
    ownerRefresh: $('#ownerRefresh'), consoleOutput: $('#consoleOutput'), consoleClear: $('#consoleClear'),
    consoleToggle: $('#consoleToggle'), dialog: $('#confirmDialog'), dialogTitle: $('#dialogTitle'), dialogCopy: $('#dialogCopy'),
    dialogInputWrap: $('#dialogInputWrap'), dialogInput: $('#dialogInput'), dialogConfirm: $('#dialogConfirm'),
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[char]);
  }

  function titleCase(value) {
    const text = String(value || '');
    return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : '';
  }

  function emojiUrl(value) {
    const match = String(value || '').match(/^<a?:[a-z0-9_]+:(\d{16,20})>$/i);
    return match ? `https://cdn.discordapp.com/emojis/${match[1]}.webp?size=32&quality=lossless` : '';
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
    source.fall.sellMultipliers ||= ['normal', '2x', '4x'];
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
        <span class="feed-icon" aria-hidden="true">${/^(?:https:|data:image)/.test(icon) ? `<img src="${escapeHtml(icon)}" alt="">` : icon}</span>
        <span class="feed-copy"><strong>${label}</strong><small>${description}</small></span>
        <select data-channel="${key}" aria-label="${label} channel">${channelOptions(channels[key] || '')}</select>
      </label>`).join('');
  }

  function pickerItemOption(type, item, selected, scope = 'garden') {
    const rarity = RARITIES.includes(item.rarity) ? item.rarity : 'common';
    const image = emojiUrl(item.emoji);
    const name = item.name || item.roleName || titleCase(item.key);
    const search = `${name} ${rarity} ${item.key}`.toLowerCase();
    const inputAttribute = scope === 'fall' ? 'data-fall-filter-item' : 'data-filter-item';
    return `<label class="picker-option rarity-${rarity}${selected.has(item.key) ? ' selected' : ''}" data-picker-option data-search="${escapeHtml(search)}">
      <input type="checkbox" ${inputAttribute}="${type}" value="${escapeHtml(item.key)}" ${selected.has(item.key) ? 'checked' : ''}>
      <span class="picker-option-main">${image ? `<img src="${image}" alt="">` : '<span class="picker-option-fallback">✦</span>'}<span><b>${escapeHtml(name)}</b><small>${titleCase(rarity)}</small></span></span>
      <i class="picker-check" aria-hidden="true">✓</i>
    </label>`;
  }

  function itemPickerGroups(type, items, selected, scope = 'garden') {
    return RARITIES.filter((rarity) => rarity !== 'secret').map((rarity) => {
      const matches = items.filter((item) => item.rarity === rarity);
      if (!matches.length) return '';
      return `<section class="picker-group" data-picker-group-section="${rarity}">
        <div class="picker-group-head"><span class="rarity-label rarity-${rarity}">${titleCase(rarity)}</span><button type="button" data-picker-group="${type}" data-picker-scope="${scope}" data-picker-rarity="${rarity}">Select rarity</button></div>
        <div class="picker-group-options">${matches.map((item) => pickerItemOption(type, item, selected, scope)).join('')}</div>
      </section>`;
    }).join('');
  }

  function sellRarityOptions(selected) {
    return RARITIES.map((rarity) => `<label class="picker-option rarity-${rarity}${selected.has(rarity) ? ' selected' : ''}" data-picker-option data-search="${rarity}">
      <input type="checkbox" data-filter-rarity="sell" value="${rarity}" ${selected.has(rarity) ? 'checked' : ''}>
      <span class="picker-option-main"><span class="rarity-dot"></span><span><b>${titleCase(rarity)}</b><small>Sell price rarity</small></span></span>
      <i class="picker-check" aria-hidden="true">✓</i>
    </label>`).join('');
  }

  function filterPickerCard(type) {
    const stock = state.config.gag2Stock;
    const itemMode = type !== 'sell';
    const options = itemMode ? (state.catalog.items[type] || []) : RARITIES;
    const selected = new Set(itemMode ? (stock.filters.roleItems[type] || []) : (stock.filters.rarities.sell || []));
    const allSelected = options.length > 0 && selected.size === options.length;
    const label = type === 'sell' ? 'Sell price' : titleCase(type);
    const summary = selected.size === 0
      ? `No ${itemMode ? 'items' : 'rarities'} selected`
      : allSelected ? `All ${options.length} ${itemMode ? 'items' : 'rarities'}` : `${selected.size} of ${options.length} selected`;
    const routed = Boolean(stock.channels[type]);
    return `<article class="filter-card${routed ? '' : ' is-disabled'}" data-filter-card="${type}">
      <div class="filter-card-head"><strong>${label} alerts</strong><span>${itemMode ? 'Choose items' : 'Choose rarities'}</span></div>
      <div class="notification-picker" data-notification-picker="${type}">
        <button class="notification-trigger" type="button" data-picker-trigger="${type}" data-picker-scope="garden" aria-expanded="false" ${routed ? '' : 'disabled'}>
          <span><small>${routed ? 'Notification roles' : 'Choose a destination first'}</small><strong data-picker-summary="${type}">${summary}</strong></span><i aria-hidden="true">⌄</i>
        </button>
        <div class="notification-menu" data-picker-menu="${type}" data-picker-scope="garden" hidden>
          <div class="picker-tools"><input type="search" data-picker-search="${type}" placeholder="Search ${itemMode ? 'rarity or item' : 'rarity'}" autocomplete="off"><button type="button" data-picker-all="${type}" data-picker-scope="garden">${allSelected ? 'Clear all' : 'Select all'}</button></div>
          <div class="picker-options">${itemMode ? itemPickerGroups(type, options, selected) : sellRarityOptions(selected)}</div>
        </div>
      </div>
    </article>`;
  }

  function renderFilters() {
    elements.filterGrid.innerHTML = ['seed', 'gear', 'crate', 'sell'].map(filterPickerCard).join('');

    const selectedMultipliers = new Set(state.config.gag2Stock.filters.sellMultipliers || []);
    elements.multiplierFilters.innerHTML = ['normal', '2x', '4x'].map((value) => `<label class="filter-chip"><input type="checkbox" data-multiplier value="${value}" ${selectedMultipliers.has(value) ? 'checked' : ''}><span>${value}</span></label>`).join('');
  }

  function fallHarvestEndMs() {
    return Date.parse(state.catalog.fallHarvestEndsAt || '');
  }

  function isFallHarvestActive() {
    const endAtMs = fallHarvestEndMs();
    return Number.isFinite(endAtMs) && Date.now() < endAtMs;
  }

  function updateFallCountdown() {
    const endAtMs = fallHarvestEndMs();
    const remainingMs = endAtMs - Date.now();
    const active = Number.isFinite(endAtMs) && remainingMs > 0;
    elements.fallSection?.classList.toggle('is-ended', !active);
    if (!elements.fallCountdown) return active;
    if (!active) {
      elements.fallCountdown.innerHTML = '<span>Event status</span><strong>Harvest ended</strong>';
      return false;
    }
    const totalSeconds = Math.floor(remainingMs / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const clock = [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
    elements.fallCountdown.innerHTML = `<span>Event ends in</span><strong>${days}d ${clock}</strong>`;
    return true;
  }

  function startFallCountdown() {
    window.clearInterval(state.fallTimer);
    if (!updateFallCountdown()) return;
    state.fallTimer = window.setInterval(() => {
      if (updateFallCountdown()) return;
      window.clearInterval(state.fallTimer);
      renderFall();
    }, 1000);
  }

  function fallPickerCard(type, label) {
    const stock = state.config.gag2Stock;
    const enabled = isFallHarvestActive() && stock.fall.enabledTypes.includes(type);
    if (type === 'sell') {
      const selected = new Set(stock.fall.sellMultipliers || []);
      return `<article class="filter-card fall-role-card${enabled ? '' : ' is-disabled'}" data-fall-filter-card="sell">
        <div class="filter-card-head"><strong>Fall sell alerts</strong><span>Uses Garden Valley roles</span></div>
        <div class="chip-row fall-multiplier-row">${['normal', '2x', '4x'].map((value) => `<label class="filter-chip"><input type="checkbox" data-fall-multiplier value="${value}" ${selected.has(value) ? 'checked' : ''} ${enabled ? '' : 'disabled'}><span>${value}</span></label>`).join('')}</div>
      </article>`;
    }
    const options = state.catalog.fallItems[type] || [];
    const selected = new Set(stock.fall.roleItems[type] || []);
    const allSelected = options.length > 0 && selected.size === options.length;
    const noun = options.length === 1 ? 'item' : 'items';
    const summary = selected.size === 0 ? 'No items selected'
      : allSelected ? `All ${options.length} ${noun}` : `${selected.size} of ${options.length} selected`;
    return `<article class="filter-card fall-role-card${enabled ? '' : ' is-disabled'}" data-fall-filter-card="${type}">
      <div class="filter-card-head"><strong>${label} roles</strong><span>Fall Harvest only</span></div>
      <div class="notification-picker" data-notification-picker="fall:${type}">
        <button class="notification-trigger" type="button" data-picker-trigger="${type}" data-picker-scope="fall" aria-expanded="false" ${enabled ? '' : 'disabled'}>
          <span><small>${enabled ? 'Notification roles' : `Enable ${label.toLowerCase()} above`}</small><strong data-picker-summary="${type}">${summary}</strong></span><i aria-hidden="true">⌄</i>
        </button>
        <div class="notification-menu" data-picker-menu="${type}" data-picker-scope="fall" hidden>
          <div class="picker-tools"><input type="search" data-picker-search="${type}" placeholder="Search rarity or item" autocomplete="off"><button type="button" data-picker-all="${type}" data-picker-scope="fall">${allSelected ? 'Clear all' : 'Select all'}</button></div>
          <div class="picker-options">${itemPickerGroups(type, options, selected, 'fall')}</div>
        </div>
      </div>
    </article>`;
  }

  function renderFall() {
    const selected = new Set(state.config.gag2Stock.fall.enabledTypes || []);
    const active = isFallHarvestActive();
    elements.fallFilters.innerHTML = FALL_TYPES.map(([type, label, icon]) => `<label class="event-toggle"><input type="checkbox" data-fall-type value="${type}" ${selected.has(type) ? 'checked' : ''} ${active ? '' : 'disabled'}><span><b>${icon.startsWith('https:') ? `<img src="${escapeHtml(icon)}" alt="">` : icon}</b>${label}</span></label>`).join('');
    elements.fallRoleFilters.innerHTML = FALL_TYPES.map(([type, label]) => fallPickerCard(type, label)).join('');
  }

  function snapshot() {
    if (!state.config) return '';
    const stock = state.config.gag2Stock;
    return JSON.stringify({
      enabled: stock.enabled,
      channels: stock.channels,
      rarities: stock.filters.rarities,
      roleItems: stock.filters.roleItems,
      sellMultipliers: stock.filters.sellMultipliers,
      fallTypes: stock.fall.enabledTypes,
      fallRoleItems: stock.fall.roleItems,
      fallSellMultipliers: stock.fall.sellMultipliers,
    });
  }

  function refreshDirty() {
    const dirty = snapshot() !== state.savedSnapshot;
    elements.saveDock.hidden = !dirty && !state.saving;
    elements.saveState.textContent = state.saving ? 'Applying changes…' : 'Unsaved changes';
    elements.saveButton.disabled = !dirty || state.saving;
  }

  function renderStock(progress = null) {
    elements.stockEnabled.checked = state.config.gag2Stock.enabled;
    renderChannels();
    renderFilters();
    startFallCountdown();
    renderFall();
    refreshDirty();
  }

  async function loadGuild(guildId) {
    if (!guildId) return;
    state.guildId = guildId;
    elements.guildSelect.value = guildId;
    const guild = state.guilds.find((item) => item.id === guildId);
    elements.serverMeta.textContent = `${state.me?.owner ? 'Owner view' : 'Administrator access'} · ${guild ? guild.id : guildId}`;
    elements.saveButton.disabled = true;
    elements.saveDock.hidden = true;

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

  async function saveStock() {
    if (!state.config || state.saving || snapshot() === state.savedSnapshot) return;
    state.saving = true;
    elements.saveButton.disabled = true;
    elements.saveState.textContent = 'Applying changes…';
    try {
      const stock = clone(state.config.gag2Stock);
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
      if (payload.progress?.status === 'running') state.progressTimer = window.setTimeout(pollProgress, 1100);
    } catch {}
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
    if (target.matches('[data-channel]')) {
      stock.channels[target.dataset.channel] = target.value;
      if (['seed', 'gear', 'crate', 'sell'].includes(target.dataset.channel)) renderFilters();
    }
    if (target.matches('[data-multiplier]')) stock.filters.sellMultipliers = [...document.querySelectorAll('[data-multiplier]:checked')].map((input) => input.value);
    if (target.matches('[data-fall-multiplier]')) stock.fall.sellMultipliers = [...elements.fallRoleFilters.querySelectorAll('[data-fall-multiplier]:checked')].map((input) => input.value);
    if (target.matches('[data-fall-type]')) {
      stock.fall.enabledTypes = [...document.querySelectorAll('[data-fall-type]:checked')].map((input) => input.value);
      renderFall();
    }
    refreshDirty();
  }

  function closeNotificationPickers(exceptMenu = null) {
    for (const menu of document.querySelectorAll('[data-picker-menu]')) {
      if (menu === exceptMenu) continue;
      menu.hidden = true;
      const trigger = menu.closest('.notification-picker')?.querySelector('[data-picker-trigger]');
      trigger?.setAttribute('aria-expanded', 'false');
    }
  }

  function pickerCard(type, scope) {
    return scope === 'fall'
      ? elements.fallRoleFilters.querySelector(`[data-fall-filter-card="${type}"]`)
      : elements.filterGrid.querySelector(`[data-filter-card="${type}"]`);
  }

  function pickerInputSelector(type, scope) {
    if (scope === 'fall') return '[data-fall-filter-item]';
    return type === 'sell' ? '[data-filter-rarity]' : '[data-filter-item]';
  }

  function updateNotificationPickerUi(type, scope = 'garden') {
    const card = pickerCard(type, scope);
    if (!card) return;
    const inputs = [...card.querySelectorAll(pickerInputSelector(type, scope))];
    const selected = inputs.filter((input) => input.checked);
    const summary = card.querySelector('[data-picker-summary]');
    if (summary) {
      const noun = scope === 'garden' && type === 'sell' ? 'rarities' : 'items';
      summary.textContent = selected.length === 0 ? `No ${noun} selected`
        : selected.length === inputs.length ? `All ${inputs.length} ${noun}` : `${selected.length} of ${inputs.length} selected`;
    }
    const allButton = card.querySelector('[data-picker-all]');
    if (allButton) allButton.textContent = inputs.length > 0 && selected.length === inputs.length ? 'Clear all' : 'Select all';
    for (const option of card.querySelectorAll('[data-picker-option]')) {
      option.classList.toggle('selected', Boolean(option.querySelector('input')?.checked));
    }
    for (const button of card.querySelectorAll('[data-picker-group]')) {
      const groupInputs = [...button.closest('.picker-group').querySelectorAll(pickerInputSelector(type, scope))];
      const allInGroup = groupInputs.length > 0 && groupInputs.every((input) => input.checked);
      button.textContent = `${allInGroup ? 'Clear' : 'Select'} ${button.dataset.pickerRarity}`;
    }
  }

  function commitNotificationFilter(type, scope = 'garden') {
    const card = pickerCard(type, scope);
    if (!card || !state.config) return;
    const stock = state.config.gag2Stock;
    if (scope === 'fall') {
      stock.fall.roleItems[type] = [...card.querySelectorAll('[data-fall-filter-item]:checked')].map((input) => input.value);
    } else if (type === 'sell') {
      stock.filters.rarities.sell = [...card.querySelectorAll('[data-filter-rarity]:checked')].map((input) => input.value);
    } else {
      const keys = [...card.querySelectorAll('[data-filter-item]:checked')].map((input) => input.value);
      const selected = new Set(keys);
      stock.filters.roleItems[type] = keys;
      stock.filters.rarities[type] = RARITIES.filter((rarity) => rarity !== 'secret' && (state.catalog.items[type] || [])
        .some((item) => item.rarity === rarity && selected.has(item.key)));
    }
    updateNotificationPickerUi(type, scope);
    refreshDirty();
  }

  function filterNotificationOptions(search) {
    const menu = search.closest('[data-picker-menu]');
    if (!menu) return;
    const query = search.value.trim().toLowerCase();
    for (const option of menu.querySelectorAll('[data-picker-option]')) {
      option.hidden = Boolean(query) && !option.dataset.search.includes(query);
    }
    for (const group of menu.querySelectorAll('.picker-group')) {
      group.hidden = ![...group.querySelectorAll('[data-picker-option]')].some((option) => !option.hidden);
    }
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
      elements.loginStatus.textContent = error.status === 401 ? 'Sign in to open your dashboard.' : error.message;
    }
  }

  elements.guildSelect.addEventListener('change', () => loadGuild(elements.guildSelect.value));
  elements.saveButton.addEventListener('click', saveStock);
  elements.logoutButton.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null);
    location.assign('/admin');
  });
  elements.stockEnabled.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.channelGrid.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.multiplierFilters.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.fallFilters.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.filterGrid.addEventListener('change', (event) => {
    const input = event.target.closest('[data-filter-item], [data-filter-rarity]');
    if (input) commitNotificationFilter(input.dataset.filterItem || input.dataset.filterRarity);
  });
  elements.fallRoleFilters.addEventListener('change', (event) => {
    if (event.target.matches('[data-fall-multiplier]')) {
      updateConfigFromControl(event.target);
      return;
    }
    const input = event.target.closest('[data-fall-filter-item]');
    if (input) commitNotificationFilter(input.dataset.fallFilterItem, 'fall');
  });

  function handlePickerInput(event) {
    const search = event.target.closest('[data-picker-search]');
    if (search) filterNotificationOptions(search);
  }

  function handlePickerClick(event) {
    const trigger = event.target.closest('[data-picker-trigger]');
    if (trigger) {
      const type = trigger.dataset.pickerTrigger;
      const menu = trigger.closest('.notification-picker').querySelector('[data-picker-menu]');
      const willOpen = menu.hidden;
      closeNotificationPickers(menu);
      menu.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', String(willOpen));
      if (willOpen) window.requestAnimationFrame(() => menu.querySelector('[data-picker-search]')?.focus());
      return;
    }
    const allButton = event.target.closest('[data-picker-all]');
    if (allButton) {
      const type = allButton.dataset.pickerAll;
      const scope = allButton.dataset.pickerScope || 'garden';
      const card = pickerCard(type, scope);
      const inputs = [...card.querySelectorAll(pickerInputSelector(type, scope))];
      const shouldSelect = inputs.some((input) => !input.checked);
      for (const input of inputs) input.checked = shouldSelect;
      commitNotificationFilter(type, scope);
      return;
    }
    const groupButton = event.target.closest('[data-picker-group]');
    if (groupButton) {
      const scope = groupButton.dataset.pickerScope || 'garden';
      const type = groupButton.dataset.pickerGroup;
      const inputs = [...groupButton.closest('.picker-group').querySelectorAll(pickerInputSelector(type, scope))];
      const shouldSelect = inputs.some((input) => !input.checked);
      for (const input of inputs) input.checked = shouldSelect;
      commitNotificationFilter(type, scope);
    }
  }

  elements.filterGrid.addEventListener('input', handlePickerInput);
  elements.fallRoleFilters.addEventListener('input', handlePickerInput);
  elements.filterGrid.addEventListener('click', handlePickerClick);
  elements.fallRoleFilters.addEventListener('click', handlePickerClick);
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.notification-picker')) closeNotificationPickers();
  });
  function handlePickerKeydown(event) {
    if (event.key === 'Escape') {
      closeNotificationPickers();
      event.target.closest('.filter-card')?.querySelector('[data-picker-trigger]')?.focus();
    }
  }
  elements.filterGrid.addEventListener('keydown', handlePickerKeydown);
  elements.fallRoleFilters.addEventListener('keydown', handlePickerKeydown);
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
