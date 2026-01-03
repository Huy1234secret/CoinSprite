const fs = require('fs');
const path = require('path');

const SERVERS_DIR = path.join(__dirname, '..', 'data', 'servers');

async function collectGuildMembers(guild) {
  const members = [];
  try {
    const fetchedMembers = await guild.members.fetch();
    fetchedMembers.forEach((member) => {
      members.push({
        id: member.id,
        tag: member.user.tag,
        bot: member.user.bot,
        joinedAt: member.joinedAt ? member.joinedAt.toISOString() : null,
      });
    });
  } catch (error) {
    console.warn(`Unable to collect full member list for guild ${guild.id}:`, error);
  }

  return members;
}

async function buildGuildSnapshot(guild) {
  const members = await collectGuildMembers(guild);
  return {
    id: guild.id,
    name: guild.name,
    ownerId: guild.ownerId,
    memberCount: guild.memberCount,
    snapshotTakenAt: new Date().toISOString(),
    createdAt: guild.createdAt ? guild.createdAt.toISOString() : null,
    members,
  };
}

async function saveGuildData(guild) {
  const snapshot = await buildGuildSnapshot(guild);
  fs.mkdirSync(SERVERS_DIR, { recursive: true });
  const filePath = path.join(SERVERS_DIR, `${guild.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));
  return filePath;
}

module.exports = { saveGuildData };
