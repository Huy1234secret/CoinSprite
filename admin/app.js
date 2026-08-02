const TAB_NAMES = {
  leveling: 'Leveling',
  channels: 'Channels',
  roles: 'Roles',
  tickets: 'Tickets',
  invites: 'Invite rewards',
  gag2Stock: 'Gag2 stock',
  games: 'Games',
};

const GAG2_STOCK_CHANNELS = [
  ['seed', 'Seed stock', 'gag2SeedChannelMount'],
  ['gear', 'Gear stock', 'gag2GearChannelMount'],
  ['crate', 'Crate stock', 'gag2CrateChannelMount'],
  ['weather', 'Weather', 'gag2WeatherChannelMount'],
  ['moon', 'Moon prediction', 'gag2MoonChannelMount'],
  ['sell', 'Sell price track', 'gag2SellChannelMount'],
  ['roleAssign', 'Role assignment', 'gag2AssignRoleChannelMount'],
  ['updates', 'Bot Update alert', 'gag2UpdatesChannelMount'],
];
const GAG2_STOCK_ROLE_COUNTS = {
  seed: 30,
  gear: 17,
  crate: 16,
  weather: 12,
  moon: 12,
  sell: 16,
  roleAssign: 0,
  updates: 0,
};
const GAG2_ROLE_RARITIES = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'super'];
const GAG2_SELL_RARITIES = [...GAG2_ROLE_RARITIES, 'secret'];
const GAG2_SELL_MULTIPLIERS = ['normal', '2x', '4x'];
const GAG2_RARITY_COLORS = {
  common: '#B0ADAC', uncommon: '#3EC044', rare: '#3E7EF4', epic: '#9D3CD2',
  legendary: '#E2AB0F', mythic: '#D62928', super: '#B71E99', secret: '#FFFFFF',
};
const GAG2_FALL_TYPES = ['seed', 'gear', 'crate', 'sell'];
const GAG2_FALL_RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'super'];
const GAG2_FALL_RARITY_LABELS = { mythic: 'Mythical' };

function gardenItem(key, name, emojiId, rarity) {
  return { key, name, emojiId, rarity };
}

const GAG2_GARDEN_ITEMS = {
  seed: [
    gardenItem('carrot', 'Carrot', '1525195196864925817', 'common'),
    gardenItem('strawberry', 'Strawberry', '1525195237008474242', 'common'),
    gardenItem('blueberry', 'Blueberry', '1525195192632741990', 'common'),
    gardenItem('tulip', 'Tulip', '1525195243438211163', 'uncommon'),
    gardenItem('tomato', 'Tomato', '1525195241026617435', 'uncommon'),
    gardenItem('apple', 'Apple', '1525195186085429340', 'uncommon'),
    gardenItem('bamboo', 'Bamboo', '1525195188538970295', 'rare'),
    gardenItem('corn', 'Corn', '1525195203651174512', 'rare'),
    gardenItem('cactus', 'Cactus', '1525195194759254016', 'rare'),
    gardenItem('pineapple', 'Pineapple', '1525195227667759198', 'rare'),
    gardenItem('mushroom', 'Mushroom', '1525195225511760072', 'epic'),
    gardenItem('green_bean', 'Green Bean', '1525195214489124874', 'epic'),
    gardenItem('banana', 'Banana', '1525195190707683338', 'epic'),
    gardenItem('grape', 'Grape', '1525195212236914779', 'epic'),
    gardenItem('coconut', 'Coconut', '1525195201818394806', 'epic'),
    gardenItem('mango', 'Mango', '1525195221200011437', 'epic'),
    gardenItem('dragon_fruit', 'Dragon Fruit', '1525195205807050822', 'legendary'),
    gardenItem('acorn', 'Acorn', '1525195184541794434', 'legendary'),
    gardenItem('cherry', 'Cherry', '1525195199381504114', 'legendary'),
    gardenItem('sunflower', 'Sunflower', '1525195239155830946', 'legendary'),
    gardenItem('fire_fern', 'Fire Fern', '1525195210068590703', 'legendary'),
    gardenItem('venus_fly_trap', 'Venus Flytrap', '1525195248169390171', 'mythic'),
    gardenItem('pomegranate', 'Pomegranate', '1525195232377835541', 'mythic'),
    gardenItem('poison_apple', 'Poison Apple', '1525195230201249983', 'mythic'),
    gardenItem('venom_spitter', 'Venom Spitter', '1525195245661327550', 'mythic'),
    gardenItem('moon_bloom', 'Moon Bloom', '1525195223473586196', 'super'),
    gardenItem('hypno_bloom', 'Hypno Bloom', '1525195218805194752', 'super'),
    gardenItem('dragon_s_breath', "Dragon's Breath", '1525195207778373814', 'super'),
    gardenItem('sun_bloom', 'Sun Bloom', '1525996662449766431', 'super'),
    gardenItem('star_fruit', 'Star Fruit', '1525996660000428112', 'super'),
  ],
  gear: [
    gardenItem('common_watering_can', 'Common Watering Can', '1525198690707439736', 'common'),
    gardenItem('common_sprinkler', 'Common Sprinkler', '1525198688283267234', 'common'),
    gardenItem('uncommon_sprinkler', 'Uncommon Sprinkler', '1525198728846115007', 'uncommon'),
    gardenItem('trowel', 'Trowel', '1525198726535053404', 'rare'),
    gardenItem('rare_sprinkler', 'Rare Sprinkler', '1525198712761090308', 'rare'),
    gardenItem('jump_mushroom', 'Jump Mushroom', '1525198699456626799', 'rare'),
    gardenItem('speed_mushroom', 'Speed Mushroom', '1525198716577911024', 'rare'),
    gardenItem('shrink_mushroom', 'Shrink Mushroom', '1525198714749059162', 'epic'),
    gardenItem('supersize_mushroom', 'Supersize Mushroom', '1525198724639232100', 'epic'),
    gardenItem('gnome', 'Gnome', '1525198694763200673', 'epic'),
    gardenItem('flashbang', 'Flashbang', '1525198692846538895', 'epic'),
    gardenItem('basic_pot', 'Basic Pot', '1525198685410033684', 'epic'),
    gardenItem('legendary_sprinkler', 'Legendary Sprinkler', '1525198702690697358', 'epic'),
    gardenItem('invisibility_mushroom', 'Invisibility Mushroom', '1525198697263140954', 'legendary'),
    gardenItem('player_magnet', 'Player Magnet', '1525198710231928832', 'mythic'),
    gardenItem('super_watering_can', 'Super Watering Can', '1525198722785345708', 'super'),
    gardenItem('super_sprinkler', 'Super Sprinkler', '1525198720931729589', 'super'),
  ],
  crate: [
    gardenItem('ladder_crate', 'Ladder', '1525201085231403240', 'common'),
    gardenItem('bench_crate', 'Bench', '1525201076276433056', 'uncommon'),
    gardenItem('light_crate', 'Light', '1525201087282413689', 'uncommon'),
    gardenItem('sign_crate', 'Sign', '1525201096023474217', 'rare'),
    gardenItem('arch_crate', 'Arch', '1525201071620882542', 'rare'),
    gardenItem('roleplay_crate', 'Roleplay', '1525201091317465108', 'rare'),
    gardenItem('picture_frame_crate', 'Picture Frame', '1525202336631361606', 'rare'),
    gardenItem('bridge_crate', 'Bridge', '1525201078642147469', 'epic'),
    gardenItem('spring_crate', 'Spring', '1525201098233745528', 'epic'),
    gardenItem('seesaw_crate', 'Seesaw', '1525201094257545286', 'epic'),
    gardenItem('conveyor_crate', 'Conveyor', '1525201080831443096', 'epic'),
    gardenItem('owner_door_crate', 'Owner Door', '1525201089387954196', 'legendary'),
    gardenItem('bear_trap_crate', 'Bear Trap', '1525201073957245019', 'legendary'),
    gardenItem('boombox_crate', 'Boombox', '1525201479546441931', 'legendary'),
    gardenItem('fence_crate', 'Fence', '1525201083117342911', 'legendary'),
    gardenItem('teleporter_pad_crate', 'Teleporter Pad', '1525201100792397874', 'mythic'),
  ],
};

function fallItem(key, name, emojiId, rarity) {
  return { key, name, emojiId, rarity };
}

const GAG2_FALL_SEED_ITEMS = [
  fallItem('maple_blueberry', 'Maple Blueberry', '1533299270378328254', 'common'),
  fallItem('maple_strawberry', 'Maple Strawberry', '1533299298907853021', 'common'),
  fallItem('maple_carrot', 'Maple Carrot', '1533299274186489938', 'common'),
  fallItem('maple_apple', 'Maple Apple', '1533299264757825536', 'uncommon'),
  fallItem('maple_tomato', 'Maple Tomato', '1533299302057775247', 'uncommon'),
  fallItem('maple_tulip', 'Maple Tulip', '1533299304222162985', 'uncommon'),
  fallItem('maple_pineapple', 'Maple Pineapple', '1533299293509783622', 'rare'),
  fallItem('maple_cactus', 'Maple Cactus', '1533299272458703038', 'rare'),
  fallItem('maple_corn', 'Maple Corn', '1533299279718781129', 'rare'),
  fallItem('maple_bamboo', 'Maple Bamboo', '1533299266624422028', 'rare'),
  fallItem('maple_mango', 'Maple Mango', '1533299288036216902', 'epic'),
  fallItem('maple_coconut', 'Maple Coconut', '1533299277634469889', 'epic'),
  fallItem('maple_grape', 'Maple Grape', '1533299284349423626', 'epic'),
  fallItem('maple_banana', 'Maple Banana', '1533299268369256540', 'epic'),
  fallItem('maple_green_bean', 'Maple Green Bean', '1533299286027010188', 'epic'),
  fallItem('maple_mushroom', 'Maple Mushroom', '1533299290263388231', 'epic'),
  fallItem('maple_sunflower', 'Maple Sunflower', '1533299300623192195', 'legendary'),
  fallItem('maple_cherry', 'Maple Cherry', '1533299275910611044', 'legendary'),
  fallItem('maple_acorn', 'Maple Acorn', '1533299262639575041', 'legendary'),
  fallItem('atlantic_giant_pumpkin', 'Atlantic Giant Pumpkin', '1533299248102113370', 'legendary'),
  fallItem('maple_dragon_fruit', 'Maple Dragon Fruit', '1533299281748951070', 'legendary'),
  fallItem('conifer_cone', 'Conifer Cone', '1533299251638042787', 'mythic'),
  fallItem('maple_venom_spitter', 'Maple Venom Spitter', '1533299307065643071', 'mythic'),
  fallItem('maple_poison_apple', 'Maple Poison Apple', '1533299295367991417', 'mythic'),
  fallItem('maple_pomegranate', 'Maple Pomegranate', '1533299297209155624', 'mythic'),
  fallItem('maple_venus_fly_trap', 'Maple Venus Fly Trap', '1533299309292818462', 'mythic'),
  fallItem('amber_cranberry', 'Amber Cranberry', '1533299246315475045', 'super'),
];
const GAG2_FALL_GEAR_ITEMS = [
  fallItem('syrup_sprinkler', 'Syrup Sprinkler', '1533305566112387283', 'common'),
  fallItem('syrup_watering_can', 'Syrup Watering Can', '1533305567978848348', 'common'),
  fallItem('rare_magic_mail', 'Rare Magic Mail', '1533305557618917396', 'rare'),
  fallItem('harp', 'Harp', '1533305553621749780', 'rare'),
  fallItem('legendary_magic_mail', 'Legendary Magic Mail', '1533305555740000256', 'legendary'),
  fallItem('super_magic_mail', 'Super Magic Mail', '1533305559728656515', 'super'),
  fallItem('super_syrup_sprinkler', 'Super Syrup Sprinkler', '1533305562043781282', 'super'),
  fallItem('super_syrup_watering_can', 'Super Syrup Watering Can', '1533305564312895539', 'super'),
];
const GAG2_FALL_CRATE_ITEMS = [
  fallItem('fall_cosmetic_crate', 'Fall Cosmetic Crate', '1533306166300643509', 'uncommon'),
  fallItem('lantern_crate', 'Lantern Crate', '1533306170348011520', 'uncommon'),
  fallItem('fall_structure_crate', 'Fall Structure Crate', '1533306168213246052', 'rare'),
  fallItem('cobblestone_crate', 'Cobblestone Crate', '1533306164018937936', 'rare'),
  fallItem('rake_crate', 'Rake Crate', '1533306173112188998', 'legendary'),
];
const GAG2_FALL_ITEMS = {
  seed: GAG2_FALL_SEED_ITEMS,
  gear: GAG2_FALL_GEAR_ITEMS,
  crate: GAG2_FALL_CRATE_ITEMS,
  sell: [],
};

function defaultGag2StockFilters() {
  return {
    rarities: {
      seed: [...GAG2_ROLE_RARITIES],
      gear: [...GAG2_ROLE_RARITIES],
      crate: [...GAG2_ROLE_RARITIES],
      sell: [...GAG2_SELL_RARITIES],
    },
    roleItems: Object.fromEntries(Object.entries(GAG2_GARDEN_ITEMS)
      .map(([type, items]) => [type, items.map((item) => item.key)])),
    sellMultipliers: [...GAG2_SELL_MULTIPLIERS],
  };
}

function defaultGag2FallConfig() {
  return {
    enabledTypes: [],
    roleItems: Object.fromEntries(GAG2_FALL_TYPES.map((type) => [type, []])),
  };
}

const state = {
  me: null,
  guilds: [],
  guildId: '',
  savedConfig: null,
  savedSnapshots: {},
  directory: { channels: [], categories: [], roles: [] },
  gag2StockPermissions: { usable: true, missing: [] },
  channelValues: {},
  roleValues: {},
  xpGroups: [],
  boosts: [],
  rewards: [],
  gag2StockChannels: {},
  gag2StockFilters: defaultGag2StockFilters(),
  gag2Fall: defaultGag2FallConfig(),
  activeTab: 'leveling',
  activeLevelingTab: 'xp',
  visibleTabs: null,
  featureVisibilityObserver: null,
  featureVisibilityQueued: false,
  gag2RoleProgressTimer: null,
  ticketEditor: null,
  dirtyTabs: new Set(),
  saving: false,
  syncLocked: false,
};

