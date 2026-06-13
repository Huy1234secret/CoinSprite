'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_FIXES_JS = path.join(__dirname, '..', 'admin', 'admin-fixes.js');

const bridgeScript = String.raw`
;(() => {
  window.state = state;
  window.TAB_NAMES = TAB_NAMES;
  window.ensureTicketEditor = ensureTicketEditor;
  window.setStatus = setStatus;
  window.refreshDirtyState = refreshDirtyState;
  window.setActiveTab = setActiveTab;
})();
`;

const previousReadFile = fs.readFile.bind(fs);
fs.readFile = function patchedReadFile(filePath, ...args) {
  const callback = args[args.length - 1];
  if (path.resolve(String(filePath)) !== path.resolve(ADMIN_FIXES_JS) || typeof callback !== 'function') {
    return previousReadFile(filePath, ...args);
  }

  args[args.length - 1] = (error, data) => {
    if (error) return callback(error, data);
    const source = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    callback(null, source + bridgeScript);
  };
  return previousReadFile(filePath, ...args);
};

module.exports = {};
