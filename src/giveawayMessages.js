const {
  ANNOUNCEMENT_TARGET_ID,
  BLACK_ACCENT,
  CUSTOM_IDS,
  EPHEMERAL_FLAG,
  FIELD_IDS,
  GREEN_ACCENT,
  ORANGE_ACCENT,
  PARTY_POPPER,
  WHITE_ACCENT,
  YELLOW_ACCENT,
  actionRow,
  button,
  container,
  draftClaimTimeText,
  draftDescriptionText,
  draftHostText,
  draftPrizeText,
  draftWinnerCountText,
  formatDiscordRelative,
  getRequirementLabel,
  isSetupComplete,
  joinMentions,
  separator,
  text,
  toV2Payload,
} = require('./giveawayUtils');

function buildGiveawayInfoLines({
  prize,
  headerLine,
  hostId,
  description,
  claimDurationLabel,
  winnerCount,
  requirement,
}) {
  const lines = [
    `## ${prize}`,
    headerLine,
    `-# **Hoster: <@${hostId}>**`,
  ];

  if (description) lines.push(description);
  lines.push('---');
  lines.push(`-# * Claim time: ${claimDurationLabel}`);
  lines.push(`-# * Winners: ${winnerCount}`);

  const requirementLabel = getRequirementLabel(requirement);
  if (requirementLabel) lines.push(`-# * Requirements: ${requirementLabel}`);
  return lines.join('\n');
}

function buildSetupPayload(draft, disabled = false) {
  const lines = [
    `## ${draftPrizeText(draft)}`,
    '-# **Ends after Start is pressed**',
    `-# **Hoster: ${draftHostText(draft)}**`,
    draftDescriptionText(draft),
    '---',
    `-# * Claim time: ${draftClaimTimeText(draft)}`,
    `-# * Winners: ${draftWinnerCountText(draft)}`,
  ];
  const requirementLabel = getRequirementLabel(draft.requirement);
  if (requirementLabel) lines.push(`-# * Requirements: ${requirementLabel}`);

  return toV2Payload([
    container(WHITE_ACCENT, [text(lines.join('\n'))]),
    actionRow([
      button(`${CUSTOM_IDS.editMessagePrefix}${draft.id}`, 'Edit message', 2, disabled),
      button(`${CUSTOM_IDS.editRequirementPrefix}${draft.id}`, 'Edit requirement', 2, disabled),
      button(`${CUSTOM_IDS.startPrefix}${draft.id}`, 'Start', 3, disabled || !isSetupComplete(draft)),
    ]),
  ]);
}

function buildStartDurationModal(draft) {
  return {
    custom_id: `${CUSTOM_IDS.startDurationModalPrefix}${draft.id}`,
    title: 'Start giveaway',
    components: [{
      type: 18,
      label: 'Giveaway duration',
      component: {
        type: 4,
        custom_id: FIELD_IDS.duration,
        style: 1,
        required: true,
        max_length: 30,
        placeholder: 'Example: 30m, 6h, 1d',
        value: draft.durationLabel || '',
      },
    }],
  };
}

