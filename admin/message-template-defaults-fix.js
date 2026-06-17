(() => {
  if (window.__coinSpriteMessageTemplateDefaultsFix) return;
  window.__coinSpriteMessageTemplateDefaultsFix = true;

  const NativeXHR = window.XMLHttpRequest;
  const pending = new Map();

  function route(url, method) {
    const parsed = new URL(String(url || ''), window.location.origin);
    const match = parsed.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-z0-9_-]{1,40})$/i);
    return match && String(method || '').toUpperCase() === 'PUT' ? { guildId: match[1], templateId: match[2] } : null;
  }

  if (NativeXHR && !NativeXHR.__coinSpriteMessageDefaultsFix) {
    window.XMLHttpRequest = function guardedMessageTemplateXhr() {
      const real = new NativeXHR();
      const proxy = { onload: null, onerror: null, responseType: '' };
      let method = 'GET';
      let url = '';
      proxy.open = (nextMethod, nextUrl, ...rest) => {
        method = nextMethod;
        url = nextUrl;
        real.open(nextMethod, nextUrl, ...rest);
      };
      proxy.setRequestHeader = (...args) => real.setRequestHeader(...args);
      proxy.send = (body) => {
        const info = route(url, method);
        if (info) {
          const template = { ...JSON.parse(body || '{}'), id: info.templateId };
          pending.set(info.templateId, { guildId: info.guildId, template }); // ADDED: XHR component-action saves wait for the visible Save changes button.
          proxy.__fakeStatus = 200;
          proxy.__fakeResponse = { guildId: info.guildId, template };
          setTimeout(() => proxy.onload?.call(proxy), 0);
          return;
        }
        real.responseType = proxy.responseType;
        real.onload = () => proxy.onload?.call(proxy);
        real.onerror = () => proxy.onerror?.call(proxy);
        real.send(body);
      };
      Object.defineProperties(proxy, {
        status: { get: () => proxy.__fakeStatus || real.status },
        response: { get: () => proxy.__fakeResponse || real.response },
        responseText: { get: () => (proxy.__fakeResponse ? JSON.stringify(proxy.__fakeResponse) : real.responseText) },
      });
      return proxy;
    };
    window.XMLHttpRequest.__coinSpriteMessageDefaultsFix = true;
  }

  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest?.('[data-message-action="manual-save"]')) return;
    const entry = [...pending.values()].pop();
    if (!entry) return;
    window.fetch(`/api/guilds/${entry.guildId}/message-templates/${entry.template.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry.template),
    }); // FIXED: pending XHR edits are merged into the workflow before click save runs.
    pending.delete(entry.template.id);
  }, true);
})();
