const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { FISH, FISH_BY_NAME, normalizeId, normalizeName } = require('./Data/FishData');
const { ALL_MUTATIONS, COLUMN_MAP, SEASONS, TIMES, WEATHER_CHANCES, WEATHER_EMOJIS } = require('./Data/WeatherData');
const { FISH_EVENTS } = require('./Data/FishingRuntimeData');

const FLAGS = MessageFlags.IsComponentsV2 ?? 32768;
const EPH = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xffffff;
const STORE = path.join(__dirname, '..', 'data', 'fishing-game.json');
const FISH_IMAGE_DIR = path.join(__dirname, 'Fish Png');
const CALM_LAKE_XLSX = path.join(__dirname, 'Calm Fishing Lake.xlsx');
const FISH_PER_PAGE = 6;
const MUTATION_PER_PAGE = 9;

const RARITY_EMOJI = {
  common: '<:SBCommon:1506965202585780274>',
  uncommon: '<:SBUncommon:1506965215743447040>',
  rare: '<:SBRare:1506965211607994461>',
  epic: '<:SBEpic:1506965204624474153>',
  legendary: '<:SBLegendary:1506965206197207131>',
  mythical: '<:SBMythical:1506965209271762954>',
  secret: '<:SBSecret:1506965213881307186>',
};
const RARITY_CARD = {
  common: { fill: '#292936', stroke: '#5a5a70' },
  uncommon: { fill: '#27382f', stroke: '#8ee7a2' },
  rare: { fill: '#243545', stroke: '#88d9ff' },
  epic: { fill: '#3a2838', stroke: '#ffb3de' },
  legendary: { fill: '#3b361d', stroke: '#f8df72' },
  mythical: { fill: '#3d2428', stroke: '#ff7c7c' },
  secret: { fill: '#241014', stroke: '#8b1f2f', gradient: ['#401018', '#17070b'] },
};

const CATEGORIES = [{ label: 'All', value: 'all' }, { label: 'Calm Fishing Lake', value: 'calm_fishing_lake' }];