const elements = {
  sessionLabel: document.querySelector('#sessionLabel'),
  userChip: document.querySelector('#userChip'),
  userAvatar: document.querySelector('#userAvatar'),
  loginButton: document.querySelector('#loginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  loginPanel: document.querySelector('#loginPanel'),
  loginStatus: document.querySelector('#loginStatus'),
  appShell: document.querySelector('#appShell'),
  guildSelect: document.querySelector('#guildSelect'),
  serverMeta: document.querySelector('#serverMeta'),
  statusBox: document.querySelector('#statusBox'),
  editor: document.querySelector('#editor'),
  guildTitle: document.querySelector('#guildTitle'),
  guildSubtitle: document.querySelector('#guildSubtitle'),
  savedState: document.querySelector('#savedState'),
  saveButton: document.querySelector('#saveButton'),
  resetTabButton: document.querySelector('#resetTabButton'),
  unsavedBar: document.querySelector('#unsavedBar'),
  unsavedDetail: document.querySelector('#unsavedDetail'),
  configForm: document.querySelector('#configForm'),
  tabList: document.querySelector('#tabList'),
  levelingTabList: document.querySelector('#levelingTabList'),
  channelsGrid: document.querySelector('#channelsGrid'),
  rolesGrid: document.querySelector('#rolesGrid'),
  xpChannelRows: document.querySelector('#xpChannelRows'),
  xpEmptyState: document.querySelector('#xpEmptyState'),
  addXpChannelButton: document.querySelector('#addXpChannelButton'),
  boostRows: document.querySelector('#boostRows'),
  addBoostButton: document.querySelector('#addBoostButton'),
  rewardRows: document.querySelector('#rewardRows'),
  addRewardButton: document.querySelector('#addRewardButton'),
  gag2StockMounts: Object.fromEntries(GAG2_STOCK_CHANNELS.map(([, , id]) => [id, document.querySelector(`#${id}`)])),
  gag2StockPanel: document.querySelector('#gag2StockPanel'),
  gag2StockPermissionOverlay: document.querySelector('#gag2StockPermissionOverlay'),
  gag2StockPermissionText: document.querySelector('#gag2StockPermissionText'),
  gag2StockPermissionRefreshButton: document.querySelector('#gag2StockPermissionRefreshButton'),
  gag2FallTypeInputs: [...document.querySelectorAll('[data-gag2-fall-type]')],
  gag2FallRoleSettingsMount: document.querySelector('#gag2FallRoleSettingsMount'),
  gag2RarityMounts: {
    seed: document.querySelector('#gag2SeedRarityMount'),
    gear: document.querySelector('#gag2GearRarityMount'),
    crate: document.querySelector('#gag2CrateRarityMount'),
    sell: document.querySelector('#gag2SellRarityMount'),
  },
  gag2SellMultiplierInputs: [...document.querySelectorAll('[data-gag2-sell-multiplier]')],
  levelUpChannelMount: document.querySelector('#levelUpChannelMount'),
  levelUpTokens: document.querySelector('#levelUpTokens'),
  levelUpContent: document.querySelector('#levelUpContent'),
  levelUpPreviewLevel: document.querySelector('#levelUpPreviewLevel'),
  levelUpPreview: document.querySelector('#levelUpPreview'),
  levelUpPreviewContainer: document.querySelector('#levelUpPreviewContainer'),
  levelUpPreviewBody: document.querySelector('#levelUpPreviewBody'),
  levelUpPreviewImage: document.querySelector('#levelUpPreviewImage'),
  ticketEditorRoot: document.querySelector('#ticketEditorRoot'),
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setStatus(message, kind = '') {
  elements.statusBox.textContent = message;
  elements.statusBox.className = `status${kind ? ` ${kind}` : ''}`;
  elements.loginStatus.textContent = message;
  elements.loginStatus.className = `status compact${kind ? ` ${kind}` : ''}`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed with ${response.status}`);
  return payload;
}

function setField(name, value) {
  const field = elements.configForm.elements[name];
  if (!field) return;
  if (field.type === 'checkbox') field.checked = Boolean(value);
  else field.value = value ?? '';
}

function getField(name) {
  const field = elements.configForm.elements[name];
  if (!field) return '';
  return field.type === 'checkbox' ? field.checked : field.value;
}

function secondsFromMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric / 1000;
}

function msFromSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.round(numeric * 1000));
}

function labelFromKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

function displayChannelLabel(item) {
  if (item.kind === 'thread' && item.parentName) return `${item.parentName} / ${item.name}`;
  return item.name;
}

function channelOptions() {
  return [
    ...state.directory.categories.map((item) => ({ ...item, label: item.name, optionType: 'category' })),
    ...state.directory.channels.map((item) => ({
      ...item,
      label: displayChannelLabel(item),
      optionType: item.kind || 'text',
      searchText: `${item.name} ${item.parentName || ''} ${item.id}`.toLowerCase(),
    })),
  ];
}

function roleOptions() {
  return state.directory.roles.map((item) => ({ ...item, label: item.name, optionType: 'role' }));
}

function sendableChannelOptions() {
  return channelOptions().filter((item) => ['text', 'announcement', 'thread'].includes(item.kind || item.optionType));
}

function gag2StockPermissionState() {
  const permissions = state.gag2StockPermissions || {};
  const missing = Array.isArray(permissions.missing) ? permissions.missing : [];
  return {
    usable: permissions.usable !== false && missing.length === 0,
    missing,
  };
}

function renderGag2StockPermissionGate() {
  const { usable, missing } = gag2StockPermissionState();
  elements.gag2StockPanel?.classList.toggle('is-locked', !usable);
  if (elements.gag2StockPermissionOverlay) elements.gag2StockPermissionOverlay.hidden = usable;
  if (elements.gag2StockPermissionText) {
    const labels = missing.map((permission) => permission.label || permission.key).filter(Boolean);
    elements.gag2StockPermissionText.textContent = labels.length
      ? `Missing required bot permission${labels.length === 1 ? '' : 's'}: ${labels.join(', ')}.`
      : 'Give the bot the required permissions before editing GAG2 stock settings.';
  }
}

async function refreshGag2StockPermissions() {
  if (!state.guildId) return;
  const button = elements.gag2StockPermissionRefreshButton;
  if (button) {
    button.disabled = true;
    button.textContent = 'Refreshing...';
  }
  try {
    const payload = await api(`/api/guilds/${state.guildId}/directory?refresh=1`);
    state.directory = payload.directory || state.directory;
    state.gag2StockPermissions = state.directory.gag2StockPermissions || { usable: true, missing: [] };
    renderGag2StockPickers();
    setStatus(gag2StockPermissionState().usable ? 'Bot permissions refreshed. GAG2 stock can be edited.' : 'Bot permissions refreshed; required permissions are still missing.', gag2StockPermissionState().usable ? 'ok' : 'error');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Refresh permissions';
    }
  }
}

function optionById(options, id, type) {
  return options.find((option) => option.id === id) || {
    id,
    label: `Unavailable (${id})`,
    optionType: type === 'role' ? 'role' : 'text',
    color: '#99aab5',
  };
}

function channelTag(option) {
  if (option?.optionType === 'category') return 'CAT';
  if (option?.optionType === 'voice') return 'VC';
  if (option?.optionType === 'forum') return 'FOR';
  if (option?.optionType === 'thread') return 'THR';
  if (option?.optionType === 'announcement') return 'ANN';
  return '#';
}

function makeToken(option, type) {
  const token = document.createElement('span');
  token.className = `token${type === 'role' ? ' role-token' : ''}`;
  if (type === 'role') token.style.setProperty('--role-color', option?.color || '#99aab5');
  if (type === 'role') {
    const dot = document.createElement('span');
    dot.className = 'role-dot';
    token.append(dot);
  } else {
    const tag = document.createElement('span');
    tag.className = `tag ${option?.optionType || 'text'}`;
    tag.textContent = channelTag(option);
    token.append(tag);
  }
  const name = document.createElement('span');
  name.textContent = option?.label || 'Unknown';
  token.append(name);
  return token;
}

function renderPicker(mount, options, selectedValue, settings) {
  const {
    multiple = false,
    type = 'channel',
    placeholder = 'Select',
    disabled = false,
    disabledReason = '',
    pickerClass = '',
    menuClass = '',
    optionStyle = '',
    searchPlaceholder = 'Search by name or ID',
    onChange,
  } = settings;
  const selected = multiple ? new Set(selectedValue || []) : new Set(selectedValue ? [selectedValue] : []);
  mount.replaceChildren();

  const picker = document.createElement('div');
  picker.className = `picker ${pickerClass}`.trim();
  const button = document.createElement('button');
  button.className = 'picker-button';
  button.type = 'button';
  button.disabled = disabled;
  button.setAttribute('aria-disabled', String(disabled));
  if (disabledReason) button.title = disabledReason;
  picker.classList.toggle('is-disabled', disabled);
  const selectedWrap = document.createElement('span');
  selectedWrap.className = 'selected-wrap';

  function drawButton() {
    selectedWrap.replaceChildren();
    const selectedOptions = [...selected].map((id) => optionById(options, id, type));
    if (selectedOptions.length === 0) {
      const empty = document.createElement('span');
      empty.className = 'placeholder';
      empty.textContent = placeholder;
      selectedWrap.append(empty);
      return;
    }
    selectedOptions.slice(0, multiple ? 5 : 1).forEach((option) => selectedWrap.append(makeToken(option, type)));
    if (selectedOptions.length > 5) {
      const more = document.createElement('span');
      more.className = 'token';
      more.textContent = `+${selectedOptions.length - 5}`;
      selectedWrap.append(more);
    }
  }

  drawButton();
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = 'v';
  button.append(selectedWrap, chevron);

  const menu = document.createElement('div');
  menu.className = `picker-menu ${menuClass}`.trim();
  const search = document.createElement('input');
  search.className = 'picker-search';
  search.placeholder = searchPlaceholder;
  search.autocomplete = 'off';
  const optionList = document.createElement('div');
  optionList.className = 'option-list';
  menu.append(search, optionList);

  function drawOptions() {
    const query = search.value.trim().toLowerCase();
    const filtered = options.filter((option) => {
      const haystack = option.searchText || `${option.label} ${option.id}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    optionList.replaceChildren();
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-option';
      empty.textContent = 'No results';
      optionList.append(empty);
      return;
    }
    for (const option of filtered) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `option ${type === 'role' ? 'role-option' : ''}${optionStyle === 'rarity' ? ' gag2-rarity-option' : ''}${selected.has(option.id) ? ' selected' : ''}`;
      if (type === 'role') row.style.setProperty('--role-color', option.color || '#99aab5');
      const main = document.createElement('span');
      main.className = 'option-main';
      main.append(makeToken(option, type));
      const check = document.createElement('span');
      check.className = 'check-mark';
      check.textContent = selected.has(option.id) ? 'Selected' : '';
      row.append(main, check);
      row.addEventListener('click', (event) => {
        event.stopPropagation();
        if (disabled) return;
        if (multiple) {
          if (selected.has(option.id)) selected.delete(option.id);
          else selected.add(option.id);
          onChange([...selected]);
          drawButton();
          drawOptions();
        } else {
          onChange(selected.has(option.id) ? '' : option.id);
        }
        refreshDirtyState();
      });
      optionList.append(row);
    }
  }

  button.addEventListener('click', () => {
    if (disabled) return;
    const open = !menu.classList.contains('open');
    document.querySelectorAll('.picker-menu.open').forEach((node) => node.classList.remove('open'));
    document.querySelectorAll('.picker-button.open').forEach((node) => node.classList.remove('open'));
    menu.classList.toggle('open', open);
    button.classList.toggle('open', open);
    if (open) {
      drawOptions();
      search.focus();
    }
  });
  search.addEventListener('input', drawOptions);
  picker.append(button, menu);
  mount.append(picker);
}

function ensureTicketEditor() {
  if (!state.ticketEditor) {
    state.ticketEditor = window.createTicketEditor({
      root: elements.ticketEditorRoot,
      renderPicker,
      channelOptions,
      roleOptions,
      onChange: refreshDirtyState,
    });
  }
  return state.ticketEditor;
}

document.addEventListener('click', (event) => {
  if (event.target.closest('.picker')) return;
  document.querySelectorAll('.picker-menu.open').forEach((node) => node.classList.remove('open'));
  document.querySelectorAll('.picker-button.open').forEach((node) => node.classList.remove('open'));
});

function normalizeXpRule(value, xpConfig) {
  if (typeof value === 'string') {
    return {
      channelId: value,
      minXp: Number(xpConfig.messageXpMin) || 0,
      maxXp: Number(xpConfig.messageXpMax) || 0,
      cooldownMs: Number(xpConfig.messageCooldownMs) || 0,
    };
  }
  return {
    channelId: value?.channelId || '',
    minXp: Number(value?.minXp ?? xpConfig.messageXpMin) || 0,
    maxXp: Number(value?.maxXp ?? xpConfig.messageXpMax) || 0,
    cooldownMs: Number(value?.cooldownMs ?? xpConfig.messageCooldownMs) || 0,
  };
}

function groupXpRules(xpConfig) {
  const groups = new Map();
  for (const rawRule of xpConfig?.channels || []) {
    const rule = normalizeXpRule(rawRule, xpConfig || {});
    if (!rule.channelId) continue;
    const key = `${rule.minXp}|${rule.maxXp}|${rule.cooldownMs}`;
    if (!groups.has(key)) {
      groups.set(key, {
        channelIds: [],
        minXp: rule.minXp,
        maxXp: rule.maxXp,
        cooldownSeconds: secondsFromMs(rule.cooldownMs),
      });
    }
    groups.get(key).channelIds.push(rule.channelId);
  }
  return Array.from(groups.values());
}

function setXpGroupChannels(groupIndex, channelIds) {
  const selected = new Set(channelIds);
  state.xpGroups.forEach((group, index) => {
    if (index === groupIndex) return;
    group.channelIds = group.channelIds.filter((channelId) => !selected.has(channelId));
  });
  state.xpGroups[groupIndex].channelIds = channelIds;
  renderXpChannelRows();
}

function rowInput(title, value, step = '1') {
  const label = document.createElement('label');
  label.textContent = title;
  const input = document.createElement('input');
  input.type = 'number';
  input.min = '0';
  input.step = step;
  input.value = value ?? '';
  label.append(input);
  return { label, input };
}

function renderXpChannelRows() {
  const options = channelOptions();
  elements.xpChannelRows.replaceChildren();
  elements.xpEmptyState.hidden = state.xpGroups.length > 0;

  state.xpGroups.forEach((group, index) => {
    const row = document.createElement('div');
    row.className = 'config-row xp-group-row';
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'picker-field';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = 'Channels, categories, or threads';
    const pickerMount = document.createElement('div');
    pickerWrap.append(label, pickerMount);

    const rangeWrap = document.createElement('div');
    rangeWrap.className = 'xp-range';
    const min = rowInput('Minimum XP', group.minXp, '0.1');
    const max = rowInput('Maximum XP', group.maxXp, '0.1');
    const cooldown = rowInput('Cooldown (seconds)', group.cooldownSeconds, '1');
    rangeWrap.append(min.label, max.label, cooldown.label);

    const remove = document.createElement('button');
    remove.className = 'button small danger';
    remove.type = 'button';
    remove.textContent = 'Remove';

    renderPicker(pickerMount, options, group.channelIds, {
      multiple: true,
      type: 'channel',
      placeholder: 'Select one or more destinations',
      onChange: (value) => setXpGroupChannels(index, value),
    });

    min.input.addEventListener('input', () => {
      state.xpGroups[index].minXp = Number(min.input.value);
      refreshDirtyState();
    });
    max.input.addEventListener('input', () => {
      state.xpGroups[index].maxXp = Number(max.input.value);
      refreshDirtyState();
    });
    cooldown.input.addEventListener('input', () => {
      state.xpGroups[index].cooldownSeconds = Number(cooldown.input.value);
      refreshDirtyState();
    });
    remove.addEventListener('click', () => {
      state.xpGroups.splice(index, 1);
      renderXpChannelRows();
      refreshDirtyState();
    });

    row.append(pickerWrap, rangeWrap, remove);
    elements.xpChannelRows.append(row);
  });
}

function renderObjectPickers(container, groupName, values, options, type, excludedKeys = []) {
  const excluded = new Set(excludedKeys);
  container.replaceChildren();
  for (const [key, value] of Object.entries(values || {})) {
    if (excluded.has(key)) continue;
    const wrap = document.createElement('div');
    wrap.className = 'picker-field';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = labelFromKey(key);
    const mount = document.createElement('div');
    wrap.append(label, mount);
    renderPicker(mount, options, value, {
      type,
      placeholder: `Select ${type}`,
      onChange: (selected) => {
        if (groupName === 'channels') state.channelValues[key] = selected;
        else state.roleValues[key] = selected;
        renderObjectPickers(container, groupName, groupName === 'channels' ? state.channelValues : state.roleValues, options, type, excludedKeys);
      },
    });
    container.append(wrap);
  }
}

function levelUpChannelOptions() {
  return channelOptions().filter((option) => !['category', 'voice', 'forum'].includes(option.optionType));
}

function renderLevelUpChannelPicker() {
  renderPicker(elements.levelUpChannelMount, levelUpChannelOptions(), state.channelValues.levelUp, {
    type: 'channel',
    placeholder: 'Select announcement channel',
    onChange: (value) => {
      state.channelValues.levelUp = value;
      renderLevelUpChannelPicker();
      renderLevelUpPreview();
    },
  });
}

function decodePreviewValue(value) {
  const clean = String(value || '').trim();
  if (!clean) return '';
  if ((clean.startsWith('"') && clean.endsWith('"')) || (clean.startsWith("'") && clean.endsWith("'"))) {
    if (clean.startsWith('"')) {
      try {
        return JSON.parse(clean);
      } catch {
        return '';
      }
    }
    return clean.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
  }
  if (/^-?\d+(?:\.\d+)?$/.test(clean)) return Number(clean);
  return clean;
}

function comparePreviewValues(left, operator, right) {
  const numeric = Number.isFinite(Number(left)) && Number.isFinite(Number(right));
  const a = numeric ? Number(left) : String(left);
  const b = numeric ? Number(right) : String(right);
  if (operator === '==') return a === b;
  if (operator === '!=') return a !== b;
  if (operator === '>=') return a >= b;
  if (operator === '<=') return a <= b;
  if (operator === '>') return a > b;
  if (operator === '<') return a < b;
  return false;
}

function previewContext() {
  const level = Math.max(1, Number(elements.levelUpPreviewLevel.value) || 10);
  const selectedChannel = optionById(levelUpChannelOptions(), state.channelValues.levelUp, 'channel');
  return {
    mention: '@CoinSprite User',
    username: 'CoinSpriteUser',
    display_name: 'CoinSprite User',
    level,
    previous_level: Math.max(0, level - 1),
    server: document.querySelector('#guildTitle').textContent || 'CoinSprite Server',
    channel: selectedChannel?.label ? `#${selectedChannel.label}` : '#level-up',
    channel_id: state.channelValues.levelUp || '123456789012345678',
    user_id: '123456789012345678',
    avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
  };
}

function renderPreviewTemplate(template, context) {
  let output = String(template || '');
  const aliases = { currentlevel: 'level', current_level: 'level', currenlevel: 'level', displayname: 'display_name', previouslevel: 'previous_level', userid: 'user_id' };
  const conditionPattern = /<if<([a-z_]+)>\s*(==|!=|>=|<=|>|<)\s*([^,]+),\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*')\s*,\s*("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|)\s*>/gi;
  for (let pass = 0; pass < 20 && output.includes('<if<'); pass += 1) {
    const next = output.replace(conditionPattern, (match, rawKey, operator, rawRight, rawTrue, rawFalse) => {
      const key = aliases[rawKey.toLowerCase()] || rawKey.toLowerCase();
      const rightKey = String(rawRight).trim().replace(/^<|>$/g, '').toLowerCase();
      const normalizedRightKey = aliases[rightKey] || rightKey;
      const right = Object.prototype.hasOwnProperty.call(context, normalizedRightKey)
        ? context[normalizedRightKey]
        : decodePreviewValue(rawRight);
      return comparePreviewValues(context[key] ?? '', operator, right)
        ? decodePreviewValue(rawTrue)
        : decodePreviewValue(rawFalse);
    });
    if (next === output) break;
    output = next;
  }

  const replacements = {
    '@mention': context.mention,
    username: context.username,
    display_name: context.display_name,
    displayname: context.display_name,
    level: context.level,
    currentlevel: context.level,
    current_level: context.level,
    currenlevel: context.level,
    previous_level: context.previous_level,
    previouslevel: context.previous_level,
    server: context.server,
    channel: context.channel,
    channel_id: context.channel_id,
    user_id: context.user_id,
    userid: context.user_id,
    avatar_url: context.avatar_url,
  };
  return output.replace(/<(@mention|username|display_name|displayname|level|currentlevel|current_level|currenlevel|previous_level|previouslevel|server|channel|channel_id|user_id|userid|avatar_url)>/gi, (match, key) => String(replacements[key.toLowerCase()] ?? ''));
}

