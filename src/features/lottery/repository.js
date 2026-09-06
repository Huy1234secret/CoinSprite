const crypto = require('node:crypto');
const TICKET_KEY = 'lottery_ticket_1';
const PRICE = 1000n;
const PRIZES = [0n, 1757000000n, 845000n, 1625n];
const DAY = 86400000, OFFSET = 7 * 3600000;
const dateAt = ms => new Date(ms + OFFSET).toISOString().slice(0, 10);
const cutoff = date => Date.parse(`${date}T13:00:00Z`);
function ticketDate(now) { const day = dateAt(now); return now < cutoff(day) ? day : dateAt(now + DAY); }
const pair = rng => `${rng(10)}${String.fromCharCode(65 + rng(26))}`;
function code(rng = crypto.randomInt) { return [pair(rng), pair(rng), pair(rng)].join('-'); }
function unique(count, pairs, rng) {
  const result = new Set();
  for (let attempt = 0; result.size < count && attempt < 10000; attempt++) result.add(Array.from({ length: pairs }, () => pair(rng)).join('-'));
  if (result.size !== count) throw new Error('Unable to generate unique lottery numbers');
  return [...result];
}
function rankFor(ticket, draw) {
  if (ticket === draw.first) return 1;
  const pairs = ticket.split('-');
  if (draw.second.includes(pairs.slice(0, 2).join('-')) || draw.second.includes(pairs.slice(1).join('-'))) return 2;
  if (pairs.some(pair => draw.third.includes(pair))) return 3;
  return null;
}
function hydrate(row) { return row ? { id: Number(row.id), date: row.draw_date, first: row.first,
  second: JSON.parse(row.second_json), third: JSON.parse(row.third_json) } : null; }
