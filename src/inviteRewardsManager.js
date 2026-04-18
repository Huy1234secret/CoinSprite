const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { loadState, saveState, ensureGuildState, ensureUserState } = require('./inviteRewardsStore');
const { logCommandUse, logCommandSystem } = require('./commandLogger');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const RULES_CHANNEL_ID = '1494329296670425279';
const CLAIM_CHANNEL_ID = '1493971939545583836';
const LOG_CHANNEL_ID = '1493915942047059999';
const INVITE_ANNOUNCE_CHANNEL_ID = '1494322475117445383';
const ONBOARDING_ROLE_ID = '1494397171045503129';

const EMOJIS = {
  invitePoint: '<:InvitePoint:1494571122186915922>',
  clanRerolls: '<:SPCRR:1494572058313625741>',
  traitRerolls: '<:SPTRR:1494572054165323836>',
  raceRerolls: '<:SPRRR:1494572061358555196>',
};

const TIERS = [
  {
    minMembers: 50,
    maxMembers: 100,
    label: '50 - 100',
    rewards: { clanRerolls: 1000, raceRerolls: 150, traitRerolls: 150 },
  },
  {
    minMembers: 30,
    maxMembers: 49,
    label: '30 - 49',
    rewards: { clanRerolls: 500, raceRerolls: 135, traitRerolls: 135 },
  },
  {
    minMembers: 0,
    maxMembers: 29,
    label: '0 - 29',
    rewards: { clanRerolls: 250, raceRerolls: 120, traitRerolls: 120 },
  },
];

let initialized = false;
let clientRef = null;
const inviteCache = new Map();

function logReward(message) {
  const logLine = `[InviteRewards] ${message}`;
  console.info(logLine);
  logCommandSystem(logLine);

  if (!clientRef) {
    return;
  }

  clientRef.channels
    .fetch(LOG_CHANNEL_ID)
    .then((channel) => {
      if (!channel?.isTextBased()) {
        return null;
      }

      return channel.send(logLine);
    })
    .catch(() => null);
}

function sanitizeAmount(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function getTierForMembers(memberCount) {
  return TIERS.find((tier) => memberCount >= tier.minMembers && memberCount <= tier.maxMembers) ?? null;
}

function formatPrizeLine(rewardData) {
  return `${rewardData.clanRerolls} Clan Rerolls, ${rewardData.raceRerolls} Race Rerolls, and ${rewardData.traitRerolls} Trait Rerolls`;
}

function getTierThreshold(tier) {
  const numbers = String(tier.label ?? '')
    .match(/\d+/g)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (numbers?.length) {
    return Math.max(...numbers);
  }

  return tier.maxMembers ?? tier.minMembers;
}

function buildRulesCard(guild, tier) {
  const prizeText = tier ? formatPrizeLine(tier.rewards) : 'No active prize tier yet. Keep inviting members!';
  const tierThreshold = tier ? getTierThreshold(tier) : 30;

  const content = [
    '**INVITATION RULES**',
    '* To claim your invitation prize, make sure the invited member meets these requirements:',
    '**Requirements:**',
    '* Account must be at least 4 days old.',
    '**Prizes:**',
    `* Each eligible invite gives: ${prizeText}. (Stackable)`,
    `-# The prize increases once we reach at least ${tierThreshold} members!`,
    '**How to Claim Your Prize**',
    `Create a ticket in <#${CLAIM_CHANNEL_ID}> to claim your prize.`,
  ].join('\n');

  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x00ff00,
        components: [
          {
            type: 9,
            components: [
              { type: 10, content: guild.name },
            ],
            accessory: guild.iconURL() ? { type: 11, media: { url: guild.iconURL() } } : undefined,
          },
          { type: 10, content },
        ],
      },
    ],
  };
}

function createBlacklistedPayload() {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0x000000,
        components: [
          {
            type: 10,
            content:
              '### You have been **BLACKLISTED** from our reward system.\n-# If you believe this is a mistake, please appeal through a support ticket.',
          },
        ],
      },
    ],
  };
}

function createInvitePointsPayload(username, invitePoints) {
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `### ${username}'s Stats\n* ${invitePoints} ${EMOJIS.invitePoint}`,
          },
        ],
      },
    ],
  };
}

