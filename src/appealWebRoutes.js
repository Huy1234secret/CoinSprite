'use strict';

const fs = require('fs');
const path = require('path');
const appealFiles = require('./appealFileStore');
const appealService = require('./appealService');
const appealStore = require('./appealStore');
const { sanitizeAppealConfig } = require('./appealConfig');
const { getGuildConfig } = require('./serverConfig');
const moderationCases = require('./moderationCaseStore');

const MAX_MULTIPART_BYTES = appealFiles.SUBMISSION_LIMIT_BYTES + 1024 * 1024;

function publicCase(record, guildId) {
  const copy = {
    id: record.id,
    type: record.type,
    status: record.status,
    authorId: record.moderatorId,
    reason: record.reason,
    evidenceUrl: /^https:\/\//i.test(String(record.evidence || '')) ? String(record.evidence) : '',
    publicNote: record.publicNote || '',
    appealable: record.appealable,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    attachments: (record.attachments || []).map((item) => ({
      name: item.name,
      contentType: item.contentType,
      size: item.size,
      url: item.storedName
        ? '/api/appeal/guilds/' + guildId + '/cases/' + encodeURIComponent(record.id) + '/evidence/' + encodeURIComponent(item.storedName)
        : '',
    })),
  };
  return copy;
}

function publicAppeal(record) {
  return {
    id: record.id,
    caseId: record.caseId,
    status: record.status,
    answers: record.answers,
    attachments: (record.attachments || []).map((item) => ({
      fieldId: item.fieldId,
      name: item.name,
      contentType: item.contentType,
      size: item.size,
      url: '/api/appeal/guilds/' + record.guildId + '/submissions/' + encodeURIComponent(record.id) + '/files/' + encodeURIComponent(item.storedName),
    })),
    formSnapshot: record.formSnapshot,
    createdAt: record.createdAt,
    decidedAt: record.decidedAt,
    decidedBy: record.decidedBy,
    decisionReason: record.decisionReason,
  };
}

async function readBody(req, limit = MAX_MULTIPART_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      const error = new Error('Appeal submission is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function parseMultipart(req) {
  const type = String(req.headers['content-type'] || '');
  if (!type.toLowerCase().startsWith('multipart/form-data;')) {
    const error = new Error('Appeals must be submitted as multipart form data.');
    error.statusCode = 415;
    throw error;
  }
  const body = await readBody(req);
  const request = new Request('http://localhost/appeal-submit', { method: 'POST', headers: { 'content-type': type }, body });
  const form = await request.formData();
  let answers = {};
  try { answers = JSON.parse(String(form.get('answers') || '{}')); } catch {
    const error = new Error('Appeal answers are invalid.');
    error.statusCode = 400;
    throw error;
  }
  const files = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('file:') || typeof value.arrayBuffer !== 'function') continue;
    if (!value.name || path.basename(value.name) !== value.name || /[\\/\0\r\n]/.test(value.name)) {
      const error = new Error('An uploaded filename is invalid.');
      error.statusCode = 400;
      throw error;
    }
    files.push({
      fieldId: name.slice(5, 65),
      name: path.basename(value.name),
      contentType: String(value.type || 'application/octet-stream').slice(0, 120),
      buffer: Buffer.from(await value.arrayBuffer()),
    });
  }
  return { answers, files };
}

function requireUser(req, res, env, deps) {
  const { session } = deps.getSession(req, res, env);
  if (!session.user?.id) {
    deps.sendJson(res, 401, { error: 'Discord login is required.' });
    return null;
  }
  return session;
}

function requireCsrf(req, res, session, deps) {
  const supplied = String(req.headers['x-csrf-token'] || '');
  if (!session.csrfToken || supplied !== session.csrfToken) {
    deps.sendJson(res, 403, { error: 'Invalid CSRF token.' });
    return false;
  }
  return true;
}

async function canReadOwnedResource(req, res, env, client, guildId, ownerId, deps) {
  const { session } = deps.getSession(req, res, env);
  if (!session.user?.id) {
    deps.sendJson(res, 401, { error: 'Discord login is required.' });
    return false;
  }
  if (session.user.id === ownerId) return true;
  return Boolean(await deps.requireModerator(req, res, env, client, guildId));
}

