const fs = require('fs');
const path = require('path');
const discord = require('discord.js');
const { appendTranscriptSection } = require('../src/monthlyTranscriptArchive');

const originalWriteFileSync = fs.writeFileSync.bind(fs);
const redirectedTranscriptFiles = new Map();

function isTranscriptFile(filePath) {
  const normalized = path.normalize(filePath).toLowerCase();
  return normalized.includes(`${path.sep}transcripts${path.sep}`) && normalized.endsWith('.txt');
}

function getTranscriptBaseName(fileName) {
  const messageMatch = fileName.match(/^(message-transcript-\d+)-\d{2}-\d{2}-\d{4}_\d{2}-\d{2}\.txt$/i);
  if (messageMatch) return messageMatch[1];

  const ticketMatch = fileName.match(/^(.+) - \d{2}-\d{2}-\d{4}_\d{2}-\d{2}\.txt$/i);
  if (ticketMatch) return ticketMatch[1];

  return null;
}

function splitTranscriptContent(content) {
  const lines = String(content || '').replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const blankIndex = lines.indexOf('');
  if (blankIndex === -1) {
    return { headerLines: [], transcriptLines: lines };
  }

  return {
    headerLines: lines.slice(0, blankIndex),
    transcriptLines: lines.slice(blankIndex + 1),
  };
}

fs.writeFileSync = function patchedTranscriptWrite(file, data, options) {
  const filePath = path.resolve(String(file));
  if (isTranscriptFile(filePath)) {
    const baseName = getTranscriptBaseName(path.basename(filePath));
    if (baseName) {
      const { headerLines, transcriptLines } = splitTranscriptContent(data);
      const monthlyPath = appendTranscriptSection(baseName, headerLines, transcriptLines);
      redirectedTranscriptFiles.set(filePath, monthlyPath);
      return undefined;
    }
  }

  return originalWriteFileSync(file, data, options);
};

function redirectTranscriptUpload(file) {
  if (typeof file === 'string') {
    return redirectedTranscriptFiles.get(path.resolve(file)) || file;
  }

  if (file && typeof file === 'object' && typeof file.attachment === 'string') {
    const redirected = redirectedTranscriptFiles.get(path.resolve(file.attachment));
    if (redirected) return { ...file, attachment: redirected };
  }

  return file;
}

function patchSend(Constructor) {
  if (!Constructor?.prototype?.send || Constructor.prototype.send.__monthlyTranscriptPatched) return;

  const originalSend = Constructor.prototype.send;
  Constructor.prototype.send = function patchedSend(options) {
    if (options && Array.isArray(options.files)) {
      return originalSend.call(this, { ...options, files: options.files.map(redirectTranscriptUpload) });
    }

    return originalSend.call(this, options);
  };
  Constructor.prototype.send.__monthlyTranscriptPatched = true;
}

patchSend(discord.TextChannel);
patchSend(discord.NewsChannel);
patchSend(discord.ThreadChannel);

module.exports = {};
