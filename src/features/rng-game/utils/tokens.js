const TOKEN_DENOMINATIONS = Object.freeze([
  Object.freeze({ value: 10_000n, emoji: '<:Token10K:1536768547957776494>' }),
  Object.freeze({ value: 5_000n, emoji: '<:Token5K:1536768545084547082>' }),
  Object.freeze({ value: 1_000n, emoji: '<:Token1K:1536768541972365393>' }),
  Object.freeze({ value: 500n, emoji: '<:Token500:1536768539069784134>' }),
  Object.freeze({ value: 100n, emoji: '<:Token100:1536768536289091614>' }),
  Object.freeze({ value: 50n, emoji: '<:Token50:1536768533541814414>' }),
  Object.freeze({ value: 10n, emoji: '<:Token10:1536768531314774146>' }),
  Object.freeze({ value: 5n, emoji: '<:Token5:1536768528424894514>' }),
  Object.freeze({ value: 1n, emoji: '<:Token1:1536768525220184164>' }),
]);

function tokenValue(value) {
  const total = BigInt(value);
  if (total < 0n) throw new RangeError('Token value cannot be negative.');
  return total;
}

function decomposeTokens(value) {
  let remaining = tokenValue(value);
  const entries = [];
  for (const denomination of TOKEN_DENOMINATIONS) {
    const quantity = remaining / denomination.value;
    if (quantity > 0n) {
      entries.push(Object.freeze({ ...denomination, quantity }));
      remaining %= denomination.value;
    }
  }
  return entries;
}

function formatTokenLines(value) {
  return decomposeTokens(value)
    .map((entry) => `${entry.emoji} ×${entry.quantity.toLocaleString('en-US')}`)
    .join('\n');
}

function formatTokenList(value) {
  return decomposeTokens(value)
    .map((entry) => `${entry.emoji} \`×${entry.quantity.toLocaleString('en-US')}\``)
    .join(', ');
}

function formatTokenBreakdown(value) {
  return decomposeTokens(value)
    .map((entry) => `${entry.emoji} ×${entry.quantity.toLocaleString('en-US')}`)
    .join(' + ') || '0 tokens';
}

module.exports = {
  TOKEN_DENOMINATIONS,
  decomposeTokens,
  formatTokenBreakdown,
  formatTokenLines,
  formatTokenList,
  tokenValue,
};
