const { RNG_GAME_COMMANDS, PREFIX_COMMANDS } = require('../commands');
const { WORK_COMMANDS } = require('../../work/commands');
const { SEEDS, FALLBACK_SEED } = require('../data/seeds');
const {
  MAX_BIG_CROP_CHANCE,
  MAX_BIG_CROP_TIER,
  MAX_LUCK_MULTIPLIER,
  MAX_LUCK_TIER,
} = require('../config/upgrades');
const {
  AUTO_SELL_RARITIES,
} = require('../services/autoRollService');
const {
  MINIMUM_AUTO_ROLL_COST,
  autoRollCostPerRoll,
} = require('../services/economyService');
const {
  ROLL_COOLDOWN_MS,
  bigUpgradeCost,
  luckUpgradeCost,
  upgradeCost,
} = require('../services/gameService');
const {
  BASE_CROP_DISTRIBUTION,
  PROBABILITY_SCALE,
  RARITY_ORDER,
  bigChance,
  weightBounds,
} = require('../services/rngService');
const { STAT_RARITY_ORDER } = require('../services/statisticsService');
const {
  RPS_LOBBY_TIMEOUT_MS,
  RPS_TURN_TIMEOUT_MS,
} = require('../config/rps');
const {
  CHOOSING_TIMEOUT_MS,
} = require('../services/rpsService');
const {
  MAX_BET,
  MIN_BET,
  payoutFor,
} = require('../services/rpsRules');
const {
  EXCHANGE_SHECKLES_PER_TOKEN,
  EXCHANGE_WINDOW_LIMIT,
  EXCHANGE_WINDOW_MS,
} = require('../repositories/tokenRepository');
const { DEFAULT_CAPACITY } = require('../repositories/gameRepository');
const {
  AUTO_ROLL_INTERVAL_MS,
  AUTO_ROLL_ROLLS_PER_MINUTE,
  MAX_AUTO_ROLL_MINUTES,
  autoRollPlan,
} = require('../utils/autoRoll');
const { TOKEN_DENOMINATIONS } = require('../utils/tokens');
const { INVENTORY_PAGE_SIZE, SELL_PAGE_SIZE } = require('../components/builders');
const { INDEX_MAX_PAGE, INDEX_PAGE_SIZE } = require('../services/indexRenderer');
const { FIFTEEN_MINUTES } = require('../services/sessionStore');
const { WORK_GAMES } = require('../../work/data');
const { WORK_RANKS, boostedReward, unlockedDifficulties } = require('../../work/ranks');
const {
  WORK_STREAK_FAILURE_LIMIT,
  WORK_STREAK_MAX,
  WORK_STREAK_TIMEOUT_MS,
} = require('../../work/repositories/workRepository');
const {
  WORK_COOLDOWN_MS,
  WORK_SESSION_TTL_MS,
} = require('../../work/services/workService');

const INFO_MESSAGE_VERSION = 1;
const INFO_SELECT_CUSTOM_ID = `rng:info:topic:v${INFO_MESSAGE_VERSION}`;
const MAX_TOPIC_PAGE_LENGTH = 3_500;

