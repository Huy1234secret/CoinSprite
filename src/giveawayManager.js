const levelingManager = require('./levelingManager');
const { loadState, saveState } = require('./giveawayStore');
const {
  CUSTOM_IDS,
  EPHEMERAL_FLAG,
  FIELD_IDS,
  MAX_CLAIM_MS,
  MAX_DURATION_MS,
  MIN_CLAIM_MS,
  MIN_DURATION_MS,
  createDraft,
  getLevelRequirementFromInput,
  getMessageRequirementFromInput,
  getSubmittedValues,
  getWinnerAmountFromInput,
  isSetupComplete,
  normalizeWhitespace,
  now,
  parseDurationInput,
  formatDurationCompact,
} = require('./giveawayUtils');
const {
  buildHosterDmPayload,
  buildLiveGiveawayPayload,
  buildRequirementButtonsPayload,
  buildRequirementModal,
  buildSetupModal,
  buildSetupPayload,
  buildStartDurationModal,
  disableTopLevelButtons,
} = require('./giveawayMessages');
const runtime = require('./giveawayRuntime');

function requireSetupOwner(interaction, ownerId) {
  if (interaction.user.id === ownerId) return true;
  interaction.reply({
    content: 'Only the user who opened this giveaway setup can use these controls.',
    flags: EPHEMERAL_FLAG,
  }).catch(() => null);
  return false;
}

async function init(client) {
  await runtime.init(client);
}

async function handleStartCommand(interaction) {
  const draftId = interaction.id;
  const state = runtime.getState();
  const draft = createDraft(draftId, interaction);
  state.drafts[draftId] = draft;
  runtime.persistState(state);

  await interaction.reply(buildSetupPayload(draft));
  const reply = await interaction.fetchReply().catch(() => null);
  if (!reply) return;

  draft.messageId = reply.id;
  draft.updatedAt = now();
  state.drafts[draftId] = draft;
  runtime.persistState(state);
}

async function startGiveawayFromDraft(interaction, draft, state, draftId) {
  const giveaway = runtime.createLiveGiveawayFromDraft(draft);
  const liveMessage = await interaction.channel.send(buildLiveGiveawayPayload(giveaway)).catch(() => null);
  if (!liveMessage) {
    await interaction.reply({ content: 'I could not send the giveaway message.', flags: EPHEMERAL_FLAG });
    return true;
  }

  giveaway.messageId = liveMessage.id;
  state.giveaways[giveaway.id] = giveaway;
  delete state.drafts[draftId];
  runtime.persistState(state);

  await runtime.deleteSetupMessage(draft);
  runtime.scheduleGiveawayEnd(giveaway);
  await interaction.reply({ content: `Giveaway started: ${liveMessage.url}`, flags: EPHEMERAL_FLAG });
  return true;
}

async function handleDeleteCommand(interaction, messageId) {
  const normalizedId = normalizeWhitespace(messageId);
  if (!/^\d{17,20}$/.test(normalizedId)) {
    await interaction.reply({ content: 'Giveaway message id is invalid.', flags: EPHEMERAL_FLAG });
    return;
  }

  const state = runtime.getState();
  const draft = runtime.findDraftByMessageId(state, normalizedId);
  if (draft) {
    await runtime.editMessageSafely(draft.guildId, draft.channelId, draft.messageId, disableTopLevelButtons(buildSetupPayload(draft, true)));
    const previewMessage = await runtime.fetchMessageById(draft.guildId, draft.channelId, draft.messageId);
    await previewMessage?.delete().catch(() => null);
    delete state.drafts[draft.id];
    runtime.persistState(state);
    await interaction.reply({ content: 'Giveaway setup deleted.', flags: EPHEMERAL_FLAG });
    return;
  }

  const giveaway = runtime.findGiveawayByMessageId(state, normalizedId);
  if (!giveaway) {
    await interaction.reply({ content: 'No giveaway was found for that message id.', flags: EPHEMERAL_FLAG });
    return;
  }

  runtime.clearGiveawayTimers(giveaway);
  const giveawayMessage = await runtime.fetchMessageById(giveaway.guildId, giveaway.channelId, giveaway.messageId);
  await giveawayMessage?.delete().catch(() => null);

  if (giveaway.setupMessageId) {
    const setupMessage = await runtime.fetchMessageById(giveaway.guildId, giveaway.channelId, giveaway.setupMessageId);
    await setupMessage?.delete().catch(() => null);
  }

  for (const round of giveaway.rounds) {
    if (!round.messageId) continue;
    const roundMessage = await runtime.fetchMessageById(giveaway.guildId, giveaway.channelId, round.messageId);
    await roundMessage?.delete().catch(() => null);
  }

  delete state.giveaways[giveaway.id];
  runtime.persistState(state);
  await interaction.reply({ content: 'Giveaway deleted.', flags: EPHEMERAL_FLAG });
}

