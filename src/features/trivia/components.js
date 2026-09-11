const { v2Payload } = require('../shared/components');
const { formatCurrency } = require('../shared/currency');
const { DIFFICULTIES } = require('./repository');
const HEART = '<:CSHeart:1546079064714911796>';
const BROKEN_HEART = '<:CSBHeart:1546079062819078164>';
const text = content => ({ type: 10, content });
const separator = () => ({ type: 14, divider: true, spacing: 1 });
const row = components => ({ type: 1, components });
const button = (label, custom_id, disabled = false, style = 2) => ({ type: 2, label, custom_id, disabled, style });
function menu(userId, profile, options = {}) {
  const filled = Math.min(10, Math.floor(profile.xp / profile.nextXp * 10));
  return v2Payload([{ type: 17, accent_color: 0xFFFFFF, components: [
    text(`### <@${userId}> Welcome to Trivia game\n\n- Trivia level: ${profile.level}\n\n${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${profile.xp}/${profile.nextXp} XP`),
    separator(), text('Select a difficulty to begin'), separator(),
    row(Object.entries(DIFFICULTIES).map(([key, value]) => button(value.label, `cstrivia:start:${userId}:${key}`, profile.level < value.level))),
  ] }], options);
}
function game(s, options = {}) {
  const config = DIFFICULTIES[s.difficulty];
  if (s.status === 'ended') return v2Payload([{ type: 17, accent_color: config.color, components: [
    text(`### ${config.label} Trivia\n-# You've lost all your lives\n\n- Total trivia answered: ${s.answered}\n- Correct answers: ${s.correctCount}\n- Total earning: ${formatCurrency(s.coins)}, +${s.xp} XP.`),
    separator(), row([button('Back', `cstrivia:back:${s.userId}:${s.id}`)]),
  ] }], options);
  const feedback = s.status === 'feedback';
  return v2Payload([{ type: 17, accent_color: config.color, components: [
    text(`### ${config.label} Trivia\n-# Trivia ${s.number}# • ${HEART.repeat(s.lives)}${BROKEN_HEART.repeat(config.lives - s.lives)} • ${feedback ? 'Time paused' : `You have <t:${Math.ceil(s.deadline / 1000)}:R>`}`),
    separator(), text(`**${s.question.text}**`),
    row(s.question.answers.map((answer, index) => button(answer, `cstrivia:answer:${s.id}:${s.number}:${index}`, feedback,
      feedback && index === s.question.correct ? 3 : feedback && index === s.selected ? 4 : 2))),
  ] }], options);
}
module.exports = { menu, game, HEART, BROKEN_HEART };