function createRewardInventoryPayload(username, lines) {
  const rewardsBlock = lines.length ? lines.join('\n') : "-# You don't have any rewards yet 😔";
  return {
    flags: COMPONENTS_V2_FLAG,
    components: [
      {
        type: 17,
        accent_color: 0xffffff,
        components: [
          {
            type: 10,
            content: `### ${username}'s Rewards\n${rewardsBlock}`,
          },
          { type: 14, divider: true, spacing: 1 },
          {
            type: 10,
            content:
              `* 🎟️ If you want to claim your rewards, please go to <#${CLAIM_CHANNEL_ID}> and create a ticket. ` +
              'Be sure to provide the necessary information so we can help you quickly.\n' +
              '-# **⚠️ Items in the Reward Inventory are exclusive to this guild and cannot be traded, bought, or sold. ' +
              'If you are caught violating this rule, all items will be wiped, you may be blacklisted, or you may be banned.**',
          },
        ],
      },
    ],
  };
}

function getRewardLines(userState) {
  const lines = [];
  if (userState.rewards.clanRerolls > 0) {
    lines.push(`### ${userState.rewards.clanRerolls} Clan Rerolls ${EMOJIS.clanRerolls}`);
  }
  if (userState.rewards.traitRerolls > 0) {
    lines.push(`### ${userState.rewards.traitRerolls} Trait Rerolls ${EMOJIS.traitRerolls}`);
  }
  if (userState.rewards.raceRerolls > 0) {
    lines.push(`### ${userState.rewards.raceRerolls} Race Rerolls ${EMOJIS.raceRerolls}`);
  }
  return lines;
}

function loadGuildUserState(guildId, userId) {
  const state = loadState();
  const guildState = ensureGuildState(state, guildId);
  const userState = ensureUserState(guildState, userId);
  saveState(state);
  return userState;
}

function parseItem(itemRaw) {
  const normalized = itemRaw.trim().toLowerCase();
  if (['clan reroll', 'clan rerolls', 'crr'].includes(normalized)) {
    return 'clanRerolls';
  }
  if (['trait reroll', 'trait rerolls', 'trr'].includes(normalized)) {
    return 'traitRerolls';
  }
  if (['race reroll', 'race rerolls', 'rrr'].includes(normalized)) {
    return 'raceRerolls';
  }
  if (['invite point', 'invite points', 'ip'].includes(normalized)) {
    return 'invitePoints';
  }
  return null;
}

async function countHumanMembers(guild) {
  const members = await guild.members.fetch();
  return members.filter((member) => !member.user.bot).size;
}

async function refreshInviteCacheForGuild(guild) {
  const invites = await guild.invites.fetch().catch(() => null);
  if (!invites) {
    return;
  }
  const map = new Map();
  for (const invite of invites.values()) {
    map.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
  }
  inviteCache.set(guild.id, map);
}

async function ensureRulesMessage(guild) {
  const state = loadState();
  const guildState = ensureGuildState(state, guild.id);

  const memberCount = await countHumanMembers(guild).catch(() => 0);
  const tier = getTierForMembers(memberCount);

  const channel = await guild.channels.fetch(RULES_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    saveState(state);
    return;
  }

  const payload = buildRulesCard(guild, tier);
  let sentMessage = null;

  if (guildState.rulesMessageId) {
    sentMessage = await channel.messages.fetch(guildState.rulesMessageId).catch(() => null);
    if (sentMessage) {
      await sentMessage.edit(payload).catch(() => null);
    }
  }

  if (!sentMessage) {
    const latest = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const botMessage = latest?.find((msg) => msg.author.id === clientRef.user.id);
    if (botMessage) {
      sentMessage = botMessage;
      await botMessage.edit(payload).catch(() => null);
    }
  }

  if (!sentMessage) {
    sentMessage = await channel.send(payload).catch(() => null);
  }

  if (sentMessage) {
    guildState.rulesMessageId = sentMessage.id;
    guildState.updatedAt = Date.now();
    saveState(state);
  }
}

