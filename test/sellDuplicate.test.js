const assert = require('node:assert/strict');
const test = require('node:test');

const { buildTypePayload, buildTypePayloads, sellCycleFooter, splitPayloadByDisplayText } = require('../src/gag2Stock/stockPayload');
const {
  comparableComponent,
  componentFingerprint,
  findMatchingRecentSellMessages,
  sellMessageNextRefreshAtMs,
} = require('../src/gag2Stock/manager');

function discordifyComponent(plain) {
  const data = { ...plain };
  if (data.accent_color !== undefined) {
    data.accentColor = data.accent_color;
  }
  return {
    data,
    toJSON() { return this.data; },
    ...(Array.isArray(plain.components) ? {
      components: plain.components.map(discordifyComponent),
    } : {}),
    ...(plain.accessory ? {
      accessory: discordifyComponent(plain.accessory),
    } : {}),
  };
}

function discordifyPayload(payload) {
  return {
    components: (payload.components || []).map(discordifyComponent),
  };
}

function mockChannel(messages) {
  const messageMap = new Map(messages.map((m) => [m.id, m]));
  return {
    messages: {
      fetch: () => Promise.resolve({
        values: () => messageMap.values(),
      }),
    },
    isTextBased: () => true,
    send: (payload) => {
      const id = String(Date.now() + Math.random());
      const msg = mockMessage(id, 'bot123', payload.components, Date.now());
      messageMap.set(id, msg);
      return Promise.resolve(msg);
    },
  };
}

function mockMessage(id, authorId, components, createdTimestamp) {
  return {
    id,
    author: { id: authorId, bot: true },
    createdTimestamp,
    components: (components || []).map(discordifyComponent),
    delete: () => Promise.resolve(),
  };
}

const NEXT_REFRESH_AT_MS = 1800000000000;

const sellEntry = {
  nextRefreshAtMs: NEXT_REFRESH_AT_MS,
  fetchedAtMs: Date.now(),
  entries: [
    { key: 'starfruit', name: 'Starfruit', multiplier: 4.00, rarity: 'Super', tier: '' },
    { key: 'dragonfruit', name: 'Dragonfruit', multiplier: 2.50, rarity: 'Legendary', tier: '' },
    { key: 'golden_apple', name: 'Golden Apple', multiplier: 2.00, rarity: 'Super', tier: '' },
    { key: 'apple', name: 'Apple', multiplier: 1.20, rarity: 'Common', tier: '' },
    { key: 'orange', name: 'Orange', multiplier: 0.80, rarity: 'Common', tier: '' },
  ],
};

function getMultiPartPayloads() {
  const base = buildTypePayload('sell', sellEntry);
  return splitPayloadByDisplayText(base, 350);
}

test('every sell payload part contains parseable cycle identity after Discord serialization', () => {
  const payloads = getMultiPartPayloads();
  assert.ok(payloads.length >= 2, `expected at least 2 payload parts, got ${payloads.length}`);
  for (const payload of payloads) {
    const discordMsg = discordifyPayload(payload);
    const refreshAtMs = sellMessageNextRefreshAtMs(discordMsg);
    assert.equal(refreshAtMs, NEXT_REFRESH_AT_MS, 'each part should have the same refresh timestamp');
  }
});

test('4x part fingerprint does not match 2x part', () => {
  const payloads = getMultiPartPayloads();
  const fingerprints = payloads.map((p) => componentFingerprint(p.components));
  const unique = new Set(fingerprints);
  assert.equal(unique.size, payloads.length, 'each payload part should have a distinct fingerprint');
});

test('two copies of the 4x part converge to one', async () => {
  const payloads = getMultiPartPayloads();
  const fourXPayload = payloads[0];
  const fp = componentFingerprint(fourXPayload.components);
  
  const deletedIds = [];
  const msg1 = mockMessage('1001', 'bot123', fourXPayload.components, Date.now());
  const msg2 = mockMessage('1002', 'bot123', fourXPayload.components, Date.now() + 100);
  msg2.delete = () => { deletedIds.push('1002'); return Promise.resolve(); };
  
  const channel = mockChannel([msg1, msg2]);
  const matches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now());
  assert.equal(matches.length, 2, 'should find both copies');
  
  const keeper = matches[0];
  for (const dup of matches.slice(1)) await dup.message.delete();
  assert.deepEqual(deletedIds, ['1002']);
  assert.equal(keeper.message.id, '1001');
});

test('two copies of the 2x part converge to one', async () => {
  const payloads = getMultiPartPayloads();
  const twoXPayload = payloads[1]; 
  const fp = componentFingerprint(twoXPayload.components);
  
  const deletedIds = [];
  const msg1 = mockMessage('1003', 'bot123', twoXPayload.components, Date.now());
  const msg2 = mockMessage('1004', 'bot123', twoXPayload.components, Date.now() + 100);
  msg2.delete = () => { deletedIds.push('1004'); return Promise.resolve(); };
  
  const channel = mockChannel([msg1, msg2]);
  const matches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now());
  assert.equal(matches.length, 2, 'should find both copies');
  
  const keeper = matches[0];
  for (const dup of matches.slice(1)) await dup.message.delete();
  assert.deepEqual(deletedIds, ['1004']);
  assert.equal(keeper.message.id, '1003');
});

