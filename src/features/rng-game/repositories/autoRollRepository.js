const { autoRollRefund, AUTO_ROLL_INTERVAL_MS } = require('../utils/autoRoll');
const { inventoryItem, playerRecord, SQLITE_INTEGER_MAX } = require('./gameRepository');

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return fallback;
  }
}

function autoRollJob(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    userId: row.user_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    status: row.status,
    durationMinutes: Number(row.duration_minutes),
    plannedRolls: Number(row.planned_rolls),
    completedRolls: Number(row.completed_rolls),
    costPaid: row.cost_paid,
    refundPaid: row.refund_paid,
    selectedAutoSellRarities: parseJson(row.selected_auto_sell_rarities, []),
    startedAt: Number(row.started_at),
    nextTickAt: Number(row.next_tick_at),
    endsAt: Number(row.ends_at),
    finishedAt: row.finished_at == null ? null : Number(row.finished_at),
    stoppedReason: row.stopped_reason,
    summaryCounts: parseJson(row.summary_counts, {}),
    notifiedAt: row.notified_at == null ? null : Number(row.notified_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

class AutoRollRepository {
  constructor(db, gameRepository) {
    this.db = db;
    this.gameRepository = gameRepository;
    this.statements = {
      job: db.prepare('SELECT * FROM rng_auto_roll_jobs WHERE id = ?'),
      active: db.prepare(`SELECT * FROM rng_auto_roll_jobs
        WHERE user_id = ? AND status = 'active' LIMIT 1`),
      due: db.prepare(`SELECT * FROM rng_auto_roll_jobs WHERE status = 'active' AND next_tick_at <= ?
        ORDER BY next_tick_at, id LIMIT ?`),
      unnotified: db.prepare(`SELECT * FROM rng_auto_roll_jobs
        WHERE status != 'active' AND notified_at IS NULL ORDER BY finished_at, id LIMIT ?`),
      insertJob: db.prepare(`INSERT INTO rng_auto_roll_jobs
        (user_id, guild_id, channel_id, status, duration_minutes, planned_rolls, completed_rolls,
         cost_paid, refund_paid, selected_auto_sell_rarities, started_at, next_tick_at, ends_at,
         finished_at, stopped_reason, summary_counts, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?, 0, ?, 0, ?, ?, ?, ?, NULL, '', '{}', ?, ?)`),
      player: db.prepare('SELECT * FROM rng_players WHERE user_id = ?'),
      updateBalance: db.prepare('UPDATE rng_players SET sheckle_balance = ?, updated_at = ? WHERE user_id = ?'),
      inventory: db.prepare('SELECT * FROM rng_inventory_items WHERE owner_user_id = ? ORDER BY rolled_at, id'),
      inventoryCount: db.prepare('SELECT COUNT(*) AS count FROM rng_inventory_items WHERE owner_user_id = ?'),
      item: db.prepare('SELECT * FROM rng_inventory_items WHERE id = ?'),
      deleteItem: db.prepare('DELETE FROM rng_inventory_items WHERE id = ? AND owner_user_id = ?'),
      insertItem: db.prepare(`INSERT INTO rng_inventory_items
        (owner_user_id, seed_id, crop_name, rarity, weight_units, stored_value, is_big, rolled_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
      discover: db.prepare(`INSERT OR IGNORE INTO rng_crop_discoveries
        (user_id, seed_id, discovered_at) VALUES (?, ?, ?)`),
      insertTick: db.prepare(`INSERT OR IGNORE INTO rng_auto_roll_ticks
        (job_id, scheduled_tick, processed_at) VALUES (?, ?, ?)`),
      updateActive: db.prepare(`UPDATE rng_auto_roll_jobs SET completed_rolls = ?, next_tick_at = ?,
        summary_counts = ?, updated_at = ? WHERE id = ? AND status = 'active'`),
      finish: db.prepare(`UPDATE rng_auto_roll_jobs SET status = ?, completed_rolls = ?, next_tick_at = ?,
        refund_paid = ?, finished_at = ?, stopped_reason = ?, summary_counts = ?, updated_at = ?
        WHERE id = ? AND status = 'active'`),
      markNotified: db.prepare(`UPDATE rng_auto_roll_jobs SET notified_at = ?, updated_at = ?
        WHERE id = ? AND status != 'active' AND notified_at IS NULL`),
      lease: db.prepare('SELECT * FROM rng_scheduler_leases WHERE lease_name = ?'),
      saveLease: db.prepare(`INSERT INTO rng_scheduler_leases (lease_name, owner_id, lease_until, updated_at)
        VALUES (?, ?, ?, ?) ON CONFLICT(lease_name) DO UPDATE SET
        owner_id = excluded.owner_id, lease_until = excluded.lease_until, updated_at = excluded.updated_at`),
    };

    this.startTransaction = db.transaction((userId, data, now, isSaleLocked) => {
      this.gameRepository.ensurePlayer(userId, now);
      const existing = autoRollJob(this.statements.active.get(userId));
      if (existing) return { status: 'already-active', job: existing };
      if (isSaleLocked?.()) return { status: 'sale-active' };
      const player = playerRecord(this.statements.player.get(userId));
      if (player.balance < data.totalCost) {
        return { status: 'insufficient', missing: data.totalCost - player.balance, balance: player.balance };
      }
      const balance = player.balance - data.totalCost;
      this.statements.updateBalance.run(balance, BigInt(now), userId);
      const inserted = this.statements.insertJob.run(
        userId,
        data.guildId,
        data.channelId,
        BigInt(data.durationMinutes),
        BigInt(data.plannedRolls),
        data.totalCost,
        JSON.stringify(data.selectedAutoSellRarities),
        BigInt(now),
        BigInt(data.nextTickAt),
        BigInt(data.endsAt),
        BigInt(now),
        BigInt(now),
      );
      return { status: 'ok', job: autoRollJob(this.statements.job.get(inserted.lastInsertRowid)), balance };
    }).immediate;

    this.leaseTransaction = db.transaction((leaseName, ownerId, now, leaseMs) => {
      const current = this.statements.lease.get(leaseName);
      if (current && current.owner_id !== ownerId && current.lease_until > BigInt(now)) return false;
      this.statements.saveLease.run(leaseName, ownerId, BigInt(now + leaseMs), BigInt(now));
      return true;
    }).immediate;

    this.tickTransaction = db.transaction((jobId, scheduledTick, now, createInstance) => {
      const row = this.statements.job.get(BigInt(jobId));
      const job = autoRollJob(row);
      if (!job || job.status !== 'active') return { status: 'inactive', job };
      if (scheduledTick < job.nextTickAt) return { status: 'not-due', job };
      if (Number(this.statements.insertTick.run(BigInt(jobId), BigInt(scheduledTick), BigInt(now)).changes) !== 1) {
        return { status: 'duplicate', job };
      }

      const finish = (status, stoppedReason, completedRolls, summaryCounts) => {
        const refund = autoRollRefund(job.plannedRolls, completedRolls);
        const player = playerRecord(this.statements.player.get(job.userId));
        const balance = player.balance + refund;
        if (balance > SQLITE_INTEGER_MAX) throw new RangeError('Sheckle balance exceeds SQLite signed 64-bit range.');
        if (refund) this.statements.updateBalance.run(balance, BigInt(now), job.userId);
        this.statements.finish.run(
          status,
          BigInt(completedRolls),
          BigInt(scheduledTick),
          refund,
          BigInt(now),
          stoppedReason,
          JSON.stringify(summaryCounts),
          BigInt(now),
          BigInt(jobId),
        );
        return { status: 'ended', job: autoRollJob(this.statements.job.get(BigInt(jobId))) };
      };

      if (scheduledTick >= job.endsAt) {
        return finish('stopped', 'Purchased duration ended; unprocessed rolls were refunded', job.completedRolls, job.summaryCounts);
      }

      const player = playerRecord(this.statements.player.get(job.userId));
      const count = Number(this.statements.inventoryCount.get(job.userId).count);
      if (count >= player.inventoryCapacity) {
        const allowed = new Set(job.selectedAutoSellRarities);
        const sellable = this.statements.inventory.all(job.userId).filter((item) => allowed.has(item.rarity));
        if (!sellable.length) {
          return finish('stopped', 'Inventory full with no eligible crop to auto-sell', job.completedRolls, job.summaryCounts);
        }
        const total = sellable.reduce((sum, item) => sum + item.stored_value, 0n);
        const balance = player.balance + total;
        if (balance > SQLITE_INTEGER_MAX) throw new RangeError('Sheckle balance exceeds SQLite signed 64-bit range.');
        for (const item of sellable) {
          if (Number(this.statements.deleteItem.run(item.id, job.userId).changes) !== 1) {
            throw new Error('Inventory changed during automatic selling.');
          }
        }
        this.statements.updateBalance.run(balance, BigInt(now), job.userId);
      }

      const currentPlayer = playerRecord(this.statements.player.get(job.userId));
      const instance = createInstance(currentPlayer);
      const inserted = this.statements.insertItem.run(
        job.userId,
        instance.seed.id,
        instance.seed.displayName,
        instance.seed.rarity,
        BigInt(instance.weightUnits),
        BigInt(instance.value),
        instance.isBig ? 1 : 0,
        BigInt(scheduledTick),
      );
      const discoveredNew = Number(this.statements.discover.run(job.userId, instance.seed.id, BigInt(now)).changes) === 1;
      const completedRolls = job.completedRolls + 1;
      const summaryCounts = { ...job.summaryCounts, [instance.seed.id]: (job.summaryCounts[instance.seed.id] || 0) + 1 };
      const nextTickAt = scheduledTick + AUTO_ROLL_INTERVAL_MS;
      const item = inventoryItem(this.statements.item.get(inserted.lastInsertRowid));
      if (completedRolls >= job.plannedRolls) {
        const ended = finish('completed', '', completedRolls, summaryCounts);
        return { ...ended, item, seed: instance.seed, discoveredNew };
      }
      if (nextTickAt >= job.endsAt) {
        const ended = finish('stopped', 'Purchased duration ended; unprocessed rolls were refunded', completedRolls, summaryCounts);
        return { ...ended, item, seed: instance.seed, discoveredNew };
      }
      this.statements.updateActive.run(
        BigInt(completedRolls),
        BigInt(nextTickAt),
        JSON.stringify(summaryCounts),
        BigInt(now),
        BigInt(jobId),
      );
      return {
        status: 'rolled',
        job: autoRollJob(this.statements.job.get(BigInt(jobId))),
        item,
        seed: instance.seed,
        discoveredNew,
      };
    }).immediate;
  }

  activeForUser(userId) {
    return autoRollJob(this.statements.active.get(String(userId)));
  }

  startJob(userId, data, options = {}) {
    try {
      return this.startTransaction(String(userId), data, options.now ?? Date.now(), options.isSaleLocked);
    } catch (error) {
      if (String(error?.code || '').startsWith('SQLITE_CONSTRAINT')) {
        const job = this.activeForUser(userId);
        if (job) return { status: 'already-active', job };
      }
      throw error;
    }
  }

  acquireLease(ownerId, now = Date.now(), leaseMs = 2_500) {
    return this.leaseTransaction('rng-auto-roll', String(ownerId), now, leaseMs);
  }

  dueJobs(boundary, limit = 100) {
    return this.statements.due.all(BigInt(boundary), BigInt(Math.max(1, Math.min(500, limit)))).map(autoRollJob);
  }

  unnotifiedJobs(limit = 100) {
    return this.statements.unnotified.all(BigInt(Math.max(1, Math.min(500, limit)))).map(autoRollJob);
  }

  processTick(jobId, scheduledTick, createInstance, now = Date.now()) {
    return this.tickTransaction(String(jobId), Number(scheduledTick), Number(now), createInstance);
  }

  markNotified(jobId, now = Date.now()) {
    return Number(this.statements.markNotified.run(BigInt(now), BigInt(now), BigInt(jobId)).changes) === 1;
  }
}

module.exports = { AutoRollRepository, autoRollJob };
