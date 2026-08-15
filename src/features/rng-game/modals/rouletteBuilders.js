const TARGET_LABELS = Object.freeze({
  straight: ['Number', '0 to 36'],
  split: ['Two adjacent numbers', 'Example: 1,4'],
  street: ['Street', 'First number or 1,2,3'],
  corner: ['Four corner numbers', 'Example: 1,2,4,5'],
  six_line: ['Six Line', 'First number or 1-6'],
});

function textInput(label, customId, placeholder, maximum = 50) {
  return { type: 18, label, component: { type: 4, style: 1, custom_id: customId, placeholder, min_length: 1, max_length: maximum, required: true } };
}

function rouletteBetModal(gameId, betType) {
  const target = TARGET_LABELS[betType];
  return {
    custom_id: `rng:roulette:bet-submit:${gameId}:${betType}`,
    title: 'Place roulette bet',
    components: [
      ...(target ? [textInput(target[0], 'target', target[1])] : []),
      textInput('Token amount', 'amount', 'min: 1, max total: 1000', 4),
    ],
  };
}

module.exports = { TARGET_LABELS, rouletteBetModal };
