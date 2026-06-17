(() => {
  if (window.__coinSpriteMessageTemplateXhrGuard) return;
  window.__coinSpriteMessageTemplateXhrGuard = true;

  const NativeXHR = window.XMLHttpRequest;
  const pending = new Map();

  function route(url, method) {
    const parsed = new URL(String(url || ''), window.location.origin);
    const match = parsed.pathname.match(/^\/api\/guilds\/(\d{16,20})\/message-templates\/([a-z0-9_-]{1,40})$/i);
    return match && String(method || '').toUpperCase() === 'PUT' ? { guildId: match[1], templateId: match[2] } : null;
  }

  function fakeResponse(proxy, payload) {
    proxy.__fakeStatus = 200;
    proxy.__fakeResponse = payload;
    setTimeout(() => proxy.onload?.call(proxy), 0);
  }

  window.XMLHttpRequest = function messageTemplateXhrGuard() {
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
        const template = JSON.parse(body || '{}');
        pending.set(info.templateId, { guildId: info.guildId, template: { ...template, id: info.templateId } }); // ADDED: component-action XHR saves wait for the visible Save changes button.
        fakeResponse(proxy, { guildId: info.guildId, template: { ...template, id: info.templateId } });
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

  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('[data-message-action="manual-save"]')) return;
    const selectedId = document.querySelector('.message-editor-head [data-template-field="name"]')
      ? [...pending.keys()].pop()
      : '';
    const entry = pending.get(selectedId);
    if (!entry) return;
    window.fetch(`/api/guilds/${entry.guildId}/message-templates/${selectedId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry.template),
    }); // FIXED: pending XHR component-action edits are merged before the manual save handler runs.
    pending.delete(selectedId);
  }, true);
})();
