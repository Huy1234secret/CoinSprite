const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ADMIN_DIR = path.join(__dirname, '..', 'admin');
const ADMIN_FONT_PACKAGES = Object.freeze({
  'noto-sans': { packageName: '@fontsource-variable/noto-sans', family: 'Noto Sans Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  'noto-sans-sc': { packageName: '@fontsource-variable/noto-sans-sc', family: 'Noto Sans SC Variable', stylesheets: ['index.css'] },
  'noto-serif': { packageName: '@fontsource-variable/noto-serif', family: 'Noto Serif Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  'roboto-mono': { packageName: '@fontsource-variable/roboto-mono', family: 'Roboto Mono Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  nunito: { packageName: '@fontsource-variable/nunito', family: 'Nunito Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  oswald: { packageName: '@fontsource-variable/oswald', family: 'Oswald Variable', stylesheets: ['index.css'] },
  caveat: { packageName: '@fontsource-variable/caveat', family: 'Caveat Variable', stylesheets: ['index.css'] },
});

function contentHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}

function fontPackageDirectory(key) {
  const source = ADMIN_FONT_PACKAGES[key];
  if (!source) return '';
  try {
    return path.dirname(require.resolve(`${source.packageName}/package.json`));
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
  const entry = ADMIN_FONT_PACKAGES[key];
  const directory = fontPackageDirectory(key);
  if (!entry || !directory) return null;
  try {
    const source = entry.stylesheets.map((stylesheet) => fs.readFileSync(path.join(directory, stylesheet), 'utf8')).join('\n');
    const css = source.replace(/url\((['"]?)\.\/files\/([a-z0-9-]+\.woff2)\1\)/gi, (match, quote, filename) => {
      const font = loadFontFile(filename);
      if (!font) throw new Error(`Required browser font file is unavailable: ${entry.packageName}/files/${filename}`);
      return `url('/admin/fonts/files/${filename}?v=${font.version}')`;
    });
    if (!css.includes(`font-family: '${entry.family}'`)) throw new Error(`Required browser font family is unavailable: ${entry.family}`);
    if (!/font-style:\s*normal/.test(css) || !/font-weight:\s*\d+\s+\d+/.test(css)) {
      throw new Error(`Required browser font variants are incomplete: ${entry.family}`);
    }
    if (entry.stylesheets.includes('wght-italic.css') && !/font-style:\s*italic/.test(css)) {
      throw new Error(`Required browser italic font is unavailable: ${entry.family}`);
    }
    const data = Buffer.from(css);
    return { data, contentType: 'text/css; charset=utf-8', version: contentHash(data) };
  } catch {
    return null;
  }
}

function assertAdminFontsAvailable() {
  const loaded = Object.entries(ADMIN_FONT_PACKAGES).map(([key, entry]) => {
    const css = loadFontCss(key);
    if (!css) throw new Error(`Required browser Fontsource package is unavailable: ${entry.packageName}. Run "npm ci" before starting CoinSprite.`);
    return Buffer.concat([Buffer.from(`${key}\0${entry.family}\0`), css.data]);
  });
  return Object.freeze({
    families: Object.freeze(Object.values(ADMIN_FONT_PACKAGES).map((entry) => entry.family)),
    manifestHash: crypto.createHash('sha256').update(Buffer.concat(loaded)).digest('hex').slice(0, 24),
  });
}

const ADMIN_FONT_STATUS = assertAdminFontsAvailable();

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
  ADMIN_FONT_STATUS,
  assertAdminFontsAvailable,
  contentHash,
  loadAdminAsset,
  loadAdminFont,
  versionAdminStylesheet,
};
