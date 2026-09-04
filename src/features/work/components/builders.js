const { v2Payload, WHITE } = require('../../shared/components');
const { assertValidMessagePayload } = require('../../shared/discordPayload');
const { BURGER_EMOJIS, PIPE_EMOJIS, TRASH_EMOJIS, WORK_EMOJIS } = require('../data/emojis');
const { PIECES } = require('../games/plumber');

const JOB_NAMES = Object.freeze({
  burger: 'Burger Maker', trash: 'Trash Sorter', plumber: 'Plumber', electrician: 'Electrician',
});
const JOB_ARTICLES = Object.freeze({ burger: 'a', trash: 'a', plumber: 'a', electrician: 'an' });
const INGREDIENT_LABELS = Object.freeze({
  bottom_bun: 'Bottom Bun', top_bun: 'Top Bun', beef_patty: 'Beef Patty', ketchup: 'Ketchup',
  cucumber: 'Cucumber', cheese: 'Cheese', mayonnaise: 'Mayonnaise', tomato: 'Tomato',
  onion: 'Onion', mustard: 'Mustard', lettuce: 'Lettuce',
});

function checked(components, options = {}) { return assertValidMessagePayload(v2Payload(components, options)); }
function button(sessionId, action, options = {}) {
  return {
    type: 2,
    style: options.style || 2,
    custom_id: `cswork:${sessionId}:${action}`,
    ...(options.emoji ? { emoji: options.emoji } : {}),
    ...(options.label ? { label: options.label } : {}),
    disabled: options.disabled === true,
  };
}
function rows(buttons) {
  return Array.from({ length: Math.ceil(buttons.length / 5) }, (_, index) => ({
    type: 1, components: buttons.slice(index * 5, index * 5 + 5),
  }));
}
function statusText(_userId, profile) {
  return `${WORK_EMOJIS.fire} Work Streak: ${profile.streak} \`×${((100 + profile.streak) / 100).toFixed(2)} Earnings\``;
}

function gameMessage(session) {
  if (session.job === 'burger') return `${session.state.message}\n\nBuilt: ${session.state.cursor}/${session.state.target.length}`;
  if (session.job === 'trash') {
    const current = session.state.items[Math.min(session.state.sorted, session.state.items.length - 1)];
    return `-# Sort the item below:\n### ${current.item} \`${session.state.sorted}/${session.state.required}\``;
  }
  if (session.job === 'plumber') return 'Reconnect the pipeline!';
  return 'Connect the two wires with the same color and shape.';
}

function controlRows(session, options = {}) {
  const disabled = options.disabled === true;
  if (session.job === 'burger') {
    return rows(session.state.buttons.map((name) => button(session.sessionId, name, {
      emoji: BURGER_EMOJIS[name], label: INGREDIENT_LABELS[name], disabled,
    })));
  }
  if (session.job === 'trash') {
    return rows(Object.keys(TRASH_EMOJIS).map((name) => button(session.sessionId, name, {
      emoji: TRASH_EMOJIS[name], label: name[0].toUpperCase() + name.slice(1), disabled,
    })));
  }
  if (session.job === 'plumber') {
    return Array.from({ length: 5 }, (_, row) => ({
      type: 1,
      components: session.state.cells.slice(row * 5, row * 5 + 5).map((cell, offset) => {
        const index = row * 5 + offset;
        if (cell.type === 'empty') return button(session.sessionId, `pipe-${index}`, { label: '·', disabled: true });
        const emoji = cell.type === 'valve' ? PIPE_EMOJIS[cell.piece] : PIPE_EMOJIS[PIECES[cell.piece].emoji];
        const rotatable = cell.type === 'pipe' && PIECES[cell.piece].next !== cell.piece;
        return button(session.sessionId, `pipe-${index}`, {
          emoji,
          disabled: disabled || cell.type === 'valve',
          style: options.succeeded && rotatable ? 3 : 2,
        });
      }),
    }));
  }
  return rows(session.state.buttons.map((wire) => button(session.sessionId, `wire-${wire.id}`, {
    emoji: { name: wire.emoji },
    disabled: disabled || session.state.matched.includes(wire.pair),
    style: session.state.matched.includes(wire.pair) ? 3 : (session.state.selected === wire.id ? 1 : 2),
  })));
}

function activeGamePayload(session, options = {}) {
  return checked([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### You're ${JOB_ARTICLES[session.job]} ${JOB_NAMES[session.job]}\n-# You have <t:${Math.floor(session.deadline / 1000)}:R> to complete the job.` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: gameMessage(session) },
      ...controlRows(session),
    ],
  }], options);
}

function cooldownPayload(userId, nextWorkAt, profile, options = {}) {
  return checked([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### <@${userId}>, you can work again <t:${Math.floor(nextWorkAt / 1000)}:R>` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: statusText(userId, profile) },
      { type: 1, components: [button('status', 'work', { label: 'Work', disabled: true })] },
    ],
  }], options);
}

function activeSessionPayload(userId, session, profile, options = {}) {
  return checked([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### <@${userId}>, you already have an active job\n-# Finish it before <t:${Math.floor(session.deadline / 1000)}:R>.` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: statusText(userId, profile) },
    ],
  }], options);
}

function ownershipDeniedPayload(options = {}) {
  return checked([{ type: 17, accent_color: WHITE, components: [{ type: 10, content: '### This Work session belongs to another user.' }] }], options);
}

function unavailablePayload(options = {}) {
  return checked([{ type: 17, accent_color: WHITE, components: [{ type: 10, content: '### This Work control is no longer available.' }] }], options);
}

function settledPayload(session, result, options = {}) {
  const success = session.status === 'succeeded';
  const profile = result.profile;
  let details;
  if (success) {
    const levelLine = session.levelsGained
      ? `\n${WORK_EMOJIS.token} Level up! ${session.tokensAwarded} Work Token${session.tokensAwarded === 1 ? '' : 's'} added.`
      : '';
    details = `${WORK_EMOJIS.bronze} Salary: +${session.salaryCredited}\n`
      + `${WORK_EMOJIS.level} Work XP: +${session.xpAwarded}\n`
      + `${statusText(session.userId, profile)}${levelLine}`;
  } else {
    details = `No salary or Work XP was earned.\n${WORK_EMOJIS.fire} Work Streak: 0 \`×1.00 Earnings\``;
  }
  return checked([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: success
        ? `### Job complete!\n-# You completed the ${JOB_NAMES[session.job]} shift.`
        : `### Job failed\n-# ${session.failureReason || result.reason || 'The job was not completed.'}` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: details },
      { type: 1, components: [button(session.sessionId, 'back', { label: 'Back' })] },
    ],
  }], { ...options, initial: false });
}

module.exports = {
  INGREDIENT_LABELS, JOB_ARTICLES, JOB_NAMES, activeGamePayload, activeSessionPayload,
  button, controlRows, cooldownPayload, gameMessage, ownershipDeniedPayload,
  rows, settledPayload, statusText, unavailablePayload,
};
