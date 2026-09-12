const { v2Payload, WHITE } = require('../../shared/components');
const { assertValidMessagePayload } = require('../../shared/discordPayload');
const { COUNT_SUCCESS_EMOJI: Y, COUNT_FAILURE_EMOJI: N } = require('../../counting/emojis');
const { CAREERS } = require('../data/careers');
const { WORK_EMOJIS } = require('../data/emojis');
const PAGE_SIZE = 5;
function button(user, action, label, style = 2, disabled = false) {
  return { type: 2, custom_id: `cswork:${user}:${action}`, label, style, disabled };
}
const separator = () => ({ type: 14, divider: true, spacing: 1 });
function jobsPayload(user, profile, requestedPage = 0, notice = '', options = {}) {
  const max = Math.ceil(CAREERS.length / PAGE_SIZE);
  const page = Math.max(0, Math.min(max - 1, Number(requestedPage) || 0));
  const components = [{ type: 10, content: profile.career
    ? `### Your job: ${profile.career.name}\n-# Daily work: ${profile.dailyCompleted}/${profile.career.dailyRequired}. Resets <t:${Math.floor((profile.dayStart + 86400000) / 1000)}:R>.`
    : '### You don’t have a job yet.\n-# Select a job to apply.' }];
  if (notice) components.push({ type: 10, content: notice });
  components.push(separator());
  for (const career of CAREERS.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const levelOk = profile.level >= career.level, workOk = profile.totalCompleted >= career.totalRequired;
    const applied = profile.careerId === career.id, eligible = levelOk && workOk;
    components.push({ type: 9, components: [{ type: 10, content:
      `**${career.name} —** ${career.salary.toLocaleString('en-US')} ${WORK_EMOJIS.bronze}\n- Job requirement: work ${career.dailyRequired} times/day\n-# ${levelOk ? Y : N} Work level ${career.level}.\n-# ${workOk ? Y : N} Complete ${career.totalRequired.toLocaleString('en-US')} works.` }],
    accessory: button(user, `apply-${career.id}`, applied ? 'Applied' : eligible ? 'Apply' : '-', applied ? 2 : eligible ? 3 : 4, applied || !eligible) });
  }
  components.push(separator(), { type: 1, components: [button(user, 'home', 'Back'),
    button(user, `jobs-${page - 1}`, 'Previous', 2, page === 0),
    button(user, `jobs-${page}`, `Page ${page + 1} / ${max}`, 2, true),
    button(user, `jobs-${page + 1}`, 'Next', 2, page === max - 1)] });
  return assertValidMessagePayload(v2Payload([{ type: 17, accent_color: WHITE, components }], options));
}
function firedPayload(user, profile, options = {}) {
  return v2Payload([{ type: 17, accent_color: 0xEF4444, components: [
    { type: 10, content: `### <@${user}> You didn’t meet your job’s daily work requirement\nYour boss has decided to fire you!` }, separator(),
    { type: 10, content: `-# * You can apply for a job again <t:${Math.floor(profile.jobChangeUntil / 1000)}:R>.` },
    { type: 1, components: [button(user, 'home', 'Back')] },
  ] }], options);
}
module.exports = { jobsPayload, firedPayload };