const INFO_TOPICS = Object.freeze([
  { id: 'getting-started', label: 'Getting Started', description: 'Your first rolls, inventory, sales, and upgrades.', emoji: '🌱' },
  { id: 'commands', label: 'All Commands', description: 'Slash commands, prefix aliases, and restrictions.', emoji: '⌨️' },
  { id: 'rolling', label: 'Rolling and Cooldowns', description: 'Secure rolls, channels, cooldowns, and discoveries.', emoji: '🎲' },
  { id: 'crops', label: 'Crops and Rarities', description: 'Public crop facts, final chances, weight, and value.', emoji: '🥕' },
  { id: 'luck', label: 'Luck and Crop Chances', description: 'How Luck changes the final rarity distribution.', emoji: '🍀' },
  { id: 'big-crops', label: 'BIG Crops, Weight, and Value', description: 'BIG chance, multipliers, and exact crop values.', emoji: '📈' },
  { id: 'inventory', label: 'Inventory', description: 'Capacity, crop instances, filters, and pagination.', emoji: '🎒' },
  { id: 'selling', label: 'Selling and Sheckles', description: 'Selection flow, locks, balances, and sale records.', emoji: '🪙' },
  { id: 'upgrades', label: 'Upgrades', description: 'Capacity, Luck, BIG tiers, prices, and maximums.', emoji: '⬆️' },
  { id: 'auto-roll', label: 'Auto Roll', description: 'Duration, pricing, auto-sell, refunds, and summaries.', emoji: '⏱️' },
  { id: 'index', label: 'Crop Index and Discoveries', description: 'Personal discovery pages and hidden crops.', emoji: '📚' },
  { id: 'statistics', label: 'Statistics and Chance Calculator', description: 'Lifetime records and personal adjusted chances.', emoji: '📊' },
  { id: 'tokens', label: 'Tokens and Token Exchange', description: 'Exchange limits, denominations, RPS, and Work.', emoji: '🎟️' },
  { id: 'rps', label: 'G-RPS', description: 'Tables, bets, rounds, payouts, draws, and timeouts.', emoji: '✂️' },
  { id: 'work', label: 'G-Work, Ranks, and Streaks', description: 'Burger shifts, rank salary, failures, and streaks.', emoji: '🍔' },
  { id: 'tips', label: 'Progression Tips', description: 'Practical advice grounded in current game mechanics.', emoji: '🧭' },
].map(Object.freeze));

const TOPIC_BY_ID = new Map(INFO_TOPICS.map((topic) => [topic.id, topic]));

function formatInteger(value) {
  return BigInt(value).toLocaleString('en-US');
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.floor(Number(milliseconds) / 60_000);
  if (totalMinutes % (24 * 60) === 0) return `${totalMinutes / (24 * 60)} day${totalMinutes === 24 * 60 ? '' : 's'}`;
  if (totalMinutes % 60 === 0) return `${totalMinutes / 60} hour${totalMinutes === 60 ? '' : 's'}`;
  return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
}

function formatChanceUnits(units) {
  const value = BigInt(units);
  const scaled = (value * 100_000_000n) / PROBABILITY_SCALE;
  const whole = scaled / 1_000_000n;
  const fraction = String(scaled % 1_000_000n).padStart(6, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}%`;
}

function commandJson(command) {
  return command.data.toJSON();
}

function slashCommands() {
  return [...RNG_GAME_COMMANDS, ...WORK_COMMANDS].map(commandJson);
}

function prefixCommands() {
  return [...PREFIX_COMMANDS.entries()].map(([prefix, slash]) => ({ prefix, slash }));
}

function packPages(blocks) {
  const pages = [];
  let current = '';
  for (const raw of blocks.flatMap((block) => String(block).split('\n'))) {
    const line = raw || ' ';
    if (line.length > MAX_TOPIC_PAGE_LENGTH) {
      if (current) pages.push(current.trim());
      for (let offset = 0; offset < line.length; offset += MAX_TOPIC_PAGE_LENGTH) {
        pages.push(line.slice(offset, offset + MAX_TOPIC_PAGE_LENGTH));
      }
      current = '';
      continue;
    }
    const candidate = current ? `${current}\n${line}` : line;
    if (candidate.length > MAX_TOPIC_PAGE_LENGTH) {
      pages.push(current.trim());
      current = line;
    } else current = candidate;
  }
  if (current.trim()) pages.push(current.trim());
  return pages.length ? pages : ['Information is unavailable right now.'];
}

function discoveredSet(context) {
  return new Set((context.discoveries || []).map((entry) => String(entry.seedId || entry)));
}

function publicSeeds(context) {
  const discoveries = discoveredSet(context);
  return SEEDS.filter((seed) => !seed.secretUntilDiscovered || discoveries.has(seed.id));
}

function gettingStarted() {
  return [
    '**1. Roll a crop** with `/roll` in a configured game channel. Manual rolls use the shared cooldown and require free inventory space.',
    `**2. Inspect your inventory** with \`/inventory\`. Every roll is its own crop instance with a weight, stored value, rarity, BIG state, and roll time. New players start with **${DEFAULT_CAPACITY}** slots.`,
    '**3. Sell deliberately** with `/sell`. The selection is confirmed before any crops are removed, and the completed sale credits Sheckles atomically.',
    '**4. Progress** by buying inventory capacity, Luck, or BIG upgrades. Luck shifts the final rarity distribution; BIG increases the chance that a crop has four times its normal weight and value.',
    '**5. Automate later** with `/auto-roll` after checking its current per-roll price and auto-sell choices. Use `/calculate-chance` whenever you want your true personal Luck-adjusted chances.',
    '**6. Earn and use tokens** through `/exchange-token`, G-Work salary, and G-RPS. RPS wagers are risk; Work rewards accuracy and long-term rank/streak progress.',
  ];
}

