const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const XP_LOGS_DIR = path.join(LOGS_DIR, 'xp log');

function padTwo(value) {
  return String(value).padStart(2, '0');
}

function getCurrentDateParts(now = new Date()) {
  const day = padTwo(now.getUTCDate());
  const month = padTwo(now.getUTCMonth() + 1);
  const year = now.getUTCFullYear();
  return { day, month, year };
}

function getCurrentTime(now = new Date()) {
  const minutes = padTwo(now.getUTCMinutes());
  const hours = padTwo(now.getUTCHours());
  return `${minutes}:${hours}`;
}

function getDailyXpLogPath(now = new Date()) {
  const { day, month, year } = getCurrentDateParts(now);
  return path.join(XP_LOGS_DIR, `XP Log ${day}-${month}-${year}.log`);
}

function formatXpAmount(value) {
  const numeric = Number(value) || 0;
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function formatLocation({ channelId, guildId, messageId }) {
  const channelPart = channelId ? `channel ${channelId}` : 'bot DM or unknown channel';
  const guildPart = guildId ? `guild ${guildId}` : 'DM/no guild';
  const messagePart = messageId ? `, message ${messageId}` : '';
  return `${channelPart} (${guildPart}${messagePart})`;
}

function appendXpLogLine(message, now = new Date()) {
  fs.mkdirSync(XP_LOGS_DIR, { recursive: true });
  const line = `${getCurrentTime(now)} // ${message}
`;
  fs.appendFileSync(getDailyXpLogPath(now), line, 'utf8');
}

function logXpEarn({
  userId,
  guildId = null,
  amount,
  rawXp = null,
  source = 'unknown source',
  channelId = null,
  messageId = null,
  command = null,
  totalXp = null,
  oldLevel = null,
  newLevel = null,
} = {}) {
  const earned = Number(amount) || 0;
  if (!userId || earned <= 0) return;

  const parts = [
    `${userId} earned ${formatXpAmount(earned)} XP`,
    `from ${source}`,
  ];

  if (rawXp !== null && Number(rawXp) !== earned) {
    parts.push(`raw ${formatXpAmount(rawXp)} XP`);
  }

  if (command) {
    parts.push(`command ${command}`);
  }

  parts.push(`in ${formatLocation({ channelId, guildId, messageId })}`);

  if (totalXp !== null) {
    parts.push(`total ${formatXpAmount(totalXp)} XP`);
  }

  if (oldLevel !== null && newLevel !== null) {
    parts.push(`level ${oldLevel}->${newLevel}`);
  }

  appendXpLogLine(parts.join(' // '));
}

module.exports = {
  XP_LOGS_DIR,
  logXpEarn,
};
