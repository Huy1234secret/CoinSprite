const { componentEmoji } = require('../../shared/emojis');
const { v2Payload } = require('../../shared/components');
const { RPS_EMOJIS, RPS_STATES } = require('../config/rps');
const { formatTokenBreakdown, formatTokenLines } = require('../utils/tokens');

const WHITE = 0xFFFFFF;
const GREEN = 0x22C55E;
const RED = 0xEF4444;
const GREY = 0x9CA3AF;

function option(label, value, emoji) {
  const result = { label, value };
  const parsed = componentEmoji(emoji);
  if (parsed) result.emoji = parsed;
  return result;
}

function initialRpsPayload(game, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: GREY,
    components: [
      { type: 10, content: `### Hey <@${game.hostUserId}>, Player or Bot?` },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 1,
        components: [{
          type: 3,
          custom_id: `rng:rps:mode:${game.id}`,
          placeholder: 'Select here',
          min_values: 1,
          max_values: 1,
          options: [
            option('Bot', 'bot', RPS_EMOJIS.bot),
            option('Player', 'human', RPS_EMOJIS.player),
          ],
        }],
      },
    ],
  }], options);
}

function opponentPickerPayload(game, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: GREY,
    components: [
      { type: 10, content: `### <@${game.hostUserId}>, choose your opponent(s)` },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 1,
        components: [{
          type: 5,
          custom_id: `rng:rps:opponents:${game.id}`,
          placeholder: 'You can play with up to 3 other players!',
          min_values: 1,
          max_values: 3,
        }],
      },
    ],
  }], options);
}

function imagePayload(beforeImage, afterImage, game, image, color, options = {}) {
  const filename = `rps-${game.id}.png`;
  const payload = v2Payload([{
    type: 17,
    accent_color: color,
    components: [
      ...beforeImage,
      { type: 14, divider: true, spacing: 1 },
      { type: 12, items: [{ media: { url: `attachment://${filename}` } }] },
      { type: 14, divider: true, spacing: 1 },
      ...afterImage,
    ],
  }], options);
  return { ...payload, files: [{ attachment: image, name: filename }], attachments: [] };
}

function participantLine(game, includeStatus = false) {
  const values = game.participants.map((participant) => {
    const status = includeStatus && participant.resultStatus ? ` **${participant.resultStatus}**` : '';
    return `<@${participant.userId}>${status}`;
  });
  if (game.mode === 'bot') {
    let status = '';
    if (includeStatus) {
      status = game.resultType === 'draw' ? ' **DRAW**' : (game.winnerUserId === 'bot' ? ' **WIN**' : ' **LOSE**');
    }
    values.push(`**Bot ${RPS_EMOJIS.bot}**${status}`);
  }
  return `- ${values.join(' vs ')}`;
}

function betText(game, final = false) {
  const participants = game.mode === 'bot' ? 2n : BigInt(game.participants.length);
  const label = game.mode === 'bot' ? 'Bet' : 'Bet each';
  const resultLabel = final ? (game.resultType === 'draw' ? 'Refund each' : 'Payout') : (game.mode === 'bot' ? 'Potential payout' : 'Pot');
  const resultValue = final && game.resultType === 'draw' ? game.bet : game.bet * participants;
  return `${label}: ${formatTokenBreakdown(game.bet)} · \`TT: ${game.bet}\` · ${resultLabel}: ${resultValue}`;
}

function lobbyPayload(game, image, options = {}) {
  const states = game.participants.map((participant) => (
    `${participant.accepted ? '✅ Accepted' : '⏳ Waiting'} — <@${participant.userId}>`
  )).join('\n');
  const beforeImage = [
    { type: 10, content: `### Rock-Paper-Scissors\n${participantLine(game)}\n${betText(game)}` },
    { type: 10, content: states },
  ];
  const afterImage = [
    { type: 10, content: 'Waiting for opponent(s)' },
    {
      type: 1,
      components: [
        { type: 2, style: 4, label: 'NO', custom_id: `rng:rps:cancel:${game.id}` },
        { type: 2, style: 2, label: 'BET!', custom_id: `rng:rps:accept:${game.id}` },
        { type: 2, style: 3, label: 'HIGHER BET!!!', custom_id: `rng:rps:higher:${game.id}` },
      ],
    },
  ];
  return imagePayload(beforeImage, afterImage, game, image, WHITE, options);
}

function moveMenu(game) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `rng:rps:pick:${game.id}`,
      placeholder: 'Pick a card!',
      min_values: 1,
      max_values: 1,
      options: [
        option('Rock', 'rock', RPS_EMOJIS.rock),
        option('Paper', 'paper', RPS_EMOJIS.paper),
        option('Scissors', 'scissors', RPS_EMOJIS.scissors),
      ],
    }],
  };
}

