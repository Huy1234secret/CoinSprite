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
      commandSettings: (Array.isArray(config?.games?.commandSettings) ? config.games.commandSettings : []).map((setting, index) => ({
        id: String(setting?.id || `setting-${index + 1}`),
        channelIds: [...new Set((Array.isArray(setting?.channelIds) ? setting.channelIds : []).map(String).filter(Boolean))],
        commands: [...new Set((Array.isArray(setting?.commands) ? setting.commands : []).map(String).filter((command) => ['cs-work', 'cs-balance', 'cs-inventory'].includes(command)))],
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
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex)
        ? state.config.leveling.announcements.additionalContainers[containerIndex]?.layout
        : state.config.leveling.announcements.layout;
      if (!layout) throw new Error('That container no longer exists.');
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

  function renderDiscordComposerPreview({ frame, preview, accentButton, accentInput, containerButton, layout, contentHtml, resolveMedia }) {
    const thumbnailUrl = layout.thumbnailEnabled ? resolveMedia(layout.thumbnailUrl) : '';
    const thumbnail = layout.thumbnailEnabled
      ? thumbnailUrl ? `<img class="discord-thumbnail" src="${escapeHtml(thumbnailUrl)}" alt="">` : '<div class="discord-thumbnail placeholder">IMG</div>'
      : '';
    const gallery = (layout.galleryUrls || []).map(resolveMedia).filter(Boolean);
    const galleryHtml = gallery.length ? `<div class="discord-gallery">${gallery.map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div>` : '';
    frame.classList.toggle('has-container', layout.container);
    frame.classList.toggle('no-container', !layout.container);
    frame.style.setProperty('--accent-color', layout.accentColor);
    accentButton.hidden = !layout.container;
    accentInput.value = layout.accentColor;
    containerButton.classList.toggle('active', layout.container);
    containerButton.textContent = layout.container ? 'Container on' : 'Container off';
    preview.innerHTML = `<div class="discord-section"><div>${contentHtml}</div>${thumbnail}</div>${galleryHtml}`;
  }

  function renderAdditionalContainerEditors({ root, containers, prefix, scope, previewValues, resolveMedia, maxLength }) {
    root.innerHTML = containers.map((container, containerIndex) => {
      const layout = container.layout;
      const thumbnailUrl = layout.thumbnailEnabled ? resolveMedia(layout.thumbnailUrl) : '';
      const thumbnail = layout.thumbnailEnabled
        ? thumbnailUrl ? `<img class="discord-thumbnail" src="${escapeHtml(thumbnailUrl)}" alt="">` : '<div class="discord-thumbnail placeholder">IMG</div>'
        : '';
      const gallery = layout.galleryUrls.map(resolveMedia).filter(Boolean);
      const galleryPreview = gallery.length ? `<div class="discord-gallery">${gallery.map((url) => `<img src="${escapeHtml(url)}" alt="">`).join('')}</div>` : '';
      const galleryRows = layout.galleryUrls.map((url, mediaIndex) => `<div class="media-entry"><span>${mediaIndex + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="https://example.com/image.png" data-${prefix}-additional-gallery-url="${containerIndex}:${mediaIndex}"><label class="media-upload">Upload<input type="file" accept="image/*" data-${prefix}-media-upload="gallery" data-additional-container-index="${containerIndex}" data-media-index="${mediaIndex}"></label><button type="button" data-remove-${prefix}-additional-gallery="${containerIndex}:${mediaIndex}" aria-label="Remove gallery image ${mediaIndex + 1}">&times;</button></div>`).join('');
      const content = inlineTemplateEditor(container.content, 'content', scope, `container ${containerIndex + 2} message`, previewValues, maxLength, containerIndex);
      return `<section class="additional-container-card" style="--accent-color:${escapeHtml(layout.accentColor)}" data-additional-container-card="${containerIndex}">
        <header><strong>Container ${containerIndex + 2}</strong><div><label class="additional-container-color" title="Container color"><span>Accent</span><input type="color" value="${escapeHtml(layout.accentColor)}" data-${prefix}-additional-accent="${containerIndex}" aria-label="Container ${containerIndex + 2} color"></label><button type="button" data-remove-${prefix}-additional-container="${containerIndex}">Remove</button></div></header>
        <div class="discord-section"><div>${content}</div>${thumbnail}</div>${galleryPreview}
        <details class="additional-container-media"><summary>Images</summary><div class="media-entry"><span>Thumb</span><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="Image URL or supported variable" data-${prefix}-additional-thumbnail-url="${containerIndex}"><label class="media-upload">Upload<input type="file" accept="image/*" data-${prefix}-media-upload="thumbnail" data-additional-container-index="${containerIndex}"></label></div><div class="additional-gallery-head"><strong>Gallery</strong><button type="button" data-add-${prefix}-additional-gallery="${containerIndex}">+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-${prefix}-media-upload="gallery" data-additional-container-index="${containerIndex}"></label></div><div class="media-list">${galleryRows || '<p>No gallery images yet.</p>'}</div></details>
      </section>`;
    }).join('');
  }

  function renderMessagePreview(renderTools = true) {
    const announcements = state.config.leveling.announcements;
    const layout = announcements.layout;
    const text = inlineTemplateEditor(announcements.template);
    renderDiscordComposerPreview({
      frame: elements.levelingDiscordFrame, preview: elements.levelingMessagePreview,
      accentButton: elements.levelingAccentButton, accentInput: elements.levelingAccentColor,
      containerButton: elements.levelingContainerAdd, layout, contentHtml: text, resolveMedia: previewMediaUrl,
    });
    renderAdditionalContainerEditors({
      root: elements.levelingAdditionalContainers,
      containers: announcements.additionalContainers,
      prefix: 'leveling', scope: 'announcements', previewValues: {}, resolveMedia: previewMediaUrl, maxLength: 3000,
    });
    elements.levelingAdditionalContainerAdd.disabled = announcements.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    if (renderTools) renderComposerPanel();
  }

  const MEMBER_MESSAGE_META = Object.freeze({
    join: { title: 'Join message', description: 'Sent after a new member joins this Discord server.', toggle: 'Send when a member joins', preview: 'JOIN PREVIEW', step: '01' },
    leave: { title: 'Leave message', description: 'Sent after a member leaves or is removed from this Discord server.', toggle: 'Send when a member leaves', preview: 'LEAVE PREVIEW', step: '02' },
    boost: { title: 'Boost message', description: 'Sent for a new server boost, with duplicate Discord events collapsed into one post.', toggle: 'Send when a member boosts', preview: 'BOOST PREVIEW', step: '03' },
  });
  const MEMBER_MESSAGE_COMMON_VARIABLES = [
    ['{user}', 'Member mention'], ['{username}', 'Discord username'], ['{display_name}', 'Server display name'],
    ['{user_id}', 'Member ID'], ['{user_avatar}', 'Member avatar URL'], ['{server}', 'Server name'],
    ['{server_icon}', 'Server icon URL'], ['{member_count}', 'Current member count'], ['{channel}', 'Selected channel mention'],
    ['{timestamp}', 'Event time'], ['{separator}', 'Discord divider'],
  ];
  const MEMBER_MESSAGE_EVENT_VARIABLES = Object.freeze({
    join: [['{joined_at}', 'Server join time'], ['{account_created}', 'Account creation time'], ['{account_age}', 'Discord account age']],
    leave: [['{joined_at}', 'Original join time'], ['{time_in_server}', 'Time spent in server']],
    boost: [['{boost_count}', 'Current boost count'], ['{boost_level}', 'Current boost level'], ['{boost_since}', 'Boost start time']],
  });

  function currentMemberMessage() {
    return state.config?.memberMessages?.[state.memberMessageEvent];
  }

  function memberMessagePreviewValues(type) {
    return {
      user: '@GardenHero', username: 'GardenHero', display_name: 'Garden Hero', user_id: '123456789012345678',
      user_avatar: 'https://cdn.discordapp.com/embed/avatars/0.png', server: 'Grow a Garden',
      server_icon: 'https://cdn.discordapp.com/embed/avatars/1.png', member_count: type === 'leave' ? '1,248' : '1,249',
      channel: '#welcome', timestamp: 'Today at 12:00', joined_at: 'Today at 12:00', account_created: 'June 12, 2021',
      account_age: '5 years', time_in_server: '8 months', boost_count: '24', boost_level: '2', boost_since: 'Today at 12:00',
    };
  }

  function memberMessagePreviewMediaUrl(value, type = state.memberMessageEvent) {
    const resolved = interpolateTemplate(value, memberMessagePreviewValues(type));
    return validHttpUrl(resolved) ? resolved.trim() : '';
  }

  function renderWelcomeComposerPanel() {
    const panel = state.memberMessageComposerPanel;
    const event = currentMemberMessage();
    if (!event) return;
    const layout = event.layout;
    elements.welcomeComposerPanel.hidden = !panel;
    elements.welcomeComposerPanel.dataset.panel = panel;
    elements.welcomeVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.welcomeThumbnailAdd.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.welcomeGalleryAdd.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validMemberMediaTemplate));
    if (!panel) return;
    if (panel === 'variables') {
      const variables = [...MEMBER_MESSAGE_COMMON_VARIABLES, ...MEMBER_MESSAGE_EVENT_VARIABLES[state.memberMessageEvent]];
      elements.welcomeComposerPanel.innerHTML = `<div class="variable-guide">${variables.map(([token, meaning]) => `<button type="button" data-insert-member-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.welcomeComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {user_avatar}, {server_icon}, an image URL, or an upload up to 10 MB.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-welcome-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{user_avatar} or https://example.com/image.png" data-welcome-thumbnail-url><label class="media-upload">Upload image<input type="file" accept="image/*" data-welcome-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="{server_icon} or https://example.com/image.png" data-welcome-gallery-url="${index}"><label class="media-upload">Upload<input type="file" accept="image/*" data-welcome-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-welcome-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.welcomeComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 image URLs or uploads.</small></div><div><button type="button" data-add-welcome-gallery-url>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-welcome-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

  function renderWelcomeMessagePreview(renderTools = true) {
    const event = currentMemberMessage();
    if (!event) return;
    const layout = event.layout;
    const values = memberMessagePreviewValues(state.memberMessageEvent);
    const text = inlineTemplateEditor(event.template, 'template', 'memberMessages', `${state.memberMessageEvent} message`, values);
    renderDiscordComposerPreview({
      frame: elements.welcomeDiscordFrame, preview: elements.welcomeMessagePreview,
      accentButton: elements.welcomeAccentButton, accentInput: elements.welcomeAccentColor,
      containerButton: elements.welcomeContainerAdd, layout, contentHtml: text,
      resolveMedia: (url) => memberMessagePreviewMediaUrl(url),
    });
    renderAdditionalContainerEditors({
      root: elements.welcomeAdditionalContainers,
      containers: event.additionalContainers,
      prefix: 'welcome', scope: 'memberMessages', previewValues: values,
      resolveMedia: (url) => memberMessagePreviewMediaUrl(url), maxLength: 3000,
    });
    elements.welcomeAdditionalContainerAdd.disabled = event.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    if (renderTools) renderWelcomeComposerPanel();
  }

  function renderWelcomeMessages() {
    const config = state.config?.memberMessages;
    const event = currentMemberMessage();
    if (!config || !event) return;
    const meta = MEMBER_MESSAGE_META[state.memberMessageEvent];
    elements.welcomeMessagesEnabled.checked = config.enabled;
    elements.welcomeEventEnabled.checked = event.enabled;
    elements.welcomeEventChannel.innerHTML = channelOptions(event.channelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose a message channel');
    elements.welcomeEventStep.textContent = meta.step;
    elements.welcomeEventTitle.textContent = meta.title;
    elements.welcomeEventDescription.textContent = meta.description;
    elements.welcomeEventToggleCopy.textContent = meta.toggle;
    elements.welcomePreviewLabel.textContent = meta.preview;
    elements.welcomeEventReset.textContent = `Reset ${state.memberMessageEvent} default`;
    document.querySelectorAll('[data-member-event]').forEach((button) => {
      const active = button.dataset.memberEvent === state.memberMessageEvent;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    renderWelcomeMessagePreview();
    refreshDirty();
  }

  function toggleWelcomeComposerPanel(panel) {
    state.memberMessageComposerPanel = state.memberMessageComposerPanel === panel ? '' : panel;
    renderWelcomeComposerPanel();
  }

  function insertMemberMessageVariable(token) {
    const event = currentMemberMessage();
    if (!event) return;
    let input = elements.welcomeMessagesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]')
      || elements.welcomeMessagePreview.querySelector('[data-inline-message-input]');
    if (!input) return;
    if (!input.closest('[data-inline-message-editor]')?.classList.contains('editing')) {
      beginInlineMessageEdit(input.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-display]'));
      input = elements.welcomeMessagesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]') || input;
    }
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`.slice(0, 3000);
    const containerIndex = Number(input.dataset.additionalContainerIndex);
    if (Number.isInteger(containerIndex) && event.additionalContainers[containerIndex]) event.additionalContainers[containerIndex].content = input.value;
    else event.template = input.value;
    syncInlineEditorVisual(input);
    input.focus();
    input.setSelectionRange(Math.min(input.value.length, start + token.length), Math.min(input.value.length, start + token.length));
    refreshDirty();
  }

  async function uploadWelcomeMedia(input) {
    const file = input.files?.[0];
    const event = currentMemberMessage();
    if (!file || !event) return;
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
      const result = await api(`/api/guilds/${state.guildId}/message-media`, {
        method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }),
      });
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex) ? event.additionalContainers[containerIndex]?.layout : event.layout;
      if (!layout) throw new Error('That container no longer exists.');
      if (input.dataset.welcomeMediaUpload === 'thumbnail') {
        layout.thumbnailUrl = result.url;
        layout.thumbnailEnabled = true;
      } else {
        const index = Number(input.dataset.mediaIndex);
        if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url;
        else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url);
      }
      renderWelcomeMessagePreview();
      refreshDirty();
      showToast('Image uploaded. Apply changes when you are ready.');
    } catch (error) {
      showToast(error.message || 'Image upload failed.', 'error');
    } finally {
      label?.classList.remove('uploading');
      input.value = '';
    }
  }

  const TEMPLATE_LAYOUT_DEFAULTS = Object.freeze({
    container: true, accentColor: '#b9f547', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]),
  });
  const TEMPLATE_ACTION_TYPES = Object.freeze(['send_message', 'give_role', 'remove_role', 'dm_message']);
  const TEMPLATE_ACTION_LABELS = Object.freeze({
    send_message: 'Send ephemeral message', give_role: 'Give role', remove_role: 'Remove role', dm_message: 'DM message',
  });
  const TEMPLATE_CONTROL_DEFAULTS = Object.freeze({
    type: 'none', buttons: Object.freeze([]),
    dropdowns: Object.freeze([]),
  });
  const GENERIC_TEMPLATE_VARIABLES = [
    ['{server}', 'Server name'], ['{server_icon}', 'Server icon URL'], ['{channel}', 'Destination channel'],
    ['{timestamp}', 'Current Discord timestamp'], ['{separator}', 'Discord divider'],
  ];

  function genericTemplatePreviewValues() {
    return {
      server: 'Grow a Garden', server_icon: 'https://cdn.discordapp.com/embed/avatars/1.png',
      channel: '#announcements', timestamp: 'Today at 12:00',
    };
  }

  function validTemplateMedia(value) {
    const text = String(value || '').trim().toLowerCase();
    return ['{server_icon}', '{user_avatar}', '{user_profile}'].includes(text) || validHttpUrl(text);
  }

  function normalizeTemplateLayoutClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      container: source.container !== false,
      accentColor: /^#[0-9a-f]{6}$/i.test(source.accentColor || '') ? source.accentColor.toLowerCase() : '#b9f547',
      thumbnailEnabled: source.thumbnailEnabled === true,
      thumbnailUrl: validTemplateMedia(source.thumbnailUrl) ? String(source.thumbnailUrl).trim() : '',
      galleryUrls: [...new Set((Array.isArray(source.galleryUrls) ? source.galleryUrls : [])
        .map((url) => String(url).trim()).filter(validTemplateMedia))].slice(0, 10),
    };
  }

  function normalizeTemplateActionClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const type = TEMPLATE_ACTION_TYPES.includes(source.type) ? source.type : 'send_message';
    return ['give_role', 'remove_role'].includes(type)
      ? { type, roleId: /^\d{16,20}$/.test(String(source.roleId || '')) ? String(source.roleId) : '' }
      : { type, templateId: /^[a-zA-Z0-9_-]{8,64}$/.test(String(source.templateId || '')) ? String(source.templateId) : '' };
  }

  function normalizeTemplateControlsClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      type: ['button', 'dropdown'].includes(source.type) ? source.type : 'none',
      buttons: (Array.isArray(source.buttons) ? source.buttons : []).slice(0, 25).map((button, index) => ({
        id: String(button?.id || clientReactionId('control')),
        emoji: normalizePickerEmoji(button?.emoji),
        label: String(button?.label || `Button ${index + 1}`).trim().slice(0, 80) || `Button ${index + 1}`,
        style: ['Primary', 'Secondary', 'Success', 'Danger'].includes(button?.style) ? button.style : 'Secondary',
        sortOrder: index,
        action: normalizeTemplateActionClient(button?.action),
      })),
      dropdowns: (Array.isArray(source.dropdowns) ? source.dropdowns : []).slice(0, 5).map((dropdown, dropdownIndex) => ({
        id: String(dropdown?.id || clientReactionId('dropdown')),
        placeholder: String(dropdown?.placeholder || `Choose an option ${dropdownIndex + 1}`).trim().slice(0, 150) || `Choose an option ${dropdownIndex + 1}`,
        allowMultiple: dropdown?.allowMultiple === true,
        sortOrder: dropdownIndex,
        options: (Array.isArray(dropdown?.options) ? dropdown.options : []).slice(0, 25).map((option, optionIndex) => ({
          id: String(option?.id || clientReactionId('control')),
          emoji: normalizePickerEmoji(option?.emoji),
          title: String(option?.title || `Option ${optionIndex + 1}`).trim().slice(0, 100) || `Option ${optionIndex + 1}`,
          description: String(option?.description || '').trim().slice(0, 100),
          sortOrder: optionIndex,
          action: normalizeTemplateActionClient(option?.action),
        })),
      })),
    };
  }

  function normalizeTemplateControlsV2Client(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const dropdown = source.dropdown && typeof source.dropdown === 'object' && !Array.isArray(source.dropdown) ? source.dropdown : {};
    return normalizeTemplateControlsClient({
      type: source.type,
      buttons: source.buttons,
      dropdowns: [{ ...dropdown, id: clientReactionId('dropdown'), sortOrder: 0 }],
    });
  }

  function normalizeMessageTemplatesClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const folders = (Array.isArray(source.folders) ? source.folders : []).map((folder) => ({
      id: String(folder.id || ''), name: String(folder.name || 'Folder').trim().slice(0, 80),
      createdAt: String(folder.createdAt || ''), updatedAt: String(folder.updatedAt || ''),
    })).filter((folder) => folder.id);
    const folderIds = new Set(folders.map((folder) => folder.id));
    const items = (Array.isArray(source.items) ? source.items : []).map((item) => ({
      id: String(item.id || ''), folderId: folderIds.has(String(item.folderId || '')) ? String(item.folderId) : null,
      name: String(item.name || 'Template').trim().slice(0, 80), description: String(item.description || '').trim().slice(0, 500),
      version: 3, content: String(item.content || '').slice(0, 4000), layout: normalizeTemplateLayoutClient(item.layout),
      additionalContainers: normalizeAdditionalContainersClient(item.additionalContainers, normalizeTemplateLayoutClient, 4000),
      controls: Number(item.version) === 1
        ? clone(TEMPLATE_CONTROL_DEFAULTS)
        : Number(item.version) === 2 ? normalizeTemplateControlsV2Client(item.controls) : normalizeTemplateControlsClient(item.controls),
      defaultChannelId: String(item.defaultChannelId || ''), enabled: item.enabled !== false,
      createdAt: String(item.createdAt || ''), updatedAt: String(item.updatedAt || ''),
    })).filter((item) => item.id);
    return { folders, items };
  }

  function normalizePickerEmoji(value) {
    const id = /^\d{16,20}$/.test(String(value?.id || '')) ? String(value.id) : '';
    const name = String(value?.name || '').trim().slice(0, 100);
    return { id, name, animated: Boolean(id && value?.animated), source: id && value?.source === 'bot' ? 'bot' : id ? 'group' : 'default' };
  }

  function clientReactionId(prefix) {
    const random = window.crypto?.randomUUID?.().replace(/-/g, '').slice(0, 24)
      || `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, 24);
    return `${prefix}_${random}`;
  }

  function normalizeReactionRolesClient(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const items = (Array.isArray(source.items) ? source.items : []).map((item, itemIndex) => {
      const message = item?.message && typeof item.message === 'object' ? item.message : {};
      const dropdown = item?.dropdown && typeof item.dropdown === 'object' ? item.dropdown : {};
      return {
        id: String(item?.id || ''),
        name: String(item?.name || `Reaction Roles ${itemIndex + 1}`).trim().slice(0, 80),
        enabled: item?.enabled !== false,
        message: {
          content: String(message.content || '## Choose your roles\nUse the controls below to update your server roles.').slice(0, 4000),
          layout: normalizeTemplateLayoutClient(message.layout),
          additionalContainers: normalizeAdditionalContainersClient(message.additionalContainers, normalizeTemplateLayoutClient, 4000),
          sourceTemplateId: String(message.sourceTemplateId || ''),
        },
        interactionType: item?.interactionType === 'dropdown' ? 'dropdown' : 'button',
        buttons: (Array.isArray(item?.buttons) ? item.buttons : []).slice(0, 25).map((button, index) => ({
          id: String(button?.id || clientReactionId('button')),
          emoji: normalizePickerEmoji(button?.emoji),
          label: String(button?.label || button?.name || `Role ${index + 1}`).trim().slice(0, 80),
          style: ['Primary', 'Secondary', 'Success', 'Danger'].includes(button?.style) ? button.style : 'Secondary',
          roleId: String(button?.roleId || ''), sortOrder: index,
        })),
        dropdown: {
          placeholder: String(dropdown.placeholder || 'Choose your roles').trim().slice(0, 150),
          allowMultiple: dropdown.allowMultiple === true,
          options: (Array.isArray(dropdown.options) ? dropdown.options : []).slice(0, 25).map((option, index) => ({
            id: String(option?.id || clientReactionId('option')),
            emoji: normalizePickerEmoji(option?.emoji),
            title: String(option?.title || option?.label || `Role ${index + 1}`).trim().slice(0, 100),
            description: String(option?.description || '').trim().slice(0, 100),
            roleId: String(option?.roleId || ''), sortOrder: index,
          })),
        },
        channelId: String(item?.channelId || ''), publishedMessageId: String(item?.publishedMessageId || ''),
        createdAt: String(item?.createdAt || ''), updatedAt: String(item?.updatedAt || ''),
      };
    }).filter((item) => item.id);
    return { items };
  }

  function reactionRoleSnapshot() {
    const draft = state.reactionRoleDraft;
    return draft ? JSON.stringify({
      name: draft.name, enabled: draft.enabled, message: draft.message,
      interactionType: draft.interactionType, buttons: draft.buttons,
      dropdown: draft.dropdown, channelId: draft.channelId, publishedMessageId: draft.publishedMessageId,
    }) : '';
  }

  function reactionRoleIsDirty() {
    return Boolean(state.reactionRoleDraft && reactionRoleSnapshot() !== state.reactionRoleSavedSnapshot);
  }

  function reactionRoleEntries(draft = state.reactionRoleDraft) {
    return draft?.interactionType === 'dropdown' ? draft.dropdown.options : draft?.buttons || [];
  }

  function reactionRoleEmojiHtml(emoji) {
    const normalized = normalizePickerEmoji(emoji);
    if (!normalized.name) return '<span aria-hidden="true">＋</span>';
    if (!normalized.id) return `<span aria-hidden="true">${escapeHtml(normalized.name)}</span>`;
    const item = [...(state.directory.emojis?.bot || []), ...(state.directory.emojis?.group || [])].find((entry) => entry.id === normalized.id);
    return item?.url ? `<img src="${escapeHtml(item.url)}" alt="" width="24" height="24">` : `<span aria-hidden="true">:${escapeHtml(normalized.name)}:</span>`;
  }

  function renderReactionRoleList() {
    const items = state.reactionRoles.items;
    elements.reactionRoleCount.textContent = `${items.length} saved`;
    elements.reactionRoleList.innerHTML = items.length ? items.map((item) => `<button type="button" class="${item.id === state.reactionRoleSelectedId ? 'active ' : ''}${item.enabled ? '' : 'is-disabled'}" data-reaction-role-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><i aria-label="${item.enabled ? 'Enabled' : 'Disabled'}"></i></span><small>${item.interactionType === 'dropdown' ? 'Dropdown' : 'Buttons'} · ${reactionRoleEntries(item).length} role${reactionRoleEntries(item).length === 1 ? '' : 's'}</small></button>`).join('') : '<div class="template-list-empty">No Reaction Role templates yet.</div>';
  }

  function renderReactionRoleControlPreview() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    if (draft.interactionType === 'dropdown') {
      elements.reactionRoleControlPreview.innerHTML = `<div class="rr-preview-select">${escapeHtml(draft.dropdown.placeholder)} · ${draft.dropdown.options.length} option${draft.dropdown.options.length === 1 ? '' : 's'}</div>`;
      return;
    }
    elements.reactionRoleControlPreview.innerHTML = draft.buttons.map((button) => `<button type="button" class="rr-preview-button ${button.style.toLowerCase()}" disabled>${reactionRoleEmojiHtml(button.emoji)} ${escapeHtml(button.label)}</button>`).join('');
  }

  function renderReactionRoleComposerPanel() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const panel = state.reactionRoleComposerPanel;
    const layout = draft.message.layout;
    elements.reactionRoleComposerPanel.hidden = !panel;
    elements.reactionRoleVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.reactionRoleThumbnailToggle.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.reactionRoleGalleryToggle.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validTemplateMedia));
    if (!panel) return;
    if (panel === 'variables') {
      elements.reactionRoleComposerPanel.innerHTML = `<div class="variable-guide">${GENERIC_TEMPLATE_VARIABLES.map(([token, meaning]) => `<button type="button" data-insert-reaction-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.reactionRoleComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {server_icon}, an image URL, or an upload.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-reaction-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{server_icon} or https://example.com/image.png" data-reaction-thumbnail-url><label class="media-upload">Upload<input type="file" accept="image/*" data-reaction-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" data-reaction-gallery-url="${index}" placeholder="https://example.com/image.png"><label class="media-upload">Upload<input type="file" accept="image/*" data-reaction-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-reaction-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.reactionRoleComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 image URLs or uploads.</small></div><div><button type="button" data-add-reaction-gallery>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-reaction-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

  function renderReactionRoleMessage() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const content = inlineTemplateEditor(draft.message.content, 'content', 'reactionRole', 'Reaction Role message', genericTemplatePreviewValues(), 4000);
    renderDiscordComposerPreview({
      frame: elements.reactionRoleDiscordFrame, preview: elements.reactionRoleMessagePreview,
      accentButton: elements.reactionRoleAccentButton, accentInput: elements.reactionRoleAccentColor,
      containerButton: elements.reactionRoleContainerToggle, layout: draft.message.layout,
      contentHtml: content, resolveMedia: templatePreviewMediaUrl,
    });
    renderAdditionalContainerEditors({
      root: elements.reactionRoleAdditionalContainers, containers: draft.message.additionalContainers,
      prefix: 'reaction', scope: 'reactionRole', previewValues: genericTemplatePreviewValues(),
      resolveMedia: templatePreviewMediaUrl, maxLength: 4000,
    });
    elements.reactionRoleAdditionalContainer.disabled = draft.message.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    renderReactionRoleComposerPanel();
    renderReactionRoleControlPreview();
  }

  function renderReactionRoleControls() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    document.querySelectorAll('[data-reaction-mode]').forEach((button) => button.classList.toggle('active', button.dataset.reactionMode === draft.interactionType));
    elements.reactionRoleAddControl.textContent = draft.interactionType === 'dropdown' ? '+ Add option' : '+ Add button';
    elements.reactionRoleAddControl.disabled = reactionRoleEntries().length >= 25;
    if (draft.interactionType === 'button') {
      elements.reactionRoleControls.innerHTML = `<div class="rr-control-settings">${draft.buttons.map((button, index) => `<article class="rr-control-row" data-rr-row="${index}"><button class="rr-emoji-field" type="button" data-reaction-emoji="button:${index}" aria-label="Choose emoji for ${escapeHtml(button.label)}">${reactionRoleEmojiHtml(button.emoji)}</button><label>Label<input type="text" maxlength="80" value="${escapeHtml(button.label)}" data-rr-button-label="${index}"></label><label>Role<select data-rr-button-role="${index}">${roleOptions(button.roleId)}</select></label><label>Style<select data-rr-button-style="${index}">${['Primary','Secondary','Success','Danger'].map((style) => `<option${style === button.style ? ' selected' : ''}>${style}</option>`).join('')}</select></label><div class="rr-row-actions"><button type="button" data-rr-move="${index}:-1" aria-label="Move up">↑</button><button type="button" data-rr-move="${index}:1" aria-label="Move down">↓</button><button type="button" data-rr-remove="${index}" aria-label="Remove">×</button></div></article>`).join('')}</div>`;
    } else {
      elements.reactionRoleControls.innerHTML = `<div class="rr-control-settings"><label>Placeholder<input class="reaction-role-composer-input" type="text" maxlength="150" value="${escapeHtml(draft.dropdown.placeholder)}" data-rr-dropdown-placeholder></label><label class="rr-allow-multiple"><input type="checkbox" data-rr-allow-multiple${draft.dropdown.allowMultiple ? ' checked' : ''}><span><strong>Allow multiple selections</strong><small>Add selected roles and remove unselected roles managed by this template.</small></span></label></div><div class="rr-dropdown-options">${draft.dropdown.options.map((option, index) => `<article class="rr-control-row dropdown" data-rr-row="${index}"><button class="rr-emoji-field" type="button" data-reaction-emoji="option:${index}" aria-label="Choose emoji for ${escapeHtml(option.title)}">${reactionRoleEmojiHtml(option.emoji)}</button><label>Selection title<input type="text" maxlength="100" value="${escapeHtml(option.title)}" data-rr-option-title="${index}"></label><label>Description<input type="text" maxlength="100" value="${escapeHtml(option.description)}" data-rr-option-description="${index}"></label><label>Role<select data-rr-option-role="${index}">${roleOptions(option.roleId)}</select></label><div class="rr-row-actions"><button type="button" data-rr-move="${index}:-1" aria-label="Move up">↑</button><button type="button" data-rr-move="${index}:1" aria-label="Move down">↓</button><button type="button" data-rr-remove="${index}" aria-label="Remove">×</button></div></article>`).join('')}</div>`;
    }
  }

  function renderReactionRoleChannel() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    elements.reactionRoleChannel.innerHTML = channelOptions(draft.channelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose a message channel');
    const channel = state.directory.channels.find((entry) => entry.id === draft.channelId);
    const manageRolesMissing = (state.directory.botPermissions?.missing || []).some((item) => item.label === 'Manage Roles');
    const ready = Boolean(channel?.sendable && !manageRolesMissing);
    elements.reactionRolePermissionStatus.className = `rr-permission-status ${ready ? 'ok' : 'error'}`;
    elements.reactionRolePermissionStatus.textContent = ready ? 'CoinSprite can send messages and manage roles here.' : manageRolesMissing ? 'CoinSprite needs Manage Roles before publishing.' : 'Choose a sendable text channel.';
    const controls = draft.interactionType === 'button'
      ? draft.buttons.map((button) => `<button type="button" class="rr-preview-button ${button.style.toLowerCase()}" disabled>${reactionRoleEmojiHtml(button.emoji)} ${escapeHtml(button.label)}</button>`).join('')
      : `<div class="rr-preview-select">${escapeHtml(draft.dropdown.placeholder)} · ${draft.dropdown.options.length} option${draft.dropdown.options.length === 1 ? '' : 's'}</div>`;
    elements.reactionRoleFinalPreview.innerHTML = `<div class="rr-final-message"><article style="--accent:${escapeHtml(draft.message.layout.accentColor)}">${renderedEditableTemplate(draft.message.content, genericTemplatePreviewValues())}</article><div class="rr-final-controls">${controls}</div></div>`;
    elements.reactionRolePublish.disabled = state.reactionRoleSaving || !ready || !reactionRoleEntries().length;
  }

  function renderReactionRoleEditor() {
    const draft = state.reactionRoleDraft;
    elements.reactionRoleEmpty.hidden = Boolean(draft);
    elements.reactionRoleEditor.hidden = !draft;
    if (!draft) return;
    elements.reactionRoleName.value = draft.name;
    elements.reactionRoleEnabled.checked = draft.enabled;
    elements.reactionRolePublishedState.textContent = draft.publishedMessageId ? `Published message ${draft.publishedMessageId}` : 'Not published';
    elements.reactionRoleStatus.textContent = reactionRoleIsDirty() ? 'UNSAVED' : 'SAVED';
    elements.reactionRoleStatus.classList.toggle('unsaved', reactionRoleIsDirty());
    document.querySelectorAll('[data-reaction-tab]').forEach((button) => {
      const active = button.dataset.reactionTab === state.reactionRoleTab;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-reaction-panel]').forEach((panel) => {
      const active = panel.dataset.reactionPanel === state.reactionRoleTab;
      panel.hidden = !active; panel.classList.toggle('active', active);
    });
    renderReactionRoleMessage();
    renderReactionRoleControls();
    renderReactionRoleChannel();
    refreshDirty();
  }

  function renderReactionRoles() {
    renderReactionRoleList();
    renderReactionRoleEditor();
  }

  function replaceReactionRoles(payload, selectedId = state.reactionRoleSelectedId) {
    state.reactionRoles = normalizeReactionRolesClient(payload.reactionRoles || payload);
    const item = state.reactionRoles.items.find((entry) => entry.id === selectedId) || null;
    state.reactionRoleSelectedId = item?.id || '';
    state.reactionRoleDraft = item ? clone(item) : null;
    state.reactionRoleSavedSnapshot = reactionRoleSnapshot();
    renderReactionRoles();
  }

  async function selectReactionRole(id) {
    if (id === state.reactionRoleSelectedId) return;
    if (reactionRoleIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved Reaction Role changes?', copy: 'Your current draft has not been saved.', confirmLabel: 'Discard' });
      if (!confirmed) return;
    }
    const item = state.reactionRoles.items.find((entry) => entry.id === id);
    if (!item) return;
    state.reactionRoleSelectedId = item.id; state.reactionRoleDraft = clone(item);
    state.reactionRoleSavedSnapshot = reactionRoleSnapshot(); state.reactionRoleTab = 'message'; state.reactionRoleComposerPanel = '';
    renderReactionRoles();
  }

  async function createReactionRole() {
    if (reactionRoleIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved Reaction Role changes?', copy: 'Creating a template closes this draft.', confirmLabel: 'Discard and create' });
      if (!confirmed) return;
    }
    const payload = await api(`/api/guilds/${state.guildId}/reaction-roles`, { method: 'POST', body: JSON.stringify({ name: `Reaction Roles ${state.reactionRoles.items.length + 1}` }) });
    replaceReactionRoles(payload, payload.item.id); state.reactionRoleTab = 'message';
    elements.reactionRoleName.focus(); elements.reactionRoleName.select(); showToast('Reaction Role template created.');
  }

  function reactionRoleUpdateBody() {
    const draft = state.reactionRoleDraft;
    return {
      name: draft.name, enabled: draft.enabled, message: draft.message,
      interactionType: draft.interactionType, buttons: draft.buttons,
      dropdown: draft.dropdown, channelId: draft.channelId, publishedMessageId: draft.publishedMessageId,
    };
  }

  async function saveReactionRole() {
    if (!state.reactionRoleDraft || state.reactionRoleSaving || !reactionRoleIsDirty()) return state.reactionRoleDraft;
    state.reactionRoleSaving = true; refreshDirty();
    try {
      const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}`, { method: 'PATCH', body: JSON.stringify(reactionRoleUpdateBody()) });
      replaceReactionRoles(payload, payload.item.id); showToast('Reaction Role draft saved.'); return payload.item;
    } finally { state.reactionRoleSaving = false; refreshDirty(); }
  }

  async function duplicateReactionRole() {
    if (!state.reactionRoleDraft) return;
    if (reactionRoleIsDirty()) return showToast('Save or reset changes before duplicating.', 'error');
    const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}/duplicate`, { method: 'POST', body: '{}' });
    replaceReactionRoles(payload, payload.item.id); showToast('Reaction Role template duplicated.');
  }

  async function deleteReactionRole() {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const confirmed = await confirmAction({ title: 'Delete this Reaction Role template?', copy: `“${draft.name}” will be removed. Its existing Discord message will stop responding.`, confirmLabel: 'Delete' });
    if (!confirmed) return;
    const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${draft.id}`, { method: 'DELETE', body: '{}' });
    replaceReactionRoles(payload, ''); showToast('Reaction Role template deleted.');
  }

  async function publishReactionRole() {
    if (!state.reactionRoleDraft || state.reactionRoleSaving) return;
    if (reactionRoleIsDirty()) await saveReactionRole();
    const confirmed = await confirmAction({ title: state.reactionRoleDraft.publishedMessageId ? 'Update the published message?' : 'Publish this Reaction Role message?', copy: 'CoinSprite will recheck the channel, role hierarchy, and permissions before sending.', confirmLabel: state.reactionRoleDraft.publishedMessageId ? 'Update message' : 'Publish' });
    if (!confirmed) return;
    state.reactionRoleSaving = true; renderReactionRoleChannel();
    try {
      const payload = await api(`/api/guilds/${state.guildId}/reaction-roles/${state.reactionRoleDraft.id}/publish`, { method: 'POST', body: '{}' });
      replaceReactionRoles(payload, payload.item.id);
      showToast(payload.updated ? 'Published Reaction Role message updated.' : 'Reaction Role message published.', '', payload.messageUrl);
    } finally { state.reactionRoleSaving = false; refreshDirty(); }
  }

  function customEmojiMarkup(emoji) {
    const item = normalizePickerEmoji(emoji);
    if (!item.id) return item.name;
    return `<${item.animated ? 'a' : ''}:${item.name}:${item.id}>`;
  }

  function ensureDefaultEmojiData() {
    if (DEFAULT_EMOJI_DATA.groups.length) return Promise.resolve(DEFAULT_EMOJI_DATA);
    if (defaultEmojiDataPromise) return defaultEmojiDataPromise;
    defaultEmojiDataPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = DEFAULT_EMOJI_DATA_URL;
      script.async = true;
      script.addEventListener('load', () => {
        DEFAULT_EMOJI_DATA = window.COINSPRITE_EMOJI_DATA || EMPTY_EMOJI_DATA;
        if (!DEFAULT_EMOJI_DATA.groups.length) {
          defaultEmojiDataPromise = null;
          reject(new Error('The default emoji catalog is unavailable.'));
          return;
        }
        defaultEmojiItemCache.clear();
        if (!state.emojiCategory) state.emojiCategory = DEFAULT_EMOJI_DATA.groups[0]?.id || '';
        resolve(DEFAULT_EMOJI_DATA);
      }, { once: true });
      script.addEventListener('error', () => {
        defaultEmojiDataPromise = null;
        reject(new Error('The default emoji catalog could not be loaded.'));
      }, { once: true });
      document.head.append(script);
    });
    return defaultEmojiDataPromise;
  }

  function defaultEmojiItems(groupId = '') {
    const cacheKey = groupId || '*';
    if (defaultEmojiItemCache.has(cacheKey)) return defaultEmojiItemCache.get(cacheKey);
    const groups = groupId ? DEFAULT_EMOJI_DATA.groups.filter((group) => group.id === groupId) : DEFAULT_EMOJI_DATA.groups;
    const items = groups.flatMap((group) => group.emojis.map(([character, name]) => Object.freeze({
      id: '', name: character, character, animated: false, source: 'default', searchName: name,
      searchText: `${name} ${character}`.toLowerCase(), groupId: group.id,
    })));
    defaultEmojiItemCache.set(cacheKey, items);
    return items;
  }

  function pickerItems(section = state.emojiSection, allDefaults = false) {
    if (section === 'default') return defaultEmojiItems(allDefaults ? '' : state.emojiCategory);
    const source = state.directory.emojis?.[section] || [];
    const cached = directoryEmojiItemCache.get(section);
    if (cached?.source === source) return cached.items;
    const items = source.map((emoji) => {
      const item = { ...normalizePickerEmoji(emoji), url: String(emoji.url || ''), searchName: String(emoji.name || '') };
      item.searchText = `${item.searchName} ${item.name}`.toLowerCase();
      return Object.freeze(item);
    });
    directoryEmojiItemCache.set(section, { source, items });
    return items;
  }

  function renderEmojiCategories(search) {
    const visible = state.emojiSection === 'default';
    elements.emojiPickerCategories.hidden = !visible;
    elements.emojiPickerCategories.replaceChildren();
    if (!visible) return;
    const fragment = document.createDocumentFragment();
    for (const group of DEFAULT_EMOJI_DATA.groups) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.emojiCategory = group.id;
      button.textContent = group.icon; button.title = group.name; button.setAttribute('aria-label', group.name);
      const active = !search && group.id === state.emojiCategory;
      button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      fragment.append(button);
    }
    elements.emojiPickerCategories.append(fragment);
  }

  function appendEmojiPickerBatch(reset = false) {
    const items = state.emojiPickerItems;
    if (reset) {
      elements.emojiPickerGrid.replaceChildren();
      state.emojiRenderedCount = 0;
    }
    elements.emojiPickerGrid.querySelector('.emoji-picker-more')?.remove();
    if (!items.length) {
      if (!reset) return;
      const search = elements.emojiPickerSearch.value.trim();
      const empty = document.createElement('div'); empty.className = 'emoji-picker-empty';
      empty.textContent = search ? 'No emojis match this search.' : `No ${state.emojiSection === 'bot' ? 'Bot' : state.emojiSection === 'group' ? 'Group' : 'Default'} Emojis are available.`;
      elements.emojiPickerGrid.append(empty); return;
    }
    const start = state.emojiRenderedCount;
    const end = Math.min(items.length, start + EMOJI_RENDER_BATCH);
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index += 1) {
      const emoji = items[index];
      const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'gridcell');
      button.dataset.emojiIndex = String(index); button.setAttribute('aria-label', emoji.searchName || emoji.name); button.title = emoji.searchName || emoji.name;
      if (emoji.animated) button.classList.add('animated');
      if (emoji.id && emoji.url) {
        const image = document.createElement('img'); image.src = emoji.url; image.alt = ''; image.loading = 'lazy'; button.append(image);
      } else button.textContent = emoji.name;
      fragment.append(button);
    }
    state.emojiRenderedCount = end;
    if (end < items.length) {
      const more = document.createElement('div'); more.className = 'emoji-picker-more';
      more.textContent = `Showing ${end} of ${items.length}`; fragment.append(more);
    }
    elements.emojiPickerGrid.append(fragment);
  }

  function renderEmojiPicker() {
    const search = elements.emojiPickerSearch.value.trim().toLowerCase();
    document.querySelectorAll('[data-emoji-section]').forEach((button) => {
      const active = button.dataset.emojiSection === state.emojiSection;
      button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active));
    });
    const failed = state.emojiSection !== 'default' && state.directory.emojis?.errors?.[state.emojiSection];
    renderEmojiCategories(search);
    const items = pickerItems(state.emojiSection, Boolean(search)).filter((emoji) => !search || emoji.searchText.includes(search));
    state.emojiPickerItems = items;
    const activeGroup = DEFAULT_EMOJI_DATA.groups.find((group) => group.id === state.emojiCategory);
    elements.emojiPickerStatus.className = `emoji-picker-status${failed ? ' error' : ''}`;
    elements.emojiPickerStatus.textContent = failed
      ? `${state.emojiSection === 'bot' ? 'Bot' : 'Group'} emojis could not be loaded. The other sections still work.`
      : state.emojiSection === 'default'
        ? `${items.length} emoji${items.length === 1 ? '' : 's'}${search ? ' found across all categories' : ` · ${activeGroup?.name || 'Default Emojis'}`} · Unicode ${DEFAULT_EMOJI_DATA.version}`
        : `${items.length} emoji${items.length === 1 ? '' : 's'}${search ? ' found' : ''}`;
    appendEmojiPickerBatch(true);
    elements.emojiPickerGrid.scrollTop = 0;
  }

  function preferredInlineInput(scope) {
    const roots = {
      leveling: elements.levelingView,
      memberMessages: elements.welcomeMessagesView,
      messageTemplate: elements.messageTemplatesView,
      reactionRole: elements.reactionRolesView,
      xpDrop: elements.xpDropMessagePreview,
      xpClaim: elements.xpDropClaimPreview,
    };
    const root = roots[scope];
    if (!root) return null;
    const bookmark = state.inlineTextCarets.get(scope);
    const remembered = bookmark?.input?.isConnected && root.contains(bookmark.input) ? bookmark.input : null;
    const active = document.activeElement?.matches?.('[data-inline-message-input]') && root.contains(document.activeElement) ? document.activeElement : null;
    const editing = root.querySelector('[data-inline-message-editor].editing [data-inline-message-input]');
    const input = active || remembered || editing || root.querySelector('[data-inline-message-input]');
    if (input && !input.closest('[data-inline-message-editor]')?.classList.contains('editing')) {
      beginInlineMessageEdit(input.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-display]'));
    }
    return input || root.querySelector('[data-inline-message-editor].editing [data-inline-message-input]');
  }

  function rememberInlineTextCaret(input) {
    if (!input?.matches?.('[data-inline-message-input]')) return;
    const scope = String(input.dataset.inlineTemplateScope || '');
    if (!scope) return;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    state.inlineTextCarets.set(scope, { input, start, end });
  }

  function restoreEmojiTextTarget(target, start = target?.start, end = start) {
    const input = target?.input;
    if (!input?.isConnected) return;
    const safeStart = Math.max(0, Math.min(input.value.length, Number(start) || 0));
    const safeEnd = Math.max(safeStart, Math.min(input.value.length, Number(end) || safeStart));
    input.closest('[data-inline-message-editor]')?.classList.add('editing');
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      input.focus({ preventScroll: true });
      input.setSelectionRange(safeStart, safeEnd);
      rememberInlineTextCaret(input);
    }));
  }

  async function openEmojiPicker(target) {
    const resolved = typeof target === 'string' ? { type: 'text', scope: target, input: preferredInlineInput(target) } : target;
    if (resolved?.type === 'text' && !resolved.input) return showToast('Open a message editor before choosing an emoji.', 'error');
    resolved.trigger = resolved.trigger || document.activeElement;
    if (resolved?.type === 'text') {
      const bookmark = state.inlineTextCarets.get(resolved.scope);
      resolved.start = bookmark?.input === resolved.input ? bookmark.start : Number.isInteger(resolved.input.selectionStart) ? resolved.input.selectionStart : resolved.input.value.length;
      resolved.end = bookmark?.input === resolved.input ? bookmark.end : Number.isInteger(resolved.input.selectionEnd) ? resolved.input.selectionEnd : resolved.start;
      rememberInlineTextCaret(resolved.input);
    }
    state.emojiTarget = resolved;
    state.emojiCategory = DEFAULT_EMOJI_DATA.groups[0]?.id || '';
    state.emojiSection = pickerItems('bot').length ? 'bot' : pickerItems('group').length ? 'group' : 'default';
    elements.emojiPickerSearch.value = '';
    elements.emojiPickerDialog.showModal();
    elements.emojiPickerSearch.focus();
    if (state.emojiSection === 'default' && !DEFAULT_EMOJI_DATA.groups.length) {
      elements.emojiPickerStatus.className = 'emoji-picker-status';
      elements.emojiPickerStatus.textContent = 'Loading the default emoji catalog…';
      elements.emojiPickerGrid.replaceChildren();
      const loading = document.createElement('div'); loading.className = 'emoji-picker-empty'; loading.textContent = 'Loading emojis…';
      elements.emojiPickerGrid.append(loading);
      try {
        await ensureDefaultEmojiData();
      } catch (error) {
        elements.emojiPickerStatus.className = 'emoji-picker-status error';
        elements.emojiPickerStatus.textContent = error.message;
        loading.textContent = 'Try opening the picker again.';
        return;
      }
    }
    if (state.emojiTarget !== resolved || !elements.emojiPickerDialog.open) return;
    if (!state.emojiCategory) state.emojiCategory = DEFAULT_EMOJI_DATA.groups[0]?.id || '';
    renderEmojiPicker();
  }

  function closeEmojiPicker(restoreText = true) {
    const target = state.emojiTarget;
    window.clearTimeout(emojiSearchTimer);
    emojiSearchTimer = null;
    if (elements.emojiPickerDialog.open) elements.emojiPickerDialog.close();
    if (restoreText && target?.type === 'text') restoreEmojiTextTarget(target, target.start, target.end);
    else if (target?.trigger?.isConnected) window.requestAnimationFrame(() => target.trigger.focus({ preventScroll: true }));
  }

  function applyPickedEmoji(emoji) {
    const target = state.emojiTarget;
    if (!target) return;
    const normalized = normalizePickerEmoji(emoji);
    if (target.type === 'text') {
      const input = target.input;
      const insertion = customEmojiMarkup(normalized);
      const maximum = Number(input.maxLength) > 0 ? Number(input.maxLength) : 4000;
      input.value = `${input.value.slice(0, target.start)}${insertion}${input.value.slice(target.end)}`.slice(0, maximum);
      const cursor = Math.min(input.value.length, target.start + insertion.length);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      closeEmojiPicker(false);
      restoreEmojiTextTarget(target, cursor, cursor);
      return;
    }
    if (['template-button', 'template-option'].includes(target.type)) {
      const control = templateControlAt(target.spec);
      if (!control) return;
      control.entry.emoji = normalized;
      const row = elements.templateControls.querySelector(`[data-template-control-row="${target.spec}"]`);
      const button = row?.querySelector('[data-template-control-emoji]');
      if (button) {
        button.innerHTML = reactionRoleEmojiHtml(normalized);
        button.setAttribute('aria-label', `Choose emoji for ${control.entry.label || control.entry.title || 'control'}`);
      }
      closeEmojiPicker(); renderTemplateControlPreview(); syncTemplateJson(); refreshTemplateDirty();
      return;
    }
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    const entries = target.type === 'button' ? draft.buttons : draft.dropdown.options;
    if (entries[target.index]) entries[target.index].emoji = normalized;
    closeEmojiPicker(); renderReactionRoleEditor();
  }

  function templateDocument(draft = state.templateDraft) {
    return {
      version: 3,
      content: String(draft?.content || '').slice(0, 4000),
      layout: normalizeTemplateLayoutClient(draft?.layout),
      additionalContainers: normalizeAdditionalContainersClient(draft?.additionalContainers, normalizeTemplateLayoutClient, 4000),
      controls: normalizeTemplateControlsClient(draft?.controls),
    };
  }

  function parseTemplateLayoutClient(layout, label = 'layout') {
    if (!layout || typeof layout !== 'object' || Array.isArray(layout)) throw new Error(`${label} must be an object.`);
    const unknownLayout = Object.keys(layout).filter((key) => !['container', 'accentColor', 'thumbnailEnabled', 'thumbnailUrl', 'galleryUrls'].includes(key));
    if (unknownLayout.length) throw new Error(`Unknown ${label} field${unknownLayout.length === 1 ? '' : 's'}: ${unknownLayout.join(', ')}.`);
    if (typeof layout.container !== 'boolean') throw new Error(`${label}.container must be true or false.`);
    if (typeof layout.thumbnailEnabled !== 'boolean') throw new Error(`${label}.thumbnailEnabled must be true or false.`);
    if (!/^#[0-9a-f]{6}$/i.test(String(layout.accentColor || ''))) throw new Error(`${label}.accentColor must be a six-digit hex color.`);
    if (!Array.isArray(layout.galleryUrls)) throw new Error(`${label}.galleryUrls must be an array.`);
    if (layout.galleryUrls.length > 10) throw new Error('A gallery supports up to 10 images.');
    if (layout.thumbnailUrl && !validTemplateMedia(layout.thumbnailUrl)) throw new Error(`${label} thumbnail must be an HTTP/HTTPS URL or a supported media variable.`);
    layout.galleryUrls.forEach((url, index) => {
      if (!validTemplateMedia(url)) throw new Error(`${label} gallery image ${index + 1} must be an HTTP/HTTPS URL or a supported media variable.`);
    });
    return normalizeTemplateLayoutClient(layout);
  }

  function assertTemplateJsonFields(value, allowed, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
    const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
    if (unknown.length) throw new Error(`Unknown ${label} field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
  }

  function parseTemplateEmojiClient(value, label) {
    assertTemplateJsonFields(value, ['id', 'name', 'animated', 'source'], label);
    if (value.id && !/^\d{16,20}$/.test(String(value.id))) throw new Error(`${label}.id must be a Discord ID.`);
    if (typeof value.name !== 'string') throw new Error(`${label}.name must be a string.`);
    if (typeof value.animated !== 'boolean') throw new Error(`${label}.animated must be true or false.`);
    if (!['default', 'group', 'bot'].includes(value.source)) throw new Error(`${label}.source is invalid.`);
    return normalizePickerEmoji(value);
  }

  function parseTemplateActionClient(value, label) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !TEMPLATE_ACTION_TYPES.includes(value.type)) throw new Error(`${label}.type is invalid.`);
    const templateAction = ['send_message', 'dm_message'].includes(value.type);
    assertTemplateJsonFields(value, templateAction ? ['type', 'templateId'] : ['type', 'roleId'], label);
    if (templateAction) {
      const templateId = String(value.templateId || '');
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(templateId)) throw new Error(`${label}.templateId is invalid.`);
      const stored = currentStoredTemplate();
      const preservedMissing = [
        ...(stored?.controls?.buttons || []),
        ...(stored?.controls?.dropdowns || []).flatMap((dropdown) => dropdown.options || []),
      ]
        .some((entry) => ['send_message', 'dm_message'].includes(entry.action?.type) && entry.action.templateId === templateId);
      if (!state.messageTemplates.items.some((item) => item.id === templateId) && !preservedMissing) throw new Error(`${label} must reference a Message Template in this server.`);
      return { type: value.type, templateId };
    }
    if (!/^\d{16,20}$/.test(String(value.roleId || ''))) throw new Error(`${label}.roleId must be a Discord ID.`);
    return { type: value.type, roleId: String(value.roleId) };
  }

  function parseTemplateControlsClient(value) {
    assertTemplateJsonFields(value, ['type', 'buttons', 'dropdowns'], 'controls');
    if (!['none', 'button', 'dropdown'].includes(value.type)) throw new Error('controls.type must be none, button, or dropdown.');
    if (!Array.isArray(value.buttons) || value.buttons.length > 25) throw new Error('controls.buttons must be an array with at most 25 entries.');
    const buttonIds = new Set();
    const buttons = value.buttons.map((button, index) => {
      const label = `controls.buttons[${index}]`;
      assertTemplateJsonFields(button, ['id', 'emoji', 'label', 'style', 'sortOrder', 'action'], label);
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(String(button.id || '')) || buttonIds.has(button.id)) throw new Error(`${label}.id must be unique and stable.`);
      buttonIds.add(button.id);
      if (typeof button.label !== 'string' || !button.label.trim() || button.label.trim().length > 80) throw new Error(`${label}.label must be between 1 and 80 characters.`);
      if (!['Primary', 'Secondary', 'Success', 'Danger'].includes(button.style)) throw new Error(`${label}.style is unsupported.`);
      if (!Number.isInteger(button.sortOrder) || button.sortOrder < 0) throw new Error(`${label}.sortOrder must be a non-negative integer.`);
      return { id: button.id, emoji: parseTemplateEmojiClient(button.emoji, `${label}.emoji`), label: button.label.trim(), style: button.style, sortOrder: button.sortOrder, action: parseTemplateActionClient(button.action, `${label}.action`) };
    }).sort((left, right) => left.sortOrder - right.sortOrder).map((button, index) => ({ ...button, sortOrder: index }));
    if (!Array.isArray(value.dropdowns) || value.dropdowns.length > 5) throw new Error('controls.dropdowns must be an array with at most 5 entries.');
    const dropdownIds = new Set();
    const dropdowns = value.dropdowns.map((dropdown, dropdownIndex) => {
      const dropdownLabel = `controls.dropdowns[${dropdownIndex}]`;
      assertTemplateJsonFields(dropdown, ['id', 'placeholder', 'allowMultiple', 'sortOrder', 'options'], dropdownLabel);
      if (!/^[a-zA-Z0-9_-]{8,64}$/.test(String(dropdown.id || '')) || dropdownIds.has(dropdown.id)) throw new Error(`${dropdownLabel}.id must be unique and stable.`);
      dropdownIds.add(dropdown.id);
      if (typeof dropdown.placeholder !== 'string' || !dropdown.placeholder.trim() || dropdown.placeholder.trim().length > 150) throw new Error(`${dropdownLabel}.placeholder must be between 1 and 150 characters.`);
      if (typeof dropdown.allowMultiple !== 'boolean') throw new Error(`${dropdownLabel}.allowMultiple must be true or false.`);
      if (!Number.isInteger(dropdown.sortOrder) || dropdown.sortOrder < 0) throw new Error(`${dropdownLabel}.sortOrder must be a non-negative integer.`);
      if (!Array.isArray(dropdown.options) || dropdown.options.length > 25) throw new Error(`${dropdownLabel}.options must be an array with at most 25 entries.`);
      const optionIds = new Set();
      const options = dropdown.options.map((option, optionIndex) => {
        const label = `${dropdownLabel}.options[${optionIndex}]`;
        assertTemplateJsonFields(option, ['id', 'emoji', 'title', 'description', 'sortOrder', 'action'], label);
        if (!/^[a-zA-Z0-9_-]{8,64}$/.test(String(option.id || '')) || optionIds.has(option.id)) throw new Error(`${label}.id must be unique and stable.`);
        optionIds.add(option.id);
        if (typeof option.title !== 'string' || !option.title.trim() || option.title.trim().length > 100) throw new Error(`${label}.title must be between 1 and 100 characters.`);
        if (typeof option.description !== 'string' || option.description.trim().length > 100) throw new Error(`${label}.description must be 100 characters or fewer.`);
        if (!Number.isInteger(option.sortOrder) || option.sortOrder < 0) throw new Error(`${label}.sortOrder must be a non-negative integer.`);
        return { id: option.id, emoji: parseTemplateEmojiClient(option.emoji, `${label}.emoji`), title: option.title.trim(), description: option.description.trim(), sortOrder: option.sortOrder, action: parseTemplateActionClient(option.action, `${label}.action`) };
      }).sort((left, right) => left.sortOrder - right.sortOrder).map((option, index) => ({ ...option, sortOrder: index }));
      return { id: dropdown.id, placeholder: dropdown.placeholder.trim(), allowMultiple: dropdown.allowMultiple, sortOrder: dropdown.sortOrder, options };
    }).sort((left, right) => left.sortOrder - right.sortOrder).map((dropdown, index) => ({ ...dropdown, sortOrder: index }));
    return { type: value.type, buttons, dropdowns };
  }

  function parseTemplateControlsV2Client(value) {
    assertTemplateJsonFields(value, ['type', 'buttons', 'dropdown'], 'controls');
    assertTemplateJsonFields(value.dropdown, ['placeholder', 'allowMultiple', 'options'], 'controls.dropdown');
    return parseTemplateControlsClient({
      type: value.type,
      buttons: value.buttons,
      dropdowns: [{
        id: clientReactionId('dropdown'),
        placeholder: value.dropdown.placeholder,
        allowMultiple: value.dropdown.allowMultiple,
        sortOrder: 0,
        options: value.dropdown.options,
      }],
    });
  }

  function parseTemplateJsonText(text) {
    let parsed;
    try { parsed = JSON.parse(text); } catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Template JSON must be an object.');
    const version = Number(parsed.version);
    const unknown = Object.keys(parsed).filter((key) => !(version === 1
      ? ['version', 'content', 'layout', 'additionalContainers']
      : ['version', 'content', 'layout', 'additionalContainers', 'controls']).includes(key));
    if (unknown.length) throw new Error(`Unknown template field${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
    if (![1, 2, 3].includes(version)) throw new Error('Template JSON version must be 1, 2, or 3.');
    if (typeof parsed.content !== 'string') throw new Error('content must be a string.');
    if (parsed.content.length > 4000) throw new Error('content must be 4000 characters or fewer.');
    if ((parsed.content.match(/\{separator\}/gi) || []).length > 4) throw new Error('Templates support up to 4 dividers.');
    const layout = parseTemplateLayoutClient(parsed.layout);
    const additional = parsed.additionalContainers === undefined ? [] : parsed.additionalContainers;
    if (!Array.isArray(additional)) throw new Error('additionalContainers must be an array.');
    if (additional.length > MAX_ADDITIONAL_MESSAGE_CONTAINERS) throw new Error(`Templates support up to ${MAX_ADDITIONAL_MESSAGE_CONTAINERS} additional containers.`);
    const additionalContainers = additional.map((container, index) => {
      if (!container || typeof container !== 'object' || Array.isArray(container)) throw new Error(`Additional container ${index + 1} must be an object.`);
      const unknownContainer = Object.keys(container).filter((key) => !['content', 'layout'].includes(key));
      if (unknownContainer.length) throw new Error(`Unknown additional container ${index + 1} field${unknownContainer.length === 1 ? '' : 's'}: ${unknownContainer.join(', ')}.`);
      if (typeof container.content !== 'string') throw new Error(`Additional container ${index + 1} content must be a string.`);
      if (container.content.length > 4000) throw new Error(`Additional container ${index + 1} content must be 4000 characters or fewer.`);
      if ((container.content.match(/\{separator\}/gi) || []).length > 4) throw new Error(`Additional container ${index + 1} supports up to 4 dividers.`);
      return { content: container.content, layout: { ...parseTemplateLayoutClient(container.layout, `additionalContainers[${index}].layout`), container: true } };
    });
    const controls = version === 1
      ? clone(TEMPLATE_CONTROL_DEFAULTS)
      : version === 2 ? parseTemplateControlsV2Client(parsed.controls) : parseTemplateControlsClient(parsed.controls);
    return { version: 3, content: parsed.content, layout, additionalContainers, controls };
  }

  function templateVariableNames(item = state.templateDraft) {
    const found = new Set();
    const values = [
      item?.content, item?.layout?.thumbnailUrl, ...(item?.layout?.galleryUrls || []),
      ...(item?.additionalContainers || []).flatMap((container) => [container.content, container.layout?.thumbnailUrl, ...(container.layout?.galleryUrls || [])]),
    ];
    for (const value of values) String(value || '').replace(/\{([a-z0-9_]+)\}/gi, (token, key) => {
      found.add(key.toLowerCase()); return token;
    });
    return [...found];
  }

  function templateSnapshot() {
    return state.templateDraft ? JSON.stringify({
      name: state.templateDraft.name, description: state.templateDraft.description,
      folderId: state.templateDraft.folderId, defaultChannelId: state.templateDraft.defaultChannelId,
      enabled: state.templateDraft.enabled, ...templateDocument(),
    }) : '';
  }

  function templateIsDirty() {
    return Boolean(state.templateDraft && templateSnapshot() !== state.templateSavedSnapshot);
  }

  function currentStoredTemplate() {
    return state.messageTemplates.items.find((item) => item.id === state.templateSelectedId) || null;
  }

  function formatTemplateDate(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown';
  }

  function templateFolderName(folderId) {
    return state.messageTemplates.folders.find((folder) => folder.id === folderId)?.name || 'Unfiled';
  }

  function updateTemplateDeepLink() {
    if (!state.guildId || state.currentView !== 'message-templates') return;
    const params = new URLSearchParams({ guild: state.guildId, view: 'message-templates' });
    if (state.templateSelectedId) params.set('template', state.templateSelectedId);
    const linkedFolder = state.templateDraft?.folderId || (!['all', 'unfiled'].includes(state.templateFolderId) ? state.templateFolderId : '');
    if (linkedFolder) params.set('folder', linkedFolder);
    history.replaceState(null, '', `/admin?${params}`);
    if (state.templateDraft) elements.templateShareLink.value = `${location.origin}/admin?${params}`;
  }

  function renderTemplateFolders() {
    const total = state.messageTemplates.items.length;
    const unfiled = state.messageTemplates.items.filter((item) => !item.folderId).length;
    elements.templateTotalCount.textContent = `${total} template${total === 1 ? '' : 's'}`;
    const special = [
      ['all', '⌘', 'All templates', total], ['unfiled', '◇', 'Unfiled', unfiled],
    ];
    const rows = special.map(([id, icon, name, count]) => `<div class="template-folder-row${state.templateFolderId === id ? ' active' : ''}"><button type="button" data-template-folder="${id}"><i>${icon}</i><span>${name}</span><b>${count}</b></button></div>`);
    for (const folder of state.messageTemplates.folders) {
      const count = state.messageTemplates.items.filter((item) => item.folderId === folder.id).length;
      rows.push(`<div class="template-folder-row${state.templateFolderId === folder.id ? ' active' : ''}"><button type="button" data-template-folder="${escapeHtml(folder.id)}"><i>□</i><span>${escapeHtml(folder.name)}</span><b>${count}</b></button><span class="template-folder-actions"><button type="button" data-template-folder-rename="${escapeHtml(folder.id)}" aria-label="Rename ${escapeHtml(folder.name)}" title="Rename folder">✎</button><button type="button" data-template-folder-delete="${escapeHtml(folder.id)}" aria-label="Delete ${escapeHtml(folder.name)}" title="Delete folder">×</button></span></div>`);
    }
    elements.templateFolderList.innerHTML = rows.join('');
  }

  function visibleTemplates(folderId = state.templateFolderId) {
    const search = elements.templateSearch.value.trim().toLowerCase();
    return state.messageTemplates.items.filter((item) => {
      const inFolder = folderId === 'all' || (folderId === 'unfiled' ? !item.folderId : item.folderId === folderId);
      return inFolder && (!search || item.name.toLowerCase().includes(search));
    }).sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt) || left.name.localeCompare(right.name));
  }

  function renderTemplateList() {
    const items = visibleTemplates();
    elements.templateList.innerHTML = items.length ? items.map((item) => `<button class="template-list-item${item.id === state.templateSelectedId ? ' active' : ''}${item.enabled ? '' : ' is-disabled'}" type="button" data-template-id="${escapeHtml(item.id)}"><span><strong>${escapeHtml(item.name)}</strong><i aria-label="${item.enabled ? 'Enabled' : 'Disabled'}"></i></span><small>${escapeHtml(templateFolderName(item.folderId))} · Updated ${escapeHtml(formatTemplateDate(item.updatedAt))}</small></button>`).join('') : `<div class="template-list-empty">${state.messageTemplates.items.length ? 'No templates match this collection or search.' : 'No templates yet. Create a blank template to get started.'}</div>`;
  }

  function templatePreviewMediaUrl(value) {
    const resolved = interpolateTemplate(value, genericTemplatePreviewValues());
    return validHttpUrl(resolved) ? resolved.trim() : '';
  }

  function templateControlEntries(draft = state.templateDraft) {
    return draft?.controls?.type === 'dropdown' ? draft.controls.dropdowns : draft?.controls?.buttons || [];
  }

  function templateActionStatus(action) {
    const label = TEMPLATE_ACTION_LABELS[action?.type] || 'Unknown action';
    if (['send_message', 'dm_message'].includes(action?.type)) {
      if (!action.templateId) return { complete: false, summary: `${label}: Choose a template` };
      const target = state.messageTemplates.items.find((item) => item.id === action.templateId);
      if (!target) return { complete: false, summary: `${label}: Missing template` };
      if (!target.enabled) return { complete: false, summary: `${label}: ${target.name} is disabled` };
      return { complete: true, summary: `${label}: ${target.name}` };
    }
    if (!action?.roleId) return { complete: false, summary: `${label}: Choose a role` };
    const role = (state.directory.roles || []).find((item) => item.id === action.roleId);
    if (!role) return { complete: false, summary: `${label}: Missing role` };
    if (role.managed || role.administrator || role.editable === false || role.belowBot === false) return { complete: false, summary: `${label}: @${role.name} is not manageable` };
    return { complete: true, summary: `${label}: @${role.name}` };
  }

  function templateActionOptions(selected) {
    return TEMPLATE_ACTION_TYPES.map((type) => `<option value="${type}"${type === selected ? ' selected' : ''}>${TEMPLATE_ACTION_LABELS[type]}</option>`).join('');
  }

  function templateDropdownAt(id) {
    const dropdowns = state.templateDraft?.controls?.dropdowns || [];
    const dropdownIndex = dropdowns.findIndex((entry) => entry.id === id);
    return dropdownIndex >= 0 ? { dropdown: dropdowns[dropdownIndex], dropdownIndex, dropdowns } : null;
  }

  function newTemplateOption(index = 0, title = `Option ${index + 1}`) {
    return {
      id: clientReactionId('control'), emoji: { id: '', name: '✨', animated: false, source: 'default' },
      title, description: '', sortOrder: index, action: { type: 'send_message', templateId: '' },
    };
  }

  function newTemplateDropdown(index = 0) {
    return {
      id: clientReactionId('dropdown'), placeholder: `Choose an option${index ? ` ${index + 1}` : ''}`,
      allowMultiple: false, sortOrder: index, options: [newTemplateOption()],
    };
  }

  function duplicateTemplateOptionTitle(dropdown, sourceTitle) {
    const base = `${String(sourceTitle || 'Option').trim() || 'Option'} copy`.slice(0, 100);
    const used = new Set(dropdown.options.map((option) => String(option.title || '').trim().toLocaleLowerCase()));
    if (!used.has(base.toLocaleLowerCase())) return base;
    let suffix = 2;
    while (suffix < 100) {
      const ending = ` ${suffix++}`;
      const candidate = `${base.slice(0, 100 - ending.length)}${ending}`;
      if (!used.has(candidate.toLocaleLowerCase())) return candidate;
    }
    return `Option ${clientReactionId('copy').slice(-8)}`;
  }

  function templateOptionValidation(dropdown, option) {
    const title = String(option?.title || '').trim();
    if (!title) return 'Title is required.';
    if (title.length > 100) return 'Title must be 100 characters or fewer.';
    const duplicate = dropdown.options.some((entry) => entry.id !== option.id && String(entry.title || '').trim().toLocaleLowerCase() === title.toLocaleLowerCase());
    if (duplicate) return 'Use a unique title in this dropdown.';
    if (String(option?.description || '').trim().length > 100) return 'Description must be 100 characters or fewer.';
    return '';
  }

  function templateDropdownValidation(dropdown) {
    if (!String(dropdown?.placeholder || '').trim()) return 'Placeholder is required.';
    if (String(dropdown.placeholder).trim().length > 150) return 'Placeholder must be 150 characters or fewer.';
    if (!dropdown.options.length) return 'Add at least one option.';
    return '';
  }

  function templateControlsValidationErrors() {
    const draft = state.templateDraft;
    if (!draft || draft.controls.type !== 'dropdown') return [];
    if (!draft.controls.dropdowns.length) return ['Add at least one dropdown.'];
    return draft.controls.dropdowns.flatMap((dropdown) => [
      templateDropdownValidation(dropdown),
      ...dropdown.options.map((option) => templateOptionValidation(dropdown, option)),
    ]).filter(Boolean);
  }

  function refreshTemplateControlValidation() {
    state.templateControlsValid = templateControlsValidationErrors().length === 0;
    for (const card of elements.templateControls.querySelectorAll('[data-template-dropdown-card]')) {
      const resolved = templateDropdownAt(card.dataset.templateDropdownCard);
      if (!resolved) continue;
      const cardError = templateDropdownValidation(resolved.dropdown);
      card.classList.toggle('incomplete', Boolean(cardError) || resolved.dropdown.options.some((option) => templateOptionValidation(resolved.dropdown, option)));
      const message = card.querySelector('.template-dropdown-error');
      if (message) { message.textContent = cardError; message.hidden = !cardError; }
      const placeholder = card.querySelector('[data-template-dropdown-placeholder]');
      placeholder?.setAttribute('aria-invalid', String(!String(resolved.dropdown.placeholder || '').trim()));
    }
    for (const row of elements.templateControls.querySelectorAll('[data-template-control-row^="option:"]')) {
      const target = templateControlAt(row.dataset.templateControlRow);
      if (!target?.dropdown) continue;
      const validation = templateOptionValidation(target.dropdown, target.entry);
      row.classList.toggle('incomplete', Boolean(validation) || !templateActionStatus(target.entry.action).complete);
      const message = row.querySelector('.template-option-validation');
      if (message) { message.textContent = validation; message.hidden = !validation; }
      const title = row.querySelector('[data-template-option-title]');
      title?.setAttribute('aria-invalid', String(Boolean(validation)));
    }
  }

  function renderTemplateControlPreview() {
    const draft = state.templateDraft;
    if (!draft) return;
    if (draft.controls.type === 'dropdown') {
      elements.templateControlPreview.innerHTML = draft.controls.dropdowns.map((dropdown) => {
        const count = dropdown.options.length;
        return `<div class="rr-preview-select">${escapeHtml(dropdown.placeholder)} · ${count} option${count === 1 ? '' : 's'}${dropdown.allowMultiple ? ' · Multiple' : ''}</div>`;
      }).join('');
      return;
    }
    elements.templateControlPreview.innerHTML = draft.controls.type === 'button'
      ? draft.controls.buttons.map((button) => `<button type="button" class="rr-preview-button ${button.style.toLowerCase()}" disabled>${reactionRoleEmojiHtml(button.emoji)} ${escapeHtml(button.label)}</button>`).join('')
      : '';
  }

  function renderTemplateControls() {
    const draft = state.templateDraft;
    if (!draft) return;
    document.querySelectorAll('[data-template-control-mode]').forEach((button) => {
      const active = button.dataset.templateControlMode === draft.controls.type;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    elements.templateAddControl.hidden = draft.controls.type === 'none';
    elements.templateAddControl.textContent = draft.controls.type === 'dropdown' ? '+ Add dropdown' : '+ Add button';
    elements.templateAddControl.disabled = templateControlEntries().length >= (draft.controls.type === 'dropdown' ? 5 : 25);
    if (draft.controls.type === 'none') {
      elements.templateControls.innerHTML = '<p class="template-control-empty">This template has no interactive controls.</p>';
      state.templateControlsValid = true;
      return;
    }
    if (draft.controls.type === 'button') {
      const rows = draft.controls.buttons.map((button, index) => {
        const status = templateActionStatus(button.action);
        const spec = `button:${button.id}`;
        return `<article class="template-control-row${status.complete ? '' : ' incomplete'}" data-template-control-row="${spec}"><button class="rr-emoji-field" type="button" data-template-control-emoji="${spec}" aria-label="Choose emoji for ${escapeHtml(button.label)}">${reactionRoleEmojiHtml(button.emoji)}</button><label class="template-control-primary">Label<input type="text" maxlength="80" value="${escapeHtml(button.label)}" data-template-button-label="${escapeHtml(button.id)}"></label><label class="template-control-secondary">Style<select data-template-button-style="${escapeHtml(button.id)}">${['Primary','Secondary','Success','Danger'].map((style) => `<option${style === button.style ? ' selected' : ''}>${style}</option>`).join('')}</select></label><label class="template-control-action">Action<select data-template-control-action="${spec}">${templateActionOptions(button.action.type)}</select></label><button class="template-action-configure" type="button" data-template-configure-action="${spec}" aria-label="Configure action for ${escapeHtml(button.label)}" title="Configure action">&#x2699;</button><span class="template-action-summary" role="status">${escapeHtml(status.summary)}</span><div class="rr-row-actions"><button type="button" data-template-control-move="${spec}:-1" aria-label="Move ${escapeHtml(button.label)} up" title="Move up"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-template-control-move="${spec}:1" aria-label="Move ${escapeHtml(button.label)} down" title="Move down"${index === draft.controls.buttons.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-template-control-remove="${spec}" aria-label="Delete ${escapeHtml(button.label)}" title="Delete button">&#128465;</button></div></article>`;
      }).join('');
      elements.templateControls.innerHTML = `<div class="template-control-list">${rows || '<p class="template-control-empty">Add a button to configure its action.</p>'}</div>`;
      state.templateControlsValid = true;
      return;
    }
    elements.templateControls.innerHTML = draft.controls.dropdowns.length ? draft.controls.dropdowns.map((dropdown, dropdownIndex) => {
      const rows = dropdown.options.map((option, optionIndex) => {
        const status = templateActionStatus(option.action);
        const spec = `option:${dropdown.id}:${option.id}`;
        const validation = templateOptionValidation(dropdown, option);
        const validationId = `template-option-error-${option.id}`;
        return `<article class="template-control-row dropdown${status.complete && !validation ? '' : ' incomplete'}" data-template-control-row="${spec}"><button class="rr-emoji-field" type="button" data-template-control-emoji="${spec}" aria-label="Choose emoji for ${escapeHtml(option.title || 'option')}">${reactionRoleEmojiHtml(option.emoji)}</button><label class="template-control-primary">Title<input type="text" maxlength="100" value="${escapeHtml(option.title)}" data-template-option-title="${escapeHtml(dropdown.id)}:${escapeHtml(option.id)}" aria-describedby="${validationId}" aria-invalid="${Boolean(validation)}"></label><label class="template-control-secondary">Description<input type="text" maxlength="100" value="${escapeHtml(option.description)}" data-template-option-description="${escapeHtml(dropdown.id)}:${escapeHtml(option.id)}"></label><label class="template-control-action">Action<select data-template-control-action="${spec}">${templateActionOptions(option.action.type)}</select></label><button class="template-action-configure" type="button" data-template-configure-action="${spec}" aria-label="Configure action for ${escapeHtml(option.title || 'option')}" title="Configure action">&#x2699;</button><span class="template-action-summary" role="status">${escapeHtml(status.summary)}</span><span class="template-option-validation" id="${validationId}"${validation ? '' : ' hidden'}>${escapeHtml(validation)}</span><div class="rr-row-actions template-option-actions"><button type="button" data-template-control-move="${spec}:-1" aria-label="Move ${escapeHtml(option.title || 'option')} up" title="Move up"${optionIndex === 0 ? ' disabled' : ''}>↑</button><button type="button" data-template-control-move="${spec}:1" aria-label="Move ${escapeHtml(option.title || 'option')} down" title="Move down"${optionIndex === dropdown.options.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-template-control-duplicate="${spec}" aria-label="Duplicate ${escapeHtml(option.title || 'option')}" title="Duplicate option">&#x2398;</button><button type="button" data-template-control-remove="${spec}" aria-label="Delete ${escapeHtml(option.title || 'option')}" title="Delete option">&#128465;</button></div></article>`;
      }).join('');
      const optionCount = `${dropdown.options.length} option${dropdown.options.length === 1 ? '' : 's'}`;
      const dropdownError = templateDropdownValidation(dropdown);
      return `<section class="template-dropdown-card${dropdownError || dropdown.options.some((option) => templateOptionValidation(dropdown, option)) ? ' incomplete' : ''}" data-template-dropdown-card="${escapeHtml(dropdown.id)}"><header><div class="template-dropdown-title"><strong>Dropdown ${dropdownIndex + 1}</strong><span class="template-dropdown-count">${optionCount}</span></div><div class="template-dropdown-actions"><button type="button" class="template-dropdown-add-option" data-template-dropdown-add-option="${escapeHtml(dropdown.id)}"${dropdown.options.length >= 25 ? ' disabled' : ''}>+ Add option</button><div class="rr-row-actions"><button type="button" data-template-dropdown-move="${escapeHtml(dropdown.id)}:-1" aria-label="Move dropdown ${dropdownIndex + 1} up" title="Move dropdown up"${dropdownIndex === 0 ? ' disabled' : ''}>↑</button><button type="button" data-template-dropdown-move="${escapeHtml(dropdown.id)}:1" aria-label="Move dropdown ${dropdownIndex + 1} down" title="Move dropdown down"${dropdownIndex === draft.controls.dropdowns.length - 1 ? ' disabled' : ''}>↓</button><button type="button" data-template-dropdown-remove="${escapeHtml(dropdown.id)}" aria-label="Delete dropdown ${dropdownIndex + 1}" title="Delete dropdown">&#128465;</button></div></div></header><div class="template-dropdown-settings"><label>Placeholder<input type="text" maxlength="150" value="${escapeHtml(dropdown.placeholder)}" data-template-dropdown-placeholder="${escapeHtml(dropdown.id)}" aria-invalid="${!String(dropdown.placeholder || '').trim()}"></label><label class="rr-allow-multiple"><input type="checkbox" data-template-dropdown-multiple="${escapeHtml(dropdown.id)}"${dropdown.allowMultiple ? ' checked' : ''}><span><strong>Allow multiple selections</strong><small>Only selected options in this dropdown run their configured actions.</small></span></label></div><p class="template-dropdown-error"${dropdownError ? '' : ' hidden'}>${escapeHtml(dropdownError)}</p><div class="template-control-list">${rows || '<p class="template-control-empty">Add an option to configure this dropdown.</p>'}</div></section>`;
    }).join('') : '<p class="template-control-empty">Add a dropdown to configure its options and actions.</p>';
    refreshTemplateControlValidation();
  }

  function syncTemplateJson(force = false) {
    if (!state.templateDraft || (!force && document.activeElement === elements.templateJsonEditor)) return;
    elements.templateJsonEditor.value = JSON.stringify(templateDocument(), null, 2);
    state.templateJsonValid = true;
    elements.templateJsonError.hidden = true;
  }

  function resolvedTemplatePayloadPreview() {
    if (!state.templateDraft) return {};
    const values = genericTemplatePreviewValues();
    const buildContainer = (content, layout, forceContainer = false) => {
      const inner = interpolateTemplate(content, values).split(/\{separator\}/gi).slice(0, 5).flatMap((part, index) => {
        const result = [];
        if (index) result.push({ type: 14, divider: true, spacing: 1 });
        if (part.trim()) result.push({ type: 10, content: part.trim() });
        return result;
      });
      if (!inner.length) inner.push({ type: 10, content: '-# Message template' });
      const thumbnailUrl = layout.thumbnailEnabled ? templatePreviewMediaUrl(layout.thumbnailUrl) : '';
      if (thumbnailUrl) {
        const firstTextIndex = inner.findIndex((component) => component.type === 10);
        if (firstTextIndex >= 0) {
          const firstText = inner[firstTextIndex];
          inner.splice(firstTextIndex, 1, { type: 9, components: [firstText], accessory: { type: 11, media: { url: thumbnailUrl } } });
        }
      }
      const gallery = layout.galleryUrls.map(templatePreviewMediaUrl).filter(Boolean);
      if (gallery.length) inner.push({ type: 12, items: gallery.map((url) => ({ media: { url } })) });
      return layout.container || forceContainer
        ? [{ type: 17, accent_color: Number.parseInt(layout.accentColor.slice(1), 16), components: inner }]
        : inner;
    };
    const components = buildContainer(state.templateDraft.content, state.templateDraft.layout);
    for (const container of state.templateDraft.additionalContainers) components.push(...buildContainer(container.content, container.layout, true));
    const previewId = (kind, id = '') => `mt:${String(state.guildId || 'guild').slice(-20)}:${kind}:${String(state.templateDraft.id || 'template').slice(-20)}${id ? `:${String(id).slice(-20)}` : ''}`.slice(0, 100);
    const payloadEmoji = (value) => {
      const emoji = normalizePickerEmoji(value);
      if (!emoji.name) return undefined;
      return emoji.id ? { id: emoji.id, name: emoji.name, animated: emoji.animated } : { name: emoji.name };
    };
    if (state.templateDraft.controls.type === 'button') {
      const buttons = state.templateDraft.controls.buttons.map((button) => {
        const component = { type: 2, style: { Primary: 1, Secondary: 2, Success: 3, Danger: 4 }[button.style], custom_id: previewId('b', button.id), label: button.label };
        const emoji = payloadEmoji(button.emoji); if (emoji) component.emoji = emoji;
        return component;
      });
      for (let index = 0; index < buttons.length; index += 5) components.push({ type: 1, components: buttons.slice(index, index + 5) });
    }
    if (state.templateDraft.controls.type === 'dropdown') {
      for (const dropdown of state.templateDraft.controls.dropdowns) {
        if (!dropdown.options.length) continue;
        components.push({ type: 1, components: [{
          type: 3, custom_id: previewId('d', dropdown.id), placeholder: dropdown.placeholder,
          min_values: 1, max_values: dropdown.allowMultiple ? dropdown.options.length : 1,
          options: dropdown.options.map((option) => {
            const item = { label: option.title, value: `option:${String(option.id).slice(-32)}`.slice(0, 100) };
            if (option.description) item.description = option.description;
            const emoji = payloadEmoji(option.emoji); if (emoji) item.emoji = emoji;
            return item;
          }),
        }] });
      }
    }
    return { flags: 32768, allowedMentions: { parse: [], users: [], roles: [] }, components };
  }

  function renderTemplateVariableReference() {
    const generic = new Set(GENERIC_TEMPLATE_VARIABLES.map(([token]) => token.slice(1, -1)));
    const used = templateVariableNames();
    const chips = GENERIC_TEMPLATE_VARIABLES.map(([token, meaning]) => `<span class="template-variable-chip"><code>${escapeHtml(token)}</code><small>Generic · ${escapeHtml(meaning)}</small></span>`);
    for (const name of used.filter((name) => name !== 'separator' && !generic.has(name))) chips.push(`<span class="template-variable-chip context"><code>{${escapeHtml(name)}}</code><small>Context-specific</small></span>`);
    elements.templateVariableReference.innerHTML = chips.join('');
    const unresolved = used.filter((name) => name !== 'separator' && !generic.has(name));
    elements.templateSendHint.textContent = unresolved.length
      ? `Direct sending is blocked until these context variables are removed: ${unresolved.map((name) => `{${name}}`).join(', ')}`
      : 'Test and live sends use the same visible content. Role/user pings stay disabled.';
    return unresolved;
  }

  function refreshTemplateDirty() {
    const dirty = templateIsDirty();
    state.templateControlsValid = templateControlsValidationErrors().length === 0;
    elements.templateStatusBadge.textContent = state.templateSaving ? 'SAVING' : state.templateSaveError ? 'SAVE ERROR' : dirty ? 'UNSAVED' : 'SAVED';
    elements.templateStatusBadge.classList.toggle('unsaved', dirty && !state.templateSaveError);
    elements.templateStatusBadge.classList.toggle('saving', state.templateSaving);
    elements.templateStatusBadge.classList.toggle('error', Boolean(state.templateSaveError));
    const unresolved = templateVariableNames().filter((name) => !['server', 'server_icon', 'channel', 'timestamp', 'separator'].includes(name));
    elements.templateSendTest.disabled = dirty || !state.templateControlsValid || Boolean(unresolved.length);
    elements.templateSendNow.disabled = dirty || !state.templateControlsValid || !state.templateDraft?.enabled || Boolean(unresolved.length);
    refreshDirty();
  }

  function renderTemplateComposerPanel() {
    const panel = state.templateComposerPanel;
    const draft = state.templateDraft;
    if (!draft) return;
    const layout = draft.layout;
    elements.templateComposerPanel.hidden = !panel;
    elements.templateComposerPanel.dataset.panel = panel;
    elements.templateVariablesToggle.classList.toggle('active', panel === 'variables');
    elements.templateThumbnailAdd.classList.toggle('active', panel === 'thumbnail' || layout.thumbnailEnabled);
    elements.templateGalleryAdd.classList.toggle('active', panel === 'gallery' || layout.galleryUrls.some(validTemplateMedia));
    if (!panel) return;
    if (panel === 'variables') {
      elements.templateComposerPanel.innerHTML = `<div class="variable-guide">${GENERIC_TEMPLATE_VARIABLES.map(([token, meaning]) => `<button type="button" data-insert-template-variable="${escapeHtml(token)}"><code>${escapeHtml(token)}</code><span>${escapeHtml(meaning)}</span></button>`).join('')}</div>`;
      return;
    }
    if (panel === 'thumbnail') {
      elements.templateComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Thumbnail</strong><small>Use {server_icon}, a supported context media variable, an image URL, or an upload up to 10 MB.</small></div>${layout.thumbnailEnabled ? '<button type="button" data-remove-template-thumbnail>Remove</button>' : ''}</div><div class="media-entry"><input type="text" maxlength="2000" value="${escapeHtml(layout.thumbnailUrl)}" placeholder="{server_icon} or https://example.com/image.png" data-template-thumbnail-url><label class="media-upload">Upload image<input type="file" accept="image/*" data-template-media-upload="thumbnail"></label></div>`;
      return;
    }
    const rows = layout.galleryUrls.map((url, index) => `<div class="media-entry"><span>${index + 1}</span><input type="text" maxlength="2000" value="${escapeHtml(url)}" placeholder="https://example.com/image.png" data-template-gallery-url="${index}"><label class="media-upload">Upload<input type="file" accept="image/*" data-template-media-upload="gallery" data-media-index="${index}"></label><button type="button" data-remove-template-gallery="${index}" aria-label="Remove gallery image ${index + 1}">&times;</button></div>`).join('');
    elements.templateComposerPanel.innerHTML = `<div class="media-panel-head"><div><strong>Image gallery</strong><small>Add up to 10 image URLs or uploads.</small></div><div><button type="button" data-add-template-gallery>+ URL</button><label class="media-upload">+ Upload<input type="file" accept="image/*" data-template-media-upload="gallery"></label></div></div><div class="media-list">${rows || '<p>No gallery images yet.</p>'}</div>`;
  }

  function renderTemplateComposerPreview(renderTools = true, updateJson = true) {
    const draft = state.templateDraft;
    if (!draft) return;
    const contentHtml = inlineTemplateEditor(draft.content, 'content', 'messageTemplate', 'message template', genericTemplatePreviewValues(), 4000);
    renderDiscordComposerPreview({
      frame: elements.templateDiscordFrame, preview: elements.templateMessagePreview,
      accentButton: elements.templateAccentButton, accentInput: elements.templateAccentColor,
      containerButton: elements.templateContainerAdd, layout: draft.layout, contentHtml, resolveMedia: templatePreviewMediaUrl,
    });
    renderAdditionalContainerEditors({
      root: elements.templateAdditionalContainers,
      containers: draft.additionalContainers,
      prefix: 'template', scope: 'messageTemplate', previewValues: genericTemplatePreviewValues(),
      resolveMedia: templatePreviewMediaUrl, maxLength: 4000,
    });
    elements.templateAdditionalContainerAdd.disabled = draft.additionalContainers.length >= MAX_ADDITIONAL_MESSAGE_CONTAINERS;
    elements.templateCharacterCount.textContent = `${draft.content.length} / 4000`;
    if (renderTools) renderTemplateComposerPanel();
    renderTemplateControlPreview();
    if (updateJson) syncTemplateJson();
    elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    renderTemplateVariableReference();
    refreshTemplateDirty();
  }

  function templateFolderOptions(selected) {
    return [`<option value="">Unfiled</option>`, ...state.messageTemplates.folders.map((folder) => `<option value="${escapeHtml(folder.id)}"${folder.id === selected ? ' selected' : ''}>${escapeHtml(folder.name)}</option>`)].join('');
  }

  function renderTemplateEditor() {
    const draft = state.templateDraft;
    elements.templateEmptyState.hidden = Boolean(draft);
    elements.templateEditor.hidden = !draft;
    if (!draft) return;
    elements.templateEditorTitle.textContent = draft.name;
    elements.templateTimestamps.textContent = `Created ${formatTemplateDate(draft.createdAt)} · Updated ${formatTemplateDate(draft.updatedAt)}`;
    elements.templateName.value = draft.name;
    elements.templateDescription.value = draft.description;
    elements.templateFolderSelect.innerHTML = templateFolderOptions(draft.folderId);
    elements.templateChannel.innerHTML = channelOptions(draft.defaultChannelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'No default channel');
    elements.templateSendChannel.innerHTML = channelOptions(draft.defaultChannelId, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose a message channel');
    elements.templateEnabled.checked = draft.enabled;
    document.querySelectorAll('[data-template-tab]').forEach((button) => {
      const active = button.dataset.templateTab === state.templateTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('[data-template-panel]').forEach((panel) => {
      const active = panel.dataset.templatePanel === state.templateTab;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    renderTemplateComposerPreview();
    renderTemplateControls();
    syncTemplateJson(true);
    updateTemplateDeepLink();
  }

  function renderTemplateWorkspace() {
    renderTemplateFolders();
    renderTemplateList();
    renderTemplateEditor();
  }

  async function selectMessageTemplate(id, options = {}) {
    const item = state.messageTemplates.items.find((entry) => entry.id === id);
    if (!item) return false;
    if (!options.force && id !== state.templateSelectedId && templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Your current template edits have not been saved.', confirmLabel: 'Discard' });
      if (!confirmed) return false;
    }
    state.templateSelectedId = item.id;
    state.templateDraft = clone(item);
    state.templateSavedSnapshot = templateSnapshot();
    state.templateComposerPanel = '';
    state.templateJsonValid = true;
    state.templateSaveError = '';
    if (options.reveal) state.templateFolderId = item.folderId || 'unfiled';
    renderTemplateWorkspace();
    return true;
  }

  function replaceTemplateCollection(payload, selectedId = state.templateSelectedId, options = {}) {
    const preservedDraft = options.preserveDraft && state.templateDraft?.id === selectedId ? clone(state.templateDraft) : null;
    state.messageTemplates = normalizeMessageTemplatesClient(payload.messageTemplates || payload);
    const selected = state.messageTemplates.items.find((item) => item.id === selectedId);
    if (selected) {
      state.templateSelectedId = selected.id;
      state.templateDraft = clone(selected);
      state.templateSavedSnapshot = templateSnapshot();
      if (preservedDraft) {
        if (preservedDraft.folderId && !state.messageTemplates.folders.some((folder) => folder.id === preservedDraft.folderId)) preservedDraft.folderId = null;
        state.templateDraft = preservedDraft;
      }
    } else {
      state.templateSelectedId = '';
      state.templateDraft = null;
      state.templateSavedSnapshot = '';
    }
    renderTemplateWorkspace();
  }

  async function createMessageTemplate() {
    if (templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Creating a new template will close the current draft.', confirmLabel: 'Discard and create' });
      if (!confirmed) return;
    }
    const base = 'Untitled template';
    let name = base;
    let number = 2;
    while (state.messageTemplates.items.some((item) => item.name.toLowerCase() === name.toLowerCase())) name = `${base} ${number++}`;
    const folderId = !['all', 'unfiled'].includes(state.templateFolderId) ? state.templateFolderId : null;
    const payload = await api(`/api/guilds/${state.guildId}/message-templates`, {
      method: 'POST', body: JSON.stringify({ name, folderId, content: '', layout: clone(TEMPLATE_LAYOUT_DEFAULTS) }),
    });
    replaceTemplateCollection(payload, payload.item.id);
    state.templateFolderId = payload.item.folderId || 'unfiled';
    renderTemplateWorkspace();
    elements.templateName.focus();
    elements.templateName.select();
    showToast('Blank template created.');
  }

  async function saveMessageTemplate() {
    if (!state.templateDraft || state.templateSaving || !templateIsDirty() || !state.templateJsonValid || !state.templateControlsValid) return;
    state.templateSaving = true;
    state.templateSaveError = '';
    refreshTemplateDirty();
    try {
      const payload = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}`, {
        method: 'PATCH', body: JSON.stringify({
          name: state.templateDraft.name, description: state.templateDraft.description,
          folderId: state.templateDraft.folderId, defaultChannelId: state.templateDraft.defaultChannelId,
          enabled: state.templateDraft.enabled, document: templateDocument(),
        }),
      });
      replaceTemplateCollection(payload, payload.item.id);
      state.templateFolderId = payload.item.folderId || 'unfiled';
      renderTemplateWorkspace();
      showToast('Message template saved.');
    } catch (error) {
      state.templateSaveError = error.message || 'Message template could not be saved.';
      throw error;
    } finally {
      state.templateSaving = false;
      refreshTemplateDirty();
    }
  }

  function resetTemplateDraft() {
    const stored = currentStoredTemplate();
    if (!stored || state.templateSaving) return;
    state.templateDraft = clone(stored);
    state.templateSavedSnapshot = templateSnapshot();
    state.templateJsonValid = true;
    state.templateSaveError = '';
    renderTemplateEditor();
    showToast('Unsaved template changes reset.');
  }

  async function duplicateMessageTemplate() {
    if (!state.templateDraft) return;
    if (templateIsDirty()) {
      const confirmed = await confirmAction({ title: 'Discard unsaved template changes?', copy: 'Duplicate uses the last saved version of this template.', confirmLabel: 'Discard and duplicate' });
      if (!confirmed) return;
    }
    const payload = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}/duplicate`, { method: 'POST', body: '{}' });
    replaceTemplateCollection(payload, payload.item.id);
    state.templateFolderId = payload.item.folderId || 'unfiled';
    renderTemplateWorkspace();
    showToast('Template duplicated.');
  }

  async function deleteMessageTemplate() {
    if (!state.templateDraft) return;
    const confirmed = await confirmAction({ title: 'Delete this template?', copy: `“${state.templateDraft.name}” will be permanently removed.`, confirmLabel: 'Delete' });
    if (!confirmed) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}`, { method: 'DELETE', body: '{}' });
    replaceTemplateCollection(payload, '');
    showToast('Template deleted.');
  }

  async function createTemplateFolder() {
    const name = await confirmAction({ title: 'Create a folder', copy: 'Folders keep related message templates together.', input: true, inputLabel: 'Folder name', confirmLabel: 'Create folder' });
    if (!name) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-template-folders`, { method: 'POST', body: JSON.stringify({ name }) });
    replaceTemplateCollection(payload, state.templateSelectedId, { preserveDraft: true });
    state.templateFolderId = payload.folder.id;
    renderTemplateWorkspace();
    showToast('Template folder created.');
  }

  async function renameTemplateFolder(folderId) {
    const folder = state.messageTemplates.folders.find((entry) => entry.id === folderId);
    if (!folder) return;
    const name = await confirmAction({ title: 'Rename folder', copy: 'Choose a short, recognizable folder name.', input: true, inputLabel: 'Folder name', inputValue: folder.name, confirmLabel: 'Rename' });
    if (!name) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-template-folders/${folderId}`, { method: 'PATCH', body: JSON.stringify({ name }) });
    replaceTemplateCollection(payload, state.templateSelectedId, { preserveDraft: true });
    showToast('Folder renamed.');
  }

  async function deleteTemplateFolder(folderId) {
    const folder = state.messageTemplates.folders.find((entry) => entry.id === folderId);
    if (!folder) return;
    const count = state.messageTemplates.items.filter((item) => item.folderId === folderId).length;
    const confirmed = await confirmAction({ title: 'Delete this folder?', copy: `${count} template${count === 1 ? '' : 's'} will move to Unfiled; no templates will be deleted.`, confirmLabel: 'Delete folder' });
    if (!confirmed) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-template-folders/${folderId}`, { method: 'DELETE', body: '{}' });
    state.templateFolderId = 'unfiled';
    replaceTemplateCollection(payload, state.templateSelectedId, { preserveDraft: true });
    showToast(`Folder deleted. ${payload.moved || 0} template${payload.moved === 1 ? '' : 's'} moved to Unfiled.`);
  }

  function insertTemplateVariable(token) {
    if (!state.templateDraft) return;
    let input = elements.messageTemplatesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]')
      || elements.templateMessagePreview.querySelector('[data-inline-message-input]');
    if (!input) return;
    if (!input.closest('[data-inline-message-editor]')?.classList.contains('editing')) beginInlineMessageEdit(input.closest('[data-inline-message-editor]')?.querySelector('[data-inline-message-display]'));
    input = elements.messageTemplatesView.querySelector('[data-inline-message-editor].editing [data-inline-message-input]') || input;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`.slice(0, 4000);
    const containerIndex = Number(input.dataset.additionalContainerIndex);
    if (Number.isInteger(containerIndex) && state.templateDraft.additionalContainers[containerIndex]) state.templateDraft.additionalContainers[containerIndex].content = input.value;
    else state.templateDraft.content = input.value;
    syncInlineEditorVisual(input);
    input.focus();
    input.setSelectionRange(Math.min(input.value.length, start + token.length), Math.min(input.value.length, start + token.length));
    if (!Number.isInteger(containerIndex)) elements.templateCharacterCount.textContent = `${input.value.length} / 4000`;
    syncTemplateJson();
    renderTemplateVariableReference();
    refreshTemplateDirty();
  }

  async function uploadTemplateMedia(input) {
    const file = input.files?.[0];
    if (!file || !state.templateDraft) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) {
      input.value = '';
      return showToast(file.size > 10 * 1024 * 1024 ? 'Images must be 10 MB or smaller.' : 'Upload an image file.', 'error');
    }
    const label = input.closest('.media-upload');
    label?.classList.add('uploading');
    try {
      const result = await api(`/api/guilds/${state.guildId}/message-media`, { method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }) });
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex) ? state.templateDraft.additionalContainers[containerIndex]?.layout : state.templateDraft.layout;
      if (!layout) throw new Error('That container no longer exists.');
      if (input.dataset.templateMediaUpload === 'thumbnail') {
        layout.thumbnailUrl = result.url; layout.thumbnailEnabled = true;
      } else {
        const index = Number(input.dataset.mediaIndex);
        if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url;
        else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url);
      }
      renderTemplateComposerPreview();
      showToast('Template image uploaded. Save the template when ready.');
    } catch (error) { showToast(error.message || 'Image upload failed.', 'error'); }
    finally { label?.classList.remove('uploading'); input.value = ''; }
  }

  async function sendCurrentTemplate(mode) {
    if (!state.templateDraft || templateIsDirty()) return showToast('Save template changes before sending.', 'error');
    const channelId = elements.templateSendChannel.value || state.templateDraft.defaultChannelId;
    if (!channelId) return showToast('Choose a destination channel.', 'error');
    if (mode === 'send') {
      const channel = state.directory.channels.find((entry) => entry.id === channelId);
      const confirmed = await confirmAction({ title: 'Send this message now?', copy: `“${state.templateDraft.name}” will be posted in #${channel?.name || channelId}. Mentions remain disabled.`, confirmLabel: 'Send now' });
      if (!confirmed) return;
    }
    try {
      const result = await api(`/api/guilds/${state.guildId}/message-templates/${state.templateDraft.id}/send`, {
        method: 'POST', body: JSON.stringify({ mode, channelId, confirm: mode === 'send' }),
      });
      showToast(`${mode === 'test' ? 'Test message' : 'Message'} sent to #${result.channelName}.`, '', result.messageUrl);
    } catch (error) { showToast(error.message || 'The message could not be sent.', 'error'); }
  }

  function updateTemplateJsonFromInput(showSuccess = false) {
    if (!state.templateDraft) return false;
    try {
      const documentValue = parseTemplateJsonText(elements.templateJsonEditor.value);
      state.templateDraft.content = documentValue.content;
      state.templateDraft.layout = documentValue.layout;
      state.templateDraft.additionalContainers = documentValue.additionalContainers;
      state.templateDraft.controls = documentValue.controls;
      state.templateJsonValid = true;
      elements.templateJsonError.hidden = true;
      renderTemplateComposerPreview(true, false);
      renderTemplateControls();
      if (showSuccess) showToast('JSON imported into the visual editor. Save to persist it.');
      return true;
    } catch (error) {
      state.templateJsonValid = false;
      elements.templateJsonError.textContent = error.message;
      elements.templateJsonError.hidden = false;
      refreshTemplateDirty();
      return false;
    }
  }

  function updateTemplateDraftFromControl(target) {
    const draft = state.templateDraft;
    if (!draft) return;
    if (target.matches('[data-inline-message-input]') && target.dataset.inlineTemplateScope === 'messageTemplate') {
      const containerIndex = Number(target.dataset.additionalContainerIndex);
      if (Number.isInteger(containerIndex) && draft.additionalContainers[containerIndex]) draft.additionalContainers[containerIndex].content = target.value.slice(0, 4000);
      else draft.content = target.value.slice(0, 4000);
      syncInlineEditorVisual(target);
      if (!Number.isInteger(containerIndex)) elements.templateCharacterCount.textContent = `${draft.content.length} / 4000`;
      syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
      renderTemplateVariableReference();
      refreshTemplateDirty();
      return;
    }
    if (target === elements.templateName) {
      draft.name = target.value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80);
      elements.templateEditorTitle.textContent = draft.name.trim() || 'Untitled template';
    }
    if (target === elements.templateDescription) draft.description = target.value.slice(0, 500);
    if (target === elements.templateFolderSelect) draft.folderId = target.value || null;
    if (target === elements.templateChannel) {
      draft.defaultChannelId = target.value;
      elements.templateSendChannel.value = target.value;
    }
    if (target === elements.templateEnabled) draft.enabled = target.checked;
    if (target === elements.templateAccentColor) {
      draft.layout.accentColor = target.value;
      renderTemplateComposerPreview();
      return;
    }
    if (target.matches('[data-template-additional-accent]')) {
      const container = draft.additionalContainers[Number(target.dataset.templateAdditionalAccent)];
      if (container) container.layout.accentColor = target.value;
      renderTemplateComposerPreview();
      return;
    }
    if (target.matches('[data-template-thumbnail-url]')) {
      draft.layout.thumbnailUrl = target.value.slice(0, 2000);
      draft.layout.thumbnailEnabled = Boolean(target.value.trim());
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-gallery-url]')) {
      draft.layout.galleryUrls[Number(target.dataset.templateGalleryUrl)] = target.value.slice(0, 2000);
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-additional-thumbnail-url]')) {
      const container = draft.additionalContainers[Number(target.dataset.templateAdditionalThumbnailUrl)];
      if (container) {
        container.layout.thumbnailUrl = target.value.slice(0, 2000);
        container.layout.thumbnailEnabled = validTemplateMedia(target.value);
      }
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.templateAdditionalGalleryUrl.split(':').map(Number);
      const container = draft.additionalContainers[containerIndex];
      if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000);
      renderTemplateComposerPreview(false);
      return;
    }
    if (target.matches('[data-template-button-label]')) {
      const button = draft.controls.buttons.find((entry) => entry.id === target.dataset.templateButtonLabel);
      if (button) button.label = target.value.slice(0, 80);
    }
    if (target.matches('[data-template-button-style]')) {
      const button = draft.controls.buttons.find((entry) => entry.id === target.dataset.templateButtonStyle);
      if (button) button.style = target.value;
    }
    if (target.matches('[data-template-option-title]')) {
      const option = templateControlAt(`option:${target.dataset.templateOptionTitle}`)?.entry;
      if (option) option.title = target.value.slice(0, 100);
    }
    if (target.matches('[data-template-option-description]')) {
      const option = templateControlAt(`option:${target.dataset.templateOptionDescription}`)?.entry;
      if (option) option.description = target.value.slice(0, 100);
    }
    if (target.matches('[data-template-dropdown-placeholder]')) {
      const dropdown = templateDropdownAt(target.dataset.templateDropdownPlaceholder)?.dropdown;
      if (dropdown) dropdown.placeholder = target.value.slice(0, 150);
    }
    if (target.matches('[data-template-dropdown-multiple]')) {
      const dropdown = templateDropdownAt(target.dataset.templateDropdownMultiple)?.dropdown;
      if (dropdown) dropdown.allowMultiple = target.checked;
    }
    if (target.matches('[data-template-control-action]')) {
      const control = templateControlAt(target.dataset.templateControlAction);
      const type = TEMPLATE_ACTION_TYPES.includes(target.value) ? target.value : 'send_message';
      if (control) control.entry.action = ['give_role', 'remove_role'].includes(type) ? { type, roleId: '' } : { type, templateId: '' };
    }
    if (target.closest?.('[data-template-control-row]') || target.matches('[data-template-dropdown-placeholder],[data-template-dropdown-multiple]')) {
      if (target.matches('[data-template-control-action]')) renderTemplateControls();
      else refreshTemplateControlValidation();
      renderTemplateControlPreview(); syncTemplateJson();
      elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    }
    state.templateSaveError = '';
    updateTemplateDeepLink();
    refreshTemplateDirty();
  }

  function templateControlAt(spec) {
    const [kind, firstId, secondId] = String(spec || '').split(':');
    if (kind === 'button') {
      const entries = state.templateDraft?.controls?.buttons || [];
      const index = entries.findIndex((entry) => entry.id === firstId);
      return index >= 0 ? { kind, dropdownIndex: null, index, entry: entries[index], entries, spec: `button:${firstId}` } : null;
    }
    if (kind !== 'option') return null;
    const resolved = templateDropdownAt(firstId);
    if (!resolved) return null;
    const entries = resolved.dropdown.options;
    const index = entries.findIndex((entry) => entry.id === secondId);
    return index >= 0 ? {
      kind, dropdown: resolved.dropdown, dropdownIndex: resolved.dropdownIndex, index,
      entry: entries[index], entries, spec: `option:${firstId}:${secondId}`,
    } : null;
  }

  function safeTemplateRoles() {
    return (state.directory.roles || []).filter((role) => role.managed !== true && role.administrator !== true && role.editable !== false && role.belowBot !== false);
  }

  function openTemplateActionDialog(spec) {
    const target = templateControlAt(spec);
    if (!target) return;
    state.templateActionTarget = { spec: target.spec };
    const action = target.entry.action;
    const templateAction = ['send_message', 'dm_message'].includes(action.type);
    elements.templateActionTitle.textContent = `Configure ${TEMPLATE_ACTION_LABELS[action.type]}`;
    elements.templateActionCopy.textContent = templateAction
      ? 'Choose a Message Template from this server. It is resolved again when the member interacts.'
      : 'Choose a safe Discord role below CoinSprite. Role safety is rechecked at interaction time.';
    elements.templateActionTargetLabel.textContent = templateAction ? 'Message Template' : 'Discord role';
    if (templateAction) {
      const selected = String(action.templateId || '');
      const items = [...state.messageTemplates.items].sort((left, right) => left.name.localeCompare(right.name));
      const options = ['<option value="">Choose a Message Template</option>', ...items.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selected ? ' selected' : ''}>${escapeHtml(item.name)}${item.enabled ? '' : ' (disabled)'}</option>`)];
      if (selected && !items.some((item) => item.id === selected)) options.push(`<option value="${escapeHtml(selected)}" selected disabled>Missing template (${escapeHtml(selected)})</option>`);
      elements.templateActionTarget.innerHTML = options.join('');
      elements.templateActionHelp.textContent = action.type === 'dm_message' ? 'Closed DMs produce a friendly private error.' : 'The template is shown only to the member who used the button or dropdown.';
    } else {
      const selected = String(action.roleId || '');
      const roles = safeTemplateRoles();
      const options = ['<option value="">Choose a manageable role</option>', ...roles.map((role) => `<option value="${role.id}"${role.id === selected ? ' selected' : ''} style="color:${roleColor(role.id)}">● @${escapeHtml(role.name)}</option>`)];
      if (selected && !roles.some((role) => role.id === selected)) options.push(`<option value="${escapeHtml(selected)}" selected disabled>Missing or unmanageable role (${escapeHtml(selected)})</option>`);
      elements.templateActionTarget.innerHTML = options.join('');
      elements.templateActionHelp.textContent = 'Managed, Administrator, and above-bot roles are excluded.';
    }
    elements.templateActionDialog.showModal();
    elements.templateActionTarget.focus();
  }

  function saveTemplateActionDialog() {
    const target = templateControlAt(state.templateActionTarget?.spec);
    if (!target) return elements.templateActionDialog.close();
    const selected = elements.templateActionTarget.value;
    if (!selected) return showToast(`Choose a ${['send_message', 'dm_message'].includes(target.entry.action.type) ? 'Message Template' : 'Discord role'}.`, 'error');
    if (['send_message', 'dm_message'].includes(target.entry.action.type)) target.entry.action.templateId = selected;
    else target.entry.action.roleId = selected;
    state.templateActionTarget = null;
    state.templateSaveError = '';
    elements.templateActionDialog.close();
    renderTemplateControls(); renderTemplateControlPreview(); syncTemplateJson();
    elements.templateResolvedPayload.textContent = JSON.stringify(resolvedTemplatePayloadPreview(), null, 2);
    refreshTemplateDirty();
  }

  function renderTemplatePicker() {
    const search = elements.templatePickerSearch.value.trim().toLowerCase();
    const items = state.messageTemplates.items.filter((item) => !search || item.name.toLowerCase().includes(search));
    elements.templatePickerList.innerHTML = items.length ? items.map((item) => `<button type="button" data-pick-template="${escapeHtml(item.id)}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(templateFolderName(item.folderId))}${item.description ? ` · ${escapeHtml(item.description)}` : ''}</small></button>`).join('') : '<p class="template-list-empty">No matching templates.</p>';
  }

  function openTemplatePicker(context) {
    if (!state.messageTemplates.items.length) {
      setView('message-templates');
      showToast('Create a message template first.', 'error');
      return;
    }
    state.templatePickerContext = context;
    elements.templatePickerSearch.value = '';
    renderTemplatePicker();
    elements.templatePickerDialog.showModal();
    elements.templatePickerSearch.focus();
  }

  function contextVariableSet(context) {
    if (context === 'leveling') return new Set(LEVELING_VARIABLES.map(([token]) => token.slice(1, -1)));
    if (context === 'reactionRoles') return new Set(GENERIC_TEMPLATE_VARIABLES.map(([token]) => token.slice(1, -1)));
    return new Set([...MEMBER_MESSAGE_COMMON_VARIABLES, ...MEMBER_MESSAGE_EVENT_VARIABLES[state.memberMessageEvent]].map(([token]) => token.slice(1, -1)));
  }

  async function applyTemplateSnapshot(templateId) {
    const item = state.messageTemplates.items.find((entry) => entry.id === templateId);
    if (!item) return;
    const supported = contextVariableSet(state.templatePickerContext);
    const unavailable = templateVariableNames(item).filter((name) => name !== 'separator' && !supported.has(name));
    if (unavailable.length) {
      const confirmed = await confirmAction({ title: 'Some variables are unavailable', copy: `${unavailable.map((name) => `{${name}}`).join(', ')} will remain unresolved in this destination context. Apply the snapshot anyway?`, confirmLabel: 'Apply anyway' });
      if (!confirmed) return;
    }
    if (state.templatePickerContext === 'leveling') {
      state.config.leveling.announcements.template = item.content.slice(0, 3000);
      state.config.leveling.announcements.layout = clone(item.layout);
      state.config.leveling.announcements.additionalContainers = clone(item.additionalContainers).map((container) => ({
        ...container, content: container.content.slice(0, 3000),
      }));
      renderMessagePreview();
    } else if (state.templatePickerContext === 'reactionRoles') {
      if (!state.reactionRoleDraft) return;
      state.reactionRoleDraft.message = {
        content: item.content.slice(0, 4000), layout: clone(item.layout),
        additionalContainers: clone(item.additionalContainers), sourceTemplateId: item.id,
      };
      renderReactionRoleEditor();
    } else {
      const event = currentMemberMessage();
      event.template = item.content.slice(0, 3000);
      event.layout = clone(item.layout);
      event.additionalContainers = clone(item.additionalContainers).map((container) => ({
        ...container, content: container.content.slice(0, 3000),
      }));
      renderWelcomeMessagePreview();
    }
    elements.templatePickerDialog.close();
    refreshDirty();
    showToast(`Applied “${item.name}” as a snapshot.`);
  }

  async function saveComposerAsTemplate(context) {
    const defaults = context === 'leveling' ? state.config.leveling.announcements : currentMemberMessage();
    if (!defaults) return;
    const name = await confirmAction({ title: 'Save as a message template', copy: 'This creates an independent snapshot you can organize and edit later.', input: true, inputLabel: 'Template name', confirmLabel: 'Save template' });
    if (!name) return;
    const payload = await api(`/api/guilds/${state.guildId}/message-templates`, {
      method: 'POST', body: JSON.stringify({ name, content: defaults.template, layout: defaults.layout, additionalContainers: defaults.additionalContainers }),
    });
    state.messageTemplates = normalizeMessageTemplatesClient(payload.messageTemplates);
    renderTemplateFolders(); renderTemplateList();
    showToast(`Saved “${payload.item.name}” as a template.`);
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

  function renderGames() {
    if (!state.config?.counting) return;
    elements.countingChannel.innerHTML = channelOptions(
      state.config.counting.channelId,
      (channel) => channel.sendable === true && channel.kind !== 'forum',
      'Select a channel',
    );
    renderGameCommandSettings();
    refreshDirty();
  }

  function renderGameCommandSettings() {
    const settings = state.config?.games?.commandSettings || [];
    const commandOptions = [
      ['cs-work', 'Work (/cs-work and cswork)'],
      ['cs-balance', 'Bronze balance (/cs-balance and csbalance)'],
      ['cs-inventory', 'Inventory (/cs-inventory and csinventory)'],
    ];
    elements.gameCommandSettings.innerHTML = settings.length ? settings.map((setting, index) => `
      <article class="game-command-setting" data-game-setting="${index}">
        <label>Channels <small>Select one or more</small><select multiple data-game-setting-channels="${index}">${channelOptions(setting.channelIds, (channel) => channel.sendable === true && channel.kind !== 'forum', 'Choose channels')}</select></label>
        <label>Commands <small>Select one or more</small><select multiple data-game-setting-commands="${index}">${commandOptions.map(([value, label]) => `<option value="${value}" ${setting.commands.includes(value) ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
        <button type="button" data-remove-game-setting="${index}">Remove</button>
      </article>`).join('') : '<div class="empty-state"><strong>No command settings</strong><span>Game commands are available in every channel.</span></div>';
  }

  function renderFeatureAccess() {
    if (!state.config) return;
    const levelingUnlocked = state.config.features?.leveling === true;
    elements.levelingNav.disabled = !levelingUnlocked;
    elements.levelingNav.classList.toggle('is-locked', !levelingUnlocked);
    const levelingLabel = elements.levelingNav.querySelector('small');
    if (levelingLabel) levelingLabel.textContent = levelingUnlocked ? 'XP & rewards' : 'Locked by owner';
    elements.levelingNav.title = levelingUnlocked ? '' : 'The bot owner must unlock Leveling for this server.';
    if (!levelingUnlocked && state.currentView === 'leveling') {
      setView('member-messages');
    }
  }

  function snapshot(config = state.config) {
    if (!config) return '';
    return JSON.stringify({
      leveling: config.leveling,
      memberMessages: config.memberMessages,
      counting: config.counting,
      games: config.games,
    });
  }

  function refreshDirty() {
    const templateMode = state.currentView === 'message-templates';
    const reactionMode = state.currentView === 'reaction-roles';
    const dirty = templateMode ? templateIsDirty() : reactionMode ? reactionRoleIsDirty() : snapshot() !== state.savedSnapshot;
    const saving = templateMode ? state.templateSaving : reactionMode ? state.reactionRoleSaving : state.saving;
    elements.saveDock.hidden = !dirty && !saving;
    elements.saveState.textContent = saving
      ? templateMode ? 'Saving template…' : reactionMode ? 'Saving Reaction Role…' : 'Applying changes…'
      : templateMode ? 'Unsaved template changes' : reactionMode ? 'Unsaved Reaction Role changes' : 'Unsaved changes';
    elements.saveButton.textContent = templateMode || reactionMode ? 'Save changes' : 'Apply changes';
    elements.saveButton.disabled = !dirty || saving || (templateMode && (!state.templateJsonValid || !state.templateControlsValid));
    elements.resetButton.disabled = !dirty || saving;
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
      const [directoryPayload, configPayload, templatesPayload, reactionRolesPayload] = await Promise.all([
        api(`/api/guilds/${guildId}/directory`),
        api(`/api/guilds/${guildId}/config`),
        api(`/api/guilds/${guildId}/message-templates`),
        api(`/api/guilds/${guildId}/reaction-roles`),
      ]);
      if (state.guildId !== guildId) return;
      state.directory = { channels: [], roles: [], emojis: { bot: [], group: [], errors: {} }, ...directoryPayload.directory };
      directoryEmojiItemCache.clear();
      state.config = {
        ...configPayload.config,
        leveling: normalizeLevelingConfig(configPayload.config),
        memberMessages: normalizeMemberMessagesConfig(configPayload.config),
        counting: normalizeCountingConfig(configPayload.config),
        games: normalizeGamesConfig(configPayload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      state.messageTemplates = normalizeMessageTemplatesClient(templatesPayload.messageTemplates);
      state.templateFolderId = 'all';
      state.templateSelectedId = '';
      state.templateDraft = null;
      state.templateSavedSnapshot = '';
      state.reactionRoles = normalizeReactionRolesClient(reactionRolesPayload.reactionRoles);
      state.reactionRoleSelectedId = '';
      state.reactionRoleDraft = null;
      state.reactionRoleSavedSnapshot = '';
      renderFeatureAccess();
      renderLeveling();
      renderGames();
      renderWelcomeMessages();
      renderTemplateWorkspace();
      renderReactionRoles();
      const deepLink = new URLSearchParams(location.search);
      const requestedTemplate = deepLink.get('template');
      const requestedFolder = deepLink.get('folder');
      if (requestedFolder && state.messageTemplates.folders.some((folder) => folder.id === requestedFolder)) state.templateFolderId = requestedFolder;
      if (requestedTemplate) await selectMessageTemplate(requestedTemplate, { force: true, reveal: !requestedFolder });
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
      const memberMessages = clone(state.config.memberMessages);
      const counting = clone(state.config.counting);
      const games = clone(state.config.games);
      const body = { memberMessages, counting, games };
      if (state.config.features?.leveling === true) body.leveling = leveling;
      const payload = await api(`/api/guilds/${state.guildId}/config`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      state.config = {
        ...payload.config,
        leveling: normalizeLevelingConfig(payload.config),
        memberMessages: normalizeMemberMessagesConfig(payload.config),
        counting: normalizeCountingConfig(payload.config),
        games: normalizeGamesConfig(payload.config),
      };
      state.savedSnapshot = snapshot();
      state.savedConfig = clone(state.config);
      renderFeatureAccess();
      renderLeveling();
      renderGames();
      renderWelcomeMessages();
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
      const featureCount = Number(guild.features?.leveling === true);
      return `<tr>
      <td><div class="guild-cell">${guildIcon(guild)}<span><strong>${escapeHtml(guild.name)}</strong><small>${guild.id}</small></span></div></td>
      <td>${formatNumber(guild.totalUsers)}</td>
      <td><span class="status-pill ${guild.enabled ? '' : 'off'}">${guild.enabled ? 'Online' : 'Disabled'}</span></td>
      <td><details class="feature-dropdown"><summary>${featureCount} feature${featureCount === 1 ? '' : 's'}</summary><div>
        <label><input type="checkbox" data-owner-feature="leveling" data-guild-id="${guild.id}" ${guild.features?.leveling ? 'checked' : ''}><span><strong>Leveling</strong><small>${guild.features?.leveling ? 'Unlocked' : 'Locked'}</small></span></label>
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
    state.currentView = view;
    document.body.classList.remove('mobile-nav-open');
    elements.mobileNavToggle?.setAttribute('aria-expanded', 'false');
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
      if (view === 'message-templates') updateTemplateDeepLink();
    }
    refreshDirty();
  }

  function confirmAction({ title, copy, input = false, inputLabel = 'Reason', inputValue = '', confirmLabel = 'Confirm' }) {
    elements.dialogTitle.textContent = title;
    elements.dialogCopy.textContent = copy;
    elements.dialogInputWrap.hidden = !input;
    elements.dialogInputWrap.firstChild.nodeValue = inputLabel;
    elements.dialogInput.value = inputValue;
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
      } else {
        const containerIndex = Number(target.dataset.additionalContainerIndex);
        if (Number.isInteger(containerIndex) && leveling.announcements.additionalContainers[containerIndex]) {
          leveling.announcements.additionalContainers[containerIndex].content = target.value.slice(0, 3000);
        } else if (limits[field]) leveling.announcements[field] = target.value.slice(0, limits[field]);
      }
      syncInlineEditorVisual(target);
      refreshDirty();
      return;
    }
    if (target === elements.levelingEnabled) leveling.enabled = target.checked;
    if (target === elements.xpDropsEnabled) leveling.xpDrops.enabled = target.checked;
    if (target === elements.xpDropChannel) leveling.xpDrops.channelId = target.value;
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
    if (target.matches('[data-leveling-additional-accent]')) {
      const container = leveling.announcements.additionalContainers[Number(target.dataset.levelingAdditionalAccent)];
      if (container) container.layout.accentColor = target.value;
      renderMessagePreview();
    }
    if (target.matches('[data-leveling-additional-thumbnail-url]')) {
      const container = leveling.announcements.additionalContainers[Number(target.dataset.levelingAdditionalThumbnailUrl)];
      if (container) {
        container.layout.thumbnailUrl = target.value.slice(0, 2000);
        container.layout.thumbnailEnabled = validMediaTemplate(target.value);
      }
      renderMessagePreview(false);
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
    if (target.matches('[data-leveling-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.levelingAdditionalGalleryUrl.split(':').map(Number);
      const container = leveling.announcements.additionalContainers[containerIndex];
      if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000);
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
        else if (field === 'dropEvery' || field === 'despawnAfter') {
          const duration = target.closest('.xp-drop-duration');
          if (duration) {
            const amount = duration.querySelector('[data-xp-drop-duration-part="amount"]')?.value.trim() || '';
            const unit = duration.querySelector('[data-xp-drop-duration-part="unit"]')?.value || 'm';
            crate[field] = amount && Number(amount) > 0 ? `${amount}${unit}`.slice(0, 16) : '';
          } else crate[field] = target.value.slice(0, 16);
        }
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

  function updateMemberMessagesFromControl(target) {
    if (!state.config?.memberMessages) return;
    const config = state.config.memberMessages;
    const event = currentMemberMessage();
    if (!event) return;
    if (target.matches('[data-inline-message-input]')) {
      const containerIndex = Number(target.dataset.additionalContainerIndex);
      if (Number.isInteger(containerIndex) && event.additionalContainers[containerIndex]) event.additionalContainers[containerIndex].content = target.value.slice(0, 3000);
      else event.template = target.value.slice(0, 3000);
      syncInlineEditorVisual(target);
      refreshDirty();
      return;
    }
    if (target === elements.welcomeMessagesEnabled) config.enabled = target.checked;
    if (target === elements.welcomeEventEnabled) event.enabled = target.checked;
    if (target === elements.welcomeEventChannel) event.channelId = target.value;
    if (target.matches('[data-welcome-thumbnail-url]')) {
      event.layout.thumbnailUrl = target.value.slice(0, 2000);
      event.layout.thumbnailEnabled = Boolean(target.value.trim());
      renderWelcomeMessagePreview(false);
    }
    if (target.matches('[data-welcome-gallery-url]')) {
      event.layout.galleryUrls[Number(target.dataset.welcomeGalleryUrl)] = target.value.slice(0, 2000);
      renderWelcomeMessagePreview(false);
    }
    if (target === elements.welcomeAccentColor) {
      event.layout.accentColor = target.value;
      renderWelcomeMessagePreview();
    }
    if (target.matches('[data-welcome-additional-accent]')) {
      const container = event.additionalContainers[Number(target.dataset.welcomeAdditionalAccent)];
      if (container) container.layout.accentColor = target.value;
      renderWelcomeMessagePreview();
    }
    if (target.matches('[data-welcome-additional-thumbnail-url]')) {
      const container = event.additionalContainers[Number(target.dataset.welcomeAdditionalThumbnailUrl)];
      if (container) {
        container.layout.thumbnailUrl = target.value.slice(0, 2000);
        container.layout.thumbnailEnabled = validMemberMediaTemplate(target.value);
      }
      renderWelcomeMessagePreview(false);
    }
    if (target.matches('[data-welcome-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.welcomeAdditionalGalleryUrl.split(':').map(Number);
      const container = event.additionalContainers[containerIndex];
      if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000);
      renderWelcomeMessagePreview(false);
    }
    refreshDirty();
  }

  function updateReactionRoleFromControl(target) {
    const draft = state.reactionRoleDraft;
    if (!draft) return;
    if (target.matches('[data-inline-message-input]')) {
      const index = Number(target.dataset.additionalContainerIndex);
      if (Number.isInteger(index) && draft.message.additionalContainers[index]) draft.message.additionalContainers[index].content = target.value.slice(0, 4000);
      else draft.message.content = target.value.slice(0, 4000);
      syncInlineEditorVisual(target); refreshDirty(); return;
    }
    if (target === elements.reactionRoleName) { draft.name = target.value.slice(0, 80); renderReactionRoleList(); }
    if (target === elements.reactionRoleEnabled) draft.enabled = target.checked;
    if (target === elements.reactionRoleAccentColor) { draft.message.layout.accentColor = target.value; renderReactionRoleMessage(); }
    if (target === elements.reactionRoleChannel) { draft.channelId = target.value; renderReactionRoleChannel(); }
    if (target.matches('[data-reaction-thumbnail-url]')) {
      draft.message.layout.thumbnailUrl = target.value.slice(0, 2000); draft.message.layout.thumbnailEnabled = validTemplateMedia(target.value); renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-gallery-url]')) {
      draft.message.layout.galleryUrls[Number(target.dataset.reactionGalleryUrl)] = target.value.slice(0, 2000); renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-additional-accent]')) {
      const container = draft.message.additionalContainers[Number(target.dataset.reactionAdditionalAccent)]; if (container) container.layout.accentColor = target.value; renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-additional-thumbnail-url]')) {
      const container = draft.message.additionalContainers[Number(target.dataset.reactionAdditionalThumbnailUrl)];
      if (container) { container.layout.thumbnailUrl = target.value.slice(0, 2000); container.layout.thumbnailEnabled = validTemplateMedia(target.value); }
      renderReactionRoleMessage();
    }
    if (target.matches('[data-reaction-additional-gallery-url]')) {
      const [containerIndex, mediaIndex] = target.dataset.reactionAdditionalGalleryUrl.split(':').map(Number);
      const container = draft.message.additionalContainers[containerIndex]; if (container) container.layout.galleryUrls[mediaIndex] = target.value.slice(0, 2000); renderReactionRoleMessage();
    }
    if (target.matches('[data-rr-button-label]')) { draft.buttons[Number(target.dataset.rrButtonLabel)].label = target.value.slice(0, 80); renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-button-role]')) draft.buttons[Number(target.dataset.rrButtonRole)].roleId = target.value;
    if (target.matches('[data-rr-button-style]')) { draft.buttons[Number(target.dataset.rrButtonStyle)].style = target.value; renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-dropdown-placeholder]')) { draft.dropdown.placeholder = target.value.slice(0, 150); renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-allow-multiple]')) draft.dropdown.allowMultiple = target.checked;
    if (target.matches('[data-rr-option-title]')) { draft.dropdown.options[Number(target.dataset.rrOptionTitle)].title = target.value.slice(0, 100); renderReactionRoleControlPreview(); }
    if (target.matches('[data-rr-option-description]')) draft.dropdown.options[Number(target.dataset.rrOptionDescription)].description = target.value.slice(0, 100);
    if (target.matches('[data-rr-option-role]')) draft.dropdown.options[Number(target.dataset.rrOptionRole)].roleId = target.value;
    elements.reactionRoleStatus.textContent = 'UNSAVED'; elements.reactionRoleStatus.classList.add('unsaved'); refreshDirty();
  }

  function insertReactionRoleVariable(token) {
    const input = preferredInlineInput('reactionRole');
    if (!input) return;
    const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
    const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : start;
    input.value = `${input.value.slice(0, start)}${token}${input.value.slice(end)}`.slice(0, 4000);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus(); input.setSelectionRange(start + token.length, start + token.length);
  }

  async function uploadReactionRoleMedia(input) {
    const file = input.files?.[0]; const draft = state.reactionRoleDraft;
    if (!file || !draft) return;
    if (!file.type.startsWith('image/') || file.size > 10 * 1024 * 1024) { input.value = ''; return showToast(file.size > 10 * 1024 * 1024 ? 'Images must be 10 MB or smaller.' : 'Upload an image file.', 'error'); }
    const label = input.closest('.media-upload'); label?.classList.add('uploading');
    try {
      const result = await api(`/api/guilds/${state.guildId}/message-media`, { method: 'POST', body: JSON.stringify({ dataUrl: await readMediaFile(file) }) });
      const containerIndex = Number(input.dataset.additionalContainerIndex);
      const layout = Number.isInteger(containerIndex) ? draft.message.additionalContainers[containerIndex]?.layout : draft.message.layout;
      if (!layout) throw new Error('That container no longer exists.');
      if (input.dataset.reactionMediaUpload === 'thumbnail') { layout.thumbnailUrl = result.url; layout.thumbnailEnabled = true; }
      else { const index = Number(input.dataset.mediaIndex); if (Number.isInteger(index) && index >= 0 && index < layout.galleryUrls.length) layout.galleryUrls[index] = result.url; else if (layout.galleryUrls.length < 10) layout.galleryUrls.push(result.url); }
      renderReactionRoleMessage(); refreshDirty(); showToast('Image uploaded. Save the Reaction Role when ready.');
    } catch (error) { showToast(error.message || 'Image upload failed.', 'error'); }
    finally { label?.classList.remove('uploading'); input.value = ''; }
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

  function resetCurrentMemberMessage() {
    if (!state.config?.memberMessages) return;
    state.config.memberMessages[state.memberMessageEvent] = clone(MEMBER_MESSAGE_DEFAULTS[state.memberMessageEvent]);
    state.memberMessageComposerPanel = '';
    renderWelcomeMessages();
    showToast(`${MEMBER_MESSAGE_META[state.memberMessageEvent].title} reset to its default.`);
  }

  function resetUnsavedChanges() {
    if (!state.savedConfig || state.saving) return;
    state.config = clone(state.savedConfig);
    renderFeatureAccess();
    renderLeveling();
    renderGames();
    renderWelcomeMessages();
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