class LotteryRepository {
  constructor(db, options = {}) { this.db = db; this.clock = options.clock || Date.now; this.rng = options.rng || crypto.randomInt; }
  balance(userId) { return BigInt(this.db.prepare('SELECT balance FROM counting_bronze_balances WHERE user_id=?').get(userId)?.balance || 0); }
  order(id) { return this.db.prepare('SELECT * FROM shop_orders WHERE id=?').get(id); }
  createOrder(userId, guildId, channelId, quantity) {
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) throw new Error('Choose a whole quantity from 1 to 1000.');
    const id = crypto.randomBytes(12).toString('hex');
    this.db.prepare('INSERT INTO shop_orders(id,user_id,guild_id,channel_id,quantity,created_at) VALUES(?,?,?,?,?,?)')
      .run(id, userId, guildId, channelId, quantity, this.clock());
    return this.order(id);
  }
  purchase(id, userId, guildId, channelId) {
    return this.db.transaction(() => {
      const order = this.order(id), now = this.clock();
      if (!order || order.user_id !== userId || order.guild_id !== guildId || order.channel_id !== channelId) throw new Error('This purchase belongs to another user or channel.');
      if (order.purchased_at != null) return { status: 'purchased', duplicate: true, quantity: Number(order.quantity) };
      if (now - Number(order.created_at) > 300000) throw new Error('This purchase expired. Open the shop again.');
      const total = order.quantity * PRICE, balance = this.balance(userId);
      if (balance < total) return { status: 'insufficient', missing: total - balance };
      const date = ticketDate(now);
      const insert = this.db.prepare('INSERT OR IGNORE INTO lottery_tickets(user_id,guild_id,draw_date,code,purchased_at) VALUES(?,?,?,?,?)');
      let created = 0;
      for (let attempts = 0; created < Number(order.quantity) && attempts < Number(order.quantity) * 100; attempts++) {
        created += Number(insert.run(userId, guildId, date, code(this.rng), now).changes);
      }
      if (created !== Number(order.quantity)) throw new Error('Could not allocate unique tickets. Please retry.');
      this.db.prepare('UPDATE counting_bronze_balances SET balance=?,updated_at=? WHERE user_id=?').run((balance - total).toString(), now, userId);
      this.db.prepare('INSERT INTO inventory VALUES(?,?,?,?) ON CONFLICT(user_id,item_key) DO UPDATE SET quantity=quantity+excluded.quantity,updated_at=excluded.updated_at')
        .run(userId, TICKET_KEY, order.quantity, now);
      this.db.prepare('UPDATE shop_orders SET purchased_at=? WHERE id=?').run(now, id);
      this.db.prepare('INSERT INTO lottery_channels VALUES(?,?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id').run(guildId, channelId);
      return { status: 'purchased', quantity: created, date };
    }).immediate();
  }
  dueDates(now = this.clock()) {
    const dates = this.db.prepare('SELECT DISTINCT draw_date FROM lottery_tickets WHERE settled=0').all().map(row => row.draw_date).filter(date => cutoff(date) <= now);
    const today = dateAt(now);
    if (cutoff(today) <= now) dates.push(today);
    return [...new Set(dates)].sort();
  }
  draw(date, targets = []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || cutoff(date) > this.clock()) throw new Error('Draw is not due.');
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM lottery_draws WHERE draw_date=?').get(date);
      if (existing) return hydrate(existing);
      const now = this.clock(), draw = { first: code(this.rng), second: unique(8, 2, this.rng), third: unique(16, 1, this.rng) };
      const result = this.db.prepare('INSERT INTO lottery_draws(draw_date,first,second_json,third_json,rolled_at) VALUES(?,?,?,?,?)')
        .run(date, draw.first, JSON.stringify(draw.second), JSON.stringify(draw.third), now);
      const id = Number(result.lastInsertRowid);
      const totals = new Map(), quantities = new Map();
      for (const ticket of this.db.prepare('SELECT * FROM lottery_tickets WHERE draw_date=? AND settled=0').all(date)) {
        const rank = rankFor(ticket.code, draw), earning = PRIZES[rank || 0];
        this.db.prepare('UPDATE lottery_tickets SET settled=1,rank=?,earnings=? WHERE id=?').run(rank, earning, ticket.id);
        quantities.set(ticket.user_id, (quantities.get(ticket.user_id) || 0n) + 1n);
        if (earning) totals.set(ticket.user_id, (totals.get(ticket.user_id) || 0n) + earning);
      }
      for (const [userId, quantity] of quantities) this.db.prepare('UPDATE inventory SET quantity=MAX(0,quantity-?),updated_at=? WHERE user_id=? AND item_key=?').run(quantity, now, userId, TICKET_KEY);
      const delivery = this.db.prepare('INSERT OR IGNORE INTO lottery_deliveries(id,draw_id,kind,target_id,guild_id) VALUES(?,?,?,?,?)');
      for (const [userId, total] of totals) {
        this.db.prepare('INSERT INTO counting_bronze_balances VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET balance=excluded.balance,updated_at=excluded.updated_at').run(userId, (this.balance(userId) + total).toString(), now);
        delivery.run(`dm:${id}:${userId}`, id, 'dm', userId, null);
      }
      for (const target of targets) delivery.run(`guild:${id}:${target.guildId}`, id, 'channel', target.channelId, target.guildId);
      return { ...draw, id, date };
    }).immediate();
  }
  winners(drawId, userId) {
    const draw = this.db.prepare('SELECT draw_date FROM lottery_draws WHERE id=?').get(drawId);
    if (!draw) return [];
    return this.db.prepare(`SELECT user_id,rank,SUM(earnings) AS earnings,COUNT(*) AS tickets FROM lottery_tickets
      WHERE draw_date=? AND rank IS NOT NULL ${userId ? 'AND user_id=?' : ''} GROUP BY user_id,rank ORDER BY user_id,rank`).all(...(userId ? [draw.draw_date, userId] : [draw.draw_date]));
  }
  history(userId, date, search = '', page = 1) {
    const now = this.clock(), oldest = dateAt(now - 29 * DAY);
    const dates = this.db.prepare('SELECT DISTINCT draw_date FROM lottery_tickets WHERE user_id=? AND draw_date>=? ORDER BY draw_date DESC').all(userId, oldest).map(row => row.draw_date);
    const chosen = date || dates[0] || ticketDate(now);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(chosen) || chosen < oldest || chosen > ticketDate(now)) throw new Error('Choose a date from the last 30 days or the upcoming draw.');
    const needle = String(search || '').toUpperCase().replace(/[^0-9A-Z-]/g, '').slice(0, 8);
    const filter = [userId, chosen, `%${needle}%`];
    const total = Number(this.db.prepare('SELECT COUNT(*) AS n FROM lottery_tickets WHERE user_id=? AND draw_date=? AND code LIKE ?').get(...filter).n);
    const maxPages = Math.max(1, Math.ceil(total / 100)), current = Math.min(maxPages, Math.max(1, Number(page) || 1));
    const tickets = this.db.prepare('SELECT code,rank,earnings,settled FROM lottery_tickets WHERE user_id=? AND draw_date=? AND code LIKE ? ORDER BY code LIMIT 100 OFFSET ?')
      .all(...filter, (Math.floor(current) - 1) * 100).map(row => ({ code: row.code, rank: Number(row.rank) || null, earnings: String(row.earnings), settled: Boolean(row.settled) }));
    return { date: chosen, dates, tickets, page: Math.floor(current), maxPages, total };
  }
  prune() {
    const now = this.clock();
    this.db.prepare(`DELETE FROM lottery_tickets WHERE settled=1 AND draw_date<? AND NOT EXISTS
      (SELECT 1 FROM lottery_draws d JOIN lottery_deliveries l ON l.draw_id=d.id WHERE d.draw_date=lottery_tickets.draw_date AND l.sent_at IS NULL)`)
      .run(dateAt(now - 29 * DAY));
    this.db.prepare('DELETE FROM shop_orders WHERE created_at<?').run(now - 30 * DAY);
  }
}
module.exports = { LotteryRepository, TICKET_KEY, PRICE, PRIZES, DAY, dateAt, ticketDate, cutoff, code, rankFor };
