const levelingManager = require('./levelingManager');
const { loadState, saveState } = require('./giveawayStore');
const {
  BLACKLIST_ROLE_ID,
  EPHEMERAL_FLAG,
  GREEN_ACCENT,
  MAX_TIMEOUT_MS,
  now,
} = require('./giveawayUtils');
const {
  buildClaimRoundAllClaimedPayload,
  buildClaimRoundClosedPayload,
  buildClaimRoundPayload,
  buildFinalGiveawayPayload,
  buildLiveGiveawayPayload,
  buildNoMoreUsersPayload,
  buildSetupPayload,
  disableTopLevelButtons,
} = require('./giveawayMessages');

let schedulerClient = null;
const timerHandles = new Map();

function endTimerKey(giveawayId) {
  return `giveaway:end:${giveawayId}`;
}

function claimTimerKey(giveawayId, roundNumber) {
  return `giveaway:claim:${giveawayId}:${roundNumber}`;
}

function getState() {
  return loadState();
}

function persistState(state) {
  saveState(state);
}

function clearTimer(key) {
  const handle = timerHandles.get(key);
  if (handle) {
    clearTimeout(handle);
    timerHandles.delete(key);
  }
}

function scheduleAt(key, executeAt, callback) {
  clearTimer(key);
  const remainingMs = Math.max(0, executeAt - now());
  const delay = Math.min(remainingMs, MAX_TIMEOUT_MS);
  const handle = setTimeout(async () => {
    if (remainingMs > MAX_TIMEOUT_MS) {
      scheduleAt(key, executeAt, callback);
      return;
    }
    timerHandles.delete(key);
    await callback().catch(() => null);
  }, delay);
  if (typeof handle.unref === 'function') handle.unref();
  timerHandles.set(key, handle);
}

function getGiveaway(state, giveawayId) {
  return state.giveaways[giveawayId] ?? null;
}

function getDraft(state, draftId) {
  return state.drafts[draftId] ?? null;
}

function findDraftByMessageId(state, messageId) {
  return Object.values(state.drafts).find((draft) => draft.messageId === messageId) ?? null;
}

function findGiveawayByMessageId(state, messageId) {
  return Object.values(state.giveaways).find((giveaway) => {
    if (giveaway.messageId === messageId) return true;
    if (giveaway.setupMessageId === messageId) return true;
    return giveaway.rounds.some((round) => round.messageId === messageId);
  }) ?? null;
}

async function fetchChannel(guildId, channelId) {
  if (!schedulerClient) return null;
  const guild = schedulerClient.guilds.cache.get(guildId) || await schedulerClient.guilds.fetch(guildId).catch(() => null);
  if (!guild) return null;
  return guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
}

async function fetchMessageById(guildId, channelId, messageId) {
  const channel = await fetchChannel(guildId, channelId);
  if (!channel?.isTextBased?.()) return null;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function editMessageSafely(guildId, channelId, messageId, payload) {
  const message = await fetchMessageById(guildId, channelId, messageId);
  if (!message?.editable) return null;
  await message.edit(payload).catch(() => null);
  return message;
}

async function sendReplyToGiveaway(giveaway, payload) {
  const giveawayMessage = await fetchMessageById(giveaway.guildId, giveaway.channelId, giveaway.messageId);
  if (giveawayMessage) return giveawayMessage.reply(payload).catch(() => null);
  const channel = await fetchChannel(giveaway.guildId, giveaway.channelId);
  if (!channel?.isTextBased?.()) return null;
  return channel.send(payload).catch(() => null);
}

function pickRandomUsers(userIds, amount) {
  const pool = [...userIds];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
  }
  return pool.slice(0, amount);
}

function getEligibleRerollPool(giveaway) {
  const rolled = new Set(giveaway.rolledUserIds);
  return giveaway.entrantIds.filter((userId) => !rolled.has(userId));
}

function getCurrentRound(giveaway) {
  return giveaway.rounds.find((round) => round.status === 'active') ?? null;
}

function clearGiveawayTimers(giveaway) {
  clearTimer(endTimerKey(giveaway.id));
  for (const round of giveaway.rounds) clearTimer(claimTimerKey(giveaway.id, round.roundNumber));
}

async function disableSetupMessage(draft) {
  await editMessageSafely(draft.guildId, draft.channelId, draft.messageId, disableTopLevelButtons(buildSetupPayload(draft, true)));
}

async function deleteSetupMessage(draft) {
  const message = await fetchMessageById(draft.guildId, draft.channelId, draft.messageId);
  await message?.delete().catch(() => null);
}

