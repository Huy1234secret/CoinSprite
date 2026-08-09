const fs = require('fs');
const path = require('path');
const { GlobalFonts } = require('@napi-rs/canvas');

const FONT_SOURCES = Object.freeze([
  ['@fontsource-variable/noto-sans', 'Noto Sans Variable'],
  ['@fontsource-variable/noto-serif', 'Noto Serif Variable'],
  ['@fontsource-variable/roboto-mono', 'Roboto Mono Variable'],
  ['@fontsource-variable/nunito', 'Nunito Variable'],
  ['@fontsource-variable/oswald', 'Oswald Variable'],
  ['@fontsource-variable/caveat', 'Caveat Variable'],
  ['@fontsource-variable/noto-sans-sc', 'CoinSprite Unicode'],
]);

let registered = false;

function registerCanvasFonts() {
  if (registered) return;
  registered = true;
  for (const [packageName, family] of FONT_SOURCES) {
    try {
      const directory = path.join(path.dirname(require.resolve(`${packageName}/package.json`)), 'files');
      for (const filename of fs.readdirSync(directory)) {
        if (!filename.endsWith('-wght-normal.woff2') && !filename.endsWith('-wght-italic.woff2')) continue;
        GlobalFonts.registerFromPath(path.join(directory, filename), family);
      }
    } catch {}
  }
}

registerCanvasFonts();

module.exports = { registerCanvasFonts };