function buildSetupModal(draft) {
  return {
    custom_id: `${CUSTOM_IDS.setupModalPrefix}${draft.id}`,
    title: 'Giveaway setup',
    components: [
      {
        type: 18,
        label: 'Giveaway prize',
        component: {
          type: 4,
          custom_id: FIELD_IDS.prize,
          style: 1,
          required: true,
          max_length: 200,
          value: draft.prize || '',
        },
      },
      {
        type: 18,
        label: 'Giveaway description, notes',
        component: {
          type: 4,
          custom_id: FIELD_IDS.description,
          style: 2,
          required: false,
          max_length: 1000,
          placeholder: 'Add some notes if needed.',
          value: draft.description || '',
        },
      },
      {
        type: 18,
        label: 'Claim time',
        component: {
          type: 4,
          custom_id: FIELD_IDS.claimTime,
          style: 1,
          required: true,
          max_length: 30,
          placeholder: 'Min: 5m - Max: 24h',
          value: draft.claimDurationLabel || '',
        },
      },
      {
        type: 18,
        label: 'Winner amount',
        component: {
          type: 4,
          custom_id: FIELD_IDS.winnerAmount,
          style: 1,
          required: true,
          max_length: 2,
          placeholder: 'Min: 1 - Max: 10',
          value: draft.winnerCount ? String(draft.winnerCount) : '',
        },
      },
      {
        type: 18,
        label: 'Hoster?',
        component: {
          type: 5,
          custom_id: FIELD_IDS.hoster,
          min_values: 1,
          max_values: 1,
          required: true,
          ...(draft.hostId ? { default_values: [{ id: draft.hostId, type: 'user' }] } : {}),
        },
      },
    ],
  };
}

function buildRequirementButtonsPayload(draftId) {
  return toV2Payload([
    container(WHITE_ACCENT, [text('What type of requirement you wanna add?\n---')]),
    actionRow([
      button(`${CUSTOM_IDS.requirementTypePrefix}level:${draftId}`, 'Level', 2),
      button(`${CUSTOM_IDS.requirementTypePrefix}message:${draftId}`, 'Message', 2),
      button(`${CUSTOM_IDS.requirementTypePrefix}other:${draftId}`, 'Other', 2),
    ]),
  ], { flags: EPHEMERAL_FLAG });
}

function buildRequirementModal(type, draft) {
  if (type === 'level') {
    return {
      custom_id: `${CUSTOM_IDS.requirementModalPrefix}level:${draft.id}`,
      title: 'Level requirement',
      components: [{
        type: 18,
        label: 'Specific level needed',
        component: {
          type: 4,
          custom_id: FIELD_IDS.requirementLevel,
          style: 1,
          required: true,
          max_length: 3,
          value: draft.requirement.type === 'level' ? String(draft.requirement.level) : '',
        },
      }],
    };
  }

  if (type === 'message') {
    return {
      custom_id: `${CUSTOM_IDS.requirementModalPrefix}message:${draft.id}`,
      title: 'Message requirement',
      components: [{
        type: 18,
        label: 'Amount message needed upon giveaway start',
        component: {
          type: 4,
          custom_id: FIELD_IDS.requirementMessage,
          style: 1,
          required: true,
          max_length: 5,
          value: draft.requirement.type === 'message' ? String(draft.requirement.messageCount) : '',
        },
      }],
    };
  }

  return {
    custom_id: `${CUSTOM_IDS.requirementModalPrefix}other:${draft.id}`,
    title: 'Other requirement',
    components: [{
      type: 18,
      label: 'What is your wanted requirement?',
      component: {
        type: 4,
        custom_id: FIELD_IDS.requirementOther,
        style: 1,
        required: true,
        max_length: 200,
        value: draft.requirement.type === 'other' ? draft.requirement.text : '',
      },
    }],
  };
}

function disableTopLevelButtons(payload) {
  return {
    ...payload,
    components: (payload.components || []).map((component) => {
      if (component.type !== 1) return component;
      return {
        ...component,
        components: (component.components || []).map((child) => ({ ...child, disabled: true })),
      };
    }),
  };
}

function buildLiveGiveawayPayload(giveaway, options = {}) {
  return toV2Payload([
    text(`<@&${ANNOUNCEMENT_TARGET_ID}>`),
    container(options.accent ?? WHITE_ACCENT, [
      text(buildGiveawayInfoLines({
        prize: giveaway.prize,
        headerLine: options.headerLine ?? `-# **Ends ${formatDiscordRelative(giveaway.endsAt)}**`,
        hostId: giveaway.hostId,
        description: giveaway.description,
        claimDurationLabel: giveaway.claimDurationLabel,
        winnerCount: giveaway.winnerCount,
        requirement: giveaway.requirement,
      })),
      separator(),
      actionRow([
        button(`${CUSTOM_IDS.joinPrefix}${giveaway.id}`, `${PARTY_POPPER} ${giveaway.entrantIds.length}`, options.buttonStyle ?? 3, Boolean(options.buttonDisabled)),
      ]),
    ]),
  ]);
}

