# Shop, lottery, and currency

`/cs-shop` and `csshop` sell Lottery Ticket 1 for 1,000 Bronze. The current shop has one unlimited-stock item and five placeholder cards. A purchase accepts 1–1,000 tickets, expires after five minutes, and checks the balance again on confirmation. Orders, debits, unique ticket allocation, and inventory updates commit together. Replaying a completed order cannot debit twice.

Tickets use `0A-0A-0A` codes. A user cannot own duplicate codes for the same draw; different users may share a code. Buying before 20:00 UTC+7 enters that day's draw; buying at or after the cutoff enters the following day. Tickets are automatically used by the draw. The normal inventory lists only the stack quantity.

Daily draws award each ticket's highest matching prize:

| Prize | Match | Winning codes | Value |
| --- | --- | --- | --- |
| First | All three pairs | 1 | 1,757 Silver |
| Second | Last two pairs | 8 distinct suffixes | 845,000 Bronze |
| Third | Last pair | 16 distinct suffixes | 1,625 Bronze |

One person may win on multiple tickets and at multiple ranks. Prize credits and the immutable draw commit in a single transaction before announcements are sent. Only tickets assigned to that draw date are consumed. A failed transaction rolls back both settlement and wallet changes.

The bot schedules the 20:00 cutoff and recovers due unsettled ticket dates at startup. Discord delivery happens as network availability permits. Pending deliveries use database leases, retries, and stable Discord nonces. Payouts are exactly once; Discord nonces reduce duplicate notifications after an uncertain send, but cannot guarantee suppression after Discord's deduplication window expires. Disabled servers do not receive channel announcements. Unsendable DMs stay pending and retry; winnings do not depend on delivery.

Configure **Games → Lottery channel** on the dashboard. If unset, the fallback is the first configured Shop channel, then the first Games channel, then the most recent purchase channel, then the server system channel. Without any usable destination a draw can still settle tickets. `ADMIN_PUBLIC_URL` (or `PUBLIC_WEB_BASE_URL`) must point to the website for the **Check my tickets** link. The banner uses root `images/lotteryimage.png`, falling back to the existing `images/LotteryBanner.png`. Long winner lists continue in separately tracked messages.

## Currency migration

1 Silver = 1,000,000 Bronze. There is one canonical balance in Bronze units; display conversion splits it into Silver and remaining Bronze without rounding. Whole Silver amounts omit a zero Bronze remainder. Work and Counting continue to award earnings above one million, and purchases spend the combined value.

Forward migrations `counting/003_silver_wallet.sql` and `work/004_lottery.sql` preserve existing wallets as decimal text so arbitrary-precision Counting rewards cannot overflow SQLite's signed integer range. All wallet arithmetic uses JavaScript BigInt within the existing immediate transactions. Both startup orders are supported. Deploy the bot and panel from the same revision with their shared database; do not run the old capped-wallet code against the new schema.

## Website inventory

`/profile?tab=inventory` provides a 50-slot (10×5) paginated grid, pointer/focus tooltips, and a lottery dialog. The dialog supports code search, sorted results, 100-code pages, draw dates, and gold/silver/bronze prize styling. Current tickets and 30 days of history are visible only to the authenticated owner. Ownership never comes from a request user ID. Expired history is pruned after its delivery records have completed; pending deliveries retain the records needed to construct their notifications.

## Work games

- **Emoji Inspector:** 10/15/20/25 emoji-only buttons for Easy/Medium/Hard/Expert, one odd emoji, one attempt. Compound couple/family variants appear only at Hard/Expert.
- **Cashier:** total and tendered amount in exact cents, approximately 4% exact-payment cases, modal input for change.
- **Color Match:** 3×3 board and target; two colors at Easy/Medium, three at Hard, four at Expert. Clicking advances a square through the shown cycle. Every generated board is solvable and starts incomplete.
- **CAPTCHA Solver:** a generated 480×125 PNG with 4–7 characters and moderate distortion; modal answers are case-insensitive. The answer stays in server-side session state and is not included in text, alt descriptions, or button IDs.

All games use the existing Work ownership, timeout, salary, XP, achievement, cooldown, persistence, and recovery paths. New game rewards scale with difficulty. Local image rendering uses the existing canvas dependency; no additional service is required.
