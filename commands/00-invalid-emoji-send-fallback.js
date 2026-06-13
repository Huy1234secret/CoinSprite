'use strict';

const { ButtonInteraction, TextChannel } = require('discord.js');

const originalSend = TextChannel.prototype.send;
const originalButtonUpdate = ButtonInteraction.prototype.update;

function validationDetails(error) {
  try {
    return JSON.stringify(error?.rawError?.errors || {}, null, 2);
  } catch {
    return '{}';
  }
}

function hasInvalidEmojiError(error) {
  return Number(error?.code) === 50035
    && validationDetails(error).includes('COMPONENT_INVALID_EMOJI');
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

function emojiFreePayload(options) {
  return {
    ...options,
    components: withoutComponentEmojis(options.components || []),
  };
}

TextChannel.prototype.send = async function sendWithInvalidEmojiFallback(options) {
  try {
    return await originalSend.call(this, options);
  } catch (error) {
    if (!hasInvalidEmojiError(error) || !options || typeof options !== 'object') throw error;
    console.warn(`Retrying message in channel ${this.id} without invalid component emojis.`);
    return originalSend.call(this, emojiFreePayload(options));
  }
};

ButtonInteraction.prototype.update = async function updateWithInvalidEmojiFallback(options) {
  try {
    return await originalButtonUpdate.call(this, options);
  } catch (error) {
    if (!hasInvalidEmojiError(error) || !options || typeof options !== 'object') {
      if (Number(error?.code) === 50035) {
        console.error('Discord interaction update validation details:', validationDetails(error));
      }
      throw error;
    }
    console.warn(`Retrying button interaction ${this.customId || this.id} without invalid component emojis.`);
    return originalButtonUpdate.call(this, emojiFreePayload(options));
  }
};

module.exports = {};