async function sendPrivateFile(res, filePath, metadata, deps) {
  try {
    const data = await fs.promises.readFile(filePath);
    return deps.send(res, 200, data, {
      'Content-Type': metadata.contentType || 'application/octet-stream',
      'Content-Disposition': 'inline; filename="' + String(metadata.name || 'file').replace(/["\r\n]/g, '_') + '"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
  } catch {
    return deps.sendJson(res, 404, { error: 'File was not found.' });
  }
}

async function caseList(client, userId) {
  const rows = await appealService.listUserCases(client, userId);
  return Promise.all(rows.map(async (row) => {
    const author = row.case.moderatorId
      ? await client.users.fetch(row.case.moderatorId).catch(() => null)
      : null;
    return {
      guildId: row.guildId,
      guildName: row.guildName,
      case: { ...publicCase(row.case, row.guildId), author: author ? {
        id: author.id,
        username: author.username,
        globalName: author.globalName || author.username,
        avatarUrl: author.displayAvatarURL?.({ size: 128 }) || '',
      } : null },
      eligibility: row.eligibility,
      form: sanitizeAppealConfig(getGuildConfig(row.guildId)?.moderation?.appeals).questions,
      appeals: row.appeals.map(publicAppeal),
    };
  }));
}

async function handleAppealApi(req, res, url, env, client, deps) {
  if (!url.pathname.startsWith('/api/appeal/')) return false;

  if (req.method === 'GET' && url.pathname === '/api/appeal/me') {
    const { session } = deps.getSession(req, res, env);
    return deps.sendJson(res, 200, { user: session.user || null, csrfToken: session.user ? session.csrfToken : '' });
  }

  const session = requireUser(req, res, env, deps);
  if (!session) return true;

  if (req.method === 'GET' && url.pathname === '/api/appeal/cases') {
    deps.sendJson(res, 200, { cases: await caseList(client, session.user.id) });
    return true;
  }

  const detail = url.pathname.match(/^\/api\/appeal\/guilds\/(\d{16,20})\/cases\/([^/]+)$/);
  if (detail && req.method === 'GET') {
    const cases = await caseList(client, session.user.id);
    const record = cases.find((item) => item.guildId === detail[1] && item.case.id.toLowerCase() === decodeURIComponent(detail[2]).toLowerCase());
    if (!record) {
      deps.sendJson(res, 404, { error: 'Moderation case was not found.' });
      return true;
    }
    deps.sendJson(res, 200, { case: record });
    return true;
  }

  const submit = url.pathname.match(/^\/api\/appeal\/guilds\/(\d{16,20})\/cases\/([^/]+)\/submissions$/);
  if (submit && req.method === 'POST') {
    if (!requireCsrf(req, res, session, deps)) return true;
    const payload = await parseMultipart(req);
    const appeal = await appealService.submitAppeal({
      client,
      guildId: submit[1],
      caseId: decodeURIComponent(submit[2]),
      userId: session.user.id,
      answers: payload.answers,
      files: payload.files,
    });
    deps.sendJson(res, 201, { appeal: publicAppeal(appeal) });
    return true;
  }

  const evidence = url.pathname.match(/^\/api\/appeal\/guilds\/(\d{16,20})\/cases\/([^/]+)\/evidence\/([^/]+)$/);
  if (evidence && req.method === 'GET') {
    const guildId = evidence[1];
    const caseId = decodeURIComponent(evidence[2]);
    const storedName = decodeURIComponent(evidence[3]);
    const record = moderationCases.getCase(guildId, caseId);
    if (!record || !await canReadOwnedResource(req, res, env, client, guildId, record.memberId, deps)) return true;
    const attachment = record.attachments?.find((item) => item.storedName === storedName);
    const filePath = attachment ? require('./moderationActionService').evidencePath(guildId, record.id, storedName) : null;
    if (!filePath) {
      deps.sendJson(res, 404, { error: 'Evidence file was not found.' });
      return true;
    }
    await sendPrivateFile(res, filePath, attachment, deps);
    return true;
  }

  const upload = url.pathname.match(/^\/api\/appeal\/guilds\/(\d{16,20})\/submissions\/([^/]+)\/files\/([^/]+)$/);
  if (upload && req.method === 'GET') {
    const guildId = upload[1];
    const appealId = decodeURIComponent(upload[2]);
    const storedName = decodeURIComponent(upload[3]);
    const appeal = appealStore.getAppeal(guildId, appealId);
    if (!appeal || !await canReadOwnedResource(req, res, env, client, guildId, appeal.userId, deps)) return true;
    const attachment = appeal.attachments.find((item) => item.storedName === storedName);
    const filePath = attachment ? appealFiles.appealFilePath(guildId, appeal.id, storedName) : null;
    if (!filePath) {
      deps.sendJson(res, 404, { error: 'Appeal file was not found.' });
      return true;
    }
    await sendPrivateFile(res, filePath, attachment, deps);
    return true;
  }

  deps.sendJson(res, 404, { error: 'Appeal endpoint was not found.' });
  return true;
}

module.exports = {
  handleAppealApi,
  __test: { parseMultipart, publicAppeal, publicCase },
};
