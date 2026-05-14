const fs = require('fs');
const path = require('path');
const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { startBoost } = require('../src/luckBoosts');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const STORE_PATH = path.join(__dirname, '..', 'data', 'global-rng-event.json');
const CHANNEL_ID = '1503738887929856121';
const PING_ROLE_ID = '1503735931574812762';
const EVENT_START_AT = Date.parse('2026-05-12T14:00:00.000Z');
const EVENT_END_AT = Date.parse('2026-05-26T14:00:00.000Z');
const VOTE_MS = 60_000;
const DECIDING_MS = 10_000;
const WIN_BOOST_MS = 2 * 60 * 60_000;
const LOSE_BOOST_MS = 30 * 60_000;
const FINAL_ROUND = 7;
const PREFIX = 'globalrng';
const COLORS = {
  red: 0xed4245,
  green: 0x57f287,
  yellow: 0xfee75c,
  white: 0xffffff,
};

let scheduler = null;
let schedulerClient = null;

function defaultState() {
  return {
    phase: 'waiting',
    messageId: null,
    nextStartAt: null,
    round: 0,
    resultAt: null,
    decidingEndsAt: null,
    chosenColor: null,
    votes: {},
  };
}

function ensureStore() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(defaultState(), null, 2), 'utf8');
}

function loadState() {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return { ...defaultState(), ...(parsed && typeof parsed === 'object' ? parsed : {}) };
  } catch {
    return defaultState();
  }
}

function saveState(state) {
  ensureStore();
  fs.writeFileSync(STORE_PATH, JSON.stringify({ ...defaultState(), ...state }, null, 2), 'utf8');
}

function rngEventActive(now = Date.now()) {
  return now >= EVENT_START_AT && now < EVENT_END_AT;
}

function formatPrizePercent(multiplier) {
  return Math.round((Math.max(1, Number(multiplier) || 1) - 1) * 100).toLocaleString('en-US');
}

function prizeMultiplierForRound(round) {
  return 2 ** Math.max(1, Math.min(FINAL_ROUND, Math.floor(Number(round) || 1)));
}

function nextEventStart(now = Date.now()) {
  if (now >= EVENT_END_AT) return null;
  const floor = Math.max(now, EVENT_START_AT);
  const shifted = new Date(floor + (7 * 60 * 60_000));
  const atBoundary = shifted.getUTCHours() % 4 === 0
    && shifted.getUTCMinutes() === 0
    && shifted.getUTCSeconds() === 0
    && shifted.getUTCMilliseconds() === 0;
  if (atBoundary) return floor < EVENT_END_AT ? floor : null;

  shifted.setUTCSeconds(0, 0);
  const hour = shifted.getUTCHours();
  const addHours = (4 - (hour % 4)) % 4;
  shifted.setUTCHours(hour + (addHours || 4), 0, 0, 0);
  const startAt = shifted.getTime() - (7 * 60 * 60_000);
  return startAt < EVENT_END_AT ? startAt : null;
}

function getTextChannel(client) {
  const cached = client.channels.cache.get(CHANNEL_ID);
  if (cached?.isTextBased?.()) return Promise.resolve(cached);
  return client.channels.fetch(CHANNEL_ID).then((channel) => (channel?.isTextBased?.() ? channel : null)).catch((error) => {
    console.error(`[global-rng-event] Failed to fetch channel ${CHANNEL_ID}:`, error);
    return null;
  });
}

function voteCounts(votes = {}) {
  const counts = { green: 0, red: 0, stop: 0 };
  for (const vote of Object.values(votes || {})) if (counts[vote] !== undefined) counts[vote] += 1;
  return counts;
}

function button(action, label, style, disabled = false) {
  return { type: 2, custom_id: `${PREFIX}:vote:${action}`, label, style, disabled };
}