function addRewardsToUser(guildId, userId, rewardDelta, inviterId, reason) {
  const state = loadState();
  const guildState = ensureGuildState(state, guildId);
  const userState = ensureUserState(guildState, userId);

  userState.rewards.clanRerolls = sanitizeAmount(userState.rewards.clanRerolls + (rewardDelta.clanRerolls ?? 0));
  userState.rewards.traitRerolls = sanitizeAmount(userState.rewards.traitRerolls + (rewardDelta.traitRerolls ?? 0));
  userState.rewards.raceRerolls = sanitizeAmount(userState.rewards.raceRerolls + (rewardDelta.raceRerolls ?? 0));
  userState.invitePoints = sanitizeAmount(userState.invitePoints + (rewardDelta.invitePoints ?? 0));
  userState.updatedAt = Date.now();
  guildState.updatedAt = Date.now();

  saveState(state);
  logReward(
    `Updated ${userId} by ${inviterId}: +${rewardDelta.invitePoints ?? 0} IP, +${rewardDelta.clanRerolls ?? 0} CRR, +${rewardDelta.traitRerolls ?? 0} TRR, +${rewardDelta.raceRerolls ?? 0} RRR (${reason}).`,
  );

  return userState;
}

function hasSailorPiece(member) {
  return member.roles.cache.has(ONBOARDING_ROLE_ID);
}

function getTierRewardPack(tier, bonusMultiplier = 1) {
  return {
    clanRerolls: sanitizeAmount(tier.rewards.clanRerolls * bonusMultiplier),
    traitRerolls: sanitizeAmount(tier.rewards.traitRerolls * bonusMultiplier),
    raceRerolls: sanitizeAmount(tier.rewards.raceRerolls * bonusMultiplier),
    invitePoints: 1,
  };
}

function getBonusRewardPack(tier) {
  return {
    clanRerolls: sanitizeAmount(tier.rewards.clanRerolls * 0.1),
    traitRerolls: sanitizeAmount(tier.rewards.traitRerolls * 0.1),
    raceRerolls: sanitizeAmount(tier.rewards.raceRerolls * 0.1),
    invitePoints: 0,
  };
}

function upsertInvitedUserRecord(guildState, invitedUserId, patch) {
  const current = guildState.invitedUsers[invitedUserId] || {
    inviterId: null,
    rewardedAt: null,
    bonusAwardedAt: null,
    joinedAt: Date.now(),
    ignoredReason: '',
    updatedAt: Date.now(),
  };
  guildState.invitedUsers[invitedUserId] = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  return guildState.invitedUsers[invitedUserId];
}

function isInvitedUserBlacklisted(guildState, userId) {
  return Boolean(guildState.invitedBlacklist[userId]?.active);
}

async function sendInviteAnnouncement(guild, invitedUserId, inviterUserId, totalInvitePoints) {
  const channel = await guild.channels.fetch(INVITE_ANNOUNCE_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) {
    return;
  }

  await channel.send(`<@${invitedUserId}> has been invited by <@${inviterUserId}> and has now ${totalInvitePoints} invites.`).catch(() => null);
}

