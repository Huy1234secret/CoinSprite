'use strict';

const ticketConfig = require('../src/ticketConfig');

const KEYCAP_EMOJI = /^[#*0-9]\uFE0F?\u20E3$/u;
const FLAG_EMOJI = /^\p{Regional_Indicator}{2}$/u;
const PICTOGRAPHIC_EMOJI = /\p{Extended_Pictographic}/u;

function isSingleGrapheme(value) {
  if (typeof Intl?.Segmenter !== 'function') return true;
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  return [...segmenter.segment(value)].length === 1;
}

function safeDiscordEmoji(value) {
  const clean = String(value || '').trim();
  if (!clean || clean.length > 32 || /\s/u.test(clean)) return undefined;

  // Custom emoji strings can be valid-looking but still rejected if the bot
  // cannot use that emoji in the target guild. Keep component payloads to
  // Unicode emoji so request panels do not repeatedly hit the retry fallback.
  if (clean.startsWith('<') || clean.endsWith('>')) return undefined;
  if (!isSingleGrapheme(clean)) return undefined;
  if (!KEYCAP_EMOJI.test(clean) && !FLAG_EMOJI.test(clean) && !PICTOGRAPHIC_EMOJI.test(clean)) return undefined;

  return { name: clean };
}

ticketConfig.discordEmoji = safeDiscordEmoji;

module.exports = {};
