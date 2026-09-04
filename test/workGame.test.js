const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { featureCommandsForConfig } = require('../src/applicationCommands');
const { messagePayloadErrors, payloadMetrics } = require('../src/features/shared/discordPayload');
const { BURGER_MESSAGES, BURGER_ORDER_SEEDS } = require('../src/features/work/data/burgerOrders');
const { PIPE_EMOJIS } = require('../src/features/work/data/emojis');
const { TRASH_ITEMS } = require('../src/features/work/data/trashItems');
const { activeGamePayload, cooldownPayload } = require('../src/features/work/components/builders');
const { parseWorkCommand } = require('../src/features/work/commands');
const { createWorkFeature } = require('../src/features/work');
const { applyBurgerAction, createBurgerGame } = require('../src/features/work/games/burger');
const { BUILTIN_PAIRS, applyElectricianAction, createElectricianGame } = require('../src/features/work/games/electrician');
const {
  DIRECTION_BITS, DIRECTIONS, LAYOUTS, OPPOSITE, PIECES, applyPlumberAction,
  createPlumberGame, openMask, validatePlumber,
} = require('../src/features/work/games/plumber');
const { applyTrashAction, createTrashGame } = require('../src/features/work/games/trash');
const { openDatabase } = require('../src/features/work/repositories/database');
const {
  MAX_BRONZE_BALANCE, WORK_COOLDOWN_MS, WorkRepository, applyWorkXp, requiredXp,
} = require('../src/features/work/repositories/workRepository');
const { JOB_CONFIG, WorkService, rewardsFor, scaledReward, timerSeconds } = require('../src/features/work/services/workService');
const { gameCommandAllowed, normalizeGamesConfig, normalizeState } = require('../src/serverConfig');

const GUILD = '123456789012345678';
const OTHER_GUILD = '123456789012345679';
const CHANNEL = '223456789012345678';
const OTHER_CHANNEL = '223456789012345679';
const USER = '323456789012345678';
const MESSAGE = '423456789012345678';

function sequence(values) { let index = 0; return () => values[index++ % values.length]; }
function memory(clock = () => 1_000_000) {
  const db = openDatabase({ databasePath: ':memory:' });
  return { db, repository: new WorkRepository(db, { clock }) };
}
function sessionInput(overrides = {}) {
  return {
    sessionId: 'session', guildId: GUILD, channelId: CHANNEL, userId: USER,
    job: 'burger', difficulty: 'easy', normalizedDifficulty: 0,
    deadline: 2_000_000, state: { target: ['bottom_bun'], cursor: 0, buttons: ['bottom_bun'], message: 'A customer says:\n> One bun?' },
    baseSalary: 100, xpReward: 25, ...overrides,
  };
}

test('/cs-work is registered for every enabled guild and cswork parsing is exact and case-insensitive', () => {
  assert.deepEqual(featureCommandsForConfig({ enabled: false }), []);
  const commands = featureCommandsForConfig({ enabled: true, features: { leveling: false }, leveling: { enabled: false } });
  assert.ok(commands.some((command) => command.name === 'cs-work' && command.description === 'Start a random work minigame.'));
  for (const value of ['cswork', ' CSWORK ', '\ncsWork\t']) assert.equal(parseWorkCommand(value), true);
  for (const value of ['cs-work', 'cswork extra', 'csworker', 'xcswork', '']) assert.equal(parseWorkCommand(value), false);
});

test('Game command settings normalize multiple selections and default to unrestricted access', () => {
  assert.deepEqual(normalizeGamesConfig({}), { commandSettings: [] });
  const games = normalizeGamesConfig({ commandSettings: [
    { id: 'first', channelIds: [CHANNEL, OTHER_CHANNEL, 'bad', CHANNEL], commands: ['cs-work', 'cs-balance', 'cs-inventory', 'bad'] },
    { id: 'second', channelIds: [OTHER_CHANNEL], commands: ['cs-work'] },
  ] });
  assert.deepEqual(games.commandSettings[0], { id: 'first', channelIds: [CHANNEL, OTHER_CHANNEL], commands: ['cs-work', 'cs-balance', 'cs-inventory'] });
  const normalized = normalizeState({ guilds: { [GUILD]: { games } } });
  assert.deepEqual(normalized.guilds[GUILD].games, games);
  assert.equal(gameCommandAllowed({}, CHANNEL, 'cs-work'), true);
  assert.equal(gameCommandAllowed({ games }, CHANNEL, 'cs-work'), true);
  assert.equal(gameCommandAllowed({ games }, OTHER_CHANNEL, 'cs-balance'), true);
  assert.equal(gameCommandAllowed({ games }, OTHER_CHANNEL, 'cs-inventory'), true);
  assert.equal(gameCommandAllowed({ games }, '999', 'cs-work'), false);
});

