const { PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('./commandLogger');
const levelingManager = require('./levelingManager');
const { loadState, saveState } = require('./wordChainStore');

const WORD_CHAIN_CHANNEL_ID = '1512480152410525958';
const MIN_WORD_LENGTH = 3;
const MAX_WORD_LENGTH = 10;
const STARTING_HEARTS = 3;
const TURN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const PUNISHMENT_MS = 60 * 1000;
const PUNISHMENT_ROLE_ID = '1512488707461091420';
const GAME_COOLDOWN_MS = 60 * 1000;
const DICTIONARY_LOOKUP_TIMEOUT_MS = 5000;
const DICTIONARY_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const DICTIONARY_API_BASE_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const WIKTIONARY_API_BASE_URL = 'https://en.wiktionary.org/api/rest_v1/page/definition';
const DATAMUSE_API_BASE_URL = 'https://api.datamuse.com/words';
const COMPONENTS_V2_FLAG = 32768;

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
let initStarted = false;

function serializeGame(game) {
  if (!game) return null;
  const wordLength = Number(game.wordLength);
  const hearts = Number(game.hearts);
  const startedAt = Number(game.startedAt);
  const expiresAt = Number(game.expiresAt);
  return {
    wordLength: Number.isFinite(wordLength) ? wordLength : MIN_WORD_LENGTH,
    hearts: Number.isFinite(hearts) ? hearts : STARTING_HEARTS,
    usedWords: Array.from(game.usedWords || []),
    lastWord: game.lastWord || null,
    lastUserId: game.lastUserId || null,
    requiredFirstLetter: game.requiredFirstLetter || null,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + TURN_TIMEOUT_MS,
    streak: Number(game.streak) || 0,
  };
}

function hydrateGame(game) {
  if (!game || !Number.isFinite(Number(game.wordLength))) return null;
  const parsedHearts = Number(game.hearts);
  const hearts = Math.min(STARTING_HEARTS, Math.max(0, Math.floor(Number.isFinite(parsedHearts) ? parsedHearts : STARTING_HEARTS)));
  if (hearts <= 0) return null;
  return {
    wordLength: Math.min(MAX_WORD_LENGTH, Math.max(MIN_WORD_LENGTH, Math.floor(Number(game.wordLength)))),
    hearts,
    usedWords: new Set(Array.isArray(game.usedWords) ? game.usedWords.map(normalizeWord).filter(Boolean) : []),
    lastWord: game.lastWord ? normalizeWord(game.lastWord) : null,
    lastUserId: game.lastUserId || null,
    requiredFirstLetter: game.requiredFirstLetter ? normalizeWord(game.requiredFirstLetter).slice(0, 1) : null,
    startedAt: Number(game.startedAt) || Date.now(),
    expiresAt: Number(game.expiresAt) || Date.now() + TURN_TIMEOUT_MS,
    streak: Math.max(0, Math.floor(Number(game.streak) || 0)),
  };
}

function persistState() {
  saveState({
    game: serializeGame(currentGame),
    cooldownEndsAt,
  });
}

function restoreState() {
  const state = loadState();
  currentGame = hydrateGame(state.game);
  cooldownEndsAt = Number(state.cooldownEndsAt) || 0;
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

function getStreakLine() {
  return currentGame ? `Streak: **${currentGame.streak || 0} words**` : null;
}

function awardCorrectWordXp(message) {
  if (!message.guild?.id || !message.author?.id || !currentGame) return null;
  return levelingManager.awardMessageXp(message.guild.id, message.author.id, {
    fixedXp: currentGame.wordLength,
    source: 'word chain',
    channelId: message.channelId,
    messageId: message.id,
  });
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
    `Streak: **${currentGame.streak || 0} words**`,
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
  persistState();
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
    streak: 0,
  };
  persistState();
  scheduleTurnTimer();

  await sendToGameChannel(`${getGameLine()}\n\nGame started${reason === 'auto' ? ' automatically' : ''}.`, 0x57f287);
  return currentGame;
}

function scheduleNextGame() {
  clearCooldownTimer();
  cooldownEndsAt = Date.now() + GAME_COOLDOWN_MS;
  persistState();
  cooldownTimer = setTimeout(() => {
    cooldownEndsAt = 0;
    persistState();
    void startGame('auto');
  }, GAME_COOLDOWN_MS);
}

async function endGame(reason) {
  clearTurnTimer();
  currentGame = null;
  persistState();
  await sendToGameChannel(`Word Chain game ended: ${reason}\nA new game will start ${formatCountdown(Date.now() + GAME_COOLDOWN_MS)}.`, 0xed4245);
  scheduleNextGame();
}

async function loseHeart(reason) {
  if (!currentGame) return;
  currentGame.hearts -= 1;
  currentGame.streak = 0;
  persistState();

  if (currentGame.hearts <= 0) {
    await endGame(`${reason}. Server ran out of hearts.`);
    return;
  }

  resetTurnCountdown();
  await sendToGameChannel(`${reason}\n${getWordLengthLine()}\n${getStreakLine()}\nServer lost 1 heart. Hearts left: **${currentGame.hearts}/${STARTING_HEARTS}**\nCountdown restarted: ${formatCountdown(currentGame.expiresAt)}`, 0xfee75c);
}

async function handleTurnTimeout() {
  if (!currentGame) return;
  await loseHeart('Countdown ran out.');
}

async function fetchBotMember(guild) {
  return guild.members.me || await guild.members.fetchMe().catch(() => null);
}

async function getPunishmentRole(guild) {
  return guild.roles.cache.get(PUNISHMENT_ROLE_ID)
    || await guild.roles.fetch(PUNISHMENT_ROLE_ID).catch(() => null);
}

function canBotManageRole(botMember, role) {
  if (!botMember || !role) return false;
  if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  return botMember.roles.highest.position > role.position;
}

async function muteMemberInGameChannel(message, reason) {
  const member = await message.guild.members.fetch(message.author.id).catch(() => message.member || null);
  const channel = message.channel;
  const result = {
    muted: false,
    roleAdded: false,
    roleAlreadyPresent: false,
    roleError: null,
  };
  if (!member || !channel?.permissionOverwrites?.edit) {
    result.roleError = 'Could not fetch the member or channel.';
    return result;
  }

  const currentOverwrite = channel.permissionOverwrites.cache.get(member.id);
  let previousSendMessages = null;
  if (currentOverwrite?.allow?.has(PermissionFlagsBits.SendMessages)) previousSendMessages = true;
  if (currentOverwrite?.deny?.has(PermissionFlagsBits.SendMessages)) previousSendMessages = false;

  result.muted = await channel.permissionOverwrites.edit(member.id, { SendMessages: false }, { reason }).then(() => true).catch((error) => {
    logCommandSystem(`Word Chain mute failed for ${message.author.id}: ${error?.message ?? 'unknown error'}`);
    return false;
  });

  const punishmentRole = await getPunishmentRole(message.guild);
  const botMember = await fetchBotMember(message.guild);
  result.roleAlreadyPresent = member.roles.cache.has(PUNISHMENT_ROLE_ID);
  if (!punishmentRole) {
    result.roleError = `Role ${PUNISHMENT_ROLE_ID} was not found.`;
  } else if (result.roleAlreadyPresent) {
    result.roleAdded = true;
  } else if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    result.roleError = 'Bot is missing Manage Roles permission.';
  } else if (!canBotManageRole(botMember, punishmentRole)) {
    result.roleError = `Bot role must be above <@&${PUNISHMENT_ROLE_ID}>.`;
  } else {
    result.roleAdded = await member.roles.add(punishmentRole, reason).then(() => true).catch((error) => {
      result.roleError = error?.message || 'Discord rejected the role add.';
      logCommandSystem(`Word Chain punishment role add failed for ${message.author.id}: ${result.roleError}`);
      return false;
    });
  }

  setTimeout(() => {
    channel.permissionOverwrites.edit(member.id, { SendMessages: previousSendMessages }, { reason: `Word Chain punishment expired for ${member.id}` }).catch((error) => {
      logCommandSystem(`Word Chain unmute failed for ${member.id}: ${error?.message ?? 'unknown error'}`);
    });
    if (result.roleAdded && !result.roleAlreadyPresent) {
      member.roles.remove(PUNISHMENT_ROLE_ID, `Word Chain punishment expired for ${member.id}`).catch((error) => {
        logCommandSystem(`Word Chain punishment role remove failed for ${member.id}: ${error?.message ?? 'unknown error'}`);
      });
    }
  }, PUNISHMENT_MS);

  return result;
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
  if (currentGame.usedWords.has(word)) return 'That word was already used.';
  if (currentGame.requiredFirstLetter && !word.startsWith(currentGame.requiredFirstLetter)) {
    return `Word must start with "${currentGame.requiredFirstLetter.toUpperCase()}".`;
  }

  const dictionaryResult = await isKnownEnglishWord(word);
  if (!dictionaryResult.ok) return { temporary: true, reason: 'Dictionary lookup is unavailable right now. Try again in a moment.' };
  if (!dictionaryResult.found) return 'That word was not found in the English dictionary.';
  return null;
}

