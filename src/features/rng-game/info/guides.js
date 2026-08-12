const {
  MAX_BIG_CROP_CHANCE,
  MAX_BIG_CROP_TIER,
  MAX_LUCK_MULTIPLIER,
  MAX_LUCK_TIER,
} = require('../config/upgrades');
const { INVENTORY_PAGE_SIZE, SELL_PAGE_SIZE } = require('../config/interface');
const {
  ROLL_COOLDOWN_MS,
  bigUpgradeCost,
  luckUpgradeCost,
  upgradeCost,
} = require('../services/gameService');
const { DEFAULT_CAPACITY } = require('../repositories/gameRepository');
const { AUTO_SELL_RARITIES } = require('../services/autoRollService');
const { MINIMUM_AUTO_ROLL_COST } = require('../services/economyService');
const {
  AUTO_ROLL_INTERVAL_MS,
  AUTO_ROLL_ROLLS_PER_MINUTE,
  MAX_AUTO_ROLL_MINUTES,
  autoRollPlan,
} = require('../utils/autoRoll');
const {
  EXCHANGE_SHECKLES_PER_TOKEN,
  EXCHANGE_WINDOW_LIMIT,
  EXCHANGE_WINDOW_MS,
} = require('../repositories/tokenRepository');
const { TOKEN_DENOMINATIONS } = require('../utils/tokens');
const { INDEX_MAX_PAGE, INDEX_PAGE_SIZE } = require('../services/indexRenderer');
const { FIFTEEN_MINUTES } = require('../services/sessionStore');
const { RARITY_ORDER } = require('../services/rngService');
const { STAT_RARITY_ORDER } = require('../services/statisticsService');
const {
  RPS_LOBBY_TIMEOUT_MS,
  RPS_TURN_TIMEOUT_MS,
} = require('../config/rps');
const { CHOOSING_TIMEOUT_MS } = require('../services/rpsService');
const { MAX_BET, MIN_BET, payoutFor } = require('../services/rpsRules');
const { WORK_RANKS, unlockedDifficulties } = require('../../work/ranks');
const {
  WORK_STREAK_FAILURE_LIMIT,
  WORK_STREAK_MAX,
  WORK_STREAK_TIMEOUT_MS,
} = require('../../work/repositories/workRepository');
const {
  WORK_COOLDOWN_MS,
  WORK_SESSION_TTL_MS,
} = require('../../work/config');

function integer(value) {
  return BigInt(value).toLocaleString('en-US');
}

function duration(milliseconds) {
  const totalMinutes = Math.floor(Number(milliseconds) / 60_000);
  if (totalMinutes % 1_440 === 0) return `${totalMinutes / 1_440} day${totalMinutes === 1_440 ? '' : 's'}`;
  if (totalMinutes % 60 === 0) return `${totalMinutes / 60} hour${totalMinutes === 60 ? '' : 's'}`;
  return `${totalMinutes} minute${totalMinutes === 1 ? '' : 's'}`;
}

function guide(definition) {
  return Object.freeze({
    controls: Object.freeze(definition.controls || []),
    requirements: Object.freeze(definition.requirements || []),
    steps: Object.freeze(definition.steps || []),
    mechanics: Object.freeze(definition.mechanics || []),
    results: Object.freeze(definition.results || []),
    interactions: Object.freeze(definition.interactions || []),
    restrictions: Object.freeze(definition.restrictions || []),
    failures: Object.freeze(definition.failures || []),
    examples: Object.freeze(definition.examples || []),
    tips: Object.freeze(definition.tips || []),
    warnings: Object.freeze(definition.warnings || []),
    ...definition,
  });
}

const oneMinuteAutoRoll = autoRollPlan(1, MINIMUM_AUTO_ROLL_COST);
const mediumUnlock = WORK_RANKS.find((rank) => unlockedDifficulties(rank.level).includes('medium'))?.level;
const hardUnlock = WORK_RANKS.find((rank) => unlockedDifficulties(rank.level).includes('hard'))?.level;

