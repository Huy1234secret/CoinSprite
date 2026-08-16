const { componentEmoji } = require('../../shared/emojis');
const { v2Payload } = require('../../shared/components');
const {
  ROULETTE_ACTION_OPTIONS,
  ROULETTE_BET_OPTIONS,
  ROULETTE_LIMITS,
  ROULETTE_STATES,
} = require('../config/roulette');
const { TOKEN_DENOMINATIONS } = require('../utils/tokens');
const { totalReturn, winningBetRegions } = require('../services/rouletteRules');

const WHITE = 0xFFFFFF;
const GREY = 0x9CA3AF;
const RED = 0xEF4444;
const GREEN = 0x22C55E;
const BLACK = 0x27272A;
const TOKEN_EMOJI = TOKEN_DENOMINATIONS.at(-1).emoji;

function selectOption(entry) {
  const result = { label: entry.label, value: entry.value, description: entry.description };
  const parsed = componentEmoji(entry.emoji);
  if (parsed) result.emoji = parsed;
  return result;
}

function formatTokenAmount(value) {
  return `${BigInt(value).toLocaleString('en-US')} ${TOKEN_EMOJI}`;
}

function canonicalBetLabel(bet) {
  const label = ROULETTE_BET_OPTIONS.find((entry) => entry.value === bet.type)?.label || bet.type;
  if (bet.type === 'straight') return `${label} ${bet.target}`;
  if (bet.type === 'split' || bet.type === 'corner') return `${label} ${String(bet.target).replaceAll('-', '–')}`;
  if (bet.type === 'street') {
    const first = Number(bet.target);
    return `${label} ${first}–${first + 2}`;
  }
  if (bet.type === 'six_line') {
    const first = Number(bet.target);
    return `${label} ${first}–${first + 5}`;
  }
  return label;
}

function participantStatusLines(game) {
  return [...game.participants]
    .sort((left, right) => left.seat - right.seat)
    .map((participant) => {
      const bets = game.bets
        .filter((bet) => bet.userId === participant.userId && bet.state !== 'REFUNDED')
        .sort((left, right) => left.createdSequence - right.createdSequence);
      const status = participant.ready ? '✅ Ready' : '🟡 Not Ready';
      const lines = bets.length
        ? bets.map((bet) => `-# • ${canonicalBetLabel(bet)} — ${formatTokenAmount(bet.amount)}`)
        : ['-# • No bets placed'];
      return `<@${participant.userId}>: ${status}\n${lines.join('\n')}`;
    });
}

function participantStatusComponents(game) {
  return participantStatusLines(game).map((content) => ({ type: 10, content }));
}

function bettingControls(game) {
  return [
    { type: 1, components: [{
      type: 3,
      custom_id: `rng:roulette:action:${game.id}`,
      placeholder: 'Select action',
      min_values: 1,
      max_values: 1,
      options: ROULETTE_ACTION_OPTIONS.map(selectOption),
    }] },
    { type: 1, components: [
      { type: 2, style: 2, label: 'Join Table', custom_id: `rng:roulette:join:${game.id}` },
      { type: 2, style: 3, label: 'Ready/Unready', custom_id: `rng:roulette:toggle-ready:${game.id}` },
    ] },
  ];
}

function rouletteBetSelectorPayload(game, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: '### Place a Roulette bet' },
      { type: 1, components: [{
        type: 3,
        custom_id: `rng:roulette:bet:${game.id}`,
        placeholder: 'Select bet',
        min_values: 1,
        max_values: 1,
        options: ROULETTE_BET_OPTIONS.map(selectOption),
      }] },
    ],
  }], { ...options, ephemeral: true });
}

function rouletteImagePayload(media, before, after, color, options = {}) {
  const mediaComponents = [];
  media.forEach((entry, index) => {
    if (index > 0) mediaComponents.push({ type: 14, divider: true, spacing: 1 });
    mediaComponents.push({ type: 12, items: [{ media: { url: `attachment://${entry.name}` } }] });
  });
  const components = [...before, { type: 14, divider: true, spacing: 1 }, ...mediaComponents];
  if (after.length) components.push({ type: 14, divider: true, spacing: 1 }, ...after);
  const payload = v2Payload([{ type: 17, accent_color: color, components }], options);
  return {
    ...payload,
    files: media.map((entry) => ({ attachment: entry.image, name: entry.name })),
    attachments: [],
  };
}

function rouletteBettingPayload(game, tableImage, options = {}) {
  const name = `roulette-table-${game.id}-v${game.revision}.png`;
  return rouletteImagePayload([{ image: tableImage, name }], [
    { type: 10, content: '### European Roulette\n-# Public table • up to four players • every player settles independently against the house.' },
    ...participantStatusComponents(game),
  ], bettingControls(game), WHITE, options);
}

