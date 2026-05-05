const fs = require('fs');
const path = require('path');
const { ITEM_BY_ID } = require('./playerItems');

const STORE_PATH = path.join(__dirname, '..', 'data', 'player-inventory.json');

function getEmptyState() {
  return { users: {} };
}

function ensureStoreFile() {
  const dir = path.dirname(STORE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(getEmptyState(), null, 2), 'utf8');
}

function normalizeUser(user) {
  const record = user && typeof user === 'object' ? { ...user } : {};
  record.items = record.items && typeof record.items === 'object' ? record.items : {};
  for (const itemId of Object.keys(record.items)) {
    const amount = Math.max(0, Math.floor(Number(record.items[itemId]) || 0));
    if (amount > 0 && ITEM_BY_ID[itemId]) record.items[itemId] = amount;
    else delete record.items[itemId];
  }
  return record;
}

function normalizeState(state) {
  const next = state && typeof state === 'object' ? { ...state } : getEmptyState();
  next.users = next.users && typeof next.users === 'object' ? next.users : {};
  for (const userId of Object.keys(next.users)) next.users[userId] = normalizeUser(next.users[userId]);
  return next;
}

function loadState() {
  ensureStoreFile();
  try { return normalizeState(JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'))); } catch { return getEmptyState(); }
}

function saveState(state) {
  ensureStoreFile();
  fs.writeFileSync(STORE_PATH, JSON.stringify(normalizeState(state), null, 2), 'utf8');
}

function mutateState(mutator) {
  const state = loadState();
  const result = mutator(state);
  saveState(state);
  return result;
}

function getUserRecord(state, userId) {
  const id = String(userId);
  if (!state.users[id]) state.users[id] = normalizeUser({});
  state.users[id] = normalizeUser(state.users[id]);
  return state.users[id];
}

function getInventory(userId) {
  const state = loadState();
  return JSON.parse(JSON.stringify(getUserRecord(state, userId).items));
}

function getInventoryEntries(userId, filters = {}) {
  const inventory = getInventory(userId);
  const allowedTypes = Array.isArray(filters.types) ? filters.types.map((type) => String(type).toLowerCase()) : [];
  const letterFilter = String(filters.letters || '').trim().toLowerCase();
  return Object.entries(inventory)
    .map(([itemId, amount]) => ({ item: ITEM_BY_ID[itemId], amount: Math.max(0, Math.floor(Number(amount) || 0)) }))
    .filter((entry) => entry.item && entry.amount > 0)
    .filter((entry) => !allowedTypes.length || allowedTypes.includes(String(entry.item.type).toLowerCase()))
    .filter((entry) => !letterFilter || entry.item.name.toLowerCase().includes(letterFilter))
    .sort((a, b) => a.item.name.localeCompare(b.item.name));
}

function addInventoryItem(userId, itemId, amount = 1) {
  const item = ITEM_BY_ID[itemId];
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (!item || delta <= 0) return 0;
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    user.items[itemId] = Math.max(0, Math.floor(Number(user.items[itemId]) || 0)) + delta;
    return user.items[itemId];
  });
}

function removeInventoryItem(userId, itemId, amount = 1) {
  const delta = Math.max(0, Math.floor(Number(amount) || 0));
  if (delta <= 0) return false;
  return mutateState((state) => {
    const user = getUserRecord(state, userId);
    const current = Math.max(0, Math.floor(Number(user.items[itemId]) || 0));
    if (current < delta) return false;
    const next = current - delta;
    if (next > 0) user.items[itemId] = next;
    else delete user.items[itemId];
    return true;
  });
}

module.exports = {
  STORE_PATH,
  getInventory,
  getInventoryEntries,
  addInventoryItem,
  removeInventoryItem,
};
