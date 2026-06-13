'use strict';

const fs = require('fs');
const path = require('path');

const ADMIN_FIXES_JS = path.join(__dirname, '..', 'admin', 'admin-fixes.js');

const requestActionValueScript = String.raw`
;(() => {
  if (window.__coinSpriteRequestActionValues) return;
  window.__coinSpriteRequestActionValues = true;

  const nativeValues = {
    accept: 'close',
    deny: 'delete',
    dm_message: 'transcript',
    role_add: 'move_to',
    blacklist: 'blacklist',
  };

  document.addEventListener('click', (event) => {
    const button = event.target.closest('#ticketEditorRoot [data-action="add-action"]');
    if (!button) return;
    const card = button.closest('.ticket-control-card');
    const select = card?.querySelector('[data-action-select]');
    const nativeValue = nativeValues[select?.value];
    if (!select || !nativeValue || nativeValue === select.value) return;

    let temporaryOption = [...select.options].find((option) => option.value === nativeValue);
    if (!temporaryOption) {
      temporaryOption = new Option(select.selectedOptions[0]?.textContent || nativeValue, nativeValue);
      temporaryOption.hidden = true;
      select.add(temporaryOption);
    }
    select.value = nativeValue;
  }, true);
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
    callback(null, source + requestActionValueScript);
  };
  return previousReadFile(filePath, ...args);
};

module.exports = {};