function commandFacts() {
  const slash = slashCommands();
  const prefixes = prefixCommands();
  const prefixBySlash = new Map();
  for (const entry of prefixes) {
    const values = prefixBySlash.get(entry.slash) || [];
    values.push(entry.prefix);
    prefixBySlash.set(entry.slash, values);
  }
  const slashLines = slash.map((command) => {
    const aliases = prefixBySlash.get(command.name) || [];
    return `• \`/${command.name}\` — ${command.description}${aliases.length ? ` Prefix: ${aliases.map((alias) => `\`${alias}\``).join(', ')}.` : ' No prefix equivalent.'}`;
  });
  return [
    '**Registered game commands**',
    ...slashLines,
    ' ',
    '**Where commands work**',
    'Slash and prefix economy commands require the RNG feature to be owner-unlocked, enabled, and used in a configured game channel (or a post whose parent forum is configured). Cooldown-bypass roles affect only the manual roll cooldown.',
    'An active sale locks other RNG/economy commands until it is confirmed or denied. An active Auto Roll blocks manual rolling and selling. RPS and Work also enforce their own persistent active-game/shift state.',
    'Slash validation errors and private confirmations are generally ephemeral. Crop rolls, inventories, balances, Index pages, RPS tables, and Work screens use public Components V2 messages where their command flow requires it.',
  ];
}

function rollingFacts() {
  return [
    `Manual rolls share a **${ROLL_COOLDOWN_MS / 1_000}-second** cooldown between slash and prefix paths. A configured bypass role skips that timer. Failed access, a full inventory, or a sale/Auto Roll lock does not consume it.`,
    'Crop selection uses cryptographically secure integer randomness. The base crop registry is evaluated as a rarest-first cascade, converted into one exact billion-unit final distribution, then Luck smoothly shifts rarity totals while preserving relative crop weights inside each rarity.',
    'After a crop is selected, its base weight is sampled uniformly inside that crop’s configured range. Stored value increases monotonically with weight using integer arithmetic. A separate BIG check may multiply both weight and value by four.',
    'A successful roll writes the crop instance, discovery, personal statistics, and cooldown atomically. Inventory-capacity failure awards nothing. First-time crops become discoveries and refresh open Index views.',
    'Secret-marked crops stay masked until personally discovered. A configured Secret announcement is sent only after persistence and announcement delivery failure cannot undo a successful roll.',
  ];
}

function cropFacts(context) {
  const distribution = new Map(BASE_CROP_DISTRIBUTION.map((entry) => [entry.seed.id, entry.units]));
  const lines = publicSeeds(context).map((seed) => {
    const bounds = weightBounds(seed);
    const fallback = seed.fallback ? ' • guaranteed fallback after the checked sequence' : '';
    return `• ${seed.emoji || ''} **${seed.displayName}** — ${seed.rarity} • final base chance ${formatChanceUnits(distribution.get(seed.id) || 0n)} • weight ${(bounds.minimum / 100).toLocaleString()}–${(bounds.maximum / 100).toLocaleString()} kg • value ${formatInteger(seed.minimumValue)}–${formatInteger(seed.maximumValue)} Sheckles${fallback}`;
  });
  return [
    `**Progression/stat rarity order:** ${STAT_RARITY_ORDER.join(' → ')}. Luck sampling uses its source rarity order (${RARITY_ORDER.join(' → ')}) while statistics intentionally rank Secret above Super.`,
    'The chances below are final tier-zero outcomes from the complete cascade, not independent conditional checks. Luck changes rarity totals and therefore personal final chances.',
    ...lines,
    FALLBACK_SEED && !lines.some((line) => line.includes(FALLBACK_SEED.displayName))
      ? `The registry has a fallback crop that remains hidden by current discovery rules.` : '',
  ].filter(Boolean);
}

