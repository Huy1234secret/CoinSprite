const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { GlobalFonts } = require('@napi-rs/canvas');

const FONT_SOURCES = Object.freeze([
  { packageName: '@fontsource-variable/noto-sans', family: 'Noto Sans Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  { packageName: '@fontsource-variable/noto-serif', family: 'Noto Serif Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  { packageName: '@fontsource-variable/roboto-mono', family: 'Roboto Mono Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  { packageName: '@fontsource-variable/nunito', family: 'Nunito Variable', stylesheets: ['index.css', 'wght-italic.css'] },
  { packageName: '@fontsource-variable/oswald', family: 'Oswald Variable', stylesheets: ['index.css'] },
  { packageName: '@fontsource-variable/caveat', family: 'Caveat Variable', stylesheets: ['index.css'] },
  { packageName: '@fontsource-variable/noto-sans-sc', family: 'CoinSprite Unicode', stylesheets: ['index.css'] },
]);

let fontStatus = null;

function shortHash(parts) {
  const hash = crypto.createHash('sha256');
  for (const part of parts) hash.update(part);
  return hash.digest('hex').slice(0, 24);
}

function normalizedSource(filePath) {
  return Buffer.from(fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n'));
}

function resolveFontManifest() {
  const files = [];
  for (const source of FONT_SOURCES) {
    let currentFile = 'package.json';
    try {
      const packageJson = require.resolve(`${source.packageName}/package.json`);
      const directory = path.dirname(packageJson);
      const seen = new Set();
      for (const stylesheet of source.stylesheets) {
        currentFile = stylesheet;
        const css = fs.readFileSync(path.join(directory, stylesheet), 'utf8');
        const filenames = [...css.matchAll(/\.\/files\/([a-z0-9-]+\.woff2)/gi)].map((match) => match[1]);
        if (!filenames.length) throw new Error(`${source.packageName}/${stylesheet} contains no bundled WOFF2 files`);
        for (const filename of filenames) {
          if (seen.has(filename)) continue;
          seen.add(filename);
          currentFile = filename;
          const filePath = path.join(directory, 'files', filename);
          files.push({
            packageName: source.packageName,
            family: source.family,
            filename,
            filePath,
            bytes: fs.readFileSync(filePath),
          });
        }
      }
    } catch (error) {
      error.fontEntry = { packageName: source.packageName, family: source.family, filename: currentFile };
      throw error;
    }
  }
  return files;
}

function registrationFailure(entry, error) {
  const reason = String(error?.message || error || 'registration returned false').replace(/\s+/g, ' ').slice(0, 300);
  const installHint = error?.code === 'MODULE_NOT_FOUND' && entry?.packageName
    ? ' Required font dependency is not installed; run "npm ci" in this deployment before starting CoinSprite.'
    : '';
  return `Level card font registration failed: family="${entry?.family || 'unknown'}" package="${entry?.packageName || 'unknown'}" file="${entry?.filename || 'unknown'}" reason="${reason}".${installHint}`;
}

function registerCanvasFonts(options = {}) {
  if (fontStatus && options.force !== true) return fontStatus;
  const globalFonts = options.globalFonts || GlobalFonts;
  const log = options.log || console.info;
  let manifest;
  try {
    manifest = (options.resolveManifest || resolveFontManifest)();
  } catch (error) {
    const message = registrationFailure(error.fontEntry, error);
    (options.errorLog || console.error)(message);
    throw new Error(message, { cause: error });
  }

  for (const entry of manifest) {
    try {
      if (!globalFonts.registerFromPath(entry.filePath, entry.family)) throw new Error('registerFromPath returned false');
    } catch (error) {
      const message = registrationFailure(entry, error);
      (options.errorLog || console.error)(message);
      throw new Error(message, { cause: error });
    }
  }

  const families = FONT_SOURCES.map((source) => source.family);
  const missingFamilies = families.filter((family) => !globalFonts.has(family));
  if (missingFamilies.length) {
    const message = `Level card font verification failed: missing families="${missingFamilies.join(', ')}".`;
    (options.errorLog || console.error)(message);
    throw new Error(message);
  }

  const manifestHash = shortHash(manifest.map((entry) => Buffer.concat([
    Buffer.from(`${entry.packageName}\0${entry.family}\0${entry.filename}\0`),
    entry.bytes,
  ])));
  fontStatus = Object.freeze({ families: Object.freeze(families), files: manifest.length, manifestHash });
  log(`Level card fonts registered: families="${families.join(', ')}" files=${manifest.length} font-manifest=${manifestHash}.`);
  return fontStatus;
}

const CANVAS_FONT_STATUS = registerCanvasFonts();
const LEVEL_CARD_RENDERER_VERSION = `level-card-${shortHash([
  Buffer.from(`font-manifest=${CANVAS_FONT_STATUS.manifestHash}\0`),
  normalizedSource(__filename),
  normalizedSource(path.join(__dirname, 'leveling.js')),
  normalizedSource(path.join(__dirname, '..', 'package-lock.json')),
])}`;

function assertCanvasFontsAvailable(globalFonts = GlobalFonts) {
  const missing = CANVAS_FONT_STATUS.families.filter((family) => !globalFonts.has(family));
  if (missing.length) throw new Error(`Required level card fonts are unavailable: ${missing.join(', ')}`);
  return CANVAS_FONT_STATUS;
}

function levelCardRendererIdentity() {
  assertCanvasFontsAvailable();
  return Object.freeze({
    version: LEVEL_CARD_RENDERER_VERSION,
    fontManifestHash: CANVAS_FONT_STATUS.manifestHash,
    fontFamilies: CANVAS_FONT_STATUS.families,
    fontFiles: CANVAS_FONT_STATUS.files,
  });
}

function logLevelCardRendererIdentity(log = console.info, component = 'Runtime') {
  const identity = levelCardRendererIdentity();
  log(`${component} level card renderer ready: version=${identity.version} font-manifest=${identity.fontManifestHash} fonts="${identity.fontFamilies.join(', ')}" files=${identity.fontFiles}.`);
  return identity;
}

module.exports = {
  CANVAS_FONT_STATUS,
  FONT_SOURCES,
  LEVEL_CARD_RENDERER_VERSION,
  assertCanvasFontsAvailable,
  levelCardRendererIdentity,
  logLevelCardRendererIdentity,
  registerCanvasFonts,
  resolveFontManifest,
};
