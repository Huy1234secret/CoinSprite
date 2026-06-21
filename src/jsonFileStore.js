const fs = require('fs');
const path = require('path');

const writeQueues = new Map();
let temporarySequence = 0;

function recoveryLogPath(filePath) {
  return filePath + '.recovery.log';
}

function appendRecoveryLog(filePath, message) {
  const line = new Date().toISOString() + ' ' + String(message || 'Unknown persistence error') + '\n';
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(recoveryLogPath(filePath), line, 'utf8');
  } catch (error) {
    console.error('Could not write persistence recovery log for ' + filePath + ':', error);
  }
}

function readJsonFile(filePath, options = {}) {
  let serialized;
  try {
    serialized = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT' && Object.prototype.hasOwnProperty.call(options, 'fallback')) {
      return typeof options.fallback === 'function' ? options.fallback() : options.fallback;
    }
    throw error;
  }
  try {
    return JSON.parse(serialized || '{}');
  } catch (error) {
    const label = options.label || path.basename(filePath);
    const message = label + ' contains invalid JSON and was left unchanged: ' + (error?.message || error);
    appendRecoveryLog(filePath, message);
    console.error(message);
    throw new Error(label + ' contains invalid JSON. Restore it from backup before continuing.');
  }
}

function backupFileOnce(sourcePath, backupPath) {
  if (!fs.existsSync(sourcePath) || fs.existsSync(backupPath)) return false;
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  fs.copyFileSync(sourcePath, backupPath, fs.constants.COPYFILE_EXCL);
  return true;
}

function replaceFile(temporary, target) {
  try {
    fs.renameSync(temporary, target);
    return;
  } catch (error) {
    if (!fs.existsSync(target)) throw error;
  }
  const previous = target + '.replace-backup';
  try {
    if (fs.existsSync(previous)) fs.unlinkSync(previous);
    fs.renameSync(target, previous);
    fs.renameSync(temporary, target);
    try { fs.unlinkSync(previous); } catch {}
  } catch (error) {
    appendRecoveryLog(target, 'Atomic replacement failed: ' + (error?.message || error));
    if (!fs.existsSync(target) && fs.existsSync(previous)) fs.renameSync(previous, target);
    throw error;
  } finally {
    if (fs.existsSync(temporary)) {
      try { fs.unlinkSync(temporary); } catch {}
    }
  }
}

function flushWrite(filePath, serialized) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = filePath + '.tmp-' + process.pid + '-' + (++temporarySequence);
  const descriptor = fs.openSync(temporary, 'wx');
  try {
    fs.writeFileSync(descriptor, serialized, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  replaceFile(temporary, filePath);
}

function writeTextAtomic(filePath, serialized) {
  const queue = writeQueues.get(filePath) || [];
  queue.push(String(serialized));
  writeQueues.set(filePath, queue);
  if (queue.length > 1) return;
  try {
    while (queue.length) flushWrite(filePath, queue.shift());
  } finally {
    writeQueues.delete(filePath);
  }
}

function writeJsonAtomic(filePath, value) {
  writeTextAtomic(filePath, JSON.stringify(value, null, 2) + '\n');
}

module.exports = {
  appendRecoveryLog,
  backupFileOnce,
  readJsonFile,
  recoveryLogPath,
  writeJsonAtomic,
  writeTextAtomic,
  __test: { writeQueues },
};
