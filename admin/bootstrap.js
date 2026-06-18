(() => {
  if (window.__coinSpriteAdminBootstrap) return;
  window.__coinSpriteAdminBootstrap = true;

  const FIELD_SELECTOR = 'input:not([id]):not([name]),select:not([id]):not([name]),textarea:not([id]):not([name])';
  const FIELD_MARKUP = /<(?:input|select|textarea)\b/i;
  let fieldSequence = 0;

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

  document.addEventListener('DOMContentLoaded', () => identifyFields(document), { once: true });
})();
