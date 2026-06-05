const { PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('./commandLogger');

const WORD_CHAIN_CHANNEL_ID = '1512480152410525958';
const MIN_WORD_LENGTH = 3;
const MAX_WORD_LENGTH = 10;
const STARTING_HEARTS = 3;
const TURN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const PUNISHMENT_MS = 60 * 60 * 1000;
const GAME_COOLDOWN_MS = 60 * 1000;
const DICTIONARY_LOOKUP_TIMEOUT_MS = 5000;
const DICTIONARY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DICTIONARY_API_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const COMPONENTS_V2_FLAG = 32768;

const dictionaryCache = new Map();

let clientRef = null;
let channelRef = null;
let currentGame = null;
let turnTimer = null;
let cooldownTimer = null;
let cooldownEndsAt = 0;
let initStarted = false;

function normalizeWord(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u0111/g, 'd');
}

function stripDiscordNoise(content) {
  return String(content || '')
    .trim()
    .replace(/^>+\s*/, '')
    .replace(/^`+|`+$/g, '')
    .trim();
}

function getSubmittedWord(message) {
  const raw = stripDiscordNoise(message.content);
  if (!raw || /\s/.test(raw)) return null;
  const normalized = normalizeWord(raw);
  if (!/^[a-z]+$/.test(normalized)) return null;
  return normalized;
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickWordLength() {
  const lengths = [];
  for (let length = MIN_WORD_LENGTH; length <= MAX_WORD_LENGTH; length += 1) lengths.push(length);
  return randomItem(lengths) || MIN_WORD_LENGTH;
}

function formatCountdown(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

function buildPanel(content, accentColor = 0x2f80ed) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: accentColor,
        components: [{ type: 10, content }],
      },
    ],
  };
}

function getWordLengthLine() {
  return currentGame ? `Word length: **${currentGame.wordLength} letters**` : null;
}

function getGameLine() {
  if (!currentGame) return 'Word Chain is not running.';
  const required = currentGame.requiredFirstLetter ? `\nNext word must start with: **${currentGame.requiredFirstLetter.toUpperCase()}**` : '';
  const previous = currentGame.lastWord ? `\nLast word: **${currentGame.lastWord}**` : '\nFirst valid word can start with any letter.';
  const lastPlayer = currentGame.lastUserId ? `\nLast player: <@${currentGame.lastUserId}>` : '';
  return [
    '**Word Chain is running**',
    `Channel: <#${WORD_CHAIN_CHANNEL_ID}>`,
    `Word length: **${currentGame.wordLength} letters**`,
    `Server hearts: **${currentGame.hearts}/${STARTING_HEARTS}**`,
    `Countdown: ${formatCountdown(currentGame.expiresAt)}`,
    previous,
    lastPlayer,
    required,
  ].join('\n');
}

async function sendToGameChannel(content, accentColor) {
  const channel = await getGameChannel();
  if (!channel?.isTextBased?.()) return null;
  return channel.send(buildPanel(content, accentColor)).catch((error) => {
    logCommandSystem(`Word Chain send failed: ${error?.message ?? 'unknown error'}`);
    return null;
  });
}

async function getGameChannel() {
  if (channelRef?.id === WORD_CHAIN_CHANNEL_ID) return channelRef;
  if (!clientRef) return null;
  channelRef = clientRef.channels.cache.get(WORD_CHAIN_CHANNEL_ID)
    || await clientRef.channels.fetch(WORD_CHAIN_CHANNEL_ID).catch((error) => {
      logCommandSystem(`Word Chain channel fetch failed: ${error?.message ?? 'unknown error'}`);
      return null;
    });
  return channelRef;
}

function clearTurnTimer() {
  if (turnTimer) clearTimeout(turnTimer);
  turnTimer = null;
}

function clearCooldownTimer() {
  if (cooldownTimer) clearTimeout(cooldownTimer);
  cooldownTimer = null;
}

function scheduleTurnTimer() {
  clearTurnTimer();
  if (!currentGame) return;
  const waitMs = Math.max(1000, currentGame.expiresAt - Date.now());
  turnTimer = setTimeout(() => {
    void handleTurnTimeout();
  }, waitMs);
}

function resetTurnCountdown() {
  if (!currentGame) return;
  currentGame.expiresAt = Date.now() + TURN_TIMEOUT_MS;
  scheduleTurnTimer();
}