async function handleSetupMessageButton(interaction, draftId) {
  const draft = runtime.getDraft(runtime.getState(), draftId);
  if (!draft) {
    await interaction.reply({ content: 'This giveaway setup no longer exists.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!requireSetupOwner(interaction, draft.ownerId)) return true;
  await interaction.showModal(buildSetupModal(draft));
  return true;
}

async function handleSetupRequirementButton(interaction, draftId) {
  const draft = runtime.getDraft(runtime.getState(), draftId);
  if (!draft) {
    await interaction.reply({ content: 'This giveaway setup no longer exists.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!requireSetupOwner(interaction, draft.ownerId)) return true;
  await interaction.reply(buildRequirementButtonsPayload(draftId));
  return true;
}

async function handleRequirementTypeButton(interaction, type, draftId) {
  const draft = runtime.getDraft(runtime.getState(), draftId);
  if (!draft) {
    await interaction.reply({ content: 'This giveaway setup no longer exists.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!requireSetupOwner(interaction, draft.ownerId)) return true;
  await interaction.showModal(buildRequirementModal(type, draft));
  return true;
}

async function handleSetupStartButton(interaction, draftId) {
  const state = runtime.getState();
  const draft = runtime.getDraft(state, draftId);
  if (!draft) {
    await interaction.reply({ content: 'This giveaway setup no longer exists.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!requireSetupOwner(interaction, draft.ownerId)) return true;
  if (!isSetupComplete(draft)) {
    await interaction.reply({ content: 'Finish the giveaway form before starting it.', flags: EPHEMERAL_FLAG });
    return true;
  }

  await interaction.showModal(buildStartDurationModal(draft));
  return true;
}

async function handleStartDurationModalSubmit(interaction, draftId) {
  const state = runtime.getState();
  const draft = runtime.getDraft(state, draftId);
  if (!draft) {
    await interaction.reply({ content: 'This giveaway setup no longer exists.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!requireSetupOwner(interaction, draft.ownerId)) return true;
  if (!isSetupComplete(draft)) {
    await interaction.reply({ content: 'Finish the giveaway form before starting it.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const durationInput = normalizeWhitespace(interaction.fields.getTextInputValue(FIELD_IDS.duration));
  const durationMs = parseDurationInput(durationInput);
  if (!durationMs || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    await interaction.reply({ content: 'Giveaway duration is invalid. Use a value like 30m, 6h, or 1d.', flags: EPHEMERAL_FLAG });
    return true;
  }

  draft.durationMs = durationMs;
  draft.durationLabel = formatDurationCompact(durationMs);
  draft.updatedAt = now();
  state.drafts[draftId] = draft;

  return startGiveawayFromDraft(interaction, draft, state, draftId);
}

async function handleSetupModalSubmit(interaction, draftId) {
  const state = runtime.getState();
  const draft = runtime.getDraft(state, draftId);
  if (!draft) {
    await interaction.reply({ content: 'This giveaway setup no longer exists.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!requireSetupOwner(interaction, draft.ownerId)) return true;

  const prize = normalizeWhitespace(interaction.fields.getTextInputValue(FIELD_IDS.prize));
  const description = normalizeWhitespace(interaction.fields.getTextInputValue(FIELD_IDS.description));
  const claimInput = normalizeWhitespace(interaction.fields.getTextInputValue(FIELD_IDS.claimTime));
  const winnerInput = normalizeWhitespace(interaction.fields.getTextInputValue(FIELD_IDS.winnerAmount));
  const hostId = getSubmittedValues(interaction, FIELD_IDS.hoster)[0] || '';

  const claimDurationMs = parseDurationInput(claimInput);
  if (!claimDurationMs || claimDurationMs < MIN_CLAIM_MS || claimDurationMs > MAX_CLAIM_MS) {
    await interaction.reply({ content: 'Claim time must be between 5m and 24h.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const winnerCount = getWinnerAmountFromInput(winnerInput);
  if (!winnerCount) {
    await interaction.reply({ content: 'Winner amount must be between 1 and 10.', flags: EPHEMERAL_FLAG });
    return true;
  }

  if (!prize || !hostId) {
    await interaction.reply({ content: 'Prize and hoster are required.', flags: EPHEMERAL_FLAG });
    return true;
  }

  draft.prize = prize;
  draft.description = description;
  draft.claimDurationMs = claimDurationMs;
  draft.claimDurationLabel = formatDurationCompact(claimDurationMs);
  draft.winnerCount = winnerCount;
  draft.hostId = hostId;
  draft.updatedAt = now();
  state.drafts[draftId] = draft;
  runtime.persistState(state);

  await runtime.updateDraftPreview(draft);
  await interaction.reply({ content: 'Giveaway message updated.', flags: EPHEMERAL_FLAG });
  return true;
}

async function handleRequirementModalSubmit(interaction, type, draftId) {
  const state = runtime.getState();
  const draft = runtime.getDraft(state, draftId);
  if (!draft) {
    await interaction.reply({ content: 'This giveaway setup no longer exists.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!requireSetupOwner(interaction, draft.ownerId)) return true;

  if (type === 'level') {
    const level = getLevelRequirementFromInput(interaction.fields.getTextInputValue(FIELD_IDS.requirementLevel));
    if (!level) {
      await interaction.reply({ content: 'Level requirement must be at least 1.', flags: EPHEMERAL_FLAG });
      return true;
    }
    draft.requirement = { type: 'level', level };
  } else if (type === 'message') {
    const messageCount = getMessageRequirementFromInput(interaction.fields.getTextInputValue(FIELD_IDS.requirementMessage));
    if (!messageCount) {
      await interaction.reply({ content: 'Message requirement must be at least 1.', flags: EPHEMERAL_FLAG });
      return true;
    }
    draft.requirement = { type: 'message', messageCount };
  } else {
    const value = normalizeWhitespace(interaction.fields.getTextInputValue(FIELD_IDS.requirementOther));
    if (!value) {
      await interaction.reply({ content: 'Requirement text cannot be empty.', flags: EPHEMERAL_FLAG });
      return true;
    }
    draft.requirement = { type: 'other', text: value };
  }

  draft.updatedAt = now();
  state.drafts[draftId] = draft;
  runtime.persistState(state);

  await runtime.updateDraftPreview(draft);
  await interaction.reply({ content: 'Requirement updated.', flags: EPHEMERAL_FLAG });
  return true;
}

async function handleJoinButton(interaction, giveawayId) {
  const state = runtime.getState();
  const giveaway = runtime.getGiveaway(state, giveawayId);
  if (!giveaway) {
    await interaction.reply({ content: 'This giveaway is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (giveaway.status !== 'live') {
    await interaction.reply({ content: 'This giveaway has already ended.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const member = await runtime.fetchMemberFromInteraction(interaction);
  if (!member) {
    await interaction.reply({ content: 'I could not verify your member data.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (runtime.isBlacklistedMember(member)) {
    await interaction.reply({ content: 'You are blacklisted from joining giveaways.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (giveaway.entrantIds.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You have already joined this giveaway.', flags: EPHEMERAL_FLAG });
    return true;
  }

  if (giveaway.requirement.type === 'level') {
    const progress = levelingManager.getUserProgress(giveaway.guildId, interaction.user.id);
    if ((progress.level || 0) < giveaway.requirement.level) {
      await interaction.reply({ content: `You need chat level ${giveaway.requirement.level} or higher to join this giveaway.`, flags: EPHEMERAL_FLAG });
      return true;
    }
  }

  if (giveaway.requirement.type === 'message') {
    const currentCount = Number(giveaway.messageCounts[interaction.user.id] || 0);
    if (currentCount < giveaway.requirement.messageCount) {
      await interaction.reply({ content: `You need ${giveaway.requirement.messageCount} messages after giveaway start to join. Current count: ${currentCount}.`, flags: EPHEMERAL_FLAG });
      return true;
    }
  }

  giveaway.entrantIds.push(interaction.user.id);
  giveaway.updatedAt = now();
  state.giveaways[giveawayId] = giveaway;
  runtime.persistState(state);

  await runtime.updateGiveawayMessage(giveaway, buildLiveGiveawayPayload(giveaway));
  await interaction.reply({ content: 'You joined the giveaway.', flags: EPHEMERAL_FLAG });
  return true;
}

async function handleClaimButton(interaction, giveawayId, roundNumberText) {
  const giveaway = runtime.getGiveaway(runtime.getState(), giveawayId);
  if (!giveaway || giveaway.status !== 'claiming') {
    await interaction.reply({ content: 'This giveaway claim is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (giveaway.claimedUserIds.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You already claimed this giveaway.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const roundNumber = Number.parseInt(roundNumberText, 10);
  const round = giveaway.rounds.find((item) => item.roundNumber === roundNumber);
  if (!round || round.status !== 'active') {
    await interaction.reply({ content: 'This claim round is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (!round.winnerIds.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You are not a winner for this claim round.', flags: EPHEMERAL_FLAG });
    return true;
  }
  if (round.claimedIds.includes(interaction.user.id)) {
    await interaction.reply({ content: 'You already claimed in this round.', flags: EPHEMERAL_FLAG });
    return true;
  }

  const state = runtime.getState();
  const storedGiveaway = runtime.getGiveaway(state, giveawayId);
  const storedRound = storedGiveaway?.rounds.find((item) => item.roundNumber === roundNumber);
  if (!storedGiveaway || !storedRound || storedRound.status !== 'active') {
    await interaction.reply({ content: 'This claim round is no longer active.', flags: EPHEMERAL_FLAG });
    return true;
  }

  storedRound.claimedIds.push(interaction.user.id);
  storedGiveaway.claimedUserIds.push(interaction.user.id);
  storedGiveaway.updatedAt = now();
  runtime.persistState(state);

  const { buildClaimRoundPayload } = require('./giveawayMessages');
  await runtime.editMessageSafely(storedGiveaway.guildId, storedGiveaway.channelId, storedRound.messageId, buildClaimRoundPayload(storedGiveaway, storedRound));
  await interaction.reply({ content: 'Claim recorded.', flags: EPHEMERAL_FLAG });

  const hostUser = await runtime.schedulerClient()?.users.fetch(storedGiveaway.hostId).catch(() => null);
  await hostUser?.send(buildHosterDmPayload(storedGiveaway, interaction.user.id)).catch(() => null);
  await runtime.maybeFinalizeAfterClaim(storedGiveaway);
  return true;
}

async function handleMessageCreate(message) {
  if (!message.guild || message.author.bot) return;
  const state = runtime.getState();
  let changed = false;
  for (const giveaway of Object.values(state.giveaways)) {
    if (giveaway.guildId !== message.guild.id || giveaway.status !== 'live' || giveaway.requirement.type !== 'message') continue;
    giveaway.messageCounts[message.author.id] = Number(giveaway.messageCounts[message.author.id] || 0) + 1;
    giveaway.updatedAt = now();
    changed = true;
  }
  if (changed) saveState(state);
}

async function handleMessageDelete(message) {
  const messageId = message?.id;
  if (!messageId) return;
  const state = loadState();
  const draft = runtime.findDraftByMessageId(state, messageId);
  if (draft) {
    delete state.drafts[draft.id];
    saveState(state);
    return;
  }
  const giveaway = runtime.findGiveawayByMessageId(state, messageId);
  if (!giveaway) return;
  if (giveaway.messageId === messageId) {
    runtime.clearGiveawayTimers(giveaway);
    delete state.giveaways[giveaway.id];
    saveState(state);
  }
}

async function handleInteraction(interaction) {
  const customId = interaction.customId || '';
  if (interaction.isButton()) {
    if (customId.startsWith(CUSTOM_IDS.editMessagePrefix)) return handleSetupMessageButton(interaction, customId.slice(CUSTOM_IDS.editMessagePrefix.length));
    if (customId.startsWith(CUSTOM_IDS.editRequirementPrefix)) return handleSetupRequirementButton(interaction, customId.slice(CUSTOM_IDS.editRequirementPrefix.length));
    if (customId.startsWith(CUSTOM_IDS.startPrefix)) return handleSetupStartButton(interaction, customId.slice(CUSTOM_IDS.startPrefix.length));
    if (customId.startsWith(CUSTOM_IDS.requirementTypePrefix)) {
      const [type, draftId] = customId.slice(CUSTOM_IDS.requirementTypePrefix.length).split(':');
      return handleRequirementTypeButton(interaction, type, draftId);
    }
    if (customId.startsWith(CUSTOM_IDS.joinPrefix)) return handleJoinButton(interaction, customId.slice(CUSTOM_IDS.joinPrefix.length));
    if (customId.startsWith(CUSTOM_IDS.claimPrefix)) {
      const [giveawayId, roundNumber] = customId.slice(CUSTOM_IDS.claimPrefix.length).split(':');
      return handleClaimButton(interaction, giveawayId, roundNumber);
    }
  }

  if (interaction.isModalSubmit()) {
    if (customId.startsWith(CUSTOM_IDS.setupModalPrefix)) return handleSetupModalSubmit(interaction, customId.slice(CUSTOM_IDS.setupModalPrefix.length));
    if (customId.startsWith(CUSTOM_IDS.startDurationModalPrefix)) return handleStartDurationModalSubmit(interaction, customId.slice(CUSTOM_IDS.startDurationModalPrefix.length));
    if (customId.startsWith(CUSTOM_IDS.requirementModalPrefix)) {
      const [type, draftId] = customId.slice(CUSTOM_IDS.requirementModalPrefix.length).split(':');
      return handleRequirementModalSubmit(interaction, type, draftId);
    }
  }
  return false;
}

module.exports = {
  init,
  handleClaimButton,
  handleDeleteCommand,
  handleInteraction,
  handleJoinButton,
  handleMessageCreate,
  handleMessageDelete,
  handleStartCommand,
};
