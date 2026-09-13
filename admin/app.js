Warning: truncated output (original token count: 83783)
Total output lines: 5376

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
  const EMPTY_EMOJI_DATA = Object.freeze({ version: '', emojiCount: 0, groups: Object.freeze([]) });
  const DEFAULT_EMOJI_DATA_URL = document.querySelector('#emojiDataAsset')?.dataset.src || '/admin/emojiData.js';
  const EMOJI_RENDER_BATCH = 96;
  const EMOJI_SEARCH_DEBOUNCE_MS = 120;
  let DEFAULT_EMOJI_DATA = window.COINSPRITE_EMOJI_DATA || EMPTY_EMOJI_DATA;
  let defaultEmojiDataPromise = null;
  let emojiSearchTimer = null;
  const defaultEmojiItemCache = new Map();
  const directoryEmojiItemCache = new Map();
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
    directory: { channels: [], roles: [], emojis: { bot: [], group: [], errors: {} }, botPermissions: { usable: true, missing: [] } },
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
    memberMessageEvent: 'join',
    memberMessageComposerPanel: '',
    messageTemplates: { folders: [], items: [] },
    templateFolderId: 'all',
    templateSelectedId: '',
    templateDraft: null,
    templateSavedSnapshot: '',
    templateTab: 'editor',
    templateComposerPanel: '',
    templateJsonValid: true,
    templateControlsValid: true,
    templateSaving: false,
    templateSaveError: '',
    templatePickerContext: '',
    templateActionTarget: null,
    reactionRoles: { items: [] },
    reactionRoleSelectedId: '',
    reactionRoleDraft: null,
    reactionRoleSavedSnapshot: '',
    reactionRoleTab: 'message',
    reactionRoleComposerPanel: '',
    reactionRoleSaving: false,
    emojiSection: 'bot',
    emojiCategory: DEFAULT_EMOJI_DATA.groups[0]?.id || '',
    emojiPickerItems: [],
    emojiRenderedCount: 0,
    emojiTarget: null,
    inlineTextCarets: new Map(),
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
    appShell: $('#appShell'), loginPanel: $('#loginPanel'), loginStatus: $('#loginStatus'), loginButton: $('#loginButton'),
    logoutButton: $('#logoutButton'), accountWrap: $('#accountWrap'), accountMenu: $('#accountMenu'),
    userChip: $('#userChip'), userAvatar: $('#userAvatar'), sessionLabel: $('#sessionLabel'), mobileNavToggle: $('#mobileNavToggle'),
    guildSelect: $('#guildSelect'), serverMeta: $('#serverMeta'), ownerNav: $('#ownerNav'), levelingNav: $('#levelingNav'), welcomeMessagesNav: $('#welcomeMessagesNav'), messageTemplatesNav: $('#messageTemplatesNav'), reactionRolesNav: $('#reactionRolesNav'), gamesNav: $('#gamesNav'),
    levelingView: $('#levelingView'), welcomeMessagesView: $('#welcomeMessagesView'), messageTemplatesView: $('#messageTemplatesView'), reactionRolesView: $('#reactionRolesView'), gamesView: $('#gamesView'), ownerView: $('#ownerView'), toast: $('#toast'),
    saveDock: $('#saveDock'),
    saveButton: $('#saveButton'), resetButton: $('#resetButton'), saveState: $('#saveState'), ownerOverview: $('#ownerOverview'),
    ownerRefresh: $('#ownerRefresh'), consoleOutput: $('#consoleOutput'), consoleClear: $('#consoleClear'),
    consoleToggle: $('#consoleToggle'), dialog: $('#confirmDialog'), dialogTitle: $('#dialogTitle'), dialogCopy: $('#dialogCopy'),
    dialogInputWrap: $('#dialogInputWrap'), dialogInput: $('#dialogInput'), dialogConfirm: $('#dialogConfirm'),
    levelingEnabled: $('#levelingEnabled'), levelingXpMin: $('#levelingXpMin'), levelingXpMax: $('#levelingXpMax'),
    levelingCooldown: $('#levelingCooldown'), levelingBaseXp: $('#levelingBaseXp'), levelingGrowth: $('#levelingGrowth'),
    levelingMaxLevel: $('#levelingMaxLevel'), levelingCurvePreview: $('#levelingCurvePreview'),
    countingChannel: $('#countingChannel'), gameCommandSettings: $('#gameCommandSettings'), gameAddCommandSetting: $('#gameAddCommandSetting'),
    levelingAnnounceEnabled: $('#levelingAnnounceEnabled'), levelingAnnounceChannel: $('#levelingAnnounceChannel'),
    levelingChannels: $('#levelingChannels'),
    levelingStackRewards: $('#levelingStackRewards'), levelingRewards: $('#levelingRewards'),
    levelingAddReward: $('#levelingAddReward'), levelingBoosts: $('#levelingBoosts'), levelingAddBoost: $('#levelingAddBoost'),
    levelingContainerAdd: $('#levelingContainerAdd'), levelingAdditionalContainerAdd: $('#levelingAdditionalContainerAdd'), levelingThumbnailAdd: $('#levelingThumbnailAdd'),
    levelingGalleryAdd: $('#levelingGalleryAdd'), levelingVariablesToggle: $('#levelingVariablesToggle'), levelingEmojiToggle: $('#levelingEmojiToggle'),
    levelingComposerPanel: $('#levelingComposerPanel'),
    levelingDiscordFrame: $('#levelingDiscordFrame'), levelingMessagePreview: $('#levelingMessagePreview'), levelingAdditionalContainers: $('#levelingAdditionalContainers'),
    levelingAccentButton: $('#levelingAccentButton'), levelingAccentColor: $('#levelingAccentColor'),
    welcomeMessagesEnabled: $('#welcomeMessagesEnabled'), welcomeEventEnabled: $('#welcomeEventEnabled'),
    welcomeEventChannel: $('#welcomeEventChannel'), welcomeEventReset: $('#welcomeEventReset'),
    welcomeEventStep: $('#welcomeEventStep'), welcomeEventTitle: $('#welcomeEventTitle'), welcomeEventDescription: $('#welcomeEventDescription'),
    welcomeEventToggleCopy: $('#welcomeEventToggleCopy'), welcomePreviewLabel: $('#welcomePreviewLabel'),
    welcomeVariablesToggle: $('#welcomeVariablesToggle'), welcomeContainerAdd: $('#welcomeContainerAdd'), welcomeAdditionalContainerAdd: $('#welcomeAdditionalContainerAdd'),
    welcomeThumbnailAdd: $('#welcomeThumbnailAdd'), welcomeGalleryAdd: $('#welcomeGalleryAdd'), welcomeEmojiToggle: $('#welcomeEmojiToggle'),
    welcomeComposerPanel: $('#welcomeComposerPanel'), welcomeDiscordFrame: $('#welcomeDiscordFrame'),
    welcomeMessagePreview: $('#welcomeMessagePreview'), welcomeAdditionalContainers: $('#welcomeAdditionalContainers'), welcomeAccentButton: $('#welcomeAccentButton'), welcomeAccentColor: $('#welcomeAccentColor'),
    levelingUseTemplate: $('#levelingUseTemplate'), levelingSaveAsTemplate: $('#levelingSaveAsTemplate'),
    welcomeUseTemplate: $('#welcomeUseTemplate'), welcomeSaveAsTemplate: $('#welcomeSaveAsTemplate'),
    templateManager: $('#templateManager'), templateTotalCount: $('#templateTotalCount'), templateFolderCreate: $('#templateFolderCreate'),
    templateFolderList: $('#templateFolderList'), templateSearch: $('#templateSearch'), templateListCreate: $('#templateListCreate'), templateList: $('#templateList'),
    templateCreateButton: $('#templateCreateButton'), templateEmptyCreate: $('#templateEmptyCreate'), templateEmptyState: $('#templateEmptyState'), templateEditor: $('#templateEditor'),
    templateStatusBadge: $('#templateStatusBadge'), templateEditorTitle: $('#templateEditorTitle'), templateTimestamps: $('#templateTimestamps'),
    templateDuplicateButton: $('#templateDuplicateButton'), templateDeleteButton: $('#templateDeleteButton'),
    templateVariablesToggle: $('#templateVariablesToggle'), templateContainerAdd: $('#templateContainerAdd'), templateAdditionalContainerAdd: $('#templateAdditionalContainerAdd'), templateThumbnailAdd: $('#templateThumbnailAdd'), templateGalleryAdd: $('#templateGalleryAdd'), templateEmojiToggle: $('#templateEmojiToggle'),
    templateComposerPanel: $('#templateComposerPanel'), templateDiscordFrame: $('#templateDiscordFrame'), templateMessagePreview: $('#templateMessagePreview'), templateAdditionalContainers: $('#templateAdditionalContainers'),
    templateControlPreview: $('#templateControlPreview'), templateControls: $('#templateControls'), templateAddControl: $('#templateAddControl'),
    templateAccentButton: $('#templateAccentButton'), templateAccentColor: $('#templateAccentColor'), templateCharacterCount: $('#templateCharacterCount'),
    templateJsonEditor: $('#templateJsonEditor'), templateJsonError: $('#templateJsonError'), templateJsonFormat: $('#templateJsonFormat'), templateJsonCopy: $('#templateJsonCopy'), templateJsonImport: $('#templateJsonImport'), templateResolvedPayload: $('#templateResolvedPayload'),
    templateName: $('#templateName'), templateDescription: $('#templateDescription'), templateFolderSelect: $('#templateFolderSelect'), templateChannel: $('#templateChannel'), templateEnabled: $('#templateEnabled'),
    templateVariableReference: $('#templateVariableReference'), templateSendHint: $('#templateSendHint'), templateSendChannel: $('#templateSendChannel'), templateSendTest: $('#templateSendTest'), templateSendNow: $('#templateSendNow'),
    templateShareLink: $('#templateShareLink'), templateCopyLink: $('#templateCopyLink'), templatePickerDialog: $('#templatePickerDialog'), templatePickerSearch: $('#templatePickerSearch'), templatePickerList: $('#templatePickerList'),
    templateActionDialog: $('#templateActionDialog'), templateActionTitle: $('#templateActionTitle'), templateActionCopy: $('#templateActionCopy'), templateActionTargetLabel: $('#templateActionTargetLabel'), templateActionTarget: $('#templateActionTarget'), templateActionHelp: $('#templateActionHelp'), templateActionSave: $('#templateActionSave'),
    xpDropsEnabled: $('#xpDropsEnabled'), xpDropChannel: $('#xpDropChannel'), xpDropAdd: $('#xpDropAdd'), xpDropList: $('#xpDropList'),
    xpDropVariables: $('#xpDropVariables'), xpDropMessagePreview: $('#xpDropMessagePreview'), xpDropClaimPreview: $('#xpDropClaimPreview'), xpDropEmojiToggle: $('#xpDropEmojiToggle'), xpClaimEmojiToggle: $('#xpClaimEmojiToggle'),
    xpDropTestCrate: $('#xpDropTestCrate'), xpDropTestChannel: $('#xpDropTestChannel'), xpDropTestButton: $('#xpDropTestButton'),
    reactionRoleCreate: $('#reactionRoleCreate'), reactionRoleEmptyCreate: $('#reactionRoleEmptyCreate'), reactionRoleCount: $('#reactionRoleCount'), reactionRoleList: $('#reactionRoleList'),
    reactionRoleEmpty: $('#reactionRoleEmpty'), reactionRoleEditor: $('#reactionRoleEditor'), reactionRoleStatus: $('#reactionRoleStatus'), reactionRoleName: $('#reactionRoleName'), reactionRolePublishedState: $('#reactionRolePublishedState'), reactionRoleEnabled: $('#reactionRoleEnabled'),
    reactionRoleDuplicate: $('#reactionRoleDuplicate'), reactionRoleDelete: $('#reactionRoleDelete'), reactionRoleUseTemplate: $('#reactionRoleUseTemplate'), reactionRoleEmojiToggle: $('#reactionRoleEmojiToggle'), reactionRoleVariablesToggle: $('#reactionRoleVariablesToggle'), reactionRoleContainerToggle: $('#reactionRoleContainerToggle'), reactionRoleAdditionalContainer: $('#reactionRoleAdditionalContainer'), reactionRoleThumbnailToggle: $('#reactionRoleThumbnailToggle'), reactionRoleGalleryToggle: $('#reactionRoleGalleryToggle'),
    reactionRoleComposerPanel: $('#reactionRoleComposerPanel'), reactionRoleDiscordFrame: $('#reactionRoleDiscordFrame'), reactionRoleAccentButton: $('#reactionRoleAccentButton'), reactionRoleAccentColor: $('#reactionRoleAccentColor'), reactionRoleMessagePreview: $('#reactionRoleMessagePreview'), reactionRoleAdditionalContainers: $('#reactionRoleAdditionalContainers'), reactionRoleControlPreview: $('#reactionRoleControlPreview'), reactionRoleControls: $('#reactionRoleControls'), reactionRoleAddControl: $('#reactionRoleAddControl'), reactionRoleChannel: $('#reactionRoleChannel'), reactionRolePermissionStatus: $('#reactionRolePermissionStatus'), reactionRoleFinalPreview: $('#reactionRoleFinalPreview'), reactionRoleSaveDraft: $('#reactionRoleSaveDraft'), reactionRolePublish: $('#reactionRolePublish'),
    emojiPickerDialog: $('#emojiPickerDialog'), emojiPickerClose: $('#emojiPickerClose'), emojiPickerSearch: $('#emojiPickerSearch'), emojiPickerStatus: $('#emojiPickerStatus'), emojiPickerCategories: $('#emojiPickerCategories'), emojiPickerGrid: $('#emojiPickerGrid'),
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
  function showToast(message, kind = '', link = '') {
    window.clearTimeout(toastTimer);
    elements.toast.replaceChildren(document.createTextNode(message));
    if (link) {
      const anchor = document.createElement('a');
      anchor.href = link;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = ' Open message';
      elements.toast.append(anchor);
    }
    elements.toast.className = `toast${kind ? ` ${kind}` : ''}`;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => { elements.toast.hidden = true; }, 3800);
  }

  function renderSession() {
    const user = state.me?.user;
    const profileRoute = location.pathname.startsWith('/profile');
    const returnTo = `${location.pathname}${location.search}`;
    elements.loginButton.href = `/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
    elements.loginPanel.hidden = Boolean(user);
    elements.appShell.hidden = !user || profileRoute;
    elements.profileShell.hidden = !user || !profileRoute;
    document.body.classList.toggle('is-authenticated', Boolean(user));
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

  const MAX_ADDITIONAL_MESSAGE_CONTAINERS = 2;

  function newAdditionalContainer(accentColor = '#b9f547') {
    return {
      content: '',
      layout: {
        container: true,
        accentColor: /^#[0-9a-f]{6}$/i.test(accentColor) ? accentColor.toLowerCase() : '#b9f547',
        thumbnailEnabled: false,
        thumbnailUrl: '',
        galleryUrls: [],
      },
    };
  }

  function normalizeAdditionalContainersClient(value, normalizeLayout, maximumContent = 3000) {
    return (Array.isArray(value) ? value : []).slice(0, MAX_ADDITIONAL_MESSAGE_CONTAINERS).map((container) => ({
      content: String(container?.content || '').slice(0, maximumContent),
      layout: { ...normalizeLayout(container?.layout), container: true },
    }));
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
    source.announcements.additionalContainers = normalizeAdditionalContainersClient(source.announcements.additionalContainers, (layout) => {
      const normalized = layout && typeof layout === 'object' && !Array.isArray(layout) ? layout : {};
      return {
        container: true,
        accentColor: /^#[0-9a-f]{6}$/i.test(normalized.accentColor || '') ? normalized.accentColor.toLowerCase() : source.announcements.layout.accentColor,
        thumbnailEnabled: normalized.thumbnailEnabled === true,
        thumbnailUrl: validMediaTemplate(normalized.thumbnailUrl) ? String(normalized.thumbnailUrl).trim() : '',
        galleryUrls: [...new Set((Array.isArray(normalized.galleryUrls) ? normalized.galleryUrls : [])
          .map((url) => String(url).trim()).filter(validMediaTemplate))].slice(0, 10),
      };
    });
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
    source.xpDrops.channelId = String(source.xpDrops.channelId || '');
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

  function normalizeCountingConfig(config) {
    return { channelId: String(config?.counting?.channelId || '') };
  }

  function normalizeGamesConfig(config) {
    return {
      lotteryChannelId: String(config?.games?.lotteryChannelId || ''),
      commandSettings: (Array.isArray(config?.games?.commandSettings) ? config.games.commandSettings : []).map((setting, index) => ({
        id: String(setting?.id || `setting-${index + 1}`),
        channelIds: [...new Set((Array.isArray(setting?.channelIds) ? setting.channelIds : []).map(String).filter(Boolean))],
        commands: [...new Set((Array.isArray(setting?.commands) ? setting.commands : []).map(String).filter((command) => ['cs-work', 'cs-beg', 'cs-balance', 'cs-inventory', 'cs-achievements', 'cs-shop', 'cs-trivia'].includes(command)))],
      })),
    };
  }

  const MEMBER_MESSAGE_DEFAULTS = Object.freeze({
    enabled: true,
    join: Object.freeze({ enabled: false, channelId: '', template: '## Welcome to {server}, {user}! 🎉\nYou’re member **#{member_count}**. We’re happy to have you here!', layout: Object.freeze({ container: true, accentColor: '#57f287', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]) }), additionalContainers: Object.freeze([]) }),
    leave: Object.freeze({ enabled: false, channelId: '', template: '## {display_name} has left the server\nThanks for being part of {server}. We now have **{member_count}** members.', layout: Object.freeze({ container: true, accentColor: '#ed4245', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]) }), additionalContainers: Object.freeze([]) }),
    boost: Object.freeze({ enabled: false, channelId: '', template: '## Thank you for boosting, {user}! 💜\n{server} now has **{boost_count} boosts** and is at **Boost Level {boost_level}**.', layout: Object.freeze({ container: true, accentColor: '#f47fff', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]) }), additionalContainers: Object.freeze([]) }),
  });

  function validMemberMediaTemplate(value) {
    const text = String(value || '').trim();
    if (['{user_avatar}', '{server_icon}'].includes(text.toLowerCase())) return true;
    try { return ['http:', 'https:'].includes(new URL(text).protocol); } catch { return false; }
  }

  function normalizeMemberMessagesConfig(config) {
    const source = clone(config?.memberMessages || {});
    source.enabled = source.enabled !== false;
    for (const type of ['join', 'leave', 'boost']) {
      const defaults = MEMBER_MESSAGE_DEFAULTS[type];
      const event = source[type] && typeof source[type] === 'object' && !Array.isArray(source[type]) ? source[type] : {};
      event.enabled = event.enabled === true;
      event.channelId = String(event.channelId || '');
      event.template = String(event.template || defaults.template).trim().slice(0, 3000) || defaults.template;
      event.layout = event.layout && typeof event.layout === 'object' && !Array.isArray(event.layout) ? event.layout : {};
      event.layout.container = event.layout.container !== false;
      event.layout.accentColor = /^#[0-9a-f]{6}$/i.test(event.layout.accentColor || '') ? event.layout.accentColor.toLowerCase() : defaults.layout.accentColor;
      event.layout.thumbnailEnabled = event.layout.thumbnailEnabled === true;
      event.layout.thumbnailUrl = validMemberMediaTemplate(event.layout.thumbnailUrl) ? String(event.layout.thumbnailUrl).trim() : '';
      event.layout.galleryUrls = [...new Set((Array.isArray(event.layout.galleryUrls) ? event.layout.galleryUrls : [])
        .map((url) => String(url).trim()).filter(validMemberMediaTemplate))].slice(0, 10);
      event.additionalContainers = normalizeAdditionalContainersClient(event.additionalContainers, (layout) => {
        const normalized = normalizeTemplateLayoutClient(layout);
        normalized.accentColor = /^#[0-9a-f]{6}$/i.test(layout?.accentColor || '') ? normalized.accentColor : event.layout.accentColor;
        return normalized;
      });
      source[type] = event;
    }
    return source;
  }

  function channelOptions(selected, include = () => true, emptyLabel = 'Not routed') {
    const multiple = Array.isArray(selected);
    const selectedIds = new Set((multiple ? selected : [selected]).map(String).filter(Boolean));
    const listedIds = new Set();
    const options = [`<option value="" ${multiple ? 'disabled' : ''}>${escapeHtml(emptyLabel)}</option>`];
    let lastParent = null;
    for (const channel of state.directory.channels.filter((item) => !item.archived && include(item))) {
      if (channel.parentName && channel.parentName !== lastParent) {
        options.push(`<option disabled>── ${escapeHtml(channel.parentName)} ──</option>`);
        lastParent = channel.parentName;
      }
      const prefix = channel.kind === 'thread' ? '⌁' : channel.kind === 'forum' ? '▦' : '#';
      listedIds.add(channel.id);
      options.push(`<option value="${channel.id}" ${selectedIds.has(channel.id) ? 'selected' : ''}>${prefix} ${escapeHtml(channel.name)}</option>`);
    }
    for (const id of selectedIds) {
      if (!listedIds.has(id)) options.push(`<option value="${escapeHtml(id)}" selected disabled>Unavailable channel (${escapeHtml(id)})</option>`);
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
    return ['<option value="">Choose a Discord role</option>', ...roles.map((role) => {
      const unavailable = role.editable === false || role.managed === true || role.administrator === true;
      const reason = role.administrator ? ' (Administrator blocked)' : role.managed ? ' (managed role)' : role.editable === false ? ' (above CoinSprite)' : '';
      return `<option value="${role.id}" style="color:${roleColor(role.id)}" ${role.id === selected ? 'selected' : ''} ${unavailable ? 'disabled' : ''}>\u25cf @${escapeHtml(role.name)}${reason}</option>`;
    })].join('');
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
    ['{list_claimed_user}', 'Members who claimed'],
    ['{chance}', 'Drop chance percent'], ['{drop_every}', 'Drop interval'], ['{despawn_time}', 'Despawn interval or never'],
    ['{user}', 'Claiming member mention'], ['{username}', 'Claiming display name'], ['{level}', 'Member level'],
    ['{total_xp}', 'Member total XP'], ['{server}', 'Server name'], ['{channel}', 'Drop channel'], ['{separator}', 'Discord divider'],
  ];

  function xpDropDurationEditor(value, index, field, label, optional = false) {
    const match = String(value || '').match(/^(\d+(?:\.\d+)?)([smhd])$/i);
    const amount = match?.[1] || (optional ? '' : '30');
    const unit = match?.[2]?.toLowerCase() || 'm';
    const units = [['s', 'Seconds'], ['m', 'Minutes'], ['h', 'Hours'], ['d', 'Days']];
    return `<span class="xp-drop-duration" role="group" aria-label="${escapeHtml(label)}">
      <input type="number" min="0" max="31536000" step="any" inputmode="decimal" value="${escapeHtml(amount)}" placeholder="${optional ? 'Never' : '30'}" data-xp-drop-field="${field}" data-xp-drop-duration-part="amount" data-xp-drop-index="${index}" aria-label="${escapeHtml(label)} amount">
      <select data-xp-drop-field="${field}" data-xp-drop-duration-part="unit" data-xp-drop-index="${index}" aria-label="${escapeHtml(label)} unit">${units.map(([key, name]) => `<option value="${key}" ${key === unit ? 'selected' : ''}>${name}</option>`).join('')}</select>
    </span>`;
  }

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
            <label class="wide"><span>Fallback channel</span><select data-xp-drop-field="channelId" data-xp-drop-index="${index}">${channelOptions(crate.channelId, (channel) => channel.kind !== 'forum', 'Use global crate channel')}</select><small>Used only when no global crate channel is selected</small></label>
            <label><span>Drop every</span>${xpDropDurationEditor(crate.dropEvery, index, 'dropEvery', 'Drop every')}<small>Choose an amount and time unit</small></label>
            <label><span>Chance (%)</span><input type="number" min="0" max="100" step="0.01" value="${crate.chancePercent}" data-xp-drop-field="chancePercent" data-xp-drop-index="${index}"></label>
            <label><span>Claim limit</span><input type="number" min="1" max="1000" value="${crate.claimLimit}" data-xp-drop-field="claimLimit" data-xp-drop-index="${index}"></label>
            <label><span>Despawn after</span>${xpDropDurationEditor(crate.despawnAfter, index, 'despawnAfter', 'Despawn after', true)}<small>Leave the amount empty for no despawn</small></label>
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
    elements.xpDropChannel.innerHTML = channelOptions(xpDrops.channelId, (channel) => channel.kind !== 'forum', 'Choose a drop channel');
    elements.xpDropVariables.innerHTML = XP_DROP_VARIABLES.map(([token, meaning]) => `<button type="button" data-copy-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('');
    renderXpDropList();
    elements.xpDropTestCrate.innerHTML = xpDrops.crates.length
      ? xpDrops.crates.map((crate) => `<option value="${escapeHtml(crate.id)}" ${crate.id === selectedCrate ? 'selected' : ''}>${escapeHtml(crate.name)}</option>`).join('')
      : '<option value="">Add a crate first</option>';
    elements.xpDropTestChannel.innerHTML = channelOptions(selectedChannel, (channel) => channel.kind !== 'forum');
    elements.xpDropTestChannel.options[0].textContent = 'Use configured crate drop channel';
    elements.xpDropTestButton.disabled = state.xpDropTesting || !xpDrops.crates.length;
    elements.xpDropTestButton.textContent = state.xpDropTesting ? 'Sending…' : 'Send test';
    renderXpDropMessagePreviews();
  }

  function addXpDrop() {
    const crates = state.config?.leveling?.xpDrops?.crates;
    if (!crates || crates.length >= 100) return;
    const id = `crate-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`.slice(0, 40);
    crates.push({
      id, enabled: true, name: `Crate ${crates.length + 1}`, imageUrl: '', xp: { min: 50, max: 100 },
      channelId: '', dropEvery: '30m', chancePercent: 100, claimLimit: 1,
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
      .replace(/\{(?:user|user_profile|username|level|next_level|server|channel|bar|progress_xp|needed_xp|total_xp|crate_name|xp_min|xp_max|xp|claim_limit|claims_left|list_claimed_user|chance|drop_every|despawn_time|separator)\}/gi, (token) => stash(`<span class="editor-token">${token}</span>`));
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

  function interpolateTemplate(template, values = {}) {
    return String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (token, key) => (
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : token
    ));
  }

  function previewMessageValue(template, extraValues = {}) {
    const xpDrops = state.config?.leveling?.xpDrops;
    const crate = xpDrops?.crates?.find((item) => item.id === elements.xpDropTestCrate?.value) || xpDrops?.crates?.[0];
    const minimum = crate?.xp?.min ?? 50;
    const maximum = crate?.xp?.max ?? 100;
    const claimed = Math.round((Number(minimum) + Number(maximum)) / 2);
    return interpolateTemplate(template, {
      user: '@GardenHero', user_profile: 'https://cdn.discordapp.com/embed/avatars/0.png', username: 'GardenHero',
      level: '12', next_level: '13', server: 'Grow a Garden', bar: '■■■■■■■■□□□□', progress_xp: '280',
      needed_xp: '420', total_xp: '3,160', crate_name: crate?.name || 'Common Crate', xp_min: formatNumber(minimum),
      xp_max: formatNumber(maximum), xp: formatNumber(claimed), claim_limit: formatNumber(crate?.claimLimit ?? 3),
      claims_left: formatNumber(Math.max(0, (crate?.claimLimit ?? 3) - 1)), list_claimed_user: '@GardenHero, @PixelFarmer',
      chance: String(crate?.chancePercent ?? 35), drop_every: crate?.dropEvery || '30m', despawn_time: crate?.despawnAfter || 'never',
      channel: '#general', ...extraValues,
    });
  }

  function renderedEditableTemplate(template, previewValues = {}) {
    const preview = previewMessageValue(template, previewValues);
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
    const previewValues = input.dataset.inlineTemplateScope === 'memberMessages'
      ? memberMessagePreviewValues(state.memberMessageEvent)
      : input.dataset.inlineTemplateScope === 'messageTemplate' ? genericTemplatePreviewValues() : {};
    display.innerHTML = `${renderedEditableTemplate(input.value, previewValues)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span>`;
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
    if (input && display) {
      const previewValues = input.dataset.inlineTemplateScope === 'memberMessages'
        ? memberMessagePreviewValues(state.memberMessageEvent)
        : ['messageTemplate', 'reactionRole'].includes(input.dataset.inlineTemplateScope) ? genericTemplatePreviewValues() : {};
      display.innerHTML = `${renderedEditableTemplate(input.value, previewValues)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span>`;
    }
  }

  function inlineTemplateEditor(template, field = 'template', scope = 'announcements', label = 'level-up message', previewValues = {}, maxLength = 3000, additionalContainerIndex = null) {
    const containerData = Number.isInteger(additionalContainerIndex) ? ` data-additional-container-index="${additionalContainerIndex}"` : '';
    return `<div class="inline-message-editor" data-inline-message-editor data-template-field="${escapeHtml(field)}" data-template-scope="${escapeHtml(scope)}"${containerData}>
      <div class="inline-message-display" data-inline-message-display role="button" tabindex="0" aria-label="Edit ${escapeHtml(label)}">${renderedEditableTemplate(template, previewValues)}<span class="inline-edit-badge" aria-hidden="true">EDIT</span></div>
      <div class="inline-message-source-shell">
        <div class="inline-message-highlight" data-inline-message-highlight aria-hidden="true">${editorMarkdown(template)}</div>
        <textarea class="inline-message-input" data-inline-message-input data-inline-template-field="${escapeHtml(field)}" data-inline-template-scope="${escapeHtml(scope)}"${containerData} maxlength="${maxLength}" rows="5" spellcheck="true" aria-label="${escapeHtml(label)} template">${escapeHtml(template)}</textarea>
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
      return showToast('Uplo…53783 tokens truncated…dBounds());
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
      else if (state.guilds.length) {
        const deepLink = new URLSearchParams(location.search);
        const requestedGuild = deepLink.get('guild');
        const guildId = state.guilds.some((guild) => guild.id === requestedGuild) ? requestedGuild : state.guilds[0].id;
        await loadGuild(guildId);
        if (['message-templates', 'reaction-roles', 'games'].includes(deepLink.get('view'))) setView(deepLink.get('view'));
      }
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
  elements.saveButton.addEventListener('click', () => {
    if (state.currentView === 'message-templates') saveMessageTemplate().catch((error) => showToast(error.message, 'error'));
    else if (state.currentView === 'reaction-roles') saveReactionRole().catch((error) => showToast(error.message, 'error'));
    else saveConfig();
  });
  elements.resetButton.addEventListener('click', () => {
    if (state.currentView === 'message-templates') resetTemplateDraft();
    else if (state.currentView === 'reaction-roles') {
      const stored = state.reactionRoles.items.find((item) => item.id === state.reactionRoleSelectedId);
      if (stored) { state.reactionRoleDraft = clone(stored); state.reactionRoleSavedSnapshot = reactionRoleSnapshot(); renderReactionRoles(); showToast('Unsaved Reaction Role changes reset.'); }
    }
    else resetUnsavedChanges();
  });
  elements.logoutButton.addEventListener('click', async () => {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => null);
    location.assign('/admin');
  });
  elements.levelingView.addEventListener('input', (event) => updateLevelingFromControl(event.target));
  elements.levelingView.addEventListener('change', (event) => updateLevelingFromControl(event.target));
  elements.welcomeMessagesView.addEventListener('input', (event) => updateMemberMessagesFromControl(event.target));
  elements.welcomeMessagesView.addEventListener('change', (event) => updateMemberMessagesFromControl(event.target));
  elements.gamesView.addEventListener('change', (event) => {
    if (!state.config?.counting || !state.config?.games) return;
    if (event.target === elements.countingChannel) state.config.counting.channelId = event.target.value;
    if (event.target === $('#lotteryChannel')) state.config.games.lotteryChannelId = event.target.value;
    const channelIndex = event.target.dataset.gameSettingChannels;
    const commandIndex = event.target.dataset.gameSettingCommands;
    if (channelIndex !== undefined) state.config.games.commandSettings[Number(channelIndex)].channelIds = [...event.target.selectedOptions].map((option) => option.value).filter(Boolean);
    if (commandIndex !== undefined) state.config.games.commandSettings[Number(commandIndex)].commands = [...event.target.selectedOptions].map((option) => option.value).filter(Boolean);
    refreshDirty();
  });
  elements.gamesView.addEventListener('click', (event) => {
    if (!state.config?.games) return;
    if (event.target === elements.gameAddCommandSetting) {
      state.config.games.commandSettings.push({ id: clientReactionId('game'), channelIds: [], commands: [] });
      renderGameCommandSettings();
      refreshDirty();
      return;
    }
    const index = event.target.dataset.removeGameSetting;
    if (index !== undefined) {
      state.config.games.commandSettings.splice(Number(index), 1);
      renderGameCommandSettings();
      refreshDirty();
    }
  });
  elements.messageTemplatesView.addEventListener('input', (event) => {
    if (event.target === elements.templateSearch) return renderTemplateList();
    if (event.target === elements.templateJsonEditor) return updateTemplateJsonFromInput();
    updateTemplateDraftFromControl(event.target);
  });
  elements.messageTemplatesView.addEventListener('change', (event) => updateTemplateDraftFromControl(event.target));
  elements.reactionRolesView.addEventListener('input', (event) => updateReactionRoleFromControl(event.target));
  elements.reactionRolesView.addEventListener('change', (event) => updateReactionRoleFromControl(event.target));
  for (const preview of [
    elements.levelingMessagePreview, elements.levelingAdditionalContainers,
    elements.welcomeMessagePreview, elements.welcomeAdditionalContainers,
    elements.templateMessagePreview, elements.templateAdditionalContainers,
    elements.reactionRoleMessagePreview, elements.reactionRoleAdditionalContainers,
    elements.xpDropMessagePreview, elements.xpDropClaimPreview,
  ]) {
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
  elements.levelingAdditionalContainerAdd.addEventListener('click', () => {
    const announcements = state.config?.leveling?.announcements;
    if (!announcements || announcements.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return;
    announcements.additionalContainers.push(newAdditionalContainer(announcements.layout.accentColor));
    renderMessagePreview();
    refreshDirty();
    elements.levelingAdditionalContainers.lastElementChild?.querySelector('[data-inline-message-display]')?.focus();
  });
  elements.levelingAdditionalContainers.addEventListener('click', (event) => {
    const announcements = state.config?.leveling?.announcements;
    if (!announcements) return;
    const removeContainer = event.target.closest('[data-remove-leveling-additional-container]');
    if (removeContainer) {
      announcements.additionalContainers.splice(Number(removeContainer.dataset.removeLevelingAdditionalContainer), 1);
      renderMessagePreview(); refreshDirty(); return;
    }
    const addGallery = event.target.closest('[data-add-leveling-additional-gallery]');
    if (addGallery) {
      const layout = announcements.additionalContainers[Number(addGallery.dataset.addLevelingAdditionalGallery)]?.layout;
      if (!layout || layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      layout.galleryUrls.push(''); renderMessagePreview(); refreshDirty(); return;
    }
    const removeGallery = event.target.closest('[data-remove-leveling-additional-gallery]');
    if (removeGallery) {
      const [containerIndex, mediaIndex] = removeGallery.dataset.removeLevelingAdditionalGallery.split(':').map(Number);
      announcements.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1);
      renderMessagePreview(); refreshDirty();
    }
  });
  elements.levelingAdditionalContainers.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-leveling-media-upload]');
    if (upload) uploadLevelingMedia(upload);
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
  elements.welcomeMessagesView.querySelector('.member-message-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('[data-member-event]');
    if (!button || button.dataset.memberEvent === state.memberMessageEvent) return;
    state.memberMessageEvent = button.dataset.memberEvent;
    state.memberMessageComposerPanel = '';
    renderWelcomeMessages();
  });
  elements.welcomeEventReset.addEventListener('click', resetCurrentMemberMessage);
  elements.welcomeContainerAdd.addEventListener('click', () => {
    const event = currentMemberMessage();
    if (!event) return;
    event.layout.container = !event.layout.container;
    renderWelcomeMessagePreview();
    refreshDirty();
  });
  elements.welcomeAdditionalContainerAdd.addEventListener('click', () => {
    const current = currentMemberMessage();
    if (!current || current.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return;
    current.additionalContainers.push(newAdditionalContainer(current.layout.accentColor));
    renderWelcomeMessagePreview(); refreshDirty();
    elements.welcomeAdditionalContainers.lastElementChild?.querySelector('[data-inline-message-display]')?.focus();
  });
  elements.welcomeAdditionalContainers.addEventListener('click', (event) => {
    const current = currentMemberMessage();
    if (!current) return;
    const removeContainer = event.target.closest('[data-remove-welcome-additional-container]');
    if (removeContainer) {
      current.additionalContainers.splice(Number(removeContainer.dataset.removeWelcomeAdditionalContainer), 1);
      renderWelcomeMessagePreview(); refreshDirty(); return;
    }
    const addGallery = event.target.closest('[data-add-welcome-additional-gallery]');
    if (addGallery) {
      const layout = current.additionalContainers[Number(addGallery.dataset.addWelcomeAdditionalGallery)]?.layout;
      if (!layout || layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      layout.galleryUrls.push(''); renderWelcomeMessagePreview(); refreshDirty(); return;
    }
    const removeGallery = event.target.closest('[data-remove-welcome-additional-gallery]');
    if (removeGallery) {
      const [containerIndex, mediaIndex] = removeGallery.dataset.removeWelcomeAdditionalGallery.split(':').map(Number);
      current.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1);
      renderWelcomeMessagePreview(); refreshDirty();
    }
  });
  elements.welcomeAdditionalContainers.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-welcome-media-upload]');
    if (upload) uploadWelcomeMedia(upload);
  });
  elements.welcomeVariablesToggle.addEventListener('click', () => toggleWelcomeComposerPanel('variables'));
  elements.welcomeThumbnailAdd.addEventListener('click', () => toggleWelcomeComposerPanel('thumbnail'));
  elements.welcomeGalleryAdd.addEventListener('click', () => toggleWelcomeComposerPanel('gallery'));
  elements.welcomeAccentButton.addEventListener('click', () => elements.welcomeAccentColor.click());
  elements.welcomeComposerPanel.addEventListener('click', (event) => {
    const variable = event.target.closest('[data-insert-member-variable]');
    if (variable) return insertMemberMessageVariable(variable.dataset.insertMemberVariable);
    const current = currentMemberMessage();
    if (!current) return;
    if (event.target.closest('[data-remove-welcome-thumbnail]')) {
      current.layout.thumbnailEnabled = false;
      current.layout.thumbnailUrl = '';
      renderWelcomeMessagePreview();
      refreshDirty();
      return;
    }
    if (event.target.closest('[data-add-welcome-gallery-url]')) {
      if (current.layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      current.layout.galleryUrls.push('');
      renderWelcomeComposerPanel();
      refreshDirty();
      elements.welcomeComposerPanel.querySelector('[data-welcome-gallery-url]:last-of-type')?.focus();
      return;
    }
    const remove = event.target.closest('[data-remove-welcome-gallery]');
    if (!remove) return;
    current.layout.galleryUrls.splice(Number(remove.dataset.removeWelcomeGallery), 1);
    renderWelcomeMessagePreview();
    refreshDirty();
  });
  elements.welcomeComposerPanel.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-welcome-media-upload]');
    if (upload) uploadWelcomeMedia(upload);
  });
  for (const button of [elements.templateCreateButton, elements.templateListCreate, elements.templateEmptyCreate]) {
    button.addEventListener('click', () => createMessageTemplate().catch((error) => showToast(error.message, 'error')));
  }
  elements.templateFolderCreate.addEventListener('click', () => createTemplateFolder().catch((error) => showToast(error.message, 'error')));
  elements.templateFolderList.addEventListener('click', async (event) => {
    const rename = event.target.closest('[data-template-folder-rename]');
    if (rename) return renameTemplateFolder(rename.dataset.templateFolderRename).catch((error) => showToast(error.message, 'error'));
    const remove = event.target.closest('[data-template-folder-delete]');
    if (remove) return deleteTemplateFolder(remove.dataset.templateFolderDelete).catch((error) => showToast(error.message, 'error'));
    const folder = event.target.closest('[data-template-folder]');
    if (!folder) return;
    const nextFolderId = folder.dataset.templateFolder;
    const items = visibleTemplates(nextFolderId);
    if (state.templateSelectedId && !items.some((item) => item.id === state.templateSelectedId) && templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Opening this collection will close the current draft.', confirmLabel: 'Discard' });
      if (!confirmed) return;
    }
    state.templateFolderId = nextFolderId;
    renderTemplateFolders();
    renderTemplateList();
    updateTemplateDeepLink();
    if (state.templateSelectedId && !items.some((item) => item.id === state.templateSelectedId)) {
      if (items[0]) selectMessageTemplate(items[0].id, { force: true }).catch((error) => showToast(error.message, 'error'));
      else { state.templateSelectedId = ''; state.templateDraft = null; state.templateSavedSnapshot = ''; renderTemplateEditor(); }
    }
  });
  elements.templateList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-template-id]');
    if (item) selectMessageTemplate(item.dataset.templateId).catch((error) => showToast(error.message, 'error'));
  });
  elements.templateEditor.querySelector('.template-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-template-tab]');
    if (!tab) return;
    state.templateTab = tab.dataset.templateTab;
    renderTemplateEditor();
  });
  elements.templateEditor.addEventListener('click', async (event) => {
    const mode = event.target.closest('[data-template-control-mode]');
    if (mode && state.templateDraft) {
      state.templateDraft.controls.type = mode.dataset.templateControlMode;
      state.templateSaveError = '';
      if (state.templateDraft.controls.type === 'dropdown' && !state.templateDraft.controls.dropdowns.length) {
        state.templateDraft.controls.dropdowns.push(newTemplateDropdown());
      }
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty(); return;
    }
    const emoji = event.target.closest('[data-template-control-emoji]');
    if (emoji) {
      const spec = emoji.dataset.templateControlEmoji;
      openEmojiPicker({ type: spec.startsWith('button:') ? 'template-button' : 'template-option', spec, trigger: emoji })
        .catch((error) => showToast(error.message, 'error'));
      return;
    }
    const configure = event.target.closest('[data-template-configure-action]');
    if (configure) { openTemplateActionDialog(configure.dataset.templateConfigureAction); return; }
    const duplicate = event.target.closest('[data-template-control-duplicate]');
    if (duplicate) {
      const target = templateControlAt(duplicate.dataset.templateControlDuplicate);
      if (!target?.dropdown) return;
      if (target.entries.length >= 25) return showToast('A dropdown supports up to 25 options.', 'error');
      const copy = clone(target.entry);
      copy.id = clientReactionId('control');
      copy.title = duplicateTemplateOptionTitle(target.dropdown, target.entry.title);
      target.entries.splice(target.index + 1, 0, copy);
      target.entries.forEach((entry, index) => { entry.sortOrder = index; });
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-option-title="${target.dropdown.id}:${copy.id}"]`)?.focus();
      return;
    }
    const remove = event.target.closest('[data-template-control-remove]');
    if (remove) {
      const target = templateControlAt(remove.dataset.templateControlRemove);
      if (!target) return;
      if (target.dropdown && target.entries.length <= 1) {
        showToast('A dropdown must keep at least one option.', 'error');
        remove.focus();
        return;
      }
      if (target.dropdown) {
        const confirmed = await confirmAction({
          title: `Delete “${target.entry.title || 'this option'}”?`,
          copy: 'The option and its configured action will be removed from this unsaved draft.',
          confirmLabel: 'Delete option',
        });
        if (!confirmed) { remove.focus(); return; }
      }
      const focusEntry = target.entries[target.index + 1] || target.entries[target.index - 1];
      if (target) target.entries.splice(target.index, 1);
      target?.entries.forEach((entry, index) => { entry.sortOrder = index; });
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      if (target.dropdown && focusEntry) elements.templateControls.querySelector(`[data-template-option-title="${target.dropdown.id}:${focusEntry.id}"]`)?.focus();
      return;
    }
    const move = event.target.closest('[data-template-control-move]');
    if (move) {
      const value = move.dataset.templateControlMove;
      const separator = value.lastIndexOf(':');
      const target = templateControlAt(value.slice(0, separator));
      const delta = Number(value.slice(separator + 1));
      const to = target ? target.index + delta : -1;
      if (target?.entries[target.index] && target.entries[to]) { const [item] = target.entries.splice(target.index, 1); target.entries.splice(to, 0, item); target.entries.forEach((entry, index) => { entry.sortOrder = index; }); }
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-control-move^="${target?.spec}:"]`)?.focus();
      return;
    }
    const removeDropdown = event.target.closest('[data-template-dropdown-remove]');
    if (removeDropdown) {
      const resolved = templateDropdownAt(removeDropdown.dataset.templateDropdownRemove);
      if (!resolved) return;
      if (state.templateDraft.controls.dropdowns.length <= 1) {
        showToast('Dropdown mode must keep at least one dropdown.', 'error');
        removeDropdown.focus();
        return;
      }
      state.templateDraft.controls.dropdowns.splice(resolved.dropdownIndex, 1);
      state.templateDraft.controls.dropdowns.forEach((dropdown, index) => { dropdown.sortOrder = index; });
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      return;
    }
    const moveDropdown = event.target.closest('[data-template-dropdown-move]');
    if (moveDropdown) {
      const [id, deltaText] = moveDropdown.dataset.templateDropdownMove.split(':');
      const resolved = templateDropdownAt(id); const delta = Number(deltaText);
      const entries = state.templateDraft.controls.dropdowns; const to = resolved ? resolved.dropdownIndex + delta : -1;
      if (resolved && entries[to]) { const [dropdown] = entries.splice(resolved.dropdownIndex, 1); entries.splice(to, 0, dropdown); entries.forEach((entry, index) => { entry.sortOrder = index; }); }
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-dropdown-move^="${id}:"]`)?.focus();
      return;
    }
    const addOption = event.target.closest('[data-template-dropdown-add-option]');
    if (addOption) {
      const dropdown = templateDropdownAt(addOption.dataset.templateDropdownAddOption)?.dropdown;
      if (!dropdown || dropdown.options.length >= 25) return;
      const option = newTemplateOption(dropdown.options.length);
      dropdown.options.push(option);
      state.templateSaveError = '';
      renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      refreshTemplateDirty();
      elements.templateControls.querySelector(`[data-template-option-title="${dropdown.id}:${option.id}"]`)?.focus();
    }
  });
  elements.templateAddControl.addEventListener('click', () => {
    const draft = state.templateDraft; if (!draft || draft.controls.type === 'none') return;
    if (draft.controls.type === 'button') {
      if (draft.controls.buttons.length >= 25) return;
      draft.controls.buttons.push({ id: clientReactionId('control'), emoji: { id: '', name: '✨', animated: false, source: 'default' }, label: `Button ${draft.controls.buttons.length + 1}`, style: 'Secondary', sortOrder: draft.controls.buttons.length, action: { type: 'send_message', templateId: '' } });
    }
    else {
      if (draft.controls.dropdowns.length >= 5) return;
      draft.controls.dropdowns.push(newTemplateDropdown(draft.controls.dropdowns.length));
    }
    state.templateSaveError = '';
    renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
    elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    refreshTemplateDirty();
    (draft.controls.type === 'button'
      ? elements.templateControls.querySelector('[data-template-configure-action]:last-of-type')
      : elements.templateControls.querySelector(`[data-template-dropdown-card="${draft.controls.dropdowns.at(-1).id}"] [data-template-dropdown-placeholder]`))?.focus();
  });
  elements.templateDuplicateButton.addEventListener('click', () => duplicateMessageTemplate().catch((error) => showToast(error.message, 'error')));
  elements.templateDeleteButton.addEventListener('click', () => deleteMessageTemplate().catch((error) => showToast(error.message, 'error')));
  elements.templateContainerAdd.addEventListener('click', () => {
    if (!state.templateDraft) return;
    state.templateDraft.layout.container = !state.templateDraft.layout.container;
    renderTemplateComposerPreview();
  });
  elements.templateAdditionalContainerAdd.addEventListener('click', () => {
    if (!state.templateDraft || state.templateDraft.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return;
    state.templateDraft.additionalContainers.push(newAdditionalContainer(state.templateDraft.layout.accentColor));
    renderTemplateComposerPreview();
    elements.templateAdditionalContainers.lastElementChild?.querySelector('[data-inline-message-display]')?.focus();
  });
  elements.templateAdditionalContainers.addEventListener('click', (event) => {
    if (!state.templateDraft) return;
    const removeContainer = event.target.closest('[data-remove-template-additional-container]');
    if (removeContainer) {
      state.templateDraft.additionalContainers.splice(Number(removeContainer.dataset.removeTemplateAdditionalContainer), 1);
      renderTemplateComposerPreview(); return;
    }
    const addGallery = event.target.closest('[data-add-template-additional-gallery]');
    if (addGallery) {
      const layout = state.templateDraft.additionalContainers[Number(addGallery.dataset.addTemplateAdditionalGallery)]?.layout;
      if (!layout || layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      layout.galleryUrls.push(''); renderTemplateComposerPreview(); return;
    }
    const removeGallery = event.target.closest('[data-remove-template-additional-gallery]');
    if (removeGallery) {
      const [containerIndex, mediaIndex] = removeGallery.dataset.removeTemplateAdditionalGallery.split(':').map(Number);
      state.templateDraft.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1);
      renderTemplateComposerPreview();
    }
  });
  elements.templateAdditionalContainers.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-template-media-upload]');
    if (upload) uploadTemplateMedia(upload);
  });
  elements.templateVariablesToggle.addEventListener('click', () => {
    state.templateComposerPanel = state.templateComposerPanel === 'variables' ? '' : 'variables'; renderTemplateComposerPanel();
  });
  elements.templateThumbnailAdd.addEventListener('click', () => {
    state.templateComposerPanel = state.templateComposerPanel === 'thumbnail' ? '' : 'thumbnail'; renderTemplateComposerPanel();
  });
  elements.templateGalleryAdd.addEventListener('click', () => {
    state.templateComposerPanel = state.templateComposerPanel === 'gallery' ? '' : 'gallery'; renderTemplateComposerPanel();
  });
  elements.templateAccentButton.addEventListener('click', () => elements.templateAccentColor.click());
  elements.templateComposerPanel.addEventListener('click', (event) => {
    const variable = event.target.closest('[data-insert-template-variable]');
    if (variable) return insertTemplateVariable(variable.dataset.insertTemplateVariable);
    if (!state.templateDraft) return;
    if (event.target.closest('[data-remove-template-thumbnail]')) {
      state.templateDraft.layout.thumbnailEnabled = false;
      state.templateDraft.layout.thumbnailUrl = '';
      return renderTemplateComposerPreview();
    }
    if (event.target.closest('[data-add-template-gallery]')) {
      if (state.templateDraft.layout.galleryUrls.length >= 10) return showToast('A Discord gallery supports up to 10 images.', 'error');
      state.templateDraft.layout.galleryUrls.push('');
      renderTemplateComposerPanel(); syncTemplateJson(); refreshTemplateDirty();
      return elements.templateComposerPanel.querySelector('[data-template-gallery-url]:last-of-type')?.focus();
    }
    const remove = event.target.closest('[data-remove-template-gallery]');
    if (!remove) return;
    state.templateDraft.layout.galleryUrls.splice(Number(remove.dataset.removeTemplateGallery), 1);
    renderTemplateComposerPreview();
  });
  elements.templateComposerPanel.addEventListener('change', (event) => {
    const upload = event.target.closest('[data-template-media-upload]');
    if (upload) uploadTemplateMedia(upload);
  });
  elements.templateJsonFormat.addEventListener('click', () => {
    if (!updateTemplateJsonFromInput()) return;
    syncTemplateJson(true);
    showToast('Template JSON formatted.');
  });
  elements.templateJsonImport.addEventListener('click', () => {
    if (!updateTemplateJsonFromInput(true)) elements.templateJsonEditor.focus();
    else syncTemplateJson(true);
  });
  elements.templateJsonCopy.addEventListener('click', async () => {
    await navigator.clipboard?.writeText?.(elements.templateJsonEditor.value).catch(() => null);
    showToast('Template JSON copied.');
  });
  elements.templateSendTest.addEventListener('click', () => sendCurrentTemplate('test'));
  elements.templateSendNow.addEventListener('click', () => sendCurrentTemplate('send'));
  elements.templateCopyLink.addEventListener('click', async () => {
    await navigator.clipboard?.writeText?.(elements.templateShareLink.value).catch(() => null);
    showToast('Authenticated template link copied.');
  });
  elements.templateActionSave.addEventListener('click', saveTemplateActionDialog);
  elements.levelingUseTemplate.addEventListener('click', () => openTemplatePicker('leveling'));
  elements.welcomeUseTemplate.addEventListener('click', () => openTemplatePicker('memberMessages'));
  elements.levelingSaveAsTemplate.addEventListener('click', () => saveComposerAsTemplate('leveling').catch((error) => showToast(error.message, 'error')));
  elements.welcomeSaveAsTemplate.addEventListener('click', () => saveComposerAsTemplate('memberMessages').catch((error) => showToast(error.message, 'error')));
  elements.templatePickerSearch.addEventListener('input', renderTemplatePicker);
  elements.templatePickerList.addEventListener('click', (event) => {
    const item = event.target.closest('[data-pick-template]');
    if (item) applyTemplateSnapshot(item.dataset.pickTemplate).catch((error) => showToast(error.message, 'error'));
  });
  for (const button of [elements.reactionRoleCreate, elements.reactionRoleEmptyCreate]) button.addEventListener('click', () => createReactionRole().catch((error) => showToast(error.message, 'error')));
  elements.reactionRoleList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-reaction-role-id]');
    if (button) selectReactionRole(button.dataset.reactionRoleId).catch((error) => showToast(error.message, 'error'));
  });
  elements.reactionRoleEditor.querySelector('.reaction-role-tabs').addEventListener('click', (event) => {
    const tab = event.target.closest('[data-reaction-tab]'); if (!tab) return;
    state.reactionRoleTab = tab.dataset.reactionTab; renderReactionRoleEditor();
  });
  elements.reactionRoleEditor.addEventListener('click', (event) => {
    const mode = event.target.closest('[data-reaction-mode]');
    if (mode && state.reactionRoleDraft) { state.reactionRoleDraft.interactionType = mode.dataset.reactionMode; renderReactionRoleEditor(); return; }
    const emoji = event.target.closest('[data-reaction-emoji]');
    if (emoji) { const [type, index] = emoji.dataset.reactionEmoji.split(':'); openEmojiPicker({ type: type === 'button' ? 'button' : 'option', index: Number(index) }); return; }
    const remove = event.target.closest('[data-rr-remove]');
    if (remove) { reactionRoleEntries().splice(Number(remove.dataset.rrRemove), 1); renderReactionRoleEditor(); return; }
    const move = event.target.closest('[data-rr-move]');
    if (move) {
      const [from, delta] = move.dataset.rrMove.split(':').map(Number); const entries = reactionRoleEntries(); const to = from + delta;
      if (entries[from] && entries[to]) { const [item] = entries.splice(from, 1); entries.splice(to, 0, item); entries.forEach((entry, index) => { entry.sortOrder = index; }); renderReactionRoleEditor(); }
    }
  });
  elements.reactionRoleAddControl.addEventListener('click', () => {
    const draft = state.reactionRoleDraft; if (!draft || reactionRoleEntries().length >= 25) return;
    const used = new Set(reactionRoleEntries().map((entry) => entry.roleId));
    const role = (state.directory.roles || []).find((entry) => entry.editable !== false && !entry.administrator && !used.has(entry.id));
    if (draft.interactionType === 'button') draft.buttons.push({ id: clientReactionId('button'), emoji: { id: '', name: '🎭', animated: false, source: 'default' }, label: role?.name || `Role ${draft.buttons.length + 1}`, style: 'Secondary', roleId: role?.id || '', sortOrder: draft.buttons.length });
    else draft.dropdown.options.push({ id: clientReactionId('option'), emoji: { id: '', name: '🎭', animated: false, source: 'default' }, title: role?.name || `Role ${draft.dropdown.options.length + 1}`, description: '', roleId: role?.id || '', sortOrder: draft.dropdown.options.length });
    renderReactionRoleEditor();
  });
  elements.reactionRoleDuplicate.addEventListener('click', () => duplicateReactionRole().catch((error) => showToast(error.message, 'error')));
  elements.reactionRoleDelete.addEventListener('click', () => deleteReactionRole().catch((error) => showToast(error.message, 'error')));
  elements.reactionRoleSaveDraft.addEventListener('click', () => saveReactionRole().catch((error) => showToast(error.message, 'error')));
  elements.reactionRolePublish.addEventListener('click', () => publishReactionRole().catch((error) => showToast(error.message, 'error')));
  elements.reactionRoleUseTemplate.addEventListener('click', () => openTemplatePicker('reactionRoles'));
  elements.reactionRoleContainerToggle.addEventListener('click', () => { if (!state.reactionRoleDraft) return; state.reactionRoleDraft.message.layout.container = !state.reactionRoleDraft.message.layout.container; renderReactionRoleEditor(); });
  elements.reactionRoleAdditionalContainer.addEventListener('click', () => { const draft = state.reactionRoleDraft; if (!draft || draft.message.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS) return; draft.message.additionalContainers.push(newAdditionalContainer(draft.message.layout.accentColor)); renderReactionRoleEditor(); });
  elements.reactionRoleVariablesToggle.addEventListener('click', () => { state.reactionRoleComposerPanel = state.reactionRoleComposerPanel === 'variables' ? '' : 'variables'; renderReactionRoleComposerPanel(); });
  elements.reactionRoleThumbnailToggle.addEventListener('click', () => { state.reactionRoleComposerPanel = state.reactionRoleComposerPanel === 'thumbnail' ? '' : 'thumbnail'; renderReactionRoleComposerPanel(); });
  elements.reactionRoleGalleryToggle.addEventListener('click', () => { state.reactionRoleComposerPanel = state.reactionRoleComposerPanel === 'gallery' ? '' : 'gallery'; renderReactionRoleComposerPanel(); });
  elements.reactionRoleAccentButton.addEventListener('click', () => elements.reactionRoleAccentColor.click());
  elements.reactionRoleComposerPanel.addEventListener('click', (event) => {
    const variable = event.target.closest('[data-insert-reaction-variable]'); if (variable) return insertReactionRoleVariable(variable.dataset.insertReactionVariable);
    const draft = state.reactionRoleDraft; if (!draft) return;
    if (event.target.closest('[data-remove-reaction-thumbnail]')) { draft.message.layout.thumbnailEnabled = false; draft.message.layout.thumbnailUrl = ''; renderReactionRoleEditor(); return; }
    if (event.target.closest('[data-add-reaction-gallery]')) { if (draft.message.layout.galleryUrls.length < 10) draft.message.layout.galleryUrls.push(''); renderReactionRoleEditor(); return; }
    const remove = event.target.closest('[data-remove-reaction-gallery]'); if (remove) { draft.message.layout.galleryUrls.splice(Number(remove.dataset.removeReactionGallery), 1); renderReactionRoleEditor(); }
  });
  elements.reactionRoleComposerPanel.addEventListener('change', (event) => { const input = event.target.closest('[data-reaction-media-upload]'); if (input) uploadReactionRoleMedia(input); });
  elements.reactionRoleAdditionalContainers.addEventListener('click', (event) => {
    const draft = state.reactionRoleDraft; if (!draft) return;
    const remove = event.target.closest('[data-remove-reaction-additional-container]'); if (remove) { draft.message.additionalContainers.splice(Number(remove.dataset.removeReactionAdditionalContainer), 1); renderReactionRoleEditor(); return; }
    const addGallery = event.target.closest('[data-add-reaction-additional-gallery]'); if (addGallery) { const layout = draft.message.additionalContainers[Number(addGallery.dataset.addReactionAdditionalGallery)]?.layout; if (layout?.galleryUrls.length < 10) layout.galleryUrls.push(''); renderReactionRoleEditor(); return; }
    const removeGallery = event.target.closest('[data-remove-reaction-additional-gallery]'); if (removeGallery) { const [containerIndex, mediaIndex] = removeGallery.dataset.removeReactionAdditionalGallery.split(':').map(Number); draft.message.additionalContainers[containerIndex]?.layout.galleryUrls.splice(mediaIndex, 1); renderReactionRoleEditor(); }
  });
  elements.reactionRoleAdditionalContainers.addEventListener('change', (event) => { const input = event.target.closest('[data-reaction-media-upload]'); if (input) uploadReactionRoleMedia(input); });

  document.addEventListener('selectionchange', () => rememberInlineTextCaret(document.activeElement));
  document.addEventListener('pointerdown', () => rememberInlineTextCaret(document.activeElement), true);
  document.addEventListener('keyup', (event) => rememberInlineTextCaret(event.target), true);
  document.addEventListener('input', (event) => rememberInlineTextCaret(event.target), true);

  elements.levelingEmojiToggle.addEventListener('click', () => openEmojiPicker('leveling').catch((error) => showToast(error.message, 'error')));
  elements.welcomeEmojiToggle.addEventListener('click', () => openEmojiPicker('memberMessages').catch((error) => showToast(error.message, 'error')));
  elements.templateEmojiToggle.addEventListener('click', () => openEmojiPicker('messageTemplate').catch((error) => showToast(error.message, 'error')));
  elements.xpDropEmojiToggle.addEventListener('click', () => openEmojiPicker('xpDrop').catch((error) => showToast(error.message, 'error')));
  elements.xpClaimEmojiToggle.addEventListener('click', () => openEmojiPicker('xpClaim').catch((error) => showToast(error.message, 'error')));
  elements.reactionRoleEmojiToggle.addEventListener('click', () => openEmojiPicker('reactionRole').catch((error) => showToast(error.message, 'error')));
  elements.emojiPickerClose.addEventListener('click', closeEmojiPicker);
  elements.emojiPickerSearch.addEventListener('input', () => {
    window.clearTimeout(emojiSearchTimer);
    elements.emojiPickerStatus.className = 'emoji-picker-status';
    elements.emojiPickerStatus.textContent = 'Searching…';
    emojiSearchTimer = window.setTimeout(renderEmojiPicker, EMOJI_SEARCH_DEBOUNCE_MS);
  });
  document.querySelector('.emoji-picker-tabs').addEventListener('click', async (event) => {
    const tab = event.target.closest('[data-emoji-section]'); if (!tab) return;
    state.emojiSection = tab.dataset.emojiSection;
    if (state.emojiSection === 'default' && !DEFAULT_EMOJI_DATA.groups.length) {
      elements.emojiPickerStatus.className = 'emoji-picker-status'; elements.emojiPickerStatus.textContent = 'Loading the default emoji catalog…';
      try { await ensureDefaultEmojiData(); }
      catch (error) { elements.emojiPickerStatus.className = 'emoji-picker-status error'; elements.emojiPickerStatus.textContent = error.message; return; }
    }
    if (!state.emojiCategory) state.emojiCategory = DEFAULT_EMOJI_DATA.groups[0]?.id || '';
    renderEmojiPicker();
  });
  elements.emojiPickerCategories.addEventListener('click', (event) => {
    const category = event.target.closest('[data-emoji-category]');
    if (!category) return;
    state.emojiCategory = category.dataset.emojiCategory;
    elements.emojiPickerSearch.value = '';
    renderEmojiPicker();
  });
  elements.emojiPickerGrid.addEventListener('click', (event) => { const button = event.target.closest('[data-emoji-index]'); if (button) applyPickedEmoji(state.emojiPickerItems[Number(button.dataset.emojiIndex)]); });
  elements.emojiPickerGrid.addEventListener('scroll', () => {
    if (elements.emojiPickerGrid.scrollTop + elements.emojiPickerGrid.clientHeight >= elements.emojiPickerGrid.scrollHeight - 120) appendEmojiPickerBatch();
  }, { passive: true });
  elements.emojiPickerGrid.addEventListener('keydown', (event) => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return;
    if (event.key === 'End' && state.emojiRenderedCount < state.emojiPickerItems.length) appendEmojiPickerBatch();
    const buttons = [...elements.emojiPickerGrid.querySelectorAll('[data-emoji-index]')]; const current = buttons.indexOf(event.target.closest('[data-emoji-index]')); if (current < 0) return;
    event.preventDefault(); const columns = Math.max(1, Math.round(elements.emojiPickerGrid.clientWidth / (buttons[0].offsetWidth + 6)));
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columns : event.key === 'ArrowDown' ? columns : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, current + delta)); buttons[next]?.focus();
  });
  elements.emojiPickerDialog.addEventListener('click', (event) => { if (event.target !== elements.emojiPickerDialog) return; const box = elements.emojiPickerDialog.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) closeEmojiPicker(); });
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
    document.body.classList.remove('mobile-nav-open');
    elements.mobileNavToggle?.setAttribute('aria-expanded', 'false');
  });
  elements.mobileNavToggle?.addEventListener('click', () => {
    const open = !document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', open);
    elements.mobileNavToggle.setAttribute('aria-expanded', String(open));
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
      const preferred = state.config?.features?.leveling ? 'leveling' : 'member-messages';
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
        state.config.memberMessages = normalizeMemberMessagesConfig(payload.config);
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
    const messageTemplateDirty = templateIsDirty();
    if (!dashboardDirty && !profileDirty && !messageTemplateDirty) return;
    event.preventDefault();
    event.returnValue = '';
  });

  loadSession();
})();