async function startGame(reason = 'auto') {
  if (currentGame) return currentGame;
  if (cooldownEndsAt > Date.now()) return null;
  clearCooldownTimer();
  cooldownEndsAt = 0;

  const wordLength = pickWordLength();
  currentGame = {
    wordLength,
    hearts: STARTING_HEARTS,
    usedWords: new Set(),
    lastWord: null,
    lastUserId: null,
    requiredFirstLetter: null,
    startedAt: Date.now(),
    expiresAt: Date.now() + TURN_TIMEOUT_MS,
  };
  scheduleTurnTimer();

  await sendToGameChannel(`${getGameLine()}\n\nGame started${reason === 'auto' ? ' automatically' : ''}.`, 0x57f287);
  return currentGame;
}

function scheduleNextGame() {
  clearCooldownTimer();
  cooldownEndsAt = Date.now() + GAME_COOLDOWN_MS;
  cooldownTimer = setTimeout(() => {
    cooldownEndsAt = 0;
    void startGame('auto');
  }, GAME_COOLDOWN_MS);
}

async function endGame(reason) {
  clearTurnTimer();
  currentGame = null;
  await sendToGameChannel(`Word Chain game ended: ${reason}\nA new game will start ${formatCountdown(Date.now() + GAME_COOLDOWN_MS)}.`, 0xed4245);
  scheduleNextGame();
}

async function loseHeart(reason) {
  if (!currentGame) return;
  currentGame.hearts -= 1;

  if (currentGame.hearts <= 0) {
    await endGame(`${reason}. Server ran out of hearts.`);
    return;
  }

  resetTurnCountdown();
  await sendToGameChannel(`${reason}\n${getWordLengthLine()}\nServer lost 1 heart. Hearts left: **${currentGame.hearts}/${STARTING_HEARTS}**\nCountdown restarted: ${formatCountdown(currentGame.expiresAt)}`, 0xfee75c);
}

async function handleTurnTimeout() {
  if (!currentGame) return;
  await loseHeart('Countdown ran out.');
}

async function muteMemberInGameChannel(message, reason) {
  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  const channel = message.channel;
  if (!member || !channel?.permissionOverwrites?.edit) return false;

  const currentOverwrite = channel.permissionOverwrites.cache.get(member.id);
  let previousSendMessages = null;
  if (currentOverwrite?.allow?.has(PermissionFlagsBits.SendMessages)) previousSendMessages = true;
  if (currentOverwrite?.deny?.has(PermissionFlagsBits.SendMessages)) previousSendMessages = false;

  await channel.permissionOverwrites.edit(member.id, { SendMessages: false }, { reason }).catch((error) => {
    logCommandSystem(`Word Chain mute failed for ${message.author.id}: ${error?.message ?? 'unknown error'}`);
  });

  setTimeout(() => {
    channel.permissionOverwrites.edit(member.id, { SendMessages: previousSendMessages }, { reason: `Word Chain punishment expired for ${member.id}` }).catch((error) => {
      logCommandSystem(`Word Chain unmute failed for ${member.id}: ${error?.message ?? 'unknown error'}`);
    });
  }, PUNISHMENT_MS);

  return true;
}

function isDictionaryCacheFresh(entry) {
  return entry && Date.now() - entry.checkedAt < DICTIONARY_CACHE_TTL_MS;
}