async function onGuildMemberAdd(member) {
  if (member.user.bot) {
    return;
  }

  const guild = member.guild;
  const oldInvites = inviteCache.get(guild.id) ?? new Map();
  const newInvites = await guild.invites.fetch().catch(() => null);
  if (!newInvites) {
    await ensureRulesMessage(guild);
    return;
  }

  let usedInvite = null;
  for (const invite of newInvites.values()) {
    const previous = oldInvites.get(invite.code);
    const prevUses = previous?.uses ?? 0;
    const nextUses = invite.uses ?? 0;
    if (nextUses > prevUses) {
      usedInvite = invite;
      break;
    }
  }

  const nextCache = new Map();
  for (const invite of newInvites.values()) {
    nextCache.set(invite.code, { uses: invite.uses ?? 0, inviterId: invite.inviter?.id ?? null });
  }
  inviteCache.set(guild.id, nextCache);

  await ensureRulesMessage(guild);

  if (!usedInvite?.inviter?.id) {
    return;
  }

  const accountAgeMs = Date.now() - member.user.createdTimestamp;
  const fourDaysMs = 4 * 24 * 60 * 60 * 1000;
  if (accountAgeMs < fourDaysMs) {
    logReward(`Invite ignored for ${usedInvite.inviter.id}; invited account ${member.user.id} is younger than 4 days.`);
    return;
  }

  const state = loadState();
  const guildState = ensureGuildState(state, guild.id);
  const inviterState = ensureUserState(guildState, usedInvite.inviter.id);
  if (isInvitedUserBlacklisted(guildState, member.user.id)) {
    const blacklistEntry = guildState.invitedBlacklist[member.user.id];
    upsertInvitedUserRecord(guildState, member.user.id, {
      inviterId: usedInvite.inviter.id,
      joinedAt: Date.now(),
      ignoredReason: `Invited user blacklisted: ${blacklistEntry.reason || 'No reason provided'}`,
    });
    guildState.updatedAt = Date.now();
    saveState(state);
    logReward(`Invite ignored for ${usedInvite.inviter.id}; invited user ${member.user.id} is blacklisted.`);
    return;
  }

  const invitedHistory = guildState.invitedUsers[member.user.id];
  if (invitedHistory?.rewardedAt) {
    saveState(state);
    logReward(
      `Invite ignored for ${usedInvite.inviter.id}; invited user ${member.user.id} already rewarded (inviter ${invitedHistory.inviterId}).`,
    );
    return;
  }

  if (inviterState.blacklisted) {
    upsertInvitedUserRecord(guildState, member.user.id, {
      inviterId: usedInvite.inviter.id,
      joinedAt: Date.now(),
      ignoredReason: 'Inviter is blacklisted.',
    });
    guildState.updatedAt = Date.now();
    saveState(state);
    logReward(`Invite ignored for blacklisted user ${usedInvite.inviter.id}.`);
    return;
  }

  const humanCount = await countHumanMembers(guild).catch(() => 0);
  const tier = getTierForMembers(humanCount);
  if (!tier) {
    upsertInvitedUserRecord(guildState, member.user.id, {
      inviterId: usedInvite.inviter.id,
      joinedAt: Date.now(),
      ignoredReason: `No eligible tier at ${humanCount} members.`,
    });
    guildState.updatedAt = Date.now();
    saveState(state);
    logReward(`No eligible reward tier for inviter ${usedInvite.inviter.id} at ${humanCount} members.`);
    return;
  }

  const rewardPack = getTierRewardPack(tier, 1);

  const inviteRecord = upsertInvitedUserRecord(guildState, member.user.id, {
    inviterId: usedInvite.inviter.id,
    rewardedAt: Date.now(),
    joinedAt: Date.now(),
    ignoredReason: '',
  });
  guildState.updatedAt = Date.now();
  saveState(state);

  const updatedInviterState = addRewardsToUser(guild.id, usedInvite.inviter.id, rewardPack, 'system', `eligible invite (${member.user.id})`);
  await sendInviteAnnouncement(guild, member.user.id, usedInvite.inviter.id, updatedInviterState.invitePoints);

  if (hasSailorPiece(member) && !inviteRecord.bonusAwardedAt) {
    const bonusPack = getBonusRewardPack(tier);
    addRewardsToUser(guild.id, usedInvite.inviter.id, bonusPack, 'system', `onboarding bonus (${member.user.id})`);

    const bonusState = loadState();
    const bonusGuildState = ensureGuildState(bonusState, guild.id);
    upsertInvitedUserRecord(bonusGuildState, member.user.id, { bonusAwardedAt: Date.now() });
    bonusGuildState.updatedAt = Date.now();
    saveState(bonusState);
  }

  const inviter = await guild.members.fetch(usedInvite.inviter.id).catch(() => null);
  if (inviter) {
    const rewardText = `${rewardPack.clanRerolls} Clan Rerolls, ${rewardPack.raceRerolls} Race Rerolls, and ${rewardPack.traitRerolls} Trait Rerolls`;
    await inviter
      .send(`Hey ${inviter.user.username}, thanks for inviting ${member.user.username} to our guild! As a reward, you earned ${rewardText} 🎁.`)
      .catch(() => null);
  }
}

