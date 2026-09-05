const { SlashCommandBuilder } = require('discord.js');
const ACHIEVEMENT_COMMANDS = [{ data: new SlashCommandBuilder().setName('cs-achievements').setDescription('View your CoinSprite achievements.') }];
function parseAchievementCommand(content) { return /^\s*csachievements\s*$/i.test(String(content || '')); }
module.exports = { ACHIEVEMENT_COMMANDS, parseAchievementCommand };