async function isKnownEnglishWord(word) {
  const cached = dictionaryCache.get(word);
  if (isDictionaryCacheFresh(cached)) return cached.result;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DICTIONARY_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(`${DICTIONARY_API_BASE_URL}/${encodeURIComponent(word)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });

    if (response.status === 404) {
      const result = { ok: true, found: false };
      dictionaryCache.set(word, { checkedAt: Date.now(), result });
      return result;
    }

    if (!response.ok) {
      logCommandSystem(`Word Chain dictionary lookup failed for ${word}: HTTP ${response.status}`);
      return { ok: false, found: false };
    }

    const body = await response.json().catch(() => null);
    const found = Array.isArray(body) && body.some((entry) => Array.isArray(entry?.meanings) && entry.meanings.length > 0);
    const result = { ok: true, found };
    dictionaryCache.set(word, { checkedAt: Date.now(), result });
    return result;
  } catch (error) {
    logCommandSystem(`Word Chain dictionary lookup failed for ${word}: ${error?.message ?? 'unknown error'}`);
    return { ok: false, found: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function validateWord(word) {
  if (!currentGame) return 'No active game.';
  if (word.length !== currentGame.wordLength) return `Word must have exactly ${currentGame.wordLength} letters.`;
  if (currentGame.usedWords.has(word)) return 'That word was already used.';
  if (currentGame.requiredFirstLetter && !word.startsWith(currentGame.requiredFirstLetter)) {
    return `Word must start with "${currentGame.requiredFirstLetter.toUpperCase()}".`;
  }

  const dictionaryResult = await isKnownEnglishWord(word);
  if (!dictionaryResult.ok) return { temporary: true, reason: 'Dictionary lookup is unavailable right now. Try again in a moment.' };
  if (!dictionaryResult.found) return 'That word was not found in the English dictionary.';
  return null;
}

async function punishInvalidWord(message, word, reason) {
  await muteMemberInGameChannel(message, `Word Chain invalid word: ${reason}`);
  await message.react('\u274c').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word || 'invalid'}**: ${reason}\n${getWordLengthLine()}\nThey are muted in this channel for 1 hour.`, 0xed4245);
  await loseHeart('Invalid word penalty.');
}

async function rejectTemporaryValidationIssue(message, word, reason) {
  await message.react('\u26a0\ufe0f').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word}**, but ${reason}\n${getWordLengthLine()}\nNo heart was lost and no mute was applied.`, 0xfee75c);
}

async function rejectRepeatedPlayer(message) {
  await message.react('\u26a0\ufe0f').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> must wait for another player before replying again.\n${getWordLengthLine()}\nNo heart was lost and no mute was applied.`, 0xfee75c);
}

async function acceptWord(message, word) {
  currentGame.usedWords.add(word);
  currentGame.lastWord = word;
  currentGame.lastUserId = message.author.id;
  currentGame.requiredFirstLetter = word.at(-1);
  resetTurnCountdown();
  await message.react('\u2705').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> accepted: **${word}**\n${getWordLengthLine()}\nNext starts with **${currentGame.requiredFirstLetter.toUpperCase()}**.\nCountdown reset: ${formatCountdown(currentGame.expiresAt)}`, 0x57f287);
}

async function init(client) {
  clientRef = client;
  if (initStarted) return;
  initStarted = true;
  await getGameChannel();
  await startGame('auto');
}

async function handleMessageCreate(message) {
  if (message.author?.bot || message.channelId !== WORD_CHAIN_CHANNEL_ID || !message.guild) return;
  if (!currentGame) {
    if (cooldownEndsAt > Date.now()) return;
    await startGame('auto');
    return;
  }

  const word = getSubmittedWord(message);
  if (!word) {
    await punishInvalidWord(message, null, 'Only one word made of letters is allowed.');
    return;
  }

  if (currentGame.lastUserId === message.author.id) {
    await rejectRepeatedPlayer(message);
    return;
  }

  const invalidReason = await validateWord(word);
  if (invalidReason) {
    if (typeof invalidReason === 'object' && invalidReason.temporary) {
      await rejectTemporaryValidationIssue(message, word, invalidReason.reason);
      return;
    }
    await punishInvalidWord(message, word, invalidReason);
    return;
  }

  await acceptWord(message, word);
}

async function handleStatus(interaction) {
  if (interaction.channelId !== WORD_CHAIN_CHANNEL_ID && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: `Word Chain is only playable in <#${WORD_CHAIN_CHANNEL_ID}>.`, flags: 64 });
    return;
  }

  if (!currentGame && cooldownEndsAt > Date.now()) {
    await interaction.reply({ content: `Word Chain is on cooldown. A new game starts ${formatCountdown(cooldownEndsAt)}.`, flags: interaction.channelId === WORD_CHAIN_CHANNEL_ID ? undefined : 64 });
    return;
  }

  if (!currentGame) await startGame('manual');
  await interaction.reply({ content: getGameLine(), flags: interaction.channelId === WORD_CHAIN_CHANNEL_ID ? undefined : 64 });
}

module.exports = {
  WORD_CHAIN_CHANNEL_ID,
  init,
  handleMessageCreate,
  handleStatus,
  normalizeWord,
  validateWord,
  isKnownEnglishWord,
};