function eventPayload({ accent, body, counts = null, disabled = false, content = null }) {
  const displayBody = content ? `${content}\n${body}` : body;
  const components = [{ type: 10, content: displayBody }];
  if (counts) {
    components.push({ type: 14, divider: true, spacing: 1 });
    components.push({
      type: 1,
      components: [
        button('green', String(counts.green), 3, disabled),
        button('red', String(counts.red), 4, disabled),
        button('stop', `Stop - ${counts.stop}`, 2, disabled),
      ],
    });
  }
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [{ type: 17, accent_color: accent, components }],
    allowedMentions: content ? { roles: [PING_ROLE_ID] } : { parse: [] },
  };
}

function waitingPayload(nextStartAt) {
  return eventPayload({
    accent: COLORS.red,
    body: `### 🎉 Global Event\n-# Game start <t:${Math.floor(nextStartAt / 1000)}:R>`,
  });
}

function votingBody(state, intro, resultAtMs = state.resultAt || (Date.now() + VOTE_MS)) {
  const resultAt = Math.floor(resultAtMs / 1000);
  const percent = formatPrizePercent(prizeMultiplierForRound(state.round));
  return `${intro} Result in <t:${resultAt}:R>\n-#** 🎁Prize pool: +${percent}% luck for 2h.**\n\n-# Note: If that color didnt win, you lose all the prize pool and ended up having only 1.2x luck for 30m. If wanted to take the current prize pool, just vote for STOP and you can change your vote.`;
}

function votingPayload(state, intro = '* Pick a color, only 1 color will win! Each color has a 50/50 chance no matter how many people voted for it.') {
  return eventPayload({
    accent: COLORS.green,
    body: `### 🎉 Global Event\n${votingBody(state, intro)}`,
    counts: voteCounts(state.votes),
    content: `<@&${PING_ROLE_ID}>`,
  });
}

function decidingPayload(state) {
  return eventPayload({
    accent: COLORS.white,
    body: `### 🎉 Global Event\n${votingBody(state, '* Deciding the winning color...', state.decidingEndsAt || Date.now() + DECIDING_MS)}`,
    counts: voteCounts(state.votes),
    disabled: true,
  });
}

function finalPayload({ accent, body, multiplier, durationMs, nextStartAt, content = `<@&${PING_ROLE_ID}>` }) {
  const endsAt = Date.now() + durationMs;
  return eventPayload({
    accent,
    body: `### 🎉 Global Event\n${body}\n-# 🎁FINAL Prize pool: +${formatPrizePercent(multiplier)}% luck for ${durationMs === WIN_BOOST_MS ? '2h' : '30m'}. **[boost end <t:${Math.floor(endsAt / 1000)}:R>]**\n-# Game start <t:${Math.floor(nextStartAt / 1000)}:R>`,
    content,
  });
}

function noVotesPayload({ nextStartAt, content = `<@&${PING_ROLE_ID}>` }) {
  return eventPayload({
    accent: COLORS.white,
    body: `### 🎉 Global Event
* No one voted, so this global event round ended without a luck boost.
-# Game start <t:${Math.floor(nextStartAt / 1000)}:R>`,
    content,
  });
}

async function fetchManagedMessage(channel, state) {
  if (!state.messageId) return null;
  return channel.messages.fetch(state.messageId).catch(() => null);
}

async function sendOrEdit(channel, state, payload) {
  const existing = await fetchManagedMessage(channel, state);
  const message = existing ? await existing.edit(payload).catch(() => null) : await channel.send(payload).catch(() => null);
  if (message?.id) state.messageId = message.id;
  return message;
}

async function deleteManagedMessage(channel, state) {
  const existing = await fetchManagedMessage(channel, state);
  if (existing) await existing.delete().catch(() => null);
  state.messageId = null;
}

function schedule(delay, fn) {
  if (scheduler) clearTimeout(scheduler);
  scheduler = setTimeout(() => fn().catch((error) => console.error('[global-rng-event] Scheduler failed:', error)), Math.max(1_000, delay));
  if (typeof scheduler.unref === 'function') scheduler.unref();
}