async function onGuildMemberUpdate(oldMember, newMember) {
  if (newMember.user.bot) {
    return;
  }

  const gainedOnboardingRole = !oldMember.roles.cache.has(ONBOARDING_ROLE_ID) && newMember.roles.cache.has(ONBOARDING_ROLE_ID);
  if (!gainedOnboardingRole) {
    return;
  }

  const state = loadState();
  const guildState = ensureGuildState(state, newMember.guild.id);
  const inviteRecord = guildState.invitedUsers[newMember.user.id];
  if (!inviteRecord?.inviterId || !inviteRecord.rewardedAt || inviteRecord.bonusAwardedAt) {
    saveState(state);
    return;
  }

  const inviterState = ensureUserState(guildState, inviteRecord.inviterId);
  if (inviterState.blacklisted) {
    inviteRecord.ignoredReason = 'Bonus skipped: inviter is blacklisted.';
    inviteRecord.updatedAt = Date.now();
    guildState.updatedAt = Date.now();
    saveState(state);
    return;
  }
  saveState(state);

  const humanCount = await countHumanMembers(newMember.guild).catch(() => 0);
  const tier = getTierForMembers(humanCount);
  if (!tier) {
    logReward(`Onboarding bonus skipped for inviter ${inviteRecord.inviterId}; no eligible tier at ${humanCount} members.`);
    return;
  }

  const bonusPack = getBonusRewardPack(tier);
  addRewardsToUser(newMember.guild.id, inviteRecord.inviterId, bonusPack, 'system', `onboarding bonus (${newMember.user.id})`);

  const bonusState = loadState();
  const bonusGuildState = ensureGuildState(bonusState, newMember.guild.id);
  upsertInvitedUserRecord(bonusGuildState, newMember.user.id, { bonusAwardedAt: Date.now(), ignoredReason: '' });
  bonusGuildState.updatedAt = Date.now();
  saveState(bonusState);
}

async function onInviteCreateOrDelete(invite) {
  await refreshInviteCacheForGuild(invite.guild).catch(() => null);
}

