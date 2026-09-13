const { assertValidMessagePayload } = require('../shared/discordPayload');
const { errorPayload, v2Payload, WHITE } = require('../shared/components');
const { formatCurrency } = require('../shared/currency');
const { APPROACH_BY_ID } = require('./data/approaches');

const BUTTON_LABEL_LIMIT = 80;
const SECONDARY_BUTTON_STYLE = 2;
const OUTCOME_COLORS = Object.freeze({
  success: 0x57f287,
  fail: 0xed4245,
  loss: 0x000000,
});

function timestamp(value) { return `<t:${Math.floor(Number(value) / 1000)}:R>`; }

function buttonLabel(approach) {
  return approach.name.slice(0, BUTTON_LABEL_LIMIT);
}

function menuPayload(session, options = {}) {
  const buttons = session.offeredApproachIds.map((approachId) => {
    const approach = APPROACH_BY_ID[approachId];
    return {
      type: 2,
      style: SECONDARY_BUTTON_STYLE,
      custom_id: `csbeg:${session.sessionId}:${approach.id}`,
      label: buttonLabel(approach),
    };
  });
  return assertValidMessagePayload(v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: '### What are you going to do?' },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: '-# Select an action' },
      { type: 1, components: buttons },
    ],
  }], options));
}

function outcomePayload(result, options = {}) {
  const { session } = result;
  const approach = APPROACH_BY_ID[session.approachId];
  let story;
  let change;
  if (session.outcome === 'success') {
    story = approach.success;
    change = `**+${formatCurrency(session.amount)}**`;
  } else if (session.outcome === 'loss') {
    story = approach.lossMessage;
    change = `**−${formatCurrency(session.amount)}**`;
  } else {
    story = approach.failure;
    change = '**No coins received**';
  }
  const content = [
    `### ${approach.name}`,
    story,
    change,
    `Balance: **${formatCurrency(session.balanceAfter)}**`,
    `-# You can beg again ${timestamp(session.cooldownUntil)}.`,
  ].join('\n');
  return assertValidMessagePayload(v2Payload([{
    type: 17,
    accent_color: OUTCOME_COLORS[session.outcome] ?? OUTCOME_COLORS.fail,
    components: [{ type: 10, content }],
  }], options));
}

function cooldownPayload(userId, nextBegAt, options = {}) {
  return assertValidMessagePayload(errorPayload(
    `<@${userId}>, you can beg again ${timestamp(nextBegAt)}.`, options,
  ));
}

function activeMenuPayload(userId, session, options = {}) {
  return assertValidMessagePayload(errorPayload(
    `<@${userId}>, you already have an open Beg menu. It expires ${timestamp(session.expiresAt)}.`, options,
  ));
}

function unavailablePayload(options = {}) {
  return assertValidMessagePayload(errorPayload('This game command is not enabled in this channel.', options));
}

function ownershipDeniedPayload(options = {}) {
  return assertValidMessagePayload(errorPayload('That Beg attempt belongs to another member or message.', options));
}

function expiredPayload(options = {}) {
  return assertValidMessagePayload(errorPayload('That Beg menu expired. Run `/cs-beg` or `csbeg` again.', options));
}

function invalidApproachPayload(options = {}) {
  return assertValidMessagePayload(errorPayload('That approach was not offered in this Beg menu.', options));
}

module.exports = {
  BUTTON_LABEL_LIMIT, OUTCOME_COLORS, activeMenuPayload, buttonLabel, cooldownPayload, expiredPayload,
  invalidApproachPayload, menuPayload, outcomePayload, ownershipDeniedPayload,
  timestamp, unavailablePayload,
};
