'use strict';

const {
  ButtonInteraction,
  Message,
  StringSelectMenuInteraction,
  TextChannel,
} = require('discord.js');

const originalSend = TextChannel.prototype.send;

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

function patchComponentPayloadMethod(prototype, methodName, logLabel) {
  if (!prototype?.[methodName]) return;
  const original = prototype[methodName];
  if (original.__componentEmojiFallbackPatched) return;

  async function patchedComponentPayloadMethod(options, ...rest) {
    try {
      return await original.call(this, options, ...rest);
    } catch (error) {
      if (!hasInvalidEmojiError(error) || !options || typeof options !== 'object') {
        if (Number(error?.code) === 50035) {
          console.error('Discord component validation details:', validationDetails(error));
        }
        throw error;
      }
      console.warn(`${logLabel(this)} without invalid component emojis.`);
      return original.call(this, emojiFreePayload(options), ...rest);
    }
  }

  patchedComponentPayloadMethod.__componentEmojiFallbackPatched = true;
  prototype[methodName] = patchedComponentPayloadMethod;
}

TextChannel.prototype.send = async function sendWithInvalidEmojiFallback(options, ...rest) {
  try {
    return await originalSend.call(this, options, ...rest);
  } catch (error) {
    if (!hasInvalidEmojiError(error) || !options || typeof options !== 'object') throw error;
    console.warn(`Retrying message in channel ${this.id} without invalid component emojis.`);
    return originalSend.call(this, emojiFreePayload(options), ...rest);
  }
};

patchComponentPayloadMethod(
  ButtonInteraction?.prototype,
  'update',
  (interaction) => `Retrying button interaction ${interaction.customId || interaction.id}`,
);

patchComponentPayloadMethod(
  StringSelectMenuInteraction?.prototype,
  'update',
  (interaction) => `Retrying select-menu interaction ${interaction.customId || interaction.id}`,
);

patchComponentPayloadMethod(
  Message?.prototype,
  'edit',
  (message) => `Retrying message edit ${message.id || ''}`.trim(),
);

module.exports = {};
