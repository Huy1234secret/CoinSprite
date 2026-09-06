const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { LotteryRepository, ticketDate, cutoff, DAY } = require('./repository');
const { v2Payload, textContainer } = require('../shared/components');
const { assertValidMessagePayload } = require('../shared/discordPayload');
const { formatCurrency } = require('../shared/currency');
const banner = ['lotteryimage.png', 'LotteryBanner.png'].map(name => path.join(__dirname, '../../../..', 'images', name)).find(file => fs.existsSync(file));
const names = { 1: 'First Prize', 2: 'Second Prize', 3: 'Third Prize' };
function winnerLines(rows) {
  const users = new Map();
  for (const row of rows) {
    if (!users.has(row.user_id)) users.set(row.user_id, []);
    users.get(row.user_id).push(`${names[row.rank]}: ${formatCurrency(row.earnings)}`);
  }
  return [...users].map(([user, ranks]) => `-# * <@${user}> — ${ranks.join(' • ')}`);
}
function ticketsUrl() {
  const base = process.env.ADMIN_PUBLIC_URL || process.env.PUBLIC_WEB_BASE_URL;
  if (!base || !/^https?:\/\//.test(base)) throw new Error('Configure ADMIN_PUBLIC_URL for the Check my tickets link.');
  return new URL('/profile?tab=inventory', base).href;
}
function winnerGroups(winners) {
  const groups = [];
  for (const line of winnerLines(winners)) {
    if (!groups.length || groups.at(-1).length + line.length > 1500) groups.push(line);
    else groups[groups.length - 1] += '\n' + line;
  }
  return groups;
}
function rollPayload(draw, winners, url = ticketsUrl()) {
  const groups = winnerGroups(winners);
  const grid = (values, width) => Array.from({ length: Math.ceil(values.length / width) }, (_, i) => values.slice(i * width, (i + 1) * width).join(' • ')).join('\n');
  const payload = v2Payload([{ type: 17, accent_color: 0xfee75c, components: [
    { type: 10, content: `### Lottery ticket roll #${draw.id}\n-# ${draw.date} · 20:00 UTC+7` },
    ...(banner ? [{ type: 12, items: [{ media: { url: 'attachment://lotteryimage.png' }, description: 'CoinSprite lottery' }] }] : []),
    { type: 10, content: `# 🥇First Prize: ${formatCurrency(1757000000n)}\n${draw.first}\n## 🥈Second Prize: ${formatCurrency(845000n)}\n${grid(draw.second, 4)}\n### 🥉Third Prize: ${formatCurrency(1625n)}\n${grid(draw.third, 8)}` },
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: 'Winners:' },
    { type: 10, content: groups[0] || '-# none' },
    ...(groups.length > 1 ? [{ type: 10, content: '-# Winner list continues in the following messages.' }] : []),
    { type: 14, divider: true, spacing: 1 },
    { type: 10, content: `-# Next roll <t:${Math.floor((cutoff(draw.date) + DAY) / 1000)}:R>\n-# Match all pairs for first prize, any two adjacent pairs in order for second, or any single pair for third. Each ticket wins its highest prize only.` },
  ] }, { type: 1, components: [{ type: 2, style: 5, label: 'Check my tickets', url }] }]);
  if (banner) payload.files = [{ attachment: banner, name: 'lotteryimage.png' }];
  return assertValidMessagePayload(payload);
}
function winnerDm(draw, rows, url = ticketsUrl()) {
  const total = rows.reduce((sum, row) => sum + row.earnings, 0n);
  return textContainer(`### 🎉 You won the CoinSprite lottery!\nDraw **#${draw.id}** · ${draw.date}\n${rows.map(row => `• **${names[row.rank]}** × ${row.tickets}: +${formatCurrency(row.earnings)}`).join('\n')}\n**Total credited: +${formatCurrency(total)}**\nYour prize is already in your wallet. [Check your tickets](${url})`, { color: 0xfee75c });
}
class LotteryScheduler {
  constructor(db, client, options) {
    this.db = db; this.client = client; this.options = options; this.repository = new LotteryRepository(db, options);
    this.clock = options.clock || Date.now; this.running = false; this.stopped = true;
  }
  targets() {
    return [...this.client.guilds.cache.values()].filter(guild => this.options.isGuildEnabled(guild.id)).map(guild => {
      const config = this.options.getGuildConfig(guild.id), settings = config?.games?.commandSettings || [];
      const channelId = config?.games?.lotteryChannelId
        || settings.find(setting => setting.commands.includes('cs-shop'))?.channelIds[0]
        || settings[0]?.channelIds[0]
        || this.db.prepare('SELECT channel_id FROM lottery_channels WHERE guild_id=?').get(guild.id)?.channel_id
        || guild.systemChannelId;
      return { guildId: guild.id, channelId };
    }).filter(target => target.channelId);
  }
  async tick() {
    // Settlement is synchronous and must not wait behind a slow Discord delivery.
    const targets = this.targets();
    for (const date of this.repository.dueDates()) this.repository.draw(date, targets);
    if (this.running) return;
    this.running = true;
    try {
      for (const delivery of this.db.prepare('SELECT * FROM lottery_deliveries WHERE sent_at IS NULL AND lease_until<=? ORDER BY draw_id,id LIMIT 100').all(this.clock())) {
        if (delivery.kind !== 'dm' && !this.options.isGuildEnabled(delivery.guild_id)) continue;
        if (delivery.kind.startsWith('winners-') && this.db.prepare('SELECT sent_at FROM lottery_deliveries WHERE id=?').get(`guild:${delivery.draw_id}:${delivery.guild_id}`)?.sent_at == null) continue;
        const lease = this.clock() + 120000;
        if (!this.db.prepare('UPDATE lottery_deliveries SET lease_until=? WHERE id=? AND sent_at IS NULL AND lease_until<=?').run(lease, delivery.id, this.clock()).changes) continue;
        try {
          const row = this.db.prepare('SELECT * FROM lottery_draws WHERE id=?').get(delivery.draw_id);
          const draw = { id: Number(row.id), date: row.draw_date, first: row.first, second: JSON.parse(row.second_json), third: JSON.parse(row.third_json) };
          const target = delivery.kind === 'dm' ? await this.client.users.fetch(delivery.target_id) : await this.client.channels.fetch(delivery.target_id);
          if (delivery.kind !== 'dm' && String(target.guildId) !== delivery.guild_id) throw new Error('Lottery channel belongs to another server');
          const winners = this.repository.winners(draw.id, delivery.kind === 'dm' ? delivery.target_id : undefined);
          const groups = winnerGroups(winners);
          if (delivery.kind === 'channel') {
            for (let page = 1; page < groups.length; page++) this.db.prepare('INSERT OR IGNORE INTO lottery_deliveries(id,draw_id,kind,target_id,guild_id) VALUES(?,?,?,?,?)')
              .run(`winners:${draw.id}:${delivery.guild_id}:${page}`, draw.id, `winners-${page}`, delivery.target_id, delivery.guild_id);
          }
          const payload = delivery.kind === 'dm' ? winnerDm(draw, winners) : delivery.kind === 'channel' ? rollPayload(draw, winners)
            : textContainer(`### Lottery #${draw.id} — Winners (continued)\n${groups[Number(delivery.kind.slice(8))]}`, { color: 0xfee75c });
          // Discord deduplicates immediate retries, while the database lease coordinates workers.
          payload.nonce = crypto.createHash('sha256').update(delivery.id).digest('hex').slice(0, 24); payload.enforceNonce = true;
          await target.send(payload);
          this.db.prepare('UPDATE lottery_deliveries SET sent_at=?,last_error=NULL WHERE id=? AND lease_until=?').run(this.clock(), delivery.id, lease);
        } catch (error) {
          this.db.prepare('UPDATE lottery_deliveries SET last_error=? WHERE id=? AND lease_until=?').run(String(error.message).slice(0, 400), delivery.id, lease);
          this.options.reportError?.(error);
        }
      }
      this.repository.prune();
    } finally { this.running = false; }
  }
  async start() {
    this.stopped = false;
    const run = async () => {
      if (this.stopped) return;
      this.timer = setTimeout(run, Math.max(10, Math.min(30000, cutoff(ticketDate(this.clock())) - this.clock()))); this.timer.unref?.();
      try { await this.tick(); } catch (error) { this.options.reportError?.(error); }
    };
    await run();
  }
  close() { this.stopped = true; clearTimeout(this.timer); }
}
module.exports = { LotteryScheduler, rollPayload, winnerDm, winnerLines };
