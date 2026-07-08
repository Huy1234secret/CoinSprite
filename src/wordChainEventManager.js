const { loadEventState, saveEventState } = require('./wordChainEventStore');
const { logCommandSystem } = require('./commandLogger');

const COMPONENTS_V2_FLAG = 32768;
const NO_MENTIONS = { parse: [] };
const GREEN = 0x57f287;
const LUCK_STREAK_INTERVAL = 40;
const LUCK_STEP_PERCENT = 10;
const MAX_LUCK_PERCENT = 100;
const BASE_CHANCE_MULTIPLIER = 10;

let clientRef = null;
let eventState = null;
let announcementChannelRef = null;
let announcementQueue = Promise.resolve();
let lastRenderedLuckPercent = null;
let lastKnownStreak = 0;
let expiryTimer = null;

function parseEndTime(state = eventState) {
  return Date.parse(state?.endsAt || '');
}

function isEventActive(state = eventState, now = Date.now()) {
  const endsAt = parseEndTime(state);
  return Boolean(state?.enabled && Number.isFinite(endsAt) && now < endsAt);
}

function calculateLuckBonusPercent(streak) {
  const completedIntervals = Math.floor(Math.max(0, Number(streak) || 0) / LUCK_STREAK_INTERVAL);
  return Math.min(MAX_LUCK_PERCENT, completedIntervals * LUCK_STEP_PERCENT);
}

function getAdjustedChance(prize, streak) {
  const denominator = Math.max(1, Number(prize?.chanceDenominator) || 1);
  const multiplier = BASE_CHANCE_MULTIPLIER * (1 + (calculateLuckBonusPercent(streak) / 100));
  return Math.min(1, multiplier / denominator);
}

function formatPrizeAwardLine(awards) {
  if (!Array.isArray(awards) || !awards.length) return null;
  return `🎁 Event prize${awards.length === 1 ? '' : 's'} won: **${awards.map((award) => award.prizeName).join(', ')}**`;
}

function buildPrizeSummary(awards) {
  const summary = {};
  for (const award of Array.isArray(awards) ? awards : []) {
    const userId = String(award?.userId || '').trim();
    const prizeName = String(award?.prizeName || '').trim();
    if (!userId || !prizeName) continue;
    summary[userId] ||= {};
    summary[userId][prizeName] = (Number(summary[userId][prizeName]) || 0) + 1;
  }
  return summary;
}

function refreshPrizeSummary(state) {
  if (!state || typeof state !== 'object') return false;
  const summary = buildPrizeSummary(state?.awards);
  const changed = !Object.prototype.hasOwnProperty.call(state, 'prizeSummary')
    || JSON.stringify(state.prizeSummary || {}) !== JSON.stringify(summary);
  state.prizeSummary = summary;
  return changed;
}

function formatChancePercent(chance) {
  return (Math.max(0, Number(chance) || 0) * 100)
    .toFixed(6)
    .replace(/0+$/, '')
    .replace(/\.$/, '') + '%';
}

function formatCountdown(timestamp) {
  return `<t:${Math.floor(timestamp / 1000)}:R>`;
}

function buildAnnouncementPayload(state = eventState, streak = 0, now = Date.now()) {
  const endsAt = parseEndTime(state);
  const active = isEventActive(state, now);
  const prizeLines = (Array.isArray(state?.prizes) ? state.prizes : []).map((prize) => (
    `* ${prize.name} \`${formatChancePercent(getAdjustedChance(prize, streak))}\` - ${Math.max(0, Number(prize.amountLeft) || 0)}`
  ));
  const timeLine = Number.isFinite(endsAt)
    ? `* Time last: ${formatCountdown(endsAt)}`
    : '* Time last: unavailable';
  const statusLine = active ? '' : '\n* Status: **Ended**';

  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: NO_MENTIONS,
    components: [
      {
        type: 17,
        accent_color: GREEN,
        components: [
          {
            type: 10,
            content: `## Word Chain event\n* Location: <#${state?.gameChannelId || ''}>\n${timeLine}${statusLine}`,
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content: `### Prize pool:\n${prizeLines.join('\n') || '* No prizes left.'}`,
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content: '### Note:\n* Prize chances are boosted **10x**.\n* Every 40 streak = +10% luck `[cap 100%]`\n* Incorrect words restrict that player from Word Chain until their restriction expires.',
          },
        ],
      },
    ],
  };
}

