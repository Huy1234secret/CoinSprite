const fs = require('fs');
const path = require('path');
const { STATE_PATH } = require('./config');

function defaultState() {
  return {
    version: 2,
    posts: {},
    unavailable: {},
    roleAssignmentPanels: {},
  };
}

function loadState(filePath = STATE_PATH) {
  if (!fs.existsSync(filePath)) return defaultState();
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8') || '{}');
    return {
      ...defaultState(),
      ...(parsed && typeof parsed === 'object' ? parsed : {}),
    };
  } catch {
    return defaultState();
  }
}

function saveState(state, filePath = STATE_PATH) {
  const nextState = {
    ...defaultState(),
    ...(state && typeof state === 'object' ? state : {}),
    version: 2,
  };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  return nextState;
}

module.exports = {
  defaultState,
  loadState,
  saveState,
};
