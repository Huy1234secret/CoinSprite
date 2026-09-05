# Achievements

`/cs-achievements` and `csachievements` show global achievements publicly. Games
channel settings apply to both commands. The runtime registers the slash command
and routes text commands before Counting. The menu reads progress without awarding
medals or sending announcements.

## Settlement and migration

Work and Counting instantiate `AchievementRepository` in their shared Games SQLite
database. Its immediate migration transaction applies the versioned SQL schema and
each source's versioned backfill once, before that repository accepts live events.
Separate source markers support either feature opening the database first. Wallets,
server Leveling, existing difficulty thresholds, and historical rewards are untouched.

Backfill uses settled Work sessions, accepted Counting records, and current Work
profiles. Best streak is the maximum of the existing current streak and consecutive
successes in retained settled history; failures/timeouts break that history streak.
Aborted sessions do not. Deleted history cannot be reconstructed. This assumes
retained settled history is authoritative; it does not infer jobs or counts from
wallets. Historical unlocks never enter the announcement outbox.

Each gameplay transaction reads existing perks, settles rewards, advances progress,
persists all earned slots, and enqueues at most one highest new tier per track.
Session status and processed-message identities reject duplicate events before
these writes. Immediate SQLite transactions serialize concurrent settlements.
Bonuses use integer ten-thousandths and BigInt, add above the baseline, and floor
once. New perks take effect on the next event. Work's displayed salary and XP come
from the persisted settlement.

## Medal configuration

Provide custom emojis with these exact names in the bot's application or accessible
guild emoji cache: `CSBMedal`, `CSSMedal`, `CSGMedal`, `CSDMedal`, and `CSEMedal`.
No IDs are invented or hardcoded. Application emojis are fetched at startup and
refetched when an announcement's required medal is missing. Menu fallbacks display
the missing emoji name. Announcements require the actual awarded medal image;
`CSEMedal` is never used for an announcement. Animated emojis use GIF CDN URLs.

## Announcement delivery

The bot runtime drains `achievement_outbox` at startup and every five seconds,
after settlement transactions commit. Every record permanently captures its event,
user, track, tier, and original guild/channel IDs. Delivery fetches only that channel
and verifies its guild; there is no DM or alternate-channel fallback.

Workers claim records in an immediate transaction with a two-minute lease, renewed
every 30 seconds during delivery. Failed records retain `last_error` and retry with
bounded exponential backoff (30 seconds to one hour). Missing emoji, unavailable
channels, and permission errors are logged with the outbox record identity. Delivery
failure never reverses gameplay. Successful records retain Discord's `message_id`
and `delivered_at`. Expired claims are retried after a crash.

A stable 24-character nonce and discord.js `enforceNonce` use Discord's supported
recent-message deduplication. **Delivery is not guaranteed exactly once** across an
ambiguous send failure or a crash followed by a retry outside Discord's finite nonce
window. Leases prevent ordinary concurrent sends; nonce reuse reduces ambiguous
retry duplicates. Records are retained so operators can reconcile them if needed.

Bot, webhook, and system messages are already ignored by Counting.

## Verification

Run `npm test`. `test/achievements.test.js` covers catalog thresholds, permanent
slots, replacement perks, exact rewards, next-event timing, caps, transactional
rollback, source channels, medal thumbnails, pagination ownership, migration,
duplicate events, durable recovery, worker claims, and failed delivery retries.
Live Discord delivery and deployed emoji availability require the bot environment.
