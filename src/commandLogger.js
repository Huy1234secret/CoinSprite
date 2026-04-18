const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

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
  // Requested format: mm:hh (24-hour clock)
  const minutes = padTwo(now.getUTCMinutes());
  const hours = padTwo(now.getUTCHours());
  return `${minutes}:${hours}`;
}

function getDailyLogPath(now = new Date()) {
  const { day, month, year } = getCurrentDateParts(now);
  // File-system safe variant of "Log dd/mm/yyyy"
  const fileName = `Log ${day}-${month}-${year}.log`;
  return path.join(LOGS_DIR, fileName);
}

function appendLogLine(message, now = new Date()) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const line = `${getCurrentTime(now)} // ${message}\n`;
  fs.appendFileSync(getDailyLogPath(now), line, 'utf8');
}

function logCommandUse({ userId, command, channelId }) {
  appendLogLine(`${userId} executed command ${command} in channel ${channelId}`);
}

function logCommandSystem(message) {
  appendLogLine(`SYSTEM // ${message}`);
}

module.exports = {
  logCommandUse,
  logCommandSystem,
};
