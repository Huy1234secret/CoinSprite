const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildAnnouncementPayload,
  buildPrizeSummary,
  calculateLuckBonusPercent,
  formatChancePercent,
  formatPrizeAwardLine,
  getAdjustedChance,
  isEventActive,
  rollAvailablePrizes,
} = require('../src/wordChainEventManager');
const { loadEventState, saveEventState } = require('../src/wordChainEventStore');

const fixturePath = path.join(__dirname, '..', 'data', 'word-chain-event.json');

function fixture() {
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

test('Word Chain event luck increases every 40 streak and caps at 100 percent', () => {
  assert.equal(calculateLuckBonusPercent(0), 0);
  assert.equal(calculateLuckBonusPercent(39), 0);
  assert.equal(calculateLuckBonusPercent(40), 10);
  assert.equal(calculateLuckBonusPercent(399), 90);
  assert.equal(calculateLuckBonusPercent(400), 100);
  assert.equal(calculateLuckBonusPercent(1000), 100);

  const prize = { chanceDenominator: 10_000 };
  assert.equal(getAdjustedChance(prize, 0), 0.001);
  assert.equal(getAdjustedChance(prize, 400), 0.002);
  assert.equal(formatChancePercent(getAdjustedChance(prize, 40)), '0.11%');
  assert.equal(formatPrizeAwardLine([{ prizeName: 'Mushroom' }]), '🎁 Event prize won: **Mushroom**');
});

test('Word Chain event rolls every in-stock prize independently and never oversells', () => {
  const state = fixture();
  const now = Date.parse('2026-07-09T00:00:00.000Z');
  const context = {
    userId: '123456789012345678',
    guildId: state.guildId,
    channelId: state.gameChannelId,
    messageId: '234567890123456789',
    word: 'garden',
    streak: 400,
  };

  assert.equal(isEventActive(state, now), true);
  const awards = rollAvailablePrizes(state, context, () => 0, now);
  assert.equal(awards.length, state.prizes.length);
  assert.equal(state.awards.length, state.prizes.length);
  assert.equal(state.prizeSummary[context.userId].Mushroom, 1);
  assert.equal(state.prizeSummary[context.userId].Unicorn, 1);
  assert.equal(state.prizes.find((prize) => prize.id === 'unicorn').amountLeft, 0);
  assert.equal(state.prizes.find((prize) => prize.id === 'venus_fly_trap').amountLeft, 1);

  const secondAwards = rollAvailablePrizes(state, { ...context, messageId: '345678901234567890' }, () => 0, now + 1);
  assert.equal(secondAwards.some((award) => award.prizeId === 'unicorn'), false);
  assert.equal(state.prizes.find((prize) => prize.id === 'venus_fly_trap').amountLeft, 0);
  assert.equal(state.prizeSummary[context.userId]['Venus Fly Trap'], 2);
  assert.equal(state.prizeSummary[context.userId].Unicorn, 1);
});

test('Word Chain event rebuilds a per-user summary from the retained award log', () => {
  const awards = [
    { userId: '123456789012345678', prizeName: 'Mushroom' },
    { userId: '123456789012345678', prizeName: 'Mushroom' },
    { userId: '123456789012345678', prizeName: 'Golden Seed' },
    { userId: '234567890123456789', prizeName: 'Unicorn' },
  ];

  assert.deepEqual(buildPrizeSummary(awards), {
    '123456789012345678': { Mushroom: 2, 'Golden Seed': 1 },
    '234567890123456789': { Unicorn: 1 },
  });
});

test('Word Chain event announcement uses one green Components V2 prize panel', () => {
  const state = fixture();
  const payload = buildAnnouncementPayload(state, 40, Date.parse('2026-07-09T00:00:00.000Z'));
  const container = payload.components[0];
  const rendered = container.components.filter((component) => component.type === 10).map((component) => component.content).join('\n');

  assert.equal(payload.flags, 32768);
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, 0x57f287);
  assert.equal(container.components.filter((component) => component.type === 14).length, 2);
  assert.match(rendered, /## Word Chain event/);
  assert.match(rendered, /<#1512480152410525958>/);
  assert.match(rendered, /Unicorn `0\.11%` - 1/);
  assert.match(rendered, /Mushroom `44%` - 105/);
  assert.match(rendered, /Prize chances are boosted \*\*10x\*\*/);
  assert.match(rendered, /Every 40 streak = \+10% luck/);
});

test('Word Chain event data round-trips through its dedicated JSON store', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-word-chain-event-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'event.json');
  const state = fixture();
  state.announcementMessageId = '456789012345678901';

  saveEventState(state, filePath);
  assert.deepEqual(loadEventState(filePath), state);
});
