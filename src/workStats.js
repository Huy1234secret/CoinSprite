const fs = require('fs');
const path = require('path');

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

function normalizeJobMap(value) {
  return value && typeof value === 'object' ? value : {};
}

function getWorkStats(userId) {
  const user = loadState().users?.[userId] || {};
  const jobsWorked = normalizeJobMap(user.jobsWorked);
  const jobsFired = normalizeJobMap(user.jobsFired);
  const jobsRaised = normalizeJobMap(user.jobsRaised);

  return {
    totalWorks: Math.max(0, Math.floor(Number(user.totalWorks) || 0)),
    totalFired: Object.keys(jobsFired).length,
    jobsWorked,
    jobsFired,
    jobsRaised,
    trueWorkComplete: false,
  };
}

function getAllWorkStats() {
  const state = loadState();
  const result = {};
  for (const userId of Object.keys(state.users || {})) {
    result[userId] = getWorkStats(userId);
  }
  return result;
}

module.exports = { getWorkStats, getAllWorkStats };
