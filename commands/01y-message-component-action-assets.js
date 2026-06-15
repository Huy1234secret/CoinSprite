const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '..', 'admin', 'index.html');
const nativeReadFileSync = fs.readFileSync.bind(fs);

if (!fs.__coinSpriteMessageComponentActionAsset) {
  fs.__coinSpriteMessageComponentActionAsset = true;
  fs.readFileSync = function readFileWithMessageComponentActions(filePath, ...args) {
    const value = nativeReadFileSync(filePath, ...args);
    if (path.resolve(String(filePath)) !== INDEX_PATH || typeof value !== 'string') return value;
    if (value.includes('/admin/message-component-actions.js')) return value;
    return value.replace(
      '</body>',
      '  <script src="/admin/message-component-actions.js" defer></script>\n</body>',
    );
  };
}

module.exports = {};
