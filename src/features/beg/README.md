# CoinSprite Beg

`/cs-beg` and the exact text command `csbeg` open the same public Components V2
game. Each menu contains four buttons selected from 100 individually authored
approaches. Every approach has a unique name plus unique success, ordinary-failure,
and wallet-loss flavor text.

## Menu and selection

The four offered approach IDs are stored in `beg_session_options` before the
Discord message is sent. They remain stable across edits and restarts. Each draw
first chooses a non-empty risk tier with weights Safe 45%, Uncertain 30%, Risky
20%, and Ridiculous 5%, then chooses an approach uniformly from that tier without
replacement. The server accepts only an approach recorded among the session's
four options.

The menu is public, has a white container, and contains exactly one heading, one
separator, one instruction, and one row of four gray secondary buttons. Each
text-only label contains just the approach name, without an emoji, success chance,
or reward range.

## Probabilities and economy

One random roll determines mutually exclusive success, wallet loss, or ordinary
failure. Success and loss are absolute probabilities; the remainder is failure.
Safe approaches have no loss outcome. Uncertain, Risky, and Ridiculous loss
chances are 5%, 12%, and 25%.

Rewards were rebalanced for the one-minute cooldown. For each approach:

```text
average loss A = (loss minimum + loss maximum) / 2
required success average R = (4 + loss chance × A) / success chance
reward minimum = floor(0.75 × R)
reward maximum = ceil(1.25 × R)
expected net = success chance × average reward − loss chance × A
```

Percentages in the formula are decimal probabilities. The resulting uncapped
catalog averages are:

| Tier | Success range | Loss range | Reward range across tier | Average net |
| --- | ---: | ---: | ---: | ---: |
| Safe | 55–95% | 0 | 3–10 | 4.0396 Bronze |
| Uncertain | 30–54% | 4–12 | 6–19 | 4.0146 Bronze |
| Risky | 10–29% | 12–40 | 18–89 | 4.0070 Bronze |
| Ridiculous | 1–9% | 40–160 | 241–3,625 | 3.9972 Bronze |

Actual loss is capped at the current wallet, so low-balance players have a
slightly higher realized expected value. All values are stored as BigInt-compatible
decimal Bronze text in the canonical `counting_bronze_balances` wallet.

Result containers use a green accent for success, red for ordinary failure, and
black when the player loses Bronze.

## Persistence and safety

Cooldowns and menus are global by Discord `user_id`. A user can have one open
menu, which expires after exactly one minute. The one-minute cooldown begins only
when an offered approach is selected and settled.

Settlement uses one immediate SQLite transaction for the cooldown recheck,
wallet credit or capped debit, statistics, and stored result. User, guild,
channel, and message IDs must all match. Duplicate or concurrent clicks replay
the stored result without moving money twice. A failed initial Discord send marks
the unfinished session expired.

## Integration

`BEG_COMMANDS` is included in guild application commands, `cs-beg` is available
in Games channel settings, and the feature shares `workGame.db`. Root interaction,
message, and owner-test routing all delegate to the same Beg feature.

Run the focused tests with:

```bash
node --test --test-concurrency=1 test/beg.test.js
```