function scheduleNext(client) {
  if (!client) return;
  const state = loadState();
  const now = Date.now();
  if (!rngEventActive(now) && now >= EVENT_END_AT) return;
  if (state.phase === 'voting') return schedule((state.resultAt || now) - now, () => beginDeciding(client));
  if (state.phase === 'deciding') return schedule((state.decidingEndsAt || now) - now, () => resolveRound(client));
  const nextStartAt = state.nextStartAt || nextEventStart(now);
  if (nextStartAt) schedule(nextStartAt - now, () => startGame(client));
}

async function ensureWaitingMessage(client) {
  const now = Date.now();
  if (!rngEventActive(now)) return;
  const channel = await getTextChannel(client);
  if (!channel) return;
  const state = loadState();
  if (state.phase !== 'waiting' && state.phase !== 'finished') return;
  state.nextStartAt = state.nextStartAt && state.nextStartAt > now ? state.nextStartAt : nextEventStart(now);
  if (!state.nextStartAt) return;
  await sendOrEdit(channel, state, waitingPayload(state.nextStartAt));
  saveState(state);
}

async function startGame(client) {
  const now = Date.now();
  if (!rngEventActive(now)) return;
  const channel = await getTextChannel(client);
  if (!channel) return;
  const state = loadState();
  await deleteManagedMessage(channel, state);
  Object.assign(state, {
    phase: 'voting',
    round: 1,
    votes: {},
    resultAt: now + VOTE_MS,
    decidingEndsAt: null,
    chosenColor: null,
    nextStartAt: null,
  });
  await sendOrEdit(channel, state, votingPayload(state));
  saveState(state);
  scheduleNext(client);
}

async function beginDeciding(client) {
  const channel = await getTextChannel(client);
  if (!channel) return;
  const state = loadState();
  if (state.phase !== 'voting') return scheduleNext(client);
  state.phase = 'deciding';
  state.decidingEndsAt = Date.now() + DECIDING_MS;
  await sendOrEdit(channel, state, decidingPayload(state));
  saveState(state);
  scheduleNext(client);
}

function pickRandomColor() {
  return Math.random() < 0.5 ? 'green' : 'red';
}

async function finishGame(client, state, { type, chosenColor = null }) {
  const channel = await getTextChannel(client);
  if (!channel) return;
  const nextStartAt = nextEventStart(Date.now() + 1_000);
  const lose = type === 'lose';
  const multiplier = lose ? 1.2 : prizeMultiplierForRound(state.round);
  const durationMs = lose ? LOSE_BOOST_MS : WIN_BOOST_MS;
  startBoost({ durationMs, percent: (multiplier - 1) * 100, startedById: 'global-rng-event' });
  const colorText = chosenColor === 'green' ? '🟢 green' : '🔴 red';
  const body = type === 'stop'
    ? '* Welp you have decided to take the prize! Congratulations!'
    : type === 'final'
      ? '* Congratulation on beating the game!'
      : `* ${colorText} was chosen! Sadly you picked the wrong color, better luck next time!`;
  const accent = type === 'final' ? COLORS.yellow : lose ? COLORS.red : COLORS.green;
  Object.assign(state, {
    phase: nextStartAt ? 'finished' : 'waiting',
    votes: {},
    resultAt: null,
    decidingEndsAt: null,
    chosenColor,
    nextStartAt,
  });
  if (nextStartAt) await sendOrEdit(channel, state, finalPayload({ accent, body, multiplier, durationMs, nextStartAt }));
  saveState(state);
  scheduleNext(client);
}

async function finishNoVotes(client, state) {
  const channel = await getTextChannel(client);
  if (!channel) return;
  const nextStartAt = nextEventStart(Date.now() + 1_000);
  Object.assign(state, {
    phase: nextStartAt ? 'finished' : 'waiting',
    votes: {},
    resultAt: null,
    decidingEndsAt: null,
    chosenColor: null,
    nextStartAt,
  });
  if (nextStartAt) await sendOrEdit(channel, state, noVotesPayload({ nextStartAt }));
  saveState(state);
  scheduleNext(client);
}

