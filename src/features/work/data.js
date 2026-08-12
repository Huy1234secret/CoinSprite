const WORK_HOME_MESSAGES = Object.freeze([
  'Ready to clock in?',
  'The shift board is open. What would you like to do?',
  'Apron on, superstar. Are you working or checking your progress?',
  'Another day, another chance to climb the ranks!',
  'Your next shift is waiting.',
  'The customers are hungry. Feeling productive?',
  'Welcome back! Let’s see what today’s shift brings.',
  'Clock in when you’re ready.',
  'The kitchen is open and your work stats are ready.',
  'Pick an action and let’s get moving!',
]);

const BURGER_GAME_MESSAGES = Object.freeze([
  'A hungry customer just walked in. Build their burger in the exact order!',
  'The grill is hot—listen carefully to the customer’s order.',
  'New order! Stack every ingredient from bottom to top.',
  'Time to serve a customer. Don’t mix up the layers!',
  'The lunch rush is here. Let’s make this burger right.',
  'One burger coming up! Follow the requested order carefully.',
  'Your customer is waiting. Start with the bottom bun!',
  'Fresh order on the board—show them your burger skills.',
]);

const WORK_INGREDIENTS = Object.freeze({
  bunbottom: '<:BunBottom:1536992816121512000>',
  beef: '<:Beef:1536992814452445184>',
  cheese: '🧀',
  cucumber: '<:Cucumber:1536992823856070766>',
  lettuce: '<:Lettuce:1536992828104773652>',
  ketchup: '<:Ketchup:1536992826074857553>',
  onion: '<:Onion:1536992830235607130>',
  buntop: '<:BunTop:1536992819036692550>',
});

const CUSTOMER_DEFINITIONS = [
  { id: 1, difficulty: 'easy', reward: 30, message: 'Just beef between the buns, please!', order: ['bunbottom', 'beef', 'buntop'] },
  { id: 2, difficulty: 'easy', reward: 30, message: 'Just cheese between the buns for me!', order: ['bunbottom', 'cheese', 'buntop'] },
  { id: 3, difficulty: 'easy', reward: 40, message: 'Beef first, then ketchup, and finish with the top bun.', order: ['bunbottom', 'beef', 'ketchup', 'buntop'] },
  { id: 4, difficulty: 'easy', reward: 40, message: 'Put cheese on the bottom, then cucumber above it.', order: ['bunbottom', 'cheese', 'cucumber', 'buntop'] },
  { id: 5, difficulty: 'easy', reward: 50, message: 'I’ll have lettuce, beef, and onion in that order.', order: ['bunbottom', 'lettuce', 'beef', 'onion', 'buntop'] },
  { id: 6, difficulty: 'easy', reward: 55, message: 'Give me beef, cheese, and another beef patty, please!', order: ['bunbottom', 'beef', 'cheese', 'beef', 'buntop'] },
  {
    id: 7, difficulty: 'medium', reward: 80,
    message: 'I’m in the mood for something savory. Start with cheese, then add beef, ketchup, and onion before closing it with the top bun.',
    order: ['bunbottom', 'cheese', 'beef', 'ketchup', 'onion', 'buntop'],
  },
  {
    id: 8, difficulty: 'medium', reward: 85,
    message: 'I’m extra hungry today, so make mine filling. Put lettuce down first, followed by two beef patties and some ketchup.',
    order: ['bunbottom', 'lettuce', 'beef', 'beef', 'ketchup', 'buntop'],
  },
  {
    id: 9, difficulty: 'medium', reward: 90,
    message: 'Could you make me something fresh but filling? Start with cucumber, then add lettuce, beef, cheese, and onion in that order.',
    order: ['bunbottom', 'cucumber', 'lettuce', 'beef', 'cheese', 'onion', 'buntop'],
  },
  {
    id: 10, difficulty: 'medium', reward: 95,
    message: 'I think I’ll go for a double burger today. Add beef first, followed by cheese, another beef patty, ketchup, and onion.',
    order: ['bunbottom', 'beef', 'cheese', 'beef', 'ketchup', 'onion', 'buntop'],
  },
  {
    id: 11, difficulty: 'medium', reward: 100,
    message: 'I’d like a little bit of everything on mine. Starting from the bottom, add cheese, cucumber, lettuce, beef, ketchup, and onion.',
    order: ['bunbottom', 'cheese', 'cucumber', 'lettuce', 'beef', 'ketchup', 'onion', 'buntop'],
  },
  {
    id: 12, difficulty: 'medium', reward: 105,
    message: 'Please make mine extra saucy and don’t hold back on the meat. Add lettuce, beef, cheese, another beef patty, and two layers of ketchup.',
    order: ['bunbottom', 'lettuce', 'beef', 'cheese', 'beef', 'ketchup', 'ketchup', 'buntop'],
  },
  {
    id: 13, difficulty: 'hard', reward: 145,
    message: 'I’ve been thinking about this burger all day, so I know exactly what I want. Start with cheese on the bottom bun, then add cucumber, lettuce, beef, ketchup, onion, and another slice of cheese. Once all of that is stacked correctly, you can add the top bun.',
    order: ['bunbottom', 'cheese', 'cucumber', 'lettuce', 'beef', 'ketchup', 'onion', 'cheese', 'buntop'],
  },
  {
    id: 14, difficulty: 'hard', reward: 145,
    message: 'I want something big today, but the order of the ingredients is really important to me. Put beef on the bottom first, followed by cheese, another beef patty, lettuce, onion, ketchup, and one more layer of onion. Finish everything with the top bun, and please don’t mix up those last few layers.',
    order: ['bunbottom', 'beef', 'cheese', 'beef', 'lettuce', 'onion', 'ketchup', 'onion', 'buntop'],
  },
  {
    id: 15, difficulty: 'hard', reward: 155,
    message: 'My friend told me your double burgers are amazing, so I’d like to try one for myself. Begin with cheese, then stack beef, another slice of cheese, another beef patty, cucumber, lettuce, ketchup, and onion. Put the top bun on only after the onion has been added.',
    order: ['bunbottom', 'cheese', 'beef', 'cheese', 'beef', 'cucumber', 'lettuce', 'ketchup', 'onion', 'buntop'],
  },
  {
    id: 16, difficulty: 'hard', reward: 155,
    message: 'I normally order something simple, but today I feel like trying a much taller burger. Starting from the bottom bun, add lettuce, cucumber, beef, cheese, another beef patty, ketchup, onion, and another layer of lettuce. After that last lettuce layer, finish it with the top bun.',
    order: ['bunbottom', 'lettuce', 'cucumber', 'beef', 'cheese', 'beef', 'ketchup', 'onion', 'lettuce', 'buntop'],
  },
  {
    id: 17, difficulty: 'hard', reward: 165,
    message: 'I’m ordering this for someone who is very particular about how their burger is stacked, so listen carefully. Start with cucumber, followed by cheese, lettuce, two beef patties, ketchup, two separate layers of onion, and one final slice of cheese. If everything is in that exact order, you can close it with the top bun.',
    order: ['bunbottom', 'cucumber', 'cheese', 'lettuce', 'beef', 'beef', 'ketchup', 'onion', 'onion', 'cheese', 'buntop'],
  },
  {
    id: 18, difficulty: 'hard', reward: 165,
    message: 'I had a long day, and a big burger with plenty of cheese and sauce would really cheer me up. Put beef on the bottom bun, then add cheese, another beef patty, another slice of cheese, cucumber, lettuce, two layers of ketchup, and onion. Finish it with the top bun, but make sure both ketchup layers are there.',
    order: ['bunbottom', 'beef', 'cheese', 'beef', 'cheese', 'cucumber', 'lettuce', 'ketchup', 'ketchup', 'onion', 'buntop'],
  },
  {
    id: 19, difficulty: 'hard', reward: 175,
    message: 'All right, this order is a little complicated, but I promise it’ll be worth it if you get every layer right. Start with cheese, then add cucumber, lettuce, beef, another slice of cheese, another beef patty, ketchup, onion, more lettuce, and another layer of ketchup. Once you’ve checked that entire stack, place the top bun on it.',
    order: ['bunbottom', 'cheese', 'cucumber', 'lettuce', 'beef', 'cheese', 'beef', 'ketchup', 'onion', 'lettuce', 'ketchup', 'buntop'],
  },
  {
    id: 20, difficulty: 'hard', reward: 175,
    message: 'I’m celebrating something special today, so I want the biggest burger you can make without changing my order. Begin with two beef patties on the bottom bun, then add cheese, cucumber, lettuce, another beef patty, ketchup, two layers of onion, and one final slice of cheese. Double-check the beef and onion layers before finishing it with the top bun.',
    order: ['bunbottom', 'beef', 'beef', 'cheese', 'cucumber', 'lettuce', 'beef', 'ketchup', 'onion', 'onion', 'cheese', 'buntop'],
  },
];

