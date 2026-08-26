const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'coinsprite-xp-drops-'));
process.env.SERVER_CONFIG_STORE_PATH = path.join(temporaryDirectory, 'server-config.json');
process.env.LEVELING_DATA_PATH = path.join(temporaryDirectory, 'leveling.json');

const guildId = '123456789012345678';
const channelId = '223456789012345678';
const messageIds = ['323456789012345678', '423456789012345678'];
fs.writeFileSync(process.env.SERVER_CONFIG_STORE_PATH, JSON.stringify({
  meta: { schemaVersion: 16, disabledGuilds: {} },
  guilds: {
    [guildId]: {
      enabled: true,
      features: { leveling: true, rngGame: false, fullBot: false },
      channels: { commandLogThread: '' },
      leveling: {
        enabled: true,
        channelMultipliers: {}, roleRewards: [], roleBoosts: [], stackRoleRewards: true,
        xpDrops: {
          enabled: true,
          dropTemplate: '## {crate_name}\n{claims_left} left',
          claimTemplate: '{user} would receive {xp} XP',
          crates: [{
            id: 'common', enabled: true, name: 'Common Crate', imageUrl: '',
            xp: { min: 50, max: 50 }, channelId, dropEvery: '1s', chancePercent: 100,
            claimLimit: 2, despawnAfter: '', allowMultipleClaims: false, containerColor: '#b9f547',
          }],
        },
      },
      rngGame: { enabled: false, gameChannelIds: [], cooldownBypassRoleIds: [] },
    },
  },
}));

const { getGuildConfig } = require('../src/serverConfig');
const {
  flushLevelingState,
  handleXpDropClaim,
  memberStats,
  resetLevelingCache,
  runXpDropScheduler,
  sendXpDrop,
} = require('../src/leveling');

test.after(() => {
  resetLevelingCache();
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

function fixture() {
  const sent = [];
  const channel = {
    id: channelId,
    isTextBased: () => true,
    send: async (payload) => {
      const message = { id: messageIds[sent.length], url: '', payload };
      sent.push(message);
      return message;
    },
    messages: { fetch: async () => null },
  };
  const guild = {
    id: guildId,
    name: 'Garden',
    channels: { cache: new Map([[channelId, channel]]), fetch: async (id) => (id === channelId ? channel : null) },
    members: { cache: new Map(), fetch: async () => null },
  };
  const client = { guilds: { cache: new Map([[guildId, guild]]), fetch: async () => guild } };
  guild.client = client;
  return { channel, client, guild, sent };
}

test('XP drop scheduler waits one interval, rolls chance, and sends the configured crate', async () => {
  const { client, sent } = fixture();
  assert.equal(await runXpDropScheduler(client, { nowMs: 1_000, random: () => 0 }), 0);
  assert.equal(await runXpDropScheduler(client, { nowMs: 2_000, random: () => 0 }), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload.components[0].components.at(-1).components[0].label, 'Claim Common Crate');
});

test('test crate claims update limits and confirmation without awarding XP', async () => {
  resetLevelingCache();
  const { guild } = fixture();
  const crate = getGuildConfig(guildId).leveling.xpDrops.crates[0];
  const { drop } = await sendXpDrop({ guild, crate, test: true, templates: getGuildConfig(guildId).leveling.xpDrops });
  const edits = [];
  const replies = [];
  const interaction = {
    customId: `leveling:xp-drop:${drop.id}`,
    guildId,
    channelId,
    guild,
    client: guild.client,
    user: { id: '523456789012345678', username: 'Tester', globalName: 'Tester' },
    member: { displayName: 'Tester' },
    message: { id: drop.messageId, edit: async (payload) => edits.push(payload) },
    deferred: false,
    replied: false,
    deferReply: async function deferReply() { this.deferred = true; },
    editReply: async (payload) => replies.push(payload),
  };
  const before = memberStats(guildId, interaction.user.id).xp;
  await handleXpDropClaim(interaction);
  const after = memberStats(guildId, interaction.user.id).xp;
  assert.equal(before, 0);
  assert.equal(after, 0);
  assert.equal(edits.length, 1);
  assert.match(replies[0].components[0].components[0].content, /no XP was awarded/i);
  flushLevelingState();
});
