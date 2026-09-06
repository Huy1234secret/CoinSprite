const BRONZE = '<:CSBC:1544762628474282064>';
const SILVER = '<:CSSCoin:1544762630877745194>';
const SILVER_VALUE = 1000000n;
// Keep one exact balance in Bronze units; denomination changes never round value.
function splitCurrency(value) {
  const total = BigInt(value);
  return { silver: total / SILVER_VALUE, bronze: total % SILVER_VALUE };
}
function formatCurrency(value) {
  const { silver, bronze } = splitCurrency(value);
  return [silver ? `${silver.toLocaleString('en-US')} ${SILVER}` : '',
    bronze || !silver ? `${bronze.toLocaleString('en-US')} ${BRONZE}` : ''].filter(Boolean).join(' · ');
}
module.exports = { BRONZE, SILVER, SILVER_VALUE, splitCurrency, formatCurrency };
