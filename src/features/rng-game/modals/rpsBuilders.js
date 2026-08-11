function textLabel(labelText, customId, placeholder) {
  return {
    type: 18,
    label: labelText,
    component: {
      type: 4,
      style: 1,
      custom_id: customId,
      placeholder,
      min_length: 1,
      max_length: 4,
      required: true,
    },
  };
}

function rpsBetModal(gameId, action = 'bot-bet') {
  return {
    custom_id: `rng:rps:${action}:${gameId}`,
    title: 'Rock-Paper-Scissors bet',
    components: [textLabel('Bet amount', 'bet', 'min: 1, max: 1000')],
  };
}

function higherBetModal(gameId, currentBet) {
  return {
    custom_id: `rng:rps:higher-submit:${gameId}`,
    title: 'Propose a higher bet',
    components: [textLabel('Higher bet amount', 'bet', `${BigInt(currentBet) + 1n} - 1000`)],
  };
}

module.exports = { higherBetModal, rpsBetModal };
