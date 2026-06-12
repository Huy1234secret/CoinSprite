const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'data', 'message-templates.json');
const COMPONENTS_V2_FLAG = 32768;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function cleanText(value, fallback = '', max = 4000) {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, max);
}
function cleanUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString().slice(0, 1000) : '';
  } catch { return ''; }
}
function cleanColor(value) {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : '#5865F2';
}
function cleanId(value, fallback = 'template') {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || fallback;
}

function defaultTemplate(index = 1) {
  return {
    id: `message-${Date.now().toString(36)}-${index}`,
    name: `Message template ${index}`,
    content: '',
    containers: [{
      id: `container-${Date.now().toString(36)}`,
      accentColor: '#5865F2',
      text: '## New message\nAdd your message here.',
      thumbnailUrl: '',
      imageUrl: '',
    }],
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeContainer(value, index) {
  return {
    id: cleanId(value?.id, `container-${index + 1}`),
    accentColor: cleanColor(value?.accentColor),
    text: cleanText(value?.text, 'Add your message here.', 4000),
    thumbnailUrl: cleanUrl(value?.thumbnailUrl),
    imageUrl: cleanUrl(value?.imageUrl),
  };
}

function sanitizeTemplate(value, index = 0) {
  const source = value && typeof value === 'object' ? value : {};
  const hasContainerList = Array.isArray(source.containers);
  const containers = (hasContainerList ? source.containers : []).slice(0, 8).map(sanitizeContainer);
  return {
    id: cleanId(source.id, `message-${index + 1}`),
    name: cleanText(source.name, `Message template ${index + 1}`, 80),
    content: String(source.content || '').slice(0, 2000),
    containers: hasContainerList ? containers : defaultTemplate(index + 1).containers,
    updatedAt: new Date().toISOString(),
  };
}

function loadAll() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8') || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}
function saveAll(state) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  fs.writeFileSync(DATA_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}
function listTemplates(guildId) {
  return clone(loadAll()[guildId] || []);
}
function saveTemplate(guildId, value) {
  const state = loadAll();
  const list = state[guildId] || [];
  const template = sanitizeTemplate(value, list.length);
  const index = list.findIndex((item) => item.id === template.id);
  if (index === -1) list.push(template); else list[index] = template;
  state[guildId] = list.slice(0, 100);
  saveAll(state);
  return clone(template);
}
function deleteTemplate(guildId, templateId) {
  const state = loadAll();
  const list = state[guildId] || [];
  const next = list.filter((item) => item.id !== templateId);
  if (next.length === list.length) return false;
  state[guildId] = next;
  saveAll(state);
  return true;
}
function findTemplate(guildId, templateId) {
  return listTemplates(guildId).find((item) => item.id === templateId) || null;
}

function textComponents(text, thumbnailUrl) {
  const sections = String(text || '').split(/<separator>/gi).map((part) => part.trim()).filter(Boolean);
  const result = [];
  sections.forEach((section, index) => {
    if (index) result.push({ type: 14, divider: true, spacing: 1 });
    if (index === 0 && thumbnailUrl) {
      result.push({ type: 9, components: [{ type: 10, content: section }], accessory: { type: 11, media: { url: thumbnailUrl } } });
    } else result.push({ type: 10, content: section });
  });
  return result;
}

function buildMessagePayload(value) {
  const template = sanitizeTemplate(value);
  const components = [];
  if (template.content.trim()) components.push({ type: 10, content: template.content.trim() });
  template.containers.forEach((container) => {
    const children = textComponents(container.text, container.thumbnailUrl);
    if (container.imageUrl) children.push({ type: 12, items: [{ media: { url: container.imageUrl } }] });
    components.push({ type: 17, accent_color: Number.parseInt(container.accentColor.slice(1), 16), components: children });
  });
  return { flags: COMPONENTS_V2_FLAG, allowedMentions: { parse: [] }, components };
}

function parseDiscordMessageLink(value, guildId) {
  const match = String(value || '').trim().match(/^https:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d{16,20}|@me)\/(\d{16,20})\/(\d{16,20})/i);
  if (!match || match[1] !== String(guildId)) return null;
  return { channelId: match[2], messageId: match[3] };
}

module.exports = {
  buildMessagePayload,
  defaultTemplate,
  deleteTemplate,
  findTemplate,
  listTemplates,
  parseDiscordMessageLink,
  saveTemplate,
  sanitizeTemplate,
};