test('Burger catalog yields at least 100 unique natural phrases and recipes with ordered duplicate support', () => {
  assert.equal(new Set(BURGER_MESSAGES).size, 100);
  assert.equal(new Set(BURGER_ORDER_SEEDS.map(JSON.stringify)).size, 100);
  assert.ok(BURGER_ORDER_SEEDS.some((seed) => new Set(seed).size < seed.length));
  for (const seed of BURGER_ORDER_SEEDS) assert.ok(seed.length >= 3 && seed.length <= 23);
  for (let index = 0; index < 100; index += 1) {
    const state = createBurgerGame(['easy', 'normal', 'hard', 'expert'][index % 4], sequence([(index + 0.5) / 101, 0.25, 0.75]));
    assert.equal(state.target[0], 'bottom_bun');
    assert.equal(state.target.at(-1), 'top_bun');
    assert.ok(state.target.length >= 5 && state.target.length <= 25);
    assert.equal(new Set(state.buttons).size, state.buttons.length);
    assert.ok(state.target.every((ingredient) => state.buttons.includes(ingredient)));
    assert.match(state.message, /^A customer says:\n> /);
  }
  const repeated = { target: ['bottom_bun', 'beef_patty', 'cheese', 'beef_patty', 'top_bun'], cursor: 0, buttons: ['cheese', 'top_bun', 'beef_patty', 'bottom_bun'] };
  for (const ingredient of repeated.target) assert.notEqual(applyBurgerAction(repeated, ingredient).outcome, 'failed');
  assert.equal(repeated.cursor, 5);
  assert.equal(applyBurgerAction({ target: ['bottom_bun'], cursor: 0, buttons: ['bottom_bun', 'cheese'] }, 'cheese').outcome, 'failed');
});

test('Trash Sorter covers six unambiguous catalogs, 3–20 items, and sequential correctness', () => {
  assert.deepEqual(Object.keys(TRASH_ITEMS), ['recycle', 'organic', 'medical', 'hazardous', 'glass', 'general']);
  for (const items of Object.values(TRASH_ITEMS)) assert.equal(new Set(items).size, 20);
  const minimum = createTrashGame('easy', () => 0);
  const maximum = createTrashGame('expert', () => 0.9999);
  assert.equal(minimum.required, 3);
  assert.equal(maximum.required, 20);
  assert.equal(new Set(maximum.items.map((entry) => entry.item)).size, 20);
  const first = minimum.items[0];
  assert.equal(applyTrashAction(minimum, first.category).outcome, 'active');
  const wrong = Object.keys(TRASH_ITEMS).find((category) => category !== minimum.items[1].category);
  assert.equal(applyTrashAction(minimum, wrong).outcome, 'failed');
});

test('Electrician generates 6–24 accessible buttons, unique pairs, selection, matching, and mismatch failure', () => {
  assert.equal(BUILTIN_PAIRS.length, 12);
  for (const [difficulty, expected] of [['easy', 6], ['expert', 24]]) {
    const state = createElectricianGame(difficulty, () => difficulty === 'easy' ? 0 : 0.9999);
    assert.equal(state.buttons.length, expected);
    assert.equal(state.buttons.length % 2, 0);
    assert.equal(new Set(state.buttons.map((button) => button.pair)).size, expected / 2);
    assert.ok(state.buttons.every((button) => /circle|square/.test(button.label)));
  }
  const state = createElectricianGame('easy', () => 0);
  assert.equal(applyElectricianAction(state, 'wire-0').outcome, 'active');
  assert.equal(state.selected, 0);
  const mate = state.buttons.findIndex((button, index) => index > 0 && button.pair === state.buttons[0].pair);
  assert.equal(applyElectricianAction(state, `wire-${mate}`).outcome, 'active');
  assert.equal(state.matched.length, 1);
  const available = state.buttons.map((button, index) => ({ button, index })).filter(({ button }) => !state.matched.includes(button.pair));
  applyElectricianAction(state, `wire-${available[0].index}`);
  assert.equal(applyElectricianAction(state, `wire-${available.find(({ button }) => button.pair !== available[0].button.pair).index}`).outcome, 'failed');
});