function safePreviewMediaUrl(template, context) {
  const value = renderPreviewTemplate(template, context).trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function previewMarkdown(value) {
  const escape = (text) => String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const inline = (text) => escape(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  let inCode = false;
  const lines = [];
  for (const line of String(value).split('\n')) {
    if (line.trim().startsWith('```')) {
      lines.push(inCode ? '</code></pre>' : '<pre class="preview-code"><code>');
      inCode = !inCode;
    } else if (inCode) {
      lines.push(`${escape(line)}\n`);
    } else if (line.startsWith('## ')) {
      lines.push(`<strong class="preview-heading">${inline(line.slice(3))}</strong>`);
    } else if (line.startsWith('-# ')) {
      lines.push(`<span class="preview-subtext">${inline(line.slice(3))}</span>`);
    } else if (line.startsWith('> ')) {
      lines.push(`<span class="preview-quote">${inline(line.slice(2))}</span>`);
    } else {
      lines.push(`<span class="preview-line">${inline(line) || '&nbsp;'}</span>`);
    }
  }
  if (inCode) lines.push('</code></pre>');
  return lines.join('');
}

function renderLevelUpPreview() {
  if (!elements.levelUpPreviewBody) return;
  const context = previewContext();
  const content = renderPreviewTemplate(getField('xp.levelUpMessage.content'), context);
  const thumbnailUrl = safePreviewMediaUrl(getField('xp.levelUpMessage.thumbnailUrl'), context);
  const imageUrl = safePreviewMediaUrl(getField('xp.levelUpMessage.imageUrl'), context);
  if (elements.levelUpPreview && window.CoinSpriteMessageEditor?.renderPreview) {
    elements.levelUpPreview.innerHTML = window.CoinSpriteMessageEditor.renderPreview({
      content: '',
      containers: [{
        accentColor: getField('xp.levelUpMessage.accentColor') || '#57f287',
        text: content,
        thumbnailUrl,
        imageUrl,
      }],
    }, {
      hideEmptyRoot: true,
      containerClass: 'level-up-message-preview',
      containerId: 'levelUpPreviewContainer',
      bodyId: 'levelUpPreviewBody',
    });
    elements.levelUpPreviewContainer = elements.levelUpPreview.querySelector('#levelUpPreviewContainer');
    elements.levelUpPreviewBody = elements.levelUpPreview.querySelector('#levelUpPreviewBody');
    elements.levelUpPreviewImage = null;
    return;
  }
  const rawSections = content.split(/<separator>/gi).map((section) => section.trim()).filter(Boolean);
  const sections = rawSections.length > 18
    ? [...rawSections.slice(0, 17), rawSections.slice(17).join('\n\n')]
    : rawSections;
  elements.levelUpPreviewBody.replaceChildren();
  sections.forEach((section, index) => {
    if (index > 0) {
      const separator = document.createElement('div');
      separator.className = 'preview-separator';
      elements.levelUpPreviewBody.append(separator);
    }
    const row = document.createElement('div');
    row.className = 'preview-section';
    const text = document.createElement('div');
    text.innerHTML = previewMarkdown(section);
    row.append(text);
    if (index === 0 && thumbnailUrl) {
      const thumbnail = document.createElement('img');
      thumbnail.className = 'preview-thumbnail';
      thumbnail.src = thumbnailUrl;
      thumbnail.alt = '';
      row.append(thumbnail);
    }
    elements.levelUpPreviewBody.append(row);
  });
  elements.levelUpPreviewContainer.style.setProperty('--preview-accent', getField('xp.levelUpMessage.accentColor') || '#57f287');
  elements.levelUpPreviewImage.hidden = !imageUrl;
  if (imageUrl) elements.levelUpPreviewImage.src = imageUrl;
}

window.addEventListener('coinsprite:message-editor-ready', renderLevelUpPreview);

function renderBoostRows() {
  const options = roleOptions();
  elements.boostRows.replaceChildren();
  state.boosts.forEach((boost, index) => {
    const row = document.createElement('div');
    row.className = 'config-row';
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'picker-field';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = 'Role';
    const mount = document.createElement('div');
    pickerWrap.append(label, mount);
    const percent = rowInput('XP boost (%)', boost.xpPercent);
    const remove = document.createElement('button');
    remove.className = 'button small danger';
    remove.type = 'button';
    remove.textContent = 'Remove';
    renderPicker(mount, options, boost.roleId, {
      type: 'role',
      placeholder: 'Select role',
      onChange: (value) => {
        state.boosts[index].roleId = value;
        renderBoostRows();
      },
    });
    percent.input.addEventListener('input', () => {
      state.boosts[index].xpPercent = Number(percent.input.value);
      refreshDirtyState();
    });
    remove.addEventListener('click', () => {
      state.boosts.splice(index, 1);
      renderBoostRows();
      refreshDirtyState();
    });
    row.append(pickerWrap, percent.label, remove);
    elements.boostRows.append(row);
  });
}

function renderRewardRows() {
  const options = roleOptions();
  elements.rewardRows.replaceChildren();
  state.rewards.forEach((reward, index) => {
    const row = document.createElement('div');
    row.className = 'config-row reward-row';
    const level = rowInput('Level', reward.level);
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'picker-field';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = 'Reward role';
    const mount = document.createElement('div');
    pickerWrap.append(label, mount);
    const remove = document.createElement('button');
    remove.className = 'button small danger';
    remove.type = 'button';
    remove.textContent = 'Remove';
    renderPicker(mount, options, reward.roleId, {
      type: 'role',
      placeholder: 'Select role',
      onChange: (value) => {
        state.rewards[index].roleId = value;
        renderRewardRows();
      },
    });
    level.input.addEventListener('input', () => {
      state.rewards[index].level = Number(level.input.value);
      refreshDirtyState();
    });
    remove.addEventListener('click', () => {
      state.rewards.splice(index, 1);
      renderRewardRows();
      refreshDirtyState();
    });
    row.append(level.label, pickerWrap, remove);
    elements.rewardRows.append(row);
  });
}

function renderGag2StockPickers() {
  renderGag2StockPermissionGate();
  const locked = !gag2StockPermissionState().usable;
  const options = sendableChannelOptions();
  for (const [key, label, mountId] of GAG2_STOCK_CHANNELS) {
    const mount = elements.gag2StockMounts[mountId];
    if (!mount) continue;
    renderPicker(mount, options, state.gag2StockChannels[key] || '', {
      type: 'channel',
      placeholder: `Select ${label.toLowerCase()} channel`,
      onChange: (value) => {
        if (locked) return;
        state.gag2StockChannels[key] = value;
        renderGag2StockPickers();
        renderGag2FilterControls();
        renderPendingGag2RoleChange();
        renderGag2FallControls();
        refreshDirtyState();
      },
    });
  }
}

function normalizeGag2FilterSelection(value, allowed) {
  if (!Array.isArray(value)) return [...allowed];
  const selected = new Set(value.map((entry) => String(entry || '').toLowerCase()));
  return allowed.filter((entry) => selected.has(entry));
}

function normalizeGag2Filters(value = {}) {
  const rarities = {
    seed: normalizeGag2FilterSelection(value.rarities?.seed, GAG2_ROLE_RARITIES),
    gear: normalizeGag2FilterSelection(value.rarities?.gear, GAG2_ROLE_RARITIES),
    crate: normalizeGag2FilterSelection(value.rarities?.crate, GAG2_ROLE_RARITIES),
    sell: normalizeGag2FilterSelection(value.rarities?.sell, GAG2_SELL_RARITIES),
  };
  const roleItems = {};
  for (const type of ['seed', 'gear', 'crate']) {
    const allowed = GAG2_GARDEN_ITEMS[type].map((item) => item.key);
    roleItems[type] = Array.isArray(value.roleItems?.[type])
      ? normalizeGag2FilterSelection(value.roleItems[type], allowed)
      : GAG2_GARDEN_ITEMS[type]
        .filter((item) => rarities[type].includes(item.rarity))
        .map((item) => item.key);
  }
  return {
    rarities,
    roleItems,
    sellMultipliers: normalizeGag2FilterSelection(value.sellMultipliers, GAG2_SELL_MULTIPLIERS),
  };
}

function normalizeGag2FallConfig(value = {}) {
  const enabledTypes = Array.isArray(value.enabledTypes)
    ? normalizeGag2FilterSelection(value.enabledTypes, GAG2_FALL_TYPES)
    : [];
  const roleItems = {};
  for (const type of GAG2_FALL_TYPES) {
    roleItems[type] = Array.isArray(value.roleItems?.[type])
      ? normalizeGag2FilterSelection(value.roleItems[type], GAG2_FALL_ITEMS[type].map((item) => item.key))
      : [];
  }
  return { enabledTypes, roleItems };
}

function fallTypeLabel(type) {
  return type === 'sell' ? 'Sell-price' : `${type.charAt(0).toUpperCase()}${type.slice(1)}`;
}

function commitFallRoleItems(type, keys) {
  const allowed = GAG2_FALL_ITEMS[type].map((item) => item.key);
  state.gag2Fall.roleItems[type] = normalizeGag2FilterSelection(keys, allowed);
  renderPendingGag2RoleChange();
  refreshDirtyState();
}

function roleRarityOption(rarity) {
  return {
    id: rarity,
    label: GAG2_FALL_RARITY_LABELS[rarity] || `${rarity.charAt(0).toUpperCase()}${rarity.slice(1)}`,
    color: GAG2_RARITY_COLORS[rarity] || '#B0ADAC',
  };
}

function placeFallRoleMenu(button, menu) {
  const rect = button.getBoundingClientRect();
  const width = Math.min(Math.max(rect.width, 320), window.innerWidth - 24);
  const roomBelow = window.innerHeight - rect.bottom - 12;
  const safeTop = 84;
  const openBelow = roomBelow >= 180;
  const maxHeight = openBelow
    ? Math.min(520, roomBelow)
    : Math.min(520, Math.max(180, rect.top - safeTop - 6));
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  menu.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)}px`;
  menu.style.top = openBelow
    ? `${rect.bottom + 6}px`
    : `${Math.max(safeTop, rect.top - maxHeight - 6)}px`;
}

function renderItemRolePicker(mount, type, enabled, selected, options = {}) {
  const items = options.items || [];
  const commitItems = options.commitItems || (() => {});
  const theme = options.theme || 'fall';
  const picker = document.createElement('div');
  picker.className = `picker gag2-fall-picker gag2-${theme}-picker`;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `picker-button gag2-fall-picker-button gag2-${theme}-picker-button`;
  button.disabled = !enabled;
  button.title = enabled ? '' : options.disabledTitle || `Enable ${fallTypeLabel(type)} notifications first`;
  const selectedWrap = document.createElement('span');
  selectedWrap.className = 'selected-wrap';
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = 'v';
  button.append(selectedWrap, chevron);

  const menu = document.createElement('div');
  menu.className = `picker-menu gag2-fall-picker-menu gag2-${theme}-picker-menu`;
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'picker-search';
  search.placeholder = 'Search rarity or item';
  search.autocomplete = 'off';
  const optionList = document.createElement('div');
  optionList.className = 'option-list gag2-fall-option-list';
  menu.append(search, optionList);

  function selectedRarities() {
    return GAG2_FALL_RARITY_ORDER.filter((rarity) => items
      .some((item) => item.rarity === rarity && selected.has(item.key)));
  }

  function drawButton() {
    selectedWrap.replaceChildren();
    const rarities = selectedRarities();
    if (!rarities.length) {
      const placeholder = document.createElement('span');
      placeholder.className = 'placeholder';
      placeholder.textContent = 'No item roles selected';
      selectedWrap.append(placeholder);
      return;
    }
    rarities.slice(0, 5).forEach((rarity) => selectedWrap.append(makeToken(roleRarityOption(rarity), 'role')));
    if (rarities.length > 5) {
      const more = document.createElement('span');
      more.className = 'token';
      more.textContent = `+${rarities.length - 5}`;
      selectedWrap.append(more);
    }
  }

  function drawOptions() {
    const query = search.value.trim().toLowerCase();
    optionList.replaceChildren();
    for (const rarity of GAG2_FALL_RARITY_ORDER) {
      const rarityOption = roleRarityOption(rarity);
      const allItems = items.filter((item) => item.rarity === rarity);
      const items = allItems.filter((item) => !query
        || rarityOption.label.toLowerCase().includes(query)
        || item.name.toLowerCase().includes(query)
        || item.key.includes(query));
      if (!items.length) continue;

      const section = document.createElement('section');
      section.className = 'gag2-fall-rarity-option';
      section.style.setProperty('--rarity-color', rarityOption.color);
      const row = document.createElement('div');
      row.className = 'gag2-fall-rarity-row';
      const rarityLabel = document.createElement('label');
      rarityLabel.className = 'gag2-fall-rarity-toggle';
      const rarityInput = document.createElement('input');
      rarityInput.type = 'checkbox';
      rarityInput.disabled = !enabled;
      rarityInput.checked = allItems.every((item) => selected.has(item.key));
      rarityInput.indeterminate = !rarityInput.checked && allItems.some((item) => selected.has(item.key));
      rarityLabel.append(rarityInput, makeToken(rarityOption, 'role'));
      const selectedCount = allItems.filter((item) => selected.has(item.key)).length;
      const status = document.createElement('span');
      status.className = 'gag2-fall-rarity-status';
      status.textContent = selectedCount === allItems.length ? 'Selected' : `${selectedCount}/${allItems.length}`;
      row.append(rarityLabel, status);
      section.append(row);

      const itemList = document.createElement('div');
      itemList.className = 'gag2-fall-item-list';
      for (const item of items) {
        const label = document.createElement('label');
        label.className = 'gag2-fall-item';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.disabled = !enabled;
        input.checked = selected.has(item.key);
        const icon = document.createElement('img');
        icon.src = `https://cdn.discordapp.com/emojis/${item.emojiId}.png?size=32`;
        icon.alt = '';
        icon.width = 24;
        icon.height = 24;
        const name = document.createElement('span');
        name.textContent = item.name;
        label.append(input, icon, name);
        input.addEventListener('change', () => {
          if (input.checked) selected.add(item.key);
          else selected.delete(item.key);
          commitItems([...selected]);
          drawButton();
          drawOptions();
        });
        itemList.append(label);
      }
      rarityInput.addEventListener('change', () => {
        for (const item of allItems) {
          if (rarityInput.checked) selected.add(item.key);
          else selected.delete(item.key);
        }
        commitItems([...selected]);
        drawButton();
        drawOptions();
      });
      section.append(itemList);
      optionList.append(section);
    }
    if (!optionList.childElementCount) {
      const empty = document.createElement('div');
      empty.className = 'empty-option';
      empty.textContent = 'No results';
      optionList.append(empty);
    }
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    if (!enabled) return;
    const opening = !menu.classList.contains('open');
    document.querySelectorAll('.picker-menu.open').forEach((node) => node.classList.remove('open'));
    document.querySelectorAll('.picker-button.open').forEach((node) => node.classList.remove('open'));
    menu.classList.toggle('open', opening);
    button.classList.toggle('open', opening);
    if (opening) {
      drawOptions();
      placeFallRoleMenu(button, menu);
      search.focus();
    }
  });
  menu.addEventListener('click', (event) => event.stopPropagation());
  search.addEventListener('input', drawOptions);
  drawButton();
  picker.append(button, menu);
  mount.append(picker);
}

function renderFallRolePicker(mount, type, enabled, selected) {
  renderItemRolePicker(mount, type, enabled, selected, {
    items: GAG2_FALL_ITEMS[type],
    theme: 'fall',
    disabledTitle: `Enable Fall ${fallTypeLabel(type)} notifications first`,
    commitItems: (keys) => commitFallRoleItems(type, keys),
  });
}

function commitGardenRoleItems(type, keys) {
  const allowed = GAG2_GARDEN_ITEMS[type].map((item) => item.key);
  state.gag2StockFilters.roleItems[type] = normalizeGag2FilterSelection(keys, allowed);
  const selected = new Set(state.gag2StockFilters.roleItems[type]);
  state.gag2StockFilters.rarities[type] = GAG2_ROLE_RARITIES.filter((rarity) => GAG2_GARDEN_ITEMS[type]
    .some((item) => item.rarity === rarity && selected.has(item.key)));
  renderPendingGag2RoleChange();
  refreshDirtyState();
}

function renderGardenRolePicker(mount, type, enabled, selected) {
  renderItemRolePicker(mount, type, enabled, selected, {
    items: GAG2_GARDEN_ITEMS[type],
    theme: 'garden',
    disabledTitle: `Select a ${type} stock channel first`,
    commitItems: (keys) => commitGardenRoleItems(type, keys),
  });
}

