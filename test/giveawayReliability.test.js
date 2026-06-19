const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { toV2Payload, withoutComponentEmojis } = require('../src/giveawayUtils');

const root = path.resolve(__dirname, '..');

test('giveaway payloads remove component emoji fields before Discord validation', () => {
  const components = [{
    type: 1,
    components: [{
      type: 2,
      custom_id: 'giveaway:test',
      label: 'Claim',
      style: 3,
      emoji: { id: '123456789012345678', name: 'deleted_emoji' },
    }],
  }];
  const sanitized = withoutComponentEmojis(components);
  assert.equal(sanitized[0].components[0].emoji, undefined);
  assert.equal(sanitized[0].components[0].label, 'Claim');
  assert.equal(toV2Payload(components).components[0].components[0].emoji, undefined);
});

test('giveaway timers log and retry failures instead of swallowing them', () => {
  const runtime = fs.readFileSync(path.join(root, 'src', 'giveawayRuntime.js'), 'utf8');
  assert.doesNotMatch(runtime, /await callback\(\)\.catch\(\(\) => null\)/);
  assert.match(runtime, /Giveaway timer \$\{key\} failed; retrying/);
  assert.match(runtime, /scheduleAt\(key, now\(\) \+ GIVEAWAY_RETRY_DELAY_MS, callback\)/);
});

test('claim-round creation rolls back when Discord does not create a message', () => {
  const runtime = fs.readFileSync(path.join(root, 'src', 'giveawayRuntime.js'), 'utf8');
  assert.match(runtime, /if \(!message\) \{/);
  assert.match(runtime, /giveaway\.rounds\.pop\(\)/);
  assert.match(runtime, /giveaway\.rolledUserIds\.splice\(originalRolledLength\)/);
  assert.match(runtime, /Failed to create claim message/);
});

test('giveaway end state is persisted only after the claim round exists', () => {
  const runtime = fs.readFileSync(path.join(root, 'src', 'giveawayRuntime.js'), 'utf8');
  const endGiveaway = runtime.match(/async function endGiveaway[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(endGiveaway.indexOf('await createClaimRound(giveaway, winners);') >= 0);
  assert.ok(endGiveaway.lastIndexOf('persistState(state);') > endGiveaway.indexOf('await createClaimRound(giveaway, winners);'));
});


test('reroll closes the old round only after its replacement message exists', () => {
  const runtime = fs.readFileSync(path.join(root, 'src', 'giveawayRuntime.js'), 'utf8');
  const reroll = runtime.match(/async function startNextReroll[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(reroll.indexOf('await createClaimRound(giveaway, winnerIds);') >= 0);
  assert.ok(reroll.lastIndexOf("round.status = 'rerolled';") > reroll.indexOf('await createClaimRound(giveaway, winnerIds);'));
});


test('overdue giveaway recovery retries after startup failures', () => {
  const runtime = fs.readFileSync(path.join(root, 'src', 'giveawayRuntime.js'), 'utf8');
  assert.match(runtime, /Overdue giveaway \$\{giveaway\.id\} recovery failed; retrying/);
  assert.match(runtime, /scheduleAt\(claimTimerKey\(giveaway\.id, activeRound\.roundNumber\), now\(\) \+ GIVEAWAY_RETRY_DELAY_MS/);
});
