'use strict';

const fs = require('fs');
const path = require('path');
const moderationCases = require('./moderationCaseStore');
const { evidencePath } = require('./moderationActionService');

async function handleModerationEvidence(req, res, guildId, caseId, encodedName, deps) {
  let storedName;
  try {
    storedName = decodeURIComponent(String(encodedName || ''));
  } catch {
    return deps.sendJson(res, 400, { error: 'Invalid evidence filename.' });
  }
  if (!storedName || path.basename(storedName) !== storedName) {
    return deps.sendJson(res, 404, { error: 'Evidence file was not found.' });
  }
  const record = moderationCases.getCase(guildId, caseId);
  const attachment = record?.attachments?.find((item) => item.storedName === storedName);
  const filePath = attachment ? evidencePath(guildId, record.id, storedName) : null;
  if (!filePath) return deps.sendJson(res, 404, { error: 'Evidence file was not found.' });
  try {
    const data = await fs.promises.readFile(filePath);
    return deps.send(res, 200, data, {
      'Content-Type': attachment.contentType || 'application/octet-stream',
      'Content-Disposition': 'inline; filename="' + String(attachment.name || storedName).replace(/["\r\n]/g, '_') + '"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  } catch {
    return deps.sendJson(res, 404, { error: 'Evidence file was not found.' });
  }
}

module.exports = { handleModerationEvidence };