function renderGag2FallControls() {
  const locked = !gag2StockPermissionState().usable;
  const enabledTypes = new Set(state.gag2Fall.enabledTypes);
  for (const input of elements.gag2FallTypeInputs) {
    const type = input.value;
    const gardenValleyEnabled = Boolean(state.gag2StockChannels[type]);
    input.disabled = locked || !gardenValleyEnabled;
    input.checked = gardenValleyEnabled && enabledTypes.has(type);
    input.closest('.gag2-fall-type')?.classList.toggle('is-disabled', input.disabled);
    input.title = gardenValleyEnabled ? '' : `Select a ${fallTypeLabel(type).toLowerCase()} Garden Valley channel first`;
  }

  const mount = elements.gag2FallRoleSettingsMount;
  if (!mount) return;
  mount.replaceChildren();
  for (const type of GAG2_FALL_TYPES.filter((entry) => entry !== 'sell')) {
    const enabled = !locked && Boolean(state.gag2StockChannels[type]) && enabledTypes.has(type);
    const selected = new Set(state.gag2Fall.roleItems[type]);
    const card = document.createElement('article');
    card.className = 'gag2-fall-role-category';
    card.classList.toggle('is-disabled', !enabled);

    const heading = document.createElement('div');
    heading.className = 'gag2-fall-role-category-heading';
    const title = document.createElement('strong');
    title.textContent = `${fallTypeLabel(type)} item roles`;
    const status = document.createElement('span');
    status.textContent = enabled
      ? `${selected.size} selected`
      : `Enable Fall ${fallTypeLabel(type)} notifications first`;
    heading.append(title, status);
    card.append(heading);
    const pickerMount = document.createElement('div');
    pickerMount.className = 'gag2-fall-picker-mount';
    renderFallRolePicker(pickerMount, type, enabled, selected);
    card.append(pickerMount);
    mount.append(card);
  }
}

function rarityFilterOptions(rarities) {
  return rarities.map((rarity) => ({
    id: rarity,
    label: rarity.charAt(0).toUpperCase() + rarity.slice(1),
    color: GAG2_RARITY_COLORS[rarity],
    optionType: 'role',
  }));
}

function renderGag2FilterControls() {
  for (const type of ['seed', 'gear', 'crate', 'sell']) {
    const mount = elements.gag2RarityMounts[type];
    if (!mount) continue;
    const allowed = type === 'sell' ? GAG2_SELL_RARITIES : GAG2_ROLE_RARITIES;
    const enabled = Boolean(state.gag2StockChannels[type]);
    const channelLabel = type === 'sell' ? 'sell price track' : `${type} stock`;
    mount.closest('.picker-field')?.classList.toggle('is-disabled', !enabled);
    if (type !== 'sell') {
      renderGardenRolePicker(mount, type, enabled, new Set(state.gag2StockFilters.roleItems[type]));
      continue;
    }
    renderPicker(mount, rarityFilterOptions(allowed), state.gag2StockFilters.rarities[type], {
      multiple: true,
      type: 'role',
      pickerClass: 'gag2-rarity-picker',
      menuClass: 'gag2-rarity-picker-menu',
      optionStyle: 'rarity',
      searchPlaceholder: 'Search rarity',
      placeholder: 'No rarities selected',
      disabled: !enabled,
      disabledReason: enabled ? '' : `Select a ${channelLabel} channel first`,
      onChange: (value) => {
        state.gag2StockFilters.rarities[type] = normalizeGag2FilterSelection(value, allowed);
        refreshDirtyState();
      },
    });
  }
  const selectedMultipliers = new Set(state.gag2StockFilters.sellMultipliers);
  const sellFiltersEnabled = Boolean(state.gag2StockChannels.sell);
  for (const input of elements.gag2SellMultiplierInputs) {
    input.checked = selectedMultipliers.has(input.value);
    input.disabled = !sellFiltersEnabled;
  }
  elements.gag2SellMultiplierInputs[0]?.closest('.picker-field')?.classList.toggle('is-disabled', !sellFiltersEnabled);
}

function gag2RoleStatusElement() {
  let element = document.querySelector('#gag2RoleSyncStatus');
  if (element) return element;
  const heading = document.querySelector('[data-panel="gag2Stock"] .panel-heading');
  if (!heading) return null;
  element = document.createElement('p');
  element.id = 'gag2RoleSyncStatus';
  element.className = 'hint gag2-role-sync-status';
  element.hidden = true;
  heading.append(element);
  return element;
}

function roleCountLabel(count) {
  const amount = Math.max(0, Number(count) || 0);
  return `${amount} role${amount === 1 ? '' : 's'}`;
}

function setGag2RoleStatus(text, kind = '') {
  const element = gag2RoleStatusElement();
  if (!element) return;
  element.textContent = text || '';
  element.hidden = !text;
  element.dataset.kind = kind;
}

function renderPendingGag2RoleChange() {
  if (!state.savedConfig || state.saving) return;
  const saved = state.savedConfig?.gag2Stock?.channels || {};
  let adding = 0;
  let removing = 0;
  for (const [key] of GAG2_STOCK_CHANNELS) {
    const before = Boolean(saved[key]);
    const after = Boolean(state.gag2StockChannels[key]);
    if (!before && after) adding += GAG2_STOCK_ROLE_COUNTS[key] || 0;
    if (before && !after) removing += GAG2_STOCK_ROLE_COUNTS[key] || 0;
  }
  const parts = [];
  if (adding) parts.push(`Adding ${roleCountLabel(adding)}`);
  if (removing) parts.push(`Removing ${roleCountLabel(removing)}`);
  setGag2RoleStatus(parts.join(' / '), parts.length ? 'pending' : '');
}

function renderGag2RoleProgress(progress) {
  if (!progress || progress.status === 'idle') {
    renderPendingGag2RoleChange();
    return;
  }
  const action = progress.action === 'removing' ? 'Removing'
    : progress.action === 'adding' ? 'Adding'
      : 'Syncing';
  if (progress.status === 'running') {
    setGag2RoleStatus(`${action} ${roleCountLabel(progress.remaining)}`, 'running');
    return;
  }
  if (progress.status === 'error') {
    setGag2RoleStatus(progress.message || 'Role sync failed.', 'error');
    return;
  }
  if (progress.total > 0) {
    setGag2RoleStatus('Role sync complete.', 'ok');
    return;
  }
  setGag2RoleStatus('', '');
}

function setDashboardSyncLocked(locked) {
  state.syncLocked = Boolean(locked);
  document.body.classList.toggle('dashboard-sync-locked', state.syncLocked);
  if (elements.configForm) elements.configForm.inert = state.syncLocked;
  if (elements.tabList) elements.tabList.inert = state.syncLocked;
  elements.guildSelect.disabled = state.syncLocked || state.guilds.length === 0;
  elements.saveButton.disabled = state.syncLocked || state.saving;
  if (state.syncLocked) elements.resetTabButton.disabled = true;
  else refreshDirtyState();
}

function pollGag2RoleProgress(initialProgress = null) {
  if (state.gag2RoleProgressTimer) window.clearTimeout(state.gag2RoleProgressTimer);
  if (initialProgress) renderGag2RoleProgress(initialProgress);
  const running = initialProgress?.status === 'running';
  if (running) setDashboardSyncLocked(true);
  if (!state.guildId || !running) {
    if (state.syncLocked && !state.saving) {
      setDashboardSyncLocked(false);
      setStatus(initialProgress?.status === 'error' ? (initialProgress.message || 'Changes could not be fully applied.') : 'Changes applied.', initialProgress?.status === 'error' ? 'error' : 'ok');
    }
    return;
  }
  state.gag2RoleProgressTimer = window.setTimeout(async () => {
    try {
      const payload = await api(`/api/guilds/${state.guildId}/gag2-stock/setup-progress`);
      pollGag2RoleProgress(payload.progress);
    } catch (error) {
      setGag2RoleStatus(error.message, 'error');
      setDashboardSyncLocked(false);
      setStatus(error.message, 'error');
    }
  }, 1000);
}

function setDurationFields(config) {
  for (const key of ['turnTimeoutMs', 'punishmentMs', 'gameCooldownMs']) {
    setField(`wordChain.${key}`, secondsFromMs(config.wordChain?.[key]));
  }
  for (const key of ['minClaimMs', 'maxClaimMs', 'minDurationMs', 'maxDurationMs']) {
    setField(`giveaway.${key}`, secondsFromMs(config.giveaway?.[key]));
  }
}

function applyTabFromConfig(tabName, config) {
  if (tabName === 'leveling') {
    state.channelValues.levelUp = config.channels?.levelUp || '';
    state.xpGroups = groupXpRules(config.xp || {});
    state.boosts = (config.xp?.boosts || []).map((item) => ({ ...item }));
    state.rewards = (config.xp?.levelRoleRewards || []).map((item) => ({ ...item }));
    setField('xp.messageXpMin', config.xp?.messageXpMin);
    setField('xp.messageXpMax', config.xp?.messageXpMax);
    setField('xp.messageCooldownMs', secondsFromMs(config.xp?.messageCooldownMs));
    const levelUpMessage = config.xp?.levelUpMessage || {};
    for (const key of ['enabled', 'content', 'accentColor', 'thumbnailUrl', 'imageUrl']) {
      setField(`xp.levelUpMessage.${key}`, levelUpMessage[key]);
    }
    renderXpChannelRows();
    renderBoostRows();
    renderRewardRows();
    renderLevelUpChannelPicker();
    renderLevelUpPreview();
  } else if (tabName === 'channels') {
    for (const [key, value] of Object.entries(config.channels || {})) {
      if (key !== 'levelUp') state.channelValues[key] = value;
    }
    renderObjectPickers(
      elements.channelsGrid,
      'channels',
      state.channelValues,
      channelOptions(),
      'channel',
      ['levelUp', 'ticketPanel', 'ticketCategory', 'transcript'],
    );
  } else if (tabName === 'roles') {
    state.roleValues = { ...(config.roles || {}) };
    renderObjectPickers(elements.rolesGrid, 'roles', state.roleValues, roleOptions(), 'role');
  } else if (tabName === 'tickets') {
    ensureTicketEditor().load(config.tickets, config.channels);
  } else if (tabName === 'invites') {
    setField('inviteRewards.enabled', config.inviteRewards?.enabled);
    setField('inviteRewards.capMembers', config.inviteRewards?.capMembers);
  } else if (tabName === 'gag2Stock') {
    state.gag2StockChannels = { ...(config.gag2Stock?.channels || {}) };
    state.gag2StockFilters = normalizeGag2Filters(config.gag2Stock?.filters || {});
    state.gag2Fall = normalizeGag2FallConfig(config.gag2Stock?.fall || {});
    renderGag2StockPickers();
    renderGag2FilterControls();
    renderGag2FallControls();
  } else if (tabName === 'games') {
    for (const key of ['minWordLength', 'maxWordLength', 'startingHearts']) {
      setField(`wordChain.${key}`, config.wordChain?.[key]);
    }
    for (const key of ['repeatedWordAction', 'wrongStartAction', 'xpRewardFormula']) {
      setField(`wordChain.${key}`, config.wordChain?.[key]);
    }
    setDurationFields(config);
  }
}

function collectTabState(tabName) {
  if (tabName === 'data') return null;
  if (tabName === 'leveling') {
    return {
      messageXpMin: Number(getField('xp.messageXpMin')),
      messageXpMax: Number(getField('xp.messageXpMax')),
      messageCooldownSeconds: Number(getField('xp.messageCooldownMs')),
      levelUpChannel: state.channelValues.levelUp || '',
      groups: state.xpGroups.map((group) => ({
        channelIds: [...group.channelIds],
        minXp: Number(group.minXp),
        maxXp: Number(group.maxXp),
        cooldownSeconds: Number(group.cooldownSeconds),
      })),
      boosts: clone(state.boosts),
      rewards: clone(state.rewards),
      levelUpMessage: {
        enabled: Boolean(getField('xp.levelUpMessage.enabled')),
        content: String(getField('xp.levelUpMessage.content')).trim(),
        accentColor: String(getField('xp.levelUpMessage.accentColor')).trim(),
        thumbnailUrl: String(getField('xp.levelUpMessage.thumbnailUrl')).trim(),
        imageUrl: String(getField('xp.levelUpMessage.imageUrl')).trim(),
      },
    };
  }
  if (tabName === 'channels') {
    return Object.fromEntries(Object.entries(state.channelValues).filter(
      ([key]) => !['levelUp', 'ticketPanel', 'ticketCategory', 'transcript'].includes(key),
    ));
  }
  if (tabName === 'roles') return clone(state.roleValues);
  if (tabName === 'tickets') return ensureTicketEditor().getValue();
  if (tabName === 'invites') {
    return {
      inviteEnabled: Boolean(getField('inviteRewards.enabled')),
      inviteCap: Number(getField('inviteRewards.capMembers')),
    };
  }
  if (tabName === 'gag2Stock') return {
    channels: clone(state.gag2StockChannels),
    filters: clone(state.gag2StockFilters),
    fall: clone(state.gag2Fall),
  };
  return {
    wordChain: {
      minWordLength: Number(getField('wordChain.minWordLength')),
      maxWordLength: Number(getField('wordChain.maxWordLength')),
      startingHearts: Number(getField('wordChain.startingHearts')),
      turnTimeoutSeconds: Number(getField('wordChain.turnTimeoutMs')),
      punishmentSeconds: Number(getField('wordChain.punishmentMs')),
      gameCooldownSeconds: Number(getField('wordChain.gameCooldownMs')),
      repeatedWordAction: getField('wordChain.repeatedWordAction'),
      wrongStartAction: getField('wordChain.wrongStartAction'),
      xpRewardFormula: String(getField('wordChain.xpRewardFormula')).trim(),
    },
    giveaway: {
      minClaimSeconds: Number(getField('giveaway.minClaimMs')),
      maxClaimSeconds: Number(getField('giveaway.maxClaimMs')),
      minDurationSeconds: Number(getField('giveaway.minDurationMs')),
      maxDurationSeconds: Number(getField('giveaway.maxDurationMs')),
    },
  };
}

function trackedTabNames() {
  return Object.keys(TAB_NAMES).filter((tabName) => !state.visibleTabs || state.visibleTabs.has(tabName));
}

function captureSavedSnapshots() {
  state.savedSnapshots = {};
  for (const tabName of trackedTabNames()) {
    state.savedSnapshots[tabName] = JSON.stringify(collectTabState(tabName));
  }
}

function refreshDirtyState() {
  state.dirtyTabs.clear();
  for (const tabName of trackedTabNames()) {
    if (JSON.stringify(collectTabState(tabName)) !== state.savedSnapshots[tabName]) state.dirtyTabs.add(tabName);
  }
  const hasChanges = state.dirtyTabs.size > 0;
  elements.unsavedBar.hidden = !hasChanges;
  elements.savedState.textContent = hasChanges ? `${state.dirtyTabs.size} section${state.dirtyTabs.size === 1 ? '' : 's'} changed` : 'All changes saved';
  elements.savedState.classList.toggle('dirty', hasChanges);
  document.body.classList.toggle('has-unsaved-changes', hasChanges);
  elements.resetTabButton.disabled = !state.dirtyTabs.has(state.activeTab);
  const dirtyNames = [...state.dirtyTabs].map((tabName) => TAB_NAMES[tabName]);
  elements.unsavedDetail.textContent = dirtyNames.length ? `Changed: ${dirtyNames.join(', ')}` : '';
}

function enforceFeatureVisibility() {
  const visibleTabs = state.visibleTabs;
  document.body.classList.toggle('gag2-stock-only', Boolean(visibleTabs));
  document.querySelectorAll('.tab').forEach((tab) => {
    const visible = !visibleTabs || visibleTabs.has(tab.dataset.tab);
    tab.hidden = !visible;
    tab.setAttribute('aria-hidden', visible ? 'false' : 'true');
    tab.style.display = visible ? '' : 'none';
    if (!visible) tab.tabIndex = -1;
    else {
      tab.removeAttribute('tabindex');
      tab.style.removeProperty('display');
    }
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    const visible = !visibleTabs || visibleTabs.has(panel.dataset.panel);
    panel.hidden = !visible;
    panel.style.display = visible ? '' : 'none';
    if (visible) panel.style.removeProperty('display');
    if (!visible) panel.classList.remove('active');
  });
  if (visibleTabs && !visibleTabs.has(state.activeTab)) {
    state.activeTab = 'gag2Stock';
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === state.activeTab));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === state.activeTab));
    elements.configForm.scrollTop = 0;
  }
}

