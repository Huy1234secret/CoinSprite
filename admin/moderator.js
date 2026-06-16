(() => {
  if (window.__coinSpriteModeratorTab) return;
  window.__coinSpriteModeratorTab = true;

  const DEFAULT_ALERT_TEMPLATE_ID = 'default-ai-moderation-alert';
  const MODERATOR_TAB_HTML = '<span class="tab-icon-frame" aria-hidden="true"><img class="tab-icon" src="/images/moderator.png" alt=""></span><span>Moderator</span>';
  const moderatorState = {
    enabled: false,
    logChannelId: '',
    scanChannelIds: [],
    alertTemplateId: DEFAULT_ALERT_TEMPLATE_ID,
  };

  function ensureModeratorTab() {
    TAB_NAMES.moderator = 'Moderator';
    const tabs = document.querySelector('#tabList');
    if (tabs) {
      const existing = tabs.querySelector('[data-tab="moderator"]');
      if (existing) {
        if (!existing.querySelector('.tab-icon-frame')) existing.innerHTML = MODERATOR_TAB_HTML;
      } else {
        const tab = document.createElement('button');
        tab.className = 'tab';
        tab.type = 'button';
        tab.dataset.tab = 'moderator';
        tab.innerHTML = MODERATOR_TAB_HTML;
        (tabs.querySelector('[data-tab="messages"]') || tabs.querySelector('[data-tab="games"]') || tabs.lastElementChild)?.before(tab);
      }
    }

    const form = document.querySelector('#configForm');
    if (form && !form.querySelector('[data-panel="moderator"]')) {
      const panel = document.createElement('section');
      panel.className = 'tab-panel';
      panel.dataset.panel = 'moderator';
      panel.innerHTML = '<div id="moderatorRoot"></div>';
      (form.querySelector('[data-panel="messages"]') || form.querySelector('[data-panel="games"]') || form.lastElementChild)?.before(panel);
    }
  }

  function uniqueIds(value) {
    return [...new Set((Array.isArray(value) ? value : []).map(String).filter(Boolean))];
  }

  function normalizeModeration(config = {}) {
    const ai = config.moderation?.ai || {};
    return {
      enabled: Boolean(ai.enabled),
      logChannelId: String(ai.logChannelId || ''),
      scanChannelIds: uniqueIds(ai.scanChannelIds),
      alertTemplateId: String(ai.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID),
    };
  }

  function textChannelOptions() {
    return channelOptions().filter((option) => !['category', 'voice'].includes(option.optionType));
  }

  function renderModerator() {
    ensureModeratorTab();
    const root = document.querySelector('#moderatorRoot');
    if (!root) return;
    const scanCount = moderatorState.scanChannelIds.length;
    root.innerHTML = `
      <div class="moderator-shell">
        <nav class="mini-tabs" aria-label="Moderator settings">
          <button class="mini-tab active" type="button">AI moderation</button>
        </nav>
        <div class="moderator-status-grid">
          <div class="moderator-stat"><span class="field-label">Status</span><strong>${moderatorState.enabled ? 'Enabled' : 'Disabled'}</strong></div>
          <div class="moderator-stat"><span class="field-label">Scan channels</span><strong>${scanCount || 'All'}</strong></div>
          <div class="moderator-stat"><span class="field-label">Alert template</span><strong>Default</strong></div>
        </div>
        <div class="panel moderator-ai-panel">
          <div class="panel-heading">
            <h3>AI moderation</h3>
            <p>Review member messages, translate non-English text to English, and alert staff when abusive language is detected.</p>
          </div>
          <label class="checkline"><input id="moderationAiEnabled" type="checkbox" ${moderatorState.enabled ? 'checked' : ''}> Enable AI moderation checks</label>
          <div class="settings-grid">
            <div class="picker-field"><span class="field-label">Scan channels</span><div id="moderationScanChannelsMount"></div></div>
            <div class="picker-field"><span class="field-label">Log channel</span><div id="moderationLogChannelMount"></div></div>
          </div>
          <div class="moderator-template-note">If no scan channels are selected, AI moderation checks every text channel. Uses the bot default message <strong>Default: AI moderation alert</strong> in the Message tab. Edit that template to change staff alerts. Supported placeholders include <code>&lt;@mention&gt;</code>, <code>&lt;user-id&gt;</code>, <code>&lt;channel&gt;</code>, <code>&lt;severity&gt;</code>, <code>&lt;moderation-reason&gt;</code>, <code>&lt;matched-terms&gt;</code>, <code>&lt;original-language&gt;</code>, <code>&lt;english-translation&gt;</code>, and <code>&lt;message-link&gt;</code>.</div>
        </div>
      </div>
    `;

    const enabled = root.querySelector('#moderationAiEnabled');
    enabled?.addEventListener('change', () => {
      moderatorState.enabled = Boolean(enabled.checked);
      renderModerator();
      refreshDirtyState();
    });

    const scanMount = root.querySelector('#moderationScanChannelsMount');
    if (scanMount) {
      renderPicker(scanMount, textChannelOptions(), moderatorState.scanChannelIds, {
        multiple: true,
        type: 'channel',
        placeholder: 'Select channels to scan',
        onChange: (value) => {
          moderatorState.scanChannelIds = uniqueIds(value);
          renderModerator();
          refreshDirtyState();
        },
      });
    }

    const logMount = root.querySelector('#moderationLogChannelMount');
    if (logMount) {
      renderPicker(logMount, textChannelOptions(), moderatorState.logChannelId, {
        type: 'channel',
        placeholder: 'Select staff alert channel',
        onChange: (value) => {
          moderatorState.logChannelId = value;
          renderModerator();
          refreshDirtyState();
        },
      });
    }
  }

  function moderationSnapshot() {
    return {
      enabled: Boolean(moderatorState.enabled),
      logChannelId: moderatorState.logChannelId || '',
      scanChannelIds: uniqueIds(moderatorState.scanChannelIds),
      alertTemplateId: moderatorState.alertTemplateId || DEFAULT_ALERT_TEMPLATE_ID,
    };
  }

  ensureModeratorTab();

  const nativeApplyTabFromConfig = applyTabFromConfig;
  applyTabFromConfig = function moderatorApplyTab(tabName, config) {
    if (tabName === 'moderator') {
      Object.assign(moderatorState, normalizeModeration(config));
      renderModerator();
      return;
    }
    nativeApplyTabFromConfig(tabName, config);
  };

  const nativeCollectTabState = collectTabState;
  collectTabState = function moderatorCollectTab(tabName) {
    if (tabName === 'moderator') return moderationSnapshot();
    return nativeCollectTabState(tabName);
  };

  const nativeCollectPatch = collectPatch;
  collectPatch = function moderatorCollectPatch() {
    const patch = nativeCollectPatch();
    patch.moderation = {
      ...(patch.moderation || {}),
      ai: moderationSnapshot(),
    };
    return patch;
  };

  const nativeSetActiveTab = setActiveTab;
  setActiveTab = function moderatorSetActiveTab(tabName) {
    nativeSetActiveTab(tabName);
    if (tabName === 'moderator') queueMicrotask(renderModerator);
  };

  if (state.savedConfig) {
    Object.assign(moderatorState, normalizeModeration(state.savedConfig));
    renderModerator();
    captureSavedSnapshots();
    refreshDirtyState();
  }
})();
