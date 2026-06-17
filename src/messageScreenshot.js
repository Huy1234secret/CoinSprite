'use strict';

const fs = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');

const WIDTH = 900;
const PADDING = 28;
const AVATAR_SIZE = 54;
const CONTENT_X = PADDING + AVATAR_SIZE + 16;
const CONTENT_WIDTH = WIDTH - CONTENT_X - PADDING;
const LINE_HEIGHT = 25;
const MAX_LINES = 18;
const SCREENSHOT_DIR = process.env.MODERATION_SCREENSHOT_DIR
  ? path.resolve(process.env.MODERATION_SCREENSHOT_DIR)
  : path.join(__dirname, '..', 'data', 'moderation-screenshots');

function cleanText(value, max = 1600) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim()
    .slice(0, max);
}

function safePathPart(value, fallback = 'unknown', max = 48) {
  const text = cleanText(value, max)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
  return text || fallback;
}

function screenshotDirectory(message) {
  return path.join(
    SCREENSHOT_DIR,
    safePathPart(message.guildId || message.guild?.id, 'dm', 24),
    safePathPart(message.channelId || message.channel?.id, 'channel', 24),
  );
}

function screenshotFilename(message) {
  const created = message.createdAt instanceof Date ? message.createdAt : new Date(Number(message.createdTimestamp) || Date.now());
  const timestamp = created.toISOString().replace(/[:.]/g, '-');
  const user = safePathPart(message.author?.username || message.author?.id, 'user', 32);
  const id = safePathPart(message.id || Date.now(), 'message', 32);
  return `${timestamp}-${user}-${id}.png`;
}

function displayName(message) {
  return cleanText(message.member?.displayName || message.author?.globalName || message.author?.username || 'Unknown user', 80) || 'Unknown user';
}

function channelName(message) {
  return cleanText(message.channel?.name || message.channelId || 'unknown-channel', 80) || 'unknown-channel';
}

function formatTimestamp(message) {
  const date = message.createdAt instanceof Date ? message.createdAt : new Date(Number(message.createdTimestamp) || Date.now());
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function wrapLine(ctx, line, width) {
  const words = String(line || '').split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= width) {
      current = test;
      continue;
    }
    if (current) lines.push(current);
    if (ctx.measureText(word).width <= width) {
      current = word;
      continue;
    }
    let chunk = '';
    for (const char of word) {
      const next = `${chunk}${char}`;
      if (ctx.measureText(next).width > width && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    }
    current = chunk;
  }
  if (current) lines.push(current);
  return lines;
}

function wrapText(ctx, value, width) {
  const result = [];
  for (const rawLine of cleanText(value || '[no text]').split('\n')) {
    result.push(...wrapLine(ctx, rawLine, width));
    if (result.length >= MAX_LINES) break;
  }
  if (result.length > MAX_LINES) result.length = MAX_LINES;
  if (!result.length) result.push('[no text]');
  return result;
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawAvatar(ctx, name) {
  const x = PADDING;
  const y = PADDING + 42;
  const initials = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || '?';
  const gradient = ctx.createLinearGradient(x, y, x + AVATAR_SIZE, y + AVATAR_SIZE);
  gradient.addColorStop(0, '#5865F2');
  gradient.addColorStop(1, '#EB459E');
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + AVATAR_SIZE / 2, y + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '700 20px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initials, x + AVATAR_SIZE / 2, y + AVATAR_SIZE / 2 + 1);
  ctx.restore();
}

function drawPill(ctx, text, x, y, color) {
  ctx.font = '700 14px Arial, sans-serif';
  const width = Math.ceil(ctx.measureText(text).width) + 20;
  drawRoundRect(ctx, x, y, width, 28, 14);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 10, y + 14);
  return width;
}

async function renderMessageScreenshot(message, moderation = {}) {
  const name = displayName(message);
  const username = cleanText(message.author?.username || 'unknown', 60);
  const content = cleanText(message.content || '[no text]');
  const attachmentCount = Number(message.attachments?.size || message.attachments?.length || 0);
  const canvasProbe = createCanvas(WIDTH, 220);
  const probe = canvasProbe.getContext('2d');
  probe.font = '18px Arial, sans-serif';
  const contentLines = wrapText(probe, content, CONTENT_WIDTH);
  const attachmentsLine = attachmentCount > 0 ? [`[${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}]`] : [];
  const totalLines = contentLines.length + attachmentsLine.length;
  const height = Math.max(230, PADDING * 2 + 112 + totalLines * LINE_HEIGHT + 38);
  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0B0D11';
  ctx.fillRect(0, 0, WIDTH, height);
  drawRoundRect(ctx, 18, 18, WIDTH - 36, height - 36, 16);
  ctx.fillStyle = '#313338';
  ctx.fill();

  ctx.fillStyle = '#111318';
  drawRoundRect(ctx, PADDING, PADDING, WIDTH - PADDING * 2, 34, 10);
  ctx.fill();
  ctx.fillStyle = '#B5BAC1';
  ctx.font = '700 14px Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`#${channelName(message)}`, PADDING + 14, PADDING + 17);
  ctx.fillStyle = '#80848E';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText(formatTimestamp(message), WIDTH - PADDING - 190, PADDING + 17);

  drawAvatar(ctx, name);

  let y = PADDING + 50;
  ctx.fillStyle = '#F2F3F5';
  ctx.font = '700 19px Arial, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(name, CONTENT_X, y + 16);
  const nameWidth = ctx.measureText(name).width;
  ctx.fillStyle = '#949BA4';
  ctx.font = '13px Arial, sans-serif';
  ctx.fillText(`@${username}`, CONTENT_X + nameWidth + 12, y + 16);

  y += 40;
  ctx.fillStyle = '#DBDEE1';
  ctx.font = '18px Arial, sans-serif';
  for (const line of contentLines) {
    ctx.fillText(line || ' ', CONTENT_X, y);
    y += LINE_HEIGHT;
  }
  if (contentLines.length >= MAX_LINES) {
    ctx.fillStyle = '#949BA4';
    ctx.font = '14px Arial, sans-serif';
    ctx.fillText('[message truncated]', CONTENT_X, y);
    y += LINE_HEIGHT;
  }
  for (const line of attachmentsLine) {
    ctx.fillStyle = '#8EA1E1';
    ctx.font = '16px Arial, sans-serif';
    ctx.fillText(line, CONTENT_X, y);
    y += LINE_HEIGHT;
  }

  const score = Number(moderation.severityScore);
  const scoreText = Number.isFinite(score) ? `Severity ${Math.max(0, Math.min(10, score)).toFixed(score % 1 ? 1 : 0)}/10` : 'Severity -';
  const rules = Array.isArray(moderation.brokenRules) && moderation.brokenRules.length ? moderation.brokenRules.join(', ') : 'No rule';
  const footerY = height - PADDING - 32;
  drawPill(ctx, scoreText, CONTENT_X, footerY, '#ED4245');
  drawPill(ctx, `Rule ${rules}`, CONTENT_X + 140, footerY, '#5865F2');

  return { attachment: await canvas.encode('png'), name: screenshotFilename(message) };
}

async function saveMessageScreenshot(message, moderation = {}) {
  const screenshot = await renderMessageScreenshot(message, moderation);
  const directory = screenshotDirectory(message);
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, screenshot.name);
  fs.writeFileSync(filePath, screenshot.attachment);
  return { ...screenshot, path: filePath };
}

module.exports = { renderMessageScreenshot, saveMessageScreenshot };
