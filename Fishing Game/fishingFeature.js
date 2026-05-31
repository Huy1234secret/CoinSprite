const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { FISH, FISH_BY_ID, FISH_BY_NAME, RARITY_BUTTONS, RARITY_WEIGHTS, VARIANTS, VARIANT_MULTIPLIER, normalizeName } = require('./Data/FishData');
const { ITEMS } = require('./Data/Item Data');
const weatherData = require('./Data/WeatherData');
const { ADMIN_WEATHER, FISH_EVENTS, GIANT_MUTATION } = require('./Data/FishingRuntimeData');

const COMPONENTS_V2_FLAG = MessageFlags.IsComponentsV2 ?? 32768;
const EPHEMERAL_FLAG = MessageFlags.Ephemeral ?? 64;
const WHITE = 0xffffff;
const GREEN = 0x57f287;
const RED = 0xed4245;
const YELLOW = 0xffd84d;
const BUTTON_SECONDARY = 2;
const BUTTON_DANGER = 4;
const LOCATION = 'Calm Fishing Lake';
const FISHING_CHANNEL_ID = '1506684299934437517';
const STORE_PATH = path.join(__dirname, '..', 'data', 'fishing-game.json');
const CALM_LAKE_XLSX = path.join(__dirname, 'Calm Fishing Lake.xlsx');
const LOCATION_PNG_DIR = path.join(__dirname, 'Location Png');
const FISH_COIN = '<:CRFishCoin:1506701069990891751>';
const SPIN_FISH = '<a:SBSpinFish:1506656617469317251>';
const BITE_TIMEOUT_MS = 30 * 1000;
const PROGRESS_START = '<:SBFPB1:1506679960616697948>';
const PROGRESS_MID_FILLED = '<:SBFPB2:1506679958658089072>';
const PROGRESS_MID_EMPTY = '<:SBFPB2E:1506679954405064774>';
const PROGRESS_END_FILLED = '<:SBFPB3:1506681043208376492>';
const PROGRESS_END_EMPTY = '<:SBFPB3E:1506679951682965658>';
const REEL_EMOJIS = ['\u{1f41f}', '\u{1f3a3}', '\u{1fa9d}', '\u{1fae7}', '\u{1f30a}', '\u{1f420}', '\u{1f421}', '\u{1f988}', '\u{1f991}', '\u{1f980}', '\u{1f41a}', '\u{1fa99}', '\u2b50', '\u{1f4a7}', '\u{1f340}'];
const RARITY_EMOJI = { common: '<:SBCommon:1506965202585780274>', uncommon: '<:SBUncommon:1506965215743447040>', rare: '<:SBRare:1506965211607994461>', very_rare: '<:SBRare:1506965211607994461>', epic: '<:SBEpic:1506965204624474153>', legendary: '<:SBLegendary:1506965206197207131>', mythical: '<:SBMythical:1506965209271762954>', secret: '<:SBSecret:1506965213881307186>' };

const activeGames = new Map();
const activeGameByUser = new Map();
const pendingFishingUsers = new Set();
let weatherTimerStarted = false;