function luckFacts() {
  return [
    `Luck has tiers **0–${MAX_LUCK_TIER}**, displayed as multipliers **×1–×${MAX_LUCK_MULTIPLIER}**. Tier 0 is the exact cascading baseline; tier ${MAX_LUCK_TIER} reaches the canonical maximum rarity distribution.`,
    'The transition is a smoothstep interpolation over rarity probability units. It does not multiply every crop’s conditional check. Inside each rarity, the source crop proportions stay unchanged.',
    'The rarity distribution always totals exactly one billion units and never becomes negative. Secret behavior remains intentionally fixed by the current catalog rules rather than being exposed as a generic Luck target.',
    'Use `/calculate-chance` to compare baseline and your current Luck-adjusted result. Its web link opens the signed-in crop-chances page, where preview Luck is separate from saved Luck and undiscovered Secrets remain masked.',
  ];
}

function bigCropFacts() {
  const maximum = bigChance(MAX_BIG_CROP_TIER);
  return [
    `BIG has tiers **0–${MAX_BIG_CROP_TIER}**. Each tier adds **0.1%** BIG chance, capped at **${MAX_BIG_CROP_CHANCE * 100}%** (${maximum.numerator}/${maximum.denominator}).`,
    'The crop is selected normally first. Its base weight is sampled uniformly across the crop’s configured range and its base value is derived from that weight with exact integer interpolation.',
    'When the BIG check succeeds, final weight is **4×** the base weight and stored value is **4×** the base value. Statistics record the final multiplied weight.',
    'BIG changes expected value and therefore affects current Auto Roll pricing. It does not change which crop or rarity was selected.',
  ];
}

function inventoryFacts() {
  return [
    `New players start with **${DEFAULT_CAPACITY} inventory slots**. Every crop instance keeps its crop ID/name, rarity, weight in hundredths of a kilogram, stored integer value, BIG state, and roll timestamp.`,
    `The inventory view shows **${INVENTORY_PAGE_SIZE} crop instances per page** and supports crop-name, rarity, and minimum-weight filters. Filters combine with AND behavior. The backend view state remains authoritative across page changes.`,
    'A full inventory rejects a manual roll before RNG and cooldown consumption. During Auto Roll, selected rarities may be sold automatically to make room; if no eligible crop can be sold, the pending roll is not consumed and the remaining paid rolls are refunded.',
    `Capacity upgrades use \`1,000 + 5,000 × tier + 100 × tier²\` Sheckles. For example, the first costs **${formatInteger(upgradeCost(0))}** and the next costs **${formatInteger(upgradeCost(1))}**. Purchases recheck affordability atomically.`,
  ];
}

function sellingFacts() {
  return [
    `Run \`/sell\` to open a persistent selection flow with up to **${SELL_PAGE_SIZE} crop choices per page**. Choose individual crop instances, page through them, or filter by rarity and comma-separated crop names. Visible-page selections survive navigation because the backend selection set is authoritative.`,
    'Confirming performs one atomic sale: selected instances are removed and their stored values are credited as Sheckles. Duplicate operation replays cannot credit twice. Denying releases the sale lock without changing inventory.',
    `While a sale session is active, other RNG/economy commands and controls are blocked. Sale inactivity expires after **${formatDuration(FIFTEEN_MINUTES)}**. Auto Roll also blocks manual selling while its job is active.`,
    'Use `/balance` to view Sheckles and token value. Lifetime sale earnings, highest single completed sale, and best/highest-weight crop records remain historical even after the crop is sold.',
  ];
}