function revealButton(game) {
  return {
    type: 1,
    components: [{ type: 2, style: 2, label: 'SHOW RESULT', custom_id: `rng:rps:reveal:${game.id}` }],
  };
}

function replayMenu(game) {
  return {
    type: 1,
    components: [{
      type: 3,
      custom_id: `rng:rps:replay:${game.id}`,
      placeholder: 'Select an option',
      min_values: 1,
      max_values: 1,
      options: [
        { label: 'Change bet', value: 'change' },
        { label: 'Same bet', value: '1' },
        { label: '×2 Bet', value: '2' },
        { label: '×4 Bet', value: '4' },
        { label: '×10 Bet', value: '10' },
      ],
    }],
  };
}

function finalMessage(game) {
  if (game.resultType === 'draw') {
    return game.mode === 'bot'
      ? 'The round ended in a draw. Your bet was refunded.'
      : 'The round ended in a draw. All bets were refunded.';
  }
  if (game.winnerUserId === 'bot') return `**Bot ${RPS_EMOJIS.bot}** has won!`;
  const payout = game.mode === 'bot' ? game.bet * 2n : game.bet * BigInt(game.participants.length);
  return `<@${game.winnerUserId}> has won ${formatTokenBreakdown(payout)}!`;
}

function resultColor(game) {
  if (game.resultType === 'draw') return GREY;
  if (game.mode === 'bot') return game.winnerUserId === game.hostUserId ? GREEN : RED;
  return GREEN;
}

function roundPayload(game, image, options = {}) {
  const finished = game.state === RPS_STATES.FINISHED;
  const ready = game.state === RPS_STATES.READY_TO_REVEAL;
  const current = game.participants[game.currentTurn];
  const prompt = finished
    ? finalMessage(game)
    : (ready ? 'Every card is locked in.' : `It's <@${current?.userId || game.hostUserId}>'s turn!`);
  const beforeImage = [
    { type: 10, content: `### Rock-Paper-Scissors\n${participantLine(game, finished)}\n${betText(game, finished)}` },
  ];
  const afterImage = [
    { type: 10, content: prompt },
  ];
  if (finished && game.mode === 'bot') {
    afterImage.push({ type: 10, content: '-# Wanna play again with the Bot?' }, replayMenu(game));
  } else if (ready) {
    afterImage.push(revealButton(game));
  } else if (!finished) {
    afterImage.push(moveMenu(game));
  }
  return imagePayload(beforeImage, afterImage, game, image, finished ? resultColor(game) : WHITE, options);
}

function canceledPayload(game, options = {}) {
  const expired = game.state === RPS_STATES.EXPIRED;
  return { ...v2Payload([{
    type: 17,
    accent_color: expired ? GREY : RED,
    components: [{
      type: 10,
      content: `### Rock-Paper-Scissors ${expired ? 'expired' : 'canceled'}\nAny escrowed bets were refunded exactly once.`,
    }],
  }], options), attachments: [] };
}

function renderFailurePayload(game, options = {}) {
  return { ...v2Payload([{
    type: 17,
    accent_color: RED,
    components: [
      { type: 10, content: '### RPS image unavailable\nYour game state and any escrowed tokens are safe. Retry rendering this same round.' },
      { type: 1, components: [{ type: 2, style: 2, label: 'Retry image', custom_id: `rng:rps:retry:${game.id}` }] },
    ],
  }], options), attachments: [] };
}

function exchangePreviewPayload(userId, tokenAmount, sheckleCost, action, affordable, options = {}) {
  const lines = formatTokenLines(tokenAmount);
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `<@${userId}>, you are exchanging **${sheckleCost.toLocaleString('en-US')} Sheckles** for **${tokenAmount} token value**.` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: lines },
      {
        type: 1,
        components: [{
          type: 2,
          style: affordable ? 3 : 4,
          label: affordable ? 'Exchange' : "You don't have enough",
          custom_id: `rng:exchange:confirm:${action.id}`,
          disabled: !affordable,
        }],
      },
    ],
  }], options);
}

function exchangeSuccessPayload(userId, result, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: GREEN,
    components: [
      { type: 10, content: `### Exchange complete\n<@${userId}> received **${result.tokenAmount} token value** for **${result.sheckleCost.toLocaleString('en-US')} Sheckles**.` },
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: formatTokenLines(result.tokenAmount) },
      { type: 10, content: `-# Four-hour allowance remaining: ${result.remaining}` },
    ],
  }], options);
}

module.exports = {
  canceledPayload,
  exchangePreviewPayload,
  exchangeSuccessPayload,
  initialRpsPayload,
  lobbyPayload,
  opponentPickerPayload,
  renderFailurePayload,
  roundPayload,
};
