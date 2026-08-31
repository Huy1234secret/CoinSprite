const { MessageFlags, PermissionFlagsBits } = require('discord.js');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;

function interpolateTemplate(template, values = {}) {
  return String(template || '').replace(/\{([a-z0-9_]+)\}/gi, (token, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : token
  ));
}

function templateVariables(...values) {
  const variables = new Set();
  for (const value of values.flat(Infinity)) {
    String(value || '').replace(/\{([a-z0-9_]+)\}/gi, (_token, key) => {
      variables.add(String(key).toLowerCase());
      return _token;
    });
  }
  return [...variables];
}

function safeMediaUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function accentColorValue(value, fallback = 0xb9f547) {
  const hex = String(value || '').replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex, 16) : fallback;
}

function resolvedLayout(layout = {}, values = {}) {
  const resolve = (url) => safeMediaUrl(interpolateTemplate(url, values));
  return {
    ...layout,
    thumbnailUrl: resolve(layout.thumbnailUrl),
    galleryUrls: [...new Set((layout.galleryUrls || []).map(resolve).filter(Boolean))].slice(0, 10),
  };
}

function messageContentComponents(content, layout = {}, _label = 'Message', options = {}) {
  const rawParts = String(content || '').split(/\{separator\}/gi);
  const parts = rawParts.length > 5
    ? [...rawParts.slice(0, 4), rawParts.slice(4).join('\n')]
    : rawParts;
  const thumbnailUrl = layout.thumbnailEnabled ? safeMediaUrl(layout.thumbnailUrl) : '';
  const components = [];
  let thumbnailPlaced = false;

  for (let index = 0; index < parts.length; index += 1) {
    const text = parts[index].trim();
    if (index > 0 && components.length && components.at(-1)?.type !== 14) {
      components.push({ type: 14, divider: true, spacing: 1 });
    }
    if (!text) continue;
    if (thumbnailUrl && !thumbnailPlaced) {
      components.push({
        type: 9,
        components: [{ type: 10, content: text }],
        accessory: { type: 11, media: { url: thumbnailUrl } },
      });
      thumbnailPlaced = true;
    } else components.push({ type: 10, content: text });
  }

  if (!components.length) components.push({ type: 10, content: options.fallbackText || '-# Message' });
  if (thumbnailUrl && !thumbnailPlaced) {
    const first = components.shift();
    components.unshift({
      type: 9,
      components: [first?.type === 10 ? first : { type: 10, content: options.fallbackText || '-# Message' }],
      accessory: { type: 11, media: { url: thumbnailUrl } },
    });
  }

  const galleryUrls = [...new Set((layout.galleryUrls || []).map(safeMediaUrl).filter(Boolean))].slice(0, 10);
  if (galleryUrls.length) {
    components.push({
      type: 12,
      items: galleryUrls.map((url) => ({ media: { url } })),
    });
  }
  return components;
}

function componentMessagePayload(content, layout = {}, options = {}) {
  const inner = messageContentComponents(content, layout, options.label, { fallbackText: options.fallbackText });
  const allowedUsers = [...new Set((options.allowedUsers || []).map(String).filter((id) => /^\d{16,20}$/.test(id)))];
  const components = layout.container === false ? inner : [{
    type: 17,
    accent_color: accentColorValue(layout.accentColor, options.fallbackColor),
    components: inner,
  }];
  for (const [index, container] of (options.additionalContainers || []).slice(0, 2).entries()) {
    const containerLayout = container?.layout || {};
    components.push({
      type: 17,
      accent_color: accentColorValue(containerLayout.accentColor, options.fallbackColor),
      components: messageContentComponents(container?.content, containerLayout, `${options.label || 'Message'} container ${index + 2}`, {
        fallbackText: options.fallbackText,
      }),
    });
  }
  return {
    flags: COMPONENTS_V2_FLAG,
    allowedMentions: { parse: [], users: allowedUsers, roles: [] },
    components,
  };
}

async function deliveryPermissions(channel, guild, needsEmbedLinks = false) {
  if (!channel?.isTextBased?.() || typeof channel.send !== 'function') {
    return { ok: false, missing: ['message-capable channel'] };
  }
  const botMember = guild?.members?.me || await guild?.members?.fetchMe?.().catch(() => null);
  let permissions = null;
  try { permissions = channel.permissionsFor?.(botMember); } catch {}
  const required = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['SendMessages', PermissionFlagsBits.SendMessages],
  ];
  if (channel.isThread?.()) required.push(['SendMessagesInThreads', PermissionFlagsBits.SendMessagesInThreads]);
  if (needsEmbedLinks) required.push(['EmbedLinks', PermissionFlagsBits.EmbedLinks]);
  const missing = required.filter(([, flag]) => !permissions?.has?.(flag)).map(([name]) => name);
  return { ok: missing.length === 0, missing };
}

module.exports = {
  COMPONENTS_V2_FLAG,
  accentColorValue,
  componentMessagePayload,
  deliveryPermissions,
  interpolateTemplate,
  messageContentComponents,
  resolvedLayout,
  safeMediaUrl,
  templateVariables,
};
