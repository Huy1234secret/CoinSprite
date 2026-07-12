const fs = require('fs');
const path = require('path');
const util = require('util');
const { DEFAULT_GUILD_CONFIG, getEnabledGuildIds, getGuildConfig, resolveLoggingChannelId } = require('./serverConfig');

const LOGS_DIR = path.join(__dirname, '..', 'logs');
const LOG_THREAD_ID = DEFAULT_GUILD_CONFIG.channels.commandLogThread;
const DISCORD_MESSAGE_LIMIT = 2000;
const OWNER_CONSOLE_LIMIT = 800;

let loggingClient = null;
let logThreadPromise = null;
let ownerConsoleSequence = 0;
let nativeConsolePatched = false;
const ownerConsoleEntries = [];

const nativeConsole = {
  debug: console.debug?.bind(console) || console.log.bind(console),
  error: console.error.bind(console),
  info: console.info?.bind(console) || console.log.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
};

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

function getOwnerConsoleTime(now = new Date()) {
  const hours = padTwo(now.getHours());
  const minutes = padTwo(now.getMinutes());
  const seconds = padTwo(now.getSeconds());
  return `[${hours}:${minutes}:${seconds}]`;
}

function getDailyLogPath(now = new Date()) {
  const { day, month, year } = getCurrentDateParts(now);
  // File-system safe variant of "Log dd/mm/yyyy"
  const fileName = `Log ${day}-${month}-${year}.log`;
  return path.join(LOGS_DIR, fileName);
}

function ownerConsoleLevelFromMessage(message, fallback = 'system') {
  const text = String(message || '').toLowerCase();
  if (/\b(error|failed|fail|exception|crash|invalid|denied|missing|blocked)\b/.test(text)) return 'error';
  if (/\b(warn|warning|retry|skipped|unavailable|limited)\b/.test(text)) return 'warn';
  if (/\b(ready|posted|registered|enabled|created|synced|listening|success)\b/.test(text)) return 'ok';
  return fallback;
}

function trimConsoleEntries() {
  if (ownerConsoleEntries.length > OWNER_CONSOLE_LIMIT) {
    ownerConsoleEntries.splice(0, ownerConsoleEntries.length - OWNER_CONSOLE_LIMIT);
  }
}

function pushOwnerConsoleEntry(level, message, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const entry = {
    id: ++ownerConsoleSequence,
    at: now.toISOString(),
    time: getOwnerConsoleTime(now),
    level: String(level || 'log').toLowerCase(),
    source: String(options.source || 'bot').slice(0, 32),
    message: String(message || '').replace(/\s+$/g, '').slice(0, 2000),
  };
  ownerConsoleEntries.push(entry);
  trimConsoleEntries();
  return entry;
}

function formatConsoleArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  return util.inspect(value, { depth: 4, colors: false, breakLength: 140, maxArrayLength: 30 });
}

function captureNativeConsole(level, args) {
  const message = Array.from(args || []).map(formatConsoleArg).join(' ');
  if (!message.trim()) return;
  pushOwnerConsoleEntry(level, message, { source: 'console' });
}

function patchNativeConsole() {
  if (nativeConsolePatched) return;
  nativeConsolePatched = true;
  for (const level of ['debug', 'error', 'info', 'log', 'warn']) {
    console[level] = (...args) => {
      try {
        captureNativeConsole(level, args);
      } catch {}
      nativeConsole[level](...args);
    };
  }
}

function getOwnerConsoleEntries(options = {}) {
  const after = Math.max(0, Number(options.after) || 0);
  const limit = Math.min(OWNER_CONSOLE_LIMIT, Math.max(1, Number(options.limit) || 250));
  const entries = ownerConsoleEntries.filter((entry) => entry.id > after).slice(-limit);
  return {
    entries,
    latestId: ownerConsoleSequence,
    nextAfter: entries.at(-1)?.id || after,
    totalBuffered: ownerConsoleEntries.length,
  };
}

function appendLogLine(message, now = new Date(), options = {}) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  const line = `${getCurrentTime(now)} // ${message}\n`;
  fs.appendFileSync(getDailyLogPath(now), line, 'utf8');
  pushOwnerConsoleEntry(options.level || ownerConsoleLevelFromMessage(message), message, {
    now,
    source: options.source || 'bot',
  });
  void postLogToThread(line.trimEnd());
}

function logCommandUse({ userId, command, channelId }) {
  appendLogLine(`${userId} executed command ${command} in channel ${channelId}`, new Date(), {
    level: 'command',
    source: 'command',
  });
}

function logCommandSystem(message) {
  appendLogLine(`SYSTEM // ${message}`, new Date(), {
    level: ownerConsoleLevelFromMessage(message),
    source: 'system',
  });
}

function setLogClient(client) {
  patchNativeConsole();
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
  getOwnerConsoleEntries,
  logCommandUse,
  logCommandSystem,
  setLogClient,
};
