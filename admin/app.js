const state = {
  me: null,
  guilds: [],
  guildId: '',
  config: null,
};

const elements = {
  sessionLabel: document.querySelector('#sessionLabel'),
  loginButton: document.querySelector('#loginButton'),
  logoutButton: document.querySelector('#logoutButton'),
  guildSelect: document.querySelector('#guildSelect'),
  statusBox: document.querySelector('#statusBox'),
  editor: document.querySelector('#editor'),
  guildTitle: document.querySelector('#guildTitle'),
  saveButton: document.querySelector('#saveButton'),
  configForm: document.querySelector('#configForm'),
  channelsGrid: document.querySelector('#channelsGrid'),
  rolesGrid: document.querySelector('#rolesGrid'),
};

function setStatus(message, kind = '') {
  elements.statusBox.textContent = message;
  elements.statusBox.className = `status${kind ? ` ${kind}` : ''}`;
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

function renderObjectFields(container, groupName, values) {
  container.replaceChildren();
  for (const [key, value] of Object.entries(values || {})) {
    const label = document.createElement('label');
    label.textContent = labelFromKey(key);
    const input = document.createElement('input');
    input.name = `${groupName}.${key}`;
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.value = value || '';
    label.append(input);
    container.append(label);
  }
}

function listToTextarea(value) {
  return Array.isArray(value) ? value.join('\n') : '';
}

function textareaToList(value) {
  return String(value || '').split(/\s+/).map((item) => item.trim()).filter(Boolean);
}

function boostsToTextarea(value) {
  return Array.isArray(value) ? value.map((item) => `${item.roleId}:${item.xpPercent}`).join('\n') : '';
}

function textareaToBoosts(value) {
  return String(value || '').split('\n').map((line) => {
    const [roleId, xpPercent] = line.split(':').map((part) => part.trim());
    return { roleId, xpPercent: Number(xpPercent) };
  }).filter((item) => item.roleId && Number.isFinite(item.xpPercent));
}

function rewardsToTextarea(value) {
  return Array.isArray(value) ? value.map((item) => `${item.level}:${item.roleId}`).join('\n') : '';
}

function textareaToRewards(value) {
  return String(value || '').split('\n').map((line) => {
    const [level, roleId] = line.split(':').map((part) => part.trim());
    return { level: Number(level), roleId };
  }).filter((item) => Number.isFinite(item.level) && item.roleId);
}

function fillConfig(config) {
  state.config = config;
  renderObjectFields(elements.channelsGrid, 'channels', config.channels);
  renderObjectFields(elements.rolesGrid, 'roles', config.roles);

  setField('xp.messageXpMin', config.xp?.messageXpMin);
  setField('xp.messageXpMax', config.xp?.messageXpMax);
  setField('xp.lowXpAmount', config.xp?.lowXpAmount);
  setField('xp.channels', listToTextarea(config.xp?.channels));
  setField('xp.lowXpChannels', listToTextarea(config.xp?.lowXpChannels));
  setField('xp.noXpChannels', listToTextarea(config.xp?.noXpChannels));
  setField('xp.boosts', boostsToTextarea(config.xp?.boosts));
  setField('xp.levelRoleRewards', rewardsToTextarea(config.xp?.levelRoleRewards));

  setField('inviteRewards.enabled', config.inviteRewards?.enabled);
  setField('inviteRewards.capMembers', config.inviteRewards?.capMembers);

  for (const key of ['minWordLength', 'maxWordLength', 'startingHearts', 'turnTimeoutMs', 'punishmentMs', 'gameCooldownMs']) {
    setField(`wordChain.${key}`, config.wordChain?.[key]);
  }
  for (const key of ['minClaimMs', 'maxClaimMs', 'minDurationMs', 'maxDurationMs']) {
    setField(`giveaway.${key}`, config.giveaway?.[key]);
  }
}

function collectGroup(groupName) {
  const result = {};
  for (const input of elements.configForm.querySelectorAll(`[name^="${groupName}."]`)) {
    const key = input.name.slice(groupName.length + 1);
    result[key] = input.value.trim();
  }
  return result;
}

function collectPatch() {
  return {
    channels: collectGroup('channels'),
    roles: collectGroup('roles'),
    xp: {
      messageXpMin: Number(getField('xp.messageXpMin')),
      messageXpMax: Number(getField('xp.messageXpMax')),
      lowXpAmount: Number(getField('xp.lowXpAmount')),
      channels: textareaToList(getField('xp.channels')),
      lowXpChannels: textareaToList(getField('xp.lowXpChannels')),
      noXpChannels: textareaToList(getField('xp.noXpChannels')),
      boosts: textareaToBoosts(getField('xp.boosts')),
      levelRoleRewards: textareaToRewards(getField('xp.levelRoleRewards')),
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
  state.guildId = guildId;
  const guild = state.guilds.find((item) => item.id === guildId);
  elements.guildTitle.textContent = guild ? `${guild.name} settings` : 'Server settings';
  elements.editor.hidden = false;
  setStatus('Loading server config...');
  const payload = await api(`/api/guilds/${guildId}/config`);
  fillConfig(payload.config);
  setStatus('Server config loaded.', 'ok');
}

function renderSession() {
  const user = state.me?.user;
  elements.loginButton.hidden = Boolean(user);
  elements.logoutButton.hidden = !user;
  elements.sessionLabel.textContent = user ? `Logged in as ${user.globalName || user.username}` : 'Discord login required';

  elements.guildSelect.replaceChildren();
  if (state.guilds.length === 0) {
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

elements.guildSelect.addEventListener('change', () => {
  loadGuild(elements.guildSelect.value).catch((error) => setStatus(error.message, 'error'));
});

elements.logoutButton.addEventListener('click', async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => null);
  window.location.href = '/admin';
});

elements.saveButton.addEventListener('click', async () => {
  if (!state.guildId) return;
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
  } finally {
    elements.saveButton.disabled = false;
  }
});

loadSession();
