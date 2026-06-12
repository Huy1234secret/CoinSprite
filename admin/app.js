const TAB_NAMES = {
  leveling: 'Leveling',
  channels: 'Channels',
  roles: 'Roles',
  invites: 'Invite rewards',
  games: 'Games',
};

const state = {
  me: null,
  guilds: [],
  guildId: '',
  savedConfig: null,
  savedSnapshots: {},
  directory: { channels: [], categories: [], roles: [] },
  channelValues: {},
  roleValues: {},
  xpGroups: [],
  boosts: [],
  rewards: [],
  activeTab: 'leveling',
  activeLevelingTab: 'xp',
  dirtyTabs: new Set(),
  saving: false,
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
  levelUpChannelMount: document.querySelector('#levelUpChannelMount'),
  levelUpTokens: document.querySelector('#levelUpTokens'),
  levelUpContent: document.querySelector('#levelUpContent'),
  levelUpPreviewLevel: document.querySelector('#levelUpPreviewLevel'),
  levelUpPreviewContainer: document.querySelector('#levelUpPreviewContainer'),
  levelUpPreviewBody: document.querySelector('#levelUpPreviewBody'),
  levelUpPreviewImage: document.querySelector('#levelUpPreviewImage'),
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
  const { multiple = false, type = 'channel', placeholder = 'Select', onChange } = settings;
  const selected = multiple ? new Set(selectedValue || []) : new Set(selectedValue ? [selectedValue] : []);
  mount.replaceChildren();

  const picker = document.createElement('div');
  picker.className = 'picker';
  const button = document.createElement('button');
  button.className = 'picker-button';
  button.type = 'button';
  const selectedWrap = document.createElement('span');
  selectedWrap.className = 'selected-wrap';
  const selectedOptions = [...selected].map((id) => optionById(options, id, type));
  if (selectedOptions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'placeholder';
    empty.textContent = placeholder;
    selectedWrap.append(empty);
  } else {
    selectedOptions.slice(0, multiple ? 5 : 1).forEach((option) => selectedWrap.append(makeToken(option, type)));
    if (selectedOptions.length > 5) {
      const more = document.createElement('span');
      more.className = 'token';
      more.textContent = `+${selectedOptions.length - 5}`;
      selectedWrap.append(more);
    }
  }
  const chevron = document.createElement('span');
  chevron.className = 'chevron';
  chevron.textContent = 'v';
  button.append(selectedWrap, chevron);

  const menu = document.createElement('div');
  menu.className = 'picker-menu';
  const search = document.createElement('input');
  search.className = 'picker-search';
  search.placeholder = 'Search by name or ID';
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
      row.className = `option ${type === 'role' ? 'role-option' : ''}${selected.has(option.id) ? ' selected' : ''}`;
      if (type === 'role') row.style.setProperty('--role-color', option.color || '#99aab5');
      const main = document.createElement('span');
      main.className = 'option-main';
      main.append(makeToken(option, type));
      const check = document.createElement('span');
      check.className = 'check-mark';
      check.textContent = selected.has(option.id) ? 'Selected' : '';
      row.append(main, check);
      row.addEventListener('click', () => {
        if (multiple) {
          if (selected.has(option.id)) selected.delete(option.id);
          else selected.add(option.id);
          onChange([...selected]);
        } else {
          onChange(option.id);
        }
        refreshDirtyState();
      });
      optionList.append(row);
    }
  }

  button.addEventListener('click', () => {
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
  const escaped = String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/^## (.+)$/gm, '<strong class="preview-heading">$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return escaped.replace(/\n/g, '<br>');
}

function renderLevelUpPreview() {
  if (!elements.levelUpPreviewBody) return;
  const context = previewContext();
  const content = renderPreviewTemplate(getField('xp.levelUpMessage.content'), context);
  const thumbnailUrl = safePreviewMediaUrl(getField('xp.levelUpMessage.thumbnailUrl'), context);
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
  const imageUrl = safePreviewMediaUrl(getField('xp.levelUpMessage.imageUrl'), context);
  elements.levelUpPreviewImage.hidden = !imageUrl;
  if (imageUrl) elements.levelUpPreviewImage.src = imageUrl;
}

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
    renderObjectPickers(elements.channelsGrid, 'channels', state.channelValues, channelOptions(), 'channel', ['levelUp']);
  } else if (tabName === 'roles') {
    state.roleValues = { ...(config.roles || {}) };
    renderObjectPickers(elements.rolesGrid, 'roles', state.roleValues, roleOptions(), 'role');
  } else if (tabName === 'invites') {
    setField('inviteRewards.enabled', config.inviteRewards?.enabled);
    setField('inviteRewards.capMembers', config.inviteRewards?.capMembers);
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
    return Object.fromEntries(Object.entries(state.channelValues).filter(([key]) => key !== 'levelUp'));
  }
  if (tabName === 'roles') return clone(state.roleValues);
  if (tabName === 'invites') {
    return {
      inviteEnabled: Boolean(getField('inviteRewards.enabled')),
      inviteCap: Number(getField('inviteRewards.capMembers')),
    };
  }
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

