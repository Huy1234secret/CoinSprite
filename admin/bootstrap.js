(() => {
  if (window.__coinSpriteAdminBootstrap) return;
  window.__coinSpriteAdminBootstrap = true;

  const FIELD_SELECTOR = 'input:not([id]):not([name]),select:not([id]):not([name]),textarea:not([id]):not([name])';
  const FIELD_MARKUP = /<(?:input|select|textarea)\b/i;
  const OWNER_STRAY_TEXT = '\\n';
  const MESSAGE_PREVIEW_SELECTOR = '.message-sticky-preview, .external-message-sticky-preview';
  const ALL_MESSAGE_TOKENS = [
    '<@mention>', '<mention>', '<username>', '<display_name>', '<display-name>', '<user-id>', '<user_id>',
    '<avatar_url>', '<avatar-url>', '<server>', '<server-name>', '<guild-name>', '<server-id>', '<guild-id>',
    '<member-count>', '<channel>', '<channel-name>', '<channel-id>', '<level>', '<previous-level>', '<previous_level>',
    '<currentlevel>', '<current_level>', '<message-link>', '<message-content>', '<moderation-case>', '<moderation-reason>',
    '<moderation-action>', '<severity>', '<translation-section>', '<blocked-domain>', '<blocked-url>', '<invite-code>',
    '<case-id>', '<case-type>', '<case-status>', '<case-source>', '<case-audit-events>', '<warning-count>',
    '<warning-case-list>', '<expires>', '<duration>', '<evidence>', '<appealable-status>', '<appeal-id>', '<appeal-url>',
    '<reviewer>', '<reviewer-note>', '<ticket_name>', '<reason>', '<status>', '<status-note>', '<uploaded-file-list>',
    '<roblox-username>', '<game>', '<giveaway-prize>', '<winner-count>', '<winner-list>', '<claim-time>', '<claimed-count>',
    '<claimed-users>', '<unclaimed-count>', '<reroll-time>', '<giveaway-host>', '<host-id>', '<giveaway-description>',
    '<giveaway-requirement>', '<giveaway-ends>', '<giveaway-list>', '<separator>', '<if<level>==10,"shown","hidden">',
  ];
  let fieldSequence = 0;
  let decorateScheduled = false;
  let domObserver = null;

  function installTabIconStyle() {
    if (document.getElementById('coinSpriteTabImageStyle')) return;
    const style = document.createElement('style');
    style.id = 'coinSpriteTabImageStyle';
    style.textContent = `
      .tabs { display: grid !important; gap: 8px !important; }
      .tabs .tab { display: flex !important; align-items: center !important; gap: 12px !important; min-height: 46px !important; border: 1px solid rgba(130, 150, 185, 0.24) !important; border-radius: 14px !important; background: rgba(15, 23, 37, 0.72) !important; color: var(--muted, #b7c2d6) !important; font-weight: 850 !important; transition: border-color .16s ease, background .16s ease, color .16s ease, transform .16s ease !important; }
      .tabs .tab:hover { border-color: rgba(135, 155, 255, 0.46) !important; background: rgba(28, 40, 63, 0.82) !important; color: var(--text, #f4f7fb) !important; }
      .tabs .tab.active { border-color: rgba(126, 137, 255, 0.82) !important; background: linear-gradient(135deg, rgba(88, 101, 242, 0.30), rgba(88, 101, 242, 0.12)) !important; color: #fff !important; box-shadow: inset 3px 0 0 rgba(126, 137, 255, 0.95) !important; }
      .tabs .tab > img.tab-icon,
      .tabs .tab > img.tab-image-icon,
      .tabs .tab > img.message-tab-icon { display: block !important; width: 30px !important; height: 30px !important; max-width: 30px !important; max-height: 30px !important; flex: 0 0 30px !important; box-sizing: border-box !important; object-fit: contain !important; object-position: center !important; border: 2px solid var(--tab-icon-border, rgba(120, 150, 190, 0.72)) !important; border-radius: 9px !important; background-color: var(--tab-icon-bg, rgba(80, 110, 150, 0.14)) !important; box-shadow: none !important; filter: none !important; opacity: 1 !important; padding: 3px !important; transform: none !important; }
      .tabs .tab[data-tab="leveling"] { --tab-icon-bg: rgba(87, 242, 135, 0.18); --tab-icon-border: rgba(87, 242, 135, 0.72); }
      .tabs .tab[data-tab="tickets"] { --tab-icon-bg: rgba(255, 76, 96, 0.18); --tab-icon-border: rgba(255, 76, 96, 0.72); }
      .tabs .tab[data-tab="messages"] { --tab-icon-bg: rgba(72, 149, 239, 0.20); --tab-icon-border: rgba(99, 184, 255, 0.72); }
      .tabs .tab[data-tab="data"] { --tab-icon-bg: rgba(185, 195, 210, 0.14); --tab-icon-border: rgba(205, 215, 230, 0.72); }
      .tabs .tab[data-tab="moderator"] { --tab-icon-bg: rgba(155, 89, 182, 0.18); --tab-icon-border: rgba(188, 120, 255, 0.72); }
      @media (max-width: 700px) { .tabs .tab > img.tab-icon, .tabs .tab > img.tab-image-icon, .tabs .tab > img.message-tab-icon { width: 26px !important; height: 26px !important; max-width: 26px !important; max-height: 26px !important; flex-basis: 26px !important; } }
    `;
    document.head.append(style);
  }

  function installModeratorCaseLayoutStyle() {
    if (document.getElementById('coinSpriteModeratorCaseLayoutStabilizer')) return;
    const style = document.createElement('style');
    style.id = 'coinSpriteModeratorCaseLayoutStabilizer';
    style.textContent = `
      body #moderatorRoot .case-layout-v3.case-detail { display: grid !important; gap: 12px !important; max-width: 980px !important; font-size: 14px !important; line-height: 1.35 !important; color: var(--text, #f2f5fb) !important; }
      body #moderatorRoot .case-layout-v3, body #moderatorRoot .case-layout-v3 * { box-sizing: border-box !important; }
      body #moderatorRoot .case-layout-v3 .panel { width: 100% !important; min-width: 0 !important; border: 1px solid rgba(255,255,255,.085) !important; border-radius: 9px !important; background: #2b3139 !important; box-shadow: none !important; }
      body #moderatorRoot .case-layout-v3 .case-actions-bar { display: flex !important; align-items: center !important; justify-content: space-between !important; gap: 12px !important; min-height: 44px !important; padding: 7px 12px 7px 18px !important; overflow: visible !important; }
      body #moderatorRoot .case-layout-v3 .case-actions-bar h3, body #moderatorRoot .case-layout-v3 .case-panel-title h3 { margin: 0 !important; font-size: 18px !important; line-height: 1.1 !important; font-weight: 900 !important; }
      body #moderatorRoot .case-layout-v3 .case-actions-bar > div { display: flex !important; flex-wrap: wrap !important; justify-content: flex-end !important; gap: 7px !important; }
      body #moderatorRoot .case-layout-v3 .button.small { width: auto !important; min-height: 30px !important; padding: 6px 11px !important; white-space: nowrap !important; }
      body #moderatorRoot .case-layout-v3 #caseDetailForm.case-layout-stack { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; gap: 12px !important; width: 100% !important; min-width: 0 !important; }
      body #moderatorRoot .case-layout-v3 .case-info-panel, body #moderatorRoot .case-layout-v3 .case-notes-panel, body #moderatorRoot .case-layout-v3 .case-edit-panel, body #moderatorRoot .case-layout-v3 .case-history-panel { padding: 16px 18px !important; }
      body #moderatorRoot .case-layout-v3 .case-panel-title { display: flex !important; align-items: flex-start !important; gap: 12px !important; margin: 0 0 13px !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row { display: grid !important; grid-template-columns: minmax(84px, 112px) minmax(0, 1fr) !important; gap: 14px !important; align-items: center !important; min-height: 36px !important; padding: 9px 0 !important; border-bottom: 1px solid rgba(255,255,255,.095) !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row:last-child { border-bottom: 0 !important; }
      body #moderatorRoot .case-layout-v3 .case-user-chip { display: grid !important; grid-template-columns: 32px minmax(0, 1fr) !important; align-items: center !important; gap: 9px !important; width: min(100%, 560px) !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; }
      body #moderatorRoot .case-layout-v3 .case-user-chip img, body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-fallback { width: 32px !important; height: 32px !important; max-width: 32px !important; max-height: 32px !important; border-radius: 50% !important; object-fit: cover !important; display: block !important; flex: 0 0 32px !important; }
      body #moderatorRoot .case-layout-v3 .case-user-copy strong, body #moderatorRoot .case-layout-v3 .case-user-copy small { display: block !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; }
      body #moderatorRoot .case-layout-v3 .case-notes-panel textarea, body #moderatorRoot .case-layout-v3 .case-edit-panel input, body #moderatorRoot .case-layout-v3 .case-edit-panel textarea { width: 100% !important; min-width: 0 !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,.13) !important; background: rgba(9,13,20,.78) !important; color: var(--text, #f2f5fb) !important; }
      body #moderatorRoot .case-layout-v3 .case-edit-grid { display: grid !important; grid-template-columns: minmax(110px, .34fr) minmax(220px, .66fr) !important; gap: 12px !important; margin: 0 !important; }
      @media (max-width: 760px) { body #moderatorRoot .case-layout-v3.case-detail { max-width: none !important; } body #moderatorRoot .case-layout-v3 .case-actions-bar, body #moderatorRoot .case-layout-v3 .case-history-panel summary { align-items: stretch !important; flex-direction: column !important; } body #moderatorRoot .case-layout-v3 .case-actions-bar > div { justify-content: flex-start !important; } body #moderatorRoot .case-layout-v3 .case-info-row, body #moderatorRoot .case-layout-v3 .case-edit-grid, body #moderatorRoot .case-layout-v3 .case-history-panel li { grid-template-columns: minmax(0, 1fr) !important; gap: 6px !important; align-items: start !important; } }
    `;
    document.head.append(style);
  }

  function installAdminQualityOfLifeStyle() {
    if (document.getElementById('coinSpriteLivePreviewTabPolish')) return;
    const style = document.createElement('style');
    style.id = 'coinSpriteLivePreviewTabPolish';
    style.textContent = `
      .mini-tabs,
      .message-section-tabs,
      .message-editor-tabs,
      .ticket-type-tabs,
      .moderator-workspace-tabs,
      .message-template-tabs { position: sticky !important; top: 0 !important; z-index: 30 !important; display: flex !important; flex-wrap: wrap !important; gap: 8px !important; align-items: center !important; padding: 10px 8px !important; margin: -10px -8px 14px !important; border: 1px solid rgba(118, 136, 170, 0.18) !important; border-radius: 18px !important; background: rgba(12, 18, 29, 0.86) !important; backdrop-filter: blur(14px) !important; box-shadow: 0 14px 26px rgba(0, 0, 0, 0.20) !important; }
      .mini-tabs button,
      .mini-tab,
      .message-section-tabs button,
      .message-editor-tabs button,
      .ticket-type-tabs button,
      .moderator-workspace-tabs button,
      .message-template-tabs button { min-height: 40px !important; border: 1px solid rgba(124, 143, 178, 0.26) !important; border-radius: 999px !important; padding: 0 18px !important; background: rgba(18, 28, 44, 0.72) !important; color: var(--muted, #aebad0) !important; font-weight: 850 !important; letter-spacing: .01em !important; box-shadow: inset 0 1px 0 rgba(255,255,255,.045) !important; }
      .mini-tabs button:hover,
      .mini-tab:hover,
      .message-section-tabs button:hover,
      .message-editor-tabs button:hover,
      .ticket-type-tabs button:hover,
      .moderator-workspace-tabs button:hover,
      .message-template-tabs button:hover { border-color: rgba(126, 137, 255, 0.62) !important; color: #fff !important; background: rgba(30, 42, 65, 0.9) !important; }
      .mini-tabs button.active,
      .mini-tab.active,
      .message-section-tabs button.active,
      .message-editor-tabs button.active,
      .ticket-type-tabs button.active,
      .moderator-workspace-tabs button.active,
      .message-template-tabs button.active { border-color: transparent !important; background: linear-gradient(135deg, #7e89ff, #5865f2) !important; color: #fff !important; box-shadow: 0 10px 22px rgba(88, 101, 242, .28), inset 0 1px 0 rgba(255,255,255,.20) !important; }
      .message-discord-preview,
      .shared-message-preview,
      .message-discord-body,
      .message-sticky-preview,
      .external-message-sticky-preview { overflow: visible !important; }
      .message-preview-container,
      .preview-container { position: relative !important; overflow: visible !important; }
      .message-preview-remove-container { position: absolute !important; z-index: 7 !important; top: -10px !important; right: -18px !important; display: grid !important; place-items: center !important; width: 24px !important; height: 24px !important; border: 1px solid rgba(190, 203, 225, 0.48) !important; border-radius: 8px !important; background: transparent !important; color: #dfe7f5 !important; font-size: 17px !important; line-height: 1 !important; font-weight: 900 !important; cursor: pointer !important; box-shadow: none !important; padding: 0 !important; }
      .message-preview-remove-container:hover,
      .message-preview-remove-container:focus-visible { border-color: rgba(250, 119, 112, 0.95) !important; color: #fa7770 !important; background: transparent !important; outline: none !important; }
      .message-root-content.message-root-empty { min-height: 1.45rem !important; display: block !important; margin: 0 0 7px !important; padding: 2px 0 !important; color: rgba(185, 195, 215, 0.45) !important; cursor: text !important; }
      .message-root-gap-line { min-height: 1.35rem !important; line-height: 1.35rem !important; }
      .message-sticky-preview > .message-add-container,
      .external-message-sticky-preview > .message-add-container,
      #levelUpPreview > .message-add-container { width: 100% !important; min-height: 50px !important; margin-top: 10px !important; border: 1px dashed rgba(185, 195, 215, 0.38) !important; border-radius: 14px !important; background: rgba(10, 15, 24, 0.42) !important; color: #dfe7f5 !important; font-weight: 900 !important; }
      .message-sticky-preview > .message-add-container:hover,
      .external-message-sticky-preview > .message-add-container:hover,
      #levelUpPreview > .message-add-container:hover { border-color: rgba(126, 137, 255, 0.68) !important; background: rgba(88, 101, 242, 0.12) !important; }
      .message-token-help { display: grid !important; gap: 7px !important; margin-top: 12px !important; padding: 10px !important; border: 1px solid rgba(88, 101, 242, 0.30) !important; border-radius: 13px !important; background: rgba(10, 16, 27, 0.50) !important; }
      .message-token-row { display: flex !important; flex-wrap: wrap !important; gap: 5px !important; max-height: 68px !important; overflow: auto !important; padding-right: 2px !important; }
      .message-token-pill { display: inline-flex !important; align-items: center !important; min-height: 22px !important; border: 1px solid rgba(126, 160, 220, 0.28) !important; border-radius: 999px !important; padding: 0 7px !important; background: rgba(13, 22, 36, 0.72) !important; color: #b8cdf8 !important; font: 700 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important; white-space: nowrap !important; }
      .message-token-usage { color: var(--muted, #aebad0) !important; font-size: 11px !important; line-height: 1.35 !important; }
      .message-token-usage code { font-size: 11px !important; }
    `;
    document.head.append(style);
  }

  function fieldHint(field) {
    const dataHint = Object.entries(field.dataset || {})
      .find(([key, value]) => value && /field|scope|index|permission|action|type/i.test(key))?.[1];
    const rawHint = dataHint || field.getAttribute('aria-label') || field.type || field.tagName || 'field';
    return String(rawHint)
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'field';
  }

  function identifyField(field) {
    if (!field?.matches?.(FIELD_SELECTOR)) return;
    fieldSequence += 1;
    field.name = `coinsprite-${fieldHint(field)}-${fieldSequence}`;
  }

  function identifyFields(root) {
    if (!root) return root;
    if (root.matches?.(FIELD_SELECTOR)) identifyField(root);
    root.querySelectorAll?.(FIELD_SELECTOR).forEach(identifyField);
    return root;
  }

  function cleanupOwnerPanelTextNodes(root = document.body) {
    const start = root?.nodeType === Node.ELEMENT_NODE ? root : document.body;
    if (!start) return;
    const skipTags = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || skipTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        return String(node.nodeValue || '').trim() === OWNER_STRAY_TEXT ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => node.remove());
  }

  function rootChildrenHaveAction(preview, action) {
    return [...preview.children].some((child) => child.matches?.(`[data-message-action="${action}"].message-add-container`));
  }

  function createRootGapLine() {
    const line = document.createElement('div');
    line.className = 'message-preview-line message-preview-empty message-root-gap-line';
    line.setAttribute('aria-hidden', 'true');
    line.innerHTML = '&nbsp;';
    return line;
  }

  function createRootGapHost() {
    const root = document.createElement('div');
    root.className = 'message-root-content message-root-empty';
    root.dataset.messageAction = 'preview-root-text';
    root.title = 'Add text outside the container';
    root.append(createRootGapLine());
    return root;
  }

  function ensureRootGap(preview) {
    const bodies = new Set([
      ...preview.querySelectorAll('.message-discord-body'),
      ...preview.querySelectorAll('#levelUpPreview'),
    ]);
    bodies.forEach((body) => {
      const firstContainer = body.querySelector(':scope > .message-preview-container, :scope > .preview-container')
        || body.querySelector('.message-preview-container, .preview-container');
      if (!firstContainer) return;
      let root = firstContainer.previousElementSibling?.classList?.contains('message-root-content') ? firstContainer.previousElementSibling : null;
      if (!root) {
        root = createRootGapHost();
        firstContainer.before(root);
      }
      if (!String(root.textContent || '').trim() || String(root.textContent || '').trim() === 'Add text outside the container') {
        root.classList.add('message-root-empty');
        root.replaceChildren(createRootGapLine());
      }
      root.dataset.messageAction ||= 'preview-root-text';
      root.title ||= 'Add text outside the container';
    });
  }

  function tokenHelpElement() {
    const help = document.createElement('div');
    help.className = 'message-token-help';
    help.dataset.tokenHelp = 'true';
    const list = document.createElement('div');
    list.className = 'message-token-row';
    ALL_MESSAGE_TOKENS.forEach((token) => {
      const chip = document.createElement('span');
      chip.className = 'message-token-pill';
      chip.textContent = token;
      list.append(chip);
    });
    const usage = document.createElement('div');
    usage.className = 'message-token-usage';
    usage.innerHTML = '<strong>Usage:</strong> Type a token inside any message box. <code>&lt;separator&gt;</code> creates a divider; conditions use <code>&lt;if&lt;level&gt;==10,&quot;shown&quot;,&quot;hidden&quot;&gt;</code>.';
    help.append(list, usage);
    return help;
  }

  function ensurePreviewTokenHelp(preview) {
    if (!preview || preview.querySelector(':scope > [data-token-help="true"]')) return;
    preview.append(tokenHelpElement());
  }

  function ensureAddContainerButton(preview) {
    const levelPreview = preview.querySelector('#levelUpPreview');
    if (levelPreview && !levelPreview.querySelector('#levelUpAddContainer')) {
      const add = document.createElement('button');
      add.id = 'levelUpAddContainer';
      add.type = 'button';
      add.className = 'button subtle message-add-container';
      add.textContent = '+ Add container';
      levelPreview.append(add);
    }
    if (preview.closest('#messageTemplatesRoot') && !rootChildrenHaveAction(preview, 'add-container')) {
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'button subtle message-add-container';
      add.dataset.messageAction = 'add-container';
      add.textContent = '+ Add container';
      preview.append(add);
    }
  }

  function ensurePreviewRemoveButtons(preview) {
    const containers = new Set([
      ...preview.querySelectorAll('.message-preview-container'),
      ...preview.querySelectorAll('#levelUpPreviewContainer'),
    ]);
    containers.forEach((container) => {
      if (!container || container.hidden || container.querySelector(':scope > .message-preview-remove-container')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'message-preview-remove-container';
      button.title = 'Remove container';
      button.setAttribute('aria-label', 'Remove container');
      button.textContent = '×';
      const index = container.dataset.previewContainerIndex || '0';
      if (preview.closest('#messageTemplatesRoot')) {
        button.dataset.messageAction = 'remove-container';
        button.dataset.index = index;
      } else if (container.id === 'levelUpPreviewContainer' || preview.querySelector('#levelUpPreview')) {
        button.dataset.levelupRemoveContainer = 'true';
      }
      container.append(button);
    });
  }

  function decorateMessageLiveEditors(root = document) {
    const previews = new Set();
    if (root.matches?.(MESSAGE_PREVIEW_SELECTOR)) previews.add(root);
    root.querySelectorAll?.(MESSAGE_PREVIEW_SELECTOR).forEach((preview) => previews.add(preview));
    previews.forEach((preview) => {
      ensureRootGap(preview);
      ensureAddContainerButton(preview);
      ensurePreviewRemoveButtons(preview);
    });
  }

  function scheduleDecorate(root = document) {
    if (decorateScheduled) return;
    decorateScheduled = true;
    requestAnimationFrame(() => {
      decorateScheduled = false;
      cleanupOwnerPanelTextNodes(root);
      decorateMessageLiveEditors(root);
    });
  }

  function dispatchFormUpdate(field) {
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function clearLevelUpContainer() {
    ['#levelUpContent', '[name="xp.levelUpMessage.thumbnailUrl"]', '[name="xp.levelUpMessage.imageUrl"]'].forEach((selector) => {
      const field = document.querySelector(selector);
      if (!field) return;
      field.value = '';
      dispatchFormUpdate(field);
    });
    scheduleDecorate(document);
  }

  function showLevelUpContainerStarter() {
    const field = document.querySelector('#levelUpContent');
    if (!field) return;
    if (!String(field.value || '').trim()) field.value = '## Container message\nWrite your container message here.';
    dispatchFormUpdate(field);
    field.focus({ preventScroll: true });
    scheduleDecorate(document);
  }

  window.coinSpriteIdentifyFormFields = identifyFields;

  installTabIconStyle();
  installModeratorCaseLayoutStyle();
  installAdminQualityOfLifeStyle();

  document.addEventListener('click', (event) => {
    const removeLevelUp = event.target.closest?.('[data-levelup-remove-container]');
    if (removeLevelUp) {
      event.preventDefault();
      event.stopPropagation();
      clearLevelUpContainer();
      return;
    }
    const addLevelUp = event.target.closest?.('#levelUpAddContainer');
    if (addLevelUp) {
      event.preventDefault();
      event.stopPropagation();
      showLevelUpContainerStarter();
    }
  }, true);

  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (innerHtmlDescriptor?.get && innerHtmlDescriptor?.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: innerHtmlDescriptor.configurable,
      enumerable: innerHtmlDescriptor.enumerable,
      get: innerHtmlDescriptor.get,
      set(value) {
        if (this instanceof HTMLTemplateElement || typeof value !== 'string' || !FIELD_MARKUP.test(value)) {
          innerHtmlDescriptor.set.call(this, value);
          scheduleDecorate(this);
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(this);
        const fragment = range.createContextualFragment(value);
        identifyFields(fragment);
        this.replaceChildren(fragment);
        scheduleDecorate(this);
      },
    });
  }

  const appendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function patchedAppendChild(node) {
    const result = appendChild.call(this, identifyFields(node));
    if (node instanceof Node) scheduleDecorate(node.nodeType === Node.ELEMENT_NODE ? node : this);
    return result;
  };

  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function patchedInsertBefore(node, referenceNode) {
    const result = insertBefore.call(this, identifyFields(node), referenceNode);
    if (node instanceof Node) scheduleDecorate(node.nodeType === Node.ELEMENT_NODE ? node : this);
    return result;
  };

  const replaceChild = Node.prototype.replaceChild;
  Node.prototype.replaceChild = function patchedReplaceChild(node, oldNode) {
    const result = replaceChild.call(this, identifyFields(node), oldNode);
    if (node instanceof Node) scheduleDecorate(node.nodeType === Node.ELEMENT_NODE ? node : this);
    return result;
  };

  for (const methodName of ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren']) {
    const nativeMethod = Element.prototype[methodName];
    if (typeof nativeMethod !== 'function') continue;
    Element.prototype[methodName] = function patchedInsertion(...nodes) {
      nodes.forEach((node) => {
        if (node instanceof Node) identifyFields(node);
      });
      const result = nativeMethod.apply(this, nodes);
      scheduleDecorate(this);
      return result;
    };
  }

  function bootDom() {
    installTabIconStyle();
    installModeratorCaseLayoutStyle();
    installAdminQualityOfLifeStyle();
    identifyFields(document);
    cleanupOwnerPanelTextNodes(document.body);
    decorateMessageLiveEditors(document);
    if (!domObserver && document.body) {
      domObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE) identifyFields(node);
          });
        }
        scheduleDecorate(document);
      });
      domObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootDom, { once: true });
  else bootDom();
})();