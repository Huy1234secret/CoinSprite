const { MEDALS, CATALOG, requirement } = require('./catalog');
const { WHITE, v2Payload } = require('../shared/components');
const { assertValidMessagePayload } = require('../shared/discordPayload');
const { inventoryPageModal, inventoryErrorPayload } = require('../inventory/components/builders');

function resolveEmoji(client, name) {
  const emoji = client?.application?.emojis?.cache?.find(item => item.name === name)
    || client?.emojis?.cache?.find(item => item.name === name);
  if (!emoji || !/^\d{16,20}$/.test(String(emoji.id))) return null;
  return { mention: `<${emoji.animated ? 'a' : ''}:${name}:${emoji.id}>`,
    url: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}` };
}
function achievementPayload(ownerId, data, options = {}) {
  const emoji = name => data.resolveEmoji?.(name)?.mention || `[${name}]`;
  const counts = Object.fromEntries(Object.keys(MEDALS).map(key => [key, 0]));
  for (const track of CATALOG) {
    for (const tier of track.tiers.slice(0, data.earned[track.id] || 0)) counts[tier.medal]++;
  }
  const entries = data.items.map(track => {
    const unlocked = data.earned[track.id] || 0;
    const active = track.tiers[unlocked - 1];
    const max = unlocked === track.tiers.length;
    const target = track.tiers[max ? unlocked - 1 : unlocked].target;
    const progress = max ? BigInt(target) : BigInt(data.progress[track.metric]);
    const slots = track.tiers.map((tier, i) => emoji(i < unlocked ? MEDALS[tier.medal] : 'CSEMedal')).join(' ');
    return `**${track.name}** ${active?.roman || 'Locked'} ─ ${slots}\n\n* ${requirement(track, progress > BigInt(target) ? target : progress, target)}${max ? ' MAX' : ''}\n\n-# Perks: ${active?.perk || '-'}`;
  });
  return assertValidMessagePayload(v2Payload([{
    type: 17, accent_color: WHITE, components: [
      { type: 10, content: `### <@${ownerId}>'s Achievements\n\n-# * You've earned ${Object.entries(MEDALS).map(([key, name]) => `\`${counts[key]}\`${emoji(name)}`).join(', ')}.` },
      { type: 14, divider: true, spacing: 1 },
      ...entries.map(content => ({ type: 10, content })),
      { type: 14, divider: true, spacing: 1 },
      { type: 10, content: `-# Page ${data.page}/${data.maxPages}` },
      { type: 1, components: [{ type: 2, style: 2, label: 'Switch Page',
        custom_id: `csachievements:page:${ownerId}`, disabled: data.maxPages <= 1 }] },
    ],
  }], options));
}
function achievementPageModal(ownerId, maxPages) {
  const modal = inventoryPageModal(ownerId, maxPages);
  modal.custom_id = `csachievements:modal:${ownerId}`;
  modal.title = 'Switch Achievements Page';
  modal.components[0].components[0].max_length = 10;
  return modal;
}
function announcementPayload(record, resolve) {
  const track = CATALOG.find(item => item.id === record.track);
  const tier = track?.tiers[Number(record.tier) - 1];
  if (!tier) throw new Error('Unknown achievement tier');
  const name = MEDALS[tier.medal];
  const emoji = resolve(name);
  if (!emoji?.url) throw new Error(`Missing achievement emoji configuration: ${name}`);
  const title = record.upgraded ? 'Achievement Upgraded!' : track.tiers.length === 1 && tier.medal === 'diamond'
    ? 'Super Achievement Unlocked!' : 'Achievement Unlocked!';
  const medal = tier.medal[0].toUpperCase() + tier.medal.slice(1);
  return assertValidMessagePayload(v2Payload([{ type: 17, accent_color: WHITE, components: [{
    type: 9, components: [{ type: 10,
      content: `### ${title}\n\n<@${record.user_id}> earned **${track.name} ${tier.roman}**!\n${emoji.mention} **${medal} Medal**\n\n* ${requirement(track, tier.target, tier.target)}\n-# Perks: ${tier.perk || '-'}`,
    }], accessory: { type: 11, media: { url: emoji.url }, description: `${medal} Medal for ${track.name} ${tier.roman}` },
  }] }]));
}
module.exports = { resolveEmoji, achievementPayload, achievementPageModal, achievementErrorPayload: inventoryErrorPayload, announcementPayload };