function rollAvailablePrizes(state, context, random = Math.random, now = Date.now()) {
  if (!isEventActive(state, now)) return [];
  const awards = [];
  state.awards = Array.isArray(state.awards) ? state.awards : [];

  for (const prize of Array.isArray(state.prizes) ? state.prizes : []) {
    const amountLeft = Math.max(0, Math.floor(Number(prize.amountLeft) || 0));
    if (amountLeft <= 0 || random() >= getAdjustedChance(prize, context.streak)) continue;

    prize.amountLeft = amountLeft - 1;
    const award = {
      id: `${now}-${context.messageId}-${prize.id}`,
      prizeId: prize.id,
      prizeName: prize.name,
      userId: String(context.userId),
      guildId: String(context.guildId),
      channelId: String(context.channelId),
      messageId: String(context.messageId),
      word: String(context.word),
      streak: Math.max(0, Math.floor(Number(context.streak) || 0)),
      awardedAt: new Date(now).toISOString(),
    };
    state.awards.push(award);
    awards.push(award);
  }

  if (awards.length) refreshPrizeSummary(state);

  return awards;
}

async function getAnnouncementChannel() {
  const channelId = eventState?.announcementChannelId;
  if (!channelId || !clientRef) return null;
  if (announcementChannelRef?.id === channelId) return announcementChannelRef;
  announcementChannelRef = clientRef.channels.cache.get(channelId)
    || await clientRef.channels.fetch(channelId).catch((error) => {
      logCommandSystem(`Word Chain event channel fetch failed: ${error?.message ?? 'unknown error'}`);
      return null;
    });
  return announcementChannelRef;
}

async function updateAnnouncement(streak = 0) {
  if (!eventState) return null;
  if (!isEventActive(eventState) && !eventState.announcementMessageId) return null;
  const channel = await getAnnouncementChannel();
  if (!channel?.isTextBased?.()) return null;

  const payload = buildAnnouncementPayload(eventState, streak);
  let announcement = null;
  if (eventState.announcementMessageId && channel.messages?.fetch) {
    announcement = await channel.messages.fetch(eventState.announcementMessageId).catch(() => null);
  }

  if (announcement?.edit) {
    await announcement.edit(payload).catch((error) => {
      logCommandSystem(`Word Chain event announcement edit failed: ${error?.message ?? 'unknown error'}`);
    });
  } else if (isEventActive(eventState)) {
    announcement = await channel.send(payload).catch((error) => {
      logCommandSystem(`Word Chain event announcement send failed: ${error?.message ?? 'unknown error'}`);
      return null;
    });
    if (announcement?.id) {
      eventState.announcementMessageId = announcement.id;
      saveEventState(eventState);
    }
  }

  lastRenderedLuckPercent = calculateLuckBonusPercent(streak);
  return announcement;
}

function refreshAnnouncement(streak = 0, force = false) {
  lastKnownStreak = Math.max(0, Math.floor(Number(streak) || 0));
  announcementQueue = announcementQueue
    .catch(() => null)
    .then(() => (force || isEventActive(eventState) ? updateAnnouncement(lastKnownStreak) : null));
  return announcementQueue;
}

function scheduleExpiryRefresh() {
  if (expiryTimer) clearTimeout(expiryTimer);
  expiryTimer = null;
  const endsAt = parseEndTime();
  if (!Number.isFinite(endsAt) || endsAt <= Date.now()) return;
  const waitMs = Math.min(2_147_000_000, Math.max(1000, endsAt - Date.now() + 1000));
  expiryTimer = setTimeout(() => {
    void refreshAnnouncement(lastKnownStreak, true);
  }, waitMs);
}

async function init(client, streak = 0) {
  clientRef = client;
  eventState = loadEventState();
  if (!eventState) {
    logCommandSystem('Word Chain event data is missing; event disabled.');
    return;
  }
  if (refreshPrizeSummary(eventState)) saveEventState(eventState);
  await refreshAnnouncement(streak, true);
  scheduleExpiryRefresh();
}

async function awardCorrectWord(message, word, streak) {
  if (!eventState || !isEventActive(eventState)) return { active: false, awards: [], luckBonusPercent: 0 };
  if (String(message.guild.id) !== String(eventState.guildId)
    || String(message.channelId) !== String(eventState.gameChannelId)) {
    return { active: false, awards: [], luckBonusPercent: 0 };
  }
  const awards = rollAvailablePrizes(eventState, {
    userId: message.author.id,
    guildId: message.guild.id,
    channelId: message.channelId,
    messageId: message.id,
    word,
    streak,
  });
  const luckBonusPercent = calculateLuckBonusPercent(streak);
  if (awards.length) saveEventState(eventState);
  if (awards.length || luckBonusPercent !== lastRenderedLuckPercent) {
    await refreshAnnouncement(streak);
  }
  return { active: true, awards, luckBonusPercent };
}

function getCurrentLuckLine(streak, guildId = null) {
  if (!isEventActive(eventState) || (guildId && String(guildId) !== String(eventState.guildId))) return null;
  return `Event luck: **+${calculateLuckBonusPercent(streak)}%**`;
}

module.exports = {
  awardCorrectWord,
  buildAnnouncementPayload,
  buildPrizeSummary,
  calculateLuckBonusPercent,
  formatChancePercent,
  formatPrizeAwardLine,
  getAdjustedChance,
  getCurrentLuckLine,
  init,
  isEventActive,
  refreshAnnouncement,
  rollAvailablePrizes,
};