function getRoundWinnerLine(round) {
  return round.roundNumber > 0
    ? `-# ${round.roundNumber}# Winners: ${joinMentions(round.winnerIds)}`
    : `-# Winners: ${joinMentions(round.winnerIds)}`;
}

function buildClaimRoundPayload(giveaway, round) {
  return toV2Payload([
    container(YELLOW_ACCENT, [
      text(`### ${giveaway.prize}\n${getRoundWinnerLine(round)}`),
      separator(),
      text(`Claimed: ${round.claimedIds.length} / ${round.winnerIds.length} - ${joinMentions(round.claimedIds)}`),
      actionRow([button(`${CUSTOM_IDS.claimPrefix}${giveaway.id}:${round.roundNumber}`, 'Claim', 3)]),
    ]),
  ]);
}

function buildClaimRoundAllClaimedPayload(giveaway, round) {
  return toV2Payload([
    container(GREEN_ACCENT, [
      text(`### ${giveaway.prize}\n${getRoundWinnerLine(round)}`),
      separator(),
      text('All winners have claimed their prizes.'),
    ]),
  ]);
}

function buildClaimRoundClosedPayload(giveaway, round, unclaimedCount) {
  return toV2Payload([
    container(ORANGE_ACCENT, [
      text(`### ${giveaway.prize}\n-# Winners: ${joinMentions(round.winnerIds)}`),
      separator(),
      text(`Claimed: ${joinMentions(round.claimedIds)}\nUnclaimed: ${unclaimedCount}`),
    ]),
  ]);
}

function buildNoMoreUsersPayload(giveaway) {
  return toV2Payload([
    container(BLACK_ACCENT, [
      text(`### ${giveaway.prize}\n-# Winner claimed: ${giveaway.claimedUserIds.length}`),
      separator(),
      text(`Unclaimed: ${Math.max(0, giveaway.winnerCount - giveaway.claimedUserIds.length)}\nThere are no more users left to roll.`),
    ]),
  ]);
}

function buildFinalGiveawayPayload(giveaway) {
  return toV2Payload([
    text(`<@&${ANNOUNCEMENT_TARGET_ID}>`),
    container(GREEN_ACCENT, [
      text(buildGiveawayInfoLines({
        prize: giveaway.prize,
        headerLine: `-# Final winner: ${joinMentions(giveaway.claimedUserIds)}`,
        hostId: giveaway.hostId,
        description: giveaway.description,
        claimDurationLabel: giveaway.claimDurationLabel,
        winnerCount: giveaway.winnerCount,
        requirement: giveaway.requirement,
      })),
      separator(),
      actionRow([
        button(`${CUSTOM_IDS.joinPrefix}${giveaway.id}`, `${PARTY_POPPER} ${giveaway.entrantIds.length}`, 3, true),
      ]),
    ]),
  ]);
}

function buildHosterDmPayload(giveaway, userId) {
  return toV2Payload([
    container(WHITE_ACCENT, [
      text(`<@${userId}> has claimed ${giveaway.prize}\n-# Besure to give them the prizes and provide evidences after giveaway ends.`),
    ]),
  ]);
}

module.exports = {
  buildClaimRoundAllClaimedPayload,
  buildClaimRoundClosedPayload,
  buildClaimRoundPayload,
  buildFinalGiveawayPayload,
  buildHosterDmPayload,
  buildLiveGiveawayPayload,
  buildNoMoreUsersPayload,
  buildRequirementButtonsPayload,
  buildRequirementModal,
  buildSetupModal,
  buildSetupPayload,
  buildStartDurationModal,
  disableTopLevelButtons,
};
