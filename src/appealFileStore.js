'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.MODERATION_APPEAL_FILES_PATH
  || path.join(__dirname, '..', 'data', 'moderation-appeal-files');
const SUBMISSION_LIMIT_BYTES = 25 * 1024 * 1024;

function safeFilename(value, fallback = 'upload.bin') {
  const clean = String(value || fallback)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 180);
  return clean || fallback;
}

function uniqueFilename(value, used = new Set()) {
  const safe = safeFilename(value);
  const dot = safe.lastIndexOf('.');
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const extension = dot > 0 ? safe.slice(dot) : '';
  let candidate = safe;
  let suffix = 2;
  while (used.has(candidate.toLowerCase())) candidate = stem.slice(0, 160) + '-' + suffix++ + extension;
  used.add(candidate.toLowerCase());
  return candidate;
}

function extensionOf(value) {
  const extension = path.extname(String(value || '')).toLowerCase().replace(/^\./, '');
  return /^[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

function appealDirectory(guildId, appealId) {
  return path.resolve(ROOT, String(guildId), String(appealId));
}

function appealFilePath(guildId, appealId, storedName) {
  const safe = safeFilename(storedName, '');
  if (!safe || safe !== String(storedName || '')) return null;
  const root = appealDirectory(guildId, appealId);
  const target = path.resolve(root, safe);
  return target.startsWith(root + path.sep) ? target : null;
}

async function saveAppealFiles(guildId, appealId, files) {
  const directory = appealDirectory(guildId, appealId);
  await fs.promises.mkdir(directory, { recursive: true });
  const used = new Set();
  const saved = [];
  try {
    for (const file of files) {
      const storedName = uniqueFilename(file.name, used);
      const target = appealFilePath(guildId, appealId, storedName);
      await fs.promises.writeFile(target, file.buffer);
      saved.push({
        fieldId: String(file.fieldId || '').slice(0, 60),
        name: safeFilename(file.name),
        contentType: String(file.contentType || '').slice(0, 120),
        size: file.buffer.length,
        storedName,
      });
    }
    return saved;
  } catch (error) {
    await fs.promises.rm(directory, { recursive: true, force: true }).catch(() => null);
    throw error;
  }
}

async function removeAppealFiles(guildId, appealId) {
  await fs.promises.rm(appealDirectory(guildId, appealId), { recursive: true, force: true });
}

module.exports = {
  ROOT,
  SUBMISSION_LIMIT_BYTES,
  appealFilePath,
  extensionOf,
  removeAppealFiles,
  safeFilename,
  saveAppealFiles,
};
