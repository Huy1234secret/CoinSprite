const path = require('path');
const { readJsonFile, writeJsonAtomic } = require('./jsonFileStore');

const STORE_PATH = path.join(__dirname, '..', 'data', 'word-chain-event.json');

function loadEventState(filePath = STORE_PATH) {
  return readJsonFile(filePath, {
    label: 'Word Chain event data',
    fallback: null,
  });
}

function saveEventState(state, filePath = STORE_PATH) {
  writeJsonAtomic(filePath, state);
}

module.exports = {
  STORE_PATH,
  loadEventState,
  saveEventState,
};
