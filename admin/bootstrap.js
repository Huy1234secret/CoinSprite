(() => {
  if (window.__coinSpriteAdminBootstrap) return;
  window.__coinSpriteAdminBootstrap = true;

  const FIELD_SELECTOR = 'input:not([id]):not([name]),select:not([id]):not([name]),textarea:not([id]):not([name])';
  const FIELD_MARKUP = /<(?:input|select|textarea)\b/i;
  let fieldSequence = 0;

  function installTabIconStyle() {
    if (document.getElementById('coinSpriteTabImageStyle')) return;
    const style = document.createElement('style');
    style.id = 'coinSpriteTabImageStyle';
    style.textContent = `
      .tabs .tab[data-tab="leveling"],
      .tabs .tab[data-tab="data"],
      .tabs .tab[data-tab="tickets"],
      .tabs .tab[data-tab="moderator"],
      .tabs .tab[data-tab="messages"] { display: flex !important; align-items: center !important; gap: 12px !important; }
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
      body #moderatorRoot .case-layout-v3 .case-panel-title > span:first-child { width: 22px !important; min-width: 22px !important; height: 22px !important; display: grid !important; place-items: center !important; font-size: 15px !important; line-height: 1 !important; }
      body #moderatorRoot .case-layout-v3 .case-panel-title p { margin: 3px 0 0 !important; max-width: 720px !important; color: var(--muted, #b7bdc8) !important; font-size: 12px !important; line-height: 1.35 !important; }
      body #moderatorRoot .case-layout-v3 .case-info-panel dl { display: grid !important; margin: 0 !important; padding: 0 !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row { display: grid !important; grid-template-columns: minmax(84px, 112px) minmax(0, 1fr) !important; gap: 14px !important; align-items: center !important; min-height: 36px !important; padding: 9px 0 !important; border-bottom: 1px solid rgba(255,255,255,.095) !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row:last-child { border-bottom: 0 !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row dt { margin: 0 !important; color: #fff !important; font-size: 13px !important; font-weight: 900 !important; line-height: 1.25 !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row dd { display: grid !important; gap: 2px !important; min-width: 0 !important; margin: 0 !important; color: #f2f5fb !important; overflow: hidden !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row dd > div { min-width: 0 !important; word-break: normal !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row dd > div:not(.case-user-chip) { overflow-wrap: anywhere !important; }
      body #moderatorRoot .case-layout-v3 .case-info-row small, body #moderatorRoot .case-layout-v3 .case-muted-text { color: var(--muted, #b7bdc8) !important; font-size: 11px !important; line-height: 1.25 !important; }
      body #moderatorRoot .case-layout-v3 strong, body #moderatorRoot .case-layout-v3 code { color: #fff !important; font-weight: 850 !important; }
      body #moderatorRoot .case-layout-v3 .case-linkish { color: #00b0f4 !important; font-weight: 800 !important; overflow-wrap: anywhere !important; }
      body #moderatorRoot .case-layout-v3 .case-state-line { display: inline-flex !important; align-items: center !important; gap: 7px !important; width: fit-content !important; }
      body #moderatorRoot .case-layout-v3 .case-user-chip { display: grid !important; grid-template-columns: 32px minmax(0, 1fr) !important; align-items: center !important; gap: 9px !important; width: min(100%, 560px) !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; overflow-wrap: normal !important; word-break: normal !important; }
      body #moderatorRoot .case-layout-v3 .case-user-chip img, body #moderatorRoot .case-layout-v3 .case-user-chip > .case-user-fallback { width: 32px !important; height: 32px !important; max-width: 32px !important; max-height: 32px !important; border-radius: 50% !important; object-fit: cover !important; display: block !important; flex: 0 0 32px !important; }
      body #moderatorRoot .case-layout-v3 .case-user-copy { display: grid !important; grid-template-columns: minmax(0, 1fr) !important; gap: 1px !important; min-width: 0 !important; max-width: 100% !important; overflow: hidden !important; overflow-wrap: normal !important; word-break: normal !important; }
      body #moderatorRoot .case-layout-v3 .case-user-copy strong,
      body #moderatorRoot .case-layout-v3 .case-user-copy small { display: block !important; max-width: 100% !important; min-width: 0 !important; overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; overflow-wrap: normal !important; word-break: normal !important; }
      body #moderatorRoot .case-layout-v3 .case-user-copy small { color: var(--muted, #b7bdc8) !important; font-size: 11px !important; line-height: 1.2 !important; }
      body #moderatorRoot .case-layout-v3 .case-ref-chip small { color: var(--muted, #b7bdc8) !important; font-size: 11px !important; overflow-wrap: anywhere !important; }
      body #moderatorRoot .case-layout-v3 .case-ref-chip { display: grid !important; gap: 2px !important; min-width: 0 !important; }
      body #moderatorRoot .case-layout-v3 .case-ref-chip strong { color: #00b0f4 !important; font-size: 13px !important; }
      body #moderatorRoot .case-layout-v3 .case-field-block, body #moderatorRoot .case-layout-v3 .case-edit-panel label { display: grid !important; gap: 7px !important; min-width: 0 !important; }
      body #moderatorRoot .case-layout-v3 .case-notes-panel textarea, body #moderatorRoot .case-layout-v3 .case-edit-panel input, body #moderatorRoot .case-layout-v3 .case-edit-panel textarea { width: 100% !important; min-width: 0 !important; border-radius: 8px !important; border: 1px solid rgba(255,255,255,.13) !important; background: rgba(9,13,20,.78) !important; color: var(--text, #f2f5fb) !important; }
      body #moderatorRoot .case-layout-v3 .case-notes-panel textarea { min-height: 138px !important; resize: vertical !important; }
      body #moderatorRoot .case-layout-v3 .case-edit-panel { display: grid !important; gap: 12px !important; }
      body #moderatorRoot .case-layout-v3 .case-edit-panel textarea { min-height: 112px !important; resize: vertical !important; }
      body #moderatorRoot .case-layout-v3 .case-edit-grid { display: grid !important; grid-template-columns: minmax(110px, .34fr) minmax(220px, .66fr) !important; gap: 12px !important; margin: 0 !important; }
      @media (max-width: 760px) { body #moderatorRoot .case-layout-v3.case-detail { max-width: none !important; } body #moderatorRoot .case-layout-v3 .case-actions-bar, body #moderatorRoot .case-layout-v3 .case-history-panel summary { align-items: stretch !important; flex-direction: column !important; } body #moderatorRoot .case-layout-v3 .case-actions-bar > div { justify-content: flex-start !important; } body #moderatorRoot .case-layout-v3 .case-info-row, body #moderatorRoot .case-layout-v3 .case-edit-grid, body #moderatorRoot .case-layout-v3 .case-history-panel li { grid-template-columns: minmax(0, 1fr) !important; gap: 6px !important; align-items: start !important; } body #moderatorRoot .case-layout-v3 .case-user-chip { width: 100% !important; } body #moderatorRoot .case-layout-v3 .case-user-copy strong { max-width: 100% !important; } }
    `;
    document.head.append(style);
  }

  installTabIconStyle();
  installModeratorCaseLayoutStyle();

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

  window.coinSpriteIdentifyFormFields = identifyFields;

  const innerHtmlDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  if (innerHtmlDescriptor?.get && innerHtmlDescriptor?.set) {
    Object.defineProperty(Element.prototype, 'innerHTML', {
      configurable: innerHtmlDescriptor.configurable,
      enumerable: innerHtmlDescriptor.enumerable,
      get: innerHtmlDescriptor.get,
      set(value) {
        if (this instanceof HTMLTemplateElement || typeof value !== 'string' || !FIELD_MARKUP.test(value)) {
          innerHtmlDescriptor.set.call(this, value);
          return;
        }
        const range = document.createRange();
        range.selectNodeContents(this);
        const fragment = range.createContextualFragment(value);
        identifyFields(fragment);
        this.replaceChildren(fragment);
      },
    });
  }

  const appendChild = Node.prototype.appendChild;
  Node.prototype.appendChild = function patchedAppendChild(node) {
    return appendChild.call(this, identifyFields(node));
  };

  const insertBefore = Node.prototype.insertBefore;
  Node.prototype.insertBefore = function patchedInsertBefore(node, referenceNode) {
    return insertBefore.call(this, identifyFields(node), referenceNode);
  };

  const replaceChild = Node.prototype.replaceChild;
  Node.prototype.replaceChild = function patchedReplaceChild(node, oldNode) {
    return replaceChild.call(this, identifyFields(node), oldNode);
  };

  for (const methodName of ['append', 'prepend', 'before', 'after', 'replaceWith', 'replaceChildren']) {
    const nativeMethod = Element.prototype[methodName];
    if (typeof nativeMethod !== 'function') continue;
    Element.prototype[methodName] = function patchedInsertion(...nodes) {
      nodes.forEach((node) => {
        if (node instanceof Node) identifyFields(node);
      });
      return nativeMethod.apply(this, nodes);
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    installTabIconStyle();
    installModeratorCaseLayoutStyle();
    identifyFields(document);
  }, { once: true });
})();
