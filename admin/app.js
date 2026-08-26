(() => {
  'use strict';

  const CARD_UNICODE_FALLBACK = '"Noto Sans SC Variable", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Sans", "DejaVu Sans", sans-serif';
  const CARD_FONT_FAMILY = '"Noto Sans Variable", ' + CARD_UNICODE_FALLBACK;
  const CARD_FONT_FAMILIES = Object.freeze({
    sans: CARD_FONT_FAMILY,
    serif: '"Noto Serif Variable", ' + CARD_UNICODE_FALLBACK,
    mono: '"Roboto Mono Variable", ' + CARD_UNICODE_FALLBACK,
    rounded: '"Nunito Variable", ' + CARD_UNICODE_FALLBACK,
    condensed: '"Oswald Variable", ' + CARD_UNICODE_FALLBACK,
    handwriting: '"Caveat Variable", ' + CARD_UNICODE_FALLBACK,
  });
  const CARD_REQUIRED_FONT_FACES = Object.freeze([
    { family: 'Noto Sans Variable', italic: true },
    { family: 'Noto Sans SC Variable', italic: false },
    { family: 'Noto Serif Variable', italic: true },
    { family: 'Roboto Mono Variable', italic: true },
    { family: 'Nunito Variable', italic: true },
    { family: 'Oswald Variable', italic: false },
    { family: 'Caveat Variable', italic: false },
  ]);
  const cardFontLoads = new Map();
  const CARD_PREVIEW_DEBOUNCE_MS = 350;
  const CARD_SNAP_DISTANCE = 6;
  const CARD_SNAP_RELEASE = 10;
  const CARD_HISTORY_LIMIT = 60;
  const CARD_TEMPLATES = Object.freeze({
    classic: {
      panelOpacity: .85, colors: { surface: '#18201b', accent: '#b9f547', text: '#f4f7f2', muted: '#a3ada6', track: '#303a33', progress: '#b9f547' },
      avatar: { x: 54, y: 68, size: 150, color: '#b9f547' }, username: { x: 236, y: 70, size: 34, color: '#f4f7f2' },
      level: { x: 236, y: 130, size: 24, color: '#b9f547' }, rank: { x: 934, y: 68, size: 28, color: '#f4f7f2' },
      progress: { x: 236, y: 211, width: 698, height: 27, color: '#b9f547', trackColor: '#303a33' }, xp: { x: 236, y: 269, size: 21, color: '#d8ded9' },
    },
    arcade: {
      panelOpacity: 0, colors: { surface: '#17132d', accent: '#925cff', text: '#ffffff', muted: '#ddd4ff', track: '#46336e', progress: '#c8a8ff' },
      avatar: { x: 410, y: 16, size: 180, color: '#925cff' }, username: { x: 438, y: 214, size: 36, color: '#ffffff' },
      level: { x: 465, y: 282, size: 22, color: '#ffffff' }, rank: { x: 970, y: 28, size: 32, color: '#d7b9ff' },
      progress: { x: 345, y: 247, width: 320, height: 25, color: '#c8a8ff', trackColor: '#46336e' }, xp: { x: 452, y: 249, size: 19, color: '#ffffff' },
    },
    split: {
      panelOpacity: .58, colors: { surface: '#101d26', accent: '#57d6ff', text: '#f5fcff', muted: '#a9c7d3', track: '#263d49', progress: '#57d6ff' },
      avatar: { x: 70, y: 58, size: 185, color: '#57d6ff' }, username: { x: 300, y: 68, size: 40, color: '#f5fcff' },
      level: { x: 302, y: 130, size: 23, color: '#57d6ff' }, rank: { x: 920, y: 68, size: 32, color: '#f5fcff' },
      progress: { x: 302, y: 210, width: 618, height: 30, color: '#57d6ff', trackColor: '#263d49' }, xp: { x: 302, y: 260, size: 20, color: '#d9f4ff' },
    },
    minimal: {
      panelOpacity: .32, colors: { surface: '#101410', accent: '#ffffff', text: '#ffffff', muted: '#c7cec8', track: '#303632', progress: '#ffffff' },
      avatar: { x: 72, y: 92, size: 112, color: '#ffffff' }, username: { x: 220, y: 74, size: 38, color: '#ffffff' },
      level: { x: 222, y: 135, size: 20, color: '#ffffff' }, rank: { x: 928, y: 74, size: 28, color: '#ffffff' },
      progress: { x: 222, y: 207, width: 706, height: 18, color: '#ffffff', trackColor: '#303632' }, xp: { x: 222, y: 252, size: 18, color: '#c7cec8' },
    },
    spotlight: {
      panelOpacity: .68, colors: { surface: '#241711', accent: '#ffad63', text: '#fff8f1', muted: '#e5c8b1', track: '#503526', progress: '#ffad63' },
      avatar: { x: 425, y: 34, size: 150, color: '#ffad63' }, username: { x: 395, y: 200, size: 36, color: '#fff8f1' },
      level: { x: 444, y: 258, size: 20, color: '#ffcf9f' }, rank: { x: 930, y: 42, size: 28, color: '#fff8f1' },
      progress: { x: 320, y: 238, width: 360, height: 20, color: '#ffad63', trackColor: '#503526' }, xp: { x: 425, y: 238, size: 17, color: '#fff8f1' },
    },
  });

  const state = {
    me: null,
    csrfToken: '',
    guilds: [],
    guildId: '',
    config: null,
    directory: { channels: [], roles: [], botPermissions: { usable: true, missing: [] } },
    savedSnapshot: '',
    savedConfig: null,
    currentView: 'leveling',
    saving: false,
    consoleTimer: null,
    metricsTimer: null,
    consolePaused: false,
    consoleEntries: [],
    consoleAfter: 0,
    levelingComposerPanel: '',
    xpDropTesting: false,
    profile: null,
    profileSavedSnapshot: '',
    cardSelection: 'background',
    cardPointer: null,
    cardGuides: {},
    cardSaving: false,
    cardUndoStack: [],
    cardRedoStack: [],
    cardPendingHistory: '',
    cardPreviewRequest: 0,
    cardPreviewHash: '',
    cardPreviewTimer: null,
  };

  const $ = (selector, root = document) => root.querySelector(selector);
  const elements = {
    appShell: $('#appShell'), loginPanel: $('#loginPanel'), loginStatus: $('#loginStatus'),
    logoutButton: $('#logoutButton'), accountWrap: $('#accountWrap'), accountMenu: $('#accountMenu'),
    userChip: $('#userChip'), userAvatar: $('#userAvatar'), sessionLabel: $('#sessionLabel'),
    guildSelect: $('#guildSelect'), serverMeta: $('#serverMeta'), ownerNav: $('#ownerNav'), levelingNav: $('#levelingNav'), rngGameNav: $('#rngGameNav'),
    levelingView: $('#levelingView'), rngGameView: $('#rngGameView'), ownerView: $('#ownerView'), toast: $('#toast'),
    saveDock: $('#saveDock'),
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
    xpDropsEnabled: $('#xpDropsEnabled'), xpDropAdd: $('#xpDropAdd'), xpDropList: $('#xpDropList'),
    xpDropVariables: $('#xpDropVariables'), xpDropMessagePreview: $('#xpDropMessagePreview'), xpDropClaimPreview: $('#xpDropClaimPreview'),
    xpDropTestCrate: $('#xpDropTestCrate'), xpDropTestChannel: $('#xpDropTestChannel'), xpDropTestButton: $('#xpDropTestButton'),
    rngGameEnabled: $('#rngGameEnabled'), rngGameChannels: $('#rngGameChannels'),
    rngCooldownBypassRoles: $('#rngCooldownBypassRoles'),
    profileShell: $('#profileShell'), profileAvatar: $('#profileAvatar'), profileName: $('#profileName'),
    cardCanvas: $('#levelCardDraftCanvas'), cardAuthoritativeCanvas: $('#levelCardCanvas'), cardCanvasWrap: $('#cardCanvasWrap'), cardLayerList: $('#cardLayerList'),
    cardPreviewLabel: $('#cardPreviewLabel'),
    cardInspector: $('#cardInspector'), cardInspectorTitle: $('#cardInspectorTitle'),
    cardBackgroundButton: $('#cardBackgroundButton'), cardImageButton: $('#cardImageButton'), cardTextButton: $('#cardTextButton'),
    cardBackgroundFile: $('#cardBackgroundFile'), cardImageFile: $('#cardImageFile'),
    cardTemplateSelect: $('#cardTemplateSelect'), cardTemplateButton: $('#cardTemplateButton'),
    cardUndoButton: $('#cardUndoButton'), cardRedoButton: $('#cardRedoButton'),
    profileSaveDock: $('#profileSaveDock'), cardSaveButton: $('#cardSaveButton'), cardResetButton: $('#cardResetButton'),
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

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
  }

  function normalizeDurationInput(value, fallback = '30m', optional = false) {
    const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
    if (optional && (!text || text === '0')) return '';
    return /^\d+(?:\.\d+)?[smhd]$/.test(text) && Number.parseFloat(text) > 0 ? text : fallback;
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
    source.xpDrops ||= {};
    source.xpDrops.enabled = source.xpDrops.enabled === true;
    source.xpDrops.dropTemplate = String(source.xpDrops.dropTemplate || '## 🎁 {crate_name} appeared!\nBe one of the first **{claim_limit}** members to claim **{xp_min}–{xp_max} XP**.\n-# {claims_left} claim(s) remaining · disappears {despawn_time}').slice(0, 3000);
    source.xpDrops.claimTemplate = String(source.xpDrops.claimTemplate || '## ✦ {crate_name} claimed\n{user} found **{xp} XP** and is now level **{level}**.\n-# {claims_left} claim(s) remaining').slice(0, 3000);
    const usedCrateIds = new Set();
    source.xpDrops.crates = (source.xpDrops.crates || []).map((crate, index) => {
      let id = String(crate.id || `crate-${index + 1}`).toLowerCase().replace(/[^a-z0-9_-]/g, '-').slice(0, 40) || `crate-${index + 1}`;
      while (usedCrateIds.has(id)) id = `${id.slice(0, 34)}-${index + 1}`;
      usedCrateIds.add(id);
      const minimum = Math.round(clampNumber(crate.xp?.min ?? crate.xpMin, 1, 1_000_000, 50));
      return {
        id,
        enabled: crate.enabled !== false,
        name: String(crate.name || `Crate ${index + 1}`).trim().slice(0, 80) || `Crate ${index + 1}`,
        imageUrl: String(crate.imageUrl || '').slice(0, 2000),
        xp: { min: minimum, max: Math.round(clampNumber(crate.xp?.max ?? crate.xpMax, minimum, 1_000_000, Math.max(100, minimum))) },
        channelId: String(crate.channelId || ''),
        dropEvery: normalizeDurationInput(crate.dropEvery, '30m'),
        chancePercent: clampNumber(crate.chancePercent, 0, 100, 100),
        claimLimit: Math.round(clampNumber(crate.claimLimit, 1, 1000, 1)),
        despawnAfter: normalizeDurationInput(crate.despawnAfter, '', true),
        allowMultipleClaims: crate.allowMultipleClaims === true,
        containerColor: /^#[0-9a-f]{6}$/i.test(crate.containerColor || '') ? crate.containerColor.toLowerCase() : '#b9f547',
      };
    }).slice(0, 100);
    return source;
  }

  function normalizeRngGameConfig(config) {
    const source = clone(config?.rngGame || {});
    source.enabled = source.enabled === true;
    const channelIds = Array.isArray(source.gameChannelIds) ? source.gameChannelIds : [source.gameChannelId];
    source.gameChannelIds = [...new Set(channelIds.map(String).filter(Boolean))].slice(0, 100);
    delete source.gameChannelId;
    source.cooldownBypassRoleIds = [...new Set((source.cooldownBypassRoleIds || []).map(String))].slice(0, 100);
    delete source.info;
    return source;
  }

  function channelOptions(selected, include = () => true) {
    const multiple = Array.isArray(selected);
    const selectedIds = new Set((multiple ? selected : [selected]).map(String).filter(Boolean));
    const options = [`<option value="" ${multiple ? 'disabled' : ''}>Not routed</option>`];
    let lastParent = null;
    for (const channel of state.directory.channels.filter((item) => !item.archived && include(item))) {
      if (channel.parentName && channel.parentName !== lastParent) {
        options.push(`<option disabled>── ${escapeHtml(channel.parentName)} ──</option>`);
        lastParent = channel.parentName;
      }
      const prefix = channel.kind === 'thread' ? '⌁' : channel.kind === 'forum' ? '▦' : '#';
      options.push(`<option value="${channel.id}" ${selectedIds.has(channel.id) ? 'selected' : ''}>${prefix} ${escapeHtml(channel.name)}</option>`);
    }
    return options.join('');
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

  const XP_DROP_VARIABLES = [
    ['{crate_name}', 'Crate name'], ['{xp_min}', 'Minimum XP'], ['{xp_max}', 'Maximum XP'],
    ['{xp}', 'Claimed XP'], ['{claim_limit}', 'Total claim slots'], ['{claims_left}', 'Remaining claims'],
    ['{chance}', 'Drop chance percent'], ['{drop_every}', 'Drop interval'], ['{despawn_time}', 'Despawn interval or never'],
    ['{user}', 'Claiming member mention'], ['{username}', 'Claiming display name'], ['{level}', 'Member level'],
    ['{total_xp}', 'Member total XP'], ['{server}', 'Server name'], ['{channel}', 'Drop channel'], ['{separator}', 'Discord divider'],
  ];

  function renderXpDropMessagePreviews() {
    const xpDrops = state.config.leveling.xpDrops;
    const selectedId = elements.xpDropTestCrate.value;
    const crate = xpDrops.crates.find((item) => item.id === selectedId) || xpDrops.crates[0] || {
      name: 'Common Crate', imageUrl: '', containerColor: '#b9f547', claimLimit: 3,
    };
    const color = /^#[0-9a-f]{6}$/i.test(crate.containerColor || '') ? crate.containerColor : '#b9f547';
    const image = previewMediaUrl(crate.imageUrl);
    elements.xpDropMessagePreview.style.setProperty('--accent-color', color);
    elements.xpDropClaimPreview.style.setProperty('--accent-color', color);
    elements.xpDropMessagePreview.innerHTML = `<div class="discord-section"><div>${inlineTemplateEditor(xpDrops.dropTemplate, 'dropTemplate', 'xpDrops', 'XP drop message')}</div>${image ? `<img class="discord-thumbnail" src="${escapeHtml(image)}" alt="${escapeHtml(crate.name)}">` : '<div class="discord-thumbnail placeholder">CRATE</div>'}</div><div class="discord-separator"></div><button class="xp-drop-fake-claim" type="button" disabled>Claim ${escapeHtml(crate.name)}</button>`;
    elements.xpDropClaimPreview.innerHTML = inlineTemplateEditor(xpDrops.claimTemplate, 'claimTemplate', 'xpDrops', 'XP claim message');
  }

  function renderXpDropList() {
    const crates = state.config.leveling.xpDrops.crates;
    elements.xpDropList.innerHTML = crates.length ? crates.map((crate, index) => {
      const image = previewMediaUrl(crate.imageUrl);
      return `<article class="xp-drop-card" style="--crate-color:${crate.containerColor}" data-xp-drop-card="${index}">
        <header><div><span class="crate-number">${String(index + 1).padStart(2, '0')}</span><div><strong>${escapeHtml(crate.name)}</strong><small>${crate.enabled ? 'Scheduled' : 'Paused'} · ${escapeHtml(crate.dropEvery)} · ${crate.chancePercent}% chance</small></div></div><div><label class="crate-enabled"><input type="checkbox" data-xp-drop-field="enabled" data-xp-drop-index="${index}" ${crate.enabled ? 'checked' : ''}><span>Enabled</span></label><button type="button" class="reward-remove" data-remove-xp-drop="${index}">Remove</button></div></header>
        <div class="xp-drop-card-body">
          <div class="xp-drop-art">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(crate.name)} image">` : '<span>NO IMAGE</span>'}<label class="media-upload">Upload image<input type="file" accept="image/*" data-xp-drop-media="${index}"></label><small>Any decodable image or GIF, up to 10 MB</small></div>
          <div class="xp-drop-fields">
            <label class="wide"><span>Crate name</span><input type="text" maxlength="80" value="${escapeHtml(crate.name)}" data-xp-drop-field="name" data-xp-drop-index="${index}"></label>
            <label><span>Minimum XP</span><input type="number" min="1" max="1000000" value="${crate.xp.min}" data-xp-drop-field="xpMin" data-xp-drop-index="${index}"></label>
            <label><span>Maximum XP</span><input type="number" min="1" max="1000000" value="${crate.xp.max}" data-xp-drop-field="xpMax" data-xp-drop-index="${index}"></label>
            <label class="wide"><span>Default channel</span><select data-xp-drop-field="channelId" data-xp-drop-index="${index}">${channelOptions(crate.channelId, (channel) => channel.kind !== 'forum')}</select></label>
            <label><span>Drop every</span><input type="text" maxlength="16" value="${escapeHtml(crate.dropEvery)}" placeholder="30m" data-xp-drop-field="dropEvery" data-xp-drop-index="${index}"><small>Use s, m, h, or d</small></label>
            <label><span>Chance (%)</span><input type="number" min="0" max="100" step="0.01" value="${crate.chancePercent}" data-xp-drop-field="chancePercent" data-xp-drop-index="${index}"></label>
            <label><span>Claim limit</span><input type="number" min="1" max="1000" value="${crate.claimLimit}" data-xp-drop-field="claimLimit" data-xp-drop-index="${index}"></label>
            <label><span>Despawn after</span><input type="text" maxlength="16" value="${escapeHtml(crate.despawnAfter)}" placeholder="None / 0" data-xp-drop-field="despawnAfter" data-xp-drop-index="${index}"><small>Empty or 0 means never</small></label>
            <label><span>Container color</span><span class="crate-color-input"><input type="color" value="${crate.containerColor}" data-xp-drop-field="containerColor" data-xp-drop-index="${index}"><code>${crate.containerColor}</code></span></label>
            <label class="wide crate-multi-claim"><input type="checkbox" data-xp-drop-field="allowMultipleClaims" data-xp-drop-index="${index}" ${crate.allowMultipleClaims ? 'checked' : ''}><span><strong>Allow a person to claim multiple times</strong><small>Off by default. When on, one member can consume more than one claim slot.</small></span></label>
          </div>
        </div>
      </article>`;
    }).join('') : '<div class="empty-state reward-empty"><strong>No XP crates yet</strong><span>Add a crate to configure scheduled drops and test claims.</span></div>';
  }

  function renderXpDrops() {
    const xpDrops = state.config.leveling.xpDrops;
    const selectedCrate = elements.xpDropTestCrate.value;
    const selectedChannel = elements.xpDropTestChannel.value;
    elements.xpDropsEnabled.checked = xpDrops.enabled;
    elements.xpDropVariables.innerHTML = XP_DROP_VARIABLES.map(([token, meaning]) => `<button type="button" data-copy-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('');
    renderXpDropList();
    elements.xpDropTestCrate.innerHTML = xpDrops.crates.length
      ? xpDrops.crates.map((crate) => `<option value="${escapeHtml(crate.id)}" ${crate.id === selectedCrate ? 'selected' : ''}>${escapeHtml(crate.name)}</option>`).join('')
      : '<option value="">Add a crate first</option>';
    elements.xpDropTestChannel.innerHTML = channelOptions(selectedChannel, (channel) => channel.kind !== 'forum');
    elements.xpDropTestChannel.options[0].textContent = 'Use the crate default channel';
    elements.xpDropTestButton.disabled = state.xpDropTesting || !xpDrops.crates.length;
    elements.xpDropTestButton.textContent = state.xpDropTesting ? 'Sending…' : 'Send test';
    renderXpDropMessagePreviews();
  }

  function addXpDrop() {
    const crates = state.config?.leveling?.xpDrops?.crates;
    if (!crates || crates.length >= 100) return;
    const id = `crate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 40);
    const defaultChannel = (state.directory.channels || []).find((channel) => !channel.archived && channel.kind !== 'forum')?.id || '';
    crates.push({
      id, enabled: true, name: `Crate ${crates.length + 1}`, imageUrl: '', xp: { min: 50, max: 100 },
      channelId: defaultChannel, dropEvery: '30m', chancePercent: 100, claimLimit: 1,
      despawnAfter: '', allowMultipleClaims: false, containerColor: '#b9f547',
    });
    renderXpDrops();
    refreshDirty();
    elements.xpDropList.lastElementChild?.querySelector('[data-xp-drop-field="name"]')?.focus();
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
      .replace(/\{(?:user|user_profile|username|level|next_level|server|channel|bar|progress_xp|needed_xp|total_xp|crate_name|xp_min|xp_max|xp|claim_limit|claims_left|chance|drop_every|despawn_time|separator)\}/gi, (token) => stash(`<span class="editor-token">${token}</span>`));
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
    const xpDrops = state.config?.leveling?.xpDrops;
    const crate = xpDrops?.crates?.find((item) => item.id === elements.xpDropTestCrate?.value) || xpDrops?.crates?.[0];
    const minimum = crate?.xp?.min ?? 50;
    const maximum = crate?.xp?.max ?? 100;
    const claimed = Math.round((Number(minimum) + Number(maximum)) / 2);
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
      .replaceAll('{total_xp}', '3,160')
      .replaceAll('{crate_name}', crate?.name || 'Common Crate')
      .replaceAll('{xp_min}', formatNumber(minimum))
      .replaceAll('{xp_max}', formatNumber(maximum))
      .replaceAll('{xp}', formatNumber(claimed))
      .replaceAll('{claim_limit}', formatNumber(crate?.claimLimit ?? 3))
      .replaceAll('{claims_left}', formatNumber(Math.max(0, (crate?.claimLimit ?? 3) - 1)))
      .replaceAll('{chance}', String(crate?.chancePercent ?? 35))
      .replaceAll('{drop_every}', crate?.dropEvery || '30m')
      .replaceAll('{despawn_time}', crate?.despawnAfter || 'never')
      .replaceAll('{channel}', '#general');
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

  function inlineTemplateEditor(template, field = 'template', scope = 'announcements', label = 'level-up message') {
    return `<div class="inline-message-editor" data-inline-message-editor data-template-field="${escapeHtml(field)}" data-template-scope="${escapeHtml(scope)}">
      <div class="inline-message-display" data-inline-message-display role="button" tabindex="0" aria-label="Edit ${escapeHtml(label)}">${renderedEditableTemplate(template)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span></div>
      <div class="inline-message-source-shell">
        <div class="inline-message-highlight" data-inline-message-highlight aria-hidden="true">${editorMarkdown(template)}</div>
        <textarea class="inline-message-input" data-inline-message-input data-inline-template-field="${escapeHtml(field)}" data-inline-template-scope="${escapeHtml(scope)}" maxlength="3000" rows="5" spellcheck="true" aria-label="${escapeHtml(label)} template">${escapeHtml(template)}</textarea>
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
      elements.levelingComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {user_profile}, paste an image URL, or upload any decodable image or GIF up to 10 MB.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{user_profile} or https://example.com/thumbnail.png" data-leveling-thumbnail-url><label class="media-upload">Upload image<input type="file" accept="image/*" data-leveling-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="{user_profile} or https://example.com/image.png" data-leveling-gallery-url="${index}"><label class="media-upload">Upload<input type="file" accept="image/*" data-leveling-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.levelingComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 images with {user_profile}, a URL, or an upload.</small></div><div><button type="button" data-add-gallery-url>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-leveling-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
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
    if (!file.type.startsWith('image/')) {
      input.value = '';
      return showToast('Upload an image file.', 'error');
    }
    if (file.size > 10 * 1024 * 1024) {
      input.value = '';
      return showToast('Images must be 10 MB or smaller.', 'error');
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

  async function uploadXpDropMedia(input) {
    const file = input.files?.[0];
    const index = Number(input.dataset.xpDropMedia);
    const crate = state.config?.leveling?.xpDrops?.crates?.[index];
    if (!file || !crate) return;
    if (!file.type.startsWith('image/')) {
      input.value = '';
      return showToast('Upload an image file.', 'error');
    }
    if (file.size > 10 * 1024 * 1024) {
      input.value = '';
      return showToast('Images must be 10 MB or smaller.', 'error');
    }
    const label = input.closest('.media-upload');
    label?.classList.add('uploading');
    try {
      const result = await api(`/api/guilds/${state.guildId}/leveling-media`, {
        method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }),
      });
      crate.imageUrl = result.url;
      renderXpDrops();
      refreshDirty();
      showToast('Crate image uploaded. Apply changes when you are ready.');
    } catch (error) {
      showToast(error.message || 'Image upload failed.', 'error');
    } finally {
      label?.classList.remove('uploading');
      input.value = '';
    }
  }

  async function sendXpDropTest() {
    if (state.xpDropTesting || !state.config) return;
    const crateId = elements.xpDropTestCrate.value;
    if (!crateId) return showToast('Add a crate before sending a test.', 'error');
    state.xpDropTesting = true;
    renderXpDrops();
    try {
      const result = await api(`/api/guilds/${state.guildId}/xp-drops/test`, {
        method: 'POST',
        body: JSON.stringify({
          crateId,
          channelId: elements.xpDropTestChannel.value,
          xpDrops: state.config.leveling.xpDrops,
        }),
      });
      showToast(`Test crate sent to <#${result.channelId}>. Claims will not award XP.`);
    } catch (error) {
      showToast(error.message || 'The test crate could not be sent.', 'error');
    } finally {
      state.xpDropTesting = false;
      renderXpDrops();
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
    renderXpDrops();
    refreshDirty();
  }

  function renderRngGame() {
    const rngGame = state.config.rngGame;
    elements.rngGameEnabled.checked = rngGame.enabled;
    elements.rngGameChannels.innerHTML = channelOptions(rngGame.gameChannelIds);
    elements.rngGameChannels.options[0].textContent = 'Choose one or more game channels';
    const selected = new Set(rngGame.cooldownBypassRoleIds);
    const roles = state.directory.roles || [];
    elements.rngCooldownBypassRoles.innerHTML = roles.length
      ? roles.map((role) => `<option value="${role.id}" ${selected.has(role.id) ? 'selected' : ''} style="color:${roleColor(role.id)}">● @${escapeHtml(role.name)}</option>`).join('')
      : '<option disabled>No roles available</option>';
    refreshDirty();
  }

  function renderFeatureAccess() {
    if (!state.config) return;
    const levelingUnlocked = state.config.features?.leveling === true;
    elements.levelingNav.disabled = !levelingUnlocked;
    elements.levelingNav.classList.toggle('is-locked', !levelingUnlocked);
    const levelingLabel = elements.levelingNav.querySelector('small');
    if (levelingLabel) levelingLabel.textContent = levelingUnlocked ? 'XP & rewards' : 'Locked by owner';
    elements.levelingNav.title = levelingUnlocked ? '' : 'The bot owner must unlock Leveling for this server.';
    const rngUnlocked = state.config.features?.rngGame === true;
    elements.rngGameNav.disabled = !rngUnlocked;
    elements.rngGameNav.classList.toggle('is-locked', !rngUnlocked);
    const rngLabel = elements.rngGameNav.querySelector('small');
    if (rngLabel) rngLabel.textContent = rngUnlocked ? 'Rolls & economy' : 'Locked by owner';
    elements.rngGameNav.title = rngUnlocked ? '' : 'The bot owner must unlock RNG Game for this server.';
    if (!levelingUnlocked && state.currentView === 'leveling') {
      if (rngUnlocked) setView('rng-game');
      else if (state.me?.owner) setView('owner');
    } else if (!rngUnlocked && state.currentView === 'rng-game') {
      if (levelingUnlocked) setView('leveling');
      else if (state.me?.owner) setView('owner');
    }
  }

  function snapshot(config = state.config) {
    if (!config) return '';
    return JSON.stringify({
      leveling: config.leveling,
      rngGame: config.rngGame,
    });
  }

  function refreshDirty() {
    const dirty = snapshot() !== state.savedSnapshot;
    elements.saveDock.hidden = !dirty && !state.saving;
    elements.saveState.textContent = state.saving ? 'Applying changes…' : 'Unsaved changes';
    elements.saveButton.disabled = !dirty || state.saving;
    elements.resetButton.disabled = !dirty || state.saving;
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
      const [directoryPayload, configPayload] = await Promise.all([
        api(`/api/guilds/${guildId}/directory`),
        api(`/api/guilds/${guildId}/config`),
      ]);
      if (state.guildId !== guildId) return;
      state.directory = { channels: [], roles: [], ...directoryPayload.directory };
      state.config = {
        ...configPayload.config,
        leveling: normalizeLevelingConfig(configPayload.config),
        rngGame: normalizeRngGameConfig(configPayload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      renderFeatureAccess();
      renderLeveling();
      renderRngGame();
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
      const leveling = clone(state.config.leveling);
      const rngGame = clone(state.config.rngGame);
      const body = {};
      if (state.config.features?.leveling === true) body.leveling = leveling;
      if (state.config.features?.rngGame === true) body.rngGame = rngGame;
      const payload = await api(`/api/guilds/${state.guildId}/config`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      state.config = {
        ...payload.config,
        leveling: normalizeLevelingConfig(payload.config),
        rngGame: normalizeRngGameConfig(payload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      renderFeatureAccess();
      renderLeveling();
      renderRngGame();
      showToast('Dashboard settings updated.');
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      state.saving = false;
      refreshDirty();
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
      ['ping', 'Bot ping', `${formatNumber(payload.bot.pingMs)} ms`, 'Discord gateway', null, null],
      ['uptime', 'Uptime', formatUptime(payload.bot.uptimeMs), payload.bot.tag, null, null],
      ['communities', 'Communities', formatNumber(payload.bot.guildCount), `${formatNumber(payload.bot.totalUsers)} members`, null, null],
      ['heap', 'Heap', payload.bot.memory.heapUsedLabel, 'Live process usage', payload.bot.memory.usageRatio, payload.bot.memory.heapLimitLabel],
      ['storage', 'Storage', payload.storage.label, 'Live data and logs', payload.storage.usageRatio, payload.storage.maxLabel],
    ];
    const rows = (payload.guilds || []).map((guild) => {
      const featureCount = Number(guild.features?.leveling === true)
        + Number(guild.features?.rngGame === true);
      return `<tr>
      <td><div class="guild-cell">${guildIcon(guild)}<span><strong>${escapeHtml(guild.name)}</strong><small>${guild.id}</small></span></div></td>
      <td>${formatNumber(guild.totalUsers)}</td>
      <td><span class="status-pill ${guild.enabled ? '' : 'off'}">${guild.enabled ? 'Online' : 'Disabled'}</span></td>
      <td><details class="feature-dropdown"><summary>${featureCount} feature${featureCount === 1 ? '' : 's'}</summary><div>
        <label><input type="checkbox" data-owner-feature="leveling" data-guild-id="${guild.id}" ${guild.features?.leveling ? 'checked' : ''}><span><strong>Leveling</strong><small>${guild.features?.leveling ? 'Unlocked' : 'Locked'}</small></span></label>
        <label><input type="checkbox" data-owner-feature="rngGame" data-guild-id="${guild.id}" ${guild.features?.rngGame ? 'checked' : ''}><span><strong>RNG Game</strong><small>${guild.features?.rngGame ? 'Unlocked' : 'Locked'}</small></span></label>
      </div></details></td>
      <td><div class="row-actions"><button class="text-button" type="button" data-owner-load="${guild.id}">Open</button><button class="text-button" type="button" data-owner-toggle="${guild.id}" data-enabled="${guild.enabled}">${guild.enabled ? 'Disable' : 'Enable'}</button></div></td>
    </tr>`;
    }).join('');
    elements.ownerOverview.innerHTML = `
      <section class="metric-grid">${metrics.map(([key, label, value, detail, ratio, maxLabel]) => {
        const colorStyle = ratio > 0.85 ? 'color: #ef4444;' : '';
        const maxInfo = maxLabel ? `<br><small style="opacity: 0.7;">Max: ${maxLabel} (${(ratio * 100).toFixed(1)}%)</small>` : '';
        return `<article class="metric-card"><small>${label}</small><strong data-owner-metric="${key}" style="${colorStyle}">${escapeHtml(value)}</strong><span data-owner-metric-detail="${key}">${escapeHtml(detail)}${maxInfo}</span></article>`;
      }).join('')}</section>
      <section class="fleet-panel"><header class="fleet-head"><h2>Community fleet</h2><span>${payload.guilds.length} connected</span></header><div class="fleet-table-wrap"><table class="fleet-table"><thead><tr><th>Community</th><th>Members</th><th>Status</th><th>Feature access</th><th>Actions</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No communities available.</td></tr>'}</tbody></table></div></section>`;
  }

  async function pollOwnerMetrics() {
    if (state.currentView !== 'owner') return;
    const payload = await api('/api/owner/metrics');
    
    const updateMetric = (key, data, detailLabel) => {
      const el = elements.ownerOverview.querySelector(`[data-owner-metric="${key}"]`);
      if (el) {
        el.textContent = data.label;
        el.style.color = data.usageRatio > 0.85 ? '#ef4444' : '';
      }
      const detailEl = elements.ownerOverview.querySelector(`[data-owner-metric-detail="${key}"]`);
      if (detailEl && data.maxLabel) {
        detailEl.innerHTML = `${detailLabel}<br><small style="opacity: 0.7;">Max: ${data.maxLabel} (${(data.usageRatio * 100).toFixed(1)}%)</small>`;
      }
    };
    if (payload.heap) updateMetric('heap', payload.heap, 'Live process usage');
    if (payload.storage) updateMetric('storage', payload.storage, 'Live data and logs');
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
    if (view === 'rng-game' && state.config?.features?.rngGame !== true) {
      showToast('RNG Game is locked for this server. The bot owner can unlock it from Fleet control.', 'error');
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
      reason = await confirmAction({ title: 'Disable this community?', copy: 'CoinSprite commands and features will stop immediately. The guild owner will be notified.', input: true, confirmLabel: 'Disable' });
      if (!reason) return;
    } else {
      const confirmed = await confirmAction({ title: 'Enable this community?', copy: 'CoinSprite will resume its configured features for this server.', confirmLabel: 'Enable' });
      if (!confirmed) return;
    }
    await api(`/api/owner/guilds/${guildId}/${enabled ? 'disable' : 'enable'}`, {
      method: 'POST', body: JSON.stringify(enabled ? { reason } : {}),
    });
    showToast(`Community ${enabled ? 'disabled' : 'enabled'}.`);
    await loadOwner();
  }

  function updateLevelingFromControl(target) {
    if (!state.config) return;
    const leveling = state.config.leveling;
    if (target.matches('[data-inline-message-input]')) {
      const field = target.dataset.inlineTemplateField;
      const limits = { template: 3000 };
      if (target.dataset.inlineTemplateScope === 'xpDrops') {
        if (['dropTemplate', 'claimTemplate'].includes(field)) leveling.xpDrops[field] = target.value.slice(0, 3000);
      } else if (limits[field]) leveling.announcements[field] = target.value.slice(0, limits[field]);
      syncInlineEditorVisual(target);
      refreshDirty();
      return;
    }
    if (target === elements.levelingEnabled) leveling.enabled = target.checked;
    if (target === elements.xpDropsEnabled) leveling.xpDrops.enabled = target.checked;
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
    if (target.matches('[data-xp-drop-field]')) {
      const index = Number(target.dataset.xpDropIndex);
      const crate = leveling.xpDrops.crates[index];
      const field = target.dataset.xpDropField;
      if (crate) {
        if (field === 'enabled' || field === 'allowMultipleClaims') crate[field] = target.checked;
        else if (field === 'name') crate.name = target.value.slice(0, 80);
        else if (field === 'channelId') crate.channelId = target.value;
        else if (field === 'xpMin') {
          crate.xp.min = Math.round(clampNumber(target.value, 1, 1_000_000, crate.xp.min));
          crate.xp.max = Math.max(crate.xp.min, crate.xp.max);
        } else if (field === 'xpMax') crate.xp.max = Math.round(clampNumber(target.value, crate.xp.min, 1_000_000, crate.xp.max));
        else if (field === 'dropEvery' || field === 'despawnAfter') crate[field] = target.value.slice(0, 16);
        else if (field === 'chancePercent') crate.chancePercent = clampNumber(target.value, 0, 100, crate.chancePercent);
        else if (field === 'claimLimit') crate.claimLimit = Math.round(clampNumber(target.value, 1, 1000, crate.claimLimit));
        else if (field === 'containerColor') {
          crate.containerColor = target.value;
          target.closest('.xp-drop-card')?.style.setProperty('--crate-color', target.value);
          const code = target.closest('.crate-color-input')?.querySelector('code');
          if (code) code.textContent = target.value;
        }
        const card = target.closest('.xp-drop-card');
        const heading = card?.querySelector('header strong');
        const summary = card?.querySelector('header small');
        if (heading) heading.textContent = crate.name || 'Unnamed crate';
        if (summary) summary.textContent = `${crate.enabled ? 'Scheduled' : 'Paused'} · ${crate.dropEvery || 'invalid interval'} · ${crate.chancePercent}% chance`;
        const testOption = [...elements.xpDropTestCrate.options].find((option) => option.value === crate.id);
        if (testOption) testOption.textContent = crate.name || 'Unnamed crate';
        renderXpDropMessagePreviews();
      }
    }
    refreshDirty();
  }

  function updateRngGameFromControl(target) {
    if (!state.config) return;
    const rngGame = state.config.rngGame;
    if (target === elements.rngGameEnabled) rngGame.enabled = target.checked;
    if (target === elements.rngGameChannels) {
      rngGame.gameChannelIds = [...target.selectedOptions].map((option) => option.value).filter(Boolean).slice(0, 100);
    }
    if (target === elements.rngCooldownBypassRoles) {
      rngGame.cooldownBypassRoleIds = [...target.selectedOptions].map((option) => option.value).slice(0, 100);
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
    renderLeveling();
    renderRngGame();
    showToast('Unsaved changes reset.');
  }

  const cardImages = new Map();
  let cardFrame = 0;
  let cardDrawRequest = 0;
  let cardFontsReadyPromise = null;

  function cardSnapshot() {
    return state.profile ? JSON.stringify(state.profile.design) : '';
  }

  function refreshCardHistoryButtons() {
    elements.cardUndoButton.disabled = !state.cardUndoStack.length;
    elements.cardRedoButton.disabled = !state.cardRedoStack.length;
  }

  function pushCardHistory(stack, snapshot) {
    if (!snapshot || stack.at(-1) === snapshot) return;
    stack.push(snapshot);
    if (stack.length > CARD_HISTORY_LIMIT) stack.shift();
  }

  function commitCardHistory(before) {
    if (!before || before === cardSnapshot()) return false;
    pushCardHistory(state.cardUndoStack, before);
    state.cardRedoStack = [];
    refreshCardHistoryButtons();
    return true;
  }

  function mutateCardDesign(change) {
    if (!state.profile) return false;
    const before = cardSnapshot();
    change();
    return commitCardHistory(before);
  }

  function beginCardInputHistory() {
    if (!state.cardPendingHistory) state.cardPendingHistory = cardSnapshot();
  }

  function finishCardInputHistory() {
    if (!state.cardPendingHistory) return;
    const before = state.cardPendingHistory;
    state.cardPendingHistory = '';
    commitCardHistory(before);
  }

  function restoreCardHistory(snapshot) {
    state.profile.design = JSON.parse(snapshot);
    if (state.cardSelection !== 'background' && !cardSelectionObject()) state.cardSelection = 'background';
    renderCardStudio();
  }

  function undoCardDesign() {
    finishCardInputHistory();
    const snapshot = state.cardUndoStack.pop();
    if (!snapshot) return;
    pushCardHistory(state.cardRedoStack, cardSnapshot());
    restoreCardHistory(snapshot);
  }

  function redoCardDesign() {
    finishCardInputHistory();
    const snapshot = state.cardRedoStack.pop();
    if (!snapshot) return;
    pushCardHistory(state.cardUndoStack, cardSnapshot());
    restoreCardHistory(snapshot);
  }

  function applyCardTemplate() {
    const key = elements.cardTemplateSelect.value;
    const template = CARD_TEMPLATES[key];
    if (!template || !state.profile) return;
    const templateFont = { classic: 'sans', arcade: 'condensed', split: 'rounded', minimal: 'sans', spotlight: 'serif' }[key];
    mutateCardDesign(() => {
      const design = state.profile.design;
      design.panelOpacity = template.panelOpacity;
      design.colors = { ...design.colors, ...clone(template.colors) };
      for (const element of ['avatar', 'username', 'level', 'rank', 'progress', 'xp']) {
        design[element] = { ...design[element], ...clone(template[element]), visible: true, rotation: 0 };
      }
      for (const element of ['username', 'level', 'rank', 'xp']) design[element].fontFamily = templateFont;
    });
    state.cardSelection = 'background';
    renderCardStudio();
    showToast(`Applied the ${elements.cardTemplateSelect.selectedOptions[0].textContent} template.`);
  }

  function cardImage(url) {
    if (!url) return null;
    if (cardImages.has(url)) return cardImages.get(url).ready ? cardImages.get(url).image : null;
    const entry = { image: new Image(), ready: false };
    cardImages.set(url, entry);
    entry.image.crossOrigin = 'anonymous';
    entry.image.addEventListener('load', () => { entry.ready = true; scheduleCardDraw(); });
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

  function normalizedCardRotation(value) {
    const rotation = Number(value);
    if (!Number.isFinite(rotation)) return 0;
    return ((rotation + 180) % 360 + 360) % 360 - 180;
  }

  function cardFont(item, size = item?.size) {
    const family = CARD_FONT_FAMILIES[item?.fontFamily] || CARD_FONT_FAMILIES.sans;
    return `${item?.italic ? 'italic' : 'normal'} ${item?.bold === false || item?.weight === 'normal' ? 'normal' : 'bold'} ${Math.max(1, Number(size) || 1)}px ${family}`;
  }

  function normalizedFontFaceFamily(value) {
    return String(value || '').replace(/^['"]|['"]$/g, '');
  }

  function ensureCardFontsReady() {
    if (cardFontsReadyPromise) return cardFontsReadyPromise;
    cardFontsReadyPromise = (async () => {
      if (!document.fonts?.load || !document.fonts?.check || !document.fonts?.ready || !document.fonts[Symbol.iterator]) {
        throw new Error('This browser cannot verify the required level-card fonts. The draft editor is unavailable.');
      }
      const requests = [];
      for (const face of CARD_REQUIRED_FONT_FACES) {
        const styles = face.italic ? ['normal', 'italic'] : ['normal'];
        for (const style of styles) {
          for (const weight of [400, 700]) {
            const font = `${style} ${weight} 32px "${face.family}"`;
            requests.push(document.fonts.load(font, face.family === 'Noto Sans SC Variable' ? '\u6c49\u5b57' : 'CoinSprite')
              .then((loaded) => {
                const exact = [...loaded].some((entry) => normalizedFontFaceFamily(entry.family) === face.family && entry.status === 'loaded');
                const declared = [...document.fonts].some((entry) => normalizedFontFaceFamily(entry.family) === face.family && entry.status === 'loaded');
                if (!exact || !declared || !document.fonts.check(font, face.family === 'Noto Sans SC Variable' ? '\u6c49\u5b57' : 'CoinSprite')) {
                  throw new Error(`Required browser font silently fell back: ${face.family} (${style} ${weight}).`);
                }
              }));
          }
        }
      }
      await Promise.all(requests);
      await document.fonts.ready;
      return true;
    })().catch((error) => {
      cardFontsReadyPromise = null;
      throw error;
    });
    return cardFontsReadyPromise;
  }

  function loadCardFont(item, text) {
    const font = cardFont(item);
    const sample = String(text || 'CoinSprite');
    const key = `${font}\0${sample}`;
    if (cardFontLoads.has(key)) return cardFontLoads.get(key);
    const loading = ensureCardFontsReady()
      .then(() => document.fonts.load(font, sample))
      .catch((error) => {
        cardFontLoads.delete(key);
        throw new Error(`Card draft font failed to load without fallback: ${font}`, { cause: error });
      });
    cardFontLoads.set(key, loading);
    return loading;
  }

  function cardTextValue(selection, layer = cardLayerBySelection(selection)) {
    if (layer?.type === 'text') return layer.text || 'Text';
    const preview = state.profile?.preview || {};
    if (selection === 'username') return String(preview.username || 'Member').normalize('NFKC').replace(/^\*\*([\s\S]+)\*\*$/u, '$1');
    if (selection === 'level') return `LEVEL ${formatNumber(preview.level)}`;
    if (selection === 'rank') return `#${formatNumber(preview.rank)}`;
    if (selection === 'xp') return preview.neededXp
      ? `${formatNumber(preview.progressXp)} / ${formatNumber(preview.neededXp)} XP`
      : `${formatNumber(preview.xp)} XP - MAX LEVEL`;
    return '';
  }

  function cardTextBounds(context, item, text, align = 'left') {
    context.save();
    context.textBaseline = 'top';
    context.textAlign = align;
    context.font = cardFont(item);
    const metrics = context.measureText(String(text || ''));
    let left = -(Number(metrics.actualBoundingBoxLeft) || 0);
    let right = Number(metrics.actualBoundingBoxRight) || Number(metrics.width) || 1;
    if (item.underline) {
      const underlineLeft = align === 'right' ? -metrics.width : 0;
      const underlineRight = align === 'right' ? 0 : metrics.width;
      left = Math.min(left, underlineLeft);
      right = Math.max(right, underlineRight);
    }
    const ascent = Number(metrics.actualBoundingBoxAscent) || 0;
    const descent = Number(metrics.actualBoundingBoxDescent) || Number(item.size) || 1;
    const underlineBottom = item.underline ? Number(item.size) * 1.08 + Math.max(1, Number(item.size) / 30) : descent;
    context.restore();
    return {
      x: item.x + left,
      y: item.y - ascent,
      width: Math.max(1, right - left),
      height: Math.max(1, ascent + Math.max(descent, underlineBottom)),
      resize: 'text',
      rotation: normalizedCardRotation(item.rotation),
    };
  }

  function rotateCardPoint(point, center, degrees) {
    const angle = normalizedCardRotation(degrees) * Math.PI / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
  }

  function cardBoundsCenter(bounds) {
    return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }

  function cardPointInBounds(point, bounds) {
    const local = rotateCardPoint(point, cardBoundsCenter(bounds), -bounds.rotation);
    return local.x >= bounds.x - 5 && local.x <= bounds.x + bounds.width + 5
      && local.y >= bounds.y - 5 && local.y <= bounds.y + bounds.height + 5;
  }

  function cardVisualBounds(bounds) {
    if (!bounds?.rotation) return bounds;
    const center = cardBoundsCenter(bounds);
    const points = [
      { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
      { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
    ].map((point) => rotateCardPoint(point, center, bounds.rotation));
    const x = points.map((point) => point.x);
    const y = points.map((point) => point.y);
    return { x: Math.min(...x), y: Math.min(...y), width: Math.max(...x) - Math.min(...x), height: Math.max(...y) - Math.min(...y) };
  }

  function withCardRotation(context, bounds, draw) {
    context.save();
    const center = cardBoundsCenter(bounds);
    context.translate(center.x, center.y);
    context.rotate(normalizedCardRotation(bounds.rotation) * Math.PI / 180);
    context.translate(-center.x, -center.y);
    draw();
    context.restore();
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
    const item = layer || design[selection];
    if (!item || item.visible === false) return null;
    if (layer?.type === 'text' || ['username', 'level', 'rank', 'xp'].includes(selection)) {
      return cardTextBounds(context, item, cardTextValue(selection, layer), selection === 'rank' ? 'right' : 'left');
    }
    if (layer) return { x: layer.x, y: layer.y, width: layer.width, height: layer.height, resize: 'free', rotation: normalizedCardRotation(layer.rotation) };
    if (selection === 'avatar') return { x: design.avatar.x, y: design.avatar.y, width: design.avatar.size, height: design.avatar.size, resize: 'square', rotation: normalizedCardRotation(design.avatar.rotation) };
    if (selection === 'progress') return { x: design.progress.x, y: design.progress.y, width: design.progress.width, height: design.progress.height, resize: 'free', rotation: normalizedCardRotation(design.progress.rotation) };
    return null;
  }

  function showDraftCardPreview() {
    elements.cardAuthoritativeCanvas.hidden = true;
    elements.cardCanvas.hidden = false;
    elements.cardPreviewLabel.querySelector('strong').textContent = 'Draft preview';
    elements.cardPreviewLabel.querySelector('small').textContent = 'Unsaved browser draft; a server-rendered preview is loading.';
  }

  function scheduleCardDraw() {
    showDraftCardPreview();
    scheduleAuthoritativeCardPreview();
    window.cancelAnimationFrame(cardFrame);
    const request = ++cardDrawRequest;
    cardFrame = window.requestAnimationFrame(async () => {
      try {
        const design = state.profile?.design;
        if (!design) return;
        const textItems = [
          ['username', design.username], ['level', design.level], ['rank', design.rank], ['xp', design.xp],
          ...design.layers.filter((layer) => layer.type === 'text').map((layer) => [`layer:${layer.id}`, layer]),
        ];
        await Promise.all(textItems.map(([selection, item]) => loadCardFont(item, cardTextValue(selection, item))));
        if (request === cardDrawRequest) drawCardPreview();
      } catch (error) {
        if (request === cardDrawRequest) showToast(error.message, 'error');
      }
    });
  }

  function drawCardPreviewText(context, text, item, align = 'left') {
    const bounds = cardTextBounds(context, item, text, align);
    withCardRotation(context, bounds, () => {
      context.textBaseline = 'top';
      context.textAlign = align;
      context.fillStyle = item.color;
      context.font = cardFont(item);
      context.fillText(text, item.x, item.y);
      if (item.underline) {
        const width = context.measureText(text).width;
        const start = align === 'right' ? item.x - width : item.x;
        const y = item.y + item.size * 1.08;
        context.strokeStyle = item.color;
        context.lineWidth = Math.max(1, item.size / 15);
        context.beginPath();
        context.moveTo(start, y);
        context.lineTo(start + width, y);
        context.stroke();
      }
    });
  }

  function cardHandlePositions(bounds) {
    if (!bounds?.resize) return [];
    const points = [
      ['nw', bounds.x, bounds.y], ['n', bounds.x + bounds.width / 2, bounds.y], ['ne', bounds.x + bounds.width, bounds.y],
      ['e', bounds.x + bounds.width, bounds.y + bounds.height / 2],
      ['se', bounds.x + bounds.width, bounds.y + bounds.height], ['s', bounds.x + bounds.width / 2, bounds.y + bounds.height],
      ['sw', bounds.x, bounds.y + bounds.height], ['w', bounds.x, bounds.y + bounds.height / 2],
    ];
    const center = cardBoundsCenter(bounds);
    return points.map(([handle, x, y]) => ({ handle, ...rotateCardPoint({ x, y }, center, bounds.rotation) }));
  }

  function cardHandleMetrics(bounds) {
    const shortest = Math.max(1, Math.min(bounds.width, bounds.height));
    const size = Math.min(10, Math.max(4, shortest * .22));
    return {
      size,
      hitRadius: Math.max(5, size),
      rotateDistance: Math.min(28, Math.max(14, shortest * .45)),
    };
  }

  function cardRotateHandle(bounds) {
    if (!bounds?.resize) return null;
    const center = cardBoundsCenter(bounds);
    const { rotateDistance } = cardHandleMetrics(bounds);
    return { handle: 'rotate', ...rotateCardPoint({ x: bounds.x + bounds.width / 2, y: bounds.y - rotateDistance }, center, bounds.rotation) };
  }

  function drawCardPreview() {
    if (!state.profile || elements.profileShell.hidden) return;
    const { design, preview } = state.profile;
    const canvas = elements.cardCanvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    try {
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

      if (design.avatar.visible !== false) {
        const avatarBounds = cardBounds('avatar', context);
        withCardRotation(context, avatarBounds, () => {
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
        });
      }

      if (design.username.visible !== false) drawCardPreviewText(context, cardTextValue('username'), design.username);
      if (design.level.visible !== false) drawCardPreviewText(context, cardTextValue('level'), design.level);
      if (design.rank.visible !== false) drawCardPreviewText(context, cardTextValue('rank'), design.rank, 'right');

      if (design.progress.visible !== false) {
        const progressBounds = cardBounds('progress', context);
        withCardRotation(context, progressBounds, () => {
          context.fillStyle = design.progress.trackColor;
          cardRoundRect(context, design.progress.x, design.progress.y, design.progress.width, design.progress.height, design.progress.height / 2);
          context.fill();
          const progressWidth = design.progress.width * Math.max(0, Math.min(1, Number(preview.progressRatio) || 0));
          if (progressWidth) {
            context.fillStyle = design.progress.color;
            cardRoundRect(context, design.progress.x, design.progress.y, progressWidth, design.progress.height, design.progress.height / 2);
            context.fill();
          }
        });
      }
      if (design.xp.visible !== false) drawCardPreviewText(context, cardTextValue('xp'), design.xp);

      for (const layer of design.layers) {
        if (layer.visible === false) continue;
        if (layer.type === 'image') {
          const image = cardImage(layer.imageUrl);
          const layerBounds = cardBounds(`layer:${layer.id}`, context);
          if (image) withCardRotation(context, layerBounds, () => context.drawImage(image, layer.x, layer.y, layer.width, layer.height));
        } else drawCardPreviewText(context, layer.text, layer);
      }
    } finally {
      context.restore();
    }

    if (Number.isFinite(state.cardGuides.x) || Number.isFinite(state.cardGuides.y)) {
      context.save();
      context.strokeStyle = '#5ce1e6';
      context.lineWidth = 1.5;
      context.setLineDash([8, 5]);
      if (Number.isFinite(state.cardGuides.x)) {
        context.beginPath(); context.moveTo(state.cardGuides.x, 0); context.lineTo(state.cardGuides.x, 320); context.stroke();
      }
      if (Number.isFinite(state.cardGuides.y)) {
        context.beginPath(); context.moveTo(0, state.cardGuides.y); context.lineTo(1000, state.cardGuides.y); context.stroke();
      }
      context.restore();
    }

    const bounds = cardBounds(state.cardSelection, context);
    if (bounds) {
      context.save();
      context.strokeStyle = '#b9f547';
      context.lineWidth = 2;
      context.setLineDash([7, 5]);
      const controls = cardHandleMetrics(bounds);
      withCardRotation(context, bounds, () => {
        context.strokeRect(bounds.x - 3, bounds.y - 3, bounds.width + 6, bounds.height + 6);
        if (bounds.resize) {
          context.beginPath();
          context.moveTo(bounds.x + bounds.width / 2, bounds.y - 3);
          context.lineTo(bounds.x + bounds.width / 2, bounds.y - controls.rotateDistance);
          context.stroke();
        }
      });
      context.setLineDash([]);
      if (bounds.resize) {
        for (const handle of cardHandlePositions(bounds)) {
          context.fillStyle = '#b9f547';
          context.fillRect(handle.x - controls.size / 2, handle.y - controls.size / 2, controls.size, controls.size);
          context.strokeStyle = '#0b0f0d';
          context.strokeRect(handle.x - controls.size / 2, handle.y - controls.size / 2, controls.size, controls.size);
        }
        const rotate = cardRotateHandle(bounds);
        context.beginPath();
        context.arc(rotate.x, rotate.y, Math.max(3, controls.size * .6), 0, Math.PI * 2);
        context.fillStyle = '#5ce1e6';
        context.fill();
        context.strokeStyle = '#0b0f0d';
        context.stroke();
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
    const row = (selection, icon, label, item, canHide = true) => `<div class="layer-row${item?.visible === false ? ' is-hidden' : ''}">
      <button class="layer-button${state.cardSelection === selection ? ' active' : ''}" type="button" data-card-selection="${escapeHtml(selection)}"><i>${icon}</i><span>${escapeHtml(label)}</span></button>
      ${canHide ? `<button class="layer-visibility" type="button" data-card-visibility="${escapeHtml(selection)}" aria-label="${item?.visible === false ? 'Show' : 'Hide'} ${escapeHtml(label)}" title="${item?.visible === false ? 'Show' : 'Hide'} element">${item?.visible === false ? '○' : '●'}</button>` : ''}
    </div>`;
    const builtins = CARD_BUILTINS.map(([key, icon, label]) => row(key, icon, label, state.profile.design[key], key !== 'background')).join('');
    const layers = state.profile.design.layers.map((layer) => {
      const selection = `layer:${layer.id}`;
      const label = layer.type === 'text' ? layer.text : 'Uploaded image';
      return row(selection, layer.type === 'text' ? 'Aa' : 'IMG', label, layer);
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

  function inspectorSelect(label, path, value) {
    const options = [
      ['sans', 'Noto Sans'], ['serif', 'Noto Serif'], ['mono', 'Roboto Mono'],
      ['rounded', 'Nunito Rounded'], ['condensed', 'Oswald Condensed'], ['handwriting', 'Caveat Handwriting'],
    ]
      .map(([key, name]) => `<option value="${key}"${value === key ? ' selected' : ''}>${name}</option>`).join('');
    return `<label class="wide">${label}<select data-card-field="${path}">${options}</select></label>`;
  }

  function inspectorFormatting(prefix, item) {
    return `<div class="inspector-format wide" aria-label="Text formatting">
      <button type="button" data-card-toggle="${prefix}.bold" class="${item.bold !== false ? 'active' : ''}" aria-pressed="${item.bold !== false}"><b>B</b></button>
      <button type="button" data-card-toggle="${prefix}.italic" class="${item.italic ? 'active' : ''}" aria-pressed="${Boolean(item.italic)}"><i>I</i></button>
      <button type="button" data-card-toggle="${prefix}.underline" class="${item.underline ? 'active' : ''}" aria-pressed="${Boolean(item.underline)}"><u>U</u></button>
    </div>`;
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
        + inspectorInput('Size', 'avatar.size', item.size, { min: 32, max: 240 }) + inspectorInput('Rotation', 'avatar.rotation', item.rotation || 0, { min: -180, max: 180 })
        + inspectorInput('Ring color', 'avatar.color', item.color, { type: 'color', wide: true });
    } else if (selection === 'progress') {
      fields = inspectorInput('X', 'progress.x', item.x) + inspectorInput('Y', 'progress.y', item.y)
        + inspectorInput('Width', 'progress.width', item.width, { min: 40, max: 950 }) + inspectorInput('Height', 'progress.height', item.height, { min: 6, max: 70 })
        + inspectorInput('Rotation', 'progress.rotation', item.rotation || 0, { min: -180, max: 180, wide: true })
        + inspectorInput('Bar color', 'progress.color', item.color, { type: 'color' }) + inspectorInput('Track color', 'progress.trackColor', item.trackColor, { type: 'color' });
    } else if (layer?.type === 'image') {
      fields = inspectorInput('X', `layers.${layer.id}.x`, layer.x) + inspectorInput('Y', `layers.${layer.id}.y`, layer.y)
        + inspectorInput('Width', `layers.${layer.id}.width`, layer.width, { min: 12, max: 800 }) + inspectorInput('Height', `layers.${layer.id}.height`, layer.height, { min: 12, max: 320 })
        + inspectorInput('Rotation', `layers.${layer.id}.rotation`, layer.rotation || 0, { min: -180, max: 180, wide: true })
        + '<div class="inspector-divider"></div><button class="inspector-delete" type="button" data-delete-card-layer>Delete image</button>';
    } else if (layer?.type === 'text') {
      const prefix = `layers.${layer.id}`;
      fields = inspectorInput('Text', `layers.${layer.id}.text`, layer.text, { type: 'textarea', wide: true })
        + inspectorInput('X', `layers.${layer.id}.x`, layer.x) + inspectorInput('Y', `layers.${layer.id}.y`, layer.y)
        + inspectorInput('Font size', `${prefix}.size`, layer.size, { min: 10, max: 96 }) + inspectorInput('Rotation', `${prefix}.rotation`, layer.rotation || 0, { min: -180, max: 180 })
        + inspectorSelect('Font', `${prefix}.fontFamily`, layer.fontFamily || 'sans') + inspectorFormatting(prefix, layer)
        + inspectorInput('Color', `${prefix}.color`, layer.color, { type: 'color', wide: true })
        + '<div class="inspector-divider"></div><button class="inspector-delete" type="button" data-delete-card-layer>Delete text</button>';
    } else {
      const prefix = selection;
      fields = inspectorInput('X', `${selection}.x`, item.x) + inspectorInput('Y', `${selection}.y`, item.y)
        + inspectorInput('Font size', `${selection}.size`, item.size, { min: 12, max: 80 }) + inspectorInput('Rotation', `${selection}.rotation`, item.rotation || 0, { min: -180, max: 180 })
        + inspectorSelect('Font', `${prefix}.fontFamily`, item.fontFamily || 'sans') + inspectorFormatting(prefix, item)
        + inspectorInput('Color', `${selection}.color`, item.color, { type: 'color', wide: true });
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
    target.rotation = normalizedCardRotation(target.rotation);
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
        context.font = cardFont(layer);
        const metrics = context.measureText(layer.text || 'Text');
        layer.width = Math.min(1000, Math.max(1, Math.ceil(metrics.width)));
        layer.height = Math.min(320, Math.max(1, Math.ceil((Number(metrics.actualBoundingBoxAscent) || 0) + (Number(metrics.actualBoundingBoxDescent) || layer.size))));
        layer.weight = layer.bold === false ? 'normal' : 'bold';
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
    const fitted = cardBounds(selection);
    if (fitted.x < 0) target.x -= fitted.x;
    if (fitted.x + fitted.width > 1000) target.x -= fitted.x + fitted.width - 1000;
    if (fitted.y < 0) target.y -= fitted.y;
    if (fitted.y + fitted.height > 320) target.y -= fitted.y + fitted.height - 320;
  }

  function refreshCardDirty() {
    const dirty = cardSnapshot() !== state.profileSavedSnapshot;
    elements.profileSaveDock.hidden = !dirty && !state.cardSaving;
    elements.cardSaveButton.disabled = !dirty || state.cardSaving;
    elements.cardResetButton.disabled = !dirty || state.cardSaving;
    refreshCardHistoryButtons();
  }

  function renderCardStudio(draw = true) {
    renderCardLayers();
    renderCardInspector();
    refreshCardDirty();
    if (draw) scheduleCardDraw();
  }

  function scheduleAuthoritativeCardPreview() {
    window.clearTimeout(state.cardPreviewTimer);
    state.cardPreviewTimer = window.setTimeout(() => {
      loadAuthoritativeCardPreview().catch(() => null);
    }, CARD_PREVIEW_DEBOUNCE_MS);
  }

  function showAuthoritativeCardPreview(draft) {
    elements.cardCanvas.hidden = true;
    elements.cardAuthoritativeCanvas.hidden = false;
    elements.cardPreviewLabel.querySelector('strong').textContent = draft ? 'Authoritative server draft' : 'Authoritative Discord render';
    elements.cardPreviewLabel.querySelector('small').textContent = draft
      ? 'Rendered on the server; save to publish this design to /level.'
      : 'This saved PNG is rendered by the same server used by /level.';
  }

  async function loadAuthoritativeCardPreview() {
    window.clearTimeout(state.cardPreviewTimer);
    state.cardPreviewTimer = null;
    const expectedSavedHash = String(state.profile?.designHash || '');
    const designSnapshot = cardSnapshot();
    const draft = designSnapshot !== state.profileSavedSnapshot;
    const request = ++state.cardPreviewRequest;
    if (!expectedSavedHash) return;
    try {
      const response = await fetch('/api/profile/card/preview', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'image/png',
          'Content-Type': 'application/json',
          'X-CSRF-Token': state.csrfToken,
        },
        body: JSON.stringify({
          designHash: expectedSavedHash,
          draft,
          ...(draft ? { design: state.profile.design } : {}),
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `Authoritative level-card render failed (${response.status})`);
      }
      const responseHash = String(response.headers.get('x-coinsprite-design-hash') || '');
      const responseSource = String(response.headers.get('x-coinsprite-render-source') || '');
      if (request !== state.cardPreviewRequest || expectedSavedHash !== state.profile?.designHash || designSnapshot !== cardSnapshot()) return;
      if (!draft && responseHash !== expectedSavedHash) throw new Error('Authoritative saved preview returned a different design hash.');
      if (responseSource !== (draft ? 'authoritative-draft' : 'authoritative')) throw new Error('Level-card preview did not come from the authoritative renderer.');
      const blobUrl = URL.createObjectURL(await response.blob());
      try {
        const image = new Image();
        image.src = blobUrl;
        await image.decode();
        if (request !== state.cardPreviewRequest || expectedSavedHash !== state.profile?.designHash || designSnapshot !== cardSnapshot()) return;
        if (image.naturalWidth !== 1000 || image.naturalHeight !== 320) throw new Error('Authoritative level-card render returned unexpected dimensions.');
        const context = elements.cardAuthoritativeCanvas.getContext('2d');
        context.clearRect(0, 0, 1000, 320);
        context.drawImage(image, 0, 0);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
      state.cardPreviewHash = responseHash;
      showAuthoritativeCardPreview(draft);
    } catch (error) {
      if (request === state.cardPreviewRequest && expectedSavedHash === state.profile?.designHash && designSnapshot === cardSnapshot()) {
        showDraftCardPreview();
        elements.cardPreviewLabel.querySelector('small').textContent = 'Authoritative server preview unavailable; this remains a labelled browser draft.';
        showToast(error.message, 'error');
      }
      throw error;
    }
  }

  async function loadProfile() {
    try {
      state.profile = await api('/api/profile/card');
      state.profileSavedSnapshot = cardSnapshot();
      state.cardSelection = 'background';
      state.cardUndoStack = [];
      state.cardRedoStack = [];
      state.cardPendingHistory = '';
      renderCardStudio(false);
      await loadAuthoritativeCardPreview();
      await ensureCardFontsReady();
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
      state.profile.updatedAt = payload.updatedAt;
      state.profile.designHash = payload.designHash;
      state.profileSavedSnapshot = cardSnapshot();
      renderCardStudio();
      showToast('Your /level card is updated.');
      await loadAuthoritativeCardPreview();
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
      const before = cardSnapshot();
      if (kind === 'background') {
        state.profile.design.background.imageUrl = payload.url;
        state.profile.design.background.x = 0;
        state.profile.design.background.y = 0;
        state.profile.design.background.scale = 1;
        state.cardSelection = 'background';
      } else {
        const id = `image-${Date.now().toString(36)}`;
        state.profile.design.layers.push({ id, type: 'image', imageUrl: payload.url, x: 420, y: 80, width: 140, height: 140, visible: true, rotation: 0 });
        state.cardSelection = `layer:${id}`;
      }
      commitCardHistory(before);
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
    mutateCardDesign(() => {
      state.profile.design.layers.push({
        id, type: 'text', text: 'Your text', x: 420, y: 155, width: 130, height: 28, size: 28,
        color: '#f4f7f2', weight: 'bold', bold: true, italic: false, underline: false,
        fontFamily: 'sans', visible: true, rotation: 0,
      });
    });
    state.cardSelection = `layer:${id}`;
    renderCardStudio();
    elements.cardInspector.querySelector('textarea')?.focus();
  }

  function canvasPoint(event) {
    const box = elements.cardCanvasWrap.getBoundingClientRect();
    return { x: (event.clientX - box.left) * 1000 / box.width, y: (event.clientY - box.top) * 320 / box.height };
  }

  function hitCardSelection(point) {
    const choices = [
      ...state.profile.design.layers.map((layer) => `layer:${layer.id}`).reverse(),
      'rank', 'xp', 'progress', 'level', 'username', 'avatar', 'background',
    ];
    return choices.find((selection) => {
      const box = cardBounds(selection);
      return box && cardPointInBounds(point, box);
    }) || 'background';
  }

  function cardHandleAtPoint(point, bounds) {
    if (!bounds?.resize) return '';
    const controls = cardHandleMetrics(bounds);
    const rotate = cardRotateHandle(bounds);
    if (Math.hypot(point.x - rotate.x, point.y - rotate.y) <= controls.hitRadius) return 'rotate';
    return cardHandlePositions(bounds).find((handle) => Math.hypot(point.x - handle.x, point.y - handle.y) <= controls.hitRadius)?.handle || '';
  }

  function cardAlignmentTargets(excludedSelection) {
    const x = [{ value: 0, kind: 'start' }, { value: 28, kind: 'start' }, { value: 500, kind: 'center' }, { value: 972, kind: 'end' }, { value: 1000, kind: 'end' }];
    const y = [{ value: 0, kind: 'start' }, { value: 28, kind: 'start' }, { value: 160, kind: 'center' }, { value: 292, kind: 'end' }, { value: 320, kind: 'end' }];
    const selections = [
      ...state.profile.design.layers.map((layer) => `layer:${layer.id}`),
      'avatar', 'username', 'level', 'rank', 'progress', 'xp',
    ];
    for (const selection of selections) {
      if (selection === excludedSelection) continue;
      const bounds = cardVisualBounds(cardBounds(selection));
      if (!bounds) continue;
      x.push({ value: bounds.x, kind: 'start' }, { value: bounds.x + bounds.width / 2, kind: 'center' }, { value: bounds.x + bounds.width, kind: 'end' });
      y.push({ value: bounds.y, kind: 'start' }, { value: bounds.y + bounds.height / 2, kind: 'center' }, { value: bounds.y + bounds.height, kind: 'end' });
    }
    return { x, y };
  }

  function cardSnapAxis(axis, bounds, targets, drag) {
    const origin = axis === 'x' ? bounds.x : bounds.y;
    const size = axis === 'x' ? bounds.width : bounds.height;
    const latchKey = axis === 'x' ? 'snapX' : 'snapY';
    const offsets = [{ value: 0, kind: 'start' }, { value: size / 2, kind: 'center' }, { value: size, kind: 'end' }];
    const latched = drag[latchKey];
    if (latched) {
      const difference = origin + latched.offset - latched.target;
      if (Math.abs(difference) <= CARD_SNAP_RELEASE) return { delta: -difference, guide: latched.target };
      drag[latchKey] = null;
    }
    let best = null;
    for (const offset of offsets) {
      for (const target of targets) {
        if (offset.kind !== target.kind) continue;
        const difference = origin + offset.value - target.value;
        if (Math.abs(difference) <= CARD_SNAP_DISTANCE && (!best || Math.abs(difference) < Math.abs(best.difference))) {
          best = { difference, offset: offset.value, target: target.value };
        }
      }
    }
    if (!best) return { delta: 0 };
    drag[latchKey] = { offset: best.offset, target: best.target };
    return { delta: -best.difference, guide: best.target };
  }

  function snapMovedCardTarget(drag) {
    const bounds = cardVisualBounds(cardBounds());
    if (!bounds) return;
    const targets = cardAlignmentTargets(state.cardSelection);
    const x = cardSnapAxis('x', bounds, targets.x, drag);
    const y = cardSnapAxis('y', bounds, targets.y, drag);
    if ('x' in drag.target) drag.target.x += x.delta;
    if ('y' in drag.target) drag.target.y += y.delta;
    state.cardGuides = { x: x.guide, y: y.guide };
  }

  function oppositeCardAnchor(bounds, handle) {
    const point = {
      x: handle.includes('e') ? bounds.x : handle.includes('w') ? bounds.x + bounds.width : bounds.x + bounds.width / 2,
      y: handle.includes('s') ? bounds.y : handle.includes('n') ? bounds.y + bounds.height : bounds.y + bounds.height / 2,
    };
    return rotateCardPoint(point, cardBoundsCenter(bounds), bounds.rotation);
  }

  function resizeCardTarget(drag, point) {
    const originalBounds = drag.bounds;
    const center = cardBoundsCenter(originalBounds);
    const local = rotateCardPoint(point, center, -originalBounds.rotation);
    const localX = local.x - originalBounds.x;
    const localY = local.y - originalBounds.y;
    const handle = drag.handle;
    let width = handle.includes('e') ? localX : handle.includes('w') ? originalBounds.width - localX : originalBounds.width;
    let height = handle.includes('s') ? localY : handle.includes('n') ? originalBounds.height - localY : originalBounds.height;
    width = Math.max(6, width);
    height = Math.max(6, height);
    const fixedAnchor = oppositeCardAnchor(originalBounds, handle);

    if (originalBounds.resize === 'text') {
      const scales = [];
      if (handle.includes('e') || handle.includes('w')) scales.push(width / originalBounds.width);
      if (handle.includes('n') || handle.includes('s')) scales.push(height / originalBounds.height);
      const scale = Math.max(.1, ...scales);
      const minimum = drag.target.type === 'text' ? 10 : 12;
      const maximum = drag.target.type === 'text' ? 96 : 80;
      drag.target.size = Math.round(Math.min(maximum, Math.max(minimum, drag.original.size * scale)));
    } else if (originalBounds.resize === 'square') {
      drag.target.size = Math.round(Math.max(32, Math.min(240, Math.max(width, height))));
    } else {
      drag.target.width = Math.round(Math.max(12, width));
      drag.target.height = Math.round(Math.max(state.cardSelection === 'progress' ? 6 : 12, height));
    }

    const resizedBounds = cardBounds();
    if (!resizedBounds) return;
    const movedAnchor = oppositeCardAnchor(resizedBounds, handle);
    if ('x' in drag.target) drag.target.x += fixedAnchor.x - movedAnchor.x;
    if ('y' in drag.target) drag.target.y += fixedAnchor.y - movedAnchor.y;
    constrainCardSelection();
  }

  function beginCardPointer(event) {
    if (!state.profile || event.button !== 0) return;
    const point = canvasPoint(event);
    const activeBounds = cardBounds();
    let handle = cardHandleAtPoint(point, activeBounds);
    if (!handle) {
      state.cardSelection = hitCardSelection(point);
      handle = cardHandleAtPoint(point, cardBounds());
    }
    const target = cardSelectionObject();
    const bounds = cardBounds();
    if (!target || !bounds) return;
    const center = cardBoundsCenter(bounds);
    state.cardPointer = {
      id: event.pointerId, start: point, handle, target, original: clone(target), bounds,
      mode: handle === 'rotate' ? 'rotate' : handle ? 'resize' : state.cardSelection === 'background' ? 'background' : 'move',
      startAngle: Math.atan2(point.y - center.y, point.x - center.x),
      historySnapshot: cardSnapshot(),
    };
    state.cardGuides = {};
    elements.cardCanvasWrap.setPointerCapture(event.pointerId);
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
    if (drag.mode === 'background') {
      if (target.imageUrl) { target.x = Math.round(drag.original.x + dx); target.y = Math.round(drag.original.y + dy); }
    } else if (drag.mode === 'rotate') {
      const center = cardBoundsCenter(drag.bounds);
      const angle = Math.atan2(point.y - center.y, point.x - center.x);
      let rotation = normalizedCardRotation(drag.original.rotation + (angle - drag.startAngle) * 180 / Math.PI);
      const snapped = Math.round(rotation / 15) * 15;
      if (event.shiftKey || Math.abs(rotation - snapped) <= 3) rotation = snapped;
      target.rotation = normalizedCardRotation(rotation);
      state.cardGuides = {};
    } else if (drag.mode === 'resize') {
      resizeCardTarget(drag, point);
      state.cardGuides = {};
    } else {
      if ('x' in target) target.x = Math.round(drag.original.x + dx);
      if ('y' in target) target.y = Math.round(drag.original.y + dy);
      constrainCardSelection();
      snapMovedCardTarget(drag);
    }
    if (drag.mode !== 'move' && drag.mode !== 'resize') constrainCardSelection();
    scheduleCardDraw();
    refreshCardDirty();
  }

  function endCardPointer(event) {
    if (!state.cardPointer || state.cardPointer.id !== event.pointerId) return;
    const historySnapshot = state.cardPointer.historySnapshot;
    state.cardPointer = null;
    state.cardGuides = {};
    commitCardHistory(historySnapshot);
    renderCardInspector();
    scheduleCardDraw();
    refreshCardDirty();
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
  elements.cardTemplateButton.addEventListener('click', applyCardTemplate);
  elements.cardUndoButton.addEventListener('click', undoCardDesign);
  elements.cardRedoButton.addEventListener('click', redoCardDesign);
  elements.cardBackgroundFile.addEventListener('change', () => uploadCardMedia(elements.cardBackgroundFile, 'background'));
  elements.cardImageFile.addEventListener('change', () => uploadCardMedia(elements.cardImageFile, 'image'));
  elements.cardLayerList.addEventListener('click', (event) => {
    const visibility = event.target.closest('[data-card-visibility]');
    if (visibility) {
      const selection = visibility.dataset.cardVisibility;
      const target = cardSelectionObject(selection);
      if (!target) return;
      mutateCardDesign(() => { target.visible = target.visible === false; });
      state.cardSelection = selection;
      renderCardStudio();
      return;
    }
    const button = event.target.closest('[data-card-selection]');
    if (!button) return;
    state.cardSelection = button.dataset.cardSelection;
    renderCardStudio();
  });
  elements.cardInspector.addEventListener('input', (event) => {
    const input = event.target.closest('[data-card-field]');
    if (!input || !state.profile) return;
    beginCardInputHistory();
    setCardField(input.dataset.cardField, input.value);
    constrainCardSelection();
    const constrained = getCardField(input.dataset.cardField);
    if (typeof constrained === 'number') input.value = String(Math.round(constrained * 100) / 100);
    if (input.tagName === 'TEXTAREA') renderCardLayers();
    scheduleCardDraw();
    refreshCardDirty();
  });
  elements.cardInspector.addEventListener('focusin', (event) => {
    if (event.target.closest('[data-card-field]')) beginCardInputHistory();
  });
  elements.cardInspector.addEventListener('change', (event) => {
    if (event.target.closest('[data-card-field]')) finishCardInputHistory();
  });
  elements.cardInspector.addEventListener('focusout', (event) => {
    if (event.target.closest('[data-card-field]')) finishCardInputHistory();
  });
  elements.cardInspector.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-card-toggle]');
    if (toggle) {
      const path = toggle.dataset.cardToggle;
      mutateCardDesign(() => {
        setCardField(path, !getCardField(path));
        constrainCardSelection();
      });
      renderCardInspector();
      scheduleCardDraw();
      refreshCardDirty();
      return;
    }
    if (!event.target.closest('[data-delete-card-layer]')) return;
    const layer = cardLayerBySelection();
    if (!layer) return;
    mutateCardDesign(() => {
      state.profile.design.layers = state.profile.design.layers.filter((item) => item.id !== layer.id);
    });
    state.cardSelection = 'background';
    renderCardStudio();
  });
  elements.cardCanvasWrap.addEventListener('pointerdown', beginCardPointer);
  elements.cardCanvasWrap.addEventListener('pointermove', moveCardPointer);
  elements.cardCanvasWrap.addEventListener('pointerup', endCardPointer);
  elements.cardCanvasWrap.addEventListener('pointercancel', endCardPointer);
  elements.cardSaveButton.addEventListener('click', saveProfileCard);
  elements.cardResetButton.addEventListener('click', () => {
    if (!state.profile || state.cardSaving || !state.profileSavedSnapshot) return;
    mutateCardDesign(() => { state.profile.design = JSON.parse(state.profileSavedSnapshot); });
    state.cardSelection = 'background';
    renderCardStudio();
    showToast('Unsaved card changes reset.');
  });
  window.addEventListener('keydown', (event) => {
    if (!state.profile || elements.profileShell.hidden || !(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z') {
      event.preventDefault();
      if (event.shiftKey) redoCardDesign();
      else undoCardDesign();
    } else if (key === 'y') {
      event.preventDefault();
      redoCardDesign();
    }
  });
  elements.saveButton.addEventListener('click', saveConfig);
  elements.resetButton.addEventListener('click', resetUnsavedChanges);
  elements.logoutButton.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null);
    location.assign('/admin');
  });
  elements.levelingView.addEventListener('input', (event) => updateLevelingFromControl(event.target));
  elements.levelingView.addEventListener('change', (event) => updateLevelingFromControl(event.target));
  elements.rngGameView.addEventListener('input', (event) => updateRngGameFromControl(event.target));
  elements.rngGameView.addEventListener('change', (event) => updateRngGameFromControl(event.target));
  for (const preview of [elements.levelingMessagePreview, elements.xpDropMessagePreview, elements.xpDropClaimPreview]) {
    preview.addEventListener('click', (event) => {
      const edit = event.target.closest('[data-inline-message-display]');
      if (edit) return beginInlineMessageEdit(edit);
      const done = event.target.closest('[data-inline-message-done]');
      if (done) finishInlineMessageEdit(done.closest('[data-inline-message-editor]'));
    });
    preview.addEventListener('keydown', (event) => {
      const edit = event.target.closest('[data-inline-message-display]');
      if (edit && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        beginInlineMessageEdit(edit);
        return;
      }
      if (event.target.matches('[data-inline-message-input]') && event.key === 'Escape') event.target.blur();
    });
    preview.addEventListener('focusout', (event) => {
      const editor = event.target.closest('[data-inline-message-editor]');
      if (!editor) return;
      window.setTimeout(() => {
        if (!editor.contains(document.activeElement)) finishInlineMessageEdit(editor);
      }, 0);
    });
    preview.addEventListener('scroll', (event) => {
      const input = event.target.closest?.('[data-inline-message-input]');
      const mirror = input?.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-highlight]');
      if (input && mirror) mirror.style.transform = `translateY(-${input.scrollTop}px)`;
    }, true);
  }
  elements.levelingAddReward.addEventListener('click', addLevelReward);
  elements.levelingAddBoost.addEventListener('click', addLevelBoost);
  elements.xpDropAdd.addEventListener('click', addXpDrop);
  elements.xpDropTestButton.addEventListener('click', sendXpDropTest);
  elements.xpDropTestCrate.addEventListener('change', renderXpDropMessagePreviews);
  elements.xpDropVariables.addEventListener('click', async (event) => {
    const variable = event.target.closest('[data-copy-variable]');
    if (!variable) return;
    await navigator.clipboard?.writeText?.(variable.dataset.copyVariable).catch(() => null);
    showToast(`${variable.dataset.copyVariable} copied.`);
  });
  elements.xpDropList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-remove-xp-drop]');
    if (!button || !state.config) return;
    state.config.leveling.xpDrops.crates.splice(Number(button.dataset.removeXpDrop), 1);
    renderXpDrops();
    refreshDirty();
  });
  elements.xpDropList.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-xp-drop-media]');
    if (upload) uploadXpDropMedia(upload);
  });
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
  document.addEventListener('click', (event) => {
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
      await loadGuild(guildId);
      const preferred = state.config?.features?.leveling ? 'leveling' : (state.config?.features?.rngGame ? 'rng-game' : 'owner');
      setView(preferred);
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
      const featureInputs = [...input.closest('.feature-dropdown').querySelectorAll('[data-owner-feature]')];
      const features = Object.fromEntries(featureInputs.map((featureInput) => [featureInput.dataset.ownerFeature, featureInput.checked]));
      const payload = await api(`/api/owner/guilds/${input.dataset.guildId}/features`, {
        method: 'PATCH',
        body: JSON.stringify({ features }),
      });
      if (state.guildId === input.dataset.guildId && state.config) {
        state.config.features = payload.features;
        state.config.leveling = normalizeLevelingConfig(payload.config);
        state.config.rngGame = normalizeRngGameConfig(payload.config);
        state.savedConfig = clone(state.config);
        state.savedSnapshot = snapshot();
        renderFeatureAccess();
      }
      const featureLabel = input.dataset.ownerFeature === 'rngGame' ? 'RNG Game' : 'Leveling';
      showToast(`${featureLabel} ${input.checked ? 'unlocked' : 'locked'} for this server.`);
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
