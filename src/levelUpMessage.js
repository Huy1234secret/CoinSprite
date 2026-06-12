const COMPONENTS_V2_FLAG = 32768;
const DEFAULT_LEVEL_UP_MESSAGE = Object.freeze({
  enabled: true,
  content: [
    '## Level up!',
    '<@mention> reached **Level <level>** in **<server>**.',
    '<separator>',
    '<if<level>==5,"Bro discovered the chat button.","">',
    '<if<level>==10,"Double digits? Okay, yapper training complete.","">',
    '<if<level>==15,"Slowly becoming a professional keyboard warrior.","">',
    '<if<level>==20,"Hydrate before the next yap session.","">',
    '<if<level>==30,"Chat activity detected. Grass not detected.","">',
    '<if<level>==40,"At this point, the keyboard fears you.","">',
    '<if<level>==50,"Halfway to please go outside.","">',
    '<if<level>==60,"The yap grind is getting concerning.","">',
    '<if<level>==70,"Bro is not chatting anymore, bro is farming XP.","">',
    '<if<level>==80,"Scientists are studying this level of activity.","">',
    '<if<level>==90,"So close to Level 100, your keyboard is crying.","">',
    '<if<level>==100,"Someone give them grass... or a trophy.","">',
  ].join('\n'),
  accentColor: '#57F287',
  thumbnailUrl: '<avatar_url>',
  imageUrl: '',
});

const PLACEHOLDER_ALIASES = {
  currentlevel: 'level',
  current_level: 'level',
  currenlevel: 'level',
  displayname: 'display_name',
  previouslevel: 'previous_level',
  userid: 'user_id',
};

function boundedString(value, fallback, maxLength) {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, maxLength) : fallback;
}

function optionalString(value, fallback, maxLength) {
  return value === undefined ? String(fallback || '').slice(0, maxLength) : String(value ?? '').trim().slice(0, maxLength);
}

function sanitizeAccentColor(value, fallback = DEFAULT_LEVEL_UP_MESSAGE.accentColor) {
  const clean = String(value ?? '').trim();
  return /^#[0-9a-f]{6}$/i.test(clean) ? clean.toUpperCase() : fallback;
}

function sanitizeLevelUpMessage(value, fallback = DEFAULT_LEVEL_UP_MESSAGE) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const base = fallback && typeof fallback === 'object' ? fallback : DEFAULT_LEVEL_UP_MESSAGE;
  return {
    enabled: 'enabled' in source ? Boolean(source.enabled) : Boolean(base.enabled),
    content: boundedString(source.content, base.content || DEFAULT_LEVEL_UP_MESSAGE.content, 4000),
    accentColor: sanitizeAccentColor(source.accentColor, sanitizeAccentColor(base.accentColor)),
    thumbnailUrl: optionalString(source.thumbnailUrl, base.thumbnailUrl, 1000),
    imageUrl: optionalString(source.imageUrl, base.imageUrl, 1000),
  };
}

function normalizeVariableName(value) {
  const clean = String(value || '').trim().toLowerCase();
  return PLACEHOLDER_ALIASES[clean] || clean;
}

function unquote(value) {
  const source = String(value || '').trim();
  if (source.length < 2) return null;
  const quote = source[0];
  if ((quote !== '"' && quote !== "'") || source.at(-1) !== quote) return null;
  if (quote === '"') {
    try {
      return JSON.parse(source);
    } catch {
      return null;
    }
  }
  return source.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}

function splitConditionalArguments(source) {
  const parts = [];
  let start = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',') {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function findConditionalEnd(source, startIndex) {
  let quote = null;
  let escaped = false;
  let commaCount = 0;
  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && quote) {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ',') {
      commaCount += 1;
      continue;
    }
    if (char === '>' && commaCount >= 2) return index;
  }
  return -1;
}

function parseComparisonValue(value, context) {
  const quoted = unquote(value);
  if (quoted !== null) return quoted;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  const variable = normalizeVariableName(value.replace(/^<|>$/g, ''));
  return Object.prototype.hasOwnProperty.call(context, variable) ? context[variable] : value;
}

function compareValues(left, operator, right) {
  const numeric = Number.isFinite(Number(left)) && Number.isFinite(Number(right));
  const a = numeric ? Number(left) : String(left);
  const b = numeric ? Number(right) : String(right);
  if (operator === '==') return a === b;
  if (operator === '!=') return a !== b;
  if (operator === '>=') return a >= b;
  if (operator === '<=') return a <= b;
  if (operator === '>') return a > b;
  if (operator === '<') return a < b;
  return false;
}

