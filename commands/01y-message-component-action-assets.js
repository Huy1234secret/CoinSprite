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
    return value
      .replace(
        '</head>',
        '  <link rel="stylesheet" href="/admin/message-component-actions.css?v=action-save-3">\n</head>',
      )
      .replace(
        '</body>',
        [
          '  <script src="/admin/message-component-actions.js?v=action-save-3" defer></script>',
          '  <script src="/admin/message-action-persistence-fix.js?v=action-save-3" defer></script>',
          '  <script src="/admin/emoji-picker-upgrade.js" defer></script>',
          '</body>',
        ].join('\n'),
      );
  };
}

module.exports = {};
