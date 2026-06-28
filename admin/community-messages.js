(() => {
  if (window.__coinSpriteCommunityMessagesTab) return;
  window.__coinSpriteCommunityMessagesTab = true;

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
  let activeEvent = 'welcome';
  let values = defaults();
  let channels = [];
  let loadedGuildId = '';
  let loading = false;
  let dirty = false;
  let editor = null;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[char]);

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

  function guildId() {
    return document.querySelector('#guildSelect')?.value || '';
  }

  function ensureUi() {
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
      style.textContent = '.community-shell{display:grid;gap:14px}.community-delivery{display:grid;grid-template-columns:180px minmax(240px,1fr);gap:14px;align-items:end;border:1px solid var(--border,#30394a);border-radius:8px;padding:16px}.community-delivery label{display:grid;gap:7px}.community-delivery .checkline{display:flex;align-items:center}.community-actions{display:flex;gap:10px;justify-content:flex-end;align-items:center}.community-status{margin-right:auto;color:var(--muted,#aeb7c5)}@media(max-width:700px){.community-delivery{grid-template-columns:1fr}}';
      document.head.append(style);
    }
  }

  function channelOptions(selected) {
    const items = channels.filter((channel) => !['category', 'voice'].includes(channel.kind)).map((channel) => {
      const label = (channel.parentName ? channel.parentName + ' / ' : '') + '#' + channel.name;
      return '<option value="' + escapeHtml(channel.id) + '" ' + (channel.id === selected ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
    });
    if (selected && !channels.some((channel) => channel.id === selected)) items.unshift('<option selected value="' + escapeHtml(selected) + '">Unavailable channel</option>');
    return '<option value="">Select channel</option>' + items.join('');
  }

  function markDirty() {
    dirty = true;
    const status = document.querySelector('#communityStatus');
    if (status) status.textContent = 'Unsaved changes';
  }

  function render() {
    ensureUi();
    const root = document.querySelector('#communityMessagesRoot');
    if (!root) return;
    const current = values[activeEvent];
    root.innerHTML = '<div class="community-shell"><nav class="mini-tabs">'
      + EVENTS.map((name) => '<button class="mini-tab ' + (name === activeEvent ? 'active' : '') + '" type="button" data-event="' + name + '">' + LABELS[name] + '</button>').join('')
      + '</nav><section class="community-delivery"><label class="checkline"><input id="communityEnabled" type="checkbox" ' + (current.enabled ? 'checked' : '') + '> Enabled</label>'
      + '<label>Channel<select id="communityChannel">' + channelOptions(current.channelId) + '</select></label></section>'
      + '<div id="communityRichEditor"></div><div class="community-actions"><span id="communityStatus" class="community-status">' + (dirty ? 'Unsaved changes' : 'All changes saved') + '</span>'
      + '<button type="button" id="communityReset">Reset</button><button type="button" class="button success" id="communitySave">Save messages</button></div></div>';
    const editorRoot = document.querySelector('#communityRichEditor');
    editor = window.CoinSpriteRichEditor?.mount(editorRoot, {
      value: current.messageTemplate,
      tokens: TOKENS,
      previewTokens: PREVIEW,
      onChange(next) {
        values[activeEvent].messageTemplate = next;
        markDirty();
      },
    }) || null;
  }

  async function load(force = false) {
    const id = guildId();
    if (!id || loading || (!force && id === loadedGuildId)) return;
    loading = true;
    try {
      const [configResponse, directoryResponse] = await Promise.all([
        fetch('/api/guilds/' + id + '/config'),
        fetch('/api/guilds/' + id + '/directory'),
      ]);
      const configPayload = await configResponse.json();
      const directoryPayload = await directoryResponse.json();
      if (!configResponse.ok) throw new Error(configPayload.error || 'Could not load messages.');
      if (!directoryResponse.ok) throw new Error(directoryPayload.error || 'Could not load channels.');
      values = normalize(configPayload.config);
      channels = Array.isArray(directoryPayload.directory?.channels) ? directoryPayload.directory.channels : [];
      loadedGuildId = id;
      dirty = false;
      render();
    } catch (error) {
      const status = document.querySelector('#communityStatus');
      if (status) status.textContent = error.message;
    } finally {
      loading = false;
    }
  }

  async function save() {
    const id = guildId();
    const status = document.querySelector('#communityStatus');
    if (!id) return;
    if (status) status.textContent = 'Saving...';
    try {
      const response = await fetch('/api/guilds/' + id + '/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ communityMessages: values }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save messages.');
      values = normalize(payload.config);
      dirty = false;
      render();
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  }

  function activate() {
    ensureUi();
    document.querySelectorAll('#tabList .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'community-messages'));
    document.querySelectorAll('#configForm > .tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === 'community-messages'));
    const title = document.querySelector('#guildTitle');
    const subtitle = document.querySelector('#guildSubtitle');
    if (title) title.textContent = 'Welcome messages';
    if (subtitle) subtitle.textContent = 'Welcome, goodbye, and booster delivery';
    const unsaved = document.querySelector('#unsavedBar');
    if (unsaved) unsaved.hidden = true;
    render();
    load();
  }

  document.addEventListener('click', (event) => {
    const main = event.target.closest?.('[data-tab="community-messages"]');
    if (main) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activate();
      return;
    }
    if (event.target.closest?.('#tabList .tab:not([data-tab="community-messages"])')) document.querySelector('[data-panel="community-messages"]')?.classList.remove('active');
    if (!event.target.closest?.('#communityMessagesRoot')) return;
    const eventName = event.target.closest('[data-event]')?.dataset.event;
    if (EVENTS.includes(eventName)) {
      values[activeEvent].messageTemplate = editor?.getValue() || values[activeEvent].messageTemplate;
      activeEvent = eventName;
      render();
    } else if (event.target.id === 'communityReset') {
      values[activeEvent] = { enabled: false, channelId: '', messageTemplate: template(activeEvent) };
      markDirty();
      render();
    } else if (event.target.id === 'communitySave') save();
  }, true);

  document.addEventListener('change', (event) => {
    if (event.target.id === 'guildSelect') {
      loadedGuildId = '';
      if (document.querySelector('[data-tab="community-messages"]')?.classList.contains('active')) load(true);
      return;
    }
    if (!event.target.closest?.('#communityMessagesRoot')) return;
    if (event.target.id === 'communityEnabled') values[activeEvent].enabled = event.target.checked;
    if (event.target.id === 'communityChannel') values[activeEvent].channelId = event.target.value;
    if (['communityEnabled', 'communityChannel'].includes(event.target.id)) markDirty();
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureUi, { once: true });
  else ensureUi();
  [0, 250, 750].forEach((delay) => setTimeout(ensureUi, delay));
})();
