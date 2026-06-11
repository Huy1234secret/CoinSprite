const state = {
  me: null,
  guilds: [],
  guildId: '',
  config: null,
  directory: { channels: [], categories: [], roles: [] },
  channelValues: {},
  roleValues: {},
  xpChannels: [],
  boosts: [],
  rewards: [],
  activeTab: 'xp',
  dirty: false,
};

const elements = {
  sessionLabel: document.querySelector('#sessionLabel'),
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
  saveButton: document.querySelector('#saveButton'),
  configForm: document.querySelector('#configForm'),
  tabList: document.querySelector('#tabList'),
  channelsGrid: document.querySelector('#channelsGrid'),
  rolesGrid: document.querySelector('#rolesGrid'),
  xpChannelRows: document.querySelector('#xpChannelRows'),
  addXpChannelButton: document.querySelector('#addXpChannelButton'),
  boostRows: document.querySelector('#boostRows'),
  addBoostButton: document.querySelector('#addBoostButton'),
  rewardRows: document.querySelector('#rewardRows'),
  addRewardButton: document.querySelector('#addRewardButton'),
};

function setStatus(message, kind = '') {
  elements.statusBox.textContent = message;
  elements.statusBox.className = `status${kind ? ` ${kind}` : ''}`;
  elements.loginStatus.textContent = message;
  elements.loginStatus.className = elements.statusBox.className;
}

function setDirty(value) {
  state.dirty = Boolean(value);
  elements.saveButton.disabled = !state.dirty;
  elements.saveButton.classList.toggle('dirty', state.dirty);
  elements.saveButton.textContent = state.dirty ? 'Save changes' : 'Saved';
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
  if (field.type === 'checkbox') {
    field.checked = Boolean(value);
  } else {
    field.value = value ?? '';
  }
}

function getField(name) {
  const field = elements.configForm.elements[name];
  if (!field) return '';
  return field.type === 'checkbox' ? field.checked : field.value;
}

function labelFromKey(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (char) => char.toUpperCase());
}

function channelOptions() {
  return [
    ...state.directory.categories.map((item) => ({ ...item, label: item.name, optionType: 'category' })),
    ...state.directory.channels.map((item) => ({ ...item, label: item.name, optionType: item.kind || 'text' })),
  ];
}

function roleOptions() {
  return state.directory.roles.map((item) => ({ ...item, label: item.name, optionType: 'role' }));
}

function optionById(options, id) {
  return options.find((option) => option.id === id) || null;
}