function empty() { return { users: {}, weather: {}, forecasts: {}, events: { active: {} } }; }
function load() { const dir = path.dirname(STORE); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, JSON.stringify(empty(), null, 2)); try { return { ...empty(), ...JSON.parse(fs.readFileSync(STORE, 'utf8')) }; } catch { return empty(); } }
function user(state, id) { if (!state.users[id]) state.users[id] = { fishCoins: 0, inventory: {}, fishBarrel: [], fishCapacity: 10, fishIndex: {}, mutationIndex: {} }; const record = state.users[id]; record.fishBarrel = Array.isArray(record.fishBarrel) ? record.fishBarrel : []; record.fishIndex = record.fishIndex && typeof record.fishIndex === 'object' ? record.fishIndex : {}; record.mutationIndex = record.mutationIndex && typeof record.mutationIndex === 'object' ? record.mutationIndex : {}; return record; }
function discovered(record) { const seen = new Set(Object.keys(record.fishIndex || {})); for (const entry of record.fishBarrel || []) if (entry?.fishId) seen.add(entry.fishId); return seen; }
function mutationDiscovered(record) { const seen = new Set(Object.keys(record.mutationIndex || {})); for (const entry of record.fishBarrel || []) if (entry?.mutation && String(entry.mutation).toLowerCase() !== 'none') seen.add(normalizeId(entry.mutation)); return seen; }
function page(items, current, perPage) { const maxPage = Math.max(1, Math.ceil(items.length / perPage)); const safe = Math.max(1, Math.min(maxPage, Math.floor(Number(current) || 1))); return { page: safe, maxPage, items: items.slice((safe - 1) * perPage, safe * perPage) }; }
function sep() { return { type: 14, divider: true, spacing: 1 }; }
function row(components) { return { type: 1, components }; }
function cont(components, files = []) { return { flags: FLAGS, files, components: [{ type: 17, accent_color: WHITE, components: components.filter(Boolean) }] }; }
function actions(id, pageNo, category, index) { return row([{ type: 3, custom_id: `fishindex:action:${id}:${pageNo}:${category}:${index}`, placeholder: 'Select an action', min_values: 1, max_values: 1, options: [{ label: 'Switch Page', value: 'page' }, { label: 'Switch Category', value: 'category' }] }]); }
function indexSelect(id, pageNo, category, index) { return row([{ type: 3, custom_id: `fishindex:index:${id}:${pageNo}:${category}:${index}`, placeholder: 'Switch index', min_values: 1, max_values: 1, options: [{ label: 'Fish', value: 'fish', default: index === 'fish' }, { label: 'Mutations', value: 'mutations', default: index === 'mutations' }] }]); }
function textInput(id, label, placeholder) { return { type: 1, components: [{ type: 4, custom_id: id, label, style: 1, required: true, placeholder, max_length: 100 }] }; }
function pageModal(id, pageNo, maxPage, category, index) { return { custom_id: `fishindex:pagesubmit:${id}:${category}:${index}`, title: 'Switch page', components: [textInput('fish_index_page', 'Which page?', `1 - ${maxPage}: Current page ${pageNo}`)] }; }
function categoryModal(id, pageNo, category, index) { return { custom_id: `fishindex:categorysubmit:${id}:${pageNo}:${index}`, title: 'Switch category', components: [{ type: 18, label: 'Select a category', component: { type: 3, custom_id: 'fish_index_category', placeholder: 'Select a category', min_values: 1, max_values: 1, options: CATEGORIES.map((option) => ({ ...option, default: option.value === category })) } }] }; }
function val(interaction, customId) { try { return interaction.fields?.getTextInputValue?.(customId) || ''; } catch {} const stack = [...(interaction.components ?? interaction.data?.components ?? [])]; while (stack.length) { const item = stack.shift(); const component = item?.component ?? item; if (component?.customId === customId || component?.custom_id === customId) { const value = component.values ?? component.value; return Array.isArray(value) ? value[0] : (value || ''); } if (Array.isArray(item?.components)) stack.push(...item.components); if (Array.isArray(component?.components)) stack.push(...component.components); } return ''; }
function owner(interaction, id) { if (interaction.user.id === id) return true; interaction.reply({ content: 'Only the command owner can use this control.', flags: EPH }).catch(() => null); return false; }
async function update(interaction, payload) { if (typeof interaction.update === 'function') return interaction.update(payload); if (typeof interaction.deferUpdate === 'function') { await interaction.deferUpdate(); return interaction.message?.edit(payload); } return interaction.reply(payload); }
function emojiUrl(emoji) { const match = String(emoji || '').match(/<a?:([A-Za-z0-9_]+):(\d+)>/); return match ? `https://cdn.discordapp.com/emojis/${match[2]}.${String(emoji).startsWith('<a:') ? 'gif' : 'png'}?quality=lossless` : null; }
async function drawEmoji(ctx, emoji, x, y, size) { try { const url = emojiUrl(emoji); if (!url) return false; const image = await loadImage(url); ctx.drawImage(image, x, y, size, size); return true; } catch { return false; } }
function roundRect(ctx, x, y, width, height, radius) { ctx.beginPath(); ctx.roundRect(x, y, width, height, radius); }
function fit(ctx, text, width, size, weight = '800') { for (let current = size; current >= 12; current -= 1) { ctx.font = `${weight} ${current}px sans-serif`; if (ctx.measureText(text).width <= width) return current; } return 12; }
function fishImagePath(name) { if (!fs.existsSync(FISH_IMAGE_DIR)) return null; const wanted = normalizeId(name).replace(/_/g, ''); for (const file of fs.readdirSync(FISH_IMAGE_DIR)) if (path.extname(file).toLowerCase() === '.png' && normalizeId(path.basename(file, '.png')).replace(/_/g, '') === wanted) return path.join(FISH_IMAGE_DIR, file); return null; }