function scheduleFeatureVisibilityEnforce() {
  if (state.featureVisibilityQueued) return;
  state.featureVisibilityQueued = true;
  const run = () => {
    state.featureVisibilityQueued = false;
    enforceFeatureVisibility();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else window.setTimeout(run, 0);
}

function applyFeatureVisibility(config) {
  const fullBot = config?.features?.fullBot === true;
  state.visibleTabs = fullBot ? null : new Set(['gag2Stock']);
  enforceFeatureVisibility();
  if (!state.featureVisibilityObserver && typeof MutationObserver === 'function') {
    state.featureVisibilityObserver = new MutationObserver(scheduleFeatureVisibilityEnforce);
    state.featureVisibilityObserver.observe(document.body, { childList: true, subtree: true });
  }
  elements.guildSubtitle.textContent = fullBot
    ? 'Changes apply to this Discord server only.'
    : 'This server currently has GAG2 stock access only. Other features are hidden until the bot owner enables them.';
}

function fillConfig(config) {
  state.savedConfig = clone(config);
  state.channelValues = { ...(config.channels || {}) };
  state.roleValues = { ...(config.roles || {}) };
  for (const tabName of Object.keys(TAB_NAMES)) applyTabFromConfig(tabName, config);
  applyFeatureVisibility(config);
  captureSavedSnapshots();
  refreshDirtyState();
  renderPendingGag2RoleChange();
}

function flattenXpGroups() {
  return state.xpGroups.flatMap((group) => group.channelIds.map((channelId) => ({
    channelId,
    minXp: Number(group.minXp),
    maxXp: Number(group.maxXp),
    cooldownMs: msFromSeconds(group.cooldownSeconds),
  })));
}

function collectPatch() {
  const ticketValue = ensureTicketEditor().getValue();
  return {
    channels: { ...state.channelValues, ...ticketValue.channels },
    roles: { ...state.roleValues },
    tickets: ticketValue.tickets,
    xp: {
      messageXpMin: Number(getField('xp.messageXpMin')),
      messageXpMax: Number(getField('xp.messageXpMax')),
      messageCooldownMs: msFromSeconds(getField('xp.messageCooldownMs')),
      channels: flattenXpGroups(),
      boosts: state.boosts.filter((item) => item.roleId && Number.isFinite(Number(item.xpPercent))),
      levelRoleRewards: state.rewards.filter((item) => item.roleId && Number.isFinite(Number(item.level))),
      levelUpMessage: {
        enabled: getField('xp.levelUpMessage.enabled'),
        content: String(getField('xp.levelUpMessage.content')).trim(),
        accentColor: String(getField('xp.levelUpMessage.accentColor')).trim(),
        thumbnailUrl: String(getField('xp.levelUpMessage.thumbnailUrl')).trim(),
        imageUrl: String(getField('xp.levelUpMessage.imageUrl')).trim(),
      },
    },
    inviteRewards: {
      enabled: getField('inviteRewards.enabled'),
      capMembers: Number(getField('inviteRewards.capMembers')),
    },
    gag2Stock: {
      channels: { ...state.gag2StockChannels },
      filters: clone(state.gag2StockFilters),
      fall: clone(state.gag2Fall),
    },
    wordChain: {
      minWordLength: Number(getField('wordChain.minWordLength')),
      maxWordLength: Number(getField('wordChain.maxWordLength')),
      startingHearts: Number(getField('wordChain.startingHearts')),
      turnTimeoutMs: msFromSeconds(getField('wordChain.turnTimeoutMs')),
      punishmentMs: msFromSeconds(getField('wordChain.punishmentMs')),
      gameCooldownMs: msFromSeconds(getField('wordChain.gameCooldownMs')),
      repeatedWordAction: getField('wordChain.repeatedWordAction'),
      wrongStartAction: getField('wordChain.wrongStartAction'),
      xpRewardFormula: String(getField('wordChain.xpRewardFormula')).trim(),
    },
    giveaway: {
      minClaimMs: msFromSeconds(getField('giveaway.minClaimMs')),
      maxClaimMs: msFromSeconds(getField('giveaway.maxClaimMs')),
      minDurationMs: msFromSeconds(getField('giveaway.minDurationMs')),
      maxDurationMs: msFromSeconds(getField('giveaway.maxDurationMs')),
    },
  };
}

function showAppModal(options) {
  const title = options.title, message = options.message, mode = options.mode || 'alert', defaultValue = options.defaultValue || '';
  document.querySelector('#appGlobalModalBackdrop')?.remove();
  return new Promise((resolve) => {
    const backdrop = document.createElement('div'); backdrop.id = 'appGlobalModalBackdrop'; backdrop.className = 'app-modal-backdrop';
    const form = document.createElement('form'); form.className = 'app-modal'; form.setAttribute('role', 'dialog'); form.setAttribute('aria-modal', 'true'); form.setAttribute('aria-labelledby', 'appGlobalModalTitle');
    const heading = document.createElement('h2'); heading.id = 'appGlobalModalTitle'; heading.textContent = title || 'CoinSprite';
    const copy = document.createElement('p'); copy.textContent = String(message || ''); form.append(heading, copy);
    let input = null;
    if (mode === 'prompt') { input = document.createElement('input'); input.value = String(defaultValue); input.setAttribute('aria-label', title || 'Value'); form.append(input); }
    const actions = document.createElement('div'); actions.className = 'app-modal-actions';
    if (mode !== 'alert') { const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'button'; cancel.dataset.modalValue = 'cancel'; cancel.textContent = 'Cancel'; actions.append(cancel); }
    const accept = document.createElement('button'); accept.type = 'submit'; accept.className = 'button ' + (mode === 'confirm' ? 'danger' : 'primary'); accept.textContent = mode === 'confirm' ? 'Continue' : 'OK'; actions.append(accept); form.append(actions); backdrop.append(form);
    const finish = (value) => { backdrop.remove(); resolve(value); };
    form.addEventListener('submit', (event) => { event.preventDefault(); finish(mode === 'prompt' ? input.value : true); });
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop || event.target.closest('[data-modal-value="cancel"]')) finish(mode === 'prompt' ? null : false); });
    backdrop.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish(mode === 'prompt' ? null : false); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...form.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')], first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
    document.body.append(backdrop); (input || form.querySelector('button'))?.focus();
  });
}

window.coinSpriteUi = {
  alert: (message, title = 'CoinSprite') => showAppModal({ title, message, mode: 'alert' }),
  confirm: (message, title = 'Confirm action') => showAppModal({ title, message, mode: 'confirm' }),
  prompt: (message, defaultValue = '', title = 'Enter a value') => showAppModal({ title, message, mode: 'prompt', defaultValue }),
};

function confirmDiscard(message) {
  return state.dirtyTabs.size === 0 ? Promise.resolve(true) : window.coinSpriteUi.confirm(message, 'Discard unsaved changes?');
}

async function loadGuild(guildId) {
  if (!guildId) return;
  if (state.dirtyTabs.size > 0 && guildId !== state.guildId) {
    elements.guildSelect.value = state.guildId;
    showUnsavedNavigationBlock();
    return;
  }
  state.guildId = guildId;
  const guild = state.guilds.find((item) => item.id === guildId);
  elements.guildTitle.textContent = guild ? guild.name : 'Server settings';
  elements.guildSubtitle.textContent = 'Changes apply to this Discord server only.';
  elements.serverMeta.textContent = guild ? `Guild ID ${guild.id}` : '';
  elements.editor.hidden = false;
  setStatus('Loading server data...');
    const [directoryPayload, configPayload, progressPayload] = await Promise.all([
      api(`/api/guilds/${guildId}/directory`),
      api(`/api/guilds/${guildId}/config`),
      api(`/api/guilds/${guildId}/gag2-stock/setup-progress`).catch(() => null),
    ]);
    state.directory = directoryPayload.directory || { channels: [], categories: [], roles: [] };
    state.gag2StockPermissions = state.directory.gag2StockPermissions || { usable: true, missing: [] };
    fillConfig(configPayload.config);
    if (progressPayload?.progress) pollGag2RoleProgress(progressPayload.progress);
    setStatus(`Loaded ${state.directory.channels.length} channels and threads.`, 'ok');
  }

function avatarUrl(user) {
  if (user?.avatar) return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  return 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function renderSession() {
  const user = state.me?.user;
  elements.loginButton.hidden = Boolean(user);
  elements.logoutButton.hidden = !user;
  elements.userChip.hidden = !user;
  elements.loginPanel.hidden = Boolean(user);
  elements.appShell.hidden = !user;
  elements.sessionLabel.textContent = user ? user.globalName || user.username : '';
  if (user) {
    elements.userAvatar.src = avatarUrl(user);
    elements.userAvatar.alt = `${user.globalName || user.username} avatar`;
  }

  elements.guildSelect.replaceChildren();
  if (!user || state.guilds.length === 0) {
    elements.guildSelect.disabled = true;
    elements.guildSelect.append(new Option('No editable servers', ''));
    elements.editor.hidden = true;
    return;
  }

  elements.guildSelect.disabled = false;
  for (const guild of state.guilds) elements.guildSelect.append(new Option(guild.name, guild.id));
}

function setActiveTab(tabName) {
  if (state.visibleTabs && !state.visibleTabs.has(tabName)) return false;
  if (state.dirtyTabs.size > 0 && tabName !== state.activeTab) {
    showUnsavedNavigationBlock();
    return false;
  }
  state.activeTab = tabName;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tabName));
  elements.resetTabButton.disabled = !state.dirtyTabs.has(tabName);
  elements.configForm.scrollTop = 0;
  return true;
}

function setActiveLevelingTab(tabName) {
  if (state.dirtyTabs.size > 0 && tabName !== state.activeLevelingTab) {
    showUnsavedNavigationBlock();
    return false;
  }
  state.activeLevelingTab = tabName;
  document.querySelectorAll('[data-leveling-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.levelingTab === tabName));
  document.querySelectorAll('[data-leveling-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.levelingPanel === tabName));
  elements.configForm.scrollTop = 0;
  if (tabName === 'message') renderLevelUpPreview();
  return true;
}

async function loadSession() {
  try {
    const payload = await api('/api/me');
    state.me = payload;
    state.guilds = payload.guilds || [];
    renderSession();
    if (state.guilds.length > 0) {
      await loadGuild(state.guilds[0].id);
    } else {
      setStatus('No configured server is editable by this Discord account.', 'error');
    }
  } catch (error) {
    state.me = null;
    state.guilds = [];
    renderSession();
    setStatus(error.message === 'Not logged in.' ? 'Log in with Discord to continue.' : error.message, error.message === 'Not logged in.' ? '' : 'error');
  }
}

function isTransientDataEvent(event) {
  return Boolean(event.target.closest?.('[data-panel="data"]'));
}

elements.configForm.addEventListener('input', (event) => {
  if (!isTransientDataEvent(event)) refreshDirtyState();
  if (event.target.name?.startsWith('xp.levelUpMessage.') || event.target === elements.levelUpPreviewLevel) renderLevelUpPreview();
});
elements.configForm.addEventListener('change', (event) => {
  if (!isTransientDataEvent(event)) refreshDirtyState();
  if (event.target.name?.startsWith('xp.levelUpMessage.') || event.target === elements.levelUpPreviewLevel) renderLevelUpPreview();
});

function showUnsavedNavigationBlock() {
  setStatus('Save changes or reset the current tab before navigating.', 'error');
  elements.unsavedBar?.classList.add('navigation-blocked');
  window.setTimeout(() => elements.unsavedBar?.classList.remove('navigation-blocked'), 480);
}

function unsavedNavigationTarget(target) {
  return target?.closest?.([
    '.tab',
    '.mini-tab',
    '.moderator-workspace-tab',
    '.message-section-tabs button',
    '.message-editor-tabs button',
    '[data-message-action="back"]',
    '.message-template-card',
  ].join(','));
}

document.addEventListener('click', (event) => {
  if (state.dirtyTabs.size === 0) return;
  const target = unsavedNavigationTarget(event.target);
  if (!target || target.classList.contains('active')) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showUnsavedNavigationBlock();
}, true);

document.addEventListener('keydown', (event) => {
  if (state.dirtyTabs.size === 0) return;
  const refreshKey = event.key === 'F5'
    || ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === 'r');
  if (!refreshKey) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showUnsavedNavigationBlock();
}, true);

elements.tabList.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (tab) setActiveTab(tab.dataset.tab);
});

elements.levelingTabList.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-leveling-tab]');
  if (tab) setActiveLevelingTab(tab.dataset.levelingTab);
});

elements.levelUpTokens.addEventListener('click', (event) => {
  const button = event.target.closest('[data-token]');
  if (!button) return;
  const active = document.activeElement;
  const target = active?.name?.startsWith('xp.levelUpMessage.') && ['text', 'url', 'textarea'].includes(active.type)
    ? active
    : elements.levelUpContent;
  const token = button.dataset.token;
  const start = Number.isFinite(target.selectionStart) ? target.selectionStart : target.value.length;
  const end = Number.isFinite(target.selectionEnd) ? target.selectionEnd : start;
  target.setRangeText(token, start, end, 'end');
  target.focus();
  target.dispatchEvent(new Event('input', { bubbles: true }));
});

elements.levelUpPreviewImage.addEventListener('error', () => {
  elements.levelUpPreviewImage.hidden = true;
});

elements.guildSelect.addEventListener('change', () => {
  if (state.dirtyTabs.size > 0 && elements.guildSelect.value !== state.guildId) {
    elements.guildSelect.value = state.guildId;
    showUnsavedNavigationBlock();
    return;
  }
  loadGuild(elements.guildSelect.value).catch((error) => setStatus(error.message, 'error'));
});

elements.gag2StockPermissionRefreshButton?.addEventListener('click', () => {
  refreshGag2StockPermissions();
});

for (const input of elements.gag2SellMultiplierInputs) {
  input.addEventListener('change', () => {
    const selected = new Set(state.gag2StockFilters.sellMultipliers);
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    state.gag2StockFilters.sellMultipliers = GAG2_SELL_MULTIPLIERS.filter((value) => selected.has(value));
    refreshDirtyState();
  });
}

for (const input of elements.gag2FallTypeInputs) {
  input.addEventListener('change', () => {
    if (input.disabled) return;
    const selected = new Set(state.gag2Fall.enabledTypes);
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    state.gag2Fall.enabledTypes = GAG2_FALL_TYPES.filter((type) => selected.has(type));
    renderGag2FallControls();
    renderPendingGag2RoleChange();
    refreshDirtyState();
  });
}

elements.logoutButton.addEventListener('click', async () => {
  if (state.dirtyTabs.size > 0) {
    showUnsavedNavigationBlock();
    return;
  }
  await api('/auth/logout', { method: 'POST' }).catch(() => null);
  window.location.href = '/admin';
});

elements.addXpChannelButton.addEventListener('click', () => {
  state.xpGroups.push({
    channelIds: [],
    minXp: Number(getField('xp.messageXpMin')) || 0,
    maxXp: Number(getField('xp.messageXpMax')) || 0,
    cooldownSeconds: Number(getField('xp.messageCooldownMs')) || 0,
  });
  renderXpChannelRows();
  refreshDirtyState();
});

elements.addBoostButton.addEventListener('click', () => {
  state.boosts.push({ roleId: '', xpPercent: 5 });
  renderBoostRows();
  refreshDirtyState();
});

elements.addRewardButton.addEventListener('click', () => {
  state.rewards.push({ level: 1, roleId: '' });
  renderRewardRows();
  refreshDirtyState();
});

elements.resetTabButton.addEventListener('click', () => {
  if (!state.savedConfig || !state.dirtyTabs.has(state.activeTab)) return;
  applyTabFromConfig(state.activeTab, state.savedConfig);
  refreshDirtyState();
  setStatus(`${TAB_NAMES[state.activeTab]} reset to the last saved values.`);
});