function createLiveGiveawayFromDraft(draft) {
  return {
    id: draft.id,
    guildId: draft.guildId,
    channelId: draft.channelId,
    setupMessageId: draft.messageId,
    messageId: '',
    ownerId: draft.ownerId,
    hostId: draft.hostId,
    prize: draft.prize,
    description: draft.description,
    claimDurationMs: draft.claimDurationMs,
    claimDurationLabel: draft.claimDurationLabel,
    winnerCount: draft.winnerCount,
    durationMs: draft.durationMs,
    durationLabel: draft.durationLabel,
    requirement: draft.requirement,
    entrantIds: [],
    rolledUserIds: [],
    claimedUserIds: [],
    rounds: [],
    messageCounts: {},
    status: 'live',
    startsAt: now(),
    endsAt: now() + draft.durationMs,
    endedAt: null,
    finishedAt: null,
    updatedAt: now(),
  };
}

async function updateDraftPreview(draft) {
  if (!draft.messageId) return;
  await editMessageSafely(draft.guildId, draft.channelId, draft.messageId, buildSetupPayload(draft));
}

async function updateGiveawayMessage(giveaway, payload) {
  await editMessageSafely(giveaway.guildId, giveaway.channelId, giveaway.messageId, payload);
}

async function finalizeGiveaway(giveawayId) {
  const state = getState();
  const giveaway = getGiveaway(state, giveawayId);
  if (!giveaway) return;
  giveaway.status = 'completed';
  giveaway.finishedAt = now();
  clearGiveawayTimers(giveaway);
  persistState(state);
  await updateGiveawayMessage(giveaway, buildFinalGiveawayPayload(giveaway));
  delete state.giveaways[giveawayId];
  persistState(state);
}

async function sendNoMoreUsersMessageAndFinalize(giveaway) {
  const round = getCurrentRound(giveaway) || giveaway.rounds[giveaway.rounds.length - 1] || null;
  if (round?.messageId) {
    await editMessageSafely(giveaway.guildId, giveaway.channelId, round.messageId, buildNoMoreUsersPayload(giveaway));
  } else {
    const message = await sendReplyToGiveaway(giveaway, buildNoMoreUsersPayload(giveaway));
    if (message && round) round.messageId = message.id;
  }
  await finalizeGiveaway(giveaway.id);
}

async function createClaimRound(giveaway, winnerIds) {
  const round = {
    roundNumber: giveaway.rounds.length,
    winnerIds,
    claimedIds: [],
    messageId: '',
    startedAt: now(),
    expiresAt: now() + giveaway.claimDurationMs,
    status: 'active',
  };
  giveaway.rounds.push(round);
  giveaway.rolledUserIds.push(...winnerIds);
  giveaway.updatedAt = now();
  const message = await sendReplyToGiveaway(giveaway, buildClaimRoundPayload(giveaway, round));
  if (message) round.messageId = message.id;
  scheduleRoundExpiry(giveaway, round);
  return round;
}

async function maybeFinalizeAfterClaim(giveaway) {
  if (giveaway.claimedUserIds.length >= giveaway.winnerCount) {
    const round = getCurrentRound(giveaway);
    if (round?.messageId) {
      await editMessageSafely(giveaway.guildId, giveaway.channelId, round.messageId, buildClaimRoundAllClaimedPayload(giveaway, round));
      round.status = 'completed';
    }
    await finalizeGiveaway(giveaway.id);
    return true;
  }

  const round = getCurrentRound(giveaway);
  if (!round) return false;
  if ((round.winnerIds.length - round.claimedIds.length) <= 0 && getEligibleRerollPool(giveaway).length === 0) {
    round.status = 'completed';
    await editMessageSafely(giveaway.guildId, giveaway.channelId, round.messageId, buildNoMoreUsersPayload(giveaway));
    await finalizeGiveaway(giveaway.id);
    return true;
  }
  return false;
}

async function startNextReroll(giveawayId, sourceRoundNumber) {
  const state = getState();
  const giveaway = getGiveaway(state, giveawayId);
  if (!giveaway || giveaway.status !== 'claiming') return;
  const round = giveaway.rounds.find((item) => item.roundNumber === sourceRoundNumber);
  if (!round || round.status !== 'active') return;

  const remainingSlots = round.winnerIds.length - round.claimedIds.length;
  round.status = 'rerolled';
  giveaway.updatedAt = now();
  persistState(state);

  await editMessageSafely(giveaway.guildId, giveaway.channelId, round.messageId, buildClaimRoundClosedPayload(giveaway, round, remainingSlots));

  const rerollPool = getEligibleRerollPool(giveaway);
  if (rerollPool.length === 0) {
    await sendNoMoreUsersMessageAndFinalize(giveaway);
    return;
  }

  const refreshedState = getState();
  const refreshedGiveaway = getGiveaway(refreshedState, giveawayId);
  if (!refreshedGiveaway) return;
  await createClaimRound(refreshedGiveaway, pickRandomUsers(rerollPool, Math.min(remainingSlots, rerollPool.length)));
  persistState(refreshedState);
}

