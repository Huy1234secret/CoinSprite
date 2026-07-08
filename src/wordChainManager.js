const { PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('./commandLogger');
const levelingManager = require('./levelingManager');
const wordChainEventManager = require('./wordChainEventManager');
const { loadState, saveState } = require('./wordChainStore');
const { DEFAULT_GUILD_CONFIG, DEFAULT_GUILD_ID, getEnabledGuildIds, getGuildConfig } = require('./serverConfig');
const { calculateWordChainXp, sanitizeWordChainXpFormula } = require('./wordChainFormula');

const WORD_CHAIN_CHANNEL_ID = DEFAULT_GUILD_CONFIG.channels.wordChain;
const MIN_WORD_LENGTH = DEFAULT_GUILD_CONFIG.wordChain.minWordLength;
const MAX_WORD_LENGTH = DEFAULT_GUILD_CONFIG.wordChain.maxWordLength;
const STARTING_HEARTS = DEFAULT_GUILD_CONFIG.wordChain.startingHearts;
const TURN_TIMEOUT_MS = DEFAULT_GUILD_CONFIG.wordChain.turnTimeoutMs;
const PUNISHMENT_MS = DEFAULT_GUILD_CONFIG.wordChain.punishmentMs;
const GAME_COOLDOWN_MS = DEFAULT_GUILD_CONFIG.wordChain.gameCooldownMs;
const DICTIONARY_LOOKUP_TIMEOUT_MS = 5000;
const DICTIONARY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DICTIONARY_API_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const WIKTIONARY_API_BASE_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition';
const DATAMUSE_API_BASE_URL = 'https://api.datamuse.com/words';
const COMPONENTS_V2_FLAG = 32768;
const NO_MENTIONS = { parse: [] };

const FALLBACK_VALID_WORDS = new Set([
  'tableful',
]);

const dictionaryCache = new Map();

let clientRef = null;
let channelRef = null;
let currentGame = null;
let turnTimer = null;
let cooldownTimer = null;
let cooldownEndsAt = 0;
let restrictions = {};
let initStarted = false;

function getConfig(guildId) {
  return getGuildConfig(guildId) || DEFAULT_GUILD_CONFIG;
}

function getWordChainConfig(guildId) {
  return getConfig(guildId).wordChain;
}

function getFallbackGuildId() {
  return getEnabledGuildIds()[0] || DEFAULT_GUILD_ID;
}

function getGameGuildId(guildId = null) {
  return guildId || currentGame?.guildId || getFallbackGuildId();
}

function getWordChainSettings(guildId) {
  const config = getWordChainConfig(getGameGuildId(guildId));
  return {
    minWordLength: Number(config.minWordLength) || MIN_WORD_LENGTH,
    maxWordLength: Number(config.maxWordLength) || MAX_WORD_LENGTH,
    startingHearts: Number(config.startingHearts) || STARTING_HEARTS,
    turnTimeoutMs: Number(config.turnTimeoutMs) || TURN_TIMEOUT_MS,
    punishmentMs: Number(config.punishmentMs) || PUNISHMENT_MS,
    gameCooldownMs: Number(config.gameCooldownMs) || GAME_COOLDOWN_MS,
    repeatedWordAction: config.repeatedWordAction === 'warn' ? 'warn' : 'punish',
    wrongStartAction: config.wrongStartAction === 'warn' ? 'warn' : 'punish',
    xpRewardFormula: sanitizeWordChainXpFormula(config.xpRewardFormula),
  };
}

function getWordChainChannelId(guildId) {
  return getConfig(getGameGuildId(guildId)).channels.wordChain || WORD_CHAIN_CHANNEL_ID;
}

function serializeGame(game) {
  if (!game) return null;
  const guildId = game.guildId || getFallbackGuildId();
  const settings = getWordChainSettings(guildId);
  const wordLength = Number(game.wordLength);
  const hearts = Number(game.hearts);
  const startedAt = Number(game.startedAt);
  const expiresAt = Number(game.expiresAt);
  return {
    guildId,
    wordLength: Number.isFinite(wordLength) ? wordLength : settings.minWordLength,
    hearts: Number.isFinite(hearts) ? hearts : settings.startingHearts,
    usedWords: Array.from(game.usedWords || []),
    lastWord: game.lastWord || null,
    lastUserId: game.lastUserId || null,
    requiredFirstLetter: game.requiredFirstLetter || null,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + settings.turnTimeoutMs,
    streak: Number(game.streak) || 0,
  };
}

function hydrateGame(game) {
  if (!game || !Number.isFinite(Number(game.wordLength))) return null;
  const guildId = game.guildId || getFallbackGuildId();
  const settings = getWordChainSettings(guildId);
  const parsedHearts = Number(game.hearts);
  const hearts = Math.min(settings.startingHearts, Math.max(0, Math.floor(Number.isFinite(parsedHearts) ? parsedHearts : settings.startingHearts)));
  if (hearts <= 0) return null;
  return {
    guildId,
    wordLength: Math.min(settings.maxWordLength, Math.max(settings.minWordLength, Math.floor(Number(game.wordLength)))),
    hearts,
    usedWords: new Set(Array.isArray(game.usedWords) ? game.usedWords.map(normalizeWord).filter(Boolean) : []),
    lastWord: game.lastWord ? normalizeWord(game.lastWord) : null,
    lastUserId: game.lastUserId || null,
    requiredFirstLetter: game.requiredFirstLetter ? normalizeWord(game.requiredFirstLetter).slice(0, 1) : null,
    startedAt: Number(game.startedAt) || Date.now(),
    expiresAt: Number(game.expiresAt) || Date.now() + settings.turnTimeoutMs,
    streak: Math.max(0, Math.floor(Number(game.streak) || 0)),
  };
}

function persistState() {
  saveState({
    game: serializeGame(currentGame),
    cooldownEndsAt,
    restrictions,
  });
}

function restoreState() {
  const state = loadState();
  currentGame = hydrateGame(state.game);
  cooldownEndsAt = Number(state.cooldownEndsAt) || 0;
  restrictions = state.restrictions || {};
  if (!currentGame && cooldownEndsAt <= Date.now()) cooldownEndsAt = 0;
  persistState();
}

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

function pickWordLength(guildId) {
  const settings = getWordChainSettings(guildId);
  const lengths = [];
  for (let length = settings.minWordLength; length <= settings.maxWordLength; length += 1) lengths.push(length);
  return randomItem(lengths) || settings.minWordLength;
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

function getStreakLine() {
  return currentGame ? `Streak: **${currentGame.streak || 0} words**` : null;
}

function getEventLuckLine() {
  return wordChainEventManager.getCurrentLuckLine(currentGame?.streak || 0, currentGame?.guildId);
}

function formatRestrictionDuration(guildId) {
  const totalSeconds = Math.max(1, Math.ceil(getWordChainSettings(guildId).punishmentMs / 1000));
  if (totalSeconds === 60) return '1 minute';
  if (totalSeconds % 60 === 0) return `${totalSeconds / 60} minutes`;
  return `${totalSeconds} seconds`;
}

function awardCorrectWordXp(message) {
  if (!message.guild?.id || !message.author?.id || !currentGame) return null;
  const settings = getWordChainSettings(message.guild.id);
  const fixedXp = calculateWordChainXp(settings.xpRewardFormula, {
    wordLength: currentGame.wordLength,
    streak: currentGame.streak || 0,
  });
  return levelingManager.awardMessageXp(message.guild.id, message.author.id, {
    fixedXp,
    source: 'word chain',
    channelId: message.channelId,
    messageId: message.id,
  });
}

function getGameLine(guildId) {
  if (!currentGame) return 'Word Chain is not running.';
  const resolvedGuildId = getGameGuildId(guildId);
  const settings = getWordChainSettings(resolvedGuildId);
  const wordChainChannelId = getWordChainChannelId(resolvedGuildId);
  const required = currentGame.requiredFirstLetter ? `\nNext word must start with: **${currentGame.requiredFirstLetter.toUpperCase()}**` : '';
  const previous = currentGame.lastWord ? `\nLast word: **${currentGame.lastWord}**` : '\nFirst valid word can start with any letter.';
  const lastPlayer = currentGame.lastUserId ? `\nLast player: <@${currentGame.lastUserId}>` : '';
  return [
    '**Word Chain is running**',
    `Channel: <#${wordChainChannelId}>`,
    `Word length: **${currentGame.wordLength} letters**`,
    `Streak: **${currentGame.streak || 0} words**`,
    getEventLuckLine(),
    `Server hearts: **${currentGame.hearts}/${settings.startingHearts}**`,
    `Incorrect words cause a **${formatRestrictionDuration(resolvedGuildId)} Word Chain restriction**.`,
    `Countdown: ${formatCountdown(currentGame.expiresAt)}`,
    previous,
    lastPlayer,
    required,
  ].filter(Boolean).join('\n');
}

async function sendToGameChannel(content, accentColor, guildId = null) {
  const channel = await getGameChannel(guildId);
  if (!channel?.isTextBased?.()) return null;
  return channel.send({ ...buildPanel(content, accentColor), allowedMentions: NO_MENTIONS }).catch((error) => {
    logCommandSystem(`Word Chain send failed: ${error?.message ?? 'unknown error'}`);
    return null;
  });
}

async function getGameChannel(guildId = null) {
  const channelId = getWordChainChannelId(guildId);
  if (channelRef?.id === channelId) return channelRef;
  if (!clientRef) return null;
  channelRef = clientRef.channels.cache.get(channelId)
    || await clientRef.channels.fetch(channelId).catch((error) => {
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
  const settings = getWordChainSettings(currentGame.guildId);
  currentGame.expiresAt = Date.now() + settings.turnTimeoutMs;
  persistState();
  scheduleTurnTimer();
}

async function startGame(reason = 'auto', guildId = null) {
  if (currentGame) return currentGame;
  if (cooldownEndsAt > Date.now()) return null;
  clearCooldownTimer();
  cooldownEndsAt = 0;

  const resolvedGuildId = getGameGuildId(guildId);
  const settings = getWordChainSettings(resolvedGuildId);
  const wordLength = pickWordLength(resolvedGuildId);
  currentGame = {
    guildId: resolvedGuildId,
    wordLength,
    hearts: settings.startingHearts,
    usedWords: new Set(),
    lastWord: null,
    lastUserId: null,
    requiredFirstLetter: null,
    startedAt: Date.now(),
    expiresAt: Date.now() + settings.turnTimeoutMs,
    streak: 0,
  };
  persistState();
  scheduleTurnTimer();
  await wordChainEventManager.refreshAnnouncement(0);

  await sendToGameChannel(`${getGameLine(resolvedGuildId)}\n\nGame started${reason === 'auto' ? ' automatically' : ''}.`, 0x57f287, resolvedGuildId);
  return currentGame;
}

function scheduleNextGame(guildId = null) {
  const resolvedGuildId = getGameGuildId(guildId);
  const settings = getWordChainSettings(resolvedGuildId);
  clearCooldownTimer();
  cooldownEndsAt = Date.now() + settings.gameCooldownMs;
  persistState();
  cooldownTimer = setTimeout(() => {
    cooldownEndsAt = 0;
    persistState();
    void startGame('auto', resolvedGuildId);
  }, settings.gameCooldownMs);
}

async function endGame(reason) {
  const guildId = getGameGuildId();
  const settings = getWordChainSettings(guildId);
  clearTurnTimer();
  currentGame = null;
  persistState();
  await wordChainEventManager.refreshAnnouncement(0);
  await sendToGameChannel(`Word Chain game ended: ${reason}\nA new game will start ${formatCountdown(Date.now() + settings.gameCooldownMs)}.`, 0xed4245, guildId);
  scheduleNextGame(guildId);
}

async function loseHeart(reason) {
  if (!currentGame) return;
  currentGame.hearts -= 1;
  currentGame.streak = 0;
  persistState();
  await wordChainEventManager.refreshAnnouncement(0);

  const guildId = getGameGuildId();
  const settings = getWordChainSettings(guildId);
  if (currentGame.hearts <= 0) {
    await endGame(`${reason}. Server ran out of hearts.`);
    return;
  }

  resetTurnCountdown();
  await sendToGameChannel(`${reason}\n${getWordLengthLine()}\n${getStreakLine()}\nServer lost 1 heart. Hearts left: **${currentGame.hearts}/${settings.startingHearts}**\nCountdown restarted: ${formatCountdown(currentGame.expiresAt)}`, 0xfee75c, guildId);
}

async function handleTurnTimeout() {
  if (!currentGame) return;
  await loseHeart('Countdown ran out.');
}

function getRestrictionEnd(userId) {
  const expiresAt = Number(restrictions[userId]) || 0;
  if (expiresAt > Date.now()) return expiresAt;
  if (restrictions[userId]) {
    delete restrictions[userId];
    persistState();
  }
  return 0;
}

function restrictPlayer(message) {
  const expiresAt = Date.now() + getWordChainSettings(message.guild.id).punishmentMs;
  restrictions[message.author.id] = expiresAt;
  persistState();
  return expiresAt;
}

async function sendRestrictionNotice(message, expiresAt) {
  const content = `-# You are currently being restricted in **Word Chain**, try again ${formatCountdown(expiresAt)}`;
  await message.delete().catch(() => null);

  const sentPrivately = typeof message.author.send === 'function'
    ? await message.author.send({
      ...buildPanel(content, 0xed4245),
      allowedMentions: NO_MENTIONS,
    }).then(() => true).catch(() => false)
    : false;
  if (sentPrivately) return;

  const notice = typeof message.channel.send === 'function'
    ? await message.channel.send({
      ...buildPanel(content, 0xed4245),
      allowedMentions: NO_MENTIONS,
    }).catch(() => null)
    : null;
  if (notice?.delete) {
    setTimeout(() => notice.delete().catch(() => null), 10_000);
  }
}

function isDictionaryCacheFresh(entry) {
  return entry && Date.now() - entry.checkedAt < DICTIONARY_CACHE_TTL_MS;
}

async function fetchJsonWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DICTIONARY_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (response.status === 404) return { ok: true, status: response.status, body: null };
    if (!response.ok) return { ok: false, status: response.status, body: null };
    return { ok: true, status: response.status, body: await response.json().catch(() => null) };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkDictionaryApi(word) {
  const response = await fetchJsonWithTimeout(`${DICTIONARY_API_BASE_URL}/${encodeURIComponent(word)}`);
  if (!response.ok) return { ok: false, found: false, source: 'dictionaryapi', status: response.status };
  if (response.status === 404) return { ok: true, found: false, source: 'dictionaryapi' };

  const found = Array.isArray(response.body)
    && response.body.some((entry) => Array.isArray(entry?.meanings) && entry.meanings.length > 0);
  return { ok: true, found, source: 'dictionaryapi' };
}

async function checkWiktionary(word) {
  const response = await fetchJsonWithTimeout(`${WIKTIONARY_API_BASE_URL}/${encodeURIComponent(word)}`);
  if (!response.ok) return { ok: false, found: false, source: 'wiktionary', status: response.status };
  if (response.status === 404) return { ok: true, found: false, source: 'wiktionary' };

  const englishEntries = response.body?.en;
  const found = Array.isArray(englishEntries)
    && englishEntries.some((entry) => Array.isArray(entry?.definitions) && entry.definitions.length > 0);
  return { ok: true, found, source: 'wiktionary' };
}

async function checkDatamuse(word) {
  const params = new URLSearchParams({ sp: word, md: 'd', max: '5' });
  const response = await fetchJsonWithTimeout(`${DATAMUSE_API_BASE_URL}?${params.toString()}`);
  if (!response.ok) return { ok: false, found: false, source: 'datamuse', status: response.status };

  const found = Array.isArray(response.body)
    && response.body.some((entry) => entry?.word === word && Array.isArray(entry.defs) && entry.defs.length > 0);
  return { ok: true, found, source: 'datamuse' };
}

async function isKnownEnglishWord(word) {
  if (FALLBACK_VALID_WORDS.has(word)) return { ok: true, found: true, source: 'fallback' };

  const cached = dictionaryCache.get(word);
  if (isDictionaryCacheFresh(cached)) return cached.result;

  const providers = [checkDictionaryApi, checkWiktionary, checkDatamuse];
  let anyProviderSucceeded = false;
  for (const provider of providers) {
    try {
      const result = await provider(word);
      if (!result.ok) {
        logCommandSystem(`Word Chain ${result.source} lookup failed for ${word}: HTTP ${result.status || 'unknown'}`);
        continue;
      }
      anyProviderSucceeded = true;
      if (result.found) {
        dictionaryCache.set(word, { checkedAt: Date.now(), result });
        return result;
      }
    } catch (error) {
      logCommandSystem(`Word Chain dictionary lookup failed for ${word}: ${error?.message ?? 'unknown error'}`);
    }
  }

  const result = anyProviderSucceeded ? { ok: true, found: false, source: 'multi' } : { ok: false, found: false, source: 'multi' };
  dictionaryCache.set(word, { checkedAt: Date.now(), result });
  return result;
}

async function validateWord(word) {
  if (!currentGame) return 'No active game.';
  if (word.length !== currentGame.wordLength) return `Word must have exactly ${currentGame.wordLength} letters.`;

  const dictionaryResult = await isKnownEnglishWord(word);
  if (!dictionaryResult.ok) return { temporary: true, reason: 'Dictionary lookup is unavailable right now. Try again in a moment.' };
  if (!dictionaryResult.found) return 'That word was not found in the English dictionary.';
  return null;
}

async function punishInvalidWord(message, word, reason) {
  const restrictionEndsAt = restrictPlayer(message);
  if (currentGame) {
    currentGame.streak = 0;
    persistState();
  }
  await message.react('\u274c').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word || 'invalid'}**: ${reason}\n${getWordLengthLine()}\n${getStreakLine()}\nThey are restricted from Word Chain until ${formatCountdown(restrictionEndsAt)}.`, 0xed4245, message.guild.id);
  await loseHeart('Invalid word penalty.');
}

async function rejectTemporaryValidationIssue(message, word, reason) {
  await message.react('\u26a0\ufe0f').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word}**, but ${reason}\n${getWordLengthLine()}\n${getStreakLine()}\nNo heart was lost and no restriction was applied.`, 0xfee75c, message.guild.id);
}

async function warnInvalidWord(message, word, reason) {
  await message.react('\u26a0\ufe0f').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word}**: ${reason}\n${getWordLengthLine()}\n${getStreakLine()}\nWarning only: no heart was lost and no restriction was applied.`, 0xfee75c, message.guild.id);
}

async function handleConfiguredViolation(message, word, reason, action) {
  if (action === 'warn') {
    await warnInvalidWord(message, word, reason);
    return;
  }
  await punishInvalidWord(message, word, reason);
}

async function rejectRepeatedPlayer(message) {
  await message.react('\u26a0\ufe0f').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> must wait for another player before replying again.\n${getWordLengthLine()}\n${getStreakLine()}\nNo heart was lost and no restriction was applied.`, 0xfee75c, message.guild.id);
}