function formatPunishmentLine(result) {
  const muteText = result?.muted ? 'muted in this channel' : 'not muted because channel permissions could not be updated';
  if (result?.roleAdded) {
    const roleText = result.roleAlreadyPresent ? `already had <@&${PUNISHMENT_ROLE_ID}>` : `given <@&${PUNISHMENT_ROLE_ID}>`;
    return `They are ${muteText} and ${roleText} for 1 minute.`;
  }

  const roleError = result?.roleError || 'unknown role add error';
  return `They are ${muteText} for 1 minute. Role was not added: ${roleError}`;
}

async function punishInvalidWord(message, word, reason) {
  const punishment = await muteMemberInGameChannel(message, `Word Chain invalid word: ${reason}`);
  if (currentGame) {
    currentGame.streak = 0;
    persistState();
  }
  await message.react('\u274c').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word || 'invalid'}**: ${reason}\n${getWordLengthLine()}\n${getStreakLine()}\n${formatPunishmentLine(punishment)}`, 0xed4245);
  await loseHeart('Invalid word penalty.');
}

async function rejectTemporaryValidationIssue(message, word, reason) {
  await message.react('\u26a0\ufe0f').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word}**, but ${reason}\n${getWordLengthLine()}\n${getStreakLine()}\nNo heart was lost and no mute was applied.`, 0xfee75c);
}