function unzipXlsx(buffer) { const files = new Map(); let offset = 0; while (offset < buffer.length - 30) { if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; } const method = buffer.readUInt16LE(offset + 8); const compressedSize = buffer.readUInt32LE(offset + 18); const nameLength = buffer.readUInt16LE(offset + 26); const extraLength = buffer.readUInt16LE(offset + 28); const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8'); const dataStart = offset + 30 + nameLength + extraLength; const compressed = buffer.slice(dataStart, dataStart + compressedSize); if (method === 0) files.set(name, compressed.toString('utf8')); else if (method === 8) files.set(name, zlib.inflateRawSync(compressed).toString('utf8')); offset = dataStart + compressedSize; } return files; }
function decodeXml(value) { return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function parseSharedStrings(xml) { const strings = []; for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) strings.push([...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join('')); return strings; }
function parseSheetCells(xml, sharedStrings) { const cells = new Map(); for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) { const attrs = match[1]; const body = match[2]; const ref = /r="([^"]+)"/.exec(attrs)?.[1]; if (!ref) continue; const type = /t="([^"]+)"/.exec(attrs)?.[1]; const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''; const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1]; let value = raw; if (type === 's') value = sharedStrings[Number(raw)] ?? ''; else if (type === 'inlineStr') value = decodeXml(inline || ''); cells.set(ref, decodeXml(value)); } return cells; }
function readXlsxCells(filePath) { const files = unzipXlsx(fs.readFileSync(filePath)); const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml') || ''); const sheetName = files.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : [...files.keys()].find((name) => name.startsWith('xl/worksheets/sheet')); return parseSheetCells(files.get(sheetName) || '', sharedStrings); }
const RARITY_WEATHER_BONUS = {
  common: { Sunny: 1.55, Rain: 1.25, Windy: 1.1 },
  uncommon: { Rain: 1.5, Sunny: 1.2, Fog: 1.15, Windy: 1.1 },
  rare: { Fog: 1.45, Rain: 1.35, Windy: 1.25, Storm: 1.15 },
  epic: { Storm: 1.55, Thunderstorm: 1.35, Fog: 1.25 },
  legendary: { Thunderstorm: 1.65, 'Full Moon Night': 1.45, Bloodmoon: 1.3, Storm: 1.2 },
  mythical: { Bloodmoon: 1.75, Thunderstorm: 1.55, 'Full Moon Night': 1.35 },
  secret: { Bloodmoon: 2, Thunderstorm: 1.65, 'Full Moon Night': 1.45 },
};

function pairKey(weather, season) { return `${weather}|${season}`; }
function stableHash(value) { let hash = 0; for (const char of String(value || '')) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0; return hash; }
function fallbackAvailability() {
  const result = new Map();
  for (const fish of FISH) {
    const info = { seasons: new Map(SEASONS.map((season) => [season.key, new Set(Object.keys(TIMES))])), weatherWeights: new Map(), weatherSeasonWeights: new Map() };
    const bonuses = RARITY_WEATHER_BONUS[fish.rarity] || RARITY_WEATHER_BONUS.common;
    for (const [season, times] of Object.entries(WEATHER_CHANCES)) for (const weatherList of Object.values(times)) for (const [weather, chance] of weatherList) {
      const bias = 1 + ((stableHash(`${fish.id}:${season}:${weather}`) % 21) / 100);
      const score = Number(chance) * (bonuses[weather] || 0.65) * bias;
      info.weatherWeights.set(weather, (info.weatherWeights.get(weather) || 0) + score);
      const key = pairKey(weather, season);
      info.weatherSeasonWeights.set(key, (info.weatherSeasonWeights.get(key) || 0) + score);
    }
    result.set(fish.id, info);
  }
  return result;
}
function loadFishAvailability() {
  const fallback = fallbackAvailability();
  if (!fs.existsSync(CALM_LAKE_XLSX)) return fallback;
  try {
    const cells = readXlsxCells(CALM_LAKE_XLSX);
    const result = new Map(FISH.map((fish) => [fish.id, { seasons: new Map(), weatherWeights: new Map(), weatherSeasonWeights: new Map() }]));
    for (const [season, times] of Object.entries(COLUMN_MAP)) for (const [time, weathers] of Object.entries(times)) for (const [weather, column] of Object.entries(weathers)) {
      for (let rowNo = 4; rowNo <= 16; rowNo += 1) {
        const fish = FISH_BY_NAME.get(normalizeName(cells.get(`A${rowNo}`)));
        const weight = Number(cells.get(`${column}${rowNo}`));
        if (!fish || !(weight > 0)) continue;
        const info = result.get(fish.id);
        if (!info.seasons.has(season)) info.seasons.set(season, new Set());
        info.seasons.get(season).add(time);
        info.weatherWeights.set(weather, (info.weatherWeights.get(weather) || 0) + weight);
        const key = pairKey(weather, season);
        info.weatherSeasonWeights.set(key, (info.weatherSeasonWeights.get(key) || 0) + weight);
      }
    }
    for (const [fishId, info] of result.entries()) if (!info.weatherSeasonWeights.size) result.set(fishId, fallback.get(fishId));
    return result;
  } catch {
    return fallback;
  }
}
const availability = loadFishAvailability();
function seasonText(fish) { const info = availability.get(fish.id); if (!info || !info.seasons.size) return 'All'; const allTimes = Object.keys(TIMES).length; return [...info.seasons.entries()].map(([season, times]) => { const seasonEmoji = SEASONS.find((item) => item.key === season)?.emoji || season; const timeText = times.size >= allTimes ? '' : ` - ${[...times].map((time) => TIMES[time] || time).join(' ')}`; return `${seasonEmoji}${timeText}`; }).join('  '); }
function favoriteWeatherText(fish) { const info = availability.get(fish.id); if (!info || !info.weatherWeights.size) return 'All'; const max = Math.max(...info.weatherWeights.values()); return [...info.weatherWeights.entries()].filter(([, weight]) => weight === max).map(([weather]) => WEATHER_EMOJIS[weather] || weather).join(' '); }
function seasonEmojis(fish) { const info = availability.get(fish.id); if (!info || !info.seasons.size) return []; return [...info.seasons.keys()].map((season) => SEASONS.find((item) => item.key === season)?.emoji).filter(Boolean); }
function favoriteWeatherEmojis(fish) { const info = availability.get(fish.id); if (!info || !info.weatherWeights.size) return []; return [...info.weatherWeights.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([weather]) => WEATHER_EMOJIS[weather]).filter(Boolean); }
function favoriteWeatherPairs(fish) { const info = availability.get(fish.id); if (!info || !info.weatherSeasonWeights?.size) return []; return SEASONS.map((seasonInfo) => { const best = [...info.weatherSeasonWeights.entries()].filter(([key, weight]) => key.endsWith(`|${seasonInfo.key}`) && Number(weight) > 0).sort((a, b) => b[1] - a[1])[0]; if (!best) return null; const [weather] = best[0].split('|'); return { weatherEmoji: WEATHER_EMOJIS[weather], seasonEmoji: seasonInfo.emoji }; }).filter((pair) => pair?.weatherEmoji && pair.seasonEmoji); }
async function drawEmojiList(ctx, emojis, x, y, size, gap = 6) { for (let index = 0; index < emojis.length; index += 1) await drawEmoji(ctx, emojis[index], x + index * (size + gap), y, size); }
async function drawWeatherPairs(ctx, pairs, x, y, size) { const columnGap = 20; const pairWidth = size * 2 + 17; const rowGap = 5; ctx.font = `700 ${Math.max(14, Math.floor(size * 0.72))}px sans-serif`; ctx.fillStyle = '#d7d8e7'; for (let index = 0; index < pairs.length; index += 1) { const pair = pairs[index]; const column = index % 2; const row = Math.floor(index / 2); const rowY = y + row * (size + rowGap); let cursor = x + column * (pairWidth + columnGap); await drawEmoji(ctx, pair.weatherEmoji, cursor, rowY, size); cursor += size + 4; ctx.fillText('[', cursor, rowY + size - 5); cursor += 8; await drawEmoji(ctx, pair.seasonEmoji, cursor, rowY, size); cursor += size + 1; ctx.fillText(']', cursor, rowY + size - 5); } }
function fillCard(ctx, fish, ok, x, y, width, height, radius) { const color = RARITY_CARD[fish.rarity] || RARITY_CARD.common; if (ok && color.gradient) { const gradient = ctx.createLinearGradient(x, y, x + width, y + height); gradient.addColorStop(0, color.gradient[0]); gradient.addColorStop(1, color.gradient[1]); ctx.fillStyle = gradient; } else ctx.fillStyle = ok ? color.fill : '#22222c'; roundRect(ctx, x, y, width, height, radius); ctx.fill(); ctx.strokeStyle = ok ? color.stroke : '#444454'; ctx.lineWidth = 3; ctx.stroke(); }

async function fishGallery(items, seen) {
  const canvas = createCanvas(900, 840);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#181820';
  ctx.fillRect(0, 0, 900, 840);
  const gap = 22;
  const cardWidth = (900 - gap * 3) / 2;
  const cardHeight = (840 - gap * 4) / 3;
  for (let index = 0; index < items.length; index += 1) {
    const fish = items[index];
    const ok = seen.has(fish.id);
    const x = gap + (index % 2) * (cardWidth + gap);
    const y = gap + Math.floor(index / 2) * (cardHeight + gap);
    fillCard(ctx, fish, ok, x, y, cardWidth, cardHeight, 16);
    const title = ok ? fish.displayName : 'Undiscovered';
    ctx.font = `800 ${fit(ctx, title, cardWidth - 80, 27)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = ok ? '#f6f6ff' : '#8c8c9a';
    ctx.fillText(title, x + cardWidth / 2, y + 40);
    if (ok) {
      try { const img = fishImagePath(fish.name); if (img) ctx.drawImage(await loadImage(img), x + 20, y + 68, 122, 122); else await drawEmoji(ctx, fish.emoji, x + 36, y + 86, 84); } catch { await drawEmoji(ctx, fish.emoji, x + 36, y + 86, 84); }
    } else {
      ctx.font = '900 78px sans-serif';
      ctx.fillStyle = '#5f6070';
      ctx.fillText('?', x + 78, y + 145);
    }
    await drawEmoji(ctx, RARITY_EMOJI[fish.rarity], x + cardWidth - 54, y + 18, 30);
    ctx.textAlign = 'left';
    ctx.font = '700 18px sans-serif';
    ctx.fillStyle = ok ? '#d7d8e7' : '#737482';
    ctx.fillText(ok ? 'Discovered' : 'Not discovered', x + 150, y + 82);
    ctx.font = '700 16px sans-serif';
    ctx.fillText('Season:', x + 150, y + 115);
    if (ok) await drawEmojiList(ctx, seasonEmojis(fish), x + 224, y + 90, 32); else ctx.fillText('???', x + 224, y + 115);
    ctx.fillText('Fav Weather:', x + 150, y + 148);
    if (ok) await drawWeatherPairs(ctx, favoriteWeatherPairs(fish), x + 172, y + 158, 24); else ctx.fillText('???', x + 260, y + 148);
  }
  return canvas.toBuffer('image/png');
}

async function mutationGallery(items, seen) {
  const canvas = createCanvas(900, 660);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#181820';
  ctx.fillRect(0, 0, 900, 660);
  const gap = 18;
  const cardWidth = (900 - gap * 4) / 3;
  const cardHeight = (660 - gap * 4) / 3;
  for (let index = 0; index < items.length; index += 1) {
    const mutation = items[index];
    const ok = seen.has(mutation.id);
    const x = gap + (index % 3) * (cardWidth + gap);
    const y = gap + Math.floor(index / 3) * (cardHeight + gap);
    ctx.fillStyle = ok ? '#292936' : '#22222c';
    roundRect(ctx, x, y, cardWidth, cardHeight, 14);
    ctx.fill();
    ctx.strokeStyle = ok ? '#5a5a70' : '#444454';
    ctx.lineWidth = 3;
    ctx.stroke();
    if (ok) await drawEmoji(ctx, mutation.emoji || FISH_EVENTS.attack_of_fish.emoji, x + 22, y + 22, 44);
    else {
      ctx.font = '48px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#5f6070';
      ctx.fillText('?', x + 44, y + 62);
    }
    const title = ok ? mutation.name : 'Undiscovered';
    ctx.font = `800 ${fit(ctx, title, cardWidth - 92, 22)}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillStyle = ok ? '#f6f6ff' : '#8c8c9a';
    ctx.fillText(title, x + 82, y + 42);
    const boost = ok ? `x${Number(mutation.weightMultiplier || mutation.multiplier || 1).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${mutation.multiplierType || 'value'}` : '???';
    ctx.font = '700 17px sans-serif';
    ctx.fillStyle = ok ? '#d7d8e7' : '#737482';
    ctx.fillText(`Multi Boost: ${boost}`, x + 22, y + 118);
    ctx.fillText('Weather:', x + 22, y + 154);
    if (ok) {
      const weatherEmoji = WEATHER_EMOJIS[mutation.weather] || FISH_EVENTS.attack_of_fish.emoji;
      if (!await drawEmoji(ctx, weatherEmoji, x + 102, y + 133, 28)) ctx.fillText(mutation.weather, x + 102, y + 154);
    } else ctx.fillText('???', x + 102, y + 154);
  }
  return canvas.toBuffer('image/png');
}

async function render(id, name, requestedPage = 1, category = 'all', index = 'fish') {
  index = index === 'mutations' ? 'mutations' : 'fish';
  const state = load();
  const record = user(state, id);
  if (index === 'mutations') {
    const seen = mutationDiscovered(record);
    const paged = page(ALL_MUTATIONS, requestedPage, MUTATION_PER_PAGE);
    const buffer = await mutationGallery(paged.items, seen);
    const attachment = new AttachmentBuilder(buffer, { name: 'mutation-index.png' });
    return cont([{ type: 10, content: `## ${name}'s Mutation Index\n-# Mutations discovered: ${ALL_MUTATIONS.filter((mutation) => seen.has(mutation.id)).length} / ${ALL_MUTATIONS.length}` }, sep(), { type: 12, items: [{ media: { url: 'attachment://mutation-index.png' } }] }, sep(), actions(id, paged.page, category, index), indexSelect(id, paged.page, category, index)], [attachment]);
  }
  const fish = category === 'calm_fishing_lake' ? FISH : FISH;
  const seen = discovered(record);
  const paged = page(fish, requestedPage, FISH_PER_PAGE);
  const buffer = await fishGallery(paged.items, seen);
  const attachment = new AttachmentBuilder(buffer, { name: 'fish-index.png' });
  return cont([{ type: 10, content: `## ${name}'s Fish Index\n-# Fish discovered: ${fish.filter((entry) => seen.has(entry.id)).length} / ${fish.length}\n-# Category: ${CATEGORIES.find((item) => item.value === category)?.label || 'All'}` }, sep(), { type: 12, items: [{ media: { url: 'attachment://fish-index.png' } }] }, sep(), actions(id, paged.page, category, index), indexSelect(id, paged.page, category, index)], [attachment]);
}

async function handle(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('fishindex:')) return false;
  const parts = id.split(':');
  const action = parts[1];
  const userId = parts[2];
  if (!owner(interaction, userId)) return true;
  if (action === 'index' && interaction.isStringSelectMenu?.()) return update(interaction, await render(userId, interaction.user.username, 1, parts[4] || 'all', interaction.values?.[0] || 'fish'));
  if (action === 'action' && interaction.isStringSelectMenu?.()) {
    const pageNo = Number(parts[3]) || 1;
    const category = parts[4] || 'all';
    const index = parts[5] || 'fish';
    const maxPage = index === 'mutations' ? page(ALL_MUTATIONS, pageNo, MUTATION_PER_PAGE).maxPage : page(FISH, pageNo, FISH_PER_PAGE).maxPage;
    if (interaction.values?.[0] === 'page') await interaction.showModal(pageModal(userId, pageNo, maxPage, category, index));
    else await interaction.showModal(categoryModal(userId, pageNo, category, index));
    return true;
  }
  if (action === 'pagesubmit' && interaction.isModalSubmit?.()) return update(interaction, await render(userId, interaction.user.username, Number(val(interaction, 'fish_index_page')) || 1, parts[3] || 'all', parts[4] || 'fish'));
  if (action === 'categorysubmit' && interaction.isModalSubmit?.()) { const selected = val(interaction, 'fish_index_category') || 'all'; return update(interaction, await render(userId, interaction.user.username, 1, CATEGORIES.some((item) => item.value === selected) ? selected : 'all', parts[4] || 'fish')); }
  return false;
}

const fishIndexCommand = {
  data: new SlashCommandBuilder().setName('fish-index').setDescription('Show your discovered fish and mutation index'),
  suppressCommandLog: true,
  disableActionTimeout: true,
  async execute(interaction) { await interaction.reply(await render(interaction.user.id, interaction.user.username)); },
  async handleInteraction(interaction) { return handle(interaction); },
};

module.exports = { fishIndexCommand };
