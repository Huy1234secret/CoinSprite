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

  installTabIconStyle();

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
    identifyFields(document);
  }, { once: true });
})();
