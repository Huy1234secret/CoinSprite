const { v2Payload, WHITE } = require('../../shared/components');
const { BURGER_EMOJIS, PIPE_EMOJIS, TRASH_EMOJIS } = require('../data/emojis');
const { PIECES } = require('../games/plumber');

const JOB_NAMES = Object.freeze({ burger: 'Burger Maker', trash: 'Trash Sorter', plumber: 'Plumber', electrician: 'Electrician' });
const titleCase = (value) => value[0].toUpperCase() + value.slice(1);
const button = (sessionId, action, emoji, options = {}) => ({
  type: 2, style: options.style || 2, custom_id: `work:${sessionId}:${action}`,
  ...(emoji ? { emoji: typeof emoji === 'string' ? { name: emoji } : emoji } : {}),
  ...(options.label ? { label: options.label } : {}), disabled: options.disabled === true,
});
const rows = (buttons) => Array.from({ length: Math.ceil(buttons.length / 5) }, (_, index) => ({ type: 1, components: buttons.slice(index * 5, index * 5 + 5) }));

function gameMessage(session) {
  if (session.job === 'burger') return session.state.message;
  if (session.job === 'trash') {
    const current = session.state.items[Math.min(session.state.sorted, session.state.items.length - 1)];
    return `-# Sort this item below:\n### ${current.item} [${session.state.sorted}/${session.state.required}]`;
  }
  if (session.job === 'plumber') return 'reconnect the pipeline!';
  return 'Connect the 2 same wire color together';
}

function controlRows(session, disabled = false, succeeded = false) {
  if (session.job === 'burger') return rows(session.state.buttons.map((name) => button(session.sessionId, name, BURGER_EMOJIS[name], { disabled })));
  if (session.job === 'trash') return rows(Object.keys(TRASH_EMOJIS).map((name) => button(session.sessionId, name, TRASH_EMOJIS[name], { disabled })));
  if (session.job === 'plumber') return Array.from({ length: 5 }, (_, row) => ({
    type: 1,
    components: session.state.cells.slice(row * 5, row * 5 + 5).map((cell, offset) => {
      const index = row * 5 + offset;
      if (cell.type === 'empty') return button(session.sessionId, `pipe-${index}`, null, { label: '·', disabled: true });
      const emoji = cell.type === 'valve' ? PIPE_EMOJIS[cell.piece] : PIPE_EMOJIS[PIECES[cell.piece].emoji];
      return button(session.sessionId, `pipe-${index}`, emoji, { disabled: disabled || cell.type === 'valve', style: succeeded ? 3 : 2 });
    }),
  }));
  return rows(session.state.buttons.map((wire) => button(session.sessionId, `wire-${wire.id}`, wire.emoji, {
    disabled: disabled || session.state.matched.includes(wire.pair),
    style: session.state.matched.includes(wire.pair) ? 3 : (session.state.selected === wire.id ? 1 : 2),
  })));
}

function activeGamePayload(session, options = {}) {
  return v2Payload([{
    type: 17, accent_color: WHITE, components: [
      { type: 10, content: `### You're ${JOB_NAMES[session.job]}\n-# You have <t:${Math.floor(session.deadline / 1000)}:R> to complete the work.` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: gameMessage(session) },
      ...controlRows(session),
    ],
  }], options);
}

function cooldownPayload(nextWorkAt, options = {}) {
  return v2Payload([{ type: 17, accent_color: WHITE, components: [{ type: 10, content: `### You need a break\n-# You can work again <t:${Math.floor(nextWorkAt / 1000)}:R>.` }] }], options);
}

function unavailablePayload(options = {}) {
  return v2Payload([{ type: 17, accent_color: WHITE, components: [{ type: 10, content: '### Work is unavailable\n-# Leveling is locked or paused for this server.' }] }], options);
}

function activeSessionPayload(deadline, options = {}) {
  return v2Payload([{ type: 17, accent_color: WHITE, components: [{ type: 10, content: `### Work already in progress\n-# Finish your current job before <t:${Math.floor(deadline / 1000)}:R>.` }] }], options);
}

function ownershipDeniedPayload(options = {}) {
  return v2Payload([{ type: 17, accent_color: WHITE, components: [{ type: 10, content: '### Those controls are not yours\n-# Only the member who started this job can use them.' }] }], options);
}

function settledPayload(session, result, options = {}) {
  const success = session.status === 'succeeded';
  const content = success
    ? `### Work complete!\n-# ${JOB_NAMES[session.job]} · ${titleCase(session.difficulty)}\n\nYou earned **${session.xpAwarded} XP** and are now **Level ${result.level}**.\n-# You can work again <t:${Math.floor(result.nextWorkAt / 1000)}:R>.`
    : `### Work failed\n-# ${result.reason}\n\nYou earned **0 XP**.\n-# You can work again <t:${Math.floor(result.nextWorkAt / 1000)}:R>.`;
  return v2Payload([{ type: 17, accent_color: WHITE, components: [
    { type: 10, content: content.split('\n\n')[0] }, { type: 14, divider: true, spacing: 1 },
    { type: 10, content: content.split('\n\n').slice(1).join('\n\n') }, ...controlRows(session, true, success),
  ] }], { ...options, initial: false });
}

module.exports = { JOB_NAMES, activeGamePayload, activeSessionPayload, controlRows, cooldownPayload, gameMessage, ownershipDeniedPayload, settledPayload, unavailablePayload };
