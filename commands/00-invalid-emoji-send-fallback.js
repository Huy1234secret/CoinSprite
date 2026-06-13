'use strict';

const { TextChannel } = require('discord.js');

const originalSend = TextChannel.prototype.send;

function hasInvalidEmojiError(error) {
  if (Number(error?.code) !== 50035) return false;
  try {
    return JSON.stringify(error?.rawError?.errors || error).includes('COMPONENT_INVALID_EMOJI');
  } catch {
    return false;
  }
}

function withoutComponentEmojis(value) {
  if (Array.isArray(value)) return value.map(withoutComponentEmojis);
  if (!value || typeof value !== 'object') return value;

  const source = typeof value.toJSON === 'function' ? value.toJSON() : value;
  return Object.fromEntries(
    Object.entries(source)
      .filter(([key]) => key !== 'emoji')
      .map(([key, child]) => [key, withoutComponentEmojis(child)]),
  );
}

TextChannel.prototype.send = async function sendWithInvalidEmojiFallback(options) {
  try {
    return await originalSend.call(this, options);
  } catch (error) {
    if (!hasInvalidEmojiError(error) || !options || typeof options !== 'object') throw error;

    const fallback = {
      ...options,
      components: withoutComponentEmojis(options.components || []),
    };
    console.warn(`Retrying message in channel ${this.id} without invalid component emojis.`);
    return originalSend.call(this, fallback);
  }
};

module.exports = {};