function upgradeFacts() {
  return [
    `**Inventory capacity:** each tier adds capacity and costs \`1,000 + 5,000 × tier + 100 × tier²\`. The first upgrade costs ${formatInteger(upgradeCost(0))} Sheckles.`,
    `**Luck:** maximum tier ${MAX_LUCK_TIER} (×${MAX_LUCK_MULTIPLIER}). First price: ${formatInteger(luckUpgradeCost(0))}.`,
    `**BIG:** maximum tier ${MAX_BIG_CROP_TIER}. First price: ${formatInteger(bigUpgradeCost(0))}.`,
    'For upgrade number `n`, target hours are `(50 + n³) / 1,000`. The raw price uses `720 × target hours × net expected value`; BIG applies its source `3/5` factor. The result rounds upward to the next 1,000 Sheckles and every later tier is forced to rise by at least 1,000.',
    'Every purchase is revalidated inside the database transaction and is idempotent. Maximum-tier buttons are disabled and direct maximum purchases are rejected without a deduction.',
    `Luck and BIG tiers also feed Auto Roll’s dynamic cost formula. Its price can never fall below ${formatInteger(MINIMUM_AUTO_ROLL_COST)} Sheckles per roll.`,
  ];
}

function autoRollFacts() {
  const oneMinute = autoRollPlan(1, MINIMUM_AUTO_ROLL_COST);
  return [
    `Durations accept days, hours, and minutes once each: \`50m\`, \`4h 13m\`, or \`1d\`. Minimum: **1 minute**. Maximum: **${MAX_AUTO_ROLL_MINUTES / 1_440} day**.`,
    `Jobs align to one global **${AUTO_ROLL_INTERVAL_MS / 1_000}-second** tick and plan **${AUTO_ROLL_ROLLS_PER_MINUTE} rolls per minute**. One minute plans ${oneMinute.plannedRolls} rolls.`,
    `The per-roll price is derived from current Luck/BIG expected value and is at least **${formatInteger(MINIMUM_AUTO_ROLL_COST)} Sheckles**. Total cost is planned rolls × price. The preview snapshots both tiers and the server recalculates before charging; a changed price returns a refreshed preview.`,
    `Auto-sell choices follow the source rarity order: ${AUTO_SELL_RARITIES.join(', ')}. Auto-sell runs only when room is needed. Secret remains below Super in the selector.`,
    'Only one active Auto Roll job is allowed per player, and it cannot start during a sale. While active, manual rolling and selling are locked. Each tick is leased/idempotent across processes and missed downtime ticks are not burst-replayed.',
    'Completion records a crop summary and attempts a channel notification, then DM fallback; failed notification delivery is retried on a later global tick. If inventory cannot be cleared safely or the paid duration ends before all planned ticks, unprocessed paid rolls are refunded atomically and the job stops. The current player UI has no manual cancel action.',
  ];
}

function indexFacts() {
  return [
    `The crop Index tracks personal first discoveries and renders **${INDEX_PAGE_SIZE} slots per page** across **${INDEX_MAX_PAGE} pages** from the canonical ${SEEDS.length}-slot catalog. Open views refresh when that player discovers something new.`,
    'Undiscovered entries are masked. A crop marked secret-until-discovered is omitted from public totals and details until the interacting player personally discovers it; another player’s discovery never reveals yours.',
    'Index pagination is owner-only and uses a page modal. Discovery state persists independently from inventory, so selling a crop does not erase its Index entry.',
  ];
}

function statisticsFacts() {
  return [
    '`/stat` reports total rolls, Auto Rolls, highest rarity, best crop, highest overall weight, lifetime sale earnings, and highest single sale. Per-crop roll totals and highest weights are retained historically.',
    'Best crop compares canonical rarity first, then base rarity/chance/value rules and a stable crop ID tie-breaker. Selling an item cannot remove a discovery or historical record.',
    '`/calculate-chance` compares every visible crop’s baseline chance with the player’s saved Luck tier and links to the signed-in web chance page. Preview values do not modify the player profile.',
    'Undiscovered Secrets are omitted from the profile and generic totals. A personally discovered Secret becomes visible privately while retaining its source-defined behavior.',
  ];
}