test('four messages (2x each part) converge to exactly two', async () => {
  const payloads = getMultiPartPayloads();
  assert.ok(payloads.length >= 2);
  
  const deletedIds = [];
  const allMessages = [];
  let idCounter = 2000;
  for (const payload of payloads) {
    for (let copy = 0; copy < 2; copy++) {
      const id = String(idCounter++);
      const msg = mockMessage(id, 'bot123', payload.components, Date.now() + idCounter);
      msg.delete = () => { deletedIds.push(id); return Promise.resolve(); };
      allMessages.push(msg);
    }
  }
  
  const channel = mockChannel(allMessages);
  
  let survivors = 0;
  for (const payload of payloads) {
    const fp = componentFingerprint(payload.components);
    const matches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now() + 10000);
    for (const dup of matches.slice(1)) await dup.message.delete();
    survivors += 1;
  }
  
  assert.equal(survivors, payloads.length, 'each part has exactly one survivor');
  assert.equal(deletedIds.length, payloads.length, 'one duplicate deleted per part');
});

test('simultaneous workers that finish preflight before either sends still converge', async () => {
  const payloads = getMultiPartPayloads();
  const channel = mockChannel([]);
  
  for (const payload of payloads) {
    const fp = componentFingerprint(payload.components);
    const matches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now());
    assert.equal(matches.length, 0, 'worker A sees no existing messages');
  }
  
  for (const payload of payloads) {
    const fp = componentFingerprint(payload.components);
    const matches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now());
    assert.equal(matches.length, 0, 'worker B sees no existing messages');
  }
  
  const sentA = [];
  const sentB = [];
  let idSeq = 3000;
  for (const payload of payloads) {
    sentA.push(mockMessage(String(idSeq++), 'bot123', payload.components, Date.now()));
  }
  for (const payload of payloads) {
    sentB.push(mockMessage(String(idSeq++), 'bot123', payload.components, Date.now() + 500));
  }
  
  const allSent = [...sentA, ...sentB];
  const deletedIds = [];
  for (const msg of allSent) {
    msg.delete = () => { deletedIds.push(msg.id); return Promise.resolve(); };
  }
  const reconChannel = mockChannel(allSent);
  
  for (const payload of payloads) {
    const fp = componentFingerprint(payload.components);
    const matches = await findMatchingRecentSellMessages(reconChannel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now() + 10000);
    if (matches.length > 1) {
      for (const dup of matches.slice(1)) await dup.message.delete();
    }
  }
  
  assert.equal(deletedIds.length, payloads.length);
});

test('reconciliation retries handle delayed message visibility', async () => {
  const payloads = getMultiPartPayloads();
  const fourXPayload = payloads[0];
  const fp = componentFingerprint(fourXPayload.components);
  
  const msg1 = mockMessage('4001', 'bot123', fourXPayload.components, Date.now());
  const msg2 = mockMessage('4002', 'bot123', fourXPayload.components, Date.now() + 100);
  const deletedIds = [];
  msg2.delete = () => { deletedIds.push('4002'); return Promise.resolve(); };
  
  let fetchCount = 0;
  const channel = {
    messages: {
      fetch: () => {
        fetchCount++;
        const msgs = fetchCount === 1 ? [msg1] : [msg1, msg2];
        const map = new Map(msgs.map(m => [m.id, m]));
        return Promise.resolve({ values: () => map.values() });
      },
    },
  };
  
  let matches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now() + 10000);
  assert.equal(matches.length, 1, 'first fetch sees only one message');
  
  matches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now() + 10000);
  assert.equal(matches.length, 2, 'second fetch sees both messages');
  
  for (const dup of matches.slice(1)) await dup.message.delete();
  assert.deepEqual(deletedIds, ['4002']);
});

test('same exact payload in a later cycle is preserved', async () => {
  const payloads = getMultiPartPayloads();
  const fourXPayload = payloads[0];
  const fp = componentFingerprint(fourXPayload.components);
  
  const msg1 = mockMessage('5001', 'bot123', fourXPayload.components, Date.now());
  
  const laterCycle = NEXT_REFRESH_AT_MS + 3600000;
  const laterEntry = { ...sellEntry, nextRefreshAtMs: laterCycle };
  const laterPayloads = splitPayloadByDisplayText(buildTypePayload('sell', laterEntry), 350);
  const laterPayload = laterPayloads[0];
  const msg2 = mockMessage('5002', 'bot123', laterPayload.components, Date.now() + 100);
  
  const channel = mockChannel([msg1, msg2]);
  
  const currentMatches = await findMatchingRecentSellMessages(channel, 'bot123', NEXT_REFRESH_AT_MS, fp, Date.now() + 10000);
  assert.equal(currentMatches.length, 1, 'only the current cycle message matches');
  assert.equal(currentMatches[0].message.id, '5001');
  
  const laterFp = componentFingerprint(laterPayload.components);
  const laterMatches = await findMatchingRecentSellMessages(channel, 'bot123', laterCycle, laterFp, Date.now() + 10000);
  assert.equal(laterMatches.length, 1, 'only the later cycle message matches');
  assert.equal(laterMatches[0].message.id, '5002');
});

test('outgoing payload and Discord-fetched message produce identical fingerprint', () => {
  const payloads = buildTypePayloads('sell', sellEntry);
  for (const payload of payloads) {
    const outgoingFp = componentFingerprint(payload.components);
    const discordMsg = discordifyPayload(payload);
    const fetchedFp = componentFingerprint(discordMsg.components);
    assert.equal(fetchedFp, outgoingFp, 'fingerprints must match after Discord serialization');
  }
});
