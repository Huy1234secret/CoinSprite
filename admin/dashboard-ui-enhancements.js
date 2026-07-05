(() => {
  if (window.__coinSpriteDashboardUiEnhancements) return;
  window.__coinSpriteDashboardUiEnhancements = true;

  const TOKENS = Object.freeze([
    '<@mention>', '<mention>', '<username>', '<display-name>', '<display_name>', '<user-id>', '<user_id>', '<avatar_url>',
    '<server>', '<server-name>', '<guild-name>', '<guild-id>', '<channel>', '<channel-name>', '<channel-id>', '<member-count>',
    '<level>', '<previous_level>', '<ticket_id>', '<ticket_name>', '<form-answer>', '<appeal-id>', '<case-id>', '<case-reason>',
    '<punishment>', '<public-note>', '<form-answers>', '<evidence>', '<moderation-action>', '<moderation-action-label>',
    '<moderation-reason>', '<moderation-case>', '<severity>', '<message-link>', '<message-content>', '<duration>', '<expires>',
    '<appealable>', '<appealable-status>', '<warning-count>', '<active-warnings>', '<threshold>', '<blocked-domain>',
    '<blocked-url>', '<invite-code>', '<translation-section>', '<separator>',
  ]);
  const PREVIEW_TOKENS = Object.freeze({
    '@mention': '@CoinSprite User', mention: '@CoinSprite User', username: 'CoinSpriteUser',
    'display-name': 'CoinSprite User', display_name: 'CoinSprite User', 'user-id': '123456789012345678',
    user_id: '123456789012345678', avatar_url: '/admin/bot-avatar.png', server: 'CoinSprite Server',
    'server-name': 'CoinSprite Server', 'guild-name': 'CoinSprite Server', 'guild-id': '123456789012345678',
    channel: '#general', 'channel-name': 'general', 'channel-id': '234567890123456789', 'member-count': '1,234',
    level: '10', previous_level: '9', ticket_id: 'T-000001', ticket_name: 'Support', 'form-answer': 'Example answer',
    'appeal-id': 'A-000001', 'case-id': 'W-000001', 'case-reason': 'Example reason', punishment: 'mute',
    'public-note': 'No public note', 'form-answers': 'Example response', evidence: 'evidence.png',
    'moderation-action': 'mute', 'moderation-action-label': 'muted', 'moderation-reason': 'Example reason',
    'moderation-case': 'Spam', severity: '8', 'message-link': 'View message', 'message-content': 'Example message',
    duration: '1 day', expires: 'tomorrow', appealable: 'Yes', 'appealable-status': 'Yes',
    'warning-count': '3', 'active-warnings': '3', threshold: '3', 'blocked-domain': 'example.test',
    'blocked-url': 'https://example.test', 'invite-code': 'example', 'translation-section': '',
  });

  let levelEditor = null;
  let levelValue = null;

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
  })[character]);
  const clone = (value) => JSON.parse(JSON.stringify(value || {}));

  function installStyles() {
    if (document.querySelector('#dashboardUiEnhancementStyles')) return;
    const style = document.createElement('style');
    style.id = 'dashboardUiEnhancementStyles';
    style.textContent = `
      .dashboard-sticky-tabs {
        position: sticky !important;
        top: 0;
        z-index: 70;
        margin: 0 0 18px !important;
        padding: 10px !important;
        border: 1px solid rgba(148,163,184,.2) !important;
        border-radius: 14px !important;
        background: rgba(7,11,19,.92) !important;
        box-shadow: 0 12px 34px rgba(0,0,0,.28), inset 0 1px rgba(255,255,255,.035);
        backdrop-filter: blur(18px);
      }
      .dashboard-sticky-tabs > button {
        min-height: 42px;
        border-radius: 999px !important;
        font-weight: 800;
        transition: transform .15s ease, border-color .15s ease, background .15s ease;
      }
      .dashboard-sticky-tabs > button:hover { transform: translateY(-1px); }
      .dashboard-placeholder-reference {
        display: grid;
        gap: 8px;
        width: 100%;
        margin-top: 12px;
        padding: 10px 12px;
        border: 1px solid rgba(148,163,184,.18);
        border-radius: 10px;
        background: rgba(7,11,19,.5);
      }
      .dashboard-placeholder-token-row {
        display: flex;
        gap: 6px;
        overflow-x: auto;
        padding-bottom: 3px;
        scrollbar-width: thin;
      }
      .dashboard-placeholder-token {
        flex: 0 0 auto;
        min-height: 26px;
        padding: 3px 7px;
        border: 1px solid rgba(124,131,255,.32);
        border-radius: 7px;
        background: transparent;
        color: #b9c9e3;
        font: 700 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace;
        cursor: pointer;
      }
      .dashboard-placeholder-token:hover { border-color: var(--primary,#7c83ff); color: #fff; }
      .dashboard-placeholder-usage {
        color: var(--muted,#93a4bc);
        font-size: 11px;
        line-height: 1.45;
      }
      .dashboard-placeholder-usage code { color: #dce4ff; }
      .dashboard-legacy-token-list, .rich-template-editor > .rich-format-bar { display: none !important; }
      .rich-preview-stage { padding-right: 54px !important; }
      .rich-container-frame { position: relative; }
      .rich-container-tools [data-rich-action="remove"],
      .message-preview-container > .preview-container-remove {
        position: absolute !important;
        top: 0 !important;
        right: -42px !important;
        z-index: 8;
        width: 32px !important;
        height: 32px !important;
        min-height: 32px !important;
        padding: 0 !important;
        border: 1px solid rgba(148,163,184,.42) !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: #aeb9ca !important;
        box-shadow: none !important;
      }
      .rich-container-tools [data-rich-action="remove"]:hover,
      .message-preview-container > .preview-container-remove:hover {
        border-color: var(--danger,#fb7185) !important;
        color: var(--danger,#fb7185) !important;
        background: transparent !important;
      }
      .rich-add-container, .message-add-container {
        min-height: 58px !important;
        border: 1px dashed rgba(148,163,184,.42) !important;
        border-radius: 12px !important;
        background: transparent !important;
        color: var(--muted,#93a4bc) !important;
        font-weight: 850 !important;
      }
      .rich-add-container:hover, .message-add-container:hover {
        border-color: var(--primary,#7c83ff) !important;
        color: #fff !important;
      }
      .message-root-content.message-root-empty,
      .rich-template-editor .message-root-content.message-root-empty {
        display: block !important;
        min-height: 1.45em !important;
        margin-bottom: 8px !important;
        border-radius: 5px;
      }
      .message-root-content.message-root-empty:hover {
        outline: 1px dashed rgba(124,131,255,.45);
        outline-offset: 3px;
      }
      .level-up-rich-host > .panel-heading { display: none; }
      .level-up-rich-host #levelUpPreview { width: 100%; }
      .level-up-rich-host .rich-live-panel { border: 0; padding: 0; background: transparent; }
      @media (max-width: 760px) {
        .dashboard-sticky-tabs { top: 0; padding: 7px !important; overflow-x: auto; }
        .dashboard-sticky-tabs > button { flex: 0 0 auto; }
        .rich-preview-stage { padding-right: 46px !important; }
        .rich-container-tools [data-rich-action="remove"],
        .message-preview-container > .preview-container-remove { right: -36px !important; }
      }
    `;
    document.head.append(style);
  }

  function placeholderReference() {
    const node = document.createElement('section');
    node.className = 'dashboard-placeholder-reference';
    node.setAttribute('aria-label', 'Available message placeholders');
    node.innerHTML = '<div class="dashboard-placeholder-token-row">'
      + TOKENS.map((token) => '<button class="dashboard-placeholder-token" type="button" data-dashboard-token="' + escapeHtml(token) + '">' + escapeHtml(token) + '</button>').join('')
      + '</div><div class="dashboard-placeholder-usage"><strong>Usage:</strong> click a syntax to insert it into the active message. Use <code>&lt;separator&gt;</code> for a divider. Conditional example: <code>&lt;if&lt;level&gt;==10,&quot;shown&quot;,&quot;&quot;&gt;</code>.</div>';
    return node;
  }

  function isLivePreviewPanel(node) {
    if (!(node instanceof Element)) return false;
    const heading = node.querySelector(':scope > .panel-heading h3, :scope > .rich-live-head h3');
    return heading?.textContent?.trim().toLowerCase() === 'live preview';
  }

  function addPlaceholderReferences(root = document) {
    const candidates = root.querySelectorAll?.('.rich-live-panel,.message-sticky-preview,.external-message-sticky-preview,.preview-panel') || [];
    for (const panel of candidates) {
      if (!isLivePreviewPanel(panel) || panel.querySelector(':scope > .dashboard-placeholder-reference')) continue;
      panel.append(placeholderReference());
    }
    root.querySelectorAll?.('.template-tokens,#levelUpTokens,.rich-format-bar').forEach((node) => {
      if (node.closest('.message-builder,.ticket-message-builder,.rich-template-editor')) node.classList.add('dashboard-legacy-token-list');
    });
  }

  function markStickyTabs(root = document) {
    const selectors = [
      '.mini-tabs', '.ticket-main-tabs', '.ticket-type-tabs', '.message-editor-tabs',
      '.moderator-workspace-tabs', '.community-message-tabs', '.appeal-settings-tabs',
    ].join(',');
    root.querySelectorAll?.(selectors).forEach((tabs) => {
      if (!tabs.closest('.sidebar') && tabs.querySelector(':scope > button')) tabs.classList.add('dashboard-sticky-tabs');
    });
    root.querySelectorAll?.('.tab-panel nav').forEach((tabs) => {
      if (!tabs.closest('.sidebar') && tabs.querySelectorAll(':scope > button').length > 1) tabs.classList.add('dashboard-sticky-tabs');
    });
  }

  function removeEscapedNewlineArtifacts(root = document) {
    for (const scope of root.querySelectorAll?.('.sidebar,.topbar,#ownerPanel') || []) {
      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      const remove = [];
      while (walker.nextNode()) {
        const text = String(walker.currentNode.nodeValue || '').trim();
        if (text && /^(?:\\n)+$/.test(text)) remove.push(walker.currentNode);
      }
      remove.forEach((node) => node.remove());
    }
  }

  function containerFromLegacyFields() {
    return {
      id: 'level-up-container',
      text: document.querySelector('#levelUpContent')?.value || '',
      accentColor: document.querySelector('input[name="xp.levelUpMessage.accentColor"]')?.value || '#57F287',
      thumbnailUrl: document.querySelector('input[name="xp.levelUpMessage.thumbnailUrl"]')?.value || '<avatar_url>',
      imageUrl: document.querySelector('input[name="xp.levelUpMessage.imageUrl"]')?.value || '',
    };
  }

  function levelEditorValue(config) {
    const message = config?.xp?.levelUpMessage || {};
    const containers = Object.prototype.hasOwnProperty.call(message, 'containers') && Array.isArray(message.containers)
      ? message.containers
      : [containerFromLegacyFields()];
    return {
      content: String(message.outsideContent || ''),
      containers: containers.map((container, index) => ({
        id: String(container?.id || 'level-up-container-' + (index + 1)),
        text: String(container?.text ?? (index === 0 ? message.content || '' : '')),
        accentColor: String(container?.accentColor || (index === 0 ? message.accentColor || '#57F287' : '#5865F2')),
        thumbnailUrl: String(container?.thumbnailUrl ?? (index === 0 ? message.thumbnailUrl || '' : '')),
        imageUrl: String(container?.imageUrl ?? (index === 0 ? message.imageUrl || '' : '')),
      })),
    };
  }

  function syncLegacyLevelFields(value) {
    const first = value.containers[0] || { text: '', accentColor: '#57F287', thumbnailUrl: '', imageUrl: '' };
    const values = {
      '#levelUpContent': first.text,
      'input[name="xp.levelUpMessage.accentColor"]': first.accentColor,
      'input[name="xp.levelUpMessage.thumbnailUrl"]': first.thumbnailUrl,
      'input[name="xp.levelUpMessage.imageUrl"]': first.imageUrl,
    };
    for (const [selector, next] of Object.entries(values)) {
      const field = document.querySelector(selector);
      if (field) field.value = next;
    }
  }

  function setLevelValue(config) {
    levelValue = levelEditorValue(config);
    syncLegacyLevelFields(levelValue);
    levelEditor?.setValue(levelValue);
  }

  function mountLevelEditor() {
    if (levelEditor || !window.CoinSpriteRichEditor) return;
    const host = document.querySelector('#levelUpPreview');
    if (!host) return;
    const aside = host.closest('.message-sticky-preview');
    aside?.classList.add('level-up-rich-host');
    host.replaceChildren();
    const root = document.createElement('div');
    root.id = 'levelUpRichMessageEditor';
    host.append(root);
    levelValue = levelEditorValue(typeof state !== 'undefined' ? state.savedConfig : null);
    levelEditor = window.CoinSpriteRichEditor.mount(root, {
      value: levelValue,
      tokens: [],
      previewTokens: PREVIEW_TOKENS,
      onChange(next) {
        levelValue = next;
        syncLegacyLevelFields(next);
        if (typeof refreshDirtyState === 'function') refreshDirtyState();
      },
    });
    addPlaceholderReferences(aside || root);
  }

  function installLevelStateBridges() {
    if (typeof applyTabFromConfig === 'function' && !applyTabFromConfig.__dashboardContainers) {
      const nativeApply = applyTabFromConfig;
      const wrapped = function dashboardApplyTab(tabName, config) {
        const result = nativeApply.apply(this, arguments);
        if (tabName === 'leveling') queueMicrotask(() => setLevelValue(config));
        return result;
      };
      wrapped.__dashboardContainers = true;
      applyTabFromConfig = wrapped;
    }

    if (typeof collectTabState === 'function' && !collectTabState.__dashboardContainers) {
      const nativeCollectState = collectTabState;
      const wrapped = function dashboardCollectTabState(tabName) {
        const snapshot = nativeCollectState.apply(this, arguments);
        if (tabName !== 'leveling') return snapshot;
        return { ...snapshot, levelUpRichMessage: clone(levelValue || levelEditor?.getValue?.() || {}) };
      };
      wrapped.__dashboardContainers = true;
      collectTabState = wrapped;
    }

    if (typeof collectPatch === 'function' && !collectPatch.__dashboardContainers) {
      const nativeCollectPatch = collectPatch;
      const wrapped = function dashboardCollectPatch() {
        const patch = nativeCollectPatch.apply(this, arguments);
        const current = clone(levelValue || levelEditor?.getValue?.() || { content: '', containers: [] });
        const first = current.containers?.[0] || { text: '', accentColor: '#57F287', thumbnailUrl: '', imageUrl: '' };
        patch.xp ||= {};
        patch.xp.levelUpMessage = {
          ...(patch.xp.levelUpMessage || {}),
          outsideContent: current.content || '',
          content: first.text || '',
          accentColor: first.accentColor || '#57F287',
          thumbnailUrl: first.thumbnailUrl || '',
          imageUrl: first.imageUrl || '',
          containers: current.containers || [],
        };
        return patch;
      };
      wrapped.__dashboardContainers = true;
      collectPatch = wrapped;
    }
  }

  function insertToken(token, button) {
    const scope = button.closest('.rich-template-editor,.message-builder,.ticket-message-builder,.panel,.tab-panel') || document;
    if (window.CoinSpriteInlineMessageEditor?.insertToken?.(token, scope)) return;
    const active = document.activeElement;
    const field = active?.matches?.('textarea,input[type="text"],[contenteditable="true"]')
      ? active
      : scope.querySelector('textarea,[contenteditable="true"]');
    if (!field) return;
    if (field.isContentEditable) {
      field.focus();
      document.execCommand('insertText', false, token);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const start = Number.isInteger(field.selectionStart) ? field.selectionStart : field.value.length;
    const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
    field.setRangeText(token, start, end, 'end');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function enhance(root = document) {
    installStyles();
    mountLevelEditor();
    installLevelStateBridges();
    markStickyTabs(root);
    addPlaceholderReferences(root);
    removeEscapedNewlineArtifacts(root);
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest?.('[data-dashboard-token]');
    if (button) insertToken(button.dataset.dashboardToken, button);
  });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      enhance(document);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('coinsprite:rich-editor-ready', () => enhance(document));
  enhance(document);
})();