function tokenFacts() {
  return [
    `Exchange rate: **${formatInteger(EXCHANGE_SHECKLES_PER_TOKEN)} Sheckles = 1 token value**. One exchange accepts 1–${formatInteger(EXCHANGE_WINDOW_LIMIT)} token value, with at most ${formatInteger(EXCHANGE_WINDOW_LIMIT)} exchanged during a rolling ${formatDuration(EXCHANGE_WINDOW_MS)} window.`,
    `Token balances are displayed greedily with the available denominations: ${TOKEN_DENOMINATIONS.map((entry) => formatInteger(entry.value)).join(', ')}. The denominations are display units; the wallet stores total token value.`,
    'The exchange preview shows cost and affordability, then confirmation rechecks the rolling allowance and balance atomically. Insufficient funds, rate limits, and duplicate confirmations cannot partially update either wallet.',
    'G-RPS debits token stakes and pays/refunds by the round result. Successful G-Work shifts award token salary directly; Work does not award Sheckles.',
  ];
}

function rpsFacts() {
  return [
    `Run \`/g-rps\` to create one persistent table, then choose Bot or Player mode. Mode selection may remain open for ${formatDuration(CHOOSING_TIMEOUT_MS)}. A player cannot occupy multiple active tables.`,
    `Player tables support **2–4 participants**. Bets are **${formatInteger(MIN_BET)}–${formatInteger(MAX_BET)} tokens per player**. Invited players accept or decline; when every requested seat accepts, the full lobby starts automatically. The host may start early once at least two players accepted, and waiting/declined seats are removed without charge.`,
    `Lobby and turn timeouts are both **${formatDuration(RPS_LOBBY_TIMEOUT_MS)}** and **${formatDuration(RPS_TURN_TIMEOUT_MS)}** respectively. A pre-round host cancellation releases active-table locks. Expiration/cancellation refunds only stakes that were actually escrowed.`,
    'Rock beats Scissors, Scissors beats Paper, and Paper beats Rock. With 3–4 players there must be exactly two gestures and only one participant using the winning gesture; otherwise the round is a draw.',
    `A sole winner receives the complete pot: bet × participant count (for example, 10 tokens with four players pays ${formatInteger(payoutFor(10n, 4))}). Draws refund every debited stake. Bot wins retain the player stake; human wins receive the two-player pot.`,
    'Choices are committed privately in turn and the shared table message is edited through lobby, card, reveal, result, replay, cancellation, and expiration states. Finished PvP offers only Same bet or Change bet; Bot replay supports its current bet controls.',
  ];
}