function randomInt(min, max) { return Math.floor(Math.random() * ((max - min) + 1)) + min; }
function randomFloat(min, max) { return min + (Math.random() * (max - min)); }
function weightedPick(entries) { const valid = entries.filter((entry) => Number(entry.weight) > 0); const total = valid.reduce((sum, entry) => sum + Number(entry.weight), 0); if (total <= 0) return valid[0]?.value ?? null; let roll = Math.random() * total; for (const entry of valid) { roll -= Number(entry.weight); if (roll <= 0) return entry.value; } return valid[valid.length - 1]?.value ?? null; }
function normalizeId(value) { return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
function emptyState() { return { users: {}, weather: {}, forecasts: {}, events: { active: {} } }; }
function ensureStoreFile() { const dir = path.dirname(STORE_PATH); if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); if (!fs.existsSync(STORE_PATH)) fs.writeFileSync(STORE_PATH, JSON.stringify(emptyState(), null, 2), 'utf8'); }
function loadState() { ensureStoreFile(); try { return { ...emptyState(), ...JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')) }; } catch { return emptyState(); } }
function saveState(state) { ensureStoreFile(); fs.writeFileSync(STORE_PATH, JSON.stringify({ ...emptyState(), ...state }, null, 2), 'utf8'); }
function getItemDefinition(itemId) { return ITEMS[itemId] || null; }
function getInventoryAmount(user, itemId) { return Math.max(0, Math.floor(Number(user.inventory?.[itemId]?.amount) || 0)); }
function normalizeRodDurabilities(user, itemId) { const item = getItemDefinition(itemId); const entry = user.inventory?.[itemId]; if (!item || item.type !== 'Gear/Tool' || !entry || typeof entry !== 'object') return; const amount = getInventoryAmount(user, itemId); if (item.durability === null) { entry.durability = null; delete entry.durabilities; return; } const fallback = Math.max(0, Math.floor(Number(entry.durability ?? item.durability) || item.durability)); entry.durabilities = Array.isArray(entry.durabilities) ? entry.durabilities.slice(0, amount) : [fallback]; entry.durabilities = entry.durabilities.map((durability) => Math.max(0, Math.floor(Number(durability) || item.durability))); while (entry.durabilities.length < amount) entry.durabilities.push(item.durability); entry.durability = entry.durabilities[0] ?? item.durability; }
function rememberItem(user, itemId, amount = 0) { if (!ITEMS[itemId]) return; user.itemIndex = user.itemIndex && typeof user.itemIndex === 'object' ? user.itemIndex : {}; const previous = user.itemIndex[itemId] && typeof user.itemIndex[itemId] === 'object' ? user.itemIndex[itemId] : {}; const gained = Math.max(0, Math.floor(Number(amount) || 0)); user.itemIndex[itemId] = { discoveredAt: previous.discoveredAt || Date.now(), count: Math.max(0, Math.floor(Number(previous.count) || 0)) + gained, lastObtainedAt: gained > 0 ? Date.now() : previous.lastObtainedAt }; }
function ensureUser(state, userId) { if (!state.users[userId]) state.users[userId] = { fishCoins: 0, inventory: {}, fishBarrel: [], equippedRodId: 'wooden_fishing_rod', equippedBaitId: null, location: LOCATION, fishCapacity: 10, fishIndex: {}, mutationIndex: {}, itemIndex: {} }; const user = state.users[userId]; user.inventory = user.inventory && typeof user.inventory === 'object' ? user.inventory : {}; user.fishBarrel = Array.isArray(user.fishBarrel) ? user.fishBarrel : []; user.fishCoins = Math.max(0, Math.floor(Number(user.fishCoins) || 0)); user.fishCapacity = Math.max(10, Math.floor(Number(user.fishCapacity) || 10)); user.fishIndex = user.fishIndex && typeof user.fishIndex === 'object' ? user.fishIndex : {}; user.mutationIndex = user.mutationIndex && typeof user.mutationIndex === 'object' ? user.mutationIndex : {}; user.itemIndex = user.itemIndex && typeof user.itemIndex === 'object' ? user.itemIndex : {}; if (!user.inventory.wooden_fishing_rod) user.inventory.wooden_fishing_rod = { amount: 1, durability: null }; for (const itemId of Object.keys(user.inventory)) { normalizeRodDurabilities(user, itemId); if (getInventoryAmount(user, itemId) > 0) rememberItem(user, itemId); } if (!user.equippedRodId || !getInventoryAmount(user, user.equippedRodId)) user.equippedRodId = 'wooden_fishing_rod'; if (user.equippedBaitId && (getItemDefinition(user.equippedBaitId)?.type !== 'Bait' || !getInventoryAmount(user, user.equippedBaitId))) user.equippedBaitId = null; return user; }
function getUser(userId) { const state = loadState(); const user = ensureUser(state, userId); saveState(state); return JSON.parse(JSON.stringify(user)); }
function updateUser(userId, updater) { const state = loadState(); const user = ensureUser(state, userId); const result = updater(user, state); saveState(state); return result ?? user; }
function cleanupEvents(state = loadState(), now = Date.now()) { state.events = state.events && typeof state.events === 'object' ? state.events : { active: {} }; state.events.active = state.events.active && typeof state.events.active === 'object' ? state.events.active : {}; for (const [eventId, active] of Object.entries(state.events.active)) if (!active || Number(active.endsAt) <= now || !FISH_EVENTS[eventId]) delete state.events.active[eventId]; return state.events.active; }
function activeEvents(state = loadState()) { return cleanupEvents(state); }
function hasEvent(state, eventId) { return Boolean(activeEvents(state)[eventId]); }
function weatherEmoji(name) { return ADMIN_WEATHER[name]?.emoji || weatherData.WEATHER_EMOJIS[name] || ''; }
function weatherEffects(name) { return { ...(weatherData.WEATHER_EFFECTS[name] || {}), ...(ADMIN_WEATHER[name] || {}) }; }
function cleanupAdminWeathers(weather, now = Date.now()) { const list = Array.isArray(weather?.adminWeathers) ? weather.adminWeathers : []; const migrated = weather?.manual && weather.weather && Number(weather.endsAt) > now ? [{ weather: weather.weather, weatherEmoji: weather.weatherEmoji || weatherEmoji(weather.weather), startedAt: weather.startedAt || now, endsAt: weather.endsAt }] : []; return [...list, ...migrated].filter((entry) => entry?.weather && Number(entry.endsAt) > now).map((entry) => ({ weather: entry.weather, weatherEmoji: entry.weatherEmoji || weatherEmoji(entry.weather), startedAt: Number(entry.startedAt) || now, endsAt: Number(entry.endsAt) })); }
function activeWeatherEntries(weather) { const adminWeathers = cleanupAdminWeathers(weather); if (adminWeathers.length) return adminWeathers; return [{ weather: weather?.weather || 'Sunny', weatherEmoji: weather?.weatherEmoji || weatherEmoji(weather?.weather || 'Sunny') }]; }
function activeWeatherNames(weatherOrNames) { if (Array.isArray(weatherOrNames)) return weatherOrNames.map(String).filter(Boolean); if (weatherOrNames && typeof weatherOrNames === 'object') return activeWeatherEntries(weatherOrNames).map((entry) => entry.weather); return [String(weatherOrNames || 'Sunny')].filter(Boolean); }
function combinedWeatherEffects(weatherOrNames) { const combined = {}; for (const name of activeWeatherNames(weatherOrNames)) { const effect = weatherEffects(name); if (effect.lureSeconds) combined.lureSeconds = (combined.lureSeconds || 0) + Number(effect.lureSeconds); if (effect.powerMultiplier) combined.powerMultiplier = (combined.powerMultiplier || 1) * Number(effect.powerMultiplier); if (effect.durMultiplier) combined.durMultiplier = (combined.durMultiplier || 1) * Number(effect.durMultiplier); if (effect.goldenBonus) combined.goldenBonus = Math.max(Number(combined.goldenBonus) || 0, Number(effect.goldenBonus)); if (effect.lightningBreakChance) combined.lightningBreakChance = Math.max(Number(combined.lightningBreakChance) || 0, Number(effect.lightningBreakChance)); if (effect.escapeChance) combined.escapeChance = Math.max(Number(combined.escapeChance) || 0, Number(effect.escapeChance)); } return combined; }
function seasonTime(now = new Date()) { const utc7 = now.getTime() + (7 * 60 * 60 * 1000); const day = Math.floor(utc7 / 86400000); const hour = Math.floor((utc7 % 86400000) / 3600000); const season = weatherData.SEASONS[Math.floor(day / 2) % weatherData.SEASONS.length]; const timeKey = ['Morning', 'Noon', 'Afternoon', 'Night'][Math.floor((hour % 12) / 3)]; return { season, time: { key: timeKey, emoji: weatherData.TIMES[timeKey] } }; }
function getCurrentWeather(state = loadState()) { const { season, time } = seasonTime(); const now = Date.now(); const slotStart = Math.floor(now / weatherData.WEATHER_DURATION_MS) * weatherData.WEATHER_DURATION_MS; const current = state.weather[LOCATION]; const adminWeathers = cleanupAdminWeathers(current, now); if (!current || Number(current.endsAt) <= now || current.manual || (current.season !== season.key || current.time !== time.key)) { const rolled = weatherData.rollWeather(season.key, time.key); state.weather[LOCATION] = { location: LOCATION, season: season.key, seasonEmoji: season.emoji, time: time.key, timeEmoji: time.emoji, weather: rolled.name, weatherEmoji: rolled.emoji || weatherEmoji(rolled.name), startedAt: slotStart, endsAt: slotStart + weatherData.WEATHER_DURATION_MS, adminWeathers }; saveState(state); } else { current.season = season.key; current.seasonEmoji = season.emoji; current.time = time.key; current.timeEmoji = time.emoji; current.weatherEmoji = current.weatherEmoji || weatherEmoji(current.weather); current.adminWeathers = adminWeathers; delete current.manual; } return state.weather[LOCATION]; }

function unzipXlsx(buffer) { const files = new Map(); let offset = 0; while (offset < buffer.length - 30) { if (buffer.readUInt32LE(offset) !== 0x04034b50) { offset += 1; continue; } const method = buffer.readUInt16LE(offset + 8); const compressedSize = buffer.readUInt32LE(offset + 18); const nameLength = buffer.readUInt16LE(offset + 26); const extraLength = buffer.readUInt16LE(offset + 28); const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8'); const dataStart = offset + 30 + nameLength + extraLength; const compressed = buffer.slice(dataStart, dataStart + compressedSize); if (method === 0) files.set(name, compressed.toString('utf8')); else if (method === 8) files.set(name, zlib.inflateRawSync(compressed).toString('utf8')); offset = dataStart + compressedSize; } return files; }
function decodeXml(value) { return String(value || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'"); }
function parseSharedStrings(xml) { const strings = []; for (const match of xml.matchAll(/<si\b[\s\S]*?<\/si>/g)) strings.push([...match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((part) => decodeXml(part[1])).join('')); return strings; }
function parseSheetCells(xml, sharedStrings) { const cells = new Map(); for (const match of xml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) { const attrs = match[1]; const body = match[2]; const ref = /r="([^"]+)"/.exec(attrs)?.[1]; if (!ref) continue; const type = /t="([^"]+)"/.exec(attrs)?.[1]; const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? ''; const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body)?.[1]; let value = raw; if (type === 's') value = sharedStrings[Number(raw)] ?? ''; else if (type === 'inlineStr') value = decodeXml(inline || ''); cells.set(ref, decodeXml(value)); } return cells; }
function readXlsxCells(filePath) { const files = unzipXlsx(fs.readFileSync(filePath)); const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml') || ''); const sheetName = files.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : [...files.keys()].find((name) => name.startsWith('xl/worksheets/sheet')); return parseSheetCells(files.get(sheetName) || '', sharedStrings); }
function chanceKey(season, time, weather) { return `${season}|${time}|${weather}`; }
function loadFishChanceTable() { if (!fs.existsSync(CALM_LAKE_XLSX)) return null; try { const cells = readXlsxCells(CALM_LAKE_XLSX); const table = new Map(FISH.map((fish) => [fish.id, new Map()])); for (const [season, times] of Object.entries(weatherData.COLUMN_MAP || {})) for (const [time, weathers] of Object.entries(times)) for (const [weather, column] of Object.entries(weathers)) { for (let rowNo = 4; rowNo <= 16; rowNo += 1) { const fish = FISH_BY_NAME.get(normalizeName(cells.get(`A${rowNo}`))); if (!fish) continue; table.get(fish.id).set(chanceKey(season, time, weather), Math.max(0, Number(cells.get(`${column}${rowNo}`)) || 0)); } } return table; } catch { return null; } }
const fishChanceTable = loadFishChanceTable();

function container(accent, components, files = []) { return { flags: COMPONENTS_V2_FLAG, files, components: [{ type: 17, accent_color: accent, components: components.filter(Boolean) }] }; }
function row(components) { return { type: 1, components }; }
function sep() { return { type: 14, divider: true, spacing: 1 }; }
function button(customId, label, style = BUTTON_SECONDARY, disabled = false) { return { type: 2, custom_id: customId, label, style, disabled }; }
function fishButton(userId) { return row([button(`fish:start:${userId}`, 'Fish')]); }
function actionSelect(userId, placeholder = 'Select an action', values = ['equipment', 'location']) { const labels = { fishing: 'Fishing', equipment: 'Equipments', location: 'Change Location' }; return row([{ type: 3, custom_id: `fish:action:${userId}`, placeholder, min_values: 1, max_values: 1, options: values.map((value) => ({ label: labels[value], value })) }]); }
function componentEmoji(emoji) { const match = String(emoji || '').match(/^<a?:([A-Za-z0-9_]+):(\d+)>$/); return match ? { name: match[1], id: match[2], animated: String(emoji).startsWith('<a:') } : emoji ? { name: emoji } : null; }
function rarityLabel(rarity) { return RARITY_EMOJI[String(rarity || '').toLowerCase()] || ''; }
function locationImagePath(location) { const file = path.join(LOCATION_PNG_DIR, `${location || LOCATION}.png`); return fs.existsSync(file) ? file : null; }
function rodDurability(user, rodId) { const item = getItemDefinition(rodId); const entry = user.inventory?.[rodId]; if (!item || item.durability === null) return 'Infinity'; return String(entry?.durabilities?.[0] ?? entry?.durability ?? item.durability); }
function getEquippedRod(user) { return getItemDefinition(user.equippedRodId) || ITEMS.wooden_fishing_rod; }
function getEquippedBait(user) { const bait = getItemDefinition(user.equippedBaitId); return bait?.type === 'Bait' && getInventoryAmount(user, bait.id) > 0 ? bait : null; }
function fishKey(fish) { return normalizeId(fish.displayName || fish.name); }
function baitChancePercent(bait, fish, weatherNames = [], timeKey = null) { const effect = bait?.bait; if (!effect || !fish) return 0; const tags = new Set(Array.isArray(fish.tags) ? fish.tags : []); let boost = 0; for (const [rarity, amount] of Object.entries(effect.rarityBoosts || {})) if (String(fish.rarity || '').toLowerCase() === String(rarity).toLowerCase()) boost += Number(amount) || 0; for (const [tag, amount] of Object.entries(effect.tagBoosts || {})) if (tags.has(tag)) boost += Number(amount) || 0; for (const [id, amount] of Object.entries(effect.fishBoosts || {})) if (id === fish.id || id === fishKey(fish)) boost += Number(amount) || 0; for (const [weather, amount] of Object.entries(effect.weatherBoosts || {})) if (weatherNames.includes(weather)) boost += Number(amount) || 0; if (timeKey === 'Night') for (const [tag, amount] of Object.entries(effect.nightTagBoosts || {})) if (tags.has(tag)) boost += Number(amount) || 0; const cappedBoost = Math.min(boost, Math.max(0, Number(effect.boostCap) || 0) * 100); let penalty = 0; for (const [tag, amount] of Object.entries(effect.tagPenalties || {})) if (tags.has(tag)) penalty += Number(amount) || 0; return cappedBoost + penalty; }
function baitWeightMultiplier(bait, fish, baseWeight, weatherNames = [], timeKey = null) { if (baseWeight <= 0) return 0; const percent = baitChancePercent(bait, fish, weatherNames, timeKey); return Math.max(0, 1 + (percent / 100)); }
function baitBiteSpeedMultiplier(bait, timeKey = null) { const effect = bait?.bait; if (!effect) return 1; let bonus = Number(effect.biteSpeedBonus) || 0; if (timeKey && timeKey !== 'Night') bonus -= Number(effect.dayBiteSpeedPenalty) || 0; return Math.max(0.25, 1 - bonus); }
function baitDurabilityMultiplier(bait) { return 1 + Math.max(0, Number(bait?.bait?.durabilityDrainBonus) || 0); }
function shouldConsumeBaitForFish(bait, fish) { const rarity = bait?.bait?.consumeOnRarity; if (!rarity) return true; return String(fish?.rarity || '').toLowerCase() === String(rarity).toLowerCase(); }
function consumeEquippedBait(user, bait) { if (!bait || getInventoryAmount(user, bait.id) <= 0) return null; const saved = Math.random() < Math.max(0, Number(bait.bait?.saveChance) || 0); if (!saved) { const entry = user.inventory[bait.id]; entry.amount = Math.max(0, Math.floor(Number(entry.amount) || 0) - 1); if (entry.amount <= 0) { delete user.inventory[bait.id]; if (user.equippedBaitId === bait.id) user.equippedBaitId = null; } } return { bait, saved }; }
function getRodPower(rod) { return randomInt(Math.floor(rod.powerMin || 1), Math.floor(rod.powerMax || rod.powerMin || 1)); }
function equipFallbackRod(user, preferredRodId = null) { if (preferredRodId && getInventoryAmount(user, preferredRodId) > 0) user.equippedRodId = preferredRodId; else user.equippedRodId = 'wooden_fishing_rod'; }
function damageEquippedRod(user, amount) { const rodId = user.equippedRodId || 'wooden_fishing_rod'; const rod = getItemDefinition(rodId); if (!rod || rod.durability === null) return false; normalizeRodDurabilities(user, rodId); const entry = user.inventory[rodId]; entry.durabilities[0] = Math.max(0, Math.floor(Number(entry.durabilities[0] ?? rod.durability) - Math.max(0, Math.ceil(amount)))); entry.durability = entry.durabilities[0]; if (entry.durability > 0) return false; entry.durabilities.shift(); entry.amount = Math.max(0, Math.floor(Number(entry.amount) || 0) - 1); if (entry.amount <= 0) delete user.inventory[rodId]; else entry.durability = entry.durabilities[0] ?? rod.durability; equipFallbackRod(user, rodId); return true; }
function destroyOneItem(userId, itemId) { let result = '-# **Item not found.**'; updateUser(userId, (user) => { const item = getItemDefinition(itemId); const entry = user.inventory?.[itemId]; if (!item || !entry || getInventoryAmount(user, itemId) <= 0) return user; if (item.type === 'Gear/Tool') normalizeRodDurabilities(user, itemId); if (Array.isArray(entry.durabilities)) entry.durabilities.shift(); entry.amount = Math.max(0, Math.floor(Number(entry.amount) || 0) - 1); if (entry.amount <= 0) delete user.inventory[itemId]; else entry.durability = entry.durabilities?.[0] ?? entry.durability ?? item.durability ?? null; if (user.equippedRodId === itemId) equipFallbackRod(user, itemId); result = `-# **Destroyed 1 ${item.emoji} ${item.name}. No Fish Coins were given.**`; return user; }); return result; }
function setItemLocked(userId, itemId, locked) { let result = '-# **Item not found.**'; updateUser(userId, (user) => { const item = getItemDefinition(itemId); const entry = user.inventory?.[itemId]; if (!item || !entry || getInventoryAmount(user, itemId) <= 0) return user; entry.locked = Boolean(locked); result = `-# **${locked ? 'Locked' : 'Unlocked'} ${item.emoji} ${item.name}.**`; return user; }); return result; }
function pageItems(items, requestedPage, perPage = 5) { const maxPage = Math.max(1, Math.ceil(items.length / perPage)); const page = Math.max(1, Math.min(maxPage, Math.floor(Number(requestedPage) || 1))); return { page, maxPage, items: items.slice((page - 1) * perPage, page * perPage) }; }

function renderHome(userId) { const user = getUser(userId); const files = []; const location = user.location || LOCATION; const imagePath = locationImagePath(location); if (imagePath) files.push(new AttachmentBuilder(imagePath, { name: 'location-thumbnail.png' })); const header = { type: 10, content: `## You are in ${location}\n-# Ready to fish? Press the button below to start fishing` }; return container(WHITE, [imagePath ? { type: 9, components: [header], accessory: { type: 11, media: { url: 'attachment://location-thumbnail.png' } } } : header, sep(), fishButton(userId), actionSelect(userId)], files); }
function renderEquipment(userId, username) { const user = getUser(userId); const rod = getEquippedRod(user); const bait = getEquippedBait(user); const rodOptions = Object.entries(user.inventory).filter(([itemId]) => getItemDefinition(itemId)?.type === 'Gear/Tool' && getInventoryAmount(user, itemId) > 0).map(([itemId]) => { const item = getItemDefinition(itemId); const emoji = componentEmoji(item.emoji); return { label: item.name, value: item.id, ...(emoji ? { emoji } : {}), default: item.id === user.equippedRodId }; }); const baitItems = Object.entries(user.inventory).filter(([itemId]) => getItemDefinition(itemId)?.type === 'Bait' && getInventoryAmount(user, itemId) > 0); const baitOptions = [{ label: 'No bait', value: 'none', default: !bait }].concat(baitItems.map(([itemId, entry]) => { const item = getItemDefinition(itemId); const emoji = componentEmoji(item.emoji); return { label: item.name, value: item.id, description: `Owned: ${Math.max(0, Math.floor(Number(entry.amount) || 0))}`, ...(emoji ? { emoji } : {}), default: item.id === user.equippedBaitId }; })); const content = [`## ${username}'s Equipments.`, '-# Fishing rod:', `* ${rod.emoji} ${rod.name}`, `* Power: ${rod.powerMin} - ${rod.powerMax} - Dur: ${rodDurability(user, user.equippedRodId)}`, '-# Bait:', `* ${bait ? `${bait.emoji} ${bait.name} x${getInventoryAmount(user, bait.id)}` : 'No bait equipped'}`].join('\n'); return container(WHITE, [{ type: 10, content }, row([{ type: 3, custom_id: `fish:rod:${userId}`, placeholder: rod.name, min_values: 1, max_values: 1, disabled: rodOptions.length <= 1, options: rodOptions.length ? rodOptions : [{ label: rod.name, value: rod.id, default: true }] }]), row([{ type: 3, custom_id: `fish:bait:${userId}`, placeholder: bait?.name || 'Select bait', min_values: 1, max_values: 1, disabled: baitOptions.length <= 1, options: baitOptions }]), actionSelect(userId, 'Select an action', ['fishing', 'location'])]); }
function renderLocationComingSoon(userId) { return container(WHITE, [{ type: 10, content: '## coming soon...' }, actionSelect(userId, 'Select an action', ['fishing', 'equipment'])]); }
function renderFishBarrelFull(userId, username = 'Your') { const user = getUser(userId); return container(WHITE, [{ type: 10, content: `## ${username}'s Fish Barrel is full!\n-# Capacity: ${user.fishBarrel.length} / ${user.fishCapacity}\n-# Sell some fish in /fishy-market or manage your barrel before fishing again.` }, sep(), actionSelect(userId)]); }
function renderInventory(userId, username, requestedPage = 1) { const user = getUser(userId); const records = Object.entries(user.inventory).map(([itemId, entry]) => ({ item: getItemDefinition(itemId), itemId, entry })).filter((record) => record.item && Number(record.entry.amount) > 0); const paged = pageItems(records, requestedPage); const rows = [{ type: 10, content: `## ${username}'s inventory` }]; for (const { item, itemId, entry } of paged.items) { const using = user.equippedRodId === itemId ? `\n-# You are using a ${item.emoji} ${item.name} - Durability: ${rodDurability(user, itemId)}` : ''; const dur = item.type === 'Gear/Tool' ? `\n-# Durability: ${rodDurability(user, itemId)}` : ''; const locked = entry.locked ? '\n-# Locked: yes' : ''; const content = `### x${entry.amount} ${item.name} ${item.emoji} \`${item.type}\`${dur}${using}${locked}\n-# Rarity: ${rarityLabel(item.rarity)}\n-# Value: ${item.value}`; if (item.id === 'wooden_fishing_rod') rows.push({ type: 10, content }); else rows.push({ type: 9, components: [{ type: 10, content }], accessory: item.type === 'Gear/Tool' ? button(`fish:itemsetting:${userId}:${itemId}:${paged.page}`, 'Setting', BUTTON_SECONDARY) : button(`fish:destroyitem:${userId}:${itemId}:${paged.page}`, 'Destroy', BUTTON_DANGER) }); } if (!paged.items.length) rows.push({ type: 10, content: '-# No items found.' }); rows.push(sep(), row([button(`fish:invpage:${userId}:${paged.page}:${paged.maxPage}`, 'Switch page', BUTTON_SECONDARY, paged.maxPage <= 1)])); return container(WHITE, rows); }
function renderFishBarrel(userId, username, requestedPage = 1) { const user = getUser(userId); const records = user.fishBarrel.map((entry) => ({ entry, fish: FISH_BY_ID.get(entry.fishId) })).filter((record) => record.fish); const paged = pageItems(records, requestedPage); const lines = paged.items.map(({ entry, fish }) => `### x1 ${fish.displayName || fish.name} ${fish.emoji}\n-# Rarity: ${rarityLabel(fish.rarity)}\n-# Weigh: ${entry.weight} kg\n-# Variant / Mutation: ${entry.variant} ${entry.variantEmoji} / ${entry.mutation || 'None'}`); return container(WHITE, [{ type: 10, content: [`## ${username}'s inventory`, `-# Capacity: ${user.fishBarrel.length} / ${user.fishCapacity}`, lines.join('\n') || '-# No fish found.'].join('\n') }]); }
function renderCaught(userId, caught) { const fish = FISH_BY_ID.get(caught.fishId); const mutation = caught.mutation ? `${caught.mutation} ${caught.mutationEmoji || ''}`.trim() : 'None'; return container(GREEN, [{ type: 10, content: `## ${fish.emoji} ${fish.displayName || fish.name} has been caught!\n-# * Variant: ${caught.variant} ${caught.variantEmoji}\n-# * Mutation: ${mutation}\n-# * Weigh: ${caught.weight} kg\n-# * Rarity: ${rarityLabel(fish.rarity)}` }, sep(), fishButton(userId), actionSelect(userId)]); }
function renderEscaped(userId, fish, reason = '') { const title = reason === 'broken' || reason === 'lightning' ? `## ${fish.emoji} ${fish.displayName || fish.name} has escaped! Your fishing rod broke!` : `## ${fish.emoji} ${fish.displayName || fish.name} has escaped!`; return container(RED, [{ type: 10, content: `${title}\n-# Better luck next time` }, sep(), fishButton(userId), actionSelect(userId)]); }

function discordCountdown(timestampMs) { return `<t:${Math.max(0, Math.floor(Number(timestampMs) / 1000))}:R>`; }
function formatForecast(weather) { const entries = activeWeatherEntries(weather); const effects = entries.flatMap((entry) => ADMIN_WEATHER[entry.weather]?.text || weatherData.WEATHER_TEXT[entry.weather] || []); return ['## Fishy Weather Forecast', `* Season: ${weather.season} ${weather.seasonEmoji}`, `* Time: ${weather.time} ${weather.timeEmoji}`, `* Todays weather: ${entries.map((entry) => `${entry.weather} ${entry.weatherEmoji || weatherEmoji(entry.weather)}${entry.endsAt ? ` ${discordCountdown(entry.endsAt)}` : ''}`.trim()).join(' ')}`, '', '-# Effects:', (effects.length ? effects : weatherData.WEATHER_TEXT.Sunny).map((effect) => `- ${effect}`).join('\n')].join('\n'); }
function emojiImageUrl(emoji) { const match = String(emoji || '').match(/<a?:([A-Za-z0-9_]+):(\d+)>/); return match ? `https://cdn.discordapp.com/emojis/${match[2]}.${String(emoji).startsWith('<a:') ? 'gif' : 'png'}?quality=lossless` : null; }
function forecastPayload(weather, state) { cleanupEvents(state); const components = [{ type: 17, accent_color: WHITE, components: [{ type: 10, content: formatForecast(weather) }] }]; for (const [eventId, active] of Object.entries(state.events.active || {})) { const event = FISH_EVENTS[eventId]; if (!event) continue; const media = emojiImageUrl(event.emoji); components.push({ type: 17, accent_color: YELLOW, components: [{ type: 9, components: [{ type: 10, content: `### ${event.name} has started!\n-# Duration: ${discordCountdown(active.endsAt)}\n-# ${event.description}` }], accessory: media ? { type: 11, media: { url: media } } : undefined }] }); } return { flags: COMPONENTS_V2_FLAG, components }; }
async function findForecastMessage(channel) { const messages = await channel.messages?.fetch?.({ limit: 50 }).catch(() => null); if (!messages) return null; return messages.find((message) => message.author?.id === channel.client?.user?.id && JSON.stringify(message.components || []).includes('Fishy Weather Forecast')) || null; }
async function maybeEditWeatherForecast(client) { const state = loadState(); const weather = getCurrentWeather(state); cleanupEvents(state); state.forecasts = state.forecasts && typeof state.forecasts === 'object' ? state.forecasts : {}; const weatherKey = activeWeatherEntries(weather).map((entry) => `${entry.weather}:${entry.endsAt || ''}`).join(','); const key = `${weather.location}:${weather.startedAt}:${weather.weather}:${weatherKey}:${Object.keys(state.events.active || {}).join(',')}:${Math.floor(Date.now() / 60000)}`; const channel = await client.channels.fetch(FISHING_CHANNEL_ID).catch(() => null); if (!channel?.isTextBased?.()) { saveState(state); return; } let message = state.forecasts.forecastMessageId ? await channel.messages.fetch(state.forecasts.forecastMessageId).catch(() => null) : null; if (!message) message = await findForecastMessage(channel); if (message && state.forecasts.lastForecastKey === key) { saveState(state); return; } message = message ? await message.edit(forecastPayload(weather, state)).catch(() => null) : await channel.send(forecastPayload(weather, state)).catch(() => null); if (message?.id) { state.forecasts.forecastMessageId = message.id; state.forecasts.lastForecastKey = key; } saveState(state); }
function startWeatherTimer(client) { if (weatherTimerStarted) return; weatherTimerStarted = true; maybeEditWeatherForecast(client).catch(() => null); setInterval(() => maybeEditWeatherForecast(client).catch(() => null), 60000); }

function baseFishWeight(fish) { const rarityWeight = Number(RARITY_WEIGHTS[fish.rarity]) || 0; const rarityCount = FISH.filter((entry) => entry.rarity === fish.rarity).length || 1; return rarityWeight / rarityCount; }
function weatherFishWeight(fish, seasonKey, timeKey, weatherNames = []) { if (!fishChanceTable) return baseFishWeight(fish); const weights = fishChanceTable.get(fish.id); if (!weights) return 0; const knownWeather = weatherNames.filter((name) => weatherData.COLUMN_MAP?.[seasonKey]?.[timeKey]?.[name]); if (!knownWeather.length) return baseFishWeight(fish); return knownWeather.reduce((sum, weather) => sum + Math.max(0, Number(weights.get(chanceKey(seasonKey, timeKey, weather))) || 0), 0); }
function chooseFish(bait = null, weatherNames = [], seasonKey = null, timeKey = null) { const entries = FISH.map((fish) => { const baseWeight = weatherFishWeight(fish, seasonKey, timeKey, weatherNames); return { value: fish, weight: baseWeight * baitWeightMultiplier(bait, fish, baseWeight, weatherNames, timeKey) }; }); return weightedPick(entries) || weightedPick(FISH.map((fish) => ({ value: fish, weight: baseFishWeight(fish) }))) || FISH[0]; }
function forcedVariantForBait(bait) { const variantKey = bait?.bait?.forcedVariant; if (!variantKey) return null; return VARIANTS.find((variant) => String(variant.key).toLowerCase() === String(variantKey).toLowerCase()) || null; }
function pickVariant(weatherName, bait = null) { const forced = forcedVariantForBait(bait); if (forced) return forced; const names = activeWeatherNames(weatherName); if (names.includes('Rainbow')) return VARIANTS.find((variant) => variant.key === 'Rainbow') || VARIANTS[2]; if (names.includes('Golden Rain')) return VARIANTS.find((variant) => variant.key === 'Golden') || VARIANTS[1]; const bonus = Number(combinedWeatherEffects(names).goldenBonus) || 0; if (bonus > 0 && Math.random() < bonus) return VARIANTS.find((variant) => variant.key === 'Golden') || VARIANTS[1]; return weightedPick(VARIANTS.map((variant) => ({ value: variant, weight: variant.chance }))) || VARIANTS[0]; }
function rememberMutation(user, caught) { if (!caught.mutation) return; const key = normalizeId(caught.mutation); const previous = user.mutationIndex[key] && typeof user.mutationIndex[key] === 'object' ? user.mutationIndex[key] : {}; user.mutationIndex[key] = { discoveredAt: previous.discoveredAt || Date.now(), count: Math.max(0, Math.floor(Number(previous.count) || 0)) + 1, lastCaughtAt: Date.now() }; }
function applyMutation(user, caught, weatherName, state) { let mutation = hasEvent(state, 'attack_of_fish') ? GIANT_MUTATION : null; if (!mutation) { for (const name of activeWeatherNames(weatherName)) { mutation = weatherData.rollMutation(name); if (mutation) break; } } if (!mutation) { caught.mutation = null; caught.mutationMultiplier = 1; return; } caught.mutation = mutation.name; caught.mutationEmoji = mutation.emoji || null; caught.mutationMultiplier = Number(mutation.multiplier) || 1; caught.mutationMultiplierType = mutation.multiplierType || (mutation.weightMultiplier ? 'weigh' : 'value'); if (mutation.weightMultiplier) { caught.weight = Number((Number(caught.weight || 0) * mutation.weightMultiplier).toFixed(2)); caught.weightMultiplier = mutation.weightMultiplier; } rememberMutation(user, caught); }
function createSession(userId, messageId, fish, weather, state, rodId = 'wooden_fishing_rod', baitId = null) { const weatherNames = activeWeatherNames(weather); const effect = combinedWeatherEffects(weatherNames); const eventPower = hasEvent(state, 'strength_blessing') ? FISH_EVENTS.strength_blessing.powerMultiplier : 1; const totalPower = Math.max(1, Math.ceil(fish.powerReq * (effect.powerMultiplier || 1) / eventPower)); const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; const buttons = [...REEL_EMOJIS].sort(() => Math.random() - 0.5).slice(0, RARITY_BUTTONS[fish.rarity] || 2); const session = { id, ownerId: userId, messageId, fishId: fish.id, totalPower, remainingPower: totalPower, correctEmoji: buttons[randomInt(0, buttons.length - 1)], buttons, weatherName: weatherNames[0] || weather.weather, weatherNames, rodId, baitId, timer: null }; activeGames.set(id, session); activeGameByUser.set(userId, id); return session; }
function finishSession(session) { if (!session) return; if (session.timer) clearTimeout(session.timer); activeGames.delete(session.id); if (activeGameByUser.get(session.ownerId) === session.id) activeGameByUser.delete(session.ownerId); }
function hasActiveFishingAttempt(userId) { const existingId = activeGameByUser.get(userId); return pendingFishingUsers.has(userId) || (existingId && activeGames.has(existingId)); }
function progressBar(percent) { const safe = Math.max(0, Math.min(100, Math.floor(Number(percent) || 0))); const filled = Math.min(9, Math.floor(safe / 10)); return `${PROGRESS_START}${PROGRESS_MID_FILLED.repeat(filled)}${PROGRESS_MID_EMPTY.repeat(9 - filled)}${safe >= 100 ? PROGRESS_END_FILLED : PROGRESS_END_EMPTY}`; }
function armBiteTimeout(session, message) { if (!session || !message) return; if (session.timer) clearTimeout(session.timer); session.timer = setTimeout(async () => { const active = activeGames.get(session.id); if (!active) return; const fish = FISH_BY_ID.get(active.fishId); finishSession(active); await message.edit(renderEscaped(active.ownerId, fish)).catch(() => null); }, BITE_TIMEOUT_MS); }
function maybeResetBiteTimeout(session, message) { if (session?.rodId !== 'wooden_fishing_rod') armBiteTimeout(session, message); }
function renderBite(session) { const fish = FISH_BY_ID.get(session.fishId); const percent = Math.floor(((session.totalPower - session.remainingPower) / session.totalPower) * 100); const rows = []; for (let index = 0; index < session.buttons.length; index += 5) rows.push(row(session.buttons.slice(index, index + 5).map((emoji, buttonIndex) => ({ type: 2, custom_id: `fish:reel:${session.id}:${index + buttonIndex}`, emoji: { name: emoji }, style: BUTTON_SECONDARY })))); const media = emojiImageUrl(fish.emoji); const biteHeader = { type: 9, components: [{ type: 10, content: `## ${fish.displayName || fish.name} has bitten your hook!\n${progressBar(percent)} ${percent}%\n\n-# Select the correct button: ${session.correctEmoji}` }] }; if (media) biteHeader.accessory = { type: 11, media: { url: media } }; return container(WHITE, [biteHeader, sep(), ...rows]); }
async function startFishing(interaction) {
  const userId = interaction.user.id;
  const state = loadState();
  const currentUser = ensureUser(state, userId);
  if (hasActiveFishingAttempt(userId)) {
    await interaction.reply({ content: 'You already have a fishing minigame active. Finish it before starting another one.', flags: EPHEMERAL_FLAG }).catch(() => null);
    return;
  }
  if (currentUser.fishBarrel.length >= currentUser.fishCapacity) {
    await interaction.update(renderFishBarrelFull(userId, interaction.user.username));
    return;
  }
  const weather = getCurrentWeather(state);
  const weatherNames = activeWeatherNames(weather);
  const effect = combinedWeatherEffects(weatherNames);
  const seasonKey = weather.season || seasonTime().season.key;
  const timeKey = weather.time || seasonTime().time.key;
  pendingFishingUsers.add(userId);
  const begin = async () => {
    let session = null;
    try {
      let bait = null;
      let rodId = 'wooden_fishing_rod';
      updateUser(userId, (user) => {
        rodId = user.equippedRodId || 'wooden_fishing_rod';
        bait = getEquippedBait(user);
        return user;
      });
      const fish = chooseFish(bait, weatherNames, seasonKey, timeKey);
      updateUser(userId, (user) => {
        if (bait && shouldConsumeBaitForFish(bait, fish)) consumeEquippedBait(user, bait);
        return user;
      });
      session = createSession(userId, interaction.message.id, fish, weather, state, rodId, bait?.id || null);
      pendingFishingUsers.delete(userId);
      if (weatherNames.includes('Thunderstorm') && effect.lightningBreakChance && Math.random() < effect.lightningBreakChance) {
        const broke = updateUser(userId, (user) => damageEquippedRod(user, Number.MAX_SAFE_INTEGER));
        finishSession(session);
        await interaction.message.edit(renderEscaped(userId, fish, broke ? 'lightning' : '')).catch(() => null);
        return;
      }
      armBiteTimeout(session, interaction.message);
      await interaction.message.edit(renderBite(session)).catch(() => finishSession(session));
    } catch (error) {
      pendingFishingUsers.delete(userId);
      if (session) finishSession(session);
      throw error;
    }
  };
  try {
    if (hasEvent(state, 'fish_hotspot')) {
      await interaction.update(container(WHITE, [{ type: 10, content: `## Fish instantly bite the hook! ${SPIN_FISH}` }]));
      await begin();
      return;
    }
    await interaction.update(container(WHITE, [{ type: 10, content: `## You've cast your hook, waiting for fish... ${SPIN_FISH}` }]));
    const castBait = getEquippedBait(currentUser);
    const waitMs = Math.max(1000, (randomInt(5, 8) + (effect.lureSeconds || 0)) * baitBiteSpeedMultiplier(castBait, timeKey) * 1000);
    setTimeout(() => begin().catch(() => null), waitMs);
  } catch (error) {
    pendingFishingUsers.delete(userId);
    throw error;
  }
}
async function handleReel(interaction, sessionId, buttonIndex) {
  const session = activeGames.get(sessionId);
  if (!session) {
    await interaction.reply({ content: 'This fishing attempt already ended.', flags: EPHEMERAL_FLAG }).catch(() => null);
    return true;
  }
  if (interaction.user.id !== session.ownerId) {
    await interaction.reply({ content: 'This is not your fishing attempt.', flags: EPHEMERAL_FLAG }).catch(() => null);
    return true;
  }
  maybeResetBiteTimeout(session, interaction.message);
  const fish = FISH_BY_ID.get(session.fishId);
  const selectedEmoji = session.buttons[Number(buttonIndex)];
  const weatherNames = session.weatherNames || [session.weatherName];
  const effect = combinedWeatherEffects(weatherNames);
  const bait = getItemDefinition(session.baitId);
  let broke = false;
  updateUser(session.ownerId, (user) => {
    const rod = getEquippedRod(user);
    const damage = Math.max(1, Math.ceil(fish.durDamage * (effect.durMultiplier || 1) * baitDurabilityMultiplier(bait)));
    if (selectedEmoji === session.correctEmoji) {
      session.remainingPower = Math.max(0, session.remainingPower - getRodPower(rod));
      broke = damageEquippedRod(user, Math.max(1, Math.ceil(damage / 4)));
    } else {
      session.remainingPower = Math.min(session.totalPower, session.remainingPower + Math.ceil(session.totalPower / 5));
      broke = damageEquippedRod(user, damage);
    }
    return user;
  });
  if (broke) {
    finishSession(session);
    await interaction.update(renderEscaped(session.ownerId, fish, 'broken'));
    return true;
  }
  if (session.remainingPower <= 0) {
    const variant = pickVariant(weatherNames, bait);
    const caught = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, fishId: fish.id, weight: Number(randomFloat(fish.minWeight, fish.maxWeight).toFixed(2)), variant: variant.key, variantEmoji: variant.emoji, mutation: null, sellValue: fish.sellValue * variant.multiplier, caughtAt: Date.now() };
    let stored = false;
    updateUser(session.ownerId, (user, state) => {
      const previous = user.fishIndex[fish.id] && typeof user.fishIndex[fish.id] === 'object' ? user.fishIndex[fish.id] : {};
      user.fishIndex[fish.id] = { discoveredAt: previous.discoveredAt || Date.now(), count: Math.max(0, Math.floor(Number(previous.count) || 0)) + 1, lastCaughtAt: Date.now() };
      applyMutation(user, caught, weatherNames, state);
      if (user.fishBarrel.length < user.fishCapacity) {
        user.fishBarrel.push(caught);
        stored = true;
      }
      return user;
    });
    finishSession(session);
    await interaction.update(stored ? renderCaught(session.ownerId, caught) : renderFishBarrelFull(session.ownerId, interaction.user.username));
    return true;
  }
  session.correctEmoji = session.buttons[randomInt(0, session.buttons.length - 1)];
  await interaction.update(renderBite(session));
  return true;
}

function itemSettingModal(userId, itemId, pageNo) { const user = getUser(userId); const item = getItemDefinition(itemId); const locked = Boolean(user.inventory?.[itemId]?.locked); return { custom_id: `fish:itemsettingsubmit:${userId}:${itemId}:${pageNo || 1}`, title: `${item?.name || 'Item'} setting`, components: [{ type: 18, label: 'Q1: What action you wanna do', component: { type: 21, custom_id: 'fish_item_setting_action', required: true, options: [{ value: 'destroy', label: 'Destroy' }, { value: locked ? 'unlock' : 'lock', label: locked ? '🔓Unlock' : '🔒Lock' }] } }] }; }
function submittedValue(interaction, customId) { const stack = [...(interaction.components ?? interaction.data?.components ?? [])]; while (stack.length) { const item = stack.shift(); const component = item?.component ?? item; if (component?.customId === customId || component?.custom_id === customId) { const value = component.value ?? component.values; return Array.isArray(value) ? value[0] : value; } if (Array.isArray(item?.components)) stack.push(...item.components); if (Array.isArray(component?.components)) stack.push(...component.components); } return null; }
function isOwner(interaction, userId) { if (interaction.user.id === userId) return true; interaction.reply({ content: 'Only the command owner can use this control.', flags: EPHEMERAL_FLAG }).catch(() => null); return false; }
async function handleFishingInteraction(interaction) {
  const id = interaction.customId || '';
  if (!id.startsWith('fish:')) return false;
  const parts = id.split(':');
  const action = parts[1];
  if (action === 'action' && interaction.isStringSelectMenu?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    const value = interaction.values?.[0];
    if (value === 'equipment') await interaction.update(renderEquipment(userId, interaction.user.username));
    else if (value === 'location') await interaction.update(renderLocationComingSoon(userId));
    else await interaction.update(renderHome(userId));
    return true;
  }
  if (action === 'rod' && interaction.isStringSelectMenu?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    updateUser(userId, (user) => { const rodId = interaction.values?.[0]; if (getItemDefinition(rodId)?.type === 'Gear/Tool' && getInventoryAmount(user, rodId)) user.equippedRodId = rodId; return user; });
    await interaction.update(renderEquipment(userId, interaction.user.username));
    return true;
  }
  if (action === 'bait' && interaction.isStringSelectMenu?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    updateUser(userId, (user) => { const baitId = interaction.values?.[0]; user.equippedBaitId = baitId === 'none' ? null : user.equippedBaitId; if (getItemDefinition(baitId)?.type === 'Bait' && getInventoryAmount(user, baitId)) user.equippedBaitId = baitId; return user; });
    await interaction.update(renderEquipment(userId, interaction.user.username));
    return true;
  }
  if (action === 'start' && interaction.isButton?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    await startFishing(interaction);
    return true;
  }
  if (action === 'reel' && interaction.isButton?.()) return handleReel(interaction, parts[2], parts[3]);
  if (action === 'invpage' && interaction.isButton?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    const maxPage = Math.max(1, Number(parts[4]) || 1);
    const nextPage = ((Number(parts[3]) || 1) % maxPage) + 1;
    await interaction.update(renderInventory(userId, interaction.user.username, nextPage));
    return true;
  }
  if (action === 'itemsetting' && interaction.isButton?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    await interaction.showModal(itemSettingModal(userId, parts[3], parts[4] || 1));
    return true;
  }
  if (action === 'itemsettingsubmit' && interaction.isModalSubmit?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    const selected = submittedValue(interaction, 'fish_item_setting_action');
    let message = '-# **No action selected.**';
    if (selected === 'destroy') message = destroyOneItem(userId, parts[3]);
    else if (selected === 'lock') message = setItemLocked(userId, parts[3], true);
    else if (selected === 'unlock') message = setItemLocked(userId, parts[3], false);
    await interaction.update({ content: message, components: [] }).catch(() => null);
    return true;
  }
  if (action === 'destroyitem' && interaction.isButton?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    const item = getItemDefinition(parts[3]);
    await interaction.reply({ content: `Destroy 1 ${item?.emoji || ''} ${item?.name || 'item'}? This gives no Fish Coins and cannot be undone.`, flags: EPHEMERAL_FLAG, components: [row([button(`fish:destroyconfirm:${userId}:${parts[3]}:${parts[4] || 1}`, 'Confirm Destroy', BUTTON_DANGER), button(`fish:destroycancel:${userId}`, 'Cancel', BUTTON_SECONDARY)])] }).catch(() => null);
    return true;
  }
  if (action === 'destroycancel' && interaction.isButton?.()) {
    await interaction.update({ content: 'Destroy cancelled.', components: [] }).catch(() => null);
    return true;
  }
  if (action === 'destroyconfirm' && interaction.isButton?.()) {
    const userId = parts[2];
    if (!isOwner(interaction, userId)) return true;
    await interaction.update({ content: destroyOneItem(userId, parts[3]), components: [] }).catch(() => null);
    return true;
  }
  return false;
}

const fishCommand = { data: new SlashCommandBuilder().setName('fish').setDescription('Go fishing'), suppressCommandLog: true, disableActionTimeout: true, init: startWeatherTimer, async execute(interaction) { await interaction.reply(renderHome(interaction.user.id)); }, async handleInteraction(interaction) { return handleFishingInteraction(interaction); } };
const inventoryCommand = { data: new SlashCommandBuilder().setName('inventory').setDescription('Show your inventory'), suppressCommandLog: true, disableActionTimeout: true, async execute(interaction) { await interaction.reply(renderInventory(interaction.user.id, interaction.user.username)); }, async handleInteraction(interaction) { return handleFishingInteraction(interaction); } };
const fishBarrelCommand = { data: new SlashCommandBuilder().setName('fish-barrel').setDescription('Show your Fish Barrel'), suppressCommandLog: true, disableActionTimeout: true, async execute(interaction) { await interaction.reply(renderFishBarrel(interaction.user.id, interaction.user.username)); }, async handleInteraction(interaction) { return handleFishingInteraction(interaction); } };
const fishBalanceCommand = { data: new SlashCommandBuilder().setName('fish-balance').setDescription('Show your Fish Coin balance'), suppressCommandLog: true, async execute(interaction) { const user = getUser(interaction.user.id); await interaction.reply(container(WHITE, [{ type: 10, content: [`### ${interaction.user.username}'s Fish Balance`, `* ${user.fishCoins.toLocaleString('en-US')} ${FISH_COIN}`].join('\n') }])); }, async handleInteraction(interaction) { return handleFishingInteraction(interaction); } };

module.exports = { ITEMS, FISH, FISH_BY_ID, VARIANTS, VARIANT_MULTIPLIER, ADMIN_WEATHER, FISH_EVENTS, activeEvents, cleanupEvents, getCurrentWeather, maybeEditWeatherForecast, getUser, updateUser, fishCommand, inventoryCommand, fishBarrelCommand, fishBalanceCommand };