function captureSavedSnapshots() {
  state.savedSnapshots = {};
  for (const tabName of Object.keys(TAB_NAMES)) {
    state.savedSnapshots[tabName] = JSON.stringify(collectTabState(tabName));
  }
}

function refreshDirtyState() {
  state.dirtyTabs.clear();
  for (const tabName of Object.keys(TAB_NAMES)) {
    if (JSON.stringify(collectTabState(tabName)) !== state.savedSnapshots[tabName]) state.dirtyTabs.add(tabName);
  }
  const hasChanges = state.dirtyTabs.size > 0;
  elements.unsavedBar.hidden = !hasChanges;
  elements.savedState.textContent = hasChanges ? `${state.dirtyTabs.size} section${state.dirtyTabs.size === 1 ? '' : 's'} changed` : 'All changes saved';
  elements.savedState.classList.toggle('dirty', hasChanges);
  elements.resetTabButton.disabled = !state.dirtyTabs.has(state.activeTab);
  const dirtyNames = [...state.dirtyTabs].map((tabName) => TAB_NAMES[tabName]);
  elements.unsavedDetail.textContent = dirtyNames.length ? `Changed: ${dirtyNames.join(', ')}` : '';
}

function fillConfig(config) {
  state.savedConfig = clone(config);
  state.channelValues = { ...(config.channels || {}) };
  state.roleValues = { ...(config.roles || {}) };
  for (const tabName of Object.keys(TAB_NAMES)) applyTabFromConfig(tabName, config);
  captureSavedSnapshots();
  refreshDirtyState();
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
  return {
    channels: { ...state.channelValues },
    roles: { ...state.roleValues },
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

function confirmDiscard(message) {
  return state.dirtyTabs.size === 0 || window.confirm(message);
}

async function loadGuild(guildId) {
  if (!guildId) return;
  if (!confirmDiscard('You have unsaved changes. Switch servers and discard them?')) {
    elements.guildSelect.value = state.guildId;
    return;
  }
  state.guildId = guildId;
  const guild = state.guilds.find((item) => item.id === guildId);
  elements.guildTitle.textContent = guild ? guild.name : 'Server settings';
  elements.guildSubtitle.textContent = 'Changes apply to this Discord server only.';
  elements.serverMeta.textContent = guild ? `Guild ID ${guild.id}` : '';
  elements.editor.hidden = false;
  setStatus('Loading server data...');
  const [directoryPayload, configPayload] = await Promise.all([
    api(`/api/guilds/${guildId}/directory`),
    api(`/api/guilds/${guildId}/config`),
  ]);
  state.directory = directoryPayload.directory || { channels: [], categories: [], roles: [] };
  fillConfig(configPayload.config);
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
  state.activeTab = tabName;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tabName));
  elements.resetTabButton.disabled = !state.dirtyTabs.has(tabName);
  elements.configForm.scrollTop = 0;
}

function setActiveLevelingTab(tabName) {
  state.activeLevelingTab = tabName;
  document.querySelectorAll('[data-leveling-tab]').forEach((tab) => tab.classList.toggle('active', tab.dataset.levelingTab === tabName));
  document.querySelectorAll('[data-leveling-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.levelingPanel === tabName));
  elements.configForm.scrollTop = 0;
  if (tabName === 'message') renderLevelUpPreview();
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

elements.configForm.addEventListener('input', (event) => {
  refreshDirtyState();
  if (event.target.name?.startsWith('xp.levelUpMessage.') || event.target === elements.levelUpPreviewLevel) renderLevelUpPreview();
});
elements.configForm.addEventListener('change', (event) => {
  refreshDirtyState();
  if (event.target.name?.startsWith('xp.levelUpMessage.') || event.target === elements.levelUpPreviewLevel) renderLevelUpPreview();
});

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
  loadGuild(elements.guildSelect.value).catch((error) => setStatus(error.message, 'error'));
});

elements.logoutButton.addEventListener('click', async () => {
  if (!confirmDiscard('You have unsaved changes. Log out and discard them?')) return;
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
  elements.saveButton.disabled = true;
  elements.saveButton.textContent = 'Saving...';
  setStatus('Saving changes...');
  try {
    const payload = await api(`/api/guilds/${state.guildId}/config`, {
      method: 'PATCH',
      body: JSON.stringify(collectPatch()),
    });
    fillConfig(payload.config);
    setStatus('Changes saved.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    state.saving = false;
    elements.saveButton.disabled = false;
    elements.saveButton.textContent = 'Save changes';
    refreshDirtyState();
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
