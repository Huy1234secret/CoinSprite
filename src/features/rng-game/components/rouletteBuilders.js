const { componentEmoji } = require('../../shared/emojis');
const { v2Payload } = require('../../shared/components');
const { RPS_EMOJIS } = require('../config/rps');
const { ROULETTE_BET_OPTIONS, ROULETTE_LIMITS, ROULETTE_STATES } = require('../config/roulette');

const WHITE = 0xFFFFFF;
const GREY = 0x9CA3AF;
const RED = 0xEF4444;
const GREEN = 0x22C55E;
const BLACK = 0x27272A;

function option(label, value, emoji) {
  const result = { label, value };
  const parsed = componentEmoji(emoji);
  if (parsed) result.emoji = parsed;
  return result;
}

function initialRoulettePayload(game, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: GREY,
    components: [
      { type: 10, content: `### Hey <@${game.hostUserId}>, Player or Bot?` },
      { type: 14, divider: true, spacing: 1 },
      { type: 1, components: [{
        type: 3,
        custom_id: `rng:roulette:mode:${game.id}`,
        placeholder: 'Select here',
        min_values: 1,
        max_values: 1,
        options: [option('Bot', 'bot', RPS_EMOJIS.bot), option('Player', 'human', RPS_EMOJIS.player)],
      }] },
      { type: 1, components: [{ type: 2, style: 4, label: 'Cancel Table', custom_id: `rng:roulette:cancel:${game.id}` }] },
    ],
  }], options);
}

function rouletteOpponentPickerPayload(game, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: GREY,
    components: [
      { type: 10, content: `### <@${game.hostUserId}>, choose your opponent(s)` },
      { type: 14, divider: true, spacing: 1 },
      { type: 1, components: [{
        type: 5,
        custom_id: `rng:roulette:opponents:${game.id}`,
        placeholder: 'You can play with up to 3 other players!',
        min_values: 1,
        max_values: 3,
      }] },
      { type: 1, components: [{ type: 2, style: 4, label: 'Cancel Table', custom_id: `rng:roulette:cancel:${game.id}` }] },
    ],
  }], options);
}

function rouletteLobbyPayload(game, options = {}) {
  const status = game.participants.map((participant) => `${participant.accepted ? '✅ Joined' : '⏳ Invited'} — <@${participant.userId}>`).join('\n');
  const accepted = game.participants.filter((participant) => participant.accepted).length;
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `### European Roulette\n${status}\n-# Every player places and settles their own bets against the house.` },
      { type: 14, divider: true, spacing: 1 },
      { type: 1, components: [
        { type: 2, style: 3, label: 'Join', custom_id: `rng:roulette:join:${game.id}` },
        { type: 2, style: 4, label: 'Decline', custom_id: `rng:roulette:decline:${game.id}` },
        { type: 2, style: 1, label: 'Start [Host only]', custom_id: `rng:roulette:start:${game.id}`, disabled: accepted < 2 },
        { type: 2, style: 4, label: 'Cancel Table', custom_id: `rng:roulette:cancel:${game.id}` },
      ] },
    ],
  }], options);
}

function participantStatusLines(game) {
  return game.participants.map((participant) => {
    const bets = game.bets.filter((bet) => bet.userId === participant.userId && bet.state !== 'REFUNDED');
    const total = bets.reduce((sum, bet) => sum + bet.amount, 0n);
    const status = participant.ready ? '🔒 Ready' : '🟡 Betting';
    return `<@${participant.userId}> — ${status} • ${bets.length} position${bets.length === 1 ? '' : 's'} • ${total} TT`;
  }).join('\n');
}

function rouletteImagePayload(game, image, before, after, color, options = {}, filename = `roulette-${game.id}-${game.revision}.png`) {
  const payload = v2Payload([{
    type: 17,
    accent_color: color,
    components: [
      ...before,
      { type: 14, divider: true, spacing: 1 },
      { type: 12, items: [{ media: { url: `attachment://${filename}` } }] },
      { type: 14, divider: true, spacing: 1 },
      ...after,
    ],
  }], options);
  return { ...payload, files: [{ attachment: image, name: filename }], attachments: [] };
}

