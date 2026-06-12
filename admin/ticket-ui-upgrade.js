(function dashboardUpgrade() {
  const originalFetch = window.fetch.bind(window);
  const model = {
    directory: { channels: [], categories: [] },
    defaultXpIds: [],
    savedDefaultXpIds: [],
    wordChainChannelId: '',
    savedWordChainChannelId: '',
    wordChainEnabled: false,
    savedWordChainEnabled: false,
    externalDirty: false,
    reloaded: false,
  };

  const EMOJIS = [
    ['🎫', 'ticket'], ['🎟️', 'admission ticket'], ['✅', 'check approved'], ['❌', 'cross denied'],
    ['⚠️', 'warning'], ['🔒', 'lock private'], ['🔓', 'unlock'], ['🛡️', 'shield security'],
    ['📩', 'mail inbox'], ['📢', 'announcement'], ['🔔', 'notification'], ['📝', 'note memo'],
    ['📎', 'attachment'], ['🔗', 'link'], ['⚙️', 'settings'], ['🛠️', 'tools'],
    ['🗑️', 'delete'], ['🔍', 'search'], ['👤', 'user'], ['👥', 'users'],
    ['💬', 'chat'], ['📞', 'support'], ['🎁', 'gift'], ['🏆', 'trophy'],
    ['👑', 'crown'], ['💎', 'diamond'], ['🪙', 'coin'], ['🚀', 'rocket'],
    ['🔥', 'fire'], ['✨', 'sparkles'], ['⭐', 'star'], ['💡', 'idea'],
    ['👍', 'thumbs up'], ['👎', 'thumbs down'], ['❤️', 'heart'], ['🎉', 'celebrate'],
    ['😀', 'happy'], ['😎', 'cool'], ['🤔', 'thinking'], ['🙏', 'thanks'],
  ];

  function defaultsFor(config) {
    const minXp = Number(config?.messageXpMin) || 0;
    return {
      minXp,
      maxXp: Math.max(minXp, Number(config?.messageXpMax) || minXp),
      cooldownMs: Math.max(0, Number(config?.messageCooldownMs) || 0),
    };
  }

  function normalizeRule(raw, defaults) {
    const channelId = String(typeof raw === 'string' ? raw : raw?.channelId || raw?.id || '');
    if (!channelId) return null;
    return {
      channelId,
      minXp: Number(raw?.minXp ?? defaults.minXp),
      maxXp: Number(raw?.maxXp ?? defaults.maxXp),
      cooldownMs: Number(raw?.cooldownMs ?? defaults.cooldownMs),
    };
  }

  function splitXp(config) {
    const xp = config?.xp || {};
    const defaults = defaultsFor(xp);
    const explicit = Array.isArray(xp.channelOverrides);
    const overrides = explicit
      ? xp.channelOverrides.map((item) => normalizeRule(item, defaults)).filter(Boolean)
      : (xp.channels || []).map((raw) => ({ raw, rule: normalizeRule(raw, defaults) }))
        .filter(({ raw, rule }) => rule && typeof raw !== 'string' && (
          rule.minXp !== defaults.minXp || rule.maxXp !== defaults.maxXp || rule.cooldownMs !== defaults.cooldownMs
        )).map(({ rule }) => rule);
    const overrideIds = new Set(overrides.map((rule) => rule.channelId));
    const defaultIds = (xp.channels || []).map((item) => normalizeRule(item, defaults)?.channelId)
      .filter((id) => id && !overrideIds.has(id));
    return { defaultIds: [...new Set(defaultIds)], overrides };
  }

  function jsonResponse(response, payload) {
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  window.fetch = async function upgradedFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    let nextInit = init;
    const isConfig = /\/api\/guilds\/\d{16,20}\/config$/.test(url);
    if (isConfig && String(init.method || 'GET').toUpperCase() === 'PATCH' && init.body) {
      const body = JSON.parse(init.body);
      const overrides = Array.isArray(body.xp?.channels) ? body.xp.channels : [];
      body.xp = body.xp || {};
      body.xp.channels = [
        ...model.defaultXpIds,
        ...overrides.filter((rule) => rule?.channelId && !model.defaultXpIds.includes(String(rule.channelId))),
      ];
      delete body.xp.channelOverrides;
      body.channels = body.channels || {};
      body.channels.wordChain = model.wordChainEnabled ? model.wordChainChannelId : '';
      body.wordChain = { ...(body.wordChain || {}), enabled: model.wordChainEnabled };
      delete body.inviteRewards;
      nextInit = { ...init, body: JSON.stringify(body) };
    }

    const response = await originalFetch(input, nextInit);
    if (!response.ok) return response;
    if (/\/api\/guilds\/\d{16,20}\/directory$/.test(url)) {
      const payload = await response.json();
      model.directory = payload.directory || model.directory;
      setTimeout(renderDashboardControls, 0);
      return jsonResponse(response, payload);
    }
    if (isConfig) {
      const payload = await response.json();
      const split = splitXp(payload.config);
      model.defaultXpIds = split.defaultIds;
      model.savedDefaultXpIds = [...split.defaultIds];
      model.wordChainChannelId = String(payload.config?.channels?.wordChain || '');
      model.savedWordChainChannelId = model.wordChainChannelId;
      model.wordChainEnabled = Boolean(payload.config?.wordChain?.enabled ?? model.wordChainChannelId);
      model.savedWordChainEnabled = model.wordChainEnabled;
      payload.config.xp.channels = split.overrides;
      if (String(init.method || 'GET').toUpperCase() === 'PATCH') model.externalDirty = false;
      setTimeout(renderDashboardControls, 0);
      return jsonResponse(response, payload);
    }
    return response;
  };

  function markExternalDirty() {
    model.externalDirty = model.wordChainEnabled !== model.savedWordChainEnabled
      || model.wordChainChannelId !== model.savedWordChainChannelId
      || JSON.stringify([...model.defaultXpIds].sort()) !== JSON.stringify([...model.savedDefaultXpIds].sort());
    const bar = document.querySelector('#unsavedBar');
    const save = document.querySelector('#saveButton');
    const saved = document.querySelector('#savedState');
    if (model.externalDirty) {
      if (bar) bar.hidden = false;
      if (save) save.disabled = false;
      if (saved) saved.textContent = 'Unsaved changes';
    }
  }

  function optionItems(mode) {
    const all = [...(model.directory.categories || []), ...(model.directory.channels || [])];
    return all.filter((item) => mode === 'xp'
      ? !['voice'].includes(item.kind)
      : ['text', 'announcement', 'thread'].includes(item.kind));
  }

  function itemLabel(item) {
    const prefix = item.kind === 'category' ? 'CAT' : item.kind === 'thread' ? 'THR' : '#';
    return `${prefix}  ${item.parentName ? `${item.parentName} / ` : ''}${item.name}`;
  }

  function createPicker({ mode, multiple, values, onChange }) {
    const selected = new Set(values.filter(Boolean).map(String));
    const root = document.createElement('div');
    root.className = 'upgrade-picker';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'upgrade-picker-button';
    const menu = document.createElement('div');
    menu.className = 'upgrade-picker-menu';
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = 'Search by name or ID';
    const list = document.createElement('div');
    list.className = 'upgrade-picker-list';
    menu.append(search, list);
    root.append(button, menu);

    function drawButton() {
      const labels = optionItems(mode).filter((item) => selected.has(item.id)).map((item) => item.name);
      button.textContent = labels.length ? (multiple ? `${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ` +${labels.length - 3}` : ''}` : labels[0]) : 'Select a channel';
    }
    function drawList() {
      const query = search.value.trim().toLowerCase();
      list.replaceChildren();
      optionItems(mode).filter((item) => !query || `${item.name} ${item.id} ${item.parentName || ''}`.toLowerCase().includes(query)).forEach((item) => {
        const option = document.createElement('label');
        option.className = 'upgrade-picker-option';
        const input = document.createElement('input');
        input.type = multiple ? 'checkbox' : 'radio';
        input.checked = selected.has(item.id);
        const text = document.createElement('span');
        text.textContent = itemLabel(item);
        input.addEventListener('change', () => {
          if (!multiple) selected.clear();
          if (input.checked) selected.add(item.id); else selected.delete(item.id);
          onChange([...selected]);
          drawButton();
          drawList();
          if (!multiple) menu.classList.remove('open');
        });
        option.append(input, text);
        list.append(option);
      });
    }
    button.addEventListener('click', () => {
      menu.classList.toggle('open');
      if (menu.classList.contains('open')) { drawList(); search.focus(); }
    });
    search.addEventListener('input', drawList);
    drawButton();
    return root;
  }

  function renderDashboardControls() {
    document.querySelector('[data-tab="invites"]')?.remove();
    document.querySelector('[data-panel="invites"]')?.remove();

    const defaultPanel = document.querySelector('[data-leveling-panel="xp"] .panel');
    if (defaultPanel && !document.querySelector('#xpDefaultChannelsMount')) {
      const field = document.createElement('div');
      field.className = 'picker-field default-xp-destinations';
      field.innerHTML = '<span class="field-label">XP channels</span><p>Only messages sent in these channels, categories, or forum threads earn the default XP values.</p><div id="xpDefaultChannelsMount"></div>';
      defaultPanel.querySelector('.grid')?.before(field);
    }
    const xpMount = document.querySelector('#xpDefaultChannelsMount');
    if (xpMount) {
      xpMount.replaceChildren(createPicker({
        mode: 'xp', multiple: true, values: model.defaultXpIds,
        onChange(values) { model.defaultXpIds = values; markExternalDirty(); },
      }));
    }
    const empty = document.querySelector('#xpEmptyState');
    if (empty) empty.textContent = 'No channel overrides. Add one only when a destination should use different XP values.';

    const gamePanel = document.querySelector('[data-panel="games"] .panel');
    if (gamePanel && !document.querySelector('#wordChainEnabled')) {
      const heading = gamePanel.querySelector('.panel-heading');
      const top = document.createElement('div');
      top.className = 'word-chain-controls';
      top.innerHTML = '<label class="switch-control"><input id="wordChainEnabled" type="checkbox"><span class="switch-track"><span class="switch-thumb"></span></span><span>Enabled</span></label><div class="picker-field"><span class="field-label">Game channel</span><div id="wordChainChannelMount"></div></div>';
      heading?.after(top);
    }
    const toggle = document.querySelector('#wordChainEnabled');
    if (toggle) {
      toggle.checked = model.wordChainEnabled;
      toggle.onchange = () => { model.wordChainEnabled = toggle.checked; markExternalDirty(); };
    }
    const channelMount = document.querySelector('#wordChainChannelMount');
    if (channelMount) {
      channelMount.replaceChildren(createPicker({
        mode: 'wordChain', multiple: false, values: [model.wordChainChannelId],
        onChange(values) { model.wordChainChannelId = values[0] || ''; markExternalDirty(); },
      }));
    }
    document.querySelectorAll('#channelsGrid .picker-field').forEach((field) => {
      if (/word chain/i.test(field.textContent)) field.hidden = true;
    });
    markExternalDirty();
  }

  function upgradePermissionModal(scope = document) {
    scope.querySelectorAll('.ticket-modal-head p').forEach((item) => item.remove());
    scope.querySelectorAll('.permission-item:not([data-upgraded])').forEach((item) => {
      const input = item.querySelector('input[data-permission]');
      const label = item.querySelector('span')?.textContent?.trim();
      if (!input || !label) return;
      item.dataset.upgraded = 'true';
      const name = document.createElement('span'); name.className = 'permission-name'; name.textContent = label;
      const controls = document.createElement('span'); controls.className = 'permission-state';
      controls.innerHTML = '<button type="button" class="permission-deny" disabled>X</button><button type="button" class="permission-neutral">/</button><button type="button" class="permission-allow">✓</button>';
      const refresh = () => {
        controls.querySelector('.permission-neutral').classList.toggle('active', !input.checked);
        controls.querySelector('.permission-allow').classList.toggle('active', input.checked);
      };
      controls.querySelector('.permission-neutral').onclick = () => { input.checked = false; input.dispatchEvent(new Event('input', { bubbles: true })); refresh(); };
      controls.querySelector('.permission-allow').onclick = () => { input.checked = true; input.dispatchEvent(new Event('input', { bubbles: true })); refresh(); };
      item.replaceChildren(input, name, controls); refresh();
    });
  }

  function upgradeEmojiInput(input) {
    if (input.dataset.emojiPicker) return;
    input.dataset.emojiPicker = 'true';
    const wrap = document.createElement('span'); wrap.className = 'emoji-field';
    input.parentNode.insertBefore(wrap, input); wrap.append(input);
    const button = document.createElement('button'); button.type = 'button'; button.className = 'emoji-picker-button'; button.textContent = '☺'; button.title = 'Choose emoji';
    const popover = document.createElement('span'); popover.className = 'emoji-popover';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search emoji';
    const grid = document.createElement('span'); grid.className = 'emoji-grid'; popover.append(search, grid);
    function draw() {
      const query = search.value.toLowerCase(); grid.replaceChildren();
      EMOJIS.filter(([emoji, words]) => !query || `${emoji} ${words}`.includes(query)).forEach(([emoji, words]) => {
        const option = document.createElement('button'); option.type = 'button'; option.textContent = emoji; option.title = words;
        option.onclick = () => { input.value = emoji; input.dispatchEvent(new Event('input', { bubbles: true })); popover.classList.remove('open'); };
        grid.append(option);
      });
    }
    button.onclick = () => { popover.classList.toggle('open'); draw(); if (popover.classList.contains('open')) search.focus(); };
    search.oninput = draw; wrap.append(button, popover);
  }

  const observer = new MutationObserver(() => {
    upgradePermissionModal();
    document.querySelectorAll('input[data-ticket-field="emoji"], input[data-control-field="emoji"], input[data-option-field="emoji"]').forEach(upgradeEmojiInput);
    renderDashboardControls();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  document.querySelector('#resetTabButton')?.addEventListener('click', () => {
    if (!model.externalDirty) return;
    model.defaultXpIds = [...model.savedDefaultXpIds];
    model.wordChainChannelId = model.savedWordChainChannelId;
    model.wordChainEnabled = model.savedWordChainEnabled;
    model.externalDirty = false;
    setTimeout(renderDashboardControls, 0);
  }, true);
  document.querySelector('#tabList')?.addEventListener('click', (event) => {
    if (model.externalDirty && event.target.closest('.tab') && !window.confirm('You have unsaved changes. Leave this section without saving them?')) event.stopImmediatePropagation();
  }, true);
  window.addEventListener('beforeunload', (event) => {
    if (!model.externalDirty) return;
    event.preventDefault(); event.returnValue = '';
  });

  const reloadTimer = setInterval(() => {
    const select = document.querySelector('#guildSelect');
    const editor = document.querySelector('#editor');
    if (model.reloaded || !select?.value || select.disabled || editor?.hidden) return;
    model.reloaded = true;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    clearInterval(reloadTimer);
  }, 250);

  upgradePermissionModal();
  renderDashboardControls();
}());
