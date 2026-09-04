const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { featureCommandsForConfig } = require('../src/applicationCommands');
const { COMPONENTS_V2_FLAG } = require('../src/features/shared/components');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const { BURGER_MESSAGES, BURGER_ORDER_SEEDS } = require('../src/features/work/data/burgerOrders');
const { TRASH_ITEMS } = require('../src/features/work/data/trashItems');
const { PIPE_EMOJIS } = require('../src/features/work/data/emojis');
const { activeGamePayload } = require('../src/features/work/components/builders');
const { parseWorkCommand } = require('../src/features/work/commands');
const { applyBurgerAction, createBurgerGame } = require('../src/features/work/games/burger');
const { BUILTIN_PAIRS, applyElectricianAction, createElectricianGame } = require('../src/features/work/games/electrician');
const { LAYOUTS, PIECES, applyPlumberAction, createPlumberGame, validatePlumber } = require('../src/features/work/games/plumber');
const { applyTrashAction, createTrashGame } = require('../src/features/work/games/trash');
const { openDatabase } = require('../src/features/work/repositories/database');
const { WorkRepository } = require('../src/features/work/repositories/workRepository');
const { DIFFICULTIES, JOB_CONFIG, WorkService, chooseDifficulty, rewardFor, roundToNearest5 } = require('../src/features/work/services/workService');

const GUILD = '123456789012345678';
const CHANNEL = '223456789012345678';
const USER = '323456789012345678';
const MESSAGE = '423456789012345678';

function sequence(values) { let index = 0; return () => values[index++ % values.length]; }
function memory(clock = () => 1_000_000) {
  const db = openDatabase({ databasePath: ':memory:' });
  return { db, repository: new WorkRepository(db, { clock }) };
}

test('/cs-work registration follows the leveling unlock and cswork is an exact command', () => {
  const locked = featureCommandsForConfig({ enabled: true, features: { leveling: false }, leveling: { enabled: true } });
  assert.equal(locked.some((command) => command.name === 'cs-work'), false);
  const enabled = featureCommandsForConfig({ enabled: true, features: { leveling: true }, leveling: { enabled: true } });
  const command = enabled.find((entry) => entry.name === 'cs-work');
  assert.equal(command.description, 'Start a random work minigame.');
  assert.equal(command.type, 1);
  assert.deepEqual(command.options, []);
  for (const value of ['cswork', ' CSWORK ', '\ncsWork\t']) assert.equal(parseWorkCommand(value), true);
  for (const value of ['cs-work', 'cswork now', 'xcswork', 'csworker', '']) assert.equal(parseWorkCommand(value), false);
});

test('active payloads use one white Components V2 container, separator, countdown, and safe mentions', () => {
  const session = { sessionId: 'abc', job: 'trash', deadline: 1_234_000, state: createTrashGame('easy', () => 0) };
  const payload = activeGamePayload(session);
  assert.ok(payload.flags & COMPONENTS_V2_FLAG);
  assert.deepEqual(payload.allowedMentions, { parse: [], users: [], roles: [], repliedUser: false });
  assert.equal(payload.components.length, 1);
  assert.equal(payload.components[0].type, 17);
  assert.equal(payload.components[0].accent_color, 0xFFFFFF);
  assert.equal(payload.components[0].components[1].type, 14);
  assert.match(payload.components[0].components[0].content, /<t:1234:R>/);
  assert.equal(messagePayloadErrors(payload).length, 0);
});

test('burger catalogs, repeated ingredients, reusable controls, and maximum height are valid', () => {
  assert.equal(new Set(BURGER_MESSAGES).size, 100);
  assert.equal(BURGER_ORDER_SEEDS.length, 100);
  assert.ok(BURGER_ORDER_SEEDS.filter((seed) => new Set(seed).size < seed.length).length >= 25);
  const state = createBurgerGame('expert', () => 0.9999);
  assert.ok(state.target.length <= 25);
  const repeated = { target: ['bottom_bun', 'cheese', 'cheese', 'top_bun'], cursor: 0, buttons: ['bottom_bun', 'cheese', 'top_bun'] };
  assert.equal(applyBurgerAction(repeated, 'bottom_bun').outcome, 'active');
  assert.equal(applyBurgerAction(repeated, 'cheese').outcome, 'active');
  assert.equal(applyBurgerAction(repeated, 'cheese').outcome, 'active');
  assert.equal(applyBurgerAction(repeated, 'top_bun').outcome, 'succeeded');
  assert.equal(applyBurgerAction({ target: ['bottom_bun'], cursor: 0, buttons: ['bottom_bun', 'cheese'] }, 'cheese').outcome, 'failed');
});