function channelTag(option) {
  if (option?.optionType === 'category') return 'CAT';
  if (option?.optionType === 'voice') return 'VC';
  if (option?.optionType === 'forum') return 'FOR';
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
  const selectedOptions = [...selected].map((id) => optionById(options, id)).filter(Boolean);
  if (selectedOptions.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'placeholder';
    empty.textContent = placeholder;
    selectedWrap.append(empty);
  } else {
    selectedOptions.slice(0, multiple ? 8 : 1).forEach((option) => selectedWrap.append(makeToken(option, type)));
    if (selectedOptions.length > 8) {
      const more = document.createElement('span');
      more.className = 'token';
      more.textContent = `+${selectedOptions.length - 8}`;
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
  search.placeholder = 'Search';
  search.autocomplete = 'off';
  const optionList = document.createElement('div');
  optionList.className = 'option-list';
  menu.append(search, optionList);

  function close() {
    menu.classList.remove('open');
    button.classList.remove('open');
  }

  function drawOptions() {
    const query = search.value.trim().toLowerCase();
    const filtered = options.filter((option) => !query || option.label.toLowerCase().includes(query) || option.id.includes(query));
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
      check.textContent = selected.has(option.id) ? 'ON' : '';
      row.append(main, check);
      row.addEventListener('click', () => {
        if (multiple) {
          if (selected.has(option.id)) selected.delete(option.id);
          else selected.add(option.id);
          onChange([...selected]);
          renderPicker(mount, options, [...selected], settings);
        } else {
          onChange(option.id);
          close();
        }
        setDirty(true);
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
  drawOptions();
}

document.addEventListener('click', (event) => {
  if (event.target.closest('.picker')) return;
  document.querySelectorAll('.picker-menu.open').forEach((node) => node.classList.remove('open'));
  document.querySelectorAll('.picker-button.open').forEach((node) => node.classList.remove('open'));
});

function normalizeXpChannelRule(value) {
  if (typeof value === 'string') {
    return {
      channelId: value,
      minXp: Number(getField('xp.messageXpMin')) || 1,
      maxXp: Number(getField('xp.messageXpMax')) || 3,
      cooldownMs: Number(getField('xp.messageCooldownMs')) || 0,
    };
  }
  return {
    channelId: value?.channelId || '',
    minXp: Number(value?.minXp ?? getField('xp.messageXpMin')) || 0,
    maxXp: Number(value?.maxXp ?? getField('xp.messageXpMax')) || 0,
    cooldownMs: Number(value?.cooldownMs ?? getField('xp.messageCooldownMs')) || 0,
  };
}

function renderXpChannelRows() {
  const options = channelOptions();
  elements.xpChannelRows.replaceChildren();
  state.xpChannels.forEach((rule, index) => {
    const row = document.createElement('div');
    row.className = 'config-row xp-row';
    const pickerWrap = document.createElement('div');
    pickerWrap.className = 'picker-field';
    const label = document.createElement('span');
    label.className = 'field-label';
    label.textContent = 'Channel or category';
    const pickerMount = document.createElement('div');
    pickerWrap.append(label, pickerMount);

    const min = rowInput('Min XP', rule.minXp, 'number', '0.1');
    const max = rowInput('Max XP', rule.maxXp, 'number', '0.1');
    const cooldown = rowInput('Cooldown ms', rule.cooldownMs, 'number', '1000');
    const remove = document.createElement('button');
    remove.className = 'button small danger';
    remove.type = 'button';
    remove.textContent = 'Remove';

    renderPicker(pickerMount, options, rule.channelId, {
      type: 'channel',
      placeholder: 'Select channel',
      onChange: (value) => {
        state.xpChannels[index].channelId = value;
        renderXpChannelRows();
      },
    });

    min.input.addEventListener('input', () => {
      state.xpChannels[index].minXp = Number(min.input.value);
      setDirty(true);
    });
    max.input.addEventListener('input', () => {
      state.xpChannels[index].maxXp = Number(max.input.value);
      setDirty(true);
    });
    cooldown.input.addEventListener('input', () => {
      state.xpChannels[index].cooldownMs = Number(cooldown.input.value);
      setDirty(true);
    });
    remove.addEventListener('click', () => {
      state.xpChannels.splice(index, 1);
      renderXpChannelRows();
      setDirty(true);
    });

    row.append(pickerWrap, min.label, max.label, cooldown.label, remove);
    elements.xpChannelRows.append(row);
  });
}

function rowInput(title, value, type = 'number', step = '1') {
  const label = document.createElement('label');
  label.textContent = title;
  const input = document.createElement('input');
  input.type = type;
  input.min = '0';
  input.step = step;
  input.value = value ?? '';
  label.append(input);
  return { label, input };
}

function renderObjectPickers(container, groupName, values, options, type) {
  container.replaceChildren();
  for (const [key, value] of Object.entries(values || {})) {
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
        renderObjectPickers(container, groupName, groupName === 'channels' ? state.channelValues : state.roleValues, options, type);
      },
    });
    container.append(wrap);
  }
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
    const percent = rowInput('XP percent', boost.xpPercent);
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
      setDirty(true);
    });
    remove.addEventListener('click', () => {
      state.boosts.splice(index, 1);
      renderBoostRows();
      setDirty(true);
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
      setDirty(true);
    });
    remove.addEventListener('click', () => {
      state.rewards.splice(index, 1);
      renderRewardRows();
      setDirty(true);
    });
    row.append(level.label, pickerWrap, remove);
    elements.rewardRows.append(row);
  });
}

function fillConfig(config) {
  state.config = config;
  state.channelValues = { ...(config.channels || {}) };
  state.roleValues = { ...(config.roles || {}) };
  state.xpChannels = (config.xp?.channels || []).map(normalizeXpChannelRule);
  state.boosts = (config.xp?.boosts || []).map((item) => ({ ...item }));
  state.rewards = (config.xp?.levelRoleRewards || []).map((item) => ({ ...item }));

  setField('xp.messageXpMin', config.xp?.messageXpMin);
  setField('xp.messageXpMax', config.xp?.messageXpMax);
  setField('xp.messageCooldownMs', config.xp?.messageCooldownMs || 0);
  setField('inviteRewards.enabled', config.inviteRewards?.enabled);
  setField('inviteRewards.capMembers', config.inviteRewards?.capMembers);

  for (const key of ['minWordLength', 'maxWordLength', 'startingHearts', 'turnTimeoutMs', 'punishmentMs', 'gameCooldownMs']) {
    setField(`wordChain.${key}`, config.wordChain?.[key]);
  }
  for (const key of ['minClaimMs', 'maxClaimMs', 'minDurationMs', 'maxDurationMs']) {
    setField(`giveaway.${key}`, config.giveaway?.[key]);
  }

  renderXpChannelRows();
  renderObjectPickers(elements.channelsGrid, 'channels', state.channelValues, channelOptions(), 'channel');
  renderObjectPickers(elements.rolesGrid, 'roles', state.roleValues, roleOptions(), 'role');
  renderBoostRows();
  renderRewardRows();
  setDirty(false);
}

