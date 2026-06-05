const { PermissionFlagsBits } = require('discord.js');
const { logCommandSystem } = require('./commandLogger');
const { VALID_NOI_CHU_WORDS } = require('./noiChuWords');

const NOI_CHU_CHANNEL_ID = '1512480152410525958';
const MIN_WORD_LENGTH = 3;
const MAX_WORD_LENGTH = 10;
const STARTING_HEARTS = 3;
const TURN_TIMEOUT_MS = 60 * 60 * 1000;
const PUNISHMENT_MS = 60 * 60 * 1000;
const GAME_COOLDOWN_MS = 60 * 1000;
const COMPONENTS_V2_FLAG = 32768;

const wordSet = new Set(VALID_NOI_CHU_WORDS.map(normalizeWord).filter(Boolean));
const wordsByLength = new Map();
for (const word of wordSet) {
  if (word.length < MIN_WORD_LENGTH || word.length > MAX_WORD_LENGTH) continue;
  if (!wordsByLength.has(word.length)) wordsByLength.set(word.length, []);
  wordsByLength.get(word.length).push(word);
}

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
  const availableLengths = [];
  for (let length = MIN_WORD_LENGTH; length <= MAX_WORD_LENGTH; length += 1) {
    if ((wordsByLength.get(length) || []).length > 0) availableLengths.push(length);
  }
  return randomItem(availableLengths) || MIN_WORD_LENGTH;
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

function getGameLine() {
  if (!currentGame) return 'Noi chu game is not running.';
  const required = currentGame.requiredFirstLetter ? `\nNext word must start with: **${currentGame.requiredFirstLetter.toUpperCase()}**` : '';
  const previous = currentGame.lastWord ? `\nLast word: **${currentGame.lastWord}**` : '\nFirst valid word can start with any letter.';
  return [
    '**Noi chu is running**',
    `Channel: <#${NOI_CHU_CHANNEL_ID}>`,
    `Word length: **${currentGame.wordLength} letters**`,
    `Server hearts: **${currentGame.hearts}/${STARTING_HEARTS}**`,
    `Countdown: ${formatCountdown(currentGame.expiresAt)}`,
    previous,
    required,
  ].join('\n');
}

async function sendToGameChannel(content, accentColor) {
  const channel = await getGameChannel();
  if (!channel?.isTextBased?.()) return null;
  return channel.send(buildPanel(content, accentColor)).catch((error) => {
    logCommandSystem(`Noi chu send failed: ${error?.message ?? 'unknown error'}`);
    return null;
  });
}

async function getGameChannel() {
  if (channelRef?.id === NOI_CHU_CHANNEL_ID) return channelRef;
  if (!clientRef) return null;
  channelRef = clientRef.channels.cache.get(NOI_CHU_CHANNEL_ID)
    || await clientRef.channels.fetch(NOI_CHU_CHANNEL_ID).catch((error) => {
      logCommandSystem(`Noi chu channel fetch failed: ${error?.message ?? 'unknown error'}`);
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
  await sendToGameChannel(`Noi chu game ended: ${reason}\nA new game will start ${formatCountdown(Date.now() + GAME_COOLDOWN_MS)}.`, 0xed4245);
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
  await sendToGameChannel(`${reason}\nServer lost 1 heart. Hearts left: **${currentGame.hearts}/${STARTING_HEARTS}**\nCountdown restarted: ${formatCountdown(currentGame.expiresAt)}`, 0xfee75c);
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
    logCommandSystem(`Noi chu mute failed for ${message.author.id}: ${error?.message ?? 'unknown error'}`);
  });

  setTimeout(() => {
    channel.permissionOverwrites.edit(member.id, { SendMessages: previousSendMessages }, { reason: `Noi chu punishment expired for ${member.id}` }).catch((error) => {
      logCommandSystem(`Noi chu unmute failed for ${member.id}: ${error?.message ?? 'unknown error'}`);
    });
  }, PUNISHMENT_MS);

  return true;
}

function validateWord(word) {
  if (!currentGame) return 'No active game.';
  if (word.length !== currentGame.wordLength) return `Word must have exactly ${currentGame.wordLength} letters.`;
  if (currentGame.usedWords.has(word)) return 'That word was already used.';
  if (!wordSet.has(word)) return 'That word is not in the noi chu dictionary.';
  if (currentGame.requiredFirstLetter && !word.startsWith(currentGame.requiredFirstLetter)) {
    return `Word must start with "${currentGame.requiredFirstLetter.toUpperCase()}".`;
  }
  return null;
}

async function punishInvalidWord(message, word, reason) {
  await muteMemberInGameChannel(message, `Noi chu invalid word: ${reason}`);
  await message.react('\u274c').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> submitted **${word || 'invalid'}**: ${reason}\nThey are muted in this channel for 1 hour.`, 0xed4245);
  await loseHeart('Invalid word penalty.');
}

async function acceptWord(message, word) {
  currentGame.usedWords.add(word);
  currentGame.lastWord = word;
  currentGame.requiredFirstLetter = word.at(-1);
  resetTurnCountdown();
  await message.react('\u2705').catch(() => null);
  await sendToGameChannel(`<@${message.author.id}> accepted: **${word}**\nNext starts with **${currentGame.requiredFirstLetter.toUpperCase()}**.\nCountdown reset: ${formatCountdown(currentGame.expiresAt)}`, 0x57f287);
}

async function init(client) {
  clientRef = client;
  if (initStarted) return;
  initStarted = true;
  await getGameChannel();
  await startGame('auto');
}

async function handleMessageCreate(message) {
  if (message.author?.bot || message.channelId !== NOI_CHU_CHANNEL_ID || !message.guild) return;
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

  const invalidReason = validateWord(word);
  if (invalidReason) {
    await punishInvalidWord(message, word, invalidReason);
    return;
  }

  await acceptWord(message, word);
}

async function handleStatus(interaction) {
  if (interaction.channelId !== NOI_CHU_CHANNEL_ID && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: `Noi chu is only playable in <#${NOI_CHU_CHANNEL_ID}>.`, flags: 64 });
    return;
  }

  if (!currentGame && cooldownEndsAt > Date.now()) {
    await interaction.reply({ content: `Noi chu is on cooldown. A new game starts ${formatCountdown(cooldownEndsAt)}.`, flags: interaction.channelId === NOI_CHU_CHANNEL_ID ? undefined : 64 });
    return;
  }

  if (!currentGame) await startGame('manual');
  await interaction.reply({ content: getGameLine(), flags: interaction.channelId === NOI_CHU_CHANNEL_ID ? undefined : 64 });
}

module.exports = {
  NOI_CHU_CHANNEL_ID,
  init,
  handleMessageCreate,
  handleStatus,
  normalizeWord,
  validateWord,
};