test('trash has twenty unique items in all six categories and advances without replacement', () => {
  assert.deepEqual(Object.keys(TRASH_ITEMS), ['recycle', 'organic', 'medical', 'hazardous', 'glass', 'general']);
  for (const items of Object.values(TRASH_ITEMS)) assert.equal(new Set(items).size, 20);
  const state = createTrashGame('expert', sequence([0.1, 0.2, 0.3, 0.4]));
  assert.equal(new Set(state.items.map((entry) => entry.item)).size, 10);
  const first = state.items[0];
  assert.equal(applyTrashAction(state, first.category).outcome, 'active');
  assert.equal(state.sorted, 1);
  assert.equal(applyTrashAction(state, Object.keys(TRASH_ITEMS).find((name) => name !== state.items[1].category)).outcome, 'failed');
});

test('1,000 seeded plumber boards are valid, connected, leak-free, sized correctly, scrambled, and recoverable', () => {
  const ranges = { easy: [8, 11], normal: [12, 16], hard: [17, 21], expert: [22, 25] };
  let seed = 0x12345678;
  const rng = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 1000; index += 1) {
    const difficulty = Object.keys(ranges)[index % 4];
    const state = createPlumberGame(difficulty, rng);
    const occupied = state.cells.filter((cell) => cell.type !== 'empty');
    const valves = state.cells.filter((cell) => cell.type === 'valve');
    assert.ok(occupied.length >= ranges[difficulty][0] && occupied.length <= ranges[difficulty][1]);
    assert.equal(valves.length, LAYOUTS[difficulty].valves.length);
    assert.equal(validatePlumber(state), false);
    for (const cell of state.cells) if (cell.type === 'pipe') cell.piece = cell.solution;
    assert.equal(validatePlumber(state), true);
  }
});

test('pipe rotations preserve topology and the 5x5 payload stays within Discord limits', () => {
  assert.equal(PIPE_EMOJIS.ne.name, 'CSPipe2');
  assert.equal(PIPE_EMOJIS.es.name, 'CSPipe21');
  assert.equal(PIPE_EMOJIS.sw.name, 'CSPipe22');
  assert.equal(PIPE_EMOJIS.wn.name, 'CSPipe23');
  assert.equal(PIPE_EMOJIS.wne.name, 'CSPipe4');
  assert.equal(PIPE_EMOJIS.nes.name, 'CSPipe41');
  assert.equal(PIPE_EMOJIS.esw.name, 'CSPipe42');
  assert.equal(PIPE_EMOJIS.swn.name, 'CSPipe43');
  for (const [name, piece] of Object.entries(PIECES)) {
    const rotated = PIECES[piece.next];
    assert.deepEqual(new Set(rotated.sides), new Set(piece.sides.map((side) => ({ N: 'E', E: 'S', S: 'W', W: 'N' })[side])));
    let current = name;
    for (let count = 0; count < 4; count += 1) current = PIECES[current].next;
    assert.equal(current, name);
  }
  const state = createPlumberGame('expert', () => 0);
  const session = { sessionId: 'pipeboard', job: 'plumber', deadline: 100_000, state };
  const payload = activeGamePayload(session);
  const rows = payload.components[0].components.filter((component) => component.type === 1);
  assert.equal(rows.length, 5);
  assert.ok(rows.every((row) => row.components.length === 5));
  assert.equal(messagePayloadErrors(payload).length, 0);
  const cell = state.cells.findIndex((entry) => entry.type === 'pipe');
  const before = state.cells[cell].piece;
  applyPlumberAction(state, `pipe-${cell}`);
  assert.equal(state.cells[cell].piece, PIECES[before].next);
});

test('electrician pairs select, deselect, match, fail, and cap safely at configured maximum', () => {
  assert.equal(BUILTIN_PAIRS.length, 9);
  const custom = [10, 11, 12].map((n) => ({ circle: { name: `c${n}`, id: `${n}` }, square: { name: `s${n}`, id: `${n + 100}` } }));
  const expert = createElectricianGame('expert', () => 0.999, custom);
  assert.equal(expert.buttons.length, 24);
  assert.equal(new Set(expert.buttons.map((button) => button.pair)).size, 12);
  for (const pair of new Set(expert.buttons.map((button) => button.pair))) assert.equal(expert.buttons.filter((button) => button.pair === pair).length, 2);
  const state = createElectricianGame('easy', () => 0);
  assert.equal(state.buttons.length, 6);
  assert.equal(applyElectricianAction(state, 'wire-0').outcome, 'active');
  assert.equal(state.selected, 0);
  applyElectricianAction(state, 'wire-0');
  assert.equal(state.selected, null);
  const mate = state.buttons.findIndex((entry, index) => index && entry.pair === state.buttons[0].pair);
  applyElectricianAction(state, 'wire-0');
  assert.equal(applyElectricianAction(state, `wire-${mate}`).outcome, 'active');
  const unmatched = state.buttons.map((entry, index) => ({ entry, index })).filter(({ entry }) => !state.matched.includes(entry.pair));
  applyElectricianAction(state, `wire-${unmatched[0].index}`);
  assert.equal(applyElectricianAction(state, `wire-${unmatched.find((candidate) => candidate.entry.pair !== unmatched[0].entry.pair).index}`).outcome, 'failed');
});

