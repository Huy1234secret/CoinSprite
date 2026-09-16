// state: dashboard feature controller. Server contracts are documented in docs/dashboard-audit.md.


export const CARD_UNICODE_FALLBACK = '"Noto Sans SC Variable", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Sans", "DejaVu Sans", sans-serif';

export const CARD_FONT_FAMILY = '"Noto Sans Variable", ' + CARD_UNICODE_FALLBACK;

export const CARD_FONT_FAMILIES = Object.freeze({
    sans: CARD_FONT_FAMILY,
    serif: '"Noto Serif Variable", ' + CARD_UNICODE_FALLBACK,
    mono: '"Roboto Mono Variable", ' + CARD_UNICODE_FALLBACK,
    rounded: '"Nunito Variable", ' + CARD_UNICODE_FALLBACK,
    condensed: '"Oswald Variable", ' + CARD_UNICODE_FALLBACK,
    handwriting: '"Caveat Variable", ' + CARD_UNICODE_FALLBACK,
  });

export const CARD_REQUIRED_FONT_FACES = Object.freeze([
    { family: 'Noto Sans Variable', italic: true },
    { family: 'Noto Sans SC Variable', italic: false },
    { family: 'Noto Serif Variable', italic: true },
    { family: 'Roboto Mono Variable', italic: true },
    { family: 'Nunito Variable', italic: true },
    { family: 'Oswald Variable', italic: false },
    { family: 'Caveat Variable', italic: false },
  ]);

export const EMPTY_EMOJI_DATA = Object.freeze({ version: '', emojiCount: 0, groups: Object.freeze([]) });

export const DEFAULT_EMOJI_DATA_URL = document.querySelector('#emojiDataAsset')?.dataset.src || '/admin/emojiData.js';

export const EMOJI_RENDER_BATCH = 96;

export const EMOJI_SEARCH_DEBOUNCE_MS = 120;

export const DEFAULT_EMOJI_DATA = { value: window.COINSPRITE_EMOJI_DATA || EMPTY_EMOJI_DATA };

export const defaultEmojiDataPromise = { value: null };

export const emojiSearchTimer = { value: null };

export const defaultEmojiItemCache = new Map();

export const directoryEmojiItemCache = new Map();

export const cardFontLoads = new Map();

export const CARD_PREVIEW_DEBOUNCE_MS = 350;

export const CARD_SNAP_DISTANCE = 6;

export const CARD_SNAP_RELEASE = 10;

export const CARD_HISTORY_LIMIT = 60;

export const CARD_TEMPLATES = Object.freeze({
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

export const state = {
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
    emojiCategory: DEFAULT_EMOJI_DATA.value.groups[0]?.id || '',
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

export const $ = (selector, root = document) => root.querySelector(selector);

export const elements = {
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

export const toastTimer = { value: null };

export const MAX_ADDITIONAL_MESSAGE_CONTAINERS = 2;

export const MEMBER_MESSAGE_DEFAULTS = Object.freeze({
    enabled: true,
    join: Object.freeze({ enabled: false, channelId: '', template: '## Welcome to {server}, {user}! 🎉\nYou’re member **#{member_count}**. We’re happy to have you here!', layout: Object.freeze({ container: true, accentColor: '#57f287', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]) }), additionalContainers: Object.freeze([]) }),
    leave: Object.freeze({ enabled: false, channelId: '', template: '## {display_name} has left the server\nThanks for being part of {server}. We now have **{member_count}** members.', layout: Object.freeze({ container: true, accentColor: '#ed4245', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]) }), additionalContainers: Object.freeze([]) }),
    boost: Object.freeze({ enabled: false, channelId: '', template: '## Thank you for boosting, {user}! 💜\n{server} now has **{boost_count} boosts** and is at **Boost Level {boost_level}**.', layout: Object.freeze({ container: true, accentColor: '#f47fff', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]) }), additionalContainers: Object.freeze([]) }),
  });

