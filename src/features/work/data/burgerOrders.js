const FILLINGS = Object.freeze(['ketchup', 'cucumber', 'cheese', 'mayonnaise', 'tomato', 'onion', 'mustard', 'lettuce']);

// Deliberately deterministic: this is a stable catalog, not runtime randomness.
const BURGER_ORDER_SEEDS = Object.freeze(Array.from({ length: 100 }, (_, index) => {
  const length = 3 + (index % 21);
  const order = Array.from({ length }, (_, offset) => FILLINGS[(index * 3 + offset * 5) % FILLINGS.length]);
  if (index < 25) order[Math.min(2, order.length - 1)] = order[Math.min(1, order.length - 1)];
  return Object.freeze(order);
}));

const OPENERS = ['A customer ordered', 'Please prepare', 'The next ticket requests', 'The counter needs', 'Build'];
const STYLES = ['a neat stack of', 'a burger layered with', 'a fresh order containing', 'a custom burger using'];
const CLOSERS = ['from bottom to top', 'in exactly this bottom-to-top order', 'stacked upward in this order', 'with the first filling nearest the bottom bun', 'without changing the sequence'];
const BURGER_MESSAGES = Object.freeze(Array.from({ length: 100 }, (_, index) =>
  `${OPENERS[index % OPENERS.length]} ${STYLES[Math.floor(index / 5) % STYLES.length]} {fillings}, ${CLOSERS[Math.floor(index / 20) % CLOSERS.length]}.`,
));

module.exports = { BURGER_MESSAGES, BURGER_ORDER_SEEDS, FILLINGS };
