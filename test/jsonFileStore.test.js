const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');
const {
  backupFileOnce,
  readJsonFile,
  recoveryLogPath,
  writeJsonAtomic,
  __test,
} = require('../src/jsonFileStore');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-json-store-'));
after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('atomic JSON writes serialize by path and leave no temporary files', () => {
  const target = path.join(directory, 'state.json');
  writeJsonAtomic(target, { version: 1 });
  writeJsonAtomic(target, { version: 2 });
  assert.deepEqual(readJsonFile(target), { version: 2 });
  assert.equal(__test.writeQueues.size, 0);
  assert.deepEqual(fs.readdirSync(directory).filter((name) => name.includes('.tmp-')), []);
});

test('migration backups are created once and never overwritten', () => {
  const target = path.join(directory, 'migration.json');
  const backup = target + '.v1.bak';
  fs.writeFileSync(target, '{"version":1}', 'utf8');
  assert.equal(backupFileOnce(target, backup), true);
  fs.writeFileSync(target, '{"version":2}', 'utf8');
  assert.equal(backupFileOnce(target, backup), false);
  assert.equal(fs.readFileSync(backup, 'utf8'), '{"version":1}');
});

test('invalid JSON is logged and left unchanged', () => {
  const target = path.join(directory, 'broken.json');
  fs.writeFileSync(target, '{broken', 'utf8');
  assert.throws(() => readJsonFile(target, { label: 'Test store' }), /invalid JSON/);
  assert.equal(fs.readFileSync(target, 'utf8'), '{broken');
  assert.match(fs.readFileSync(recoveryLogPath(target), 'utf8'), /Test store contains invalid JSON/);
});