elements.saveButton.addEventListener('click', async () => {
  if (!state.guildId || state.dirtyTabs.size === 0 || state.saving) return;
  state.saving = true;
  setDashboardSyncLocked(true);
  elements.saveButton.textContent = 'Saving...';
  setStatus('Saving changes...');
  let waitingForSync = false;
  try {
    const payload = await api(`/api/guilds/${state.guildId}/config`, {
      method: 'PATCH',
      body: JSON.stringify(collectPatch()),
    });
    fillConfig(payload.config);
    waitingForSync = payload.roleProgress?.status === 'running';
    if (payload.roleProgress) pollGag2RoleProgress(payload.roleProgress);
    if (waitingForSync) setStatus('Applying changes...', '');
    else setStatus('Changes applied.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    state.saving = false;
    elements.saveButton.textContent = 'Save changes';
    if (!waitingForSync) setDashboardSyncLocked(false);
  }
});

window.addEventListener('beforeunload', (event) => {
  if (state.dirtyTabs.size === 0) return;
  event.preventDefault();
  event.returnValue = '';
});

setActiveTab('leveling');
setActiveLevelingTab('xp');
loadSession();

(() => {
  const pickerMenus = new Set();
  const requestIds = new Set();
  const REQUEST_ACTIONS = [
    ['accept', 'Accept request'],
    ['deny', 'Deny request'],
    ['dm_message', 'DM message'],
    ['role_add', 'Role add'],
    ['blacklist', 'Blacklist author'],
  ];
  const REQUEST_ACTION_TEXT = new Map([
    ['accept', 'accept'], ['accept request', 'accept'], ['close', 'accept'], ['close ticket', 'accept'],
    ['deny', 'deny'], ['deny request', 'deny'], ['delete', 'deny'], ['delete channel', 'deny'],
    ['dm', 'dm_message'], ['dm message', 'dm_message'], ['transcript', 'dm_message'], ['save transcript', 'dm_message'],
    ['role_add', 'role_add'], ['role add', 'role_add'], ['role-add', 'role_add'], ['move_to', 'role_add'], ['move to ticket type', 'role_add'],
    ['blacklist', 'blacklist'], ['blacklist author', 'blacklist'], ['blacklist user', 'blacklist'],
  ]);
  const REQUEST_SAVE_ACTIONS = {
    accept: 'close',
    deny: 'delete',
    dm_message: 'transcript',
    dm: 'transcript',
    role_add: 'move_to',
    'role-add': 'move_to',
    blacklist: 'blacklist',
    close: 'close',
    delete: 'delete',
    transcript: 'transcript',
    move_to: 'move_to',
  };
  let allowNativeAdd = false;
  let pendingRequest = false;
  let uiFixScheduled = false;

  function installInlineSurfaceTextPatch() {
    if (HTMLElement.prototype.__coinSpriteInlineTextPatch) return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
    if (!descriptor?.get || !descriptor?.set) return;
    Object.defineProperty(HTMLElement.prototype, 'innerText', {
      configurable: true,
      enumerable: descriptor.enumerable,
      get() {
        if (this.classList?.contains('message-inline-surface')) {
          const lines = [...this.children]
            .filter((child) => child.classList?.contains('message-inline-line'))
            .map((line) => String(line.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' '));
          if (lines.length) return lines.join('\n').replace(/\n+$/g, '');
        }
        return descriptor.get.call(this);
      },
      set(value) {
        descriptor.set.call(this, value);
      },
    });
    HTMLElement.prototype.__coinSpriteInlineTextPatch = true;
  }

  function cleanTabIcons() {
    document.querySelectorAll('.tab-image-icon, .message-tab-icon').forEach((image) => image.remove());
    const sources = {
      leveling: '/images/leveling.png',
      data: '/images/data.png',
      tickets: '/images/ticket.png',
      moderator: '/images/moderator.png',
      messages: '/images/message.png',
    };
    Object.entries(sources).forEach(([tab, source]) => {
      const button = document.querySelector(`.tab[data-tab="${tab}"]`);
      if (!button) return;
      let image = button.querySelector('.tab-icon');
      if (!image) {
        image = document.createElement('img');
        image.className = 'tab-icon';
        image.alt = '';
        image.setAttribute('aria-hidden', 'true');
        button.prepend(image);
      }
      if (image.getAttribute('src') !== source) image.src = source;
    });
  }

  function closePickerMenus(except = null) {
    pickerMenus.forEach((menu) => menu.classList.toggle('open', menu === except));
    document.querySelectorAll('.picker-button.open').forEach((button) => {
      button.classList.toggle('open', Boolean(except && button.dataset.menuId === except.dataset.menuId));
    });
  }

  function placeMenu(button, menu) {
    const rect = button.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 280), window.innerWidth - 24);
    const roomBelow = window.innerHeight - rect.bottom - 12;
    const top = roomBelow >= 220 ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(420, window.innerHeight - 24) - 6);
    menu.style.width = `${width}px`;
    menu.style.left = `${Math.min(Math.max(12, rect.left), window.innerWidth - width - 12)}px`;
    menu.style.top = `${top}px`;
  }

  renderPicker = function fixedPicker(mount, options, selectedValue, settings) {
    const {
      multiple = false,
      type = 'channel',
      placeholder = 'Select',
      disabled = false,
      disabledReason = '',
      pickerClass = '',
      menuClass = '',
      optionStyle = '',
      searchPlaceholder = 'Search by name or ID',
      onChange,
    } = settings;
    const selected = new Set(multiple ? selectedValue || [] : selectedValue ? [selectedValue] : []);
    if (mount._pickerMenu) {
      pickerMenus.delete(mount._pickerMenu);
      mount._pickerMenu.remove();
    }
    mount.replaceChildren();
    const picker = document.createElement('div');
    picker.className = `picker ${pickerClass}`.trim();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-button';
    button.disabled = disabled;
    button.setAttribute('aria-disabled', String(disabled));
    if (disabledReason) button.title = disabledReason;
    picker.classList.toggle('is-disabled', disabled);
    button.dataset.menuId = `picker-${Math.random().toString(36).slice(2)}`;
    const selectedWrap = document.createElement('span');
    selectedWrap.className = 'selected-wrap';

    function drawButton() {
      selectedWrap.replaceChildren();
      const selectedOptions = [...selected].map((id) => optionById(options, id, type));
      if (!selectedOptions.length) {
        const empty = document.createElement('span');
        empty.className = 'placeholder';
        empty.textContent = placeholder;
        selectedWrap.append(empty);
        return;
      }
      selectedOptions.slice(0, multiple ? 5 : 1).forEach((option) => selectedWrap.append(makeToken(option, type)));
      if (selectedOptions.length > 5) {
        const more = document.createElement('span');
        more.className = 'token';
        more.textContent = `+${selectedOptions.length - 5}`;
        selectedWrap.append(more);
      }
    }

    drawButton();
    const chevron = document.createElement('span');
    chevron.className = 'chevron';
    chevron.textContent = 'v';
    button.append(selectedWrap, chevron);
    const menu = document.createElement('div');
    menu.className = `picker-menu picker-portal-menu ${menuClass}`.trim();
    menu.dataset.menuId = button.dataset.menuId;
    const search = document.createElement('input');
    search.className = 'picker-search';
    search.placeholder = searchPlaceholder;
    search.autocomplete = 'off';
    const list = document.createElement('div');
    list.className = 'option-list';
    menu.append(search, list);

    function draw() {
      const query = search.value.trim().toLowerCase();
      const filtered = options.filter((option) => !query || (option.searchText || `${option.label} ${option.id}`.toLowerCase()).includes(query));
      list.replaceChildren();
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'empty-option';
        empty.textContent = 'No results';
        list.append(empty);
        return;
      }
      filtered.forEach((option) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = `option ${type === 'role' ? 'role-option' : ''}${optionStyle === 'rarity' ? ' gag2-rarity-option' : ''}${selected.has(option.id) ? ' selected' : ''}`;
        if (type === 'role') row.style.setProperty('--role-color', option.color || '#99aab5');
        const main = document.createElement('span');
        main.className = 'option-main';
        main.append(makeToken(option, type));
        const check = document.createElement('span');
        check.className = 'check-mark';
        check.textContent = selected.has(option.id) ? 'Selected' : '';
        row.append(main, check);
        row.addEventListener('click', (event) => {
          event.stopPropagation();
          if (disabled) return;
          if (multiple) {
            if (selected.has(option.id)) selected.delete(option.id); else selected.add(option.id);
            onChange([...selected]);
            drawButton();
            draw();
          } else {
            onChange(selected.has(option.id) ? '' : option.id);
            closePickerMenus();
          }
          refreshDirtyState();
        });
        list.append(row);
      });
    }
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      if (disabled) return;
      const opening = !menu.classList.contains('open');
      closePickerMenus(opening ? menu : null);
      if (opening) {
        draw();
        placeMenu(button, menu);
        search.focus();
      }
    });
    menu.addEventListener('click', (event) => event.stopPropagation());
    search.addEventListener('input', draw);
    picker.append(button);
    mount.append(picker);
    document.body.append(menu);
    pickerMenus.add(menu);
    mount._pickerMenu = menu;
  };

  function wordChainOptions() {
    return channelOptions().filter((option) => !['category', 'voice', 'forum'].includes(option.optionType));
  }

  function ensureLevelUpOutsideField() {
    const content = document.querySelector('#levelUpContent');
    if (!content) return null;
    let field = document.querySelector('#levelUpOutsideContent');
    if (!field) {
      field = document.createElement('textarea');
      field.id = 'levelUpOutsideContent';
      field.name = 'xp.levelUpMessage.outsideContent';
      field.hidden = true;
      field.className = 'message-source-hidden';
      content.after(field);
      field.addEventListener('input', renderLevelUpRootPreview);
      field.addEventListener('change', renderLevelUpRootPreview);
    }
    return field;
  }

  function levelUpRootHtml(value) {
    const context = typeof previewContext === 'function' ? previewContext() : {};
    const rendered = typeof renderPreviewTemplate === 'function'
      ? renderPreviewTemplate(value, context)
      : String(value || '');
    const clean = String(rendered || '').trim();
    if (!clean) return '';
    return typeof previewMarkdown === 'function'
      ? previewMarkdown(clean)
      : clean.replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  }

  function levelUpHasContainer() {
    const content = document.querySelector('#levelUpContent')?.value.trim() || '';
    const thumb = document.querySelector('[name="xp.levelUpMessage.thumbnailUrl"]')?.value.trim() || '';
    const image = document.querySelector('[name="xp.levelUpMessage.imageUrl"]')?.value.trim() || '';
    return Boolean(content || thumb || image);
  }

  function renderLevelUpRootPreview() {
    const field = ensureLevelUpOutsideField();
    const preview = document.querySelector('#levelUpPreview');
    const container = document.querySelector('#levelUpPreviewContainer');
    if (!field || !preview || !container) return;
    let root = document.querySelector('#levelUpRootContent');
    if (!root) {
      root = document.createElement('div');
      root.id = 'levelUpRootContent';
      container.before(root);
    }
    const html = levelUpRootHtml(field.value);
    root.className = `message-root-content${html ? '' : ' message-root-empty'}`;
    root.innerHTML = html || 'Add text outside the container';
    container.hidden = !levelUpHasContainer();
    let add = document.querySelector('#levelUpAddContainer');
    if (!add) {
      add = document.createElement('button');
      add.id = 'levelUpAddContainer';
      add.type = 'button';
      add.className = 'button subtle message-add-container';
      add.textContent = '+ Add container';
      preview.append(add);
    }
    add.hidden = levelUpHasContainer();
  }

  function startLevelUpRootEditor(root) {
    const field = ensureLevelUpOutsideField();
    if (!field || root.querySelector('[contenteditable="true"]')) return;
    const original = field.value || '';
    root.classList.add('message-inline-edit-host', 'is-inline-editing');
    const editor = document.createElement('div');
    editor.className = 'message-inline-surface';
    editor.contentEditable = 'true';
    editor.spellcheck = true;
    editor.textContent = original;
    root.replaceChildren(editor);
    const finish = (commit) => {
      field.value = commit ? String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/g, '') : original;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      root.classList.remove('message-inline-edit-host', 'is-inline-editing');
      renderLevelUpRootPreview();
      refreshDirtyState();
    };
    editor.addEventListener('input', () => {
      field.value = String(editor.innerText || editor.textContent || '').replace(/\r\n/g, '\n').replace(/\u00a0/g, ' ');
      refreshDirtyState();
    });
    editor.addEventListener('blur', () => finish(true), { once: true });
    editor.addEventListener('keydown', (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); editor.blur(); }
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
    });
    editor.focus({ preventScroll: true });
  }

  function setLevelUpContainerStarter() {
    const field = document.querySelector('#levelUpContent');
    if (!field) return;
    field.value = '## Container message\nWrite your container message here.';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    renderLevelUpRootPreview();
  }

  function ensureWordChainTools() {
    const gamesPanel = document.querySelector('[data-panel="games"] .panel');
    const grid = gamesPanel?.querySelector('.grid.three');
    if (!gamesPanel || !grid) return;
    let tools = gamesPanel.querySelector('.word-chain-tools');
    if (!tools) {
      tools = document.createElement('div');
      tools.className = 'word-chain-tools settings-grid';
      tools.innerHTML = '<div class="picker-field"><span class="field-label">Word chain game channel</span><div id="wordChainChannelMount"></div></div><div class="picker-field" id="wordChainRoleMount"><span class="field-label">Punishment role</span></div>';
      gamesPanel.insertBefore(tools, grid);
    }
    const channelMount = tools.querySelector('#wordChainChannelMount');
    if (channelMount && !channelMount.querySelector('.picker')) {
      renderPicker(channelMount, wordChainOptions(), state.channelValues.wordChain, {
        type: 'channel', placeholder: 'Select word chain channel',
        onChange: (value) => { state.channelValues.wordChain = value; ensureWordChainTools(); },
      });
    }
    const roleMount = tools.querySelector('#wordChainRoleMount');
    const roleField = [...document.querySelectorAll('#rolesGrid .picker-field')]
      .find((field) => field.querySelector('.field-label')?.textContent.trim() === 'Word Chain Punishment');
    if (roleMount && roleField) {
      const picker = roleField.querySelector('.picker');
      if (picker) roleMount.append(picker);
      roleField.remove();
    }
  }

  function isRequestType(type) {
    return Boolean(type && (String(type.id || '').startsWith('request-') || type.workflow === 'request_role_crew_member_plus'));
  }

  function requestActionValue(value) {
    return REQUEST_ACTION_TEXT.get(String(value || '').trim().toLowerCase()) || String(value || '').trim();
  }

  function requestActionLabel(value) {
    const normalized = requestActionValue(value);
    return REQUEST_ACTIONS.find(([action]) => action === normalized)?.[1] || value;
  }

  function requestActionSaveValue(value) {
    return REQUEST_SAVE_ACTIONS[requestActionValue(value)] || REQUEST_SAVE_ACTIONS[value] || value;
  }

  function showTicketKindDialog(nativeButton) {
    document.querySelector('.ticket-kind-dialog')?.remove();
    const backdrop = document.createElement('div');
    backdrop.className = 'ticket-modal-backdrop ticket-kind-dialog';
    backdrop.innerHTML = '<section class="ticket-modal ticket-kind-modal" role="dialog" aria-modal="true"><div class="ticket-modal-head"><div><h3>Create ticket type</h3><p>Choose how members submit this ticket.</p></div><button class="icon-button" type="button" data-kind="cancel">×</button></div><div class="ticket-kind-grid"><button type="button" data-kind="channel"><strong>Channel Ticket</strong><span>Create a private Discord channel for the member and staff.</span></button><button type="button" data-kind="request"><strong>Request Ticket</strong><span>Send a request card to staff for approval or denial.</span></button></div></section>';
    backdrop.addEventListener('click', (event) => {
      const kind = event.target.closest('[data-kind]')?.dataset.kind;
      if (!kind && event.target !== backdrop) return;
      backdrop.remove();
      if (!kind || kind === 'cancel') return;
      pendingRequest = kind === 'request';
      setTimeout(() => {
        if (!nativeButton.isConnected) return;
        allowNativeAdd = true;
        nativeButton.click();
        allowNativeAdd = false;
        requestAnimationFrame(decorateTicketEditor);
      }, 0);
    });
    document.body.append(backdrop);
  }

  function setText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
  }

  function controlActionsFromCard(card) {
    return [...card.querySelectorAll('.sequence-item strong')].map((node) => requestActionValue(node.textContent)).filter(Boolean);
  }

  function controlIndexFromCard(card) {
    return card.querySelector('[data-control-index]')?.dataset.controlIndex
      || card.querySelector('[data-index]')?.dataset.index
      || '0';
  }

  function dispatchInput(node) {
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function decorateRequestRoleField(card, actions) {
    const existing = card.querySelector('.request-role-add-field');
    const nativeMoveLabel = card.querySelector('select[data-control-field="moveToTicketTypeId"]')?.closest('label');
    if (!actions.includes('role_add')) {
      existing?.remove();
      if (nativeMoveLabel) nativeMoveLabel.hidden = false;
      return;
    }
    if (nativeMoveLabel) nativeMoveLabel.hidden = true;
    const controlIndex = controlIndexFromCard(card);
    let field = existing;
    if (!field) {
      field = document.createElement('label');
      field.className = 'request-role-add-field';
      field.innerHTML = '<span class="field-label">Role to add</span><input type="hidden" data-request-role-value><div data-request-role-picker></div><span class="request-action-note">This role is added to the request author when this control runs.</span>';
      card.querySelector('.action-sequence')?.append(field);
    }
    const hidden = field.querySelector('[data-request-role-value]');
    const nativeSelect = card.querySelector('select[data-control-field="moveToTicketTypeId"]');
    hidden.dataset.controlIndex = controlIndex;
    hidden.dataset.controlField = 'moveToTicketTypeId';
    if (!hidden.value && nativeSelect?.value) hidden.value = nativeSelect.value;
    const mount = field.querySelector('[data-request-role-picker]');
    if (mount && !mount.querySelector('.picker')) {
      renderPicker(mount, roleOptions(), hidden.value, {
        type: 'role',
        placeholder: 'Select role to add',
        onChange: (value) => {
          hidden.value = value;
          dispatchInput(hidden);
          refreshDirtyState();
        },
      });
    }
  }

  function decorateRequestDmField(card, actions) {
    const descriptionInput = card.querySelector('[data-control-field="description"]');
    const descriptionLabel = descriptionInput?.closest('label');
    const existing = card.querySelector('.request-dm-field');
    if (!actions.includes('dm_message')) {
      existing?.remove();
      if (descriptionLabel) descriptionLabel.firstChild.textContent = 'Description ';
      return;
    }
    if (descriptionLabel) {
      descriptionLabel.firstChild.textContent = 'DM message ';
      return;
    }
    const controlIndex = controlIndexFromCard(card);
    let field = existing;
    if (!field) {
      field = document.createElement('label');
      field.className = 'request-dm-field';
      field.innerHTML = '<span class="field-label">DM message</span><textarea rows="3" maxlength="100" data-request-dm-value placeholder="Your <ticket_name> request was reviewed."></textarea><span class="request-action-note">Use &lt;ticket_name&gt; and &lt;reason&gt; in this message.</span>';
      card.querySelector('.action-sequence')?.append(field);
    }
    const textarea = field.querySelector('[data-request-dm-value]');
    textarea.dataset.controlIndex = controlIndex;
    textarea.dataset.controlField = 'description';
  }

  function decorateRequestAdminPanel(root) {
    if (!root.dataset.requestEditor) return;
    root.querySelectorAll('.action-sequence').forEach((sequence) => {
      const hint = sequence.querySelector('.sequence-head span:last-child');
      setText(hint, 'Request actions run in the order shown.');
      const card = sequence.closest('.ticket-control-card');
      sequence.querySelectorAll('.sequence-item strong').forEach((label) => setText(label, requestActionLabel(label.textContent)));
      const actions = card ? controlActionsFromCard(card) : [];
      const select = sequence.querySelector('select[data-action-select]');
      if (select) {
        const signature = actions.join('|');
        if (select.dataset.requestOptionsSignature !== signature) {
          const available = REQUEST_ACTIONS.filter(([value]) => !actions.includes(value));
          const workflowOptions = [...select.options].filter((option) =>
            option.textContent.trim() === 'Condition' || String(option.value).startsWith('condition_'));
          select.replaceChildren(
            ...available.map(([value, label]) => new Option(label, value)),
            ...workflowOptions,
          );
          select.dataset.requestOptionsSignature = signature;
        }
      }
      if (card) {
        decorateRequestDmField(card, actions);
        decorateRequestRoleField(card, actions);
      }
    });
  }

  function decorateTicketEditor() {
    const root = document.querySelector('#ticketEditorRoot');
    if (!root) return;
    root.querySelectorAll('.ticket-type-card').forEach((card) => {
      const id = card.dataset.ticketId || '';
      if (id.startsWith('request-') || id === 'request_role_crew_member_plus') requestIds.add(id);
      const request = requestIds.has(id) || id === 'request_role_crew_member_plus';
      let badge = card.querySelector('.ticket-kind-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'ticket-kind-badge';
        card.querySelector('.ticket-type-copy')?.append(badge);
      }
      const className = `ticket-kind-badge ${request ? 'request' : 'channel'}`;
      if (badge.className !== className) badge.className = className;
      setText(badge, `Type: ${request ? 'Request' : 'Channel'}`);
    });
    if (pendingRequest && root.querySelector('.ticket-type-section')) {
      root.dataset.requestEditor = 'true';
      const heading = root.querySelector('.ticket-editor-head h3')?.textContent || '';
      root.dataset.pendingRequestName = heading;
      root.querySelectorAll('.ticket-type-tabs .mini-tab').forEach((tab) => {
        if (tab.textContent.trim() === 'Ticket message') setText(tab, 'Request message');
      });
      const settings = root.querySelector('.ticket-type-section');
      const category = [...settings.querySelectorAll('.picker-field')].find((field) => field.querySelector('.field-label')?.textContent.trim() === 'Category override');
      if (category && !category.hidden) category.hidden = true;
      settings.querySelector('.permission-buttons')?.setAttribute('hidden', '');
      const transcript = [...settings.querySelectorAll('.panel')].find((panel) => panel.querySelector('h3')?.textContent.trim() === 'Transcript' || panel.querySelector('h3')?.textContent.trim() === 'Request channel');
      if (transcript) {
        setText(transcript.querySelector('h3'), 'Request channel');
        setText(transcript.querySelector('.panel-heading p'), 'Choose where staff receive and review this request.');
        const checkline = transcript.querySelector('.checkline');
        if (checkline && !checkline.hidden) checkline.hidden = true;
        setText(transcript.querySelector('.field-label'), 'Request review channel');
      }
      const phase = root.querySelector('.form-phase-switch');
      if (phase) {
        phase.querySelectorAll('[data-value="close"]').forEach((button) => button.remove());
        setText(phase.querySelector('p'), 'Sent to the request author before the request is submitted.');
      }
    }
    decorateRequestAdminPanel(root);
  }

  function defaultRequestControls() {
    return [
      { id: 'accept', name: 'Accept', emoji: '✅', description: '', buttonStyle: 'success', url: '', actions: ['close'], moveToTicketTypeId: '' },
      { id: 'deny', name: 'Deny', emoji: '❌', description: '', buttonStyle: 'danger', url: '', actions: ['delete'], moveToTicketTypeId: '' },
      { id: 'dm-message', name: 'DM Message', emoji: '📩', description: 'Your <ticket_name> request was reviewed.', buttonStyle: 'secondary', url: '', actions: ['transcript'], moveToTicketTypeId: '' },
      { id: 'role-add', name: 'Role Add', emoji: '➕', description: '', buttonStyle: 'success', url: '', actions: ['move_to'], moveToTicketTypeId: '' },
      { id: 'blacklist', name: 'Blacklist', emoji: '🚫', description: '', buttonStyle: 'danger', url: '', actions: ['blacklist'], moveToTicketTypeId: '' },
    ];
  }

  function normalizeRequestControl(control, index) {
    const actions = [...new Set((control.actions || []).map(requestActionSaveValue).filter(Boolean))];
    if (!actions.length) actions.push(index === 0 ? 'close' : 'delete');
    if (control.dmMessage) control.description = control.dmMessage;
    if (control.roleId) control.moveToTicketTypeId = control.roleId;
    control.url = '';
    control.actions = actions;
    return control;
  }

  function normalizeRequestTypeForSave(type, index) {
    if (!String(type.id || '').startsWith('request-')) type.id = `request-${type.id || `ticket-${index + 1}`}`.slice(0, 40);
    requestIds.add(type.id);
    type.transcriptEnabled = true;
    type.authorPermissions = ['UseApplicationCommands'];
    const controls = type.adminPanel?.controls || [];
    if (!controls.length || (controls.length === 1 && controls[0].name === 'Close Ticket')) {
      type.adminPanel = { enabled: true, style: 'buttons', controls: defaultRequestControls() };
    } else {
      type.adminPanel = {
        ...(type.adminPanel || {}),
        enabled: type.adminPanel?.enabled !== false,
        controls: controls.map(normalizeRequestControl),
      };
    }
  }

  document.addEventListener('click', (event) => {
    const addContainer = event.target.closest('#levelUpAddContainer');
    if (addContainer) {
      event.preventDefault();
      setLevelUpContainerStarter();
      return;
    }
    const levelRoot = event.target.closest('#levelUpRootContent');
    if (levelRoot && !event.target.closest('button,input,select,textarea,a,[contenteditable="true"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startLevelUpRootEditor(levelRoot);
      return;
    }
    const add = event.target.closest('#ticketEditorRoot [data-action="add-ticket"]');
    if (add && !allowNativeAdd) {
      event.preventDefault();
      event.stopImmediatePropagation();
      showTicketKindDialog(add);
      return;
    }
    const card = event.target.closest('.ticket-type-card');
    if (card) pendingRequest = requestIds.has(card.dataset.ticketId) || card.dataset.ticketId === 'request_role_crew_member_plus';
    if (event.target.closest('[data-action="back-list"]')) pendingRequest = false;
  }, true);

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (/\/api\/guilds\/\d{16,20}\/config$/.test(url) && String(init.method || 'GET').toUpperCase() === 'PATCH' && init.body) {
      const body = JSON.parse(init.body);
      const outside = ensureLevelUpOutsideField();
      if (body.xp?.levelUpMessage && outside) body.xp.levelUpMessage.outsideContent = outside.value.trim();
      const types = body.tickets?.types || [];
      types.forEach((type, index) => {
        const marked = requestIds.has(type.id) || isRequestType(type) || (pendingRequest && index === types.length - 1);
        if (!marked || type.workflow === 'request_role_crew_member_plus') return;
        normalizeRequestTypeForSave(type, index);
      });
      init = { ...init, body: JSON.stringify(body) };
    }
    return nativeFetch(input, init);
  };

  const originalApply = applyTabFromConfig;
  applyTabFromConfig = function fixedApply(tabName, config) {
    originalApply(tabName, config);
    if (tabName === 'leveling') {
      const outside = ensureLevelUpOutsideField();
      if (outside) outside.value = config.xp?.levelUpMessage?.outsideContent || '';
      renderLevelUpRootPreview();
    }
    if (tabName === 'games') {
      state.channelValues.wordChain = config.channels?.wordChain || '';
      ensureWordChainTools();
    }
    if (tabName === 'roles') queueMicrotask(ensureWordChainTools);
    if (tabName === 'tickets') {
      (config.tickets?.types || []).filter(isRequestType).forEach((type) => requestIds.add(type.id));
      queueMicrotask(decorateTicketEditor);
    }
  };
  const originalCollect = collectTabState;
  collectTabState = function fixedCollect(tabName) {
    const value = originalCollect(tabName);
    if (tabName === 'leveling') return { ...value, outsideContent: ensureLevelUpOutsideField()?.value.trim() || '' };
    return tabName === 'games' ? { ...value, wordChainChannel: state.channelValues.wordChain || '', wordChainPunishmentRole: state.roleValues.wordChainPunishment || '' } : value;
  };
  const originalPatch = collectPatch;
  collectPatch = function fixedPatch() {
    const patch = originalPatch();
    patch.channels = { ...patch.channels, wordChain: state.channelValues.wordChain || '' };
    if (patch.xp?.levelUpMessage) patch.xp.levelUpMessage.outsideContent = ensureLevelUpOutsideField()?.value.trim() || '';
    return patch;
  };
  const originalLevelPreview = renderLevelUpPreview;
  renderLevelUpPreview = function fixedLevelPreview() {
    originalLevelPreview();
    renderLevelUpRootPreview();
  };
  const originalSetTab = setActiveTab;
  setActiveTab = function fixedSetTab(tabName) {
    originalSetTab(tabName);
    if (tabName === 'leveling') queueMicrotask(renderLevelUpRootPreview);
    if (tabName === 'games') queueMicrotask(ensureWordChainTools);
    if (tabName === 'tickets') queueMicrotask(decorateTicketEditor);
  };

  function scheduleUiFixes() {
    if (uiFixScheduled) return;
    uiFixScheduled = true;
    requestAnimationFrame(() => {
      uiFixScheduled = false;
      cleanTabIcons();
      renderLevelUpRootPreview();
      ensureWordChainTools();
      decorateTicketEditor();
    });
  }

  installInlineSurfaceTextPatch();
  new MutationObserver(scheduleUiFixes).observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => closePickerMenus());
  elements.configForm.addEventListener('scroll', () => closePickerMenus(), { passive: true });
  scheduleUiFixes();
})();

