const fs = require('fs');
const path = require('path');
const { JOBS } = require('./workJobs');

const STORE_PATH = path.join(__dirname, '..', 'data', 'work-jobs.json');

function loadState() {
  try {
    const state = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    state.users = state.users && typeof state.users === 'object' ? state.users : {};
    return state;
  } catch {
    return { users: {} };
  }
}

function getWorkStats(userId) {
  const user = loadState().users?.[userId] || {};
  const jobsWorked = user.jobsWorked && typeof user.jobsWorked === 'object' ? user.jobsWorked : {};
  const jobsFired = user.jobsFired && typeof user.jobsFired === 'object' ? user.jobsFired : {};
  const jobsRaised = user.jobsRaised && typeof user.jobsRaised === 'object' ? user.jobsRaised : {};
  return {
    totalWorks: Math.max(0, Math.floor(Number(user.totalWorks) || 0)),
    totalFired: Object.keys(jobsFired).length,
    jobsWorked,
    jobsFired,
    jobsRaised,
    trueWorkComplete: JOBS.every((job) => jobsWorked[job.id] && jobsFired[job.id] && jobsRaised[job.id]),
  };
}

function getAllWorkStats() {
  const state = loadState();
  const result = {};
  for (const userId of Object.keys(state.users || {})) result[userId] = getWorkStats(userId);
  return result;
}

module.exports = { getWorkStats, getAllWorkStats };
