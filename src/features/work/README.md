# Work careers

Work status and completion messages expose **Job list** with five jobs per page.
Players can complete minigames before applying, earning the level and lifetime
successful-work requirements for their first career. Applications are global per
user, like the wallet and work cooldown. An active minigame prevents a job change.

The 100 careers use `level³ + level + 100` as their base payout per successful
minigame. Lifetime requirements are rounded up from `10 + 5 × level^1.5`.
Daily requirements start at three for jobs 1–10 and increase each decade;
jobs 90–100 explicitly require twelve. CEO requires 5,010 lifetime successes.

Each application starts a 24-hour work period and a 24-hour job-change cooldown.
Only successful settlements count toward daily requirements. Periods are anchored
to application time, independent of time zones and bot restarts. Missing a period
fires the player when employment is next checked, clears earned salary boosts,
and starts a 24-hour reapplication lock. Further checks do not extend the lock.
Checking multiple elapsed periods detects the intervening empty day even when
the first period was completed. Late minigame completions cannot undo firing.

At daily requirement + 5, 10, 16, 23, 31, 40, 50, 61, 73 and 86 successes, add
10 salary percentage points per newly reached tier. Daily counters and tiers reset
each period; earned boosts persist and can accumulate again on subsequent days.
CEO earns all ten daily increases at 98 successes. A yellow container appears on
the completion that earns an increase. That increase applies to subsequent pay.
Minigame failure alone and voluntary job changes do not erase earned boosts.

Reliable Employee adds 5/10/15/20 percentage points while employed. Career Worker
provides ×1.01/1.02/1.04/1.075 earnings and no longer grants XP. Only the highest
earned tier contributes. Salary boosts multiply the existing combined Work and
Expert achievement factor, using integer arithmetic with a single final rounding.
Existing Reliable Employee unlock requirements and permanent medals remain;
consecutive successes are retained internally solely for achievement progression.
Work streaks no longer appear in the UI or affect salary.

Migration 005 adds employment fields without rewriting existing profiles,
balances, XP, history or medals. Existing players start without an applied job;
the achievement ledger supplies their historical successful-work total.
