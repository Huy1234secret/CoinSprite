const runtime = require('./giveawayRuntime');
const {
  buildClaimRoundClosedPayload,
  buildLiveGiveawayPayload,
} = require('./giveawayMessages');
const {
  EPHEMERAL_FLAG,
  GREEN_ACCENT,
  extractMessageId,
  now,
} = require('./giveawayUtils');

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values) {
  return [...new Set(asArray(values).filter(Boolean))];
}

function normalizeGiveaway(giveaway) {
  giveaway.entrantIds = unique(giveaway.entrantIds);
  giveaway.rolledUserIds = unique(giveaway.rolledUserIds);
  giveaway.claimedUserIds = unique(giveaway.claimedUserIds);
  giveaway.rounds = asArray(giveaway.rounds).map((round, index) => ({
    ...round,
    roundNumber: Number.isFinite(Number(round.roundNumber)) ? Number(round.roundNumber) : index,
    winnerIds: unique(round.winnerIds),
    claimedIds: unique(round.claimedIds),
  }));
  return giveaway;
}

function cloneGiveaway(giveaway) {
  return normalizeGiveaway(JSON.parse(JSON.stringify(giveaway)));
}

function pickRandomUsers(userIds, amount) {
  const pool = [...userIds];
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [pool[index], pool[randomIndex]] = [pool[randomIndex], pool[index]];
  }
  return pool.slice(0, amount);
}

function getActiveRound(giveaway) {
  return giveaway.rounds.find((round) => round.status === 'active') || null;
}

function getPreviouslyRolledIds(giveaway) {
  const ids = [...asArray(giveaway.rolledUserIds)];
  for (const round of giveaway.rounds) ids.push(...asArray(round.winnerIds));
  return new Set(ids.filter(Boolean));
}

function getRerollPool(giveaway, extraExcludedUserIds = []) {
  const excluded = getPreviouslyRolledIds(giveaway);
  for (const userId of giveaway.claimedUserIds) excluded.add(userId);
  for (const userId of extraExcludedUserIds) excluded.add(userId);
  return giveaway.entrantIds.filter((userId) => !excluded.has(userId));
}

function removeClaimedUser(giveaway, userId) {
  if (!userId) return [];
  giveaway.claimedUserIds = giveaway.claimedUserIds.filter((claimedId) => claimedId !== userId);
  const affectedRounds = [];
  for (const round of giveaway.rounds) {
    const before = round.claimedIds.length;
    round.claimedIds = round.claimedIds.filter((claimedId) => claimedId !== userId);
    if (round.claimedIds.length !== before) affectedRounds.push(round);
  }
  return affectedRounds;
}

function buildRerollPlan(giveaway) {
  const activeRound = getActiveRound(giveaway);
  if (activeRound) {
    const unclaimedSlots = Math.max(0, activeRound.winnerIds.length - activeRound.claimedIds.length);
    if (unclaimedSlots > 0) {
      return { slots: unclaimedSlots, closeRounds: [activeRound], replacedUserIds: [] };
    }

    const replacedUserId = activeRound.claimedIds[activeRound.claimedIds.length - 1]
      || giveaway.claimedUserIds[giveaway.claimedUserIds.length - 1]
      || null;
    if (!replacedUserId) return { reason: 'no_active_round' };
    const affectedRounds = removeClaimedUser(giveaway, replacedUserId);
    return {
      slots: 1,
      closeRounds: affectedRounds.length ? affectedRounds : [activeRound],
      replacedUserIds: [replacedUserId],
    };
  }

  const openSlots = Math.max(0, Number(giveaway.winnerCount || 0) - giveaway.claimedUserIds.length);
  if (openSlots > 0) return { slots: openSlots, closeRounds: [], replacedUserIds: [] };

  const replacedUserId = giveaway.claimedUserIds[giveaway.claimedUserIds.length - 1] || null;
  if (!replacedUserId) return { reason: 'no_active_round' };
  const affectedRounds = removeClaimedUser(giveaway, replacedUserId);
  return { slots: 1, closeRounds: affectedRounds, replacedUserIds: [replacedUserId] };
}