async function resolveRound(client) {
  const channel = await getTextChannel(client);
  if (!channel) return;
  const state = loadState();
  if (state.phase !== 'deciding') return scheduleNext(client);
  const counts = voteCounts(state.votes);
  const colorVotes = counts.green + counts.red;

  if (colorVotes <= 0 && counts.stop <= 0) {
    await finishNoVotes(client, state);
    return;
  }

  if (counts.stop > counts.green && counts.stop > counts.red) {
    await finishGame(client, state, { type: 'stop' });
    return;
  }

  const chosenColor = pickRandomColor();
  const otherColor = chosenColor === 'green' ? 'red' : 'green';
  const success = counts[chosenColor] >= counts[otherColor];
  if (!success) {
    await finishGame(client, state, { type: 'lose', chosenColor });
    return;
  }

  if (state.round >= FINAL_ROUND) {
    await finishGame(client, state, { type: 'final', chosenColor });
    return;
  }

  const colorText = chosenColor === 'green' ? '🟢 green' : '🔴 red';
  state.phase = 'voting';
  state.round += 1;
  state.votes = {};
  state.resultAt = Date.now() + VOTE_MS;
  state.decidingEndsAt = null;
  state.chosenColor = chosenColor;
  await sendOrEdit(channel, state, votingPayload(state, `* ${colorText} was chosen! The voters picked the correct color! Would you risk again for twice the luck boost? If yes vote for a color, if wanted to stop press STOP.`));
  saveState(state);
  scheduleNext(client);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('global-rng-event')
    .setDescription('Refresh the scheduled global RNG event message.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async init(client) {
    schedulerClient = client;
    const state = loadState();
    const now = Date.now();
    if ((state.phase === 'voting' && state.resultAt <= now) || (state.phase === 'deciding' && state.decidingEndsAt <= now)) {
      if (state.phase === 'voting') await beginDeciding(client);
      else await resolveRound(client);
      return;
    }
    if ((state.phase === 'waiting' || state.phase === 'finished') && (!state.nextStartAt || state.nextStartAt <= now)) {
      state.nextStartAt = nextEventStart(now);
      saveState(state);
      if (state.nextStartAt && state.nextStartAt <= now) await startGame(client);
      else await ensureWaitingMessage(client);
    }
    scheduleNext(client);
  },

  async execute(interaction) {
    await ensureWaitingMessage(interaction.client);
    await interaction.reply({ content: 'Global RNG event scheduler refreshed.', flags: EPHEMERAL_FLAG });
  },

  async handleInteraction(interaction) {
    if (!interaction.isButton?.() || !interaction.customId?.startsWith(`${PREFIX}:vote:`)) return false;
    const action = interaction.customId.split(':')[2];
    if (!['green', 'red', 'stop'].includes(action)) return true;
    const state = loadState();
    if (state.phase !== 'voting' || interaction.message?.id !== state.messageId) {
      await interaction.reply({ content: 'Voting is not open for this global event right now.', flags: EPHEMERAL_FLAG });
      return true;
    }
    await interaction.deferUpdate();
    state.votes = state.votes && typeof state.votes === 'object' ? state.votes : {};
    state.votes[interaction.user.id] = action;
    saveState(state);
    const payload = votingPayload(state, state.chosenColor
      ? `* ${state.chosenColor === 'green' ? '🟢 green' : '🔴 red'} was chosen! The voters picked the correct color! Would you risk again for twice the luck boost? If yes vote for a color, if wanted to stop press STOP.`
      : '* Pick a color, only 1 color will win! Each color has a 50/50 chance no matter how many people voted for it.');
    await interaction.message?.edit(payload).catch(() => null);
    return true;
  },
};
