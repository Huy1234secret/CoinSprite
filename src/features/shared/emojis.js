function parseCustomEmoji(emoji) {
  const custom = String(emoji || '').trim().match(/^<(a?):([a-z0-9_]+):(\d{16,20})>$/i);
  if (!custom) return null;
  return {
    component: { id: custom[3], name: custom[2], animated: Boolean(custom[1]) },
    text: `<${custom[1] ? 'a' : ''}:${custom[2]}:${custom[3]}>`,
  };
}

function componentEmoji(emoji) {
  const custom = parseCustomEmoji(emoji);
  if (custom) return custom.component;
  const unicode = String(emoji || '').trim();
  return unicode ? { name: unicode } : undefined;
}

function customEmojiIsUsable(custom, client) {
  const cache = client?.emojis?.cache;
  if (!cache || typeof cache.has !== 'function') return true;
  return cache.has(custom.component.id);
}

function resolveEmoji(configured, fallback = '🎮', client = null) {
  const custom = parseCustomEmoji(configured);
  if (custom && customEmojiIsUsable(custom, client)) return custom;

  const unicode = custom ? '' : String(configured || '').trim();
  if (unicode) return { component: { name: unicode }, text: unicode };

  const safeFallback = parseCustomEmoji(fallback);
  if (safeFallback && customEmojiIsUsable(safeFallback, client)) return safeFallback;
  const fallbackUnicode = safeFallback ? '🎮' : String(fallback || '').trim();
  return { component: { name: fallbackUnicode || '🎮' }, text: fallbackUnicode || '🎮' };
}

module.exports = {
  componentEmoji,
  parseCustomEmoji,
  resolveEmoji,
};
