const { componentEmoji } = require('../../shared/emojis');
const { errorPayload, v2Payload, WHITE } = require('../../shared/components');
const { formatTokenList } = require('../../rng-game/utils/tokens');
const { WORK_HOME_MESSAGES, WORK_INGREDIENTS } = require('../data');
const { progressBar, workProgress, workRank } = require('../ranks');

const SECONDARY = 2;
const SUCCESS = 3;
const DANGER = 4;

function workOption(label, value, emoji) {
  return { label, value, emoji: componentEmoji(emoji) };
}

function homePayload(userId, random = (maximum) => Math.floor(Math.random() * maximum), options = {}) {
  const index = Number(random(WORK_HOME_MESSAGES.length));
  const message = WORK_HOME_MESSAGES[Math.max(0, Math.min(WORK_HOME_MESSAGES.length - 1, index))];
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: `> Coinsprite: "<@${userId}>, ${message}"` },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 1,
        components: [{
          type: 3,
          custom_id: `work:menu:${userId}`,
          placeholder: 'Select Actions',
          min_values: 1,
          max_values: 1,
          options: [
            workOption('Check Stat', 'check-stat', '<:SBcheckstat:1536996978129510451>'),
            workOption('Work', 'work', '<:SBwork:1536996980801142784>'),
          ],
        }],
      },
    ],
  }], options);
}

function statPayload(userId, profile, _games, options = {}) {
  const progress = workProgress(profile.totalXp);
  const workStreak = Number(profile.workStreak || 0);
  const progressText = progress.nextRank
    ? `${progressBar(progress.percent)} ${progress.percent}% — ${progress.currentRankXp}/${progress.requiredXp} XP`
    : `${progressBar(100)} 100% — MAX RANK`;
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      {
        type: 10,
        content: `### <@${userId}>'s Work Stat\n\nRank: ${progress.rank.name}\n\n**Level ${progress.rank.level}**\n\n${progressText}`,
      },
      { type: 14, divider: true, spacing: 1 },
      {
        type: 10,
        content: `-# Rank boost: +${progress.rank.salaryBoost}% salary.\n-# 🔥Work Streak: ${workStreak} \`+${workStreak}% salary.\``,
      },
      { type: 1, components: [{ type: 2, style: SECONDARY, label: 'Back', custom_id: `work:back:${userId}` }] },
    ],
  }], options);
}

function ingredientRows(session, options = {}) {
  const consumed = new Set(session.consumedSlots);
  const terminal = session.state !== 'active';
  const buttons = session.buttonSlots.map((slot) => {
    let style = consumed.has(slot.index) ? SUCCESS : SECONDARY;
    if (session.state === 'failed' && session.failedSlotIndex === slot.index) style = DANGER;
    return {
      type: 2,
      style,
      emoji: componentEmoji(WORK_INGREDIENTS[slot.ingredient]),
      custom_id: `work:ingredient:${session.id}:${slot.index}`,
      disabled: terminal || consumed.has(slot.index),
    };
  });
  const rows = [];
  for (let index = 0; index < buttons.length; index += 5) {
    rows.push({ type: 1, components: buttons.slice(index, index + 5) });
  }
  if (options.includeQuit !== false) {
    rows.push({
      type: 1,
      components: [{
        type: 2,
        style: DANGER,
        label: 'Quit Shift',
        custom_id: `work:quit:${session.id}`,
      }],
    });
  }
  return rows;
}

function gamePayload(userId, session, customer, options = {}) {
  const percent = Math.floor((session.currentProgress * 100) / session.expectedRecipe.length);
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      {
        type: 10,
        content: `> Coinsprite: "<@${userId}>, ${session.gameMessage}"\n\n**Customer:**\n${customer.message}\n\nProgress: ${progressBar(percent)} ${percent}%`,
      },
      { type: 14, divider: true, spacing: 1 },
      ...ingredientRows(session),
    ],
  }], options);
}

function failedPayload(userId, session, expectedIngredient, selectedIngredient, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      {
        type: 10,
        content: `### Shift Failed\n\nWrong layer! The customer expected ${WORK_INGREDIENTS[expectedIngredient]}, but you selected ${WORK_INGREDIENTS[selectedIngredient]}.\n\n-# No salary or Work XP was earned.`,
      },
      ...ingredientRows(session, { includeQuit: false }),
      { type: 1, components: [{ type: 2, style: SECONDARY, label: 'Back', custom_id: `work:back:${userId}` }] },
    ],
  }], options);
}

function completePayload(userId, result, options = {}) {
  const previousRank = workRank(result.previousXp);
  const newRank = workRank(result.totalXp);
  const rankUp = newRank.level > previousRank.level
    ? `\n\n🎉 Rank up! You are now ${newRank.name} — Level ${newRank.level}.`
    : '';
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      {
        type: 10,
        content: `### Shift Complete!\n\nReward: ${formatTokenList(result.finalReward)}\nWork XP: +${result.session.baseReward}${rankUp}\n\nProgress: ${progressBar(100)} 100%\n\n-# Total token value earned this shift: ${result.finalReward}`,
      },
      ...ingredientRows(result.session, { includeQuit: false }),
      { type: 1, components: [{ type: 2, style: SECONDARY, label: 'Back', custom_id: `work:back:${userId}` }] },
    ],
  }], options);
}

function canceledPayload(userId, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: '### Shift Canceled\n\nYou left the shift without earning salary or Work XP.' },
      { type: 1, components: [{ type: 2, style: SECONDARY, label: 'Back', custom_id: `work:back:${userId}` }] },
    ],
  }], options);
}

function expiredPayload(userId, session, options = {}) {
  return v2Payload([{
    type: 17,
    accent_color: WHITE,
    components: [
      { type: 10, content: '### Shift Expired\n\nThis work shift expired without salary or Work XP.' },
      ...ingredientRows(session, { includeQuit: false }),
      { type: 1, components: [{ type: 2, style: SECONDARY, label: 'Back', custom_id: `work:back:${userId}` }] },
    ],
  }], options);
}

function workError(message, options = {}) {
  return errorPayload(message, { ephemeral: true, ...options });
}

module.exports = {
  canceledPayload,
  completePayload,
  expiredPayload,
  failedPayload,
  gamePayload,
  homePayload,
  ingredientRows,
  statPayload,
  workError,
};
