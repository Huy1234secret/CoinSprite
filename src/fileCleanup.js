const fs = require('fs');
const path = require('path');

function tryDelete(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Best-effort cleanup; never block the command that is generating a fresh image.
  }
}

function deletePreviousImages(dirPath, currentPath, matcher) {
  if (!fs.existsSync(dirPath)) return;
  const currentResolved = path.resolve(currentPath);

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile() || !matcher(entry.name)) continue;

    const candidate = path.join(dirPath, entry.name);
    if (path.resolve(candidate) === currentResolved) continue;
    tryDelete(candidate);
  }
}

function getCleanupMatcher(dirPath, fileName) {
  const normalizedDir = path.normalize(dirPath).toLowerCase();

  if (normalizedDir.endsWith(path.normalize('data/market-charts'))) {
    const match = fileName.match(/^(market-.+)-\d{4}-\d{2}-\d{2}t/i);
    if (!match) return null;
    return (name) => name.startsWith(match[1]) && name.endsWith('.png');
  }

  if (normalizedDir.endsWith(path.normalize('data/roulette-cache'))) {
    const match = fileName.match(/^(roulette-table-[a-z0-9]+)-\d+\.png$/i);
    if (!match) return null;
    return (name) => name.startsWith(`${match[1]}-`) && name.endsWith('.png');
  }

  if (normalizedDir.endsWith(path.normalize('data/leaderboards'))) {
    if (/^gambling-leaderboard-\d+\.png$/i.test(fileName)) {
      return (name) => /^gambling-leaderboard-\d+\.png$/i.test(name);
    }

    const match = fileName.match(/^(leaderboard-[^-]+)-\d+\.png$/i);
    if (!match) return null;
    return (name) => name.startsWith(`${match[1]}-`) && name.endsWith('.png');
  }

  return null;
}

function cleanupGeneratedFiles(file) {
  const filePath = path.resolve(String(file));
  const fileName = path.basename(filePath);

  if (fileName.toLowerCase().endsWith('.png')) {
    const matcher = getCleanupMatcher(path.dirname(filePath), fileName);
    if (matcher) {
      deletePreviousImages(path.dirname(filePath), filePath, matcher);
    }
  }
}

module.exports = { cleanupGeneratedFiles };
