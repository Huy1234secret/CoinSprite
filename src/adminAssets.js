const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const ADMIN_FONT_PACKAGES = Object.freeze({
  'noto-sans': '@fontsource-variable/noto-sans',
  'noto-sans-sc': '@fontsource-variable/noto-sans-sc',
  'noto-serif': '@fontsource-variable/noto-serif',
  'roboto-mono': '@fontsource-variable/roboto-mono',
  nunito: '@fontsource-variable/nunito',
  oswald: '@fontsource-variable/oswald',
  caveat: '@fontsource-variable/caveat',
});

function contentHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function fontPackageDirectory(key) {
  const packageName = ADMIN_FONT_PACKAGES[key];
  if (!packageName) return '';
  try {
    return path.dirname(require.resolve(`${packageName}/package.json`));
  } catch {
    return '';
  }
}

function fontKeyForFile(filename) {
  return Object.keys(ADMIN_FONT_PACKAGES)
    .sort((left, right) => right.length - left.length)
    .find((key) => filename.startsWith(`${key}-`)) || '';
}

function loadFontFile(filename) {
  if (!/^[a-z0-9-]+\.woff2$/.test(filename)) return null;
  const key = fontKeyForFile(filename);
  const directory = fontPackageDirectory(key);
  if (!directory) return null;
  try {
    const data = fs.readFileSync(path.join(directory, 'files', filename));
    return { data, contentType: 'font/woff2', version: contentHash(data) };
  } catch {
    return null;
  }
}

function loadFontCss(key) {
  const directory = fontPackageDirectory(key);
  if (!directory) return null;
  try {
    const source = fs.readFileSync(path.join(directory, 'index.css'), 'utf8');
    const css = source.replace(/url\((['"]?)\.\/files\/([a-z0-9-]+\.woff2)\1\)/gi, (match, quote, filename) => {
      const font = loadFontFile(filename);
      if (!font) return match;
      return `url('/admin/fonts/files/${filename}?v=${font.version}')`;
    });
    const data = Buffer.from(css);
    return { data, contentType: 'text/css; charset=utf-8', version: contentHash(data) };
  } catch {
    return null;
  }
}

function versionAdminStylesheet(source) {
  return source.replace(/\/admin\/fonts\/([a-z-]+)\.css(?:\?v=[^'"\s)]+)?/g, (match, key) => {
    const font = loadFontCss(key);
    return font ? `/admin/fonts/${key}.css?v=${font.version}` : match;
  });
}

function loadAdminAsset(filename) {
  if (!['index.html', 'app.js', 'style.css'].includes(filename)) return null;
  try {
    let source = fs.readFileSync(path.join(ADMIN_DIR, filename));
    if (filename === 'style.css') source = Buffer.from(versionAdminStylesheet(source.toString('utf8')));
    if (filename === 'index.html') {
      let html = source.toString('utf8');
      for (const assetName of ['style.css', 'app.js']) {
        const asset = loadAdminAsset(assetName);
        if (asset) {
          const pattern = new RegExp(`/admin/${assetName.replace('.', '\\.')}(?:\\?v=[^'"\\s>]+)?`, 'g');
          html = html.replace(pattern, `/admin/${assetName}?v=${asset.version}`);
        }
      }
      source = Buffer.from(html);
    }
    return { data: source, version: contentHash(source) };
  } catch {
    return null;
  }
}

function loadAdminFont(pathname) {
  const cssMatch = pathname.match(/^\/admin\/fonts\/([a-z-]+)\.css$/);
  if (cssMatch) return loadFontCss(cssMatch[1]);
  const fileMatch = pathname.match(/^\/admin\/fonts\/files\/([a-z0-9-]+\.woff2)$/);
  return fileMatch ? loadFontFile(fileMatch[1]) : null;
}

module.exports = {
  ADMIN_FONT_PACKAGES,
  contentHash,
  loadAdminAsset,
  loadAdminFont,
  versionAdminStylesheet,
};