test('difficulty weights, unlocks, multiplication, and rounding use the specified balance', () => {
  assert.deepEqual(DIFFICULTIES.map((entry) => chooseDifficulty(entry.level, () => 0.9999)), ['easy', 'normal', 'hard', 'expert']);
  assert.equal(roundToNearest5(112.5), 115);
  assert.equal(rewardFor('trash', 'easy'), 45);
  assert.equal(rewardFor('burger', 'normal'), 75);
  assert.equal(rewardFor('electrician', 'hard'), 135);
  assert.equal(rewardFor('plumber', 'expert'), 245);
});

test('persistent sessions reject duplicates, settle once, and apply cooldown for every outcome', async () => {
  let now = 1_000_000;
  const { db, repository } = memory(() => now);
  const input = { sessionId: 'one', guildId: GUILD, channelId: CHANNEL, userId: USER, job: 'trash', difficulty: 'easy', deadline: now + 45_000, state: createTrashGame('easy', () => 0) };
  assert.equal(repository.create(input).status, 'created');
  assert.equal(repository.create({ ...input, sessionId: 'two' }).status, 'active');
  repository.attachMessage('one', MESSAGE);
  const first = repository.settle('one', 'failed', 0, JOB_CONFIG.trash.cooldownMs);
  assert.equal(first.changed, true);
  assert.equal(repository.settle('one', 'failed', 0, JOB_CONFIG.trash.cooldownMs).changed, false);
  assert.equal(repository.create({ ...input, sessionId: 'three' }).status, 'cooldown');
  db.close();
});

test('a failed Discord send aborts without cooldown and restart recovery settles expired work with an injected clock', async () => {
  let now = 1_000_000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-work-'));
  const databasePath = path.join(directory, 'work.sqlite');
  try {
    const db = openDatabase({ databasePath });
    const repository = new WorkRepository(db, { clock: () => now });
    const service = new WorkService(repository, { clock: () => now, rng: () => 0, createId: () => 'failed-send', setTimer: () => ({ unref() {} }), clearTimer() {} });
    await assert.rejects(() => service.start({ guildId: GUILD, channelId: CHANNEL, userId: USER, level: 0 }, async () => { throw new Error('send failed'); }), /send failed/);
    assert.equal(repository.get('failed-send').status, 'aborted');
    assert.equal(repository.create({ sessionId: 'restart', guildId: GUILD, channelId: CHANNEL, userId: USER, job: 'trash', difficulty: 'easy', deadline: now + 1, state: createTrashGame('easy', () => 0) }).status, 'created');
    repository.attachMessage('restart', MESSAGE);
    db.close();
    now += 2;
    const reopened = openDatabase({ databasePath });
    const recoveredRepository = new WorkRepository(reopened, { clock: () => now });
    const recovered = new WorkService(recoveredRepository, { clock: () => now, setTimer: () => ({ unref() {} }), clearTimer() {}, getLevel: () => 7 });
    const results = await recovered.recover();
    assert.equal(results.length, 1);
    assert.equal(recoveredRepository.get('restart').status, 'timed_out');
    assert.ok(recoveredRepository.create({ sessionId: 'blocked', guildId: GUILD, channelId: CHANNEL, userId: USER, job: 'trash', difficulty: 'easy', deadline: now + 1, state: {} }).nextWorkAt > now);
    recovered.close(); reopened.close();
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('ownership binds user, guild, channel, and message and concurrent completion awards XP once', async () => {
  let awards = 0;
  const { db, repository } = memory();
  const state = { target: ['bottom_bun'], cursor: 0, buttons: ['bottom_bun'], message: 'Bottom bun only.' };
  repository.create({ sessionId: 'owned', guildId: GUILD, channelId: CHANNEL, userId: USER, job: 'burger', difficulty: 'easy', deadline: 2_000_000, state });
  repository.attachMessage('owned', MESSAGE);
  const service = new WorkService(repository, { clock: () => 1_000_000, awardXp: async (_g, _u, xp) => { awards += 1; return { newLevel: xp }; }, getLevel: () => 0 });
  for (const changed of [
    { userId: '999' }, { guildId: '999' }, { channelId: '999' }, { messageId: '999' },
  ]) {
    const denied = await service.handleAction({ sessionId: 'owned', action: 'bottom_bun', userId: USER, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE, ...changed });
    assert.equal(denied.status, 'denied');
  }
  const request = { sessionId: 'owned', action: 'bottom_bun', userId: USER, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE };
  const [left, right] = await Promise.all([service.handleAction(request), service.handleAction(request)]);
  assert.equal([left, right].filter((entry) => entry.status === 'settled' && entry.result.changed).length, 1);
  assert.equal(awards, 1);
  assert.equal(repository.get('owned').xpAwarded, 50);
  db.close();
});