export const XP_DROP_VARIABLES = [
    ['{crate_name}', 'Crate name'], ['{xp_min}', 'Minimum XP'], ['{xp_max}', 'Maximum XP'],
    ['{xp}', 'Claimed XP'], ['{claim_limit}', 'Total claim slots'], ['{claims_left}', 'Remaining claims'],
    ['{list_claimed_user}', 'Members who claimed'],
    ['{chance}', 'Drop chance percent'], ['{drop_every}', 'Drop interval'], ['{despawn_time}', 'Despawn interval or never'],
    ['{user}', 'Claiming member mention'], ['{username}', 'Claiming display name'], ['{level}', 'Member level'],
    ['{total_xp}', 'Member total XP'], ['{server}', 'Server name'], ['{channel}', 'Drop channel'], ['{separator}', 'Discord divider'],
  ];

export const LEVELING_VARIABLES = [
    ['{user}', 'Mention the member'], ['{user_profile}', 'Member profile image URL'],
    ['{username}', 'Member display name'],
    ['{level}', 'New level'], ['{next_level}', 'Next level'],
    ['{server}', 'Server name'], ['{bar}', 'Live XP progress bar'],
    ['{progress_xp}', 'XP earned inside this level'], ['{needed_xp}', 'XP required for the next level'],
    ['{total_xp}', 'Member total XP'], ['{separator}', 'Insert a Discord divider in the message'],
  ];

export const MEMBER_MESSAGE_META = Object.freeze({
    join: { title: 'Join message', description: 'Sent after a new member joins this Discord server.', toggle: 'Send when a member joins', preview: 'JOIN PREVIEW', step: '01' },
    leave: { title: 'Leave message', description: 'Sent after a member leaves or is removed from this Discord server.', toggle: 'Send when a member leaves', preview: 'LEAVE PREVIEW', step: '02' },
    boost: { title: 'Boost message', description: 'Sent for a new server boost, with duplicate Discord events collapsed into one post.', toggle: 'Send when a member boosts', preview: 'BOOST PREVIEW', step: '03' },
  });

export const MEMBER_MESSAGE_COMMON_VARIABLES = [
    ['{user}', 'Member mention'], ['{username}', 'Discord username'], ['{display_name}', 'Server display name'],
    ['{user_id}', 'Member ID'], ['{user_avatar}', 'Member avatar URL'], ['{server}', 'Server name'],
    ['{server_icon}', 'Server icon URL'], ['{member_count}', 'Current member count'], ['{channel}', 'Selected channel mention'],
    ['{timestamp}', 'Event time'], ['{separator}', 'Discord divider'],
  ];

export const MEMBER_MESSAGE_EVENT_VARIABLES = Object.freeze({
    join: [['{joined_at}', 'Server join time'], ['{account_created}', 'Account creation time'], ['{account_age}', 'Discord account age']],
    leave: [['{joined_at}', 'Original join time'], ['{time_in_server}', 'Time spent in server']],
    boost: [['{boost_count}', 'Current boost count'], ['{boost_level}', 'Current boost level'], ['{boost_since}', 'Boost start time']],
  });

export const TEMPLATE_LAYOUT_DEFAULTS = Object.freeze({
    container: true, accentColor: '#b9f547', thumbnailEnabled: false, thumbnailUrl: '', galleryUrls: Object.freeze([]),
  });

export const TEMPLATE_ACTION_TYPES = Object.freeze(['send_message', 'give_role', 'remove_role', 'dm_message']);

export const TEMPLATE_ACTION_LABELS = Object.freeze({
    send_message: 'Send ephemeral message', give_role: 'Give role', remove_role: 'Remove role', dm_message: 'DM message',
  });

export const TEMPLATE_CONTROL_DEFAULTS = Object.freeze({
    type: 'none', buttons: Object.freeze([]),
    dropdowns: Object.freeze([]),
  });

export const GENERIC_TEMPLATE_VARIABLES = [
    ['{server}', 'Server name'], ['{server_icon}', 'Server icon URL'], ['{channel}', 'Destination channel'],
    ['{timestamp}', 'Current Discord timestamp'], ['{separator}', 'Discord divider'],
  ];

export const cardImages = new Map();

export const cardFrame = { value: 0 };

export const cardDrawRequest = { value: 0 };

export const cardFontsReadyPromise = { value: null };

export const CARD_BUILTINS = [
    ['background', '🌄', 'Background'], ['avatar', '🪪', 'Discord profile'], ['username', '✏️', 'Username'],
    ['level', '🏅', 'Level'], ['rank', '🏆', 'Rank'], ['progress', '📊', 'Progress bar'], ['xp', '✨', 'XP amount'],
  ];