function rouletteSpinningPayload(game, tableImage, spinImage, options = {}) {
  const extension = options.extension === 'png' ? 'png' : 'gif';
  const payloadOptions = { ...options };
  delete payloadOptions.extension;
  return rouletteImagePayload([
    { image: tableImage, name: `roulette-table-${game.id}-v${game.revision}.png` },
    { image: spinImage, name: `roulette-spin-${game.id}-v${game.revision}.${extension}` },
  ], [{ type: 10, content: '### Roulette is spinning…\n-# No more bets' }], [], WHITE, payloadOptions);
}

function signed(value) { return value > 0n ? `+${value}` : String(value); }

function winningPositionLabels(resultNumber) {
  return winningBetRegions(resultNumber).map(canonicalBetLabel);
}

function resultParticipantComponents(game) {
  return [...game.participants]
    .sort((left, right) => left.seat - right.seat)
    .map((participant) => {
      const bets = game.bets
        .filter((bet) => bet.userId === participant.userId && bet.state !== 'REFUNDED')
        .sort((left, right) => left.createdSequence - right.createdSequence);
      const lines = bets.length ? bets.map((bet) => {
        const returned = totalReturn(bet, game.winningNumber);
        const settlement = returned > 0n ? `Won ${formatTokenAmount(returned)}` : 'Lost';
        return `-# • ${canonicalBetLabel(bet)} — ${formatTokenAmount(bet.amount)} — ${settlement}`;
      }) : ['-# • No bets placed'];
      lines.push(`-# Net: ${signed(participant.resultNet)} tokens`);
      return { type: 10, content: `<@${participant.userId}>:\n${lines.join('\n')}` };
    });
}

function rouletteResultPayload(game, tableImage, resultImage, options = {}) {
  const winningPositions = winningPositionLabels(game.winningNumber).join(' • ');
  const color = game.winningColor === 'green' ? GREEN : (game.winningColor === 'red' ? RED : BLACK);
  return rouletteImagePayload([
    { image: tableImage, name: `roulette-table-${game.id}-v${game.revision}.png` },
    { image: resultImage, name: `roulette-result-${game.winningNumber}-${game.id}-v${game.revision}.png` },
  ], [
    { type: 10, content: `### Roulette Result: ${game.winningNumber} ${game.winningColor}\nWinning positions: ${winningPositions}` },
    ...resultParticipantComponents(game),
  ], [{ type: 1, components: [
    { type: 2, style: 3, label: 'Play Again', custom_id: `rng:roulette:replay:${game.id}` },
    { type: 2, style: 2, label: 'Rules', custom_id: `rng:roulette:rules:${game.id}` },
  ] }], color, options);
}

function rouletteTerminalPayload(game, options = {}) {
  const expired = game.state === ROULETTE_STATES.EXPIRED;
  return { ...v2Payload([{
    type: 17,
    accent_color: expired ? GREY : RED,
    components: [{ type: 10, content: `### European Roulette ${expired ? 'expired' : 'canceled'}\nAll unresolved bets were refunded exactly once.` }],
  }], options), attachments: [] };
}

function rouletteRenderFailurePayload(game, options = {}) {
  return { ...v2Payload([{
    type: 17,
    accent_color: RED,
    components: [
      { type: 10, content: `### Roulette image unavailable\nRevision **${game.revision}** and every token mutation are safely persisted.` },
      { type: 1, components: [{ type: 2, style: 2, label: 'Retry image', custom_id: `rng:roulette:retry:${game.id}` }] },
    ],
  }], options), attachments: [] };
}

function rouletteRulesPayload(options = {}) {
  const red = '1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36';
  return v2Payload([{
    type: 17,
    accent_color: GREY,
    components: [{ type: 10, content: [
      '### European Roulette Rules',
      'The winning number is **0–36**. Zero is green; there is no 00.',
      `**Red:** ${red}. Every other nonzero number is black.`,
      '**Bets:** Straight 35:1; Split 17:1; Street/Trio 11:1; Corner/Basket 8:1; Six Line 5:1; Dozen/Column 2:1; Red/Black, Even/Odd, and Low/High 1:1 profit.',
      'Total returns include stake: a 10-token Straight winner returns 360; an even-money winner returns 20.',
      'Outside bets, dozens, and columns lose on 0.',
      `Limits: ${ROULETTE_LIMITS.minimumBet}–${ROULETTE_LIMITS.maximumBet} per bet, ${ROULETTE_LIMITS.maximumTotal} total, ${ROULETTE_LIMITS.maximumPositions} distinct positions.`,
      'At least one wager is required. Only players with bets must be Ready before the host spins.',
      'Clearing, cancellation, and expiry refund unresolved escrow exactly once.',
    ].join('\n') }],
  }], { ...options, ephemeral: true });
}

module.exports = {
  bettingControls,
  canonicalBetLabel,
  formatTokenAmount,
  participantStatusLines,
  resultParticipantComponents,
  rouletteBetSelectorPayload,
  rouletteBettingPayload,
  rouletteImagePayload,
  rouletteRenderFailurePayload,
  rouletteResultPayload,
  rouletteRulesPayload,
  rouletteSpinningPayload,
  rouletteTerminalPayload,
  winningPositionLabels,
};
