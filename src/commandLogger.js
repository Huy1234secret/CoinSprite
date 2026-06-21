const fs = require('fs');
const path = require('path');
const { DEFAULT_GUILD_CONFIG, getEnabledGuildIds, getGuildConfig, resolveLoggingChannelId } = require('./serverConfig');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const LOG_THREAD_ID = DEFAULT_GUILD_CONFIG.channels.commandLogThread;
const DISCORD_MESSAGE_LIMIT = 2000;

let loggingClient = null;
let logThreadPromise = null;

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
  void postLogToThread(line.trimEnd());
}

function logCommandUse({ userId, command, channelId }) {
  appendLogLine(`${userId} executed command ${command} in channel ${channelId}`);
}

function logCommandSystem(message) {
  appendLogLine(`SYSTEM // ${message}`);
}

function setLogClient(client) {
  loggingClient = client;
  logThreadPromise = null;
}

async function getLogThread() {
  if (!loggingClient) {
    return null;
  }

  if (!logThreadPromise) {
    const guildId = getEnabledGuildIds()[0];
    const config = getGuildConfig(guildId);
    const logThreadId = resolveLoggingChannelId(config, 'commands', '', config?.channels?.commandLogThread || LOG_THREAD_ID);
    logThreadPromise = loggingClient.channels.fetch(logThreadId).catch((error) => {
      console.error(`Failed to fetch log thread ${logThreadId}:`, error);
      return null;
    });
  }

  return logThreadPromise;
}

function formatThreadLogMessage(line) {
  const prefix = '[BOT LOG] ';
  const maxLineLength = DISCORD_MESSAGE_LIMIT - prefix.length;
  if (line.length <= maxLineLength) {
    return `${prefix}${line}`;
  }

  return `${prefix}${line.slice(0, maxLineLength - 3)}...`;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableDiscordError(error) {
  const status = Number(error?.status || error?.rawError?.status || 0);
  return status >= 500 && status < 600;
}

async function postLogToThread(line) {
  const logThread = await getLogThread();
  if (!logThread || typeof logThread.send !== 'function') {
    return;
  }

  const payload = { content: formatThreadLogMessage(line) };
  try {
    await logThread.send(payload);
  } catch (error) {
    if (isRetryableDiscordError(error)) {
      await wait(1000);
      try {
        await logThread.send(payload);
        return;
      } catch (retryError) {
        console.error(`Failed to send log to thread ${LOG_THREAD_ID}:`, retryError);
        return;
      }
    }
    console.error(`Failed to send log to thread ${LOG_THREAD_ID}:`, error);
  }
}

module.exports = {
  logCommandUse,
  logCommandSystem,
  setLogClient,
};
