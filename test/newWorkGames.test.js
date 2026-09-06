const test = require('node:test');
const assert = require('node:assert/strict');
const games = require('../src/features/work/games/newJobs');
const { GAME_FACTORIES, GAME_ACTIONS, WorkService } = require('../src/features/work/services/workService');
const { activeGamePayload } = require('../src/features/work/components/builders');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const { createWorkFeature } = require('../src/features/work');
const { openDatabase } = require('../src/features/work/repositories/database');
const USER = '123456789012345678', GUILD = '223456789012345678', CHANNEL = '323456789012345678', MESSAGE = '423456789012345678';
let seed = 12345;
const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
test('odd-one-out has exactly one odd emoji and correct button counts at every difficulty', () => {
  for (const [i, difficulty] of ['easy', 'normal', 'hard', 'expert'].entries()) {
    for (let n = 0; n < 30; n++) {
      const state = games.createOddGame(difficulty, rng);
      const payload = activeGamePayload({ sessionId: 'odd', job: 'odd', deadline: 10000, state });
      assert.deepEqual(messagePayloadErrors(payload), []);
      const buttons = payload.components[0].components.filter(c => c.type === 1).flatMap(row => row.components);
      assert.equal(buttons.length, [10, 15, 20, 25][i]);
      assert.equal(buttons.filter(b => b.emoji.name === state.odd).length, 1);
      assert.equal(games.applyOddAction(state, `odd-${state.answer}`).outcome, 'succeeded');
      assert.equal(games.applyOddAction(state, `odd-${(state.answer + 1) % state.count}`).outcome, 'failed');
      assert.equal(games.applyOddAction(state, 'odd-99').outcome, 'active');
      if (i < 2) assert.ok(![state.normal, state.odd].some(emoji => emoji.includes('‍')));
    }
  }
});
test('cashier uses exact cents, supports exact payment, and rejects malformed answers', () => {
  assert.equal(games.applyCashierAction({ total: 1051, paid: 2000 }, 'answer:9.49').outcome, 'succeeded');
  assert.equal(games.applyCashierAction({ total: 1000, paid: 1000 }, 'answer:0').outcome, 'succeeded');
  for (const value of ['-1', 'NaN', '1e2', '0.001', '9.50']) assert.equal(games.applyCashierAction({ total: 1051, paid: 2000 }, `answer:${value}`).outcome, 'failed');
  for (const difficulty of ['easy', 'normal', 'hard', 'expert']) {
    const exact = games.createCashierGame(difficulty, () => 0); assert.equal(exact.paid, exact.total);
    const change = games.createCashierGame(difficulty, () => .5); assert.ok(change.paid > change.total);
  }
});
test('color games have 3x3 grids, correct cycles, and every generated board is solvable', () => {
  for (const [i, difficulty] of ['easy', 'normal', 'hard', 'expert'].entries()) {
    const state = games.createColorGame(difficulty, rng);
    assert.equal(state.colors.length, [2, 2, 3, 4][i]);
    assert.ok(state.cells.some((value, index) => value !== state.target[index]));
    const payload = activeGamePayload({ sessionId: 'colors', job: 'colors', deadline: 10000, state });
    const rows = payload.components[0].components.filter(c => c.type === 1);
    assert.deepEqual(rows.map(row => row.components.length), [3, 3, 3]);
    let result;
    for (let cell = 0; cell < 9; cell++) while (state.cells[cell] !== state.target[cell]) result = games.applyColorAction(state, `color-${cell}`);
    assert.equal(result.outcome, 'succeeded');
    assert.equal(games.applyColorAction(state, 'color-9').outcome, 'active');
  }
});
test('CAPTCHA is a short PNG, has no answer in message payload, and accepts case-insensitive input', () => {
  for (const [i, difficulty] of ['easy', 'normal', 'hard', 'expert'].entries()) {
    const state = games.createCaptchaGame(difficulty, rng);
    assert.equal(state.answer.length, 4 + i);
    const payload = activeGamePayload({ sessionId: 'captcha', job: 'captcha', deadline: 10000, state });
    assert.deepEqual(messagePayloadErrors(payload), []);
    assert.ok(!JSON.stringify(payload.components).includes(state.answer));
    const image = payload.files[0].attachment;
    assert.equal(image.readUInt32BE(16), 480); assert.equal(image.readUInt32BE(20), 125);
    assert.equal(games.applyCaptchaAction(state, `answer:${state.answer.toLowerCase()}`).outcome, 'succeeded');
    assert.equal(games.applyCaptchaAction(state, 'answer:WRONG').outcome, 'failed');
  }
});
test('all new jobs use Work settlement once; unauthorized and stale modal submissions cannot pay', async t => {
  const db = openDatabase({ databasePath: ':memory:' }); t.after(() => db.close());
  let now = 100000;
  const feature = createWorkFeature({ db, clock: () => now, setTimer: () => ({ unref() {} }), clearTimer() {} });
  t.after(() => feature.close());
  for (const job of ['odd', 'cashier', 'colors', 'captcha']) {
    const state = GAME_FACTORIES[job]('easy', rng);
    const sessionId = `new-${job}`;
    feature.repository.create({ sessionId, userId: USER, guildId: GUILD, channelId: CHANNEL, job, difficulty: 'easy', deadline: now + 60000,
      state, baseSalary: 100, xpReward: 10, bypassCooldown: true });
    feature.repository.attachMessage(sessionId, MESSAGE);
    let action = job === 'odd' ? `odd-${state.answer}` : job === 'cashier' ? `answer:${((state.paid - state.total) / 100).toFixed(2)}` : `answer:${state.answer}`;
    const input = { sessionId, userId: USER, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE };
    assert.equal((await feature.service.handleAction({ ...input, userId: 'other', action })).status, 'denied');
    if (job === 'colors') {
      for (let i = 0; i < 9; i++) while (state.cells[i] !== state.target[i]) {
        action = `color-${i}`; GAME_ACTIONS.colors(state, action); await feature.service.handleAction({ ...input, action });
      }
    } else await feature.service.handleAction({ ...input, action });
    assert.equal(feature.repository.get(sessionId).status, 'succeeded');
    const balance = feature.repository.balance(USER);
    await feature.service.handleAction({ ...input, action }); assert.equal(feature.repository.balance(USER), balance);
  }
  const state = games.createCaptchaGame('easy', rng);
  feature.repository.create({ sessionId: 'modal', userId: USER, guildId: GUILD, channelId: CHANNEL, job: 'captcha', difficulty: 'easy', deadline: now + 1000, state, baseSalary: 100, xpReward: 0, bypassCooldown: true });
  feature.repository.attachMessage('modal', MESSAGE);
  let modal, reply;
  const button = { isButton: () => true, customId: 'cswork:modal:submit', user: { id: USER }, guildId: GUILD, channelId: CHANNEL, message: { id: MESSAGE, edit: async p => { reply = p; } }, showModal: async p => { modal = p; } };
  await feature.handleInteraction(button); assert.equal(modal.custom_id, 'cswork:modal:answer');
  now += 1001;
  const balance = feature.repository.balance(USER);
  await feature.handleInteraction({ ...button, isButton: () => false, isModalSubmit: () => true, customId: modal.custom_id,
    fields: { getTextInputValue: () => state.answer }, deferUpdate: async () => {} });
  assert.equal(feature.repository.get('modal').status, 'timed_out'); assert.equal(feature.repository.balance(USER), balance);
});
