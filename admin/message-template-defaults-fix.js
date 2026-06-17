(() => {
  if (window.__coinSpriteMessageTemplateDefaultsFix) return;
  window.__coinSpriteMessageTemplateDefaultsFix = true;

  const LINK_DEFAULT_TEMPLATE = Object.freeze({
    id: 'default-link-auto-moderation-alert',
    type: 'template',
    folderId: '',
    name: 'Default: Link auto moderation alert',
    content: '',
    containers: [{
      id: 'link-auto-moderation-alert',
      accentColor: '#ED4245',
      text: [
        '## Link Auto-Moderator alert',
        '**User:** <@mention> (`<user-id>`)',
        '**Channel:** <channel>',
        '**Action:** <moderation-action>',
        '**Reason:** <moderation-reason>',
        '<separator>',
        '**Domain:** <blocked-domain>',
        '**URL:** <blocked-url>',
        '-# Message: <message-link>',
      ].join('\n'),
      thumbnailUrl: '<avatar_url>',
      imageUrl: '',
    }],
    componentRows: [],
    botDefault: true,
    defaultLocked: true,
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function withDefaultTemplates(templates) {
    const list = Array.isArray(templates) ? templates : [];
    const byId = new Map(list.filter((template) => template?.id).map((template) => [template.id, template]));
    byId.set(LINK_DEFAULT_TEMPLATE.id, {
      ...clone(LINK_DEFAULT_TEMPLATE),
      ...(byId.get(LINK_DEFAULT_TEMPLATE.id) || {}),
      id: LINK_DEFAULT_TEMPLATE.id,
      type: 'template',
      folderId: '',
      name: LINK_DEFAULT_TEMPLATE.name,
      botDefault: true,
      defaultLocked: true,
    });
    return [...byId.values()];
  }

  function isTemplateListRequest(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = String(init.method || input?.method || 'GET').toUpperCase();
    return method === 'GET' && /\/api\/guilds\/\d{16,20}\/message-templates(?:\?|$)/.test(String(url || ''));
  }

  if (typeof window.fetch === 'function' && !window.fetch.__coinSpriteMessageTemplateDefaultsFix) {
    const nativeFetch = window.fetch.bind(window);
    const patchedFetch = async (input, init = {}) => {
      const response = await nativeFetch(input, init);
      if (!response.ok || !isTemplateListRequest(input, init)) return response;
      const payload = await response.clone().json().catch(() => null);
      if (!payload || typeof payload !== 'object') return response;
      payload.templates = withDefaultTemplates(payload.templates);
      const headers = new Headers(response.headers);
      headers.set('Content-Type', 'application/json; charset=utf-8');
      headers.set('Cache-Control', 'no-store');
      return new Response(JSON.stringify(payload), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };
    patchedFetch.__coinSpriteMessageTemplateDefaultsFix = true;
    window.fetch = patchedFetch;
  }

  function fixCreateButtons(root = document) {
    root.querySelectorAll?.('[data-message-action="create-open"]').forEach((button) => {
      button.dataset.messageAction = 'create-message';
      button.setAttribute('data-message-action', 'create-message');
    });
  }

  function startButtonObserver() {
    fixCreateButtons(document);
    const target = document.querySelector('#messageTemplatesRoot') || document.body;
    if (!target) return;
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) fixCreateButtons(node);
        });
      }
      fixCreateButtons(target);
    }).observe(target, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startButtonObserver, { once: true });
  } else {
    startButtonObserver();
  }
})();
