const MAX_SIMPLE_BET = 10_000;

function parseBetInput(raw) {
  const compact = String(raw || '').trim().toLowerCase().replace(/,/g, '');
  const match = compact.match(/^(\d+(?:\.\d+)?)(k|m)?$/);
  if (!match) return NaN;
  const multiplier = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1;
  return Math.floor(Number(match[1]) * multiplier);
}

function validateBet(raw, balance) {
  const amount = parseBetInput(raw);
  if (!Number.isFinite(amount) || amount < 1 || amount > MAX_SIMPLE_BET) {
    return { ok: false, amount, message: `Bet must be between 1 and ${MAX_SIMPLE_BET.toLocaleString('en-US')} coins.` };
  }
  if (balance < amount) {
    return { ok: false, amount, message: `You need ${amount.toLocaleString('en-US')} coins, but you only have ${Math.max(0, Math.floor(balance)).toLocaleString('en-US')}.` };
  }
  return { ok: true, amount };
}

function text(content) {
  return { type: 10, content };
}

function separator() {
  return { type: 14, divider: true, spacing: 1 };
}

function button(customId, label, style, disabled = false) {
  return { type: 2, custom_id: customId, label, style, disabled };
}

function row(...components) {
  return { type: 1, components };
}

function containerPayload(content, accent = 0xffffff, extraComponents = []) {
  return {
    flags: 32768,
    components: [{
      type: 17,
      accent_color: accent,
      components: [text(content), ...extraComponents],
    }],
  };
}

module.exports = {
  MAX_SIMPLE_BET,
  parseBetInput,
  validateBet,
  text,
  separator,
  button,
  row,
  containerPayload,
};
