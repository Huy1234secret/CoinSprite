const fs = require('fs');
const path = require('path');
const { addSkillPoints } = require('./gamblingStore');

const STORE_PATH = path.join(__dirname, '..', 'data', 'player-levels.json');

function getEmptyState() { return { users: {} }; }
function ensureStoreFile() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(getEmptyState(), null, 2), 'utf8'); }
function normalizeUser(user) { const record = user && typeof user === 'object' ? { ...user } : {}; record.totalXp = Math.max(0, Math.floor(Number(record.totalXp) || 0)); record.updatedAt = Math.max(0, Math.floor(Number(record.updatedAt) || 0)); return record; }
function normalizeState(state) { const next = state && typeof state === 'object' ? { ...state } : getEmptyState(); next.users = next.users && typeof next.users === 'object' ? next.users : {}; for (const userId of Object.keys(next.users)) next.users[userId] = normalizeUser(next.users[userId]); return next; }
function loadState() { ensureStoreFile(); try { return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))); } catch { return getEmptyState(); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8'); }
function getUserRecord(state, userId) { const id = String(userId); if (!state.users[id]) state.users[id] = normalizeUser({}); state.users[id] = normalizeUser(state.users[id]); return state.users[id]; }
function xpRequirement(level) { return Math.max(100, Math.floor(Number(level) || 1) * 100); }
function getProgress(totalXp) { let level = 1; let remaining = Math.max(0, Math.floor(Number(totalXp) || 0)); let req = xpRequirement(level); while (remaining >= req) { remaining -= req; level += 1; req = xpRequirement(level); } return { level, currentXp: remaining, requiredXp: req, totalXp: Math.max(0, Math.floor(Number(totalXp) || 0)) }; }
function getUserProgress(userId) { const state = loadState(); const user = getUserRecord(state, userId); return getProgress(user.totalXp); }
function addPlayerXp(userId, amount) { const state = loadState(); const user = getUserRecord(state, userId); const before = getProgress(user.totalXp); const gained = Math.max(0, Math.floor(Number(amount) || 0)); user.totalXp += gained; user.updatedAt = Date.now(); const after = getProgress(user.totalXp); saveState(state); const levelsGained = Math.max(0, after.level - before.level); if (levelsGained > 0) addSkillPoints(userId, levelsGained); return { addedXp: gained, oldLevel: before.level, newLevel: after.level, levelsGained, totalXp: user.totalXp, progress: after }; }

module.exports = { STORE_PATH, xpRequirement, getProgress, getUserProgress, addPlayerXp };