async function handleClaimWindowExpiry(giveawayId, roundNumber) {
  const state = getState();
  const giveaway = getGiveaway(state, giveawayId);
  if (!giveaway || giveaway.status !== 'claiming') return;
  const round = giveaway.rounds.find((item) => item.roundNumber === roundNumber);
  if (!round || round.status !== 'active') return;

  if (round.claimedIds.length >= round.winnerIds.length) {
    round.status = 'completed';
    persistState(state);
    await editMessageSafely(giveaway.guildId, giveaway.channelId, round.messageId, buildClaimRoundAllClaimedPayload(giveaway, round));
    if (giveaway.claimedUserIds.length >= giveaway.winnerCount) await finalizeGiveaway(giveaway.id);
    else if (getEligibleRerollPool(giveaway).length === 0) await sendNoMoreUsersMessageAndFinalize(giveaway);
    return;
  }

  persistState(state);
  await startNextReroll(giveawayId, roundNumber);
}

async function forceRerollGiveaway(giveawayId) {
  const giveaway = getGiveaway(getState(), giveawayId);
  if (!giveaway || giveaway.status !== 'claiming') return { ok: false, reason: 'not_claiming' };

  const round = getCurrentRound(giveaway);
  if (!round) return { ok: false, reason: 'no_active_round' };

  if (round.winnerIds.length <= round.claimedIds.length) {
    await handleClaimWindowExpiry(giveawayId, round.roundNumber);
    return { ok: true };
  }

  await startNextReroll(giveawayId, round.roundNumber);
  return { ok: true };
}

function scheduleRoundExpiry(giveaway, round) {
  scheduleAt(claimTimerKey(giveaway.id, round.roundNumber), round.expiresAt, async () => handleClaimWindowExpiry(giveaway.id, round.roundNumber));
}

function scheduleGiveawayEnd(giveaway) {
  scheduleAt(endTimerKey(giveaway.id), giveaway.endsAt, async () => endGiveaway(giveaway.id));
}

async function endGiveaway(giveawayId) {
  const state = getState();
  const giveaway = getGiveaway(state, giveawayId);
  if (!giveaway || giveaway.status !== 'live') return;

  giveaway.status = 'claiming';
  giveaway.endedAt = now();
  giveaway.updatedAt = now();
  persistState(state);
  clearTimer(endTimerKey(giveaway.id));

  await updateGiveawayMessage(giveaway, buildLiveGiveawayPayload(giveaway, {
    accent: GREEN_ACCENT,
    headerLine: '-# **The winners have been drawn.**',
    buttonStyle: 4,
    buttonDisabled: true,
  }));

  const winners = pickRandomUsers(giveaway.entrantIds, Math.min(giveaway.winnerCount, giveaway.entrantIds.length));
  if (winners.length === 0) {
    await sendNoMoreUsersMessageAndFinalize(giveaway);
    return;
  }

  const refreshedState = getState();
  const refreshedGiveaway = getGiveaway(refreshedState, giveawayId);
  if (!refreshedGiveaway) return;
  await createClaimRound(refreshedGiveaway, winners);
  persistState(refreshedState);
}

async function hydrateGiveaways() {
  const state = getState();
  for (const giveaway of Object.values(state.giveaways)) {
    clearGiveawayTimers(giveaway);

    if (giveaway.status === 'live') {
      if (giveaway.endsAt <= now()) await endGiveaway(giveaway.id);
      else scheduleGiveawayEnd(giveaway);
      continue;
    }

    if (giveaway.status === 'claiming') {
      const activeRound = getCurrentRound(giveaway);
      if (!activeRound) {
        if (giveaway.claimedUserIds.length >= giveaway.winnerCount || getEligibleRerollPool(giveaway).length === 0) {
          await finalizeGiveaway(giveaway.id);
        }
        continue;
      }

      if (activeRound.expiresAt <= now()) await handleClaimWindowExpiry(giveaway.id, activeRound.roundNumber);
      else scheduleRoundExpiry(giveaway, activeRound);
    }
  }
}

async function init(client) {
  schedulerClient = client;
  await hydrateGiveaways();
}

async function fetchMemberFromInteraction(interaction) {
  if (interaction.member?.roles?.cache) return interaction.member;
  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

function isBlacklistedMember(member) {
  return Boolean(member?.roles?.cache?.has(BLACKLIST_ROLE_ID));
}

module.exports = {
  EPHEMERAL_FLAG,
  buildSetupPayload,
  clearGiveawayTimers,
  createClaimRound,
  createLiveGiveawayFromDraft,
  deleteSetupMessage,
  disableSetupMessage,
  editMessageSafely,
  fetchMemberFromInteraction,
  fetchMessageById,
  findDraftByMessageId,
  findGiveawayByMessageId,
  forceRerollGiveaway,
  getCurrentRound,
  getDraft,
  getGiveaway,
  getEligibleRerollPool,
  getState,
  init,
  isBlacklistedMember,
  maybeFinalizeAfterClaim,
  persistState,
  schedulerClient: () => schedulerClient,
  scheduleGiveawayEnd,
  sendNoMoreUsersMessageAndFinalize,
  updateDraftPreview,
  updateGiveawayMessage,
};
