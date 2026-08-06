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
  const CARD_FONT_FAMILY = '"Segoe UI Emoji", "Segoe UI Symbol", "Noto Sans", "DejaVu Sans", sans-serif';

  const state = {
    me: null,
    csrfToken: '',
    guilds: [],
    guildId: '',
    config: null,
    directory: { channels: [], roles: [], gag2StockPermissions: { usable: true, missing: [] } },
    catalog: { items: {}, fallItems: {}, fallHarvestEndsAt: '' },
    savedSnapshot: '',
    savedConfig: null,
    currentView: 'stock',
    saving: false,
    fallTimer: null,
    progressTimer: null,
    consoleTimer: null,
    metricsTimer: null,
    consolePaused: false,
    consoleEntries: [],
    consoleAfter: 0,
    levelingComposerPanel: '',
    profile: null,
    profileSavedSnapshot: '',
    cardSelection: 'background',
    cardPointer: null,
    cardSaving: false,
    cardExactPreview: null,
    cardExactSnapshot: '',
    cardExactUrl: '',
    cardExactTimer: null,
    cardExactRequest: 0,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const elements = {
    appShell: $('#appShell'), loginPanel: $('#loginPanel'), loginStatus: $('#loginStatus'),
    logoutButton: $('#logoutButton'), accountWrap: $('#accountWrap'), accountMenu: $('#accountMenu'),
    userChip: $('#userChip'), userAvatar: $('#userAvatar'), sessionLabel: $('#sessionLabel'),
    guildSelect: $('#guildSelect'), serverMeta: $('#serverMeta'), ownerNav: $('#ownerNav'), levelingNav: $('#levelingNav'),
    stockView: $('#stockView'), levelingView: $('#levelingView'), ownerView: $('#ownerView'), toast: $('#toast'),
    stockEnabled: $('#stockEnabled'), channelGrid: $('#channelGrid'), filterGrid: $('#filterGrid'),
    multiplierFilters: $('#multiplierFilters'), fallFilters: $('#fallFilters'), fallRoleFilters: $('#fallRoleFilters'),
    fallCountdown: $('#fallCountdown'), fallSection: $('#fallHarvestSection'), saveDock: $('#saveDock'),
    saveButton: $('#saveButton'), resetButton: $('#resetButton'), saveState: $('#saveState'), ownerOverview: $('#ownerOverview'),
    ownerRefresh: $('#ownerRefresh'), consoleOutput: $('#consoleOutput'), consoleClear: $('#consoleClear'),
    consoleToggle: $('#consoleToggle'), dialog: $('#confirmDialog'), dialogTitle: $('#dialogTitle'), dialogCopy: $('#dialogCopy'),
    dialogInputWrap: $('#dialogInputWrap'), dialogInput: $('#dialogInput'), dialogConfirm: $('#dialogConfirm'),
    levelingEnabled: $('#levelingEnabled'), levelingXpMin: $('#levelingXpMin'), levelingXpMax: $('#levelingXpMax'),
    levelingCooldown: $('#levelingCooldown'), levelingBaseXp: $('#levelingBaseXp'), levelingGrowth: $('#levelingGrowth'),
    levelingMaxLevel: $('#levelingMaxLevel'), levelingCurvePreview: $('#levelingCurvePreview'),
    levelingAnnounceEnabled: $('#levelingAnnounceEnabled'), levelingAnnounceChannel: $('#levelingAnnounceChannel'),
    levelingChannels: $('#levelingChannels'),
    levelingStackRewards: $('#levelingStackRewards'), levelingRewards: $('#levelingRewards'),
    levelingAddReward: $('#levelingAddReward'), levelingBoosts: $('#levelingBoosts'), levelingAddBoost: $('#levelingAddBoost'),
    levelingContainerAdd: $('#levelingContainerAdd'), levelingThumbnailAdd: $('#levelingThumbnailAdd'),
    levelingGalleryAdd: $('#levelingGalleryAdd'), levelingVariablesToggle: $('#levelingVariablesToggle'),
    levelingComposerPanel: $('#levelingComposerPanel'),
    levelingDiscordFrame: $('#levelingDiscordFrame'), levelingMessagePreview: $('#levelingMessagePreview'),
    levelingAccentButton: $('#levelingAccentButton'), levelingAccentColor: $('#levelingAccentColor'),
    profileShell: $('#profileShell'), profileAvatar: $('#profileAvatar'), profileName: $('#profileName'),
    cardCanvas: $('#levelCardCanvas'), cardCanvasWrap: $('#cardCanvasWrap'), cardLayerList: $('#cardLayerList'),
    cardInspector: $('#cardInspector'), cardInspectorTitle: $('#cardInspectorTitle'),
    cardBackgroundButton: $('#cardBackgroundButton'), cardImageButton: $('#cardImageButton'), cardTextButton: $('#cardTextButton'),
    cardBackgroundFile: $('#cardBackgroundFile'), cardImageFile: $('#cardImageFile'),
    profileSaveDock: $('#profileSaveDock'), cardSaveButton: $('#cardSaveButton'), cardResetButton: $('#cardResetButton'),
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
    const profileRoute = location.pathname.startsWith('/profile');
    elements.loginPanel.hidden = Boolean(user);
    elements.appShell.hidden = !user || profileRoute;
    elements.profileShell.hidden = !user || !profileRoute;
    elements.logoutButton.hidden = !user;
    elements.accountWrap.hidden = !user;
    elements.ownerNav.hidden = !state.me?.owner;
    if (!user) return;

    elements.sessionLabel.textContent = user.globalName || user.username;
    elements.userAvatar.src = avatarUrl(user);
    elements.userAvatar.alt = `${user.globalName || user.username} avatar`;
    elements.profileAvatar.src = avatarUrl(user).replace('size=64', 'size=256');
    elements.profileAvatar.alt = `${user.globalName || user.username} avatar`;
    elements.profileName.textContent = user.globalName || user.username;
    elements.guildSelect.replaceChildren();
    if (!state.guilds.length) {
      elements.guildSelect.append(new Option('No editable servers', ''));
      elements.guildSelect.disabled = true;
      elements.serverMeta.textContent = 'Administrator access is required to configure a server.';
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

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function normalizeLevelingConfig(config) {
    const source = clone(config?.leveling || {});
    source.enabled = source.enabled === true;
    source.xp ||= {};
    source.xp.min = Math.round(clampNumber(source.xp.min, 1, 1000, 15));
    source.xp.max = Math.round(clampNumber(source.xp.max, source.xp.min, 2000, 25));
    source.xp.cooldownSeconds = Math.round(clampNumber(source.xp.cooldownSeconds, 5, 3600, 60));
    source.curve ||= {};
    source.curve.baseXp = Math.round(clampNumber(source.curve.baseXp, 25, 100000, 100));
    source.curve.growth = clampNumber(source.curve.growth, 1, 3, 1.5);
    source.curve.maxLevel = Math.round(clampNumber(source.curve.maxLevel, 1, 1000, 100));
    source.announcements ||= {};
    source.announcements.enabled = source.announcements.enabled === true;
    source.announcements.channelId = String(source.announcements.channelId || '');
    const legacyTemplate = `## ${String(source.announcements.title || '✦ Level {level} reached')}\n${String(source.announcements.message || 'GG {user}! You reached level {level}.')}\n\n${String(source.announcements.progress || '`{bar}` {progress_xp} / {needed_xp} XP toward level {next_level}')}`;
    source.announcements.template = String(source.announcements.template || legacyTemplate).slice(0, 3000);
    delete source.announcements.title;
    delete source.announcements.message;
    delete source.announcements.progress;
    source.announcements.layout ||= {};
    source.announcements.layout.container = source.announcements.layout.container !== false;
    source.announcements.layout.accentColor = /^#[0-9a-f]{6}$/i.test(source.announcements.layout.accentColor || '')
      ? source.announcements.layout.accentColor.toLowerCase() : '#b9f547';
    source.announcements.layout.thumbnailEnabled = source.announcements.layout.thumbnailEnabled === true;
    source.announcements.layout.thumbnailUrl = String(source.announcements.layout.thumbnailUrl || '').slice(0, 2000);
    source.announcements.layout.galleryUrls = (source.announcements.layout.galleryUrls || []).map(String).slice(0, 10);
    source.channelMultipliers = Object.fromEntries(Object.entries(source.channelMultipliers || {}).map(([id, multiplier]) => [
      String(id), Math.round(clampNumber(multiplier, 0, 10, 1)),
    ]));
    source.roleRewards = (source.roleRewards || []).map((reward) => ({
      level: Math.round(clampNumber(reward.level, 1, source.curve.maxLevel, 1)),
      roleId: String(reward.roleId || ''),
    })).filter((reward) => reward.roleId).sort((a, b) => a.level - b.level).slice(0, 100);
    source.roleBoosts = (source.roleBoosts || []).map((boost) => ({
      roleId: String(boost.roleId || ''),
      multiplier: Math.round(clampNumber(boost.multiplier, 0, 10, 1)),
    })).filter((boost) => boost.roleId).slice(0, 100);
    source.stackRoleRewards = source.stackRoleRewards !== false;
    return source;
  }

  function channelOptions(selected, include = () => true) {
    const options = ['<option value="">Not routed</option>'];
    let lastParent = null;
    for (const channel of state.directory.channels.filter((item) => !item.archived && include(item))) {
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

  function xpThreshold(level) {
    const curve = state.config.leveling.curve;
    return Math.floor(curve.baseXp * Math.pow(Math.max(0, level), curve.growth));
  }

  function renderCurvePreview() {
    const maximum = state.config.leveling.curve.maxLevel;
    const levels = [...new Set([1, 5, 10, 25, maximum].filter((level) => level <= maximum))];
    elements.levelingCurvePreview.innerHTML = `<span>CURVE PREVIEW</span><div>${levels.map((level) => `<article><small>LEVEL ${level}</small><strong>${formatNumber(xpThreshold(level))} XP</strong></article>`).join('')}</div>`;
  }

  function roleOptions(selected) {
    const roles = state.directory.roles || [];
    return ['<option value="">Choose a Discord role</option>', ...roles.map((role) => `<option value="${role.id}" style="color:${roleColor(role.id)}" ${role.id === selected ? 'selected' : ''} ${role.editable === false ? 'disabled' : ''}>\u25cf @${escapeHtml(role.name)}${role.editable === false ? ' (above CoinSprite)' : ''}</option>`)].join('');
  }

  function roleColor(roleId) {
    const color = (state.directory.roles || []).find((role) => role.id === roleId)?.color;
    return /^#[0-9a-f]{6}$/i.test(color || '') ? color : '#99a1a6';
  }

  function renderLevelingChannels() {
    const multipliers = state.config.leveling.channelMultipliers || {};
    const channels = (state.directory.channels || []).filter((channel) => !channel.archived && channel.kind !== 'category');
    elements.levelingChannels.innerHTML = channels.length ? channels.map((channel) => {
      const active = Object.prototype.hasOwnProperty.call(multipliers, channel.id);
      const multiplier = active ? multipliers[channel.id] : 1;
      return `<article class="xp-channel-option${active ? ' selected' : ''}">
        <label class="xp-channel-toggle"><input type="checkbox" data-leveling-channel value="${channel.id}" ${active ? 'checked' : ''}><span><b>#</b><strong>${escapeHtml(channel.name)}</strong><small>${escapeHtml(channel.parentName || 'No category')}</small></span><i aria-hidden="true">${active ? '&#x2713;' : '+'}</i></label>
        <label class="channel-multiplier" ${active ? '' : 'hidden'}><span>Multi:</span><input type="number" min="0" max="10" step="1" value="${multiplier}" data-leveling-channel-multiplier="${channel.id}" aria-label="${escapeHtml(channel.name)} XP multiplier"><b>&times;</b></label>
      </article>`;
    }).join('') : '<p class="empty-state">No eligible text channels found.</p>';
  }

  function renderLevelingRewards() {
    const rewards = state.config.leveling.roleRewards || [];
    elements.levelingRewards.innerHTML = rewards.length ? rewards.map((reward, index) => `<article class="reward-row" style="--role-color:${roleColor(reward.roleId)}">
      <span class="reward-level-mark">LV</span>
      <label><small>Level</small><input type="number" min="1" max="${state.config.leveling.curve.maxLevel}" value="${reward.level}" data-level-reward-level="${index}"></label>
      <label class="reward-role-field"><small><i class="role-color-dot"></i>Discord role</small><select data-level-reward-role="${index}">${roleOptions(reward.roleId)}</select></label>
      <button type="button" class="reward-remove" data-remove-level-reward="${index}" aria-label="Remove level ${reward.level} reward">Remove</button>
    </article>`).join('') : '<div class="empty-state reward-empty"><strong>No role rewards yet</strong><span>Add milestones such as Level 5, 10, and 25.</span></div>';
  }

  function renderLevelingBoosts() {
    const boosts = state.config.leveling.roleBoosts || [];
    elements.levelingBoosts.innerHTML = boosts.length ? boosts.map((boost, index) => `<article class="reward-row boost-row" style="--role-color:${roleColor(boost.roleId)}">
      <span class="reward-level-mark boost-mark">XP</span>
      <label class="reward-role-field"><small><i class="role-color-dot"></i>Discord role</small><select data-level-boost-role="${index}">${roleOptions(boost.roleId)}</select></label>
      <label><small>Multiplier</small><span class="multiplier-input"><b>&times;</b><input type="number" min="0" max="10" step="1" value="${boost.multiplier}" data-level-boost-multiplier="${index}"></span></label>
      <button type="button" class="reward-remove" data-remove-level-boost="${index}" aria-label="Remove role XP boost">Remove</button>
    </article>`).join('') : '<div class="empty-state reward-empty"><strong>No role boosts yet</strong><span>Add a role and choose an XP multiplier from ×0 to ×10.</span></div>';
  }

  function validHttpUrl(value) {
    try { return ['http:', 'https:'].includes(new URL(String(value || '')).protocol); } catch { return false; }
  }

  function validMediaTemplate(value) {
    return String(value || '').trim().toLowerCase() === '{user_profile}' || validHttpUrl(value);
  }

  function previewMediaUrl(value) {
    return String(value || '').trim().toLowerCase() === '{user_profile}'
      ? 'https://cdn.discordapp.com/embed/avatars/0.png'
      : validHttpUrl(value) ? String(value).trim() : '';
  }

  function discordInlineMarkdown(value) {
    const code = [];
    let html = escapeHtml(value).replace(/`([^`\n]+)`/g, (_, content) => {
      code.push(`<code>${content}</code>`);
      return `\uE000${code.length - 1}\uE001`;
    });
    html = html
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<u>$1</u>')
      .replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
      .replace(/\|\|([^|\n]+)\|\|/g, '<span class="discord-spoiler">$1</span>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
      .replace(/_([^_\n]+)_/g, '<em>$1</em>');
    return html.replace(/\uE000(\d+)\uE001/g, (_, index) => code[Number(index)] || '');
  }

  function discordMarkdown(value) {
    return String(value || '').split('\n').map((line) => {
      if (/^###\s/.test(line)) return `<h3>${discordInlineMarkdown(line.slice(4))}</h3>`;
      if (/^##\s/.test(line)) return `<h2>${discordInlineMarkdown(line.slice(3))}</h2>`;
      if (/^#\s/.test(line)) return `<h1>${discordInlineMarkdown(line.slice(2))}</h1>`;
      if (/^>\s?/.test(line)) return `<blockquote>${discordInlineMarkdown(line.replace(/^>\s?/, ''))}</blockquote>`;
      if (/^-\s/.test(line)) return `<div class="discord-list-item">&#8226;<span>${discordInlineMarkdown(line.slice(2))}</span></div>`;
      return line ? `<div class="discord-line">${discordInlineMarkdown(line)}</div>` : '<div class="discord-line"><br></div>';
    }).join('');
  }

  function editorInlineMarkdown(value) {
    const fragments = [];
    const stash = (html) => {
      fragments.push(html);
      return `\uE000${fragments.length - 1}\uE001`;
    };
    let html = escapeHtml(value);
    html = html
      .replace(/`([^`\n]+)`/g, (_, content) => stash(`<span class="markdown-syntax">\`</span><code>${content}</code><span class="markdown-syntax">\`</span>`))
      .replace(/\*\*([^*\n]+)\*\*/g, (_, content) => stash(`<span class="markdown-syntax">**</span><strong>${content}</strong><span class="markdown-syntax">**</span>`))
      .replace(/__([^_\n]+)__/g, (_, content) => stash(`<span class="markdown-syntax">__</span><u>${content}</u><span class="markdown-syntax">__</span>`))
      .replace(/~~([^~\n]+)~~/g, (_, content) => stash(`<span class="markdown-syntax">~~</span><s>${content}</s><span class="markdown-syntax">~~</span>`))
      .replace(/\|\|([^|\n]+)\|\|/g, (_, content) => stash(`<span class="markdown-syntax">||</span><span class="editor-spoiler">${content}</span><span class="markdown-syntax">||</span>`))
      .replace(/\*([^*\n]+)\*/g, (_, content) => stash(`<span class="markdown-syntax">*</span><em>${content}</em><span class="markdown-syntax">*</span>`))
      .replace(/_([^_\n]+)_/g, (_, content) => stash(`<span class="markdown-syntax">_</span><em>${content}</em><span class="markdown-syntax">_</span>`))
      .replace(/\{(?:user|user_profile|username|level|next_level|server|bar|progress_xp|needed_xp|total_xp|separator)\}/gi, (token) => stash(`<span class="editor-token">${token}</span>`));
    return html.replace(/\uE000(\d+)\uE001/g, (_, index) => fragments[Number(index)] || '');
  }

  function editorMarkdown(value) {
    return String(value || '').split('\n').map((line) => {
      const heading = line.match(/^(#{1,3}\s)(.*)$/);
      const quote = line.match(/^(>\s?)(.*)$/);
      const list = line.match(/^(-\s)(.*)$/);
      if (heading) return `<div class="editor-source-line"><span class="markdown-syntax">${escapeHtml(heading[1])}</span><strong>${editorInlineMarkdown(heading[2])}</strong></div>`;
      if (quote) return `<div class="editor-source-line"><span class="markdown-syntax">${escapeHtml(quote[1])}</span>${editorInlineMarkdown(quote[2])}</div>`;
      if (list) return `<div class="editor-source-line"><span class="markdown-syntax">${escapeHtml(list[1])}</span>${editorInlineMarkdown(list[2])}</div>`;
      return `<div class="editor-source-line">${line ? editorInlineMarkdown(line) : '<br>'}</div>`;
    }).join('');
  }

  function previewMessageValue(template) {
    return String(template || '')
      .replaceAll('{user}', '@GardenHero')
      .replaceAll('{user_profile}', 'https://cdn.discordapp.com/embed/avatars/0.png')
      .replaceAll('{username}', 'GardenHero')
      .replaceAll('{level}', '12')
      .replaceAll('{next_level}', '13')
      .replaceAll('{server}', 'Grow a Garden')
      .replaceAll('{bar}', '■■■■■■■■□□□□')
      .replaceAll('{progress_xp}', '280')
      .replaceAll('{needed_xp}', '420')
      .replaceAll('{total_xp}', '3,160');
  }

  function renderedEditableTemplate(template) {
    const preview = previewMessageValue(template);
    return preview.split(/\{separator\}/gi)
      .map((segment, index) => `${index ? '<div class="discord-separator"></div>' : ''}<div class="discord-text">${discordMarkdown(segment)}</div>`)
      .join('');
  }

  function syncInlineEditorVisual(input) {
    const editor = input.closest('[data-inline-message-editor]');
    const mirror = editor?.querySelector('[data-inline-message-highlight]');
    const sourceShell = editor?.querySelector('.inline-message-source-shell');
    const display = editor?.querySelector('[data-inline-message-display]');
    if (!editor || !mirror || !sourceShell || !display) return;
    mirror.innerHTML = editorMarkdown(input.value);
    input.style.height = 'auto';
    const height = Math.min(190, Math.max(54, input.scrollHeight));
    input.style.height = `${height}px`;
    sourceShell.style.height = `${height}px`;
    mirror.style.transform = `translateY(-${input.scrollTop}px)`;
    display.innerHTML = `${renderedEditableTemplate(input.value)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span>`;
  }

  function beginInlineMessageEdit(trigger) {
    const editor = trigger.closest('[data-inline-message-editor]');
    const input = editor?.querySelector('[data-inline-message-input]');
    if (!editor || !input) return;
    editor.classList.add('editing');
    syncInlineEditorVisual(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  function finishInlineMessageEdit(editor) {
    if (!editor?.classList.contains('editing')) return;
    editor.classList.remove('editing');
    const input = editor.querySelector('[data-inline-message-input]');
    const display = editor.querySelector('[data-inline-message-display]');
    if (input && display) display.innerHTML = `${renderedEditableTemplate(input.value)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span>`;
  }

  function inlineTemplateEditor(template) {
    return `<div class="inline-message-editor" data-inline-message-editor data-template-field="template">
      <div class="inline-message-display" data-inline-message-display role="button" tabindex="0" aria-label="Edit level-up message">${renderedEditableTemplate(template)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span></div>
      <div class="inline-message-source-shell">
        <div class="inline-message-highlight" data-inline-message-highlight aria-hidden="true">${editorMarkdown(template)}</div>
        <textarea class="inline-message-input" data-inline-message-input data-inline-template-field="template" maxlength="3000" rows="5" spellcheck="true" aria-label="Level-up message template">${escapeHtml(template)}</textarea>
      </div>
      <div class="inline-message-actions"><span>Markdown and variables update live.</span><button type="button" data-inline-message-done>Done</button></div>
    </div>`;
  }

  const LEVELING_VARIABLES = [
    ['{user}', 'Mention the member'], ['{user_profile}', 'Member profile image URL'],
    ['{username}', 'Member display name'],
    ['{level}', 'New level'], ['{next_level}', 'Next level'],
    ['{server}', 'Server name'], ['{bar}', 'Live XP progress bar'],
    ['{progress_xp}', 'XP earned inside this level'], ['{needed_xp}', 'XP required for the next level'],
    ['{total_xp}', 'Member total XP'], ['{separator}', 'Insert a Discord divider in the message'],
  ];

  function renderComposerPanel() {
    const panel = state.levelingComposerPanel;
    const layout = state.config.leveling.announcements.layout;
    elements.levelingComposerPanel.hidden = !panel;
    elements.levelingComposerPanel.dataset.panel = panel;
    elements.levelingVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.levelingThumbnailAdd.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.levelingGalleryAdd.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validMediaTemplate));
    if (!panel) return;
    if (panel === 'variables') {
      elements.levelingComposerPanel.innerHTML = `<div class="variable-guide">${LEVELING_VARIABLES.map(([token, meaning]) => `<button type="button" data-copy-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.levelingComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {user_profile}, paste an image URL, or upload PNG, JPG, WEBP, or GIF up to 5 MB.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{user_profile} or https://example.com/thumbnail.png" data-leveling-thumbnail-url><label class="media-upload">Upload image<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-leveling-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="{user_profile} or https://example.com/image.png" data-leveling-gallery-url="${index}"><label class="media-upload">Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-leveling-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.levelingComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 images with {user_profile}, a URL, or an upload.</small></div><div><button type="button" data-add-gallery-url>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-leveling-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

  function readMediaFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener('load', () => resolve(String(reader.result || '')));
      reader.addEventListener('error', () => reject(new Error('Could not read that image.')));
      reader.readAsDataURL(file);
    });
  }

  async function uploadLevelingMedia(input) {
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) {
      input.value = '';
      return showToast('Upload a PNG, JPG, WEBP, or GIF image.', 'error');
    }
    if (file.size > 5 * 1024 * 1024) {
      input.value = '';
      return showToast('Images must be 5 MB or smaller.', 'error');
    }
    const label = input.closest('.media-upload');
    label?.classList.add('uploading');
    try {
      const dataUrl = await readMediaFile(file);
      const result = await api(`/api/guilds/${state.guildId}/leveling-media`, {
        method: 'POST',
        body: JSON.stringify({ dataUrl }),
      });
      const layout = state.config.leveling.announcements.layout;
      if (input.dataset.levelingMediaUpload === 'thumbnail') {
        layout.thumbnailUrl = result.url;
        layout.thumbnailEnabled = true;
      } else {
        const index = Number(input.dataset.mediaIndex);
        if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url;
        else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url);
      }
      renderMessagePreview();
      refreshDirty();
      showToast('Image uploaded. Apply changes when you are ready.');
    } catch (error) {
      showToast(error.message || 'Image upload failed.', 'error');
    } finally {
      label?.classList.remove('uploading');
      input.value = '';
    }
  }

  function toggleComposerPanel(panel) {
    state.levelingComposerPanel = state.levelingComposerPanel === panel ? '' : panel;
    renderComposerPanel();
  }

  function renderMessagePreview(renderTools = true) {
    const announcements = state.config.leveling.announcements;
    const layout = announcements.layout;
    const text = inlineTemplateEditor(announcements.template);
    const thumbnail = layout.thumbnailEnabled
      ? previewMediaUrl(layout.thumbnailUrl) ? `<img class="discord-thumbnail" src="${escapeHtml(previewMediaUrl(layout.thumbnailUrl))}" alt="Message thumbnail">` : '<div class="discord-thumbnail placeholder">IMG</div>'
      : '';
    const gallery = layout.galleryUrls.map(previewMediaUrl).filter(Boolean);
    const galleryHtml = gallery.length ? `<div class="discord-gallery">${gallery.map((url) => `<img src="${escapeHtml(url)}" alt="Gallery preview">`).join('')}</div>` : '';
    elements.levelingDiscordFrame.classList.toggle('has-container', layout.container);
    elements.levelingDiscordFrame.classList.toggle('no-container', !layout.container);
    elements.levelingDiscordFrame.style.setProperty('--accent-color', layout.accentColor);
    elements.levelingAccentButton.hidden = !layout.container;
    elements.levelingAccentColor.value = layout.accentColor;
    elements.levelingContainerAdd.classList.toggle('active', layout.container);
    elements.levelingContainerAdd.textContent = layout.container ? 'Container on' : 'Container off';
    elements.levelingMessagePreview.innerHTML = `<div class="discord-section"><div>${text}</div>${thumbnail}</div>${galleryHtml}`;
    if (renderTools) renderComposerPanel();
  }

  function renderLeveling() {
    const leveling = state.config.leveling;
    elements.levelingEnabled.checked = leveling.enabled;
    elements.levelingXpMin.value = leveling.xp.min;
    elements.levelingXpMax.value = leveling.xp.max;
    elements.levelingCooldown.value = leveling.xp.cooldownSeconds;
    elements.levelingBaseXp.value = leveling.curve.baseXp;
    elements.levelingGrowth.value = leveling.curve.growth;
    elements.levelingMaxLevel.value = leveling.curve.maxLevel;
    elements.levelingAnnounceEnabled.checked = leveling.announcements.enabled;
    elements.levelingAnnounceChannel.innerHTML = channelOptions(leveling.announcements.channelId, (channel) => channel.kind !== 'forum');
    elements.levelingAnnounceChannel.options[0].textContent = 'Use the channel where XP was earned';
    elements.levelingStackRewards.checked = leveling.stackRoleRewards;
    renderCurvePreview();
    renderLevelingChannels();
    renderLevelingRewards();
    renderLevelingBoosts();
    renderMessagePreview();
    refreshDirty();
  }

  function renderFeatureAccess() {
    if (!state.config) return;
    const unlocked = state.config.features?.leveling === true;
    elements.levelingNav.disabled = !unlocked;
    elements.levelingNav.classList.toggle('is-locked', !unlocked);
    const label = elements.levelingNav.querySelector('small');
    if (label) label.textContent = unlocked ? 'XP & rewards' : 'Locked by owner';
    elements.levelingNav.title = unlocked ? '' : 'The bot owner must unlock Leveling for this server.';
    if (!unlocked && state.currentView === 'leveling') setView('stock');
  }

  function snapshot() {
    if (!state.config) return '';
    const stock = state.config.gag2Stock;
    return JSON.stringify({
      gag2Stock: {
        enabled: stock.enabled,
        channels: stock.channels,
        rarities: stock.filters.rarities,
        roleItems: stock.filters.roleItems,
        sellMultipliers: stock.filters.sellMultipliers,
        fallTypes: stock.fall.enabledTypes,
        fallRoleItems: stock.fall.roleItems,
        fallSellMultipliers: stock.fall.sellMultipliers,
      },
      leveling: state.config.leveling,
    });
  }

  function refreshDirty() {
    const dirty = snapshot() !== state.savedSnapshot;
    elements.saveDock.hidden = !dirty && !state.saving;
    elements.saveState.textContent = state.saving ? 'Applying changes…' : 'Unsaved changes';
    elements.saveButton.disabled = !dirty || state.saving;
    elements.resetButton.disabled = !dirty || state.saving;
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
      state.directory = { channels: [], roles: [], ...directoryPayload.directory };
      state.catalog = catalogPayload;
      state.config = {
        ...configPayload.config,
        gag2Stock: normalizeStockConfig(configPayload.config),
        leveling: normalizeLevelingConfig(configPayload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      renderFeatureAccess();
      renderStock(progressPayload?.progress);
      renderLeveling();
      if (progressPayload?.progress?.status === 'running') pollProgress();
    } catch (error) {
      showToast(error.message, 'error');
      elements.serverMeta.textContent = `Could not load this community: ${error.message}`;
    }
  }

  async function saveConfig() {
    if (!state.config || state.saving || snapshot() === state.savedSnapshot) return;
    state.saving = true;
    elements.saveButton.disabled = true;
    elements.resetButton.disabled = true;
    elements.saveState.textContent = 'Applying changes…';
    try {
      const stock = clone(state.config.gag2Stock);
      const leveling = clone(state.config.leveling);
      const body = { gag2Stock: stock };
      if (state.config.features?.leveling === true) body.leveling = leveling;
      const payload = await api(`/api/guilds/${state.guildId}/config`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      state.config = {
        ...payload.config,
        gag2Stock: normalizeStockConfig(payload.config),
        leveling: normalizeLevelingConfig(payload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      renderFeatureAccess();
      renderStock(payload.progress);
      renderLeveling();
      showToast('Dashboard settings updated.');
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
      ['ping', 'Bot ping', `${formatNumber(payload.bot.pingMs)} ms`, 'Discord gateway'],
      ['uptime', 'Uptime', formatUptime(payload.bot.uptimeMs), payload.bot.tag],
      ['communities', 'Communities', formatNumber(payload.bot.guildCount), `${formatNumber(payload.bot.totalUsers)} members`],
      ['heap', 'Heap', payload.bot.memory.heapUsedLabel, 'Live process usage'],
      ['storage', 'Storage', payload.storage.label, 'Live data and logs'],
    ];
    const rows = (payload.guilds || []).map((guild) => `<tr>
      <td><div class="guild-cell">${guildIcon(guild)}<span><strong>${escapeHtml(guild.name)}</strong><small>${guild.id}</small></span></div></td>
      <td>${formatNumber(guild.totalUsers)}</td>
      <td><span class="status-pill ${guild.enabled ? '' : 'off'}">${guild.enabled ? 'Online' : 'Disabled'}</span></td>
      <td>${guild.stock.configuredChannels}/${guild.stock.totalChannels}</td>
      <td>${guild.stock.rolesSyncedAt ? new Date(guild.stock.rolesSyncedAt).toLocaleDateString() : 'Not yet'}</td>
      <td><details class="feature-dropdown"><summary>${guild.features?.leveling ? '2 features' : 'GAG Stock only'}</summary><div>
        <label><input type="checkbox" checked disabled><span><strong>GAG2 Stock</strong><small>Always unlocked</small></span></label>
        <label><input type="checkbox" data-owner-feature="leveling" data-guild-id="${guild.id}" ${guild.features?.leveling ? 'checked' : ''}><span><strong>Leveling</strong><small>${guild.features?.leveling ? 'Unlocked' : 'Locked'}</small></span></label>
      </div></details></td>
      <td><div class="row-actions"><button class="text-button" type="button" data-owner-load="${guild.id}">Open</button><button class="text-button" type="button" data-owner-toggle="${guild.id}" data-enabled="${guild.enabled}">${guild.enabled ? 'Disable' : 'Enable'}</button></div></td>
    </tr>`).join('');
    elements.ownerOverview.innerHTML = `
      <section class="metric-grid">${metrics.map(([key, label, value, detail]) => `<article class="metric-card"><small>${label}</small><strong data-owner-metric="${key}">${escapeHtml(value)}</strong><span>${escapeHtml(detail)}</span></article>`).join('')}</section>
      <section class="fleet-panel"><header class="fleet-head"><h2>Community fleet</h2><span>${payload.guilds.length} connected</span></header><div class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th>Community</th><th>Members</th><th>Status</th><th>Routes</th><th>Role sync</th><th>Feature access</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No communities available.</td></tr>'}</tbody></table></div></section>`;
  }

  async function pollOwnerMetrics() {
    if (state.currentView !== 'owner') return;
    const payload = await api('/api/owner/metrics');
    const heap = elements.ownerOverview.querySelector('[data-owner-metric="heap"]');
    const storage = elements.ownerOverview.querySelector('[data-owner-metric="storage"]');
    if (heap) heap.textContent = payload.heap.label;
    if (storage) storage.textContent = payload.storage.label;
  }

  function startOwnerMetricPolling() {
    window.clearInterval(state.metricsTimer);
    pollOwnerMetrics().catch(() => null);
    state.metricsTimer = window.setInterval(() => pollOwnerMetrics().catch(() => null), 2000);
  }

  function stopOwnerMetricPolling() {
    window.clearInterval(state.metricsTimer);
    state.metricsTimer = null;
  }

  async function loadOwner() {
    if (!state.me?.owner) return;
    elements.ownerOverview.innerHTML = '<section class="metric-card"><small>OWNER PANEL</small><strong>Loading…</strong></section>';
    try {
      renderOwnerOverview(await api('/api/owner/overview'));
      await pollConsole(true);
      startConsolePolling();
      startOwnerMetricPolling();
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
    if (view === 'leveling' && state.config?.features?.leveling !== true) {
      showToast('Leveling is locked for this server. The bot owner can unlock it from Fleet control.', 'error');
      return;
    }
    state.currentView = view;
    document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
    document.querySelectorAll('[data-view-panel]').forEach((panel) => {
      const active = panel.dataset.viewPanel === view;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    if (view === 'owner') loadOwner();
    else {
      stopConsolePolling();
      stopOwnerMetricPolling();
    }
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

  function updateLevelingFromControl(target) {
    if (!state.config) return;
    const leveling = state.config.leveling;
    if (target.matches('[data-inline-message-input]')) {
      const field = target.dataset.inlineTemplateField;
      const limits = { template: 3000 };
      if (limits[field]) leveling.announcements[field] = target.value.slice(0, limits[field]);
      syncInlineEditorVisual(target);
      refreshDirty();
      return;
    }
    if (target === elements.levelingEnabled) leveling.enabled = target.checked;
    if (target === elements.levelingXpMin) {
      leveling.xp.min = Math.round(clampNumber(target.value, 1, 1000, 15));
      leveling.xp.max = Math.max(leveling.xp.min, leveling.xp.max);
      elements.levelingXpMax.value = leveling.xp.max;
    }
    if (target === elements.levelingXpMax) leveling.xp.max = Math.round(clampNumber(target.value, leveling.xp.min, 2000, 25));
    if (target === elements.levelingCooldown) leveling.xp.cooldownSeconds = Math.round(clampNumber(target.value, 5, 3600, 60));
    if (target === elements.levelingBaseXp) leveling.curve.baseXp = Math.round(clampNumber(target.value, 25, 100000, 100));
    if (target === elements.levelingGrowth) leveling.curve.growth = clampNumber(target.value, 1, 3, 1.5);
    if (target === elements.levelingMaxLevel) {
      leveling.curve.maxLevel = Math.round(clampNumber(target.value, 1, 1000, 100));
      for (const reward of leveling.roleRewards) reward.level = Math.min(reward.level, leveling.curve.maxLevel);
      renderLevelingRewards();
    }
    if ([elements.levelingBaseXp, elements.levelingGrowth, elements.levelingMaxLevel].includes(target)) renderCurvePreview();
    if (target === elements.levelingAnnounceEnabled) leveling.announcements.enabled = target.checked;
    if (target === elements.levelingAnnounceChannel) leveling.announcements.channelId = target.value;
    if (target.matches('[data-leveling-thumbnail-url]')) {
      leveling.announcements.layout.thumbnailUrl = target.value.slice(0, 2000);
      leveling.announcements.layout.thumbnailEnabled = validMediaTemplate(target.value);
      renderMessagePreview(false);
    }
    if (target === elements.levelingAccentColor) {
      leveling.announcements.layout.accentColor = target.value;
      renderMessagePreview();
    }
    if (target === elements.levelingStackRewards) leveling.stackRoleRewards = target.checked;
    if (target.matches('[data-leveling-channel]')) {
      if (target.checked) leveling.channelMultipliers[target.value] = 1;
      else delete leveling.channelMultipliers[target.value];
      renderLevelingChannels();
    }
    if (target.matches('[data-leveling-channel-multiplier]')) {
      leveling.channelMultipliers[target.dataset.levelingChannelMultiplier] = Math.round(clampNumber(target.value, 0, 10, 1));
    }
    if (target.matches('[data-leveling-gallery-url]')) {
      leveling.announcements.layout.galleryUrls[Number(target.dataset.levelingGalleryUrl)] = target.value.slice(0, 2000);
      renderMessagePreview(false);
    }
    if (target.matches('[data-level-reward-level]')) {
      const reward = leveling.roleRewards[Number(target.dataset.levelRewardLevel)];
      if (reward) reward.level = Math.round(clampNumber(target.value, 1, leveling.curve.maxLevel, reward.level));
    }
    if (target.matches('[data-level-reward-role]')) {
      const reward = leveling.roleRewards[Number(target.dataset.levelRewardRole)];
      if (reward) reward.roleId = target.value;
      target.closest('.reward-row')?.style.setProperty('--role-color', roleColor(target.value));
    }
    if (target.matches('[data-level-boost-role]')) {
      const boost = leveling.roleBoosts[Number(target.dataset.levelBoostRole)];
      if (boost) boost.roleId = target.value;
      target.closest('.reward-row')?.style.setProperty('--role-color', roleColor(target.value));
    }
    if (target.matches('[data-level-boost-multiplier]')) {
      const boost = leveling.roleBoosts[Number(target.dataset.levelBoostMultiplier)];
      if (boost) boost.multiplier = Math.round(clampNumber(target.value, 0, 10, 1));
    }
    refreshDirty();
  }

  function addLevelReward() {
    if (!state.config || state.config.leveling.roleRewards.length >= 100) return;
    const rewards = state.config.leveling.roleRewards;
    const lastLevel = rewards.length ? Math.max(...rewards.map((reward) => reward.level)) : 0;
    const firstRole = (state.directory.roles || []).find((role) => role.editable !== false);
    rewards.push({ level: Math.min(state.config.leveling.curve.maxLevel, lastLevel + 5 || 5), roleId: firstRole?.id || '' });
    renderLevelingRewards();
    refreshDirty();
    elements.levelingRewards.lastElementChild?.querySelector('input')?.focus();
  }

  function addLevelBoost() {
    if (!state.config || state.config.leveling.roleBoosts.length >= 100) return;
    const firstUnused = (state.directory.roles || []).find((role) => role.editable !== false
      && !state.config.leveling.roleBoosts.some((boost) => boost.roleId === role.id));
    state.config.leveling.roleBoosts.push({ roleId: firstUnused?.id || '', multiplier: 2 });
    renderLevelingBoosts();
    refreshDirty();
  }

  function resetUnsavedChanges() {
    if (!state.savedConfig || state.saving) return;
    state.config = clone(state.savedConfig);
    renderFeatureAccess();
    renderStock();
    renderLeveling();
    showToast('Unsaved changes reset.');
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

  const cardImages = new Map();
  let cardFrame = 0;

  function cardSnapshot() {
    return state.profile ? JSON.stringify(state.profile.design) : '';
  }

  function cardImage(url) {
    if (!url) return null;
    if (cardImages.has(url)) return cardImages.get(url).ready ? cardImages.get(url).image : null;
    const entry = { image: new Image(), ready: false };
    cardImages.set(url, entry);
    entry.image.crossOrigin = 'anonymous';
    entry.image.addEventListener('load', () => { entry.ready = true; scheduleCardDraw(false); });
    entry.image.addEventListener('error', () => { entry.failed = true; });
    entry.image.src = url;
    return null;
  }

  function cardRoundRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.roundRect(x, y, width, height, Math.min(radius, width / 2, height / 2));
  }

  function drawCardCover(context, image, x, y, width, height, offsetX = 0, offsetY = 0, scale = 1) {
    const base = Math.max(width / image.naturalWidth, height / image.naturalHeight) * scale;
    const drawWidth = image.naturalWidth * base;
    const drawHeight = image.naturalHeight * base;
    context.drawImage(image, x + (width - drawWidth) / 2 + offsetX, y + (height - drawHeight) / 2 + offsetY, drawWidth, drawHeight);
  }

  function cardLayerBySelection(selection = state.cardSelection) {
    if (!selection.startsWith('layer:')) return null;
    return state.profile?.design.layers.find((layer) => layer.id === selection.slice(6)) || null;
  }

  function cardSelectionObject(selection = state.cardSelection) {
    if (!state.profile) return null;
    return cardLayerBySelection(selection) || state.profile.design[selection] || null;
  }

  function cardBounds(selection = state.cardSelection, context = elements.cardCanvas.getContext('2d')) {
    if (!state.profile) return null;
    const design = state.profile.design;
    const layer = cardLayerBySelection(selection);
    if (selection === 'background') return { x: 0, y: 0, width: 1000, height: 320, resize: false };
    if (layer) {
      if (layer.type === 'text') {
        context.font = `${layer.weight} ${layer.size}px ${CARD_FONT_FAMILY}`;
        return { x: layer.x, y: layer.y, width: Math.max(40, context.measureText(layer.text).width), height: layer.size * 1.25, resize: true };
      }
      return { x: layer.x, y: layer.y, width: layer.width, height: layer.height, resize: true };
    }
    if (selection === 'avatar') return { x: design.avatar.x, y: design.avatar.y, width: design.avatar.size, height: design.avatar.size, resize: true };
    if (selection === 'progress') return { x: design.progress.x, y: design.progress.y, width: design.progress.width, height: design.progress.height, resize: true };
    const widths = { username: 390, level: 210, rank: 120, xp: 330 };
    const item = design[selection];
    if (!item) return null;
    return { x: selection === 'rank' ? item.x - widths.rank : item.x, y: item.y, width: widths[selection], height: item.size * 1.25, resize: true };
  }

  function scheduleExactCardPreview() {
    window.clearTimeout(state.cardExactTimer);
    if (!state.profile || elements.profileShell.hidden) return;
    const snapshot = cardSnapshot();
    state.cardExactTimer = window.setTimeout(async () => {
      const request = ++state.cardExactRequest;
      try {
        const response = await fetch('/api/profile/card/preview', {
          method: 'POST',
          credentials: 'same-origin',
          headers: {
            Accept: 'image/png',
            'Content-Type': 'application/json',
            'X-CSRF-Token': state.csrfToken,
          },
          body: JSON.stringify({ design: state.profile.design }),
        });
        if (!response.ok) return;
        const url = URL.createObjectURL(await response.blob());
        const image = new Image();
        image.addEventListener('load', () => {
          if (request !== state.cardExactRequest || snapshot !== cardSnapshot()) {
            URL.revokeObjectURL(url);
            return;
          }
          if (state.cardExactUrl) URL.revokeObjectURL(state.cardExactUrl);
          state.cardExactPreview = image;
          state.cardExactSnapshot = snapshot;
          state.cardExactUrl = url;
          scheduleCardDraw(false);
        }, { once: true });
        image.addEventListener('error', () => URL.revokeObjectURL(url), { once: true });
        image.src = url;
      } catch {}
    }, 160);
  }

  function scheduleCardDraw(refreshExact = true) {
    window.cancelAnimationFrame(cardFrame);
    cardFrame = window.requestAnimationFrame(drawCardPreview);
    if (refreshExact) scheduleExactCardPreview();
  }

  function drawCardPreview() {
    if (!state.profile || elements.profileShell.hidden) return;
    const { design, preview } = state.profile;
    const canvas = elements.cardCanvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    const exact = state.cardExactSnapshot === cardSnapshot() ? state.cardExactPreview : null;
    if (exact) context.drawImage(exact, 0, 0, 1000, 320);
    else {
      context.save();
      cardRoundRect(context, 0, 0, 1000, 320, 30);
      context.clip();
      context.fillStyle = design.background.color;
      context.fillRect(0, 0, 1000, 320);
      const background = cardImage(design.background.imageUrl);
      if (background) drawCardCover(context, background, 0, 0, 1000, 320, design.background.x, design.background.y, design.background.scale);
      context.globalAlpha = Number.isFinite(Number(design.panelOpacity)) ? Math.max(0, Math.min(1, Number(design.panelOpacity))) : .85;
      context.fillStyle = design.colors.surface;
      cardRoundRect(context, 28, 28, 944, 264, 24);
      context.fill();
      context.globalAlpha = 1;

      context.save();
      context.fillStyle = design.avatar.color;
      cardRoundRect(context, design.avatar.x - 5, design.avatar.y - 5, design.avatar.size + 10, design.avatar.size + 10, design.avatar.size / 2);
      context.fill();
      cardRoundRect(context, design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size, design.avatar.size / 2);
      context.clip();
      const avatar = cardImage(preview.avatarUrl);
      if (avatar) context.drawImage(avatar, design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size);
      else {
        context.fillStyle = design.colors.track;
        context.fillRect(design.avatar.x, design.avatar.y, design.avatar.size, design.avatar.size);
      }
      context.restore();

      context.textBaseline = 'top';
      context.textAlign = 'left';
      context.fillStyle = design.username.color;
      const previewName = String(preview.username || 'Member').normalize('NFKC').replace(/^\*\*([\s\S]+)\*\*$/u, '$1');
      let previewNameSize = design.username.size;
      const previewNameWidth = Math.max(120, design.rank.x - design.username.x - 145);
      context.font = `bold ${previewNameSize}px ${CARD_FONT_FAMILY}`;
      while (previewNameSize > 16 && context.measureText(previewName).width > previewNameWidth) {
        previewNameSize -= 1;
        context.font = `bold ${previewNameSize}px ${CARD_FONT_FAMILY}`;
      }
      context.fillText(previewName, design.username.x, design.username.y);
      context.fillStyle = design.level.color;
      context.font = `bold ${design.level.size}px ${CARD_FONT_FAMILY}`;
      context.fillText(`LEVEL ${formatNumber(preview.level)}`, design.level.x, design.level.y);
      context.textAlign = 'right';
      context.fillStyle = design.rank.color;
      context.font = `bold ${design.rank.size}px ${CARD_FONT_FAMILY}`;
      context.fillText(`#${formatNumber(preview.rank)}`, design.rank.x, design.rank.y);

      context.fillStyle = design.progress.trackColor;
      cardRoundRect(context, design.progress.x, design.progress.y, design.progress.width, design.progress.height, design.progress.height / 2);
      context.fill();
      const progressWidth = design.progress.width * Math.max(0, Math.min(1, Number(preview.progressRatio) || 0));
      if (progressWidth) {
        context.fillStyle = design.progress.color;
        cardRoundRect(context, design.progress.x, design.progress.y, progressWidth, design.progress.height, design.progress.height / 2);
        context.fill();
      }
      context.textAlign = 'left';
      context.fillStyle = design.xp.color;
      context.font = `${design.xp.size}px ${CARD_FONT_FAMILY}`;
      context.fillText(`${formatNumber(preview.progressXp)} / ${formatNumber(preview.neededXp)} XP`, design.xp.x, design.xp.y);

      for (const layer of design.layers) {
        if (layer.type === 'image') {
          const image = cardImage(layer.imageUrl);
          if (image) context.drawImage(image, layer.x, layer.y, layer.width, layer.height);
        } else {
          context.textAlign = 'left';
          context.fillStyle = layer.color;
          context.font = `${layer.weight} ${layer.size}px ${CARD_FONT_FAMILY}`;
          context.fillText(layer.text, layer.x, layer.y);
        }
      }
      context.restore();
    }

    const bounds = cardBounds(state.cardSelection, context);
    if (bounds) {
      context.save();
      context.strokeStyle = '#b9f547';
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      context.strokeRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6);
      context.setLineDash([]);
      if (bounds.resize) {
        context.fillStyle = '#b9f547';
        context.fillRect(bounds.x + bounds.width - 7, bounds.y + bounds.height - 7, 14, 14);
        context.strokeStyle = '#0b0f0d';
        context.lineWidth = 2;
        context.strokeRect(bounds.x + bounds.width - 7, bounds.y + bounds.height - 7, 14, 14);
      }
      context.restore();
    }
  }

  const CARD_BUILTINS = [
    ['background', 'BG', 'Background'], ['avatar', 'AV', 'Discord profile'], ['username', 'Aa', 'Username'],
    ['level', 'LV', 'Level'], ['rank', '#', 'Rank'], ['progress', '==', 'Progress bar'], ['xp', 'XP', 'XP amount'],
  ];

  function renderCardLayers() {
    if (!state.profile) return;
    const builtins = CARD_BUILTINS.map(([key, icon, label]) => `<button class="layer-button${state.cardSelection === key ? ' active' : ''}" type="button" data-card-selection="${key}"><i>${icon}</i><span>${label}</span></button>`).join('');
    const layers = state.profile.design.layers.map((layer) => {
      const selection = `layer:${layer.id}`;
      const label = layer.type === 'text' ? layer.text : 'Uploaded image';
      return `<button class="layer-button${state.cardSelection === selection ? ' active' : ''}" type="button" data-card-selection="${escapeHtml(selection)}"><i>${layer.type === 'text' ? 'Aa' : 'IMG'}</i><span>${escapeHtml(label)}</span></button>`;
    }).join('');
    elements.cardLayerList.innerHTML = builtins + layers;
  }

  function inspectorInput(label, path, value, options = {}) {
    const wide = options.wide ? ' wide' : '';
    const type = options.type || 'number';
    const attributes = type === 'number' ? ` min="${options.min ?? -1000}" max="${options.max ?? 1000}" step="${options.step ?? 1}"` : '';
    if (type === 'textarea') return `<label class="${wide.trim()}">${label}<textarea maxlength="120" data-card-field="${path}">${escapeHtml(value)}</textarea></label>`;
    return `<label class="${wide.trim()}">${label}<input type="${type}" value="${escapeHtml(value)}" data-card-field="${path}"${attributes}></label>`;
  }

  function renderCardInspector() {
    if (!state.profile) return;
    const selection = state.cardSelection;
    const layer = cardLayerBySelection(selection);
    const item = layer || state.profile.design[selection];
    const title = layer ? (layer.type === 'text' ? 'Text layer' : 'Image layer') : (CARD_BUILTINS.find(([key]) => key === selection)?.[2] || 'Element');
    elements.cardInspectorTitle.textContent = title;
    let fields = '';
    if (selection === 'background') {
      fields = inspectorInput('Card color', 'background.color', item.color, { type: 'color' })
        + inspectorInput('Panel color', 'colors.surface', state.profile.design.colors.surface, { type: 'color' })
        + inspectorInput('Panel opacity', 'panelOpacity', state.profile.design.panelOpacity ?? .85, { min: 0, max: 1, step: .05, wide: true })
        + inspectorInput('Image X', 'background.x', item.x, { min: -1000, max: 1000 })
        + inspectorInput('Image Y', 'background.y', item.y, { min: -320, max: 320 })
        + inspectorInput('Image scale', 'background.scale', item.scale, { min: .25, max: 5, step: .05, wide: true });
    } else if (selection === 'avatar') {
      fields = inspectorInput('X', 'avatar.x', item.x, { min: 0, max: 950 }) + inspectorInput('Y', 'avatar.y', item.y, { min: 0, max: 270 })
        + inspectorInput('Size', 'avatar.size', item.size, { min: 32, max: 240 }) + inspectorInput('Ring color', 'avatar.color', item.color, { type: 'color' });
    } else if (selection === 'progress') {
      fields = inspectorInput('X', 'progress.x', item.x) + inspectorInput('Y', 'progress.y', item.y)
        + inspectorInput('Width', 'progress.width', item.width, { min: 40, max: 950 }) + inspectorInput('Height', 'progress.height', item.height, { min: 6, max: 70 })
        + inspectorInput('Bar color', 'progress.color', item.color, { type: 'color' }) + inspectorInput('Track color', 'progress.trackColor', item.trackColor, { type: 'color' });
    } else if (layer?.type === 'image') {
      fields = inspectorInput('X', `layers.${layer.id}.x`, layer.x) + inspectorInput('Y', `layers.${layer.id}.y`, layer.y)
        + inspectorInput('Width', `layers.${layer.id}.width`, layer.width, { min: 12, max: 800 }) + inspectorInput('Height', `layers.${layer.id}.height`, layer.height, { min: 12, max: 320 })
        + '<div class="inspector-divider"></div><button class="inspector-delete" type="button" data-delete-card-layer>Delete image</button>';
    } else if (layer?.type === 'text') {
      fields = inspectorInput('Text', `layers.${layer.id}.text`, layer.text, { type: 'textarea', wide: true })
        + inspectorInput('X', `layers.${layer.id}.x`, layer.x) + inspectorInput('Y', `layers.${layer.id}.y`, layer.y)
        + inspectorInput('Font size', `layers.${layer.id}.size`, layer.size, { min: 10, max: 96 }) + inspectorInput('Color', `layers.${layer.id}.color`, layer.color, { type: 'color' })
        + '<div class="inspector-divider"></div><button class="inspector-delete" type="button" data-delete-card-layer>Delete text</button>';
    } else {
      fields = inspectorInput('X', `${selection}.x`, item.x) + inspectorInput('Y', `${selection}.y`, item.y)
        + inspectorInput('Font size', `${selection}.size`, item.size, { min: 12, max: 80 }) + inspectorInput('Color', `${selection}.color`, item.color, { type: 'color' });
    }
    elements.cardInspector.innerHTML = `<div class="inspector-fields">${fields}</div>`;
  }

  function setCardField(path, value) {
    const parts = path.split('.');
    let target = state.profile.design;
    if (parts[0] === 'layers') {
      target = state.profile.design.layers.find((layer) => layer.id === parts[1]);
      parts.splice(0, 2);
    }
    if (!target) return;
    while (parts.length > 1) target = target[parts.shift()];
    const key = parts[0];
    target[key] = typeof target[key] === 'number' ? Number(value) : value;
  }

  function getCardField(path) {
    const parts = path.split('.');
    let target = state.profile.design;
    if (parts[0] === 'layers') {
      target = state.profile.design.layers.find((layer) => layer.id === parts[1]);
      parts.splice(0, 2);
    }
    while (target && parts.length) target = target[parts.shift()];
    return target;
  }

  function constrainCardSelection(selection = state.cardSelection) {
    if (!state.profile) return;
    const limit = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, Number(value) || 0));
    if (selection === 'background') {
      state.profile.design.panelOpacity = limit(state.profile.design.panelOpacity ?? .85, 0, 1);
      state.profile.design.background.x = limit(state.profile.design.background.x, -1000, 1000);
      state.profile.design.background.y = limit(state.profile.design.background.y, -320, 320);
      state.profile.design.background.scale = limit(state.profile.design.background.scale, .25, 5);
      return;
    }
    const target = cardSelectionObject(selection);
    if (!target) return;
    const layer = cardLayerBySelection(selection);
    if (selection === 'avatar') {
      target.size = limit(target.size, 32, 240);
      target.x = limit(target.x, 0, 1000 - target.size);
      target.y = limit(target.y, 0, 320 - target.size);
      return;
    }
    if (selection === 'progress') {
      target.width = limit(target.width, 40, 1000);
      target.height = limit(target.height, 6, 70);
      target.x = limit(target.x, 0, 1000 - target.width);
      target.y = limit(target.y, 0, 320 - target.height);
      return;
    }
    if (layer) {
      if (layer.type === 'text') {
        layer.size = limit(layer.size, 10, 96);
        const context = elements.cardCanvas.getContext('2d');
        context.font = `${layer.weight} ${layer.size}px ${CARD_FONT_FAMILY}`;
        layer.width = Math.min(1000, Math.max(12, Math.ceil(context.measureText(layer.text || 'Text').width)));
        layer.height = Math.min(320, Math.max(12, Math.ceil(layer.size * 1.25)));
      } else {
        layer.width = limit(layer.width, 12, 1000);
        layer.height = limit(layer.height, 12, 320);
      }
      layer.x = limit(layer.x, 0, 1000 - layer.width);
      layer.y = limit(layer.y, 0, 320 - layer.height);
      return;
    }
    const bounds = cardBounds(selection);
    if (!bounds) return;
    target.size = limit(target.size, 12, 80);
    target.y = limit(target.y, 0, 320 - bounds.height);
    target.x = selection === 'rank'
      ? limit(target.x, bounds.width, 1000)
      : limit(target.x, 0, 1000 - bounds.width);
  }

  function refreshCardDirty() {
    const dirty = cardSnapshot() !== state.profileSavedSnapshot;
    elements.profileSaveDock.hidden = !dirty && !state.cardSaving;
    elements.cardSaveButton.disabled = !dirty || state.cardSaving;
    elements.cardResetButton.disabled = !dirty || state.cardSaving;
  }

  function renderCardStudio() {
    renderCardLayers();
    renderCardInspector();
    refreshCardDirty();
    scheduleCardDraw();
  }

  async function loadProfile() {
    try {
      state.profile = await api('/api/profile/card');
      state.profileSavedSnapshot = cardSnapshot();
      state.cardSelection = 'background';
      renderCardStudio();
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function saveProfileCard() {
    if (!state.profile || state.cardSaving || cardSnapshot() === state.profileSavedSnapshot) return;
    state.cardSaving = true;
    refreshCardDirty();
    try {
      const payload = await api('/api/profile/card', { method: 'PATCH', body: JSON.stringify({ design: state.profile.design }) });
      state.profile.design = payload.design;
      state.profileSavedSnapshot = cardSnapshot();
      renderCardStudio();
      showToast('Your /level card is updated.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      state.cardSaving = false;
      refreshCardDirty();
    }
  }

  async function uploadCardMedia(input, kind) {
    const file = input.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      input.value = '';
      return showToast('Upload a PNG, JPG, or WEBP image up to 5 MB.', 'error');
    }
    try {
      const payload = await api('/api/profile/card/media', { method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }) });
      if (kind === 'background') {
        state.profile.design.background.imageUrl = payload.url;
        state.profile.design.background.x = 0;
        state.profile.design.background.y = 0;
        state.profile.design.background.scale = 1;
        state.cardSelection = 'background';
      } else {
        const id = `image-${Date.now().toString(36)}`;
        state.profile.design.layers.push({ id, type: 'image', imageUrl: payload.url, x: 420, y: 80, width: 140, height: 140 });
        state.cardSelection = `layer:${id}`;
      }
      renderCardStudio();
      showToast('Artwork added. Save when you are ready.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      input.value = '';
    }
  }

  function addCardText() {
    if (!state.profile || state.profile.design.layers.length >= 20) return showToast('This card already has the maximum of 20 custom layers.', 'error');
    const id = `text-${Date.now().toString(36)}`;
    state.profile.design.layers.push({ id, type: 'text', text: 'Your text', x: 420, y: 155, width: 160, height: 40, size: 28, color: '#f4f7f2', weight: 'bold' });
    state.cardSelection = `layer:${id}`;
    renderCardStudio();
    elements.cardInspector.querySelector('textarea')?.focus();
  }

  function canvasPoint(event) {
    const box = elements.cardCanvas.getBoundingClientRect();
    return { x: (event.clientX - box.left) * 1000 / box.width, y: (event.clientY - box.top) * 320 / box.height };
  }

  function hitCardSelection(point) {
    const choices = [
      ...state.profile.design.layers.map((layer) => `layer:${layer.id}`).reverse(),
      'rank', 'xp', 'progress', 'level', 'username', 'avatar', 'background',
    ];
    return choices.find((selection) => {
      const box = cardBounds(selection);
      return box && point.x >= box.x - 5 && point.x <= box.x + box.width + 5 && point.y >= box.y - 5 && point.y <= box.y + box.height + 5;
    }) || 'background';
  }

  function beginCardPointer(event) {
    if (!state.profile || event.button !== 0) return;
    const point = canvasPoint(event);
    const activeBounds = cardBounds();
    const resize = activeBounds?.resize && Math.abs(point.x - (activeBounds.x + activeBounds.width)) < 18 && Math.abs(point.y - (activeBounds.y + activeBounds.height)) < 18;
    if (!resize) state.cardSelection = hitCardSelection(point);
    const target = cardSelectionObject();
    const bounds = cardBounds();
    state.cardPointer = { id: event.pointerId, start: point, resize, target, original: clone(target), bounds };
    elements.cardCanvas.setPointerCapture(event.pointerId);
    renderCardLayers();
    renderCardInspector();
    scheduleCardDraw();
  }

  function moveCardPointer(event) {
    const drag = state.cardPointer;
    if (!drag || drag.id !== event.pointerId) return;
    const point = canvasPoint(event);
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    const target = drag.target;
    if (state.cardSelection === 'background') {
      if (target.imageUrl) { target.x = Math.round(drag.original.x + dx); target.y = Math.round(drag.original.y + dy); }
    } else if (drag.resize) {
      if ('size' in target && !('width' in target)) target.size = Math.max(12, Math.round(drag.original.size + Math.max(dx, dy)));
      else {
        target.width = Math.max(12, Math.round((drag.original.width || drag.bounds.width) + dx));
        target.height = Math.max(6, Math.round((drag.original.height || drag.bounds.height) + dy));
        if (target.type === 'text') target.size = Math.max(10, Math.round(drag.original.size + dy));
      }
    } else {
      if ('x' in target) target.x = Math.round(drag.original.x + dx);
      if ('y' in target) target.y = Math.round(drag.original.y + dy);
    }
    constrainCardSelection();
    scheduleCardDraw();
    refreshCardDirty();
  }

  function endCardPointer(event) {
    if (!state.cardPointer || state.cardPointer.id !== event.pointerId) return;
    state.cardPointer = null;
    renderCardInspector();
    refreshCardDirty();
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
      if (location.pathname.startsWith('/profile')) await loadProfile();
      else if (state.guilds.length) await loadGuild(state.guilds[0].id);
    } catch (error) {
      state.me = null;
      state.guilds = [];
      renderSession();
      elements.loginStatus.textContent = error.status === 401 ? 'Sign in to open your dashboard.' : error.message;
    }
  }

  elements.guildSelect.addEventListener('change', () => loadGuild(elements.guildSelect.value));
  elements.userChip.addEventListener('click', () => {
    const open = elements.accountMenu.hidden;
    elements.accountMenu.hidden = !open;
    elements.userChip.setAttribute('aria-expanded', String(open));
  });
  elements.cardBackgroundButton.addEventListener('click', () => elements.cardBackgroundFile.click());
  elements.cardImageButton.addEventListener('click', () => elements.cardImageFile.click());
  elements.cardTextButton.addEventListener('click', addCardText);
  elements.cardBackgroundFile.addEventListener('change', () => uploadCardMedia(elements.cardBackgroundFile, 'background'));
  elements.cardImageFile.addEventListener('change', () => uploadCardMedia(elements.cardImageFile, 'image'));
  elements.cardLayerList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-card-selection]');
    if (!button) return;
    state.cardSelection = button.dataset.cardSelection;
    renderCardStudio();
  });
  elements.cardInspector.addEventListener('input', (event) => {
    const input = event.target.closest('[data-card-field]');
    if (!input || !state.profile) return;
    setCardField(input.dataset.cardField, input.value);
    constrainCardSelection();
    const constrained = getCardField(input.dataset.cardField);
    if (typeof constrained === 'number') input.value = String(Math.round(constrained * 100) / 100);
    if (input.tagName === 'TEXTAREA') renderCardLayers();
    scheduleCardDraw();
    refreshCardDirty();
  });
  elements.cardInspector.addEventListener('click', (event) => {
    if (!event.target.closest('[data-delete-card-layer]')) return;
    const layer = cardLayerBySelection();
    if (!layer) return;
    state.profile.design.layers = state.profile.design.layers.filter((item) => item.id !== layer.id);
    state.cardSelection = 'background';
    renderCardStudio();
  });
  elements.cardCanvas.addEventListener('pointerdown', beginCardPointer);
  elements.cardCanvas.addEventListener('pointermove', moveCardPointer);
  elements.cardCanvas.addEventListener('pointerup', endCardPointer);
  elements.cardCanvas.addEventListener('pointercancel', endCardPointer);
  elements.cardSaveButton.addEventListener('click', saveProfileCard);
  elements.cardResetButton.addEventListener('click', () => {
    if (!state.profile || state.cardSaving || !state.profileSavedSnapshot) return;
    state.profile.design = JSON.parse(state.profileSavedSnapshot);
    state.cardSelection = 'background';
    renderCardStudio();
    showToast('Unsaved card changes reset.');
  });
  elements.saveButton.addEventListener('click', saveConfig);
  elements.resetButton.addEventListener('click', resetUnsavedChanges);
  elements.logoutButton.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null);
    location.assign('/admin');
  });
  elements.stockEnabled.addEventListener('change', (event) => updateConfigFromControl(event.target));
  elements.levelingView.addEventListener('input', (event) => updateLevelingFromControl(event.target));
  elements.levelingView.addEventListener('change', (event) => updateLevelingFromControl(event.target));
  elements.levelingMessagePreview.addEventListener('click', (event) => {
    const edit = event.target.closest('[data-inline-message-display]');
    if (edit) return beginInlineMessageEdit(edit);
    const done = event.target.closest('[data-inline-message-done]');
    if (done) finishInlineMessageEdit(done.closest('[data-inline-message-editor]'));
  });
  elements.levelingMessagePreview.addEventListener('keydown', (event) => {
    const edit = event.target.closest('[data-inline-message-display]');
    if (edit && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      beginInlineMessageEdit(edit);
      return;
    }
    if (event.target.matches('[data-inline-message-input]') && event.key === 'Escape') event.target.blur();
  });
  elements.levelingMessagePreview.addEventListener('focusout', (event) => {
    const editor = event.target.closest('[data-inline-message-editor]');
    if (!editor) return;
    window.setTimeout(() => {
      if (!editor.contains(document.activeElement)) finishInlineMessageEdit(editor);
    }, 0);
  });
  elements.levelingMessagePreview.addEventListener('scroll', (event) => {
    const input = event.target.closest?.('[data-inline-message-input]');
    const mirror = input?.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-highlight]');
    if (input && mirror) mirror.style.transform = `translateY(-${input.scrollTop}px)`;
  }, true);
  elements.levelingAddReward.addEventListener('click', addLevelReward);
  elements.levelingAddBoost.addEventListener('click', addLevelBoost);
  elements.levelingContainerAdd.addEventListener('click', () => {
    state.config.leveling.announcements.layout.container = !state.config.leveling.announcements.layout.container;
    renderMessagePreview();
    refreshDirty();
  });
  elements.levelingVariablesToggle.addEventListener('click', () => toggleComposerPanel('variables'));
  elements.levelingThumbnailAdd.addEventListener('click', () => toggleComposerPanel('thumbnail'));
  elements.levelingGalleryAdd.addEventListener('click', () => toggleComposerPanel('gallery'));
  elements.levelingAccentButton.addEventListener('click', () => elements.levelingAccentColor.click());
  elements.levelingComposerPanel.addEventListener('click', async (event) => {
    const variable = event.target.closest('[data-copy-variable]');
    if (variable) {
      await navigator.clipboard?.writeText?.(variable.dataset.copyVariable).catch(() => null);
      return showToast(`${variable.dataset.copyVariable} copied.`);
    }
    if (event.target.closest('[data-remove-thumbnail]')) {
      const layout = state.config.leveling.announcements.layout;
      layout.thumbnailEnabled = false;
      layout.thumbnailUrl = '';
      renderMessagePreview();
      refreshDirty();
      return;
    }
    if (event.target.closest('[data-add-gallery-url]')) {
      const gallery = state.config.leveling.announcements.layout.galleryUrls;
      if (gallery.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      gallery.push('');
      renderComposerPanel();
      refreshDirty();
      elements.levelingComposerPanel.querySelector('[data-leveling-gallery-url]:last-of-type')?.focus();
      return;
    }
    const button = event.target.closest('[data-remove-gallery]');
    if (!button) return;
    state.config.leveling.announcements.layout.galleryUrls.splice(Number(button.dataset.removeGallery), 1);
    renderMessagePreview();
    refreshDirty();
  });
  elements.levelingComposerPanel.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-leveling-media-upload]');
    if (upload) uploadLevelingMedia(upload);
  });
  elements.levelingRewards.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-level-reward]');
    if (!button || !state.config) return;
    state.config.leveling.roleRewards.splice(Number(button.dataset.removeLevelReward), 1);
    renderLevelingRewards();
    refreshDirty();
  });
  elements.levelingBoosts.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-level-boost]');
    if (!button || !state.config) return;
    state.config.leveling.roleBoosts.splice(Number(button.dataset.removeLevelBoost), 1);
    renderLevelingBoosts();
    refreshDirty();
  });
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
    if (!event.target.closest('.account-wrap')) {
      elements.accountMenu.hidden = true;
      elements.userChip.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    elements.accountMenu.hidden = true;
    elements.userChip.setAttribute('aria-expanded', 'false');
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
  elements.ownerOverview.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-owner-feature]');
    if (!input) return;
    input.disabled = true;
    try {
      const payload = await api(`/api/owner/guilds/${input.dataset.guildId}/features`, {
        method: 'PATCH',
        body: JSON.stringify({ features: { leveling: input.checked } }),
      });
      if (state.guildId === input.dataset.guildId && state.config) {
        state.config.features = payload.features;
        state.config.leveling = normalizeLevelingConfig(payload.config);
        state.savedConfig = clone(state.config);
        state.savedSnapshot = snapshot();
        renderFeatureAccess();
      }
      showToast(`Leveling ${input.checked ? 'unlocked' : 'locked'} for this server.`);
      await loadOwner();
    } catch (error) {
      input.checked = !input.checked;
      input.disabled = false;
      showToast(error.message, 'error');
    }
  });
  elements.consoleClear.addEventListener('click', () => { state.consoleEntries = []; renderConsole(); });
  elements.consoleToggle.addEventListener('click', () => {
    state.consolePaused = !state.consolePaused;
    elements.consoleToggle.textContent = state.consolePaused ? 'Resume' : 'Pause';
    if (!state.consolePaused) pollConsole().catch(() => null);
  });
  window.addEventListener('beforeunload', (event) => {
    const dashboardDirty = state.config && snapshot() !== state.savedSnapshot;
    const profileDirty = state.profile && cardSnapshot() !== state.profileSavedSnapshot;
    if (!dashboardDirty && !profileDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  loadSession();
})();
