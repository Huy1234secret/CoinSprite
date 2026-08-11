const { formatInteger } = require('../../shared/format');

const FARMING_CURRENCY_EMOJI = '<:CRcoin:1536641284507443222>';

function formatFarmingCurrency(value) {
  return `${formatInteger(value)} ${FARMING_CURRENCY_EMOJI}`;
}

module.exports = {
  FARMING_CURRENCY_EMOJI,
  formatFarmingCurrency,
};