async function closeClaimRounds(giveaway, rounds) {
  const seen = new Set();
  for (const round of rounds) {
    if (!round || !round.messageId || seen.has(round.roundNumber)) continue;
    seen.add(round.roundNumber);
    round.status = 'rerolled';
    round.expiresAt = null;
    const unclaimedSlots = Math.max(0, round.winnerIds.length - round.claimedIds.length);
    await runtime.editMessageSafely(
      giveaway.guildId,
      giveaway.channelId,
      round.messageId,
      buildClaimRoundClosedPayload(giveaway, round, unclaimedSlots),
    );
  }
}

function buildDrawnGiveawayPayload(giveaway) {
  return buildLiveGiveawayPayload(giveaway, {
    accent: GREEN_ACCENT,
    headerLine: '-# **The winners have been drawn.**',
    buttonStyle: 4,
    buttonDisabled: true,
  });
}

async function respond(interaction, content) {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content }).catch(() => null);
    return;
  }
  await interaction.reply({ content, flags: EPHEMERAL_FLAG }).catch(() => null);
}

async function execute(interaction, giveawayMessageId) {
  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ flags: EPHEMERAL_FLAG }).catch(() => null);
  }

  const normalizedId = extractMessageId(giveawayMessageId);
  if (!normalizedId) {
    await respond(interaction, 'Giveaway message id is invalid.');
    return;
  }

  const state = runtime.getState();
  const storedGiveaway = runtime.findGiveawayByMessageId(state, normalizedId);
  if (!storedGiveaway) {
    await respond(interaction, 'No giveaway was found for that message id.');
    return;
  }

  if (storedGiveaway.status === 'live') {
    await respond(interaction, 'This giveaway has not ended yet. Wait until the bot starts rolling winners before rerolling.');
    return;
  }
  if (!['claiming', 'completed'].includes(storedGiveaway.status)) {
    await respond(interaction, 'This giveaway has not started rolling winners yet.');
    return;
  }

  const giveaway = cloneGiveaway(storedGiveaway);
  const plan = buildRerollPlan(giveaway);
  if (plan.reason) {
    await respond(interaction, 'This giveaway has no claimed or unclaimed winner slot to reroll.');
    return;
  }

  const rerollPool = getRerollPool(giveaway, plan.replacedUserIds);
  if (rerollPool.length === 0) {
    await respond(interaction, 'There are no eligible entrants left to reroll.');
    return;
  }

  const winnerIds = pickRandomUsers(rerollPool, Math.min(plan.slots, rerollPool.length));
  if (winnerIds.length === 0) {
    await respond(interaction, 'There are no eligible entrants left to reroll.');
    return;
  }

  runtime.clearGiveawayTimers(storedGiveaway);
  giveaway.status = 'claiming';
  giveaway.finishedAt = null;
  giveaway.updatedAt = now();
  state.giveaways[giveaway.id] = giveaway;

  await closeClaimRounds(giveaway, plan.closeRounds);
  await runtime.updateGiveawayMessage(giveaway, buildDrawnGiveawayPayload(giveaway));
  const round = await runtime.createClaimRound(giveaway, winnerIds);
  state.giveaways[giveaway.id] = giveaway;
  runtime.persistState(state);

  const replaced = plan.replacedUserIds.length ? ` Replaced: ${plan.replacedUserIds.map((userId) => `<@${userId}>`).join(', ')}.` : '';
  const winners = winnerIds.map((userId) => `<@${userId}>`).join(', ');
  const roundText = round?.messageId ? ` New claim round: https://discord.com/channels/${giveaway.guildId}/${giveaway.channelId}/${round.messageId}` : '';
  await respond(interaction, `Giveaway rerolled. New winner${winnerIds.length === 1 ? '' : 's'}: ${winners}.${replaced}${roundText}`);
}

module.exports = { execute };