test('Plumber boards are solvable 5×5 networks with edge valves, bitmask rotations, no leaks, and no islands', () => {
  let seed = 0x12345678;
  const rng = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let index = 0; index < 500; index += 1) {
    const difficulty = Object.keys(LAYOUTS)[index % 4];
    const state = createPlumberGame(difficulty, rng);
    assert.equal(state.cells.length, 25);
    assert.ok(state.valveCount >= 2 && state.valveCount <= 6);
    assert.equal(validatePlumber(state), false);
    for (const valve of state.cells.filter((cell) => cell.type === 'valve')) {
      assert.ok(valve.row === 0 || valve.row === 4 || valve.column === 0 || valve.column === 4);
      assert.equal(valve.sides.length, 1);
      const [dr, dc] = DIRECTIONS[valve.sides[0]];
      assert.ok(valve.row + dr >= 0 && valve.row + dr < 5 && valve.column + dc >= 0 && valve.column + dc < 5);
    }
    for (const cell of state.cells) if (cell.type === 'pipe') cell.piece = cell.solution;
    assert.equal(validatePlumber(state), true);
    const pipe = state.cells.find((cell) => cell.type === 'pipe');
    pipe.piece = PIECES[pipe.piece].next;
    assert.equal(validatePlumber(state), false);
  }
  for (const [name, piece] of Object.entries(PIECES)) {
    assert.equal(piece.mask, piece.sides.reduce((mask, side) => mask | DIRECTION_BITS[side], 0));
    let rotated = name;
    for (let count = 0; count < 4; count += 1) rotated = PIECES[rotated].next;
    assert.equal(rotated, name);
    assert.deepEqual(new Set(PIECES[piece.next].sides), new Set(piece.sides.map((side) => ({ N: 'E', E: 'S', S: 'W', W: 'N' })[side])));
  }
  assert.equal(PIPE_EMOJIS.ne.name, 'CSPipe22');
  assert.equal(openMask({ type: 'pipe', piece: 'NE' }), DIRECTION_BITS.N | DIRECTION_BITS.E);
  const state = createPlumberGame('easy', () => 0);
  const index = state.cells.findIndex((cell) => cell.type === 'pipe');
  const before = state.cells[index].piece;
  assert.equal(applyPlumberAction(state, `pipe-${index}`).outcome, 'active');
  assert.equal(state.cells[index].piece, PIECES[before].next);
});

test('normalized reward and timer formulas hit the specified deterministic bounds', () => {
  for (const [job, config] of Object.entries(JOB_CONFIG)) {
    assert.deepEqual(rewardsFor(job, 0), { baseSalary: config.salary[0], xpReward: config.xp[0] });
    assert.deepEqual(rewardsFor(job, 1), { baseSalary: config.salary[1], xpReward: config.xp[1] });
  }
  assert.equal(scaledReward([10, 140], 0.5), 75);
  assert.equal(timerSeconds('burger', { target: Array(5) }), 45);
  assert.equal(timerSeconds('burger', { target: Array(25) }), 105);
  assert.equal(timerSeconds('trash', { required: 3 }), 40);
  assert.equal(timerSeconds('trash', { required: 20 }), 105);
  assert.equal(timerSeconds('electrician', { buttons: Array(6) }), 45);
  assert.equal(timerSeconds('electrician', { buttons: Array(24) }), 97);
  assert.equal(timerSeconds('plumber', { rotatablePipes: 20, minimumSolutionRotations: 60 }), 230);
});

test('Work XP carries over multiple levels and requires exactly one token per level', () => {
  assert.equal(requiredXp(1), 100);
  assert.equal(requiredXp(2), 160);
  assert.equal(requiredXp(3), 240);
  assert.deepEqual(applyWorkXp(1, 90, 25), { level: 2, xp: 15, levelsGained: 1 });
  assert.deepEqual(applyWorkXp(1, 0, 1_000), { level: 5, xp: 160, levelsGained: 4 });
});

