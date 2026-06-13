'use strict';

const ticketConfig = require('../src/ticketConfig');

const CUSTOM_EMOJI = /^<(a?):([a-zA-Z0-9_]{1,32}):(\d{16,20})>$/;
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
  if (!clean || clean.length > 100 || /\s/u.test(clean)) return undefined;

  const custom = clean.match(CUSTOM_EMOJI);
  if (custom) {
    return {
      name: custom[2],
      id: custom[3],
      animated: custom[1] === 'a',
    };
  }

  if (clean.startsWith('<') || clean.endsWith('>') || !isSingleGrapheme(clean)) return undefined;
  if (!KEYCAP_EMOJI.test(clean) && !FLAG_EMOJI.test(clean) && !PICTOGRAPHIC_EMOJI.test(clean)) {
    return undefined;
  }

  return { name: clean };
}

ticketConfig.discordEmoji = safeDiscordEmoji;

module.exports = {};
