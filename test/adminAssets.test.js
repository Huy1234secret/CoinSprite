const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');

const root = path.resolve(__dirname, '..');

test('admin tab icons are configured with framed image assets', () => {
  const handler = fs.readFileSync(path.join(root, 'commands', '01-message-template-http.js'), 'utf8');
  const index = fs.readFileSync(path.join(root, 'admin', 'index.html'), 'utf8');

  assert.match(handler, /TAB_ICON_FRAME_STYLE/);
  assert.match(handler, /\/CoinSprite\/images\//);
  assert.match(handler, /moderator\.png/);
  assert.match(handler, /messages\.png/);
  assert.match(index, /tab-icon-frame/);
  assert.match(index, /leveling\.png/);
  assert.match(index, /data\.png/);
  assert.match(index, /ticket\.png/);
});
