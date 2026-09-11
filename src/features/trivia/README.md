# Trivia

Use `/cs-trivia` or `cstrivia` in an enabled guild. The Games panel can restrict
Trivia to selected channels. Menus and games belong to the invoking player;
only one active game per player is permitted across guilds.

| Difficulty | Required level | Lives | Initial time | Correct answer adds | Coins | Trivia XP |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Easy | 1 | 3 | 60s | 8s | 5–25 | 1–5 |
| Medium | 15 | 2 | 30s | 9s | 10–50 | 3–15 |
| Hard | 40 | 1 | 15s | 10s | 20–100 | 9–45 |

The running clock caps at 60 seconds. A wrong answer consumes one life and
preserves the remaining time. A timeout consumes one life and resets the clock
to the difficulty's initial time. The clock pauses during the 3.5-second answer
reveal. Discord relative timestamps display the deadline without per-second API
edits. All answer buttons are disabled during the reveal; the correct choice is
green and an incorrect selected choice is red. After the last reveal, the game
shows submitted-answer count, correct-answer count, earnings and a Back button.

Rewards are independently and uniformly rolled per correct answer, then saved
immediately in the shared coin wallet and the separate Trivia profile. Trivia
starts at level 1 and requires `100 × current level` XP for each next level;
surplus XP carries over. Achievement bonuses apply to coins, not XP. The highest
tier from each track replaces its lower tiers, and the three tracks add together.
Whole-coin rewards round down after applying the bonus. New perks apply starting
with the next correct answer.

Quick Thinker, Sharp Mind and Trivia Mastermind unlock at 20, 100, 400 and 1000
correct answers in Easy, Medium and Hard respectively. Their coin bonuses are
1/3.5/8/12.5%, 2/7/16/25%, and 4/14/32/50%. Rising Scholar (level 5), Knowledge
Seeker (15), and Living Encyclopedia (40) award medals without earning perks.

The local bank contains 300 questions per difficulty (900 total). Choices shuffle on each
question and questions do not repeat until that difficulty's bank is exhausted.
The original 15 questions remain first in `questions.js`, followed by 285
imported questions in each `data/<difficulty>.json` file. Keep this ordering
stable because saved sessions store question indices. Each row contains a
question, its correct choice, and three incorrect choices; answer labels must
fit Discord's 80-character limit. Imported data is attributed and licensed in
[`data/ATTRIBUTION.md`](data/ATTRIBUTION.md). No network access is needed to play.

SQLite transactions settle each question once and save the answer, wallet,
profile, achievements and announcement outbox together. Duplicate clicks and
stale question numbers cannot award twice. Sessions persist question deadlines
and feedback deadlines. Startup restores active messages and resumes timers;
overdue questions time out, without retracting already earned rewards.

Run `node --test test/trivia.test.js test/achievements.test.js` for focused checks
or `npm test` for the full suite. Restart the bot after deployment to register
the guild slash command and apply the idempotent schema additions.
