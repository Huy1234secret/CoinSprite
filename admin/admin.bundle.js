const COINSPRITE_ADMIN_SCRIPT_SOURCES = Object.freeze([
  '/admin/tickets.js',
  '/admin/app.js',
  '/admin/user-data.js',
  '/admin/admin-fixes.js',
  '/admin/ticket-ui-upgrade.js',
  '/admin/emoji-picker.js',
  '/admin/message-inline-editor.js',
  '/admin/message-edit-shortcuts.js',
  '/admin/owner-panel.js?v=owner-tokens-1',
]);

function showAdminBundleError(error) {
  const message = `Admin UI failed to load: ${error?.message || 'unknown script error'}`;
  console.error('[CoinSprite admin bundle]', error);
  document.querySelectorAll('#loginStatus, #statusBox').forEach((element) => {
    element.textContent = message;
    element.className = element.id === 'loginStatus' ? 'status compact error' : 'status error';
  });
}

try {
  const scripts = await Promise.all(COINSPRITE_ADMIN_SCRIPT_SOURCES.map(async (source) => {
    const response = await fetch(source, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`${source} returned ${response.status}`);
    return {
      source,
      code: await response.text(),
    };
  }));

  for (const script of scripts) {
    const sourceUrl = new URL(script.source, window.location.href).href;
    (0, eval)(`${script.code}\n//# sourceURL=${sourceUrl}`);
  }

  window.dispatchEvent(new CustomEvent('coinsprite:admin-bundle-ready', {
    detail: { scripts: COINSPRITE_ADMIN_SCRIPT_SOURCES.length },
  }));
} catch (error) {
  showAdminBundleError(error);
  throw error;
}