async function onMessageCreate(message) {
  if (!message.guild || message.author.bot) {
    return;
  }

  const content = message.content.trim();
  if (!/^PR\s+/i.test(content)) {
    return;
  }

  logCommandUse({
    userId: message.author.id,
    command: content,
    channelId: message.channel.id,
  });

  if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
    logCommandSystem(`Unauthorized PR command attempt by ${message.author.id} in channel ${message.channel.id}`);
    await message.reply('You need Administrator permission to use PR console commands.');
    return;
  }

  const blacklistAdd = content.match(/^PR\s+blacklist\s+add\s+(\d{16,20})\s+(.+)$/i);
  if (blacklistAdd) {
    const [, userId, reason] = blacklistAdd;
    const state = loadState();
    const guildState = ensureGuildState(state, message.guild.id);
    const user = ensureUserState(guildState, userId);
    user.blacklisted = true;
    user.blacklistReason = reason.trim();
    user.updatedAt = Date.now();
    guildState.updatedAt = Date.now();
    saveState(state);

    logReward(`Blacklist added for ${userId} by ${message.author.id}. Reason: ${user.blacklistReason}`);
    await message.reply(`Blacklisted <@${userId}> from rewards. Reason: ${user.blacklistReason}`);
    return;
  }

  const blacklistRemove = content.match(/^PR\s+blacklist\s+remove\s+(\d{16,20})\s+(.+)$/i);
  if (blacklistRemove) {
    const [, userId, reason] = blacklistRemove;
    const state = loadState();
    const guildState = ensureGuildState(state, message.guild.id);
    const user = ensureUserState(guildState, userId);
    user.blacklisted = false;
    user.blacklistReason = reason.trim();
    user.updatedAt = Date.now();
    guildState.updatedAt = Date.now();
    saveState(state);

    logReward(`Blacklist removed for ${userId} by ${message.author.id}. Note: ${user.blacklistReason}`);
    await message.reply(`Removed blacklist for <@${userId}>. Note: ${user.blacklistReason}`);
    return;
  }

  const inviteeBlacklistAdd = content.match(/^PR\s+invitee-blacklist\s+add\s+(\d{16,20})\s+(.+)$/i);
  if (inviteeBlacklistAdd) {
    const [, userId, reason] = inviteeBlacklistAdd;
    const state = loadState();
    const guildState = ensureGuildState(state, message.guild.id);
    guildState.invitedBlacklist[userId] = {
      active: true,
      reason: reason.trim(),
      updatedBy: message.author.id,
      updatedAt: Date.now(),
    };
    guildState.updatedAt = Date.now();
    saveState(state);

    logReward(`Invitee blacklist added for ${userId} by ${message.author.id}. Reason: ${reason.trim()}`);
    await message.reply(`Invitee blacklist added for <@${userId}>. Reason: ${reason.trim()}`);
    return;
  }

  const inviteeBlacklistRemove = content.match(/^PR\s+invitee-blacklist\s+remove\s+(\d{16,20})\s+(.+)$/i);
  if (inviteeBlacklistRemove) {
    const [, userId, reason] = inviteeBlacklistRemove;
    const state = loadState();
    const guildState = ensureGuildState(state, message.guild.id);
    guildState.invitedBlacklist[userId] = {
      active: false,
      reason: reason.trim(),
      updatedBy: message.author.id,
      updatedAt: Date.now(),
    };
    guildState.updatedAt = Date.now();
    saveState(state);

    logReward(`Invitee blacklist removed for ${userId} by ${message.author.id}. Note: ${reason.trim()}`);
    await message.reply(`Invitee blacklist removed for <@${userId}>. Note: ${reason.trim()}`);
    return;
  }

  const rewardInventoryLookup = content.match(/^PR\s+RI\s+(\d{16,20})$/i);
  if (rewardInventoryLookup) {
    const [, userId] = rewardInventoryLookup;
    const userState = loadGuildUserState(message.guild.id, userId);
    if (userState.blacklisted) {
      await message.reply(`User <@${userId}> is blacklisted from rewards.`);
      return;
    }

    const rewardLines = getRewardLines(userState);
    const member = await message.guild.members.fetch(userId).catch(() => null);
    const username = member?.user?.username ?? userId;
    await message.reply(createRewardInventoryPayload(username, rewardLines));
    return;
  }

  const updateCmd = content.match(/^PR\s+(add|remove)\s+(\d{16,20})\s+(.+)\s+(\d+)$/i);
  if (!updateCmd) {
    logCommandSystem(`Invalid PR command syntax by ${message.author.id}: ${content}`);
    await message.reply(
      'Invalid PR command. Use `PR RI {userID}`, `PR add/remove {userID} {item} {amount}`, `PR blacklist add/remove {userID} {reason}`, or `PR invitee-blacklist add/remove {userID} {reason}`.',
    );
    return;
  }

  const [, action, userId, itemRaw, amountRaw] = updateCmd;
  const amount = sanitizeAmount(amountRaw);
  const itemKey = parseItem(itemRaw);

  if (!itemKey) {
    await message.reply('Unknown item. Use Clan Reroll/CRR, Trait Reroll/TRR, Race Reroll/RRR, or Invite Point/IP.');
    return;
  }

  const sign = action.toLowerCase() === 'add' ? 1 : -1;
  const state = loadState();
  const guildState = ensureGuildState(state, message.guild.id);
  const userState = ensureUserState(guildState, userId);

  if (itemKey === 'invitePoints') {
    userState.invitePoints = sanitizeAmount(userState.invitePoints + sign * amount);
  } else {
    userState.rewards[itemKey] = sanitizeAmount(userState.rewards[itemKey] + sign * amount);
  }
  userState.updatedAt = Date.now();
  guildState.updatedAt = Date.now();
  saveState(state);

  logReward(`Manual ${action.toUpperCase()} ${amount} ${itemKey} for ${userId} by ${message.author.id}.`);
  await message.reply(`Updated <@${userId}>: ${action.toLowerCase()} ${amount} ${itemKey}.`);
}

async function init(client) {
  if (initialized) {
    return;
  }

  initialized = true;
  clientRef = client;

  for (const guild of client.guilds.cache.values()) {
    await refreshInviteCacheForGuild(guild).catch(() => null);
    await ensureRulesMessage(guild).catch(() => null);
  }
}

module.exports = {
  init,
  onGuildMemberAdd,
  onInviteCreateOrDelete,
  onGuildMemberUpdate,
  onMessageCreate,
  ensureRulesMessage,
  createBlacklistedPayload,
  createInvitePointsPayload,
  createRewardInventoryPayload,
  getRewardLines,
  loadGuildUserState,
};
