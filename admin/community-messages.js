(() => {
  if (window.__coinSpriteCommunityMessagesTabV2) return;
  window.__coinSpriteCommunityMessagesTabV2 = true;

  const EVENTS = ['welcome', 'goodbye', 'booster'];
  const LABELS = { welcome: 'Welcome', goodbye: 'Goodbye', booster: 'Booster' };
  const COLORS = { welcome: '#57F287', goodbye: '#ED4245', booster: '#FF73FA' };
  const TEXT = {
    welcome: '## Welcome <@mention>\nWelcome to **<server-name>**! You are member **<member-count>**.',
    goodbye: '## Member left\n**<display-name>** has left **<server-name>**.',
    booster: '## Server boosted\nThank you <@mention> for boosting **<server-name>**!',
  };
  const TOKENS = ['<@mention>', '<username>', '<display-name>', '<user-id>', '<server-name>', '<member-count>', '<avatar_url>'];
  const PREVIEW = {
    '@mention': '@someone', mention: '@someone', username: 'someone', 'display-name': 'Someone',
    'user-id': '123456789012345678', 'server-name': 'CoinSprite', 'member-count': '1,234',
    avatar_url: '/bot-avatar.png',
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);

  let activeEvent = 'welcome';
  let values = defaults();
  let channels = [];
  let directoryGuildId = '';
  let directoryLoading = false;
  let editor = null;

  function template(eventName) {
    return {
      id: 'community-' + eventName,
      name: eventName + ' message',
      content: '',
      containers: [{
        id: eventName + '-container',
        accentColor: COLORS[eventName],
        text: TEXT[eventName],
        thumbnailUrl: '<avatar_url>',
        imageUrl: '',
      }],
      componentRows: [],
    };
  }

  function defaults() {
    return Object.fromEntries(EVENTS.map((eventName) => [eventName, {
      enabled: false,
      channelId: '',
      messageTemplate: template(eventName),
    }]));
  }

  function normalize(config = {}) {
    const saved = config.communityMessages || {};
    return Object.fromEntries(EVENTS.map((eventName) => {
      const source = saved[eventName] || {};
      return [eventName, {
        enabled: Boolean(source.enabled),
        channelId: String(source.channelId || ''),
        messageTemplate: window.CoinSpriteRichEditor?.normalize(source.messageTemplate || template(eventName)) || source.messageTemplate || template(eventName),
      }];
    }));
  }

  function ensureUi() {
    TAB_NAMES['community-messages'] = 'Welcome messages';
    const tabs = document.querySelector('#tabList');
    if (tabs && !tabs.querySelector('[data-tab="community-messages"]')) {
      const button = document.createElement('button');
      button.className = 'tab';
      button.type = 'button';
      button.dataset.tab = 'community-messages';
      button.innerHTML = '<span>Welcome messages</span>';
      (tabs.querySelector('[data-tab="messages"]') || tabs.lastElementChild)?.before(button);
    }
    const form = document.querySelector('#configForm');
    if (form && !form.querySelector('[data-panel="community-messages"]')) {
      const panel = document.createElement('section');
      panel.className = 'tab-panel';
      panel.dataset.panel = 'community-messages';
      panel.innerHTML = '<div id="communityMessagesRoot"></div>';
      form.append(panel);
    }
    if (!document.querySelector('#communityMessagesStyles')) {
      const style = document.createElement('style');
      style.id = 'communityMessagesStyles';
      style.textContent = [
        '.community-shell{display:grid;gap:14px}',
        '.community-delivery{display:grid;grid-template-columns:180px minmax(240px,1fr);gap:14px;align-items:end;border:1px solid var(--border,#30394a);background:var(--panel,#111827);border-radius:8px;padding:16px}',
        '.community-delivery label{display:grid;gap:7px}.community-delivery .checkline{display:flex;align-items:center}',
        '@media(max-width:700px){.community-delivery{grid-template-columns:1fr}}',
      ].join('\n');
      document.head.append(style);
    }
  }

  function channelOptions(selected) {
    const rows = channels.filter((channel) => !['category', 'voice'].includes(channel.kind)).map((channel) => {
      const label = (channel.parentName ? channel.parentName + ' / ' : '') + '#' + channel.name;
      return '<option value="' + escapeHtml(channel.id) + '" ' + (selected === channel.id ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
    });
    if (selected && !channels.some((channel) => channel.id === selected)) rows.unshift('<option selected value="' + escapeHtml(selected) + '">Unavailable channel</option>');
    return '<option value="">Select channel</option>' + rows.join('');
  }

  function markDirty() {
    refreshDirtyState();
  }

  function render() {
    ensureUi();
    const root = document.querySelector('#communityMessagesRoot');
    if (!root) return;
    const current = values[activeEvent];
    root.innerHTML = '<div class="community-shell"><nav class="mini-tabs" aria-label="Community message type">'
      + EVENTS.map((name) => '<button class="mini-tab ' + (name === activeEvent ? 'active' : '') + '" type="button" data-community-event="' + name + '">' + LABELS[name] + '</button>').join('')
      + '</nav><section class="community-delivery"><label class="checkline"><input id="communityEnabled" type="checkbox" ' + (current.enabled ? 'checked' : '') + '> Enabled</label>'
      + '<label>Channel<select id="communityChannel">' + channelOptions(current.channelId) + '</select></label></section><div id="communityRichEditor"></div></div>';
    editor = window.CoinSpriteRichEditor?.mount(root.querySelector('#communityRichEditor'), {
      value: current.messageTemplate,
      tokens: TOKENS,
      previewTokens: PREVIEW,
      onChange(next) {
        values[activeEvent].messageTemplate = next;
        markDirty();
      },
    }) || null;
  }

  async function loadDirectory(force = false) {
    const guildId = String(state.guildId || document.querySelector('#guildSelect')?.value || '');
    if (!guildId || directoryLoading || (!force && directoryGuildId === guildId)) return;
    directoryLoading = true;
    try {
      const response = await fetch('/api/guilds/' + guildId + '/directory');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not load channels.');
      channels = Array.isArray(payload.directory?.channels) ? payload.directory.channels : [];
      directoryGuildId = guildId;
      if (state.activeTab === 'community-messages') render();
    } catch (error) {
      setStatus(error.message, 'error');
    } finally {
      directoryLoading = false;
    }
  }

  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('#communityMessagesRoot')) return;
    const eventName = event.target.closest('[data-community-event]')?.dataset.communityEvent;
    if (!EVENTS.includes(eventName)) return;
    values[activeEvent].messageTemplate = editor?.getValue() || values[activeEvent].messageTemplate;
    activeEvent = eventName;
    render();
  });

  document.addEventListener('change', (event) => {
    if (!event.target.closest?.('#communityMessagesRoot')) return;
    if (event.target.id === 'communityEnabled') values[activeEvent].enabled = event.target.checked;
    else if (event.target.id === 'communityChannel') values[activeEvent].channelId = event.target.value;
    else return;
    markDirty();
  });

  ensureUi();
  const nativeApplyTab = applyTabFromConfig;
  applyTabFromConfig = function communityApplyTab(tabName, config) {
    nativeApplyTab(tabName, config);
    if (tabName !== 'community-messages') return;
    values = normalize(config);
    render();
  };

  const nativeCollectTab = collectTabState;
  collectTabState = function communityCollectTab(tabName) {
    if (tabName === 'community-messages') return clone(values);
    return nativeCollectTab(tabName);
  };

  const nativeCollectPatch = collectPatch;
  collectPatch = function communityCollectPatch() {
    const patch = nativeCollectPatch();
    patch.communityMessages = clone(values);
    return patch;
  };

  const nativeSetActiveTab = setActiveTab;
  setActiveTab = function communitySetActiveTab(tabName) {
    nativeSetActiveTab(tabName);
    if (tabName !== 'community-messages') return;
    if (elements.guildTitle) elements.guildTitle.textContent = 'Welcome messages';
    if (elements.guildSubtitle) elements.guildSubtitle.textContent = 'Welcome, goodbye, and booster delivery';
    render();
    queueMicrotask(loadDirectory);
  };

  if (state.savedConfig) {
    values = normalize(state.savedConfig);
    captureSavedSnapshots();
    refreshDirtyState();
  }
})();