function workFacts() {
  const customers = WORK_GAMES.flatMap((game) => game.customers);
  const byDifficulty = ['easy', 'medium', 'hard'].map((difficulty) => {
    const matching = customers.filter((customer) => customer.difficulty === difficulty);
    const rewards = matching.map((customer) => customer.reward);
    const unlock = WORK_RANKS.find((rank) => unlockedDifficulties(rank.level).includes(difficulty));
    return `• **${difficulty[0].toUpperCase()}${difficulty.slice(1)}** — Level ${unlock.level}+ • customer IDs ${matching[0].id}–${matching.at(-1).id} • base reward ${Math.min(...rewards)}–${Math.max(...rewards)} tokens/XP`;
  });
  const rankLines = WORK_RANKS.map((rank) => `• L${rank.level} ${rank.name} — ${rank.threshold.toLocaleString()} XP • +${rank.salaryBoost}% rank salary`);
  const customerLines = customers.map((customer) => `• #${customer.id} ${customer.difficulty} — ${customer.reward} base tokens/XP • ${customer.order.join(' → ')}`);
  return [
    `Run \`/g-work\` to open the Work home menu, check Work Stat, or start a shift. The current game is **${WORK_GAMES.map((game) => game.name).join(', ')}**. One active shift is allowed, shifts expire after **${formatDuration(WORK_SESSION_TTL_MS)}**, and resolved/canceled work starts a **${formatDuration(WORK_COOLDOWN_MS)}** cooldown.`,
    'Read the customer order and press ingredients in the exact requested bottom-to-top order. Duplicate ingredients are separate buttons. One wrong layer fails the entire shift; quitting or expiration awards no salary or XP.',
    'A completed shift awards the customer’s base reward as Work XP and token salary after rank/streak boosts. Salary uses exact integer round-half-up: `(base × (100 + boost) + 50) / 100` with integer division.',
    '**Difficulty and customer rewards**',
    ...byDifficulty,
    ' ',
    '**Customer orders (bottom to top)**',
    ...customerLines,
    ' ',
    '**Ranks**',
    ...rankLines,
    ' ',
    '**Work streak**',
    `Every completed shift increases the streak by 1, capped at **${WORK_STREAK_MAX.toLocaleString()}**. Each existing streak point adds +1% salary to the **next** shift, additive with rank salary. The combined boost is captured when the shift starts. At the cap, streak alone adds +${WORK_STREAK_MAX.toLocaleString()}%.`,
    `An active streak expires after exactly **${formatDuration(WORK_STREAK_TIMEOUT_MS)}** of inactivity and clears accumulated streak failures. A player may fail ${WORK_STREAK_FAILURE_LIMIT - 1} shifts; failure ${WORK_STREAK_FAILURE_LIMIT} breaks the streak. Successful shifts do not clear accumulated failures, ordinary failures without a streak do not build a hidden counter, and every failed shift still increases lifetime failures.`,
    `Example rounding from source: 1 base token at +50% becomes **${formatInteger(boostedReward(1, 50))}**. Work Stat shows rank progress, rank salary boost, current streak, and streak salary percentage.`,
  ];
}

function progressionTips() {
  return [
    'Start with manual rolls so you understand crop instances, inventory pressure, and sale confirmation before paying for automation.',
    `Keep capacity ahead of your rolling pace. The first capacity upgrade costs ${formatInteger(upgradeCost(0))} Sheckles, and a full manual inventory blocks the roll without consuming its cooldown.`,
    'Use filters to sell intentionally. Discovery and statistics survive a sale, but the crop instance itself does not.',
    'Luck improves the final rarity distribution; BIG leaves crop selection alone and increases the chance of 4× weight/value. Check `/calculate-chance` instead of treating conditional seed checks as final odds.',
    'Before Auto Roll, review its tier-dependent price and select only rarities you are willing to auto-sell. Shorter previews are useful when a previous duration is unaffordable.',
    'Exchange only the token value you need within the rolling limit. G-RPS can multiply a stake but can also lose it; Work provides token income without wagering.',
    `For Work, accuracy protects both the current salary opportunity and the streak. Successful shifts build rank and streak salary, but accumulated failures survive success until failure ${WORK_STREAK_FAILURE_LIMIT} breaks the active streak. Return within ${formatDuration(WORK_STREAK_TIMEOUT_MS)} to avoid inactivity reset.`,
  ];
}

const TOPIC_BUILDERS = Object.freeze({
  'getting-started': gettingStarted,
  commands: commandFacts,
  rolling: rollingFacts,
  crops: cropFacts,
  luck: luckFacts,
  'big-crops': bigCropFacts,
  inventory: inventoryFacts,
  selling: sellingFacts,
  upgrades: upgradeFacts,
  'auto-roll': autoRollFacts,
  index: indexFacts,
  statistics: statisticsFacts,
  tokens: tokenFacts,
  rps: rpsFacts,
  work: workFacts,
  tips: progressionTips,
});

function topicPages(topicId, context = {}) {
  const topic = TOPIC_BY_ID.get(String(topicId));
  const builder = TOPIC_BUILDERS[topic?.id];
  if (!topic || !builder) return null;
  return { topic, pages: packPages(builder(context)) };
}

module.exports = {
  INFO_MESSAGE_VERSION,
  INFO_SELECT_CUSTOM_ID,
  INFO_TOPICS,
  MAX_TOPIC_PAGE_LENGTH,
  TOPIC_BY_ID,
  formatChanceUnits,
  packPages,
  prefixCommands,
  publicSeeds,
  slashCommands,
  topicPages,
};
