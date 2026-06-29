'use strict';

const path = require('path');
const { executeSanction } = require('./moderationActionService');
const { createWarning } = require('./warningService');

const MAX_ACTION_BYTES = 26 * 1024 * 1024;
const MAX_EVIDENCE_BYTES = 25 * 1024 * 1024;
const ACTIONS = new Set(['warning', 'mute', 'kick', 'ban']);

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_ACTION_BYTES) {
      const error = new Error('The moderation action upload is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function parseActionForm(req) {
  const contentType = String(req.headers['content-type'] || '');
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    const error = new Error('Moderation actions must use multipart form data.');
    error.statusCode = 415;
    throw error;
  }
  const body = await readBody(req);
  const request = new Request('http://localhost/moderation-action', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  });
  const form = await request.formData();
  const action = String(form.get('action') || '').toLowerCase();
  if (!ACTIONS.has(action)) throw new Error('Choose warning, mute, kick, or ban.');
  const reason = String(form.get('reason') || '').trim().slice(0, 1000);
  if (!reason) throw new Error('A reason is required.');
  const rawAppealable = form.get('appealable');
  const appealable = rawAppealable == null
    ? true
    : !['false', '0', 'no', 'off'].includes(String(rawAppealable).toLowerCase());
  const value = form.get('evidence');
  let attachment = null;
  if (value && typeof value.arrayBuffer === 'function' && Number(value.size) > 0) {
    if (Number(value.size) > MAX_EVIDENCE_BYTES) throw new Error('Evidence files must be 25 MB or smaller.');
    if (!value.name || path.basename(value.name) !== value.name || /[\\/\0\r\n]/.test(value.name)) {
      throw new Error('The evidence filename is invalid.');
    }
    attachment = {
      name: path.basename(value.name),
      contentType: String(value.type || 'application/octet-stream').slice(0, 120),
      size: Number(value.size) || 0,
      buffer: Buffer.from(await value.arrayBuffer()),
      url: '',
    };
  }
  return {
    action,
    reason,
    time: String(form.get('time') || '').trim(),
    appealable,
    attachment,
  };
}

async function handleUserModerationAction(req, res, env, client, guildId, userId, deps) {
  const session = await deps.requireAdmin(req, res, env, client, guildId);
  if (!session) return;
  try {
    const input = await parseActionForm(req);
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
    const user = await client.users.fetch(userId);
    const member = await guild.members.fetch(userId).catch(() => null);
    if (input.action === 'warning') {
      const result = await createWarning({
        guild,
        member,
        moderatorId: session.user.id,
        source: 'dashboard',
        reason: input.reason,
        expires: input.time,
        attachment: input.attachment,
        appealable: input.appealable,
      });
      deps.sendJson(res, 201, result);
      return;
    }
    const result = await executeSanction({
      action: input.action,
      guild,
      user,
      member,
      moderatorId: session.user.id,
      reason: input.reason,
      time: input.action === 'kick' ? '' : input.time,
      attachment: input.attachment,
      appealable: input.appealable,
    });
    deps.sendJson(res, 201, result);
  } catch (error) {
    deps.sendJson(res, error?.statusCode || 400, { error: error?.message || 'Could not complete the moderation action.' });
  }
}

module.exports = {
  handleUserModerationAction,
  __test: { parseActionForm },
};