test('success atomically applies global cooldown, new-streak salary, shared Bronze cap, Work XP, and inventory once', () => {
  let now = 1_000_000;
  const { db, repository } = memory(() => now);
  repository.profile(USER);
  db.prepare('UPDATE work_profiles SET xp=90,streak=11 WHERE user_id=?').run(USER);
  db.prepare('INSERT INTO counting_bronze_balances (user_id,balance,updated_at) VALUES (?,?,?)').run(USER, MAX_BRONZE_BALANCE - 5n, 0);
  assert.equal(repository.create(sessionInput()).status, 'created');
  repository.attachMessage('session', MESSAGE);
  const first = repository.settle('session', 'succeeded');
  assert.equal(first.changed, true);
  assert.equal(first.finalSalary, 112);
  assert.equal(first.session.salaryCredited, 5);
  assert.equal(repository.balance(USER), MAX_BRONZE_BALANCE);
  assert.deepEqual(first.profile, { userId: USER, level: 2, xp: 15, streak: 12, cooldownUntil: now + WORK_COOLDOWN_MS });
  assert.equal(repository.inventory(USER), 1);
  assert.equal(repository.settle('session', 'succeeded').changed, false);
  assert.equal(repository.balance(USER), MAX_BRONZE_BALANCE);
  assert.equal(repository.inventory(USER), 1);
  assert.equal(repository.create(sessionInput({ sessionId: 'other-guild', guildId: OTHER_GUILD })).status, 'cooldown');
  now += WORK_COOLDOWN_MS;
  assert.equal(repository.create(sessionInput({ sessionId: 'ready', guildId: OTHER_GUILD })).status, 'created');
  db.close();
});

test('wrong answers and timeouts award nothing, reset streak, and start exactly ten minutes cooldown', () => {
  let now = 5_000_000;
  const { db, repository } = memory(() => now);
  repository.profile(USER);
  db.prepare('UPDATE work_profiles SET streak=25 WHERE user_id=?').run(USER);
  repository.create(sessionInput({ baseSalary: 350, xpReward: 180 }));
  const failed = repository.settle('session', 'failed', 'Wrong ingredient.');
  assert.equal(failed.profile.streak, 0);
  assert.equal(failed.profile.cooldownUntil, now + 600_000);
  assert.equal(failed.session.salaryCredited, 0);
  assert.equal(failed.session.xpAwarded, 0);
  now += WORK_COOLDOWN_MS;
  repository.create(sessionInput({ sessionId: 'timeout' }));
  const timedOut = repository.settle('timeout', 'timed_out', 'Time ran out.');
  assert.equal(timedOut.profile.cooldownUntil, now + 600_000);
  assert.equal(repository.balance(USER), 0n);
  db.close();
});

test('service starts immediately, prevents a second active session, restricts ownership, and settles duplicate delivery once', async () => {
  const { db, repository } = memory();
  const service = new WorkService(repository, {
    clock: () => 1_000_000, rng: () => 0, createId: () => 'live',
    setTimer: () => ({ unref() {} }), clearTimer() {},
  });
  let sentPayload;
  const started = await service.start({ guildId: GUILD, channelId: CHANNEL, userId: USER }, async (payload) => {
    sentPayload = payload;
    return MESSAGE;
  });
  assert.equal(started.status, 'started');
  assert.equal(started.session.job, 'trash');
  assert.equal(messagePayloadErrors(sentPayload).length, 0);
  assert.equal((await service.start({ guildId: OTHER_GUILD, channelId: OTHER_CHANNEL, userId: USER }, async () => 'never')).status, 'active');
  const action = started.session.state.items[0].category;
  const denied = await service.handleAction({ sessionId: 'live', action, userId: '999', guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE });
  assert.equal(denied.status, 'denied');
  let result;
  while (repository.get('live').status === 'active') {
    const current = repository.get('live');
    result = await service.handleAction({
      sessionId: 'live', action: current.state.items[current.state.sorted].category,
      userId: USER, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE,
    });
  }
  assert.equal(result.result.changed, true);
  const duplicate = await service.handleAction({ sessionId: 'live', action, userId: USER, guildId: GUILD, channelId: CHANNEL, messageId: MESSAGE });
  assert.equal(duplicate.status, 'inactive');
  assert.equal(repository.profile(USER).streak, 1);
  service.close();
  db.close();
});

