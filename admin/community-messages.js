(() => {
  if (window.__coinSpriteCommunityMessagesTab) return;
  window.__coinSpriteCommunityMessagesTab = true;

  const EVENTS = ['welcome', 'goodbye', 'booster'];
  const LABELS = { welcome: 'Welcome', goodbye: 'Goodbye', booster: 'Booster' };
  const DEFAULTS = {
    welcome: { enabled: false, channelId: '', message: 'Welcome <@mention> to **<server-name>**! You are member **<member-count>**.' },
    goodbye: { enabled: false, channelId: '', message: '**<display-name>** has left **<server-name>**.' },
    booster: { enabled: false, channelId: '', message: 'Thank you <@mention> for boosting **<server-name>**!' },
  };
  const TOKENS = ['<@mention>', '<username>', '<display-name>', '<user-id>', '<server-name>', '<member-count>'];
  let activeEvent = 'welcome';
  let values = JSON.parse(JSON.stringify(DEFAULTS));
  let channels = [];
  let loadedGuildId = '';
  let loading = false;
  let dirty = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function currentGuildId() {
    return document.querySelector('#guildSelect')?.value || '';
  }

  function normalizeConfig(config = {}) {
    const saved = config.communityMessages || {};
    return Object.fromEntries(EVENTS.map((eventName) => {
      const source = saved[eventName] || {};
      return [eventName, {
        enabled: Boolean(source.enabled),
        channelId: String(source.channelId || ''),
        message: String(source.message || DEFAULTS[eventName].message).slice(0, 2000),
      }];
    }));
  }

  function installStyles() {
    if (document.querySelector('#communityMessagesStyles')) return;
    const style = document.createElement('style');
    style.id = 'communityMessagesStyles';
    style.textContent = [
      '.community-message-shell { display: grid; gap: 14px; }',
      '.community-message-shell .panel, .community-message-shell .message-sticky-preview { padding: 16px; border-radius: 8px; }',
      '.community-message-delivery { display: grid; gap: 14px; }',
      '.community-message-delivery-grid { display: grid; grid-template-columns: minmax(180px, .7fr) minmax(280px, 1.5fr); gap: 14px; align-items: end; }',
      '.community-message-delivery-grid label { display: grid; gap: 7px; }',
      '.community-message-delivery-grid .checkline { display: flex; }',
      '.community-message-builder { align-items: start; }',
      '.community-message-builder .message-editor { padding: 16px; }',
      '.community-message-editor { min-height: 260px; resize: vertical; }',
      '.community-message-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; }',
      '.community-message-status { margin-right: auto; color: var(--muted, #b7bdc8); }',
      '.community-message-preview-fallback { min-height: 300px; }',
      '@media (max-width: 760px) { .community-message-delivery-grid, .community-message-builder { grid-template-columns: minmax(0, 1fr); } }',
    ].join('\n');
    document.head.append(style);
  }

  function ensureTab() {
    installStyles();
    const tabs = document.querySelector('#tabList');
    if (tabs && !tabs.querySelector('[data-tab="community-messages"]')) {
      const button = document.createElement('button');
      button.className = 'tab';
      button.type = 'button';
      button.dataset.tab = 'community-messages';
      button.innerHTML = '<span>Welcome messages</span>';
      (tabs.querySelector('[data-tab="messages"]') || tabs.querySelector('[data-tab="games"]') || tabs.lastElementChild)?.before(button);
    }
    const form = document.querySelector('#configForm');
    if (form && !form.querySelector('[data-panel="community-messages"]')) {
      const panel = document.createElement('section');
      panel.className = 'tab-panel';
      panel.dataset.panel = 'community-messages';
      panel.innerHTML = '<div id="communityMessagesRoot"></div>';
      form.append(panel);
    }
  }

  function channelOptions(selectedId) {
    const options = channels
      .filter((channel) => !['category', 'voice'].includes(channel.kind))
      .map((channel) => {
        const label = (channel.parentName ? channel.parentName + ' / ' : '') + '#' + channel.name;
        return '<option value="' + escapeHtml(channel.id) + '" ' + (channel.id === selectedId ? 'selected' : '') + '>' + escapeHtml(label) + '</option>';
      });
    if (selectedId && !channels.some((channel) => channel.id === selectedId)) {
      options.unshift('<option value="' + escapeHtml(selectedId) + '" selected>Unavailable (' + escapeHtml(selectedId) + ')</option>');
    }
    return '<option value="">Select a channel</option>' + options.join('');
  }

  function previewMessage(message) {
    return String(message || '')
      .replace(/<@mention>/gi, '@someone')
      .replace(/<username>/gi, 'someone')
      .replace(/<display-name>/gi, 'Someone')
      .replace(/<user-id>/gi, '123456789012345678')
      .replace(/<server-name>/gi, 'CoinSprite')
      .replace(/<member-count>/gi, '1,234');
  }

  function messagePreview(message) {
    const content = previewMessage(message);
    const editor = window.CoinSpriteMessageEditor;
    if (typeof editor?.renderPreview === 'function') {
      return editor.renderPreview({ content, containers: [] }, { hideEmptyRoot: false });
    }
    return '<div class="message-discord-preview shared-message-preview community-message-preview-fallback">'
      + '<div class="message-discord-message"><div class="message-bot-avatar">CS</div><div class="message-discord-body">'
      + '<div class="message-author"><strong>CoinSprite</strong><span>APP</span></div>'
      + '<div class="message-root-content">' + escapeHtml(content || 'Write your message here.').replace(/\n/g, '<br>') + '</div>'
      + '</div></div></div>';
  }

  function updatePreview() {
    const preview = document.querySelector('#communityMessagePreview');
    if (preview) preview.innerHTML = messagePreview(values[activeEvent].message);
  }

  function render() {
    ensureTab();
    const root = document.querySelector('#communityMessagesRoot');
    if (!root) return;
    const current = values[activeEvent];
    root.innerHTML = '<div class="community-message-shell">'
      + '<nav class="mini-tabs" aria-label="Community message type">'
      + EVENTS.map((eventName) => '<button class="mini-tab ' + (activeEvent === eventName ? 'active' : '') + '" type="button" data-community-event="' + eventName + '">' + LABELS[eventName] + '</button>').join('')
      + '</nav><section class="panel community-message-delivery"><div class="panel-heading"><h3>' + LABELS[activeEvent] + ' delivery</h3><p>Choose when this message is enabled and where the bot sends it.</p></div>'
      + '<div class="community-message-delivery-grid"><label class="checkline"><input id="communityMessageEnabled" type="checkbox" ' + (current.enabled ? 'checked' : '') + '> Enabled</label>'
      + '<label>Channel<select id="communityMessageChannel">' + channelOptions(current.channelId) + '</select></label></div></section>'
      + '<div class="message-builder community-message-builder"><div class="panel message-editor">'
      + '<div class="panel-heading"><h3>' + LABELS[activeEvent] + ' message</h3><p>Edit the message and use placeholders for member and server details.</p></div>'
      + '<div class="template-tokens community-message-tokens" aria-label="Message placeholders">'
      + TOKENS.map((token) => '<button type="button" data-community-token="' + escapeHtml(token) + '">' + escapeHtml(token) + '</button>').join('')
      + '</div><label>Message<textarea id="communityMessageText" class="community-message-editor" maxlength="2000" rows="11" spellcheck="true">' + escapeHtml(current.message) + '</textarea></label></div>'
      + '<aside class="message-sticky-preview external-message-sticky-preview"><div class="panel-heading"><h3>Live preview</h3><p>Preview updates as you type.</p></div>'
      + '<div id="communityMessagePreview">' + messagePreview(current.message) + '</div></aside></div>'
      + '<div class="community-message-actions"><span class="community-message-status" id="communityMessageStatus">' + (dirty ? 'Unsaved changes' : 'All changes saved') + '</span>'
      + '<button class="button subtle" id="communityMessageReset" type="button">Reset</button>'
      + '<button class="button success" id="communityMessageSave" type="button">Save messages</button></div></div>';
  }

  async function loadGuild(force = false) {
    const guildId = currentGuildId();
    if (!guildId || loading || (!force && loadedGuildId === guildId)) return;
    loading = true;
    const status = document.querySelector('#communityMessageStatus');
    if (status) status.textContent = 'Loading...';
    try {
      const [configResponse, directoryResponse] = await Promise.all([
        fetch('/api/guilds/' + guildId + '/config'),
        fetch('/api/guilds/' + guildId + '/directory'),
      ]);
      const configPayload = await configResponse.json();
      const directoryPayload = await directoryResponse.json();
      if (!configResponse.ok) throw new Error(configPayload.error || 'Could not load messages.');
      if (!directoryResponse.ok) throw new Error(directoryPayload.error || 'Could not load channels.');
      values = normalizeConfig(configPayload.config);
      channels = Array.isArray(directoryPayload.directory?.channels) ? directoryPayload.directory.channels : [];
      loadedGuildId = guildId;
      dirty = false;
      render();
    } catch (error) {
      if (status) status.textContent = error.message;
    } finally {
      loading = false;
    }
  }

  async function saveGuild() {
    const guildId = currentGuildId();
    const status = document.querySelector('#communityMessageStatus');
    if (!guildId) return;
    if (status) status.textContent = 'Saving...';
    try {
      const response = await fetch('/api/guilds/' + guildId + '/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ communityMessages: values }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Could not save messages.');
      values = normalizeConfig(payload.config);
      dirty = false;
      render();
    } catch (error) {
      if (status) status.textContent = error.message;
    }
  }

  function activateTab() {
    ensureTab();
    document.querySelectorAll('#tabList .tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'community-messages'));
    document.querySelectorAll('#configForm > .tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === 'community-messages'));
    const title = document.querySelector('#guildTitle');
    const subtitle = document.querySelector('#guildSubtitle');
    if (title) title.textContent = 'Welcome messages';
    if (subtitle) subtitle.textContent = 'Configure welcome, goodbye, and server booster messages.';
    const unsavedBar = document.querySelector('#unsavedBar');
    if (unsavedBar) unsavedBar.hidden = true;
    render();
    loadGuild();
  }

  document.addEventListener('click', (event) => {
    const mainTab = event.target.closest?.('[data-tab="community-messages"]');
    if (mainTab) {
      event.preventDefault();
      event.stopImmediatePropagation();
      activateTab();
      return;
    }
    const otherTab = event.target.closest?.('#tabList .tab:not([data-tab="community-messages"])');
    if (otherTab) document.querySelector('[data-panel="community-messages"]')?.classList.remove('active');

    const root = event.target.closest?.('#communityMessagesRoot');
    if (!root) return;
    const eventName = event.target.closest('[data-community-event]')?.dataset.communityEvent;
    if (EVENTS.includes(eventName)) {
      activeEvent = eventName;
      render();
      return;
    }
    const token = event.target.closest('[data-community-token]')?.dataset.communityToken;
    if (token) {
      const textarea = document.querySelector('#communityMessageText');
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || start;
      textarea.value = textarea.value.slice(0, start) + token + textarea.value.slice(end);
      textarea.selectionStart = textarea.selectionEnd = start + token.length;
      values[activeEvent].message = textarea.value;
      dirty = true;
      document.querySelector('#communityMessageStatus').textContent = 'Unsaved changes';
      updatePreview();
      textarea.focus();
      return;
    }
    if (event.target.id === 'communityMessageReset') {
      values[activeEvent] = JSON.parse(JSON.stringify(DEFAULTS[activeEvent]));
      dirty = true;
      render();
      return;
    }
    if (event.target.id === 'communityMessageSave') saveGuild();
  }, true);

  document.addEventListener('input', (event) => {
    if (!event.target.closest?.('#communityMessagesRoot')) return;
    if (event.target.id === 'communityMessageText') {
      values[activeEvent].message = event.target.value;
      updatePreview();
    }
    dirty = true;
    const status = document.querySelector('#communityMessageStatus');
    if (status) status.textContent = 'Unsaved changes';
  });

  document.addEventListener('change', (event) => {
    if (event.target.id === 'guildSelect') {
      loadedGuildId = '';
      if (document.querySelector('[data-tab="community-messages"]')?.classList.contains('active')) loadGuild(true);
      return;
    }
    if (!event.target.closest?.('#communityMessagesRoot')) return;
    if (event.target.id === 'communityMessageEnabled') values[activeEvent].enabled = Boolean(event.target.checked);
    if (event.target.id === 'communityMessageChannel') values[activeEvent].channelId = event.target.value;
    dirty = true;
    const status = document.querySelector('#communityMessageStatus');
    if (status) status.textContent = 'Unsaved changes';
  });

  window.addEventListener('coinsprite:message-editor-ready', updatePreview);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensureTab, { once: true });
  else ensureTab();
  [0, 250, 750].forEach((delay) => setTimeout(ensureTab, delay));
})();
