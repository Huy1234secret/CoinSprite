function componentEmoji(emoji) {
  const custom = String(emoji || '').match(/^<(a?):([a-z0-9_]+):(\d{16,20})>$/i);
  if (custom) return { id: custom[3], name: custom[2], animated: Boolean(custom[1]) };
  const unicode = String(emoji || '').trim();
  return unicode ? { name: unicode } : undefined;
}

module.exports = { componentEmoji };
