const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/features/work/repositories/database');
const { WorkRepository } = require('../src/features/work/repositories/workRepository');
const { CAREERS, DAY_MS } = require('../src/features/work/data/careers');
const { jobsPayload, firedPayload } = require('../src/features/work/components/careers');
const { settledPayload } = require('../src/features/work/components/builders');
const { messagePayloadErrors } = require('../src/features/shared/discordPayload');
const { createWorkFeature } = require('../src/features/work');
function setup(t) {
  let now = 1000000, sequence = 0;
  const db = openDatabase({ databasePath: ':memory:' });
  t.after(() => db.close());
  const repo = new WorkRepository(db, { clock: () => now });
  repo.profile('u'); repo.achievements.ensure('u');
  function qualify(level = 100, total = 5010) {
    db.prepare('UPDATE work_profiles SET level=? WHERE user_id=?').run(level, 'u');
    db.prepare('UPDATE achievement_progress SET work=? WHERE user_id=?').run(total, 'u');
  }
  function create() {
    return repo.create({ sessionId: String(++sequence), userId: 'u', guildId: 'g', channelId: 'c',
      job: 'burger', difficulty: 'easy', deadline: now + 60000, state: {}, baseSalary: 100,
      xpReward: 0, bypassCooldown: true });
  }
  function work(status = 'succeeded') {
    const created = create(); assert.equal(created.status, 'created');
    return repo.settle(created.session.sessionId, status);
  }
  return { db, repo, qualify, create, work, advance: ms => { now += ms; }, now: () => now };
}
test('catalog follows all formulas, rounded-up requirements and decade boundaries', () => {
  assert.equal(CAREERS.length, 100);
  assert.equal(CAREERS[0].name, 'Leaf Raker');
  assert.equal(CAREERS[99].name, 'Chief Executive Officer');
  assert.equal(CAREERS[99].totalRequired, 5010);
  assert.equal(CAREERS[99].salary, 1000200);
  for (const [i, job] of CAREERS.entries()) {
    assert.equal(job.salary, (i + 1) ** 3 + i + 101);
    assert.equal(job.totalRequired, Math.ceil(10 + 5 * (i + 1) ** 1.5));
  }
  assert.deepEqual([0, 9, 10, 88, 89, 90, 99].map(i => CAREERS[i].dailyRequired), [3, 3, 4, 11, 12, 12, 12]);
});
test('applications validate both requirements, active games and exact 24-hour job changes', t => {
  const { db, repo, qualify, create, work, advance } = setup(t);
  assert.equal(repo.applyCareer('u', 1).status, 'requirements');
  qualify(1, 14); assert.equal(repo.applyCareer('u', 1).status, 'requirements');
  qualify(1, 5010); assert.equal(repo.applyCareer('u', 2).status, 'requirements');
  qualify(); const active = create();
  assert.equal(repo.applyCareer('u', 1).status, 'active'); repo.abortSend(active.session.sessionId);
  assert.equal(repo.applyCareer('u', 1).status, 'applied');
  db.prepare('UPDATE work_profiles SET salary_boost=40 WHERE user_id=?').run('u');
  assert.equal(repo.applyCareer('u', 2).status, 'cooldown');
  for (let i = 0; i < 3; i++) work();
  advance(DAY_MS - 1); assert.equal(repo.applyCareer('u', 2).status, 'cooldown');
  advance(1); assert.equal(repo.applyCareer('u', 2).status, 'applied');
  assert.equal(repo.profile('u').dailyCompleted, 0);
  assert.equal(repo.profile('u').salaryBoost, 0);
});
test('CEO boost milestones stack once per daily tier, survive failure and reset only upon firing', t => {
  const { repo, qualify, work, advance, create, now } = setup(t);
  qualify(); repo.applyCareer('u', 100);
  let result;
  for (let i = 1; i <= 98; i++) {
    result = work();
    assert.equal(result.boostIncreased, [17,22,28,35,43,52,62,73,85,98].includes(i));
    assert.equal(repo.settle(result.session.sessionId, 'succeeded').changed, false);
  }
  assert.equal(repo.profile('u').salaryBoost, 100);
  assert.deepEqual(messagePayloadErrors(settledPayload(result.session, result)), []);
  work('failed'); assert.equal(repo.profile('u').salaryBoost, 100);
  advance(DAY_MS); let p = repo.employment('u');
  assert.equal(p.dailyCompleted, 0); assert.equal(p.salaryBoost, 100);
  for (let i = 0; i < 17; i++) work();
  assert.equal(repo.profile('u').salaryBoost, 110);
  advance(DAY_MS); repo.employment('u');
  advance(DAY_MS); assert.equal(create().status, 'fired');
  p = repo.profile('u'); assert.equal(p.salaryBoost, 0); assert.equal(p.careerId, null);
  assert.equal(p.jobChangeUntil, now() + DAY_MS);
  assert.equal(repo.applyCareer('u', 100).status, 'cooldown');
  advance(DAY_MS); assert.equal(repo.applyCareer('u', 100).status, 'applied');
});
test('missing an entire later day fires even if the first day was completed; restart preserves employment', t => {
  const { repo, db, qualify, work, advance, now } = setup(t);
  qualify(); repo.applyCareer('u', 1); for (let i = 0; i < 3; i++) work();
  const restarted = new WorkRepository(db, { clock: now });
  assert.equal(restarted.profile('u').dailyCompleted, 3);
  advance(DAY_MS * 2); assert.equal(restarted.employment('u').careerId, null);
});
test('salary uses the career formula and additive Reliable points with Career Worker multiplier', t => {
  const { repo, db, qualify, work } = setup(t);
  qualify(); repo.applyCareer('u', 100);
  db.prepare('UPDATE work_profiles SET salary_boost=100 WHERE user_id=?').run('u');
  db.prepare('INSERT INTO achievement_medals VALUES (?,?,?)').run('u', 'career_worker', 4);
  db.prepare('INSERT INTO achievement_medals VALUES (?,?,?)').run('u', 'reliable_employee', 4);
  assert.equal(work().session.salaryCredited, Number(1000200n * 22000n * 10750n / 100000000n));
});
test('all job pages have valid Discord payloads with eligible, locked and applied buttons', t => {
  const { repo, qualify } = setup(t);
  for (let page = 0; page < 20; page++) assert.deepEqual(messagePayloadErrors(jobsPayload('u', repo.profile('u'), page)), []);
  let page = jobsPayload('u', repo.profile('u'));
  let section = page.components[0].components.find(c => c.type === 9);
  assert.equal(section.accessory.style, 4); assert.equal(section.accessory.disabled, true);
  qualify(); page = jobsPayload('u', repo.profile('u'));
  section = page.components[0].components.find(c => c.type === 9);
  assert.equal(section.accessory.style, 3); assert.equal(section.accessory.label, 'Apply');
  repo.applyCareer('u', 1); page = jobsPayload('u', repo.profile('u'));
  assert.doesNotMatch(JSON.stringify(page), /Job application\/change cooldown/);
  section = page.components[0].components.find(c => c.type === 9);
  assert.equal(section.accessory.label, 'Applied'); assert.equal(section.accessory.disabled, true);
  assert.deepEqual(messagePayloadErrors(firedPayload('u', repo.profile('u'))), []);
});
test('job buttons enforce owner and channel restrictions and navigate/apply on the same message', async t => {
  const { db, repo, qualify, now } = setup(t);
  let allowed = true, edited, replied, followedUp;
  const feature = createWorkFeature({ db, repository: repo, clock: now, isCommandAllowed: () => allowed });
  t.after(() => feature.close());
  const click = (action, user = 'u') => feature.handleInteraction({
    isButton: () => true, customId: `cswork:u:${action}`, user: { id: user }, guildId: 'g', channelId: 'c',
    async deferUpdate() { this.deferred = true; }, async reply(payload) { replied = payload; },
    async followUp(payload) { followedUp = payload; },
    message: { id: 'm', async edit(payload) { edited = payload; } },
  });
  await click('jobs-0', 'other'); assert.ok(replied); assert.equal(edited, undefined);
  replied = undefined; allowed = false; await click('apply-1'); assert.ok(replied); assert.equal(repo.profile('u').careerId, null);
  allowed = true; qualify(); await click('jobs-19'); assert.match(JSON.stringify(edited), /Page 20 \/ 20/);
  await click('apply-100'); assert.equal(repo.profile('u').careerId, 100); assert.match(JSON.stringify(edited), /Applied/);
  edited = undefined; followedUp = undefined;
  await click('apply-99'); assert.equal(edited, undefined); assert.equal(followedUp.flags, 64);
  assert.match(followedUp.content, /You still have a job application cooldown/);
  await click('home'); assert.match(JSON.stringify(edited), /Job list/);
});
test('a late success cannot restore employment or collect salary after a menu detects firing', t => {
  const { repo, qualify, create, advance } = setup(t);
  qualify(); repo.applyCareer('u', 1); const active = create(); advance(DAY_MS);
  repo.employment('u');
  const result = repo.settle(active.session.sessionId, 'succeeded');
  assert.equal(result.session.status, 'failed'); assert.equal(result.session.salaryCredited, 0);
  assert.equal(result.profile.salaryBoost, 0);
});
