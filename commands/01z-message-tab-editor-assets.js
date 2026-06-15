const fs = require('fs');
const path = require('path');

const INDEX_PATH = path.resolve(__dirname, '..', 'admin', 'index.html');
const nativeReadFileSync = fs.readFileSync.bind(fs);

if (!fs.__coinSpriteMessageTabEditorAsset) {
  fs.__coinSpriteMessageTabEditorAsset = true;
  fs.readFileSync = function readFileWithMessageTabEditor(filePath, ...args) {
    const value = nativeReadFileSync(filePath, ...args);
    if (path.resolve(String(filePath)) !== INDEX_PATH || typeof value !== 'string') {
      return value;
    }
    if (value.includes('/admin/message-tab-inline-editor.js')) {
      return value;
    }
    return value.replace(
      '</body>',
      [
        '  <script src="/admin/message-tab-inline-editor.js" defer></script>',
        '  <script src="/admin/message-tab-inline-editor-guard.js" defer></script>',
        '</body>',
      ].join('\n'),
    );
  };
}

module.exports = {};