function resolveConditionals(template, context) {
  let output = String(template ?? '');
  for (let pass = 0; pass < 100; pass += 1) {
    const start = output.indexOf('<if<');
    if (start === -1) break;
    const variableEnd = output.indexOf('>', start + 4);
    if (variableEnd === -1) {
      const lineEnd = output.indexOf('\n', start);
      output = `${output.slice(0, start)}${lineEnd === -1 ? '' : output.slice(lineEnd + 1)}`;
      continue;
    }
    const variableName = normalizeVariableName(output.slice(start + 4, variableEnd));
    const end = findConditionalEnd(output, variableEnd + 1);
    if (end === -1) {
      const lineEnd = output.indexOf('\n', start);
      output = `${output.slice(0, start)}${lineEnd === -1 ? '' : output.slice(lineEnd + 1)}`;
      continue;
    }

    const parts = splitConditionalArguments(output.slice(variableEnd + 1, end));
    const comparison = parts[0]?.match(/^\s*(==|!=|>=|<=|>|<)\s*(.+?)\s*$/);
    const whenTrue = parts[1] === '' ? '' : unquote(parts[1]);
    const whenFalse = parts[2] === '' ? '' : unquote(parts[2]);
    let replacement = '';
    if (parts.length === 3 && comparison && whenTrue !== null && whenFalse !== null) {
      const left = context[variableName] ?? '';
      const right = parseComparisonValue(comparison[2], context);
      replacement = compareValues(left, comparison[1], right) ? whenTrue : whenFalse;
    }
    output = `${output.slice(0, start)}${replacement}${output.slice(end + 1)}`;
  }
  return output;
}

function renderLevelUpTemplate(template, context) {
  const resolved = resolveConditionals(template, context);
  const replacements = {
    '@mention': context.mention,
    username: context.username,
    display_name: context.display_name,
    displayname: context.display_name,
    level: context.level,
    currentlevel: context.level,
    current_level: context.level,
    currenlevel: context.level,
    previous_level: context.previous_level,
    previouslevel: context.previous_level,
    server: context.server,
    channel: context.channel,
    channel_id: context.channel_id,
    user_id: context.user_id,
    userid: context.user_id,
    avatar_url: context.avatar_url,
  };
  return resolved.replace(/<(@mention|username|display_name|displayname|level|currentlevel|current_level|currenlevel|previous_level|previouslevel|server|channel|channel_id|user_id|userid|avatar_url)>/gi, (match, key) => {
    const value = replacements[key.toLowerCase()];
    return value === undefined || value === null ? '' : String(value);
  });
}

function mediaUrlFromTemplate(template, context) {
  const rendered = renderLevelUpTemplate(template, context).trim();
  if (!rendered) return null;
  try {
    const url = new URL(rendered);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function buildTextComponents(content, thumbnailUrl) {
  const rawSections = content.split(/<separator>/gi).map((section) => section.trim()).filter(Boolean);
  const sections = rawSections.length > 18
    ? [...rawSections.slice(0, 17), rawSections.slice(17).join('\n\n')]
    : rawSections;
  const components = [];
  sections.forEach((section, index) => {
    if (index > 0) components.push({ type: 14, divider: true, spacing: 1 });
    if (index === 0 && thumbnailUrl) {
      components.push({
        type: 9,
        components: [{ type: 10, content: section }],
        accessory: { type: 11, media: { url: thumbnailUrl } },
      });
    } else {
      components.push({ type: 10, content: section });
    }
  });
  return components;
}

function buildLevelUpPayload(configValue, context) {
  const config = sanitizeLevelUpMessage(configValue);
  if (!config.enabled) return null;
  const content = renderLevelUpTemplate(config.content, context).trim()
    || renderLevelUpTemplate(DEFAULT_LEVEL_UP_MESSAGE.content, context).trim();
  const components = buildTextComponents(content, mediaUrlFromTemplate(config.thumbnailUrl, context));
  const imageUrl = mediaUrlFromTemplate(config.imageUrl, context);
  if (imageUrl) components.push({ type: 12, items: [{ media: { url: imageUrl } }] });

  return {
    allowedMentions: { parse: [], users: [context.user_id] },
    flags: COMPONENTS_V2_FLAG,
    components: [{
      type: 17,
      accent_color: Number.parseInt(config.accentColor.slice(1), 16),
      components,
    }],
  };
}

module.exports = {
  DEFAULT_LEVEL_UP_MESSAGE,
  buildLevelUpPayload,
  renderLevelUpTemplate,
  sanitizeLevelUpMessage,
};