const COMMAND_GUIDES = Object.freeze({
  roll: guide({
    category: 'Core Game',
    fallbackEmoji: '🎲',
    configuredEmoji: process.env.RNG_INFO_ROLL_EMOJI,
    purpose: 'Roll one crop using your current Luck and BIG tiers and store the unique result.',
    requirements: [
      'At least one free inventory slot.',
      'No active sale and no active Auto Roll job.',
      `The shared manual-roll cooldown must be ready. The normal cooldown is \`${ROLL_COOLDOWN_MS / 1_000} seconds\`.`,
    ],
    steps: [
      'The bot checks feature/channel access, conflicting sale or Auto Roll state, inventory capacity, and cooldown.',
      'It selects a crop from the Luck-adjusted rarity distribution, rolls a weight, calculates stored value, and checks BIG chance.',
      'The crop instance is saved to inventory; discovery, lifetime roll statistics, and the next cooldown are saved with it.',
      'The result shows crop name, rarity, effective chance, and final weight. Open [[inventory]] to inspect or manage it.',
    ],
    mechanics: [
      `**Cooldown:** \`${ROLL_COOLDOWN_MS / 1_000} seconds\` after a successful manual roll. A rejected roll does not consume it. Slash and prefix rolls share the same timer.`,
      `**Rarity:** source order is ${RARITY_ORDER.join(' → ')}. Luck shifts final rarity totals while preserving crop proportions within each rarity.`,
      `**Luck:** tiers \`0–${MAX_LUCK_TIER}\` display as \`×1–×${MAX_LUCK_MULTIPLIER}\`. Secret behavior is not increased by Luck.`,
      `**BIG:** each BIG tier adds \`0.1%\`, up to \`${MAX_BIG_CROP_CHANCE * 100}%\` at tier \`${MAX_BIG_CROP_TIER}\`. A BIG crop has \`4×\` its sampled base weight and stored value.`,
      'Crop value rises with the sampled weight. Each roll creates a separate inventory instance even when the crop name repeats.',
    ],
    results: [
      'Success adds exactly one crop instance and may add a first-time discovery.',
      'Lifetime total rolls, per-crop rolls, and highest-weight records update only after a successful persisted roll.',
      'Undiscovered secret crops stay masked in player-facing indexes and chance pages until personally discovered.',
    ],
    interactions: [
      '[[inventory]] shows the stored instance; [[sell]] converts selected instances to Sheckles.',
      '[[upgrade]] changes future Luck/BIG rolls, while an inventory capacity upgrade is available inside [[inventory]].',
      '[[calculate-chance]] compares base chances with the player’s saved Luck tier. [[stat]] shows historical roll records.',
    ],
    restrictions: [
      'A full inventory, active sale, active Auto Roll, or active cooldown prevents the roll.',
      'Auto Roll uses the same crop pipeline but its own paid schedule and does not use the manual cooldown.',
    ],
    failures: [
      '**Inventory full** — sell crops or buy capacity from [[inventory]].',
      '**Cooldown active** — wait for the remaining time and retry.',
      '**Sale or Auto Roll active** — finish the conflicting action before manual rolling.',
      '**Command unavailable** — use a configured RNG channel after the server enables the feature.',
    ],
    examples: [
      '**Slash roll:** [[roll]]',
      '**Inspect the result:** [[roll]] → [[inventory]]',
      '**Progression loop:** [[roll]] → [[sell]] → [[upgrade]]',
    ],
    tips: ['A failed access, capacity, conflict, or cooldown check does not spend the roll cooldown.'],
  }),

  inventory: guide({
    category: 'Core Game',
    fallbackEmoji: '🎒',
    configuredEmoji: process.env.RNG_INFO_INVENTORY_EMOJI,
    purpose: 'View crop instances, total value, capacity, filters, pages, and capacity upgrades.',
    controls: [
      `**Pages:** \`${INVENTORY_PAGE_SIZE}\` crop instances per page; the Page button accepts an integer from \`1\` to the current maximum.`,
      '**Name filter:** optional partial crop name, up to `80` characters.',
      '**Weight filter:** optional decimal minimum weight; matching crops are greater than or equal to it. Values above `10,000 kg` are rejected.',
      '**Rarity filter:** optional single rarity currently present in the inventory.',
      '**Upgrade:** opens an owner-only capacity purchase confirmation.',
    ],
    requirements: ['No active sale. Empty inventories are allowed and show an empty state.'],
    steps: [
      'The bot loads your current player record and crop instances.',
      'It shows used capacity, total stored value, and the newest crop instances first.',
      'Page and filter controls update the same view; name, minimum weight, and rarity filters combine with AND behavior.',
      'The Upgrade control previews the exact capacity cost and requires a separate confirmation.',
    ],
    mechanics: [
      `New players start with \`${DEFAULT_CAPACITY}\` slots. Each capacity purchase adds \`10\` slots.`,
      `Capacity upgrade cost at level \`t\` is \`1,000 + 5,000 × t + 100 × t²\` Sheckles. The first costs \`${integer(upgradeCost(0))}\`; the second costs \`${integer(upgradeCost(1))}\`.`,
      `Inventory controls expire after \`${duration(FIFTEEN_MINUTES)}\` of inactivity; using a valid control refreshes its lifetime.`,
      'Every instance retains crop, rarity, weight, stored value, BIG state, and roll time. Filters never modify stored crops.',
    ],
    results: [
      'The view reports current count/capacity and total stored value, then lists matching instances with weight and rarity.',
      'A confirmed capacity upgrade deducts Sheckles atomically and refreshes the original inventory view.',
    ],
    interactions: [
      '[[roll]] and Auto Roll add crop instances. [[sell]] and Auto Sell remove instances and credit Sheckles.',
      'Selling does not erase discovery or historical statistics.',
    ],
    restrictions: [
      'Only the command invoker can use the view controls.',
      'A sale session blocks inventory commands and other RNG/economy controls until it ends.',
    ],
    failures: [
      '**Expired controls** — rerun [[inventory]].',
      '**Invalid page** — enter a whole number inside the displayed page range.',
      '**Invalid weight or rarity** — use a supported decimal weight and a rarity shown in the form.',
      '**Not enough Sheckles** — sell crops, then reopen the capacity confirmation.',
    ],
    examples: [
      '**Open inventory:** [[inventory]]',
      '**Find heavier crops:** open Filter, enter a minimum weight, and optionally choose a rarity.',
      '**Make room:** [[inventory]] → capacity Upgrade, or [[sell]] selected crops.',
    ],
    tips: ['Use combined filters before a sale; a full inventory blocks manual rolling without consuming its cooldown.'],
  }),

  sell: guide({
    category: 'Core Game',
    fallbackEmoji: '🪙',
    configuredEmoji: process.env.RNG_INFO_SELL_EMOJI,
    purpose: 'Select exact crop instances, review their combined value, and sell them for Sheckles.',
    controls: [
      `**Crop selector:** up to \`${SELL_PAGE_SIZE}\` visible instances per page; selections survive page changes.`,
      '**Sell filter:** choose one or more present rarities, enter comma-separated crop names, or combine both. At least one filter is required.',
      '**Deny:** cancels without changing inventory. **Sell:** confirms the currently selected instances.',
    ],
    requirements: ['At least one crop in inventory.', 'No active Auto Roll and no other active sale session.'],
    steps: [
      'The bot creates one owner-only sale session and locks other RNG/economy commands for that player.',
      'You select individual instances or use filters to select matching crops, then review count and total stored value.',
      'Deny releases the lock unchanged. Sell rechecks every selected instance and removes them in one atomic sale.',
      'The exact stored-value sum is credited to your Sheckle balance and historical sale statistics are updated.',
    ],
    mechanics: [
      'There is no sale fee or tax; proceeds equal the selected instances’ stored values.',
      'Rarity and crop-name filters combine with AND behavior. Names accept spaces, hyphens, underscores, and equivalent normalized forms.',
      `Inactive sale sessions expire after \`${duration(FIFTEEN_MINUTES)}\` and release the lock.`,
      'Duplicate confirmation cannot credit the same sale twice.',
    ],
    results: ['Success removes the selected instances, credits Sheckles, and reports sold count and total.', 'Discoveries and lifetime roll/weight records remain after a crop is sold.'],
    interactions: ['[[balance]] shows the new Sheckle balance. [[inventory]] shows the remaining crops.', 'An active sale blocks all other RNG/economy commands and controls; it does not block the separate Work interface.'],
    restrictions: ['Only the sale owner can select, filter, cancel, or confirm.', 'Manual selling cannot start while Auto Roll is active.'],
    failures: [
      '**Inventory empty** — use [[roll]] first.',
      '**No crops selected** — choose at least one visible instance.',
      '**Unknown crop/filter** — use current rarity choices and valid comma-separated crop names.',
      '**Sale changed or expired** — rerun [[sell]] and make a fresh selection.',
    ],
    examples: ['**Open picker:** [[sell]]', '**Target a group:** use Sell filter with rarities, crop names, or both.', '**Verify proceeds:** [[sell]] → [[balance]]'],
    warnings: ['Confirming permanently removes the selected crop instances. Review the total before pressing Sell.'],
  }),

  balance: guide({
    category: 'Core Game',
    fallbackEmoji: '💰',
    configuredEmoji: process.env.RNG_INFO_BALANCE_EMOJI,
    purpose: 'Show your current Sheckle balance and token wallet value.',
    requirements: ['No active sale. A new player record is created automatically when needed.'],
    steps: ['The bot loads your wallet.', 'It shows Sheckles and, when nonzero, a denomination breakdown plus total token value.'],
    mechanics: [`Token display uses denominations ${TOKEN_DENOMINATIONS.map((entry) => integer(entry.value)).join(', ')} from largest to smallest; the wallet stores one total token value.`],
    results: ['This command is read-only and never spends or moves currency.'],
    interactions: ['[[sell]] and Auto Sell add Sheckles. [[upgrade]], [[auto-roll]], and [[exchange-token]] spend Sheckles.', '[[g-rps]] spends or pays tokens. Successful Work shifts can add tokens.'],
    restrictions: ['An active sale blocks the command; an active Auto Roll does not.'],
    failures: ['**Command unavailable** — use an enabled, configured RNG channel.', '**Sale active** — finish or deny it first.'],
    examples: ['**Check wallet:** [[balance]]', '**After selling:** [[sell]] → [[balance]]', '**Before exchanging:** [[balance]] → [[exchange-token]]'],
    tips: ['Check both currencies before confirming a paid job, upgrade, exchange, or wager.'],
  }),

  'auto-roll': guide({
    category: 'Progression',
    fallbackEmoji: '⏱️',
    configuredEmoji: process.env.RNG_INFO_AUTO_ROLL_EMOJI,
    purpose: 'Purchase a scheduled series of automatic rolls that continues while you are away.',
    controls: [
      '**Duration:** required text using days, hours, and minutes once each, such as `50m`, `4h 13m`, or `1d`.',
      `**Auto Sell rarity:** optional multi-select from ${AUTO_SELL_RARITIES.join(', ')}. Empty means no automatic selling.`,
      '**Preview:** shows normalized duration, exact price per roll, total cost, and selected Auto Sell rarities before purchase.',
      '**Change duration:** reopens the form with prior values. **Start:** confirms the current price snapshot.',
    ],
    requirements: ['Enough Sheckles for the full previewed plan.', 'No active Auto Roll and no active sale.'],
    steps: [
      'Open the form, enter duration, and optionally choose rarities eligible for Auto Sell.',
      'The bot validates duration, snapshots current Luck/BIG tiers, and calculates the exact plan and price.',
      'Review or change the preview. On Start, tiers, price, balance, and conflicts are checked again before one full charge.',
      `The job begins on the next global \`${AUTO_ROLL_INTERVAL_MS / 1_000}-second\` boundary and processes one paid roll per tick.`,
      'Results are stored in inventory; completion sends a crop summary to the original channel or by DM fallback.',
    ],
    mechanics: [
      `**Duration:** minimum \`1 minute\`, maximum \`${MAX_AUTO_ROLL_MINUTES / 1_440} day\`; each unit may appear once.`,
      `**Schedule:** \`${AUTO_ROLL_ROLLS_PER_MINUTE}\` rolls per minute. One minute plans \`${oneMinuteAutoRoll.plannedRolls}\` rolls. Missed downtime ticks are not replayed in a burst.`,
      `**Price:** current Luck/BIG expected value determines each roll’s price, with a minimum of \`${integer(MINIMUM_AUTO_ROLL_COST)}\` Sheckles. The calculation is \`max(5, ceil((gross expected crop value − 30) / 4))\`. Total cost is planned rolls × price.`,
      'The tier/price snapshot must still match at confirmation; a change produces a refreshed preview instead of charging.',
      'When inventory is full, every owned crop in a selected Auto Sell rarity is sold to make room. Auto Sell runs only when space is needed.',
    ],
    results: [
      'Each completed tick stores one normal crop instance, discovery, and Auto Roll statistic, and the final summary groups results by crop.',
      'Auto-sold crops credit their exact stored values and update sale statistics.',
      'If the job cannot make space or the paid duration ends before all planned rolls, every unprocessed paid roll is refunded at the snapshot price.',
    ],
    interactions: ['Manual [[roll]] and [[sell]] are locked while the job is active. [[inventory]], [[balance]], [[upgrade]], [[stat]], and [[calculate-chance]] remain available.', 'Luck/BIG upgrades after purchase affect crops processed later, while the paid per-roll price remains the purchased snapshot.'],
    restrictions: ['Only one active Auto Roll per player. The current player UI has no manual cancel button.', 'The scheduler continues without the player remaining online.'],
    failures: [
      '**Invalid duration** — use `d`, `h`, and `m` once each within `1m–1d`.',
      '**Not enough Sheckles** — shorten the duration or earn more, then preview again.',
      '**Price changed** — review the refreshed preview; no stale price is charged.',
      '**Sale/Auto Roll active** — finish the existing action first.',
      '**Inventory full with no eligible Auto Sell crop** — the job stops and refunds unprocessed rolls.',
    ],
    examples: ['**Open configuration:** [[auto-roll]]', '**Valid durations:** `50m`, `4h 13m`, `1d`', '**Review results:** [[auto-roll]] → [[inventory]] → [[stat]]'],
    warnings: ['The full plan is charged at Start. Select only rarities you are willing to have sold automatically.'],
    tips: ['Use Change duration when the preview is unaffordable; no Sheckles are spent until Start succeeds.'],
  }),

  upgrade: guide({
    category: 'Progression',
    fallbackEmoji: '⬆️',
    configuredEmoji: process.env.RNG_INFO_UPGRADE_EMOJI,
    purpose: 'View and purchase permanent Luck or BIG crop tiers.',
    controls: ['One purchase button is shown for the next Luck tier and one for the next BIG tier; each displays its exact Sheckle price.', 'At maximum tier, that upgrade shows `MAX` and is disabled.'],
    requirements: ['Enough Sheckles for the chosen next tier.', 'No active sale.'],
    steps: ['The bot loads current tiers and computes both next prices.', 'Choose one affordable button.', 'The transaction rechecks tier and balance, deducts the exact cost once, and refreshes both controls.'],
    mechanics: [
      `**Luck:** tiers \`0–${MAX_LUCK_TIER}\`, displayed as \`×1–×${MAX_LUCK_MULTIPLIER}\`. First price: \`${integer(luckUpgradeCost(0))}\` Sheckles. Luck changes final rarity totals but not proportions within a rarity.`,
      `**BIG:** tiers \`0–${MAX_BIG_CROP_TIER}\`, \`0.1%\` chance per tier, maximum \`${MAX_BIG_CROP_CHANCE * 100}%\`. First price: \`${integer(bigUpgradeCost(0))}\` Sheckles. BIG multiplies final crop weight and value by \`4×\`.`,
      '**Price curve:** for upgrade number `n`, target hours are `(50 + n³) / 1,000`; raw price uses `720 × target hours × net expected value`, with a `3/5` factor for BIG. Prices round up to `1,000` and rise by at least `1,000` per tier.',
      `Luck/BIG tiers also affect the price of future [[auto-roll]] previews, whose per-roll minimum is \`${integer(MINIMUM_AUTO_ROLL_COST)}\` Sheckles.`,
    ],
    results: ['A successful purchase permanently increases exactly one tier and leaves the other unchanged.', 'The new tier affects future rolls. An already purchased Auto Roll keeps its price snapshot but processes using current tiers.'],
    interactions: ['[[roll]] uses both tiers. [[calculate-chance]] shows Luck’s crop-level effect.', 'Inventory capacity is a separate +10 upgrade opened from [[inventory]].'],
    restrictions: ['Tiers cannot exceed their configured maximums. Duplicate or stale button activation cannot deduct twice.'],
    failures: ['**Not enough Sheckles** — sell crops and reopen [[upgrade]].', '**Maximum tier** — no further purchase is available.', '**Expired control** — rerun [[upgrade]].'],
    examples: ['**View prices:** [[upgrade]]', '**Fund a purchase:** [[sell]] → [[balance]] → [[upgrade]]', '**Inspect Luck effect:** [[upgrade]] → [[calculate-chance]]'],
    warnings: ['Purchases spend Sheckles immediately and have no refund action.'],
  }),

  index: guide({
    category: 'Progression',
    fallbackEmoji: '📚',
    configuredEmoji: process.env.RNG_INFO_INDEX_EMOJI,
    purpose: 'View your persistent personal crop discoveries as rendered index pages.',
    controls: [`The Page control accepts a whole number from \`1\` to \`${INDEX_MAX_PAGE}\`.`],
    requirements: ['No active sale. No discovery is required; undiscovered slots are masked.'],
    steps: ['The bot loads your discovery IDs.', 'It renders the selected page as an image.', 'The owner-only page modal replaces the same message with another rendered page.'],
    mechanics: [`The canonical index uses \`${INDEX_PAGE_SIZE}\` slots per page across \`${INDEX_MAX_PAGE}\` pages.`, `Index controls expire after \`${duration(FIFTEEN_MINUTES)}\` of inactivity.`, 'Discoveries are permanent and independent from inventory ownership. Secret entries remain absent or masked until personally discovered.'],
    results: ['The page shows personal discovery count and masked/revealed crop cards.', 'An open index view refreshes when that same player discovers a new crop.'],
    interactions: ['Successful [[roll]] and Auto Roll results can add discoveries.', '[[sell]] never removes index progress. [[stat]] also uses persisted discoveries.'],
    restrictions: ['Only the command invoker can navigate the index.', 'Another player’s discovery never reveals yours.'],
    failures: ['**Invalid page** — enter a page inside the displayed range.', '**Expired controls** — rerun [[index]].', '**Render unavailable** — retry the command; discovery data remains safe.'],
    examples: ['**Open index:** [[index]]', '**Discover and revisit:** [[roll]] → [[index]]', '**Compare progress:** [[index]] → [[stat]]'],
    tips: ['Selling duplicates is safe for discovery progress.'],
  }),

  stat: guide({
    category: 'Progression',
    fallbackEmoji: '📊',
    configuredEmoji: process.env.RNG_INFO_STAT_EMOJI,
    purpose: 'Show persistent lifetime rolling and selling records.',
    requirements: ['No active sale. A new player may view a complete zero-value state.'],
    steps: ['The bot loads aggregate roll/sale records, per-crop weight records, and personal discoveries.', 'It ranks the best discovered crop and shows the resulting summary.'],
    mechanics: [`Highest rarity follows ${STAT_RARITY_ORDER.join(' → ')}.`, 'Best crop compares rarity first, then base chance, average configured value, and a stable crop-ID tie-breaker.', 'Highest weights, roll counts, and sale earnings are historical; selling an instance cannot lower them.'],
    results: ['Shows total rolls, Auto Rolls, highest rarity, best crop and its highest weight, overall highest weight, lifetime sale earnings, and highest single sale.', 'The command is read-only.'],
    interactions: ['[[roll]] and Auto Roll update roll/weight records. [[sell]] and Auto Sell update sale records.', '[[index]] shows discovery cards; [[calculate-chance]] shows current probability instead of history.'],
    restrictions: ['An active Auto Roll does not block statistics. An active sale does.'],
    failures: ['**Command unavailable** — use a configured RNG channel.', '**Sale active** — finish it before opening statistics.'],
    examples: ['**View records:** [[stat]]', '**After automation:** [[auto-roll]] → [[stat]]', '**Compare history and chances:** [[stat]] → [[calculate-chance]]'],
    tips: ['Statistics preserve achievements even after the underlying crop instance is sold.'],
  }),

  'calculate-chance': guide({
    category: 'Progression',
    fallbackEmoji: '🍀',
    configuredEmoji: process.env.RNG_INFO_CHANCE_EMOJI,
    purpose: 'Compare base crop probabilities with probabilities from your saved Luck tier.',
    requirements: ['No active sale. The linked page requires the same signed-in player session.'],
    steps: ['The bot loads your Luck tier and personal discoveries.', 'It prepares a safe profile containing visible crop comparisons.', 'The response shows tier/discovery totals and a button to the detailed chances page.'],
    mechanics: [`Saved Luck tier \`0–${MAX_LUCK_TIER}\` corresponds to multiplier \`×1–×${MAX_LUCK_MULTIPLIER}\`.`, 'Luck changes rarity totals through the canonical interpolation and preserves relative crop weights within a rarity.', 'The comparison reports both percentage and one-in-N forms. Preview Luck on the web page does not modify the saved tier.', 'Undiscovered secret crops are omitted; discovered Secret chances are shown but are not changed by Luck.'],
    results: ['The Discord response is read-only and links to the crop-by-crop comparison.', 'No roll, currency, cooldown, inventory, or upgrade state is changed.'],
    interactions: ['[[upgrade]] changes the saved Luck tier. [[roll]] uses the resulting distribution.', '[[index]] records discoveries that determine which protected entries may be visible.'],
    restrictions: ['The command does not accept a Luck argument; web preview values are temporary and must be positive whole-number multipliers.'],
    failures: ['**Not signed in on the web page** — sign in with Discord, then reopen the link.', '**Protected crop hidden** — discover it personally before it can appear.', '**Command unavailable or sale active** — meet the normal RNG access/state rules.'],
    examples: ['**Open comparison:** [[calculate-chance]]', '**Upgrade then compare:** [[upgrade]] → [[calculate-chance]]', '**Use the result:** [[calculate-chance]] → [[roll]]'],
    tips: ['Use this comparison instead of treating individual source checks as final crop odds.'],
  }),

  'exchange-token': guide({
    category: 'Tokens & Activities',
    fallbackEmoji: '🎟️',
    configuredEmoji: process.env.RNG_INFO_TOKEN_EMOJI,
    purpose: 'Exchange Sheckles for RPS token value after an explicit confirmation.',
    requirements: [`Argument \`amount-token\` must be a whole number from \`1\` to \`${integer(EXCHANGE_WINDOW_LIMIT)}\`.`, 'Enough Sheckles and enough remaining rolling-window allowance.', 'No active sale.'],
    steps: ['The bot checks the requested amount against the current rolling allowance.', 'It calculates cost and shows the token denomination breakdown in a confirmation.', 'On Exchange, amount, allowance, and balance are checked again atomically.', 'Sheckles are deducted and token value is credited exactly once.'],
    mechanics: [`**Rate:** \`${integer(EXCHANGE_SHECKLES_PER_TOKEN)} Sheckles = 1 token value\`.`, `**Limit:** at most \`${integer(EXCHANGE_WINDOW_LIMIT)}\` token value exchanged during a rolling \`${duration(EXCHANGE_WINDOW_MS)}\` window.`, 'The window is based on prior successful exchanges, not a fixed daily reset.', 'There is no reverse token-to-Sheckle exchange in this command.'],
    results: ['Success reports received token value, spent Sheckles, denomination breakdown, and remaining four-hour allowance.', 'A failed or duplicate confirmation cannot partially change either wallet.'],
    interactions: ['[[balance]] shows both wallets. [[g-rps]] uses tokens for wagers.', 'Successful Work shifts can earn tokens without spending Sheckles.'],
    restrictions: ['Slash-only; there is no prefix equivalent.', 'The amount cannot exceed either `100` in one request or the smaller remaining rolling allowance.'],
    failures: ['**Invalid amount** — choose a whole number in the command’s displayed range.', '**Allowance too small** — wait for older exchanges to leave the rolling window or request less.', '**Insufficient Sheckles** — sell crops and try again.', '**Expired confirmation** — rerun the slash command.'],
    examples: ['**Exchange one:** [[exchange-token]] with `amount-token:1`', '**Exchange ten:** [[exchange-token]] with `amount-token:10`', '**Plan a wager:** [[balance]] → [[exchange-token]] with `amount-token:25` → [[g-rps]]'],
    warnings: ['The exchange is one-way and spends Sheckles when confirmed.'],
  }),

  'g-rps': guide({
    category: 'Tokens & Activities',
    fallbackEmoji: '✂️',
    configuredEmoji: process.env.RNG_INFO_RPS_EMOJI,
    purpose: 'Play persistent Rock-Paper-Scissors rounds against the bot or invited players using token wagers.',
    controls: ['Choose **Bot** or **Player** mode.', 'Player mode selects `1–3` unique non-bot opponents, producing a `2–4` player table.', `Bet modals accept whole token values from \`${integer(MIN_BET)}\` to \`${integer(MAX_BET)}\`.`, 'Lobby controls allow accept, decline, propose a higher bet, host early-start after two accepts, or host cancel.', 'Round controls accept Rock, Paper, or Scissors in turn; results support same/change bet replay, with `×2`, `×4`, and `×10` shortcuts in Bot mode.'],
    requirements: ['Enough token value for the wager.', 'No other active RPS table for any participant.', 'No active sale for the command invoker.'],
    steps: ['The host chooses mode, opponents when applicable, and a valid bet.', 'Bot mode escrows the host stake immediately. Player mode waits for invitations and debits all accepted stakes atomically when the round starts.', 'Players commit one card in turn. Once all cards are locked, a participant reveals the shared result.', 'The result pays a sole winner or refunds a draw; replay creates another valid round.'],
    mechanics: [`**Mode selection timeout:** \`${duration(CHOOSING_TIMEOUT_MS)}\`. **Lobby timeout:** \`${duration(RPS_LOBBY_TIMEOUT_MS)}\`. **Turn timeout:** \`${duration(RPS_TURN_TIMEOUT_MS)}\`.`, 'Rock beats Scissors, Scissors beats Paper, and Paper beats Rock.', 'For 3–4 players, there must be exactly two gestures and exactly one player using the winning gesture; otherwise the round is a draw.', `A sole winner receives the complete pot. Example: \`10\` tokens × \`4\` players pays \`${integer(payoutFor(10n, 4))}\`. Draws refund every escrowed stake.`, 'Bot wins retain the human stake; human Bot-mode wins receive the two-player pot.'],
    results: ['The public table moves through lobby, card, reveal, result, replay, canceled, or expired states.', 'Cancel/expiration refunds only stakes actually escrowed, exactly once. A render failure leaves game state and tokens safe and offers Retry image.'],
    interactions: ['[[balance]] shows tokens. [[exchange-token]] buys token value with Sheckles.', 'RPS is independent of inventory, roll cooldown, and Auto Roll, but the shared sale lock blocks its RNG controls.'],
    restrictions: ['Only the host chooses mode/opponents and cancels; only invited participants use table actions; only the current participant can commit a card.', 'Bots cannot be invited to a human table. Higher-bet proposals must be above the current bet and within the global maximum.'],
    failures: ['**Already active/busy participant** — finish or wait for the existing table.', '**Invalid or unaffordable bet** — enter a whole value inside the range with sufficient tokens.', '**Not enough accepted players** — wait for accepts or invite a valid table.', '**Stale/not your turn/not your controls** — use the current table message and wait for the prompted player.', '**Expired table** — start a new [[g-rps]] game; escrowed tokens are safely refunded.'],
    examples: ['**Start table:** [[g-rps]]', '**Bot round:** choose Bot → enter `10` → pick a card → reveal.', '**Player table:** choose Player → invite opponents → enter `25` → collect accepts → play.', '**Fund and play:** [[exchange-token]] with `amount-token:50` → [[g-rps]]'],
    warnings: ['A non-draw wager can be lost. Only wager token value you are willing to risk.'],
  }),

  'g-work': guide({
    category: 'Tokens & Activities',
    fallbackEmoji: '🍔',
    configuredEmoji: process.env.RNG_INFO_WORK_EMOJI,
    purpose: 'Complete timed work requests to earn tokens and Work XP and progress through Work ranks.',
    controls: ['The home menu offers **Check Stat** and **Work**.', 'During a shift, press ingredient buttons in the displayed bottom-to-top request order. Duplicate ingredients are separate buttons.', 'Quit Shift ends the active request without a reward; Back returns to the home menu after a resolved shift.'],
    requirements: [`No active Work shift and no active \`${duration(WORK_COOLDOWN_MS)}\` cooldown from a completed, failed, or canceled shift.`, 'Easy requests are available from level `1`; medium difficulty unlocks at level `6`; hard difficulty unlocks at level `13`.', 'The normal RNG feature and configured-channel requirements apply. Inventory space, Sheckles, and tokens are not required.'],
    steps: ['Open the Work home menu and optionally check current rank/streak progress.', 'Choose Work; the bot selects an eligible request and starts one owner-only timed shift.', 'Read the request shown in that shift and press every ingredient in the exact displayed order.', 'A wrong ingredient fails immediately. Completing all layers grants a reward and Work XP; Quit ends without either.', 'The result saves profile progress and may change rank or streak state.'],
    mechanics: [`A shift expires after \`${duration(WORK_SESSION_TTL_MS)}\`. Only one active shift is allowed.`, `Completed, failed, and canceled shifts start a \`${duration(WORK_COOLDOWN_MS)}\` cooldown. An expired shift grants nothing and releases the active shift.`, `Successful shifts grow a Work streak up to \`${integer(WORK_STREAK_MAX)}\`. An active streak expires after \`${duration(WORK_STREAK_TIMEOUT_MS)}\` without a completed/failed/canceled shift.`, `Failure \`${WORK_STREAK_FAILURE_LIMIT}\` breaks an active streak; successful shifts do not clear prior failures toward that break.`, `There are \`${WORK_RANKS.length}\` Work ranks. Rank and existing streak state may improve token salary, and Work Stat shows the player’s current progress and displayed boosts.`, 'Customer identities and customer-specific rewards are intentionally left for players to discover. No customer list, reward table, selection chance, or customer-to-reward mapping is included in this guide.'],
    results: ['A successful request grants token salary and Work XP; the completed-shift result reveals that shift’s outcome.', 'Failure, Quit, and expiration grant no salary or Work XP. Lifetime completed/failed counts, total salary, rank progress, and streak state persist.'],
    interactions: ['Work uses the same token wallet shown by [[balance]] and usable in [[g-rps]].', 'Work is independent of crop inventory, sale sessions, manual roll cooldown, and Auto Roll jobs.'],
    restrictions: ['Only the command invoker can operate the home menu or shift controls.', 'Resolved, consumed, invalid, foreign, and expired buttons are rejected without another reward.'],
    failures: ['**Active shift** — finish or quit it first.', '**Cooldown** — wait until the timestamp shown by the bot.', '**Wrong layer** — the shift fails immediately; follow the next request exactly.', '**Expired shift/control** — run [[g-work]] again.', '**Not your controls** — start your own shift.'],
    examples: ['**Open Work:** [[g-work]]', '**Check progression:** [[g-work]] → Check Stat.', '**Complete a shift:** [[g-work]] → Work → follow the request shown in that shift.', '**Use earnings:** [[g-work]] → [[balance]] → [[g-rps]]'],
    tips: ['Accuracy matters: one wrong layer ends the shift, while the displayed request always gives the order needed for that specific attempt.'],
    warnings: ['This guide intentionally contains no customer identities or customer-specific reward information.'],
  }),
});

module.exports = {
  COMMAND_GUIDES,
  duration,
  integer,
};