async function rejectRepeatedPlayer(message) {
  await message.react('\u26a0\ufe0f').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> must wait for another player before replying again.\n${getWordLengthLine()}\n${getStreakLine()}\nNo heart was lost and no mute was applied.`, 0xfee75c);
}

async function acceptWord(message, word) {
  currentGame.usedWords.add(word);
  currentGame.lastWord = word;
  currentGame.lastUserId = message.author.id;
  currentGame.requiredFirstLetter = word.at(-1);
  currentGame.streak = (currentGame.streak || 0) + 1;
  const xpResult = awardCorrectWordXp(message);
  resetTurnCountdown();
  await message.react('\u2705').catch(() => null);
  const xpLine = xpResult ? `XP earned: **${xpResult.xp} XP** (${currentGame.wordLength}x)` : null;
  await sendToGameChannel(`<@${message.author.id}> accepted: **${word}**\n${getWordLengthLine()}\n${getStreakLine()}\n${xpLine}\nNext starts with **${currentGame.requiredFirstLetter.toUpperCase()}**.\nCountdown reset: ${formatCountdown(currentGame.expiresAt)}`, 0x57f287);
}

async function init(client) {
  clientRef = client;
  if (initStarted) return;
  initStarted = true;
  restoreState();
  await getGameChannel();
  if (currentGame) {
    scheduleTurnTimer();
    await sendToGameChannel(`${getGameLine()}\n\nGame restored after restart.`, 0x57f287);
    return;
  }
  if (cooldownEndsAt > Date.now()) {
    clearCooldownTimer();
    cooldownTimer = setTimeout(() => {
      cooldownEndsAt = 0;
      persistState();
      void startGame('auto');
    }, Math.max(1000, cooldownEndsAt - Date.now()));
    return;
  }
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