function bettingControls(game) {
  const allReady = game.participants.length > 0 && game.participants.every((participant) => participant.ready && participant.escrowedTotal > 0n);
  return [
    { type: 1, components: [{
      type: 3,
      custom_id: `rng:roulette:bet:${game.id}`,
      placeholder: 'Place a bet',
      min_values: 1,
      max_values: 1,
      options: ROULETTE_BET_OPTIONS.map(({ label, value }) => ({ label, value })),
    }] },
    { type: 1, components: [
      { type: 2, style: 2, label: 'Undo Last Bet', custom_id: `rng:roulette:undo:${game.id}` },
      { type: 2, style: 4, label: 'Clear My Bets', custom_id: `rng:roulette:clear:${game.id}` },
      { type: 2, style: 3, label: 'Ready', custom_id: `rng:roulette:ready:${game.id}` },
      { type: 2, style: 2, label: 'Unready', custom_id: `rng:roulette:unready:${game.id}` },
      ...(game.mode === 'human' ? [{ type: 2, style: 4, label: 'Leave Table', custom_id: `rng:roulette:leave:${game.id}` }] : []),
    ] },
    { type: 1, components: [
      { type: 2, style: 1, label: 'Spin [Host only]', custom_id: `rng:roulette:spin:${game.id}`, disabled: !allReady },
      { type: 2, style: 2, label: 'Rules', custom_id: `rng:roulette:rules:${game.id}` },
      { type: 2, style: 4, label: 'Cancel Table', custom_id: `rng:roulette:cancel:${game.id}` },
    ] },
  ];
}

function rouletteBettingPayload(game, image, options = {}) {
  return rouletteImagePayload(game, image, [
    { type: 10, content: `### European Roulette\n${participantStatusLines(game)}\n-# Place your bets, lock them in, then the host spins. Outside bets lose when 0 wins.` },
  ], bettingControls(game), WHITE, options);
}

function rouletteSpinningPayload(game, image, options = {}) {
  const extension = options.extension === 'png' ? 'png' : 'gif';
  const payloadOptions = { ...options };
  delete payloadOptions.extension;
  const filename = `roulette-spin-${game.id}-v${game.revision}.${extension}`;
  return rouletteImagePayload(game, image, [
    { type: 10, content: '### Roulette is spinning…\n-# No more bets' },
  ], [{ type: 1, components: [
    { type: 2, style: 2, label: 'Rules', custom_id: `rng:roulette:rules:${game.id}` },
  ] }], WHITE, payloadOptions, filename);
}

function signed(value) { return value > 0n ? `+${value}` : String(value); }

function rouletteResultPayload(game, image, options = {}) {
  const lines = game.participants.map((participant) => (
    `<@${participant.userId}> — Staked: ${participant.resultStake} • Returned: ${participant.resultReturn} • Net: ${signed(participant.resultNet)}`
  )).join('\n');
  const color = game.winningColor === 'green' ? GREEN : (game.winningColor === 'red' ? RED : BLACK);
  return rouletteImagePayload(game, image, [
    { type: 10, content: `### Roulette Result: ${game.winningNumber} ${game.winningColor}\n${lines}` },
  ], [{ type: 1, components: [
    { type: 2, style: 3, label: 'Play Again', custom_id: `rng:roulette:replay:${game.id}` },
    { type: 2, style: 1, label: 'New Bets', custom_id: `rng:roulette:new-bets:${game.id}` },
    { type: 2, style: 2, label: 'Rules', custom_id: `rng:roulette:rules:${game.id}` },
  ] }], color, options, `roulette-result-${game.winningNumber}-${game.id}-v${game.revision}.png`);
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
      '**Bets:** Straight 35:1; Split 17:1; Street/Trio 11:1; Corner/First Four 8:1; Six Line 5:1; Dozen/Column 2:1; Red/Black, Even/Odd, and Low/High 1:1 profit.',
      'Total returns include stake: a 10 TT Straight winner returns 360 TT; an even-money winner returns 20 TT.',
      'Outside bets, dozens, and columns lose on 0.',
      `Limits: ${ROULETTE_LIMITS.minimumBet}–${ROULETTE_LIMITS.maximumBet} TT per bet, ${ROULETTE_LIMITS.maximumTotal} TT total, ${ROULETTE_LIMITS.maximumPositions} distinct positions.`,
      'Every player needs at least one bet and must be Ready before the host can spin. Editing bets makes you unready.',
      'Undo, clear, leaving before the spin, cancellation, and expiry refund unresolved escrow exactly once.',
    ].join('\n') }],
  }], { ...options, ephemeral: true });
}

module.exports = {
  bettingControls,
  initialRoulettePayload,
  participantStatusLines,
  rouletteBettingPayload,
  rouletteLobbyPayload,
  rouletteOpponentPickerPayload,
  rouletteRenderFailurePayload,
  rouletteResultPayload,
  rouletteRulesPayload,
  rouletteSpinningPayload,
  rouletteTerminalPayload,
};