function collectPatch() {
  return {
    channels: { ...state.channelValues },
    roles: { ...state.roleValues },
    xp: {
      messageXpMin: Number(getField('xp.messageXpMin')),
      messageXpMax: Number(getField('xp.messageXpMax')),
      messageCooldownMs: Number(getField('xp.messageCooldownMs')),
      channels: state.xpChannels.filter((rule) => rule.channelId),
      boosts: state.boosts.filter((item) => item.roleId && Number.isFinite(Number(item.xpPercent))),
      levelRoleRewards: state.rewards.filter((item) => item.roleId && Number.isFinite(Number(item.level))),
    },
    inviteRewards: {
      enabled: getField('inviteRewards.enabled'),
      capMembers: Number(getField('inviteRewards.capMembers')),
    },
    wordChain: {
      minWordLength: Number(getField('wordChain.minWordLength')),
      maxWordLength: Number(getField('wordChain.maxWordLength')),
      startingHearts: Number(getField('wordChain.startingHearts')),
      turnTimeoutMs: Number(getField('wordChain.turnTimeoutMs')),
      punishmentMs: Number(getField('wordChain.punishmentMs')),
      gameCooldownMs: Number(getField('wordChain.gameCooldownMs')),
    },
    giveaway: {
      minClaimMs: Number(getField('giveaway.minClaimMs')),
      maxClaimMs: Number(getField('giveaway.maxClaimMs')),
      minDurationMs: Number(getField('giveaway.minDurationMs')),
      maxDurationMs: Number(getField('giveaway.maxDurationMs')),
    },
  };
}

async function loadGuild(guildId) {
  if (!guildId) return;
  if (state.dirty && !window.confirm('You have unsaved changes. Switch server and lose them?')) {
    elements.guildSelect.value = state.guildId;
    return;
  }
  state.guildId = guildId;
  const guild = state.guilds.find((item) => item.id === guildId);
  elements.guildTitle.textContent = guild ? `${guild.name} settings` : 'Server settings';
  elements.guildSubtitle.textContent = 'Only configured XP channels can earn XP.';
  elements.serverMeta.textContent = guild ? `Guild ID ${guild.id}` : '';
  elements.editor.hidden = false;
  setStatus('Loading server config...');
  const [directoryPayload, configPayload] = await Promise.all([
    api(`/api/guilds/${guildId}/directory`),
    api(`/api/guilds/${guildId}/config`),
  ]);
  state.directory = directoryPayload.directory || { channels: [], categories: [], roles: [] };
  fillConfig(configPayload.config);
  setStatus('Server config loaded.', 'ok');
}

function renderSession() {
  const user = state.me?.user;
  elements.loginButton.hidden = Boolean(user);
  elements.logoutButton.hidden = !user;
  elements.loginPanel.hidden = Boolean(user);
  elements.appShell.hidden = !user;
  elements.sessionLabel.textContent = user ? `Logged in as ${user.globalName || user.username}` : 'Discord login required';

  elements.guildSelect.replaceChildren();
  if (!user || state.guilds.length === 0) {
    elements.guildSelect.disabled = true;
    elements.guildSelect.append(new Option('No editable servers', ''));
    elements.editor.hidden = true;
    return;
  }

  elements.guildSelect.disabled = false;
  for (const guild of state.guilds) {
    elements.guildSelect.append(new Option(guild.name, guild.id));
  }
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === tabName));
  document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tabName));
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
    setStatus(error.message === 'Not logged in.' ? 'Log in with Discord to edit server settings.' : error.message, error.message === 'Not logged in.' ? '' : 'error');
  }
}

elements.configForm.addEventListener('input', () => setDirty(true));
elements.configForm.addEventListener('change', () => setDirty(true));

elements.tabList.addEventListener('click', (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  if (state.dirty && tab.dataset.tab !== state.activeTab && !window.confirm('You have unsaved changes. Continue without saving first?')) return;
  setActiveTab(tab.dataset.tab);
});

elements.guildSelect.addEventListener('change', () => {
  loadGuild(elements.guildSelect.value).catch((error) => setStatus(error.message, 'error'));
});

elements.logoutButton.addEventListener('click', async () => {
  if (state.dirty && !window.confirm('You have unsaved changes. Log out and lose them?')) return;
  await api('/auth/logout', { method: 'POST' }).catch(() => null);
  window.location.href = '/admin';
});

elements.addXpChannelButton.addEventListener('click', () => {
  state.xpChannels.push({
    channelId: '',
    minXp: Number(getField('xp.messageXpMin')) || 1,
    maxXp: Number(getField('xp.messageXpMax')) || 3,
    cooldownMs: Number(getField('xp.messageCooldownMs')) || 0,
  });
  renderXpChannelRows();
  setDirty(true);
});

elements.addBoostButton.addEventListener('click', () => {
  state.boosts.push({ roleId: '', xpPercent: 5 });
  renderBoostRows();
  setDirty(true);
});

elements.addRewardButton.addEventListener('click', () => {
  state.rewards.push({ level: 1, roleId: '' });
  renderRewardRows();
  setDirty(true);
});

elements.saveButton.addEventListener('click', async () => {
  if (!state.guildId || !state.dirty) return;
  elements.saveButton.disabled = true;
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
    elements.saveButton.disabled = false;
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!state.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

setActiveTab('xp');
setDirty(false);
loadSession();
