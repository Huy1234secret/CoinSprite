const { randomUUID } = require('node:crypto');
const { announcementPayload, resolveEmoji } = require('./components');
const { CATALOG, MEDALS } = require('./catalog');

// Leases coordinate processes; heartbeat renewal keeps slow Discord requests claimed.
// Stable enforceNonce prevents recent retries from duplicating Discord messages, but
// Discord's finite nonce window cannot guarantee exactly once after a long outage.
class AchievementOutbox {
  constructor(db, client, options = {}) {
    this.db = db;
    this.client = client;
    this.clock = options.clock || Date.now;
    this.resolveEmoji = options.resolveEmoji || (name => resolveEmoji(client, name));
    this.reportError = options.reportError || (() => {});
    this.claim = db.transaction(() => {
      const now = this.clock();
      const row = db.prepare(`SELECT * FROM achievement_outbox WHERE delivered_at IS NULL
        AND available_at<=? AND lease_until<=? ORDER BY created_at,id LIMIT 1`).get(now, now);
      if (!row) return null;
      const token = randomUUID();
      db.prepare('UPDATE achievement_outbox SET claim_token=?,lease_until=?,attempts=attempts+1 WHERE id=?')
        .run(token, now + 120000, row.id);
      return { ...row, claim_token: token };
    }).immediate;
  }
  async drain() {
    if (this.running) return;
    this.running = true;
    try {
      for (let i = 0; i < 100; i++) {
        const row = this.claim();
        if (!row) break;
        const heartbeat = setInterval(() => {
          try {
            this.db.prepare('UPDATE achievement_outbox SET lease_until=? WHERE id=? AND claim_token=?')
              .run(this.clock() + 120000, row.id, row.claim_token);
          } catch (error) { this.report(error, row); }
        }, 30000);
        heartbeat.unref?.();
        try {
          // Application emoji changes have no gateway cache update. Refresh only
          // when the exact required medal is missing, so fixing it permits retry.
          const tier = CATALOG.find(track => track.id === row.track)?.tiers[Number(row.tier) - 1];
          if (tier && !this.resolveEmoji(MEDALS[tier.medal])) {
            await this.client.application?.emojis?.fetch?.();
          }
          const payload = announcementPayload(row, this.resolveEmoji);
          const channel = await this.client.channels.fetch(row.channel_id);
          if (!channel?.guildId || String(channel.guildId) !== row.guild_id || !channel.send) {
            throw new Error('Original achievement channel unavailable or does not belong to the source guild');
          }
          const message = await channel.send({ ...payload, nonce: row.id, enforceNonce: true });
          if (!message?.id) throw new Error('Discord did not return an announcement message ID');
          this.db.prepare(`UPDATE achievement_outbox SET message_id=?,delivered_at=?,claim_token=NULL,
            lease_until=0,last_error=NULL WHERE id=? AND claim_token=?`)
            .run(message.id, this.clock(), row.id, row.claim_token);
        } catch (error) {
          this.db.prepare(`UPDATE achievement_outbox SET last_error=?,available_at=?,claim_token=NULL,
            lease_until=0 WHERE id=? AND claim_token=?`)
            .run(String(error.message).slice(0, 1000), this.clock() + Math.min(3600000, 30000 * 2 ** Math.min(7, Number(row.attempts))), row.id, row.claim_token);
          this.report(error, row);
        } finally { clearInterval(heartbeat); }
      }
    } finally { this.running = false; }
  }
  report(error, row) { try { this.reportError(error, { kind: 'achievement-announcement', record: row }); } catch {} }
  start() {
    if (this.timer) return;
    const run = () => this.drain().catch(error => this.report(error));
    this.timer = setInterval(run, 5000);
    this.timer.unref?.();
    return run();
  }
  close() { clearInterval(this.timer); this.timer = null; }
}
module.exports = { AchievementOutbox };
