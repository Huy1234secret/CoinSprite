const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http'), crypto = require('node:crypto');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-profile-inventory-'));
process.env.COUNTING_DATABASE_PATH = path.join(temporary, 'wallet.sqlite');
process.env.ADMIN_SESSION_STORE_PATH = path.join(temporary, 'sessions.json');
const { openDatabase } = require('../src/features/work/repositories/database');
const { createAdminRequestHandler, safeOAuthReturnTo } = require('../src/adminServer');
const { formatCurrency, splitCurrency } = require('../src/features/shared/currency');
const { balancePayload } = require('../src/features/counting/components/builders');
test.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
test('balance displays exact Silver and Bronze without a separate exchange or zero Bronze remainder', () => {
  assert.deepEqual(splitCurrency(3542000n), { silver: 3n, bronze: 542000n });
  assert.equal(formatCurrency(1757000000n), '1,757 <:CSSCoin:1544762630877745194>');
  assert.equal(formatCurrency(3542000n), '3 <:CSSCoin:1544762630877745194> · 542,000 <:CSBC:1544762628474282064>');
  assert.equal(formatCurrency(0n), '0 <:CSBC:1544762628474282064>');
  const payload = balancePayload({ id: '123456789012345678' }, 3542000n);
  assert.ok(JSON.stringify(payload).includes('542,000')); assert.ok(JSON.stringify(payload).includes('CSSCoin'));
});
test('inventory API requires sign-in and derives ticket ownership exclusively from the session', async () => {
  const user = '123456789012345678', other = '223456789012345678', secret = 'profile-inventory-test-only';
  const raw = 'inventory-session', cookie = `${raw}.${crypto.createHmac('sha256', secret).update(raw).digest('base64url')}`;
  fs.writeFileSync(process.env.ADMIN_SESSION_STORE_PATH, JSON.stringify({ sessions: { [cookie]: { createdAt: Date.now(), expiresAt: Date.now() + 60000, csrfToken: 'test-only', user: { id: user, username: 'Tester' } } } }));
  const db = openDatabase();
  db.prepare('INSERT INTO inventory VALUES(?,?,?,?)').run(user, 'lottery_ticket_1', 1, Date.now());
  const date = require('../src/features/lottery/repository').ticketDate(Date.now());
  for (const [id, code] of [[user, '0A-1B-2C'], [other, '9Z-8Y-7X']]) db.prepare('INSERT INTO lottery_tickets(user_id,guild_id,draw_date,code,purchased_at) VALUES(?,?,?,?,?)').run(id, 'guild', date, code, Date.now());
  db.close();
  const server = http.createServer(createAdminRequestHandler({ sessionSecret: secret, cookieSecure: false, publicOrigin: 'http://127.0.0.1' }, {}));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const route of ['/api/profile/inventory', '/api/profile/lottery']) {
      assert.equal((await fetch(origin + route)).status, 401);
      const response = await fetch(`${origin}${route}?userId=${other}`, { headers: { Cookie: `coinsprite_admin=${cookie}` } });
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      const content = await response.text(); assert.ok(!content.includes('9Z-8Y-7X'));
      if (route.endsWith('lottery')) assert.ok(content.includes('0A-1B-2C'));
      else assert.ok(!content.includes('0A-1B-2C'));
    }
    assert.equal(safeOAuthReturnTo('/profile?tab=inventory&userId=other'), '/profile?tab=inventory');
    assert.equal(safeOAuthReturnTo('https://evil.example/profile?tab=inventory'), '/admin');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
