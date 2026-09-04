const { errorPayload, v2Payload, WHITE } = require('../../shared/components');

const BRONZE_COIN_EMOJI = '<:CSBC:1544762628474282064>';

function formatBronzeBalance(value) {
  let amount;
  try { amount = BigInt(value ?? 0); } catch { amount = 0n; }
  if (amount < 0n) amount = 0n;
  if (amount > 1_000_000n) amount = 1_000_000n;
  if (amount === 1_000_000n) return '1m';
  if (amount < 1_000n) return amount.toString();
  const tenths = amount / 100n;
  const whole = tenths / 10n;
  const decimal = tenths % 10n;
  return decimal === 0n ? `${whole}k` : `${whole}.${decimal}k`;
}

function avatarUrl(user) {
  return user?.displayAvatarURL?.({ extension: 'png', size: 256 })
    || user?.avatarURL?.({ extension: 'png', size: 256 })
    || 'https://cdn.discordapp.com/embed/avatars/0.png';
}

function balancePayload(user, balance, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [{
      type: 9,
      components: [{
        type: 10,
        content: `### <@${user.id}>'s Balance\n\n- ${formatBronzeBalance(balance)} ${BRONZE_COIN_EMOJI}`,
      }],
      accessory: { type: 11, media: { url: avatarUrl(user) } },
    }],
  }], options);
}

function invalidTargetPayload(options = {}) {
  return errorPayload('User not found\nUse `csbalance`, a user mention, or a Discord user ID.', options);
}

function commandUnavailablePayload(options = {}) {
  return errorPayload('This game command is not enabled in this channel.', options);
}

module.exports = {
  BRONZE_COIN_EMOJI,
  balancePayload,
  commandUnavailablePayload,
  formatBronzeBalance,
  invalidTargetPayload,
};
