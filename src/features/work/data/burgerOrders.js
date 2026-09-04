const FILLINGS = Object.freeze(['ketchup', 'cucumber', 'cheese', 'mayonnaise', 'tomato', 'onion', 'mustard', 'lettuce', 'beef_patty']);

// Deliberately deterministic: this is a stable catalog, not runtime randomness.
const BURGER_ORDER_SEEDS = Object.freeze(Array.from({ length: 100 }, (_, index) => {
  const length = 3 + (index % 21);
  const order = Array.from({ length }, (_, offset) => FILLINGS[(index * 4 + offset * 5 + Math.floor(offset / 3)) % FILLINGS.length]);
  // The first three fillings encode the catalog index in base nine, proving
  // uniqueness while the remaining positions can freely contain repeats.
  order[0] = FILLINGS[index % FILLINGS.length];
  order[1] = FILLINGS[Math.floor(index / FILLINGS.length) % FILLINGS.length];
  order[2] = FILLINGS[Math.floor(index / (FILLINGS.length ** 2)) % FILLINGS.length];
  return Object.freeze(order);
}));

const OPENERS = ['Can I have', 'I would like', 'Please make me', 'Could you prepare', 'May I order'];
const STYLES = ['a burger with', 'a fresh burger containing', 'a stacked burger with', 'a custom burger using'];
const CLOSERS = ['on top', 'in that order', 'stacked just like that', 'with the first filling at the bottom', 'without changing the order'];
const BURGER_MESSAGES = Object.freeze(Array.from({ length: 100 }, (_, index) =>
  `${OPENERS[index % OPENERS.length]} ${STYLES[Math.floor(index / 5) % STYLES.length]} {fillings} ${CLOSERS[Math.floor(index / 20) % CLOSERS.length]}?`,
));

module.exports = { BURGER_MESSAGES, BURGER_ORDER_SEEDS, FILLINGS };