(function dashboardUpgrade() {
  const nativeFetch = window.fetch.bind(window);
  const state = {
    directory: { channels: [], categories: [] },
    xpIds: [], savedXpIds: [], gameChannel: '', savedGameChannel: '',
    gameEnabled: false, savedGameEnabled: false, dirty: false, reloaded: false,
  };
  const EMOJI_CATEGORIES = {
    recent: { icon: '☺', label: 'Frequently used', emojis: ['✅','❌','⚠️','🎫','🎟️','🔒','📩','📢','🔔','🎁','🏆','🔥','✨','👍','❤️'] },
    faces: { icon: '😀', label: 'Smileys and emotion', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🥸','🤩','🥳','😏','😒','😞','😔','😟','😕','🙁','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🫡','🤭','🫢','🤫','🤥','😶','😐','😑','😬','🙄','😯','😦','😧','😮','😲','🥱','😴','🤤','😪','😵','🤐','🤢','🤮','🤧','😷','🤒','🤕','😈','👿','💀','☠️','👻','👽','🤖','💩','😺','😸','😹','😻','😼','😽','🙀','😿','😾','❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝'] },
    people: { icon: '👋', label: 'People and body', emojis: ['👋','🤚','🖐️','✋','🖖','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦵','🦶','👂','👃','🧠','🫀','🫁','🦷','👀','👁️','👅','👄','🫦','👶','🧒','👦','👧','🧑','👱','👨','🧔','👩','🧓','👴','👵','🙍','🙎','🙅','🙆','💁','🙋','🧏','🙇','🤦','🤷','👮','👷','💂','🕵️','👩‍⚕️','👩‍🎓','👩‍🏫','👩‍⚖️','👩‍🌾','👩‍🍳','👩‍🔧','👩‍💻','👩‍🎤','👩‍🎨','👩‍✈️','👩‍🚀','👩‍🚒','🥷','🦸','🦹','🧙','🧚','🧛','🧜','🧝','🧞','🧟'] },
    nature: { icon: '🌿', label: 'Animals and nature', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐻‍❄️','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐒','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🪱','🐛','🦋','🐌','🐞','🐜','🪰','🪲','🪳','🕷️','🦂','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐠','🐟','🐡','🐬','🐳','🦈','🐊','🐅','🐆','🦓','🦍','🦧','🐘','🦛','🦏','🐪','🦒','🦘','🦬','🐃','🐂','🐄','🐎','🐖','🐏','🐐','🦌','🐕','🐈','🪶','🌵','🎄','🌲','🌳','🌴','🪴','🌱','🌿','☘️','🍀','🎍','🪹','🍄','🌾','💐','🌷','🌹','🥀','🌺','🌸','🌼','🌻','☀️','🌤️','⛅','🌧️','⛈️','🌈','❄️','☃️','💨','💧','🌊'] },
    food: { icon: '🍜', label: 'Food and drink', emojis: ['🍏','🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🫐','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🫑','🌽','🥕','🫒','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🥫','🍝','🍜','🍲','🍛','🍣','🍱','🥟','🦪','🍤','🍙','🍚','🍘','🍥','🥠','🥮','🍢','🍡','🍧','🍨','🍦','🥧','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷','🍸','🍹'] },
    activities: { icon: '🎮', label: 'Activities', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🏑','🥍','🏏','🪃','🥅','⛳','🪁','🏹','🎣','🤿','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🏋️','🤼','🤸','⛹️','🤺','🤾','🏌️','🏇','🧘','🏄','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🏵️','🎗️','🎫','🎟️','🎪','🤹','🎭','🩰','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🪗','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️','🧩'] },
    travel: { icon: '🚲', label: 'Travel and places', emojis: ['🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','🚐','🛻','🚚','🚛','🚜','🦯','🦽','🛴','🚲','🛵','🏍️','🛺','🚨','🚔','🚍','🚘','🚖','🚡','🚠','🚟','🚃','🚋','🚞','🚝','🚄','🚅','🚈','🚂','🚆','🚇','🚊','🚉','✈️','🛫','🛬','🛩️','💺','🛰️','🚀','🛸','🚁','🛶','⛵','🚤','🛥️','🛳️','⛴️','🚢','⚓','🛟','⛽','🚧','🚦','🗺️','🗿','🗽','🗼','🏰','🏯','🏟️','🎡','🎢','🎠','⛲','⛺','🌁','🌃','🏙️','🌄','🌅','🌆','🌇','🌉','♨️'] },
    objects: { icon: '🛠️', label: 'Objects', emojis: ['⌚','📱','📲','💻','⌨️','🖥️','🖨️','🖱️','🖲️','🕹️','🗜️','💽','💾','💿','📀','📼','📷','📸','📹','🎥','📽️','🎞️','📞','☎️','📟','📠','📺','📻','🎙️','🎚️','⏱️','⏲️','⏰','🕰️','⌛','⏳','📡','🔋','🪫','🔌','💡','🔦','🕯️','🧯','🛢️','💸','💵','💴','💶','💷','🪙','💰','💳','💎','⚖️','🪜','🧰','🪛','🔧','🔨','⚒️','🛠️','⛏️','🪚','🔩','⚙️','⛓️','🧲','🔫','💣','🧨','🪓','🔪','🗡️','🛡️','🔮','📿','💈','⚗️','🔭','🔬','🕳️','🩹','🩺','💊','💉','🩸','🚪','🪞','🪟','🛏️','🪑','🚿','🛁','🧹','🧺','🧻','🪣','🧼','🫧','🪥','🧽','🧯','🛒','🎁','🎈','🎀','🪄','🪅','🎊','🎉','✉️','📩','📨','📧','💌','📥','📤','📦','🏷️','📪','📫','📬','📭','📮','📜','📃','📄','📑','🧾','📊','📈','📉','🗒️','🗓️','📆','📅','🗑️','📇','🗃️','🗳️','🗄️','📋','📁','📂','🗂️','🗞️','📰','📓','📔','📒','📕','📗','📘','📙','📚','📖','🔖','🧷','🔗','📎','🖇️','📐','📏','📌','📍','✂️','🖊️','🖋️','✒️','🖌️','🖍️','📝','✏️','🔍','🔎','🔏','🔐','🔒','🔓'] },
    symbols: { icon: '♥', label: 'Symbols', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☪️','🕉️','☸️','✡️','🔯','🕎','☯️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','❗','❕','❓','❔','‼️','⁉️','🔅','🔆','〽️','⚠️','🚸','🔱','⚜️','🔰','♻️','✅','🈯','💹','❇️','✳️','❎','🌐','💠','Ⓜ️','🌀','💤','🏧','🚾','♿','🅿️','🛗','🚹','🚺','🚼','🚻','🚮','🎦','📶','🈁','🔣','ℹ️','🔤','🔡','🔠','🆖','🆗','🆙','🆒','🆕','🆓','0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟','#️⃣','*️⃣','⏏️','▶️','⏸️','⏯️','⏹️','⏺️','⏭️','⏮️','⏩','⏪','🔀','🔁','🔂','◀️','🔼','🔽','➡️','⬅️','⬆️','⬇️','↗️','↘️','↙️','↖️','↕️','↔️','↪️','↩️','⤴️','⤵️','🔃','🔄','🔙','🔚','🔛','🔜','🔝'] },
    flags: { icon: '🏳️', label: 'Flags', emojis: ['🏁','🚩','🎌','🏴','🏳️','🏳️‍🌈','🏳️‍⚧️','🏴‍☠️','🇺🇳','🇺🇸','🇨🇦','🇲🇽','🇧🇷','🇦🇷','🇬🇧','🇮🇪','🇫🇷','🇩🇪','🇪🇸','🇮🇹','🇵🇹','🇳🇱','🇧🇪','🇨🇭','🇦🇹','🇸🇪','🇳🇴','🇩🇰','🇫🇮','🇵🇱','🇺🇦','🇷🇺','🇹🇷','🇸🇦','🇦🇪','🇮🇳','🇵🇰','🇧🇩','🇱🇰','🇨🇳','🇭🇰','🇹🇼','🇯🇵','🇰🇷','🇸🇬','🇲🇾','🇹🇭','🇻🇳','🇵🇭','🇮🇩','🇦🇺','🇳🇿','🇿🇦','🇪🇬','🇳🇬','🇰🇪'] },
  };

  function splitXp(config) {
    const xp = config?.xp || {};
    const minXp = Number(xp.messageXpMin) || 0;
    const maxXp = Math.max(minXp, Number(xp.messageXpMax) || minXp);
    const cooldownMs = Math.max(0, Number(xp.messageCooldownMs) || 0);
    const normalize = (raw) => {
      const channelId = String(typeof raw === 'string' ? raw : raw?.channelId || raw?.id || '');
      return channelId ? { channelId, minXp: Number(raw?.minXp ?? minXp), maxXp: Number(raw?.maxXp ?? maxXp), cooldownMs: Number(raw?.cooldownMs ?? cooldownMs) } : null;
    };
    const overrides = Array.isArray(xp.channelOverrides) ? xp.channelOverrides.map(normalize).filter(Boolean) : (xp.channels || []).map((raw) => ({ raw, rule: normalize(raw) })).filter(({ raw, rule }) => rule && typeof raw !== 'string' && (rule.minXp !== minXp || rule.maxXp !== maxXp || rule.cooldownMs !== cooldownMs)).map(({ rule }) => rule);
    const overrideIds = new Set(overrides.map((rule) => rule.channelId));
    return { ids: [...new Set((xp.channels || []).map((raw) => normalize(raw)?.channelId).filter((id) => id && !overrideIds.has(id)))], overrides };
  }
  function responseWithJson(response, value) {
    const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
    return new Response(JSON.stringify(value), { status: response.status, statusText: response.statusText, headers });
  }
  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    const method = String(init.method || 'GET').toUpperCase();
    const configRequest = /\/api\/guilds\/\d{16,20}\/config$/.test(url);
    let options = init;
    if (configRequest && method === 'PATCH' && init.body) {
      const body = JSON.parse(init.body);
      const overrides = Array.isArray(body.xp?.channels) ? body.xp.channels : [];
      body.xp.channels = [...state.xpIds, ...overrides.filter((rule) => rule?.channelId && !state.xpIds.includes(String(rule.channelId)))];
      delete body.xp.channelOverrides;
      body.channels.wordChain = state.gameEnabled ? state.gameChannel : '';
      delete body.inviteRewards;
      options = { ...init, body: JSON.stringify(body) };
    }
    const response = await nativeFetch(input, options);
    if (!response.ok) return response;
    if (/\/directory$/.test(url)) {
      const payload = await response.json(); state.directory = payload.directory || state.directory; setTimeout(renderDashboard, 0); return responseWithJson(response, payload);
    }
    if (configRequest) {
      const payload = await response.json(); const split = splitXp(payload.config);
      state.xpIds = split.ids; state.savedXpIds = [...split.ids];
      state.gameChannel = String(payload.config?.channels?.wordChain || ''); state.savedGameChannel = state.gameChannel;
      state.gameEnabled = Boolean(payload.config?.wordChain?.enabled ?? state.gameChannel); state.savedGameEnabled = state.gameEnabled; state.dirty = false;
      payload.config.xp.channels = split.overrides; setTimeout(renderDashboard, 0); return responseWithJson(response, payload);
    }
    return response;
  };
  function syncDirty() {
    state.dirty = state.gameEnabled !== state.savedGameEnabled || state.gameChannel !== state.savedGameChannel || JSON.stringify([...state.xpIds].sort()) !== JSON.stringify([...state.savedXpIds].sort());
    if (!state.dirty) return;
    const bar = document.querySelector('#unsavedBar'); const save = document.querySelector('#saveButton'); const label = document.querySelector('#savedState');
    if (bar) bar.hidden = false; if (save) save.disabled = false; if (label) label.textContent = 'Unsaved changes';
  }
  function channelItems(mode) {
    return [...(state.directory.categories || []), ...(state.directory.channels || [])].filter((item) => mode === 'xp' ? item.kind !== 'voice' : ['text','announcement','thread'].includes(item.kind));
  }
  function badge(item) {
    const tag = document.createElement('span'); tag.className = `tag ${item.kind || 'text'}`;
    tag.textContent = item.kind === 'category' ? 'CAT' : item.kind === 'thread' ? 'THR' : item.kind === 'announcement' ? 'ANN' : item.kind === 'forum' ? 'FOR' : '#';
    return tag;
  }
  function token(item) {
    const chip = document.createElement('span'); chip.className = 'token'; chip.append(badge(item));
    const name = document.createElement('span'); name.textContent = `${item.parentName ? `${item.parentName} / ` : ''}${item.name}`; chip.append(name); return chip;
  }
  function picker(mode, multiple, current, change) {
    const options = channelItems(mode); const selected = new Set(current.filter(Boolean).map(String));
    const root = document.createElement('div'); root.className = 'picker';
    const button = document.createElement('button'); button.type = 'button'; button.className = 'picker-button';
    const selectedWrap = document.createElement('span'); selectedWrap.className = 'selected-wrap';
    const chevron = document.createElement('span'); chevron.className = 'chevron'; chevron.textContent = 'v';
    const menu = document.createElement('div'); menu.className = 'picker-menu';
    const search = document.createElement('input'); search.className = 'picker-search'; search.type = 'search'; search.placeholder = 'Search by name or ID'; search.autocomplete = 'off';
    const list = document.createElement('div'); list.className = 'option-list'; menu.append(search, list); button.append(selectedWrap, chevron); root.append(button, menu);
    const find = (id) => options.find((item) => item.id === id) || { id, name: id, kind: 'text', parentName: '' };
    function drawButton() {
      selectedWrap.replaceChildren(); const values = [...selected].map(find);
      if (!values.length) { const empty = document.createElement('span'); empty.className = 'placeholder'; empty.textContent = 'Select a channel'; selectedWrap.append(empty); return; }
      values.slice(0, multiple ? 5 : 1).forEach((item) => selectedWrap.append(token(item)));
      if (values.length > 5) { const more = document.createElement('span'); more.className = 'token'; more.textContent = `+${values.length - 5}`; selectedWrap.append(more); }
    }
    function drawList() {
      const query = search.value.trim().toLowerCase(); list.replaceChildren();
      const filtered = options.filter((item) => !query || `${item.name} ${item.id} ${item.parentName || ''}`.toLowerCase().includes(query));
      if (!filtered.length) { const empty = document.createElement('div'); empty.className = 'empty-option'; empty.textContent = 'No results'; list.append(empty); return; }
      filtered.forEach((item) => {
        const row = document.createElement('button'); row.type = 'button'; row.className = `option${selected.has(item.id) ? ' selected' : ''}`;
        const main = document.createElement('span'); main.className = 'option-main'; main.append(token(item));
        const check = document.createElement('span'); check.className = 'check-mark'; check.textContent = selected.has(item.id) ? 'Selected' : ''; row.append(main, check);
        row.onclick = (event) => { event.stopPropagation(); if (multiple) { if (selected.has(item.id)) selected.delete(item.id); else selected.add(item.id); } else { selected.clear(); selected.add(item.id); } change([...selected]); drawButton(); drawList(); if (!multiple) closeMenu(); setTimeout(syncDirty, 0); };
        list.append(row);
      });
    }
    function closeMenu() { menu.classList.remove('open'); button.classList.remove('open'); }
    button.onclick = (event) => { event.stopPropagation(); const open = !menu.classList.contains('open'); document.querySelectorAll('.picker-menu.open').forEach((node) => node.classList.remove('open')); document.querySelectorAll('.picker-button.open').forEach((node) => node.classList.remove('open')); menu.classList.toggle('open', open); button.classList.toggle('open', open); if (open) { drawList(); search.focus(); requestAnimationFrame(() => positionPicker(menu)); } };
    search.oninput = drawList; drawButton(); return root;
  }
  function positionPicker(menu) {
    const button = menu.closest('.picker')?.querySelector('.picker-button'); if (!button || !menu.classList.contains('open')) return;
    const rect = button.getBoundingClientRect(); const gap = 6; const pad = 12; const below = innerHeight - rect.bottom - pad - gap; const above = rect.top - pad - gap; const up = below < 220 && above > below;
    const width = Math.min(Math.max(rect.width, 320), innerWidth - pad * 2); const height = Math.min(420, Math.max(170, up ? above : below));
    menu.style.width = `${width}px`; menu.style.maxHeight = `${height}px`; menu.style.left = `${Math.min(Math.max(pad, rect.left), innerWidth - width - pad)}px`; menu.style.right = 'auto';
    if (up) { menu.style.top = 'auto'; menu.style.bottom = `${innerHeight - rect.top + gap}px`; } else { menu.style.top = `${rect.bottom + gap}px`; menu.style.bottom = 'auto'; }
  }
  function installTabIcon(tabName, filename, label) {
    const tab = document.querySelector(`.tab[data-tab="${tabName}"]`); if (!tab) return;
    tab.querySelector('.tab-image-icon')?.remove(); const image = document.createElement('img'); image.className = 'tab-image-icon'; image.src = `/CoinSprite/images/${filename}`; image.alt = ''; image.title = label; tab.prepend(image);
  }
  function renderDashboard() {
    document.querySelector('[data-tab="invites"]')?.remove(); document.querySelector('[data-panel="invites"]')?.remove();
    installTabIcon('leveling', 'leveling.png', 'Leveling'); installTabIcon('tickets', 'ticket.png', 'Tickets');
    const xpPanel = document.querySelector('[data-leveling-panel="xp"] .panel'); let xpMount = document.querySelector('#xpDefaultChannelsMount');
    if (xpPanel && !xpMount) { const field = document.createElement('div'); field.className = 'picker-field default-xp-destinations'; field.innerHTML = '<span class="field-label">XP channels</span><p>Only messages sent in these channels, categories, or forum threads earn the default XP values.</p><div id="xpDefaultChannelsMount"></div>'; xpPanel.querySelector('.grid')?.before(field); xpMount = field.querySelector('div'); }
    if (xpMount) xpMount.replaceChildren(picker('xp', true, state.xpIds, (ids) => { state.xpIds = ids; }));
    const empty = document.querySelector('#xpEmptyState'); if (empty) empty.textContent = 'No channel overrides. Add one only when a destination should use different XP values.';
    const gamePanel = document.querySelector('[data-panel="games"] .panel'); let controls = document.querySelector('.word-chain-controls');
    if (gamePanel && !controls) { controls = document.createElement('div'); controls.className = 'word-chain-controls'; controls.innerHTML = '<label class="switch-control"><input id="wordChainEnabled" type="checkbox"><span class="switch-track"><span class="switch-thumb"></span></span><span>Enabled</span></label><div class="picker-field"><span class="field-label">Game channel</span><div id="wordChainChannelMount"></div></div>'; gamePanel.querySelector('.panel-heading')?.after(controls); }
    const toggle = document.querySelector('#wordChainEnabled'); if (toggle) { toggle.checked = state.gameEnabled; toggle.onchange = (event) => { event.stopPropagation(); state.gameEnabled = toggle.checked; setTimeout(syncDirty, 0); }; }
    const gameMount = document.querySelector('#wordChainChannelMount'); if (gameMount) gameMount.replaceChildren(picker('game', false, [state.gameChannel], (ids) => { state.gameChannel = ids[0] || ''; }));
    document.querySelectorAll('#channelsGrid .picker-field').forEach((field) => { if (/word chain/i.test(field.textContent)) field.hidden = true; }); syncDirty();
  }
  function permissions(scope = document) {
    scope.querySelectorAll('.ticket-modal-head p').forEach((item) => item.remove());
    scope.querySelectorAll('.permission-item:not([data-upgraded])').forEach((item) => { const input = item.querySelector('input[data-permission]'); const title = item.querySelector('span')?.textContent?.trim(); if (!input || !title) return; item.dataset.upgraded = 'true'; const name = document.createElement('span'); name.className = 'permission-name'; name.textContent = title; const buttons = document.createElement('span'); buttons.className = 'permission-state'; buttons.innerHTML = '<button type="button" class="permission-deny" disabled>X</button><button type="button" class="permission-neutral">/</button><button type="button" class="permission-allow">✓</button>'; const refresh = () => { buttons.children[1].classList.toggle('active', !input.checked); buttons.children[2].classList.toggle('active', input.checked); }; buttons.children[1].onclick = () => { input.checked = false; input.dispatchEvent(new Event('input',{bubbles:true})); refresh(); }; buttons.children[2].onclick = () => { input.checked = true; input.dispatchEvent(new Event('input',{bubbles:true})); refresh(); }; item.replaceChildren(input, name, buttons); refresh(); });
  }
  function emoji(input) {
    if (input.dataset.emojiPicker) return; input.dataset.emojiPicker = 'true';
    const wrap = document.createElement('span'); wrap.className = 'emoji-field'; input.parentNode.insertBefore(wrap,input); wrap.append(input);
    const button = document.createElement('button'); button.type='button'; button.className='emoji-picker-button'; button.textContent='☺'; button.title='Choose emoji';
    const pop = document.createElement('span'); pop.className='emoji-popover'; const side = document.createElement('span'); side.className='emoji-categories';
    const browser = document.createElement('span'); browser.className='emoji-browser'; const search = document.createElement('input'); search.type='search'; search.placeholder='Search emoji'; const grid = document.createElement('span'); grid.className='emoji-grid'; browser.append(search,grid); pop.append(side,browser);
    let active = 'recent';
    function drawCategories() { side.replaceChildren(); Object.entries(EMOJI_CATEGORIES).forEach(([key, category]) => { const item=document.createElement('button'); item.type='button'; item.textContent=category.icon; item.title=category.label; item.classList.toggle('active',key===active); item.onclick=()=>{active=key; search.value=''; drawCategories(); draw();}; side.append(item); }); }
    function draw() { const q=search.value.trim().toLowerCase(); grid.replaceChildren(); const categories=q ? Object.values(EMOJI_CATEGORIES) : [EMOJI_CATEGORIES[active]]; [...new Set(categories.flatMap((category)=>category.emojis))].forEach((value)=>{ if(q && !value.includes(q) && !categories.some((category)=>category.label.toLowerCase().includes(q))) return; const option=document.createElement('button'); option.type='button'; option.textContent=value; option.onclick=()=>{input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); input.dispatchEvent(new Event('change',{bubbles:true})); pop.classList.remove('open');}; grid.append(option); }); }
    button.onclick=(event)=>{event.stopPropagation(); document.querySelectorAll('.emoji-popover.open').forEach((node)=>{if(node!==pop)node.classList.remove('open');}); pop.classList.toggle('open'); if(pop.classList.contains('open')){drawCategories();draw();positionEmoji(pop,button);search.focus();}}; search.oninput=draw; wrap.append(button,pop);
  }
  function positionEmoji(pop,button){const rect=button.getBoundingClientRect();const width=Math.min(430,innerWidth-24);const height=Math.min(470,innerHeight-24);pop.style.width=`${width}px`;pop.style.maxHeight=`${height}px`;pop.style.left=`${Math.min(Math.max(12,rect.right-width),innerWidth-width-12)}px`;if(innerHeight-rect.bottom<height&&rect.top>innerHeight-rect.bottom){pop.style.top='auto';pop.style.bottom=`${innerHeight-rect.top+6}px`;}else{pop.style.top=`${rect.bottom+6}px`;pop.style.bottom='auto';}}
  function upgradeDynamic(){permissions();document.querySelectorAll('input[data-ticket-field="emoji"],input[data-control-field="emoji"],input[data-option-field="emoji"]').forEach(emoji);}
  new MutationObserver(upgradeDynamic).observe(document.body,{childList:true,subtree:true});
  document.addEventListener('click',(event)=>{if(!event.target.closest('.picker')){document.querySelectorAll('.picker-menu.open').forEach((menu)=>menu.classList.remove('open'));document.querySelectorAll('.picker-button.open').forEach((node)=>node.classList.remove('open'));}if(!event.target.closest('.emoji-field'))document.querySelectorAll('.emoji-popover.open').forEach((pop)=>pop.classList.remove('open'));});
  document.addEventListener('scroll',()=>{document.querySelectorAll('.picker-menu.open').forEach(positionPicker);document.querySelectorAll('.emoji-popover.open').forEach((pop)=>positionEmoji(pop,pop.closest('.emoji-field').querySelector('.emoji-picker-button')));},true);
  window.addEventListener('resize',()=>{document.querySelectorAll('.picker-menu.open').forEach(positionPicker);document.querySelectorAll('.emoji-popover.open').forEach((pop)=>positionEmoji(pop,pop.closest('.emoji-field').querySelector('.emoji-picker-button')));});
  document.querySelector('#resetTabButton')?.addEventListener('click',()=>{if(!state.dirty)return;state.xpIds=[...state.savedXpIds];state.gameChannel=state.savedGameChannel;state.gameEnabled=state.savedGameEnabled;state.dirty=false;setTimeout(renderDashboard,0);},true);
  window.addEventListener('beforeunload',(event)=>{if(state.dirty){event.preventDefault();event.returnValue='';}});
  const timer=setInterval(()=>{const select=document.querySelector('#guildSelect');if(state.reloaded||!select?.value||select.disabled||document.querySelector('#editor')?.hidden)return;state.reloaded=true;select.dispatchEvent(new Event('change',{bubbles:true}));clearInterval(timer);},250);
  upgradeDynamic(); renderDashboard();
}());


;(() => {
  if (window.__coinSpriteFormFieldIdentity) return;
  window.__coinSpriteFormFieldIdentity = true;
  const selector = 'input:not([id]):not([name]),select:not([id]):not([name]),textarea:not([id]):not([name])';
  let sequence = 0;

  function identify(field) {
    if (!field?.matches?.(selector)) return;
    sequence += 1;
    const hint = [
      field.dataset?.ticketField,
      field.dataset?.controlField,
      field.dataset?.messageField,
      field.dataset?.workflowField,
      field.dataset?.conditionActionField,
      field.type,
      field.tagName,
    ].find(Boolean) || 'field';
    const cleanHint = String(hint).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'field';
    const identity = `coinsprite-${cleanHint}-${sequence}`;
    field.id = identity;
    field.name = identity;
  }

  function scan(root) {
    if (root?.matches?.(selector)) identify(root);
    root?.querySelectorAll?.(selector).forEach(identify);
  }

  new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) scan(node);
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
})();