async function acceptWord(message, word) {
  if (!currentGame.guildId) currentGame.guildId = message.guild.id;
  currentGame.usedWords.add(word);
  currentGame.lastWord = word;
  currentGame.lastUserId = message.author.id;
  currentGame.requiredFirstLetter = word.at(-1);
  currentGame.streak = (currentGame.streak || 0) + 1;
  const xpResult = awardCorrectWordXp(message);
  const eventResult = await wordChainEventManager.awardCorrectWord(message, word, currentGame.streak);
  resetTurnCountdown();
  await message.react('\u2705').catch(() => null);
  const xpLine = xpResult ? `XP earned: **${xpResult.xp} XP** (${currentGame.wordLength}x)` : null;
  const eventLuckLine = eventResult.active ? `Event luck: **+${eventResult.luckBonusPercent}%**` : null;
  const prizeLine = wordChainEventManager.formatPrizeAwardLine(eventResult.awards);
  await sendToGameChannel([
    `<@${message.author.id}> accepted: **${word}**`,
    getWordLengthLine(),
    getStreakLine(),
    eventLuckLine,
    prizeLine,
    xpLine,
    `Next starts with **${currentGame.requiredFirstLetter.toUpperCase()}**.`,
    `Countdown reset: ${formatCountdown(currentGame.expiresAt)}`,
  ].filter(Boolean).join('\n'), 0x57f287, message.guild.id);
}