test('feature routing ignores unsafe messages, starts cswork before Counting, denies other users ephemerally, and Back shows status', async () => {
  let now = 1_000_000;
  const { db } = memory(() => now);
  const feature = createWorkFeature({
    db, clock: () => now, rng: () => 0, createId: () => 'feature',
    setTimer: () => ({ unref() {} }), clearTimer() {}, isCommandAllowed: () => true,
  });
  assert.equal(await feature.handleMessage({ guildId: null, content: 'cswork', author: { id: USER } }), false);
  assert.equal(await feature.handleMessage({ guildId: GUILD, content: 'cswork', author: { id: USER, bot: true } }), false);
  let initial;
  const messageSource = {
    guildId: GUILD, channelId: CHANNEL, content: ' CSWORK ', author: { id: USER },
    async reply(payload) { initial = payload; return { id: MESSAGE }; },
  };
  assert.equal(await feature.handleMessage(messageSource), true);
  assert.match(initial.components[0].components[0].content, /You're a Trash Sorter/);
  const session = feature.repository.get('feature');
  let deniedPayload;
  await feature.handleInteraction({
    isChatInputCommand: () => false, isButton: () => true,
    customId: `cswork:${session.sessionId}:${session.state.items[0].category}`,
    user: { id: '999' }, guildId: GUILD, channelId: CHANNEL, message: { id: MESSAGE },
    async reply(payload) { deniedPayload = payload; },
  });
  assert.ok(deniedPayload.flags);
  feature.repository.settle('feature', 'failed', 'Wrong category.');
  let edited;
  await feature.handleInteraction({
    isChatInputCommand: () => false, isButton: () => true, customId: 'cswork:feature:back',
    user: { id: USER }, guildId: GUILD, channelId: CHANNEL,
    deferred: false, replied: false, async deferUpdate() {},
    message: { id: MESSAGE, async edit(payload) { edited = payload; } },
  });
  assert.match(edited.components[0].components[0].content, new RegExp(`<@${USER}>.*<t:${Math.floor((now + WORK_COOLDOWN_MS) / 1000)}:R>`));
  assert.match(edited.components[0].components[2].content, /Work Level: 1 `0\/100`/);
  feature.close();
  db.close();
});

test('Components V2 payloads stay within limits with unique compact IDs and exact status/article content', () => {
  const states = {
    burger: createBurgerGame('expert', () => 0.9999),
    trash: createTrashGame('expert', () => 0.9999),
    electrician: createElectricianGame('expert', () => 0.9999),
    plumber: createPlumberGame('expert', () => 0.9999),
  };
  for (const [job, state] of Object.entries(states)) {
    const payload = activeGamePayload({ sessionId: `max-${job}`, job, state, deadline: 2_000_000 });
    assert.deepEqual(messagePayloadErrors(payload), []);
    const ids = [];
    const visit = (component) => {
      if (component.custom_id) ids.push(component.custom_id);
      for (const child of component.components || []) visit(child);
    };
    for (const component of payload.components) visit(component);
    assert.equal(new Set(ids).size, ids.length);
    assert.ok(ids.every((id) => id.startsWith('cswork:') && id.length <= 100));
    assert.ok(payloadMetrics(payload).components <= 40);
  }
  assert.match(activeGamePayload({ sessionId: 'a', job: 'electrician', state: states.electrician, deadline: 2_000_000 }).components[0].components[0].content, /You're an Electrician/);
  const cooldown = cooldownPayload(USER, 1_600_000, { userId: USER, level: 3, xp: 4, streak: 12, cooldownUntil: 1_600_000 });
  assert.match(cooldown.components[0].components[0].content, /<t:1600:R>/);
  assert.match(cooldown.components[0].components[2].content, /×1\.12 Earnings/);
  assert.equal(cooldown.components[0].components[3].components[0].disabled, true);
});

test('restart recovery expires persisted sessions once without duplicate reward and preserves the original deadline', async () => {
  let now = 1_000_000;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-work-'));
  const databasePath = path.join(directory, 'games.sqlite');
  let first;
  let reopened;
  try {
    first = openDatabase({ databasePath });
    const repository = new WorkRepository(first, { clock: () => now });
    repository.create(sessionInput({ sessionId: 'restart', deadline: now + 10 }));
    repository.attachMessage('restart', MESSAGE);
    first.close(); first = null;
    now += 11;
    reopened = openDatabase({ databasePath });
    const recoveredRepository = new WorkRepository(reopened, { clock: () => now });
    let edits = 0;
    const service = new WorkService(recoveredRepository, {
      clock: () => now, setTimer: () => ({ unref() {} }), clearTimer() {},
      onTimeout: async () => { edits += 1; },
    });
    assert.equal((await service.recover()).length, 1);
    assert.equal(recoveredRepository.get('restart').status, 'timed_out');
    assert.equal((await service.recover()).length, 0);
    assert.equal(edits, 1);
    assert.equal(recoveredRepository.balance(USER), 0n);
    assert.equal(recoveredRepository.profile(USER).cooldownUntil, now + WORK_COOLDOWN_MS);
    service.close();
    reopened.close(); reopened = null;
  } finally {
    if (first?.open) first.close();
    if (reopened?.open) reopened.close();
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  }
});