const VALID_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

function validateCustomers(customers) {
  const ids = new Set();
  for (const customer of customers) {
    if (!Number.isInteger(customer.id) || ids.has(customer.id)) throw new Error('Work customer IDs must be unique integers.');
    ids.add(customer.id);
    if (!Number.isInteger(customer.reward) || customer.reward <= 0) throw new Error(`Customer ${customer.id} has an invalid reward.`);
    if (!VALID_DIFFICULTIES.has(customer.difficulty)) throw new Error(`Customer ${customer.id} has an invalid difficulty.`);
    if (customer.order[0] !== 'bunbottom' || customer.order.at(-1) !== 'buntop') {
      throw new Error(`Customer ${customer.id} must start and end with buns.`);
    }
    for (const ingredient of customer.order) {
      if (!WORK_INGREDIENTS[ingredient]) throw new Error(`Customer ${customer.id} uses unknown ingredient ${ingredient}.`);
    }
  }
}

validateCustomers(CUSTOMER_DEFINITIONS);

const BURGER_CUSTOMERS = Object.freeze(CUSTOMER_DEFINITIONS.map((customer) => Object.freeze({
  ...customer,
  order: Object.freeze([...customer.order]),
})));

const WORK_GAMES = Object.freeze([Object.freeze({
  id: 'burger-service',
  name: 'Burger Service',
  customers: BURGER_CUSTOMERS,
  messages: BURGER_GAME_MESSAGES,
})]);

module.exports = {
  BURGER_CUSTOMERS,
  BURGER_GAME_MESSAGES,
  WORK_GAMES,
  WORK_HOME_MESSAGES,
  WORK_INGREDIENTS,
  validateCustomers,
};