async function init(client) {
  clientRef = client;
  if (initStarted) return;
  initStarted = true;
  restoreState();
  await getGameChannel(getGameGuildId());
  await wordChainEventManager.init(client, currentGame?.streak || 0);
  if (currentGame) {
    scheduleTurnTimer();
    logCommandSystem(`Word Chain restored active game for guild ${getGameGuildId()}; no public restore message sent.`);
    return;
  }
  if (cooldownEndsAt > Date.now()) {
    clearCooldownTimer();
    cooldownTimer = setTimeout(() => {
      cooldownEndsAt = 0;
      persistState();
      void startGame('auto', getFallbackGuildId());
    }, Math.max(1000, cooldownEndsAt - Date.now()));
    return;
  }
  await startGame('auto', getFallbackGuildId());
}

async function handleMessageCreate(message) {
  if (message.author?.bot || !message.guild || message.channelId !== getWordChainChannelId(message.guild.id)) return;
  const restrictionEndsAt = getRestrictionEnd(message.author.id);
  if (restrictionEndsAt) {
    await sendRestrictionNotice(message, restrictionEndsAt);
    return;
  }
  if (!currentGame) {
    if (cooldownEndsAt > Date.now()) return;
    await startGame('auto', message.guild.id);
    return;
  }
  if (!currentGame.guildId) {
    currentGame.guildId = message.guild.id;
    persistState();
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

  if (word.length !== currentGame.wordLength) {
    await punishInvalidWord(message, word, `Word must have exactly ${currentGame.wordLength} letters.`);
    return;
  }

  const settings = getWordChainSettings(message.guild.id);
  if (currentGame.usedWords.has(word)) {
    await handleConfiguredViolation(message, word, 'That word was already used.', settings.repeatedWordAction);
    return;
  }

  if (currentGame.requiredFirstLetter && !word.startsWith(currentGame.requiredFirstLetter)) {
    await handleConfiguredViolation(
      message,
      word,
      `Word must start with "${currentGame.requiredFirstLetter.toUpperCase()}".`,
      settings.wrongStartAction,
    );
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
  const wordChainChannelId = getWordChainChannelId(interaction.guildId);
  if (interaction.channelId !== wordChainChannelId && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: `Word Chain is only playable in <#${wordChainChannelId}>.`, flags: 64, allowedMentions: NO_MENTIONS });
    return;
  }

  if (!currentGame && cooldownEndsAt > Date.now()) {
    await interaction.reply({ content: `Word Chain is on cooldown. A new game starts ${formatCountdown(cooldownEndsAt)}.`, flags: interaction.channelId === wordChainChannelId ? undefined : 64, allowedMentions: NO_MENTIONS });
    return;
  }

  if (!currentGame) await startGame('manual', interaction.guildId);
  await interaction.reply({ content: getGameLine(interaction.guildId), flags: interaction.channelId === wordChainChannelId ? undefined : 64, allowedMentions: NO_MENTIONS });
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
