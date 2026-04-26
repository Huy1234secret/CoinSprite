const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const manager = require('../src/levelingManager');

const XP_TRANSFERS = [
  ['shhigold', 525],
  ['onedayanddayone', 499],
  ['p0rky4', 487],
  ['elijahfr_', 475],
  ['fate_lly', 436],
  ['arceus9371', 429],
  ['idkigtg', 423],
  ['damnr0cky', 420],
  ['fim006', 410],
  ['ard41277', 403],
  ['redhunter18', 394],
  ['contxnuity', 387],
  ['matcha_w', 371],
  ['helitrah', 366],
  ['rumbeer_air', 362],
  ['hundal', 356],
  ['quoicoucramptes', 300],
  ['wow8991', 294],
  ['.chaospluh', 282],
  ['ksmei', 280],
  ['alxndralx', 265],
  ['neutrlno', 256],
  ['kirita11111111111', 253],
  ['chefisgoated', 246],
  ['spartanbosslcb', 245],
  ['grid.idk', 234],
  ['ekodefut2', 232],
  ['tetsku_', 225],
  ['acey0001', 224],
  ['yebob1', 202],
  ['moontong', 201],
  ['mamamopanote', 199],
  ['meses._.', 188],
  ['.storm03', 186],
  ['ido1234568', 186],
  ['zerummodz', 184],
  ['kokumoonr', 178],
  ['codemend51', 178],
  ['realgib', 176],
  ['ramoshappy', 166],
  ['ninja.cao', 166],
  ['kyota_2k9', 157],
  ['belle2658', 153],
  ['lol008456', 151],
  ['cyberninjaa', 148],
  ['abdullah_aka_songoku', 147],
  ['ajajajamask4165', 146],
  ['kangyaykimhan_75569', 146],
  ['sleepykitten248', 145],
  ['_raidennn_', 142],
];

function normalizeUsername(value) {
  return value.trim().toLowerCase().replace(/^@+/, '');
}

function buildUsernameMemberMap(guild) {
  const map = new Map();
  for (const member of guild.members.cache.values()) {
    const keys = [
      member.user.username,
      member.user.globalName,
      member.nickname,
      member.displayName,
    ]
      .filter(Boolean)
      .map(normalizeUsername);

    for (const key of keys) {
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(member);
    }
  }
  return map;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('transfer-xp')
    .setDescription('Set XP for the configured transfer list')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    await interaction.guild.members.fetch();
    const memberMap = buildUsernameMemberMap(interaction.guild);

    const updated = [];
    const missing = [];
    const ambiguous = [];

    for (const [rawUsername, xp] of XP_TRANSFERS) {
      const key = normalizeUsername(rawUsername);
      const matches = memberMap.get(key) ?? [];

      if (matches.length === 0) {
        missing.push(`@${rawUsername}`);
        continue;
      }

      if (matches.length > 1) {
        ambiguous.push(`@${rawUsername} (${matches.length} matches)`);
        continue;
      }

      const member = matches[0];
      const result = manager.setUserXp(interaction.guildId, member.id, xp);
      updated.push(`<@${member.id}> → ${result.totalXp} XP (Lv ${result.level})`);
    }

    const lines = [
      `Transfer XP completed. Updated **${updated.length}** user(s).`,
    ];

    if (updated.length) {
      lines.push('', '**Updated:**', ...updated.slice(0, 30));
      if (updated.length > 30) {
        lines.push(`...and ${updated.length - 30} more.`);
      }
    }

    if (missing.length) {
      lines.push('', `**Missing (${missing.length}):**`, missing.join(', '));
    }

    if (ambiguous.length) {
      lines.push('', `**Ambiguous (${ambiguous.length}):**`, ambiguous.join(', '));
    }

    await interaction.editReply({ content: lines.join('\n') });
  },
};
