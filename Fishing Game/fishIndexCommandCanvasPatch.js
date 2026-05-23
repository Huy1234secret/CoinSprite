const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalPath = path.join(__dirname, 'fishIndexCommand.js');
let source = fs.readFileSync(originalPath, 'utf8');

const afterDrawEmoji = "async function drawEmoji(ctx, emoji, x, y, size) { try { const url = emojiUrl(emoji); if (!url) return false; const image = await loadImage(url); ctx.drawImage(image, x, y, size, size); return true; } catch { return false; } }";
source = source.replace(afterDrawEmoji, `${afterDrawEmoji}
async function drawEmojiOrText(ctx, emoji, text, x, y, size, maxWidth = 90) {
  if (await drawEmoji(ctx, emoji, x, y, size)) return size;
  const label = String(text || '').trim();
  if (!label) return 0;
  ctx.font = \`800 \${fit(ctx, label, maxWidth, Math.min(size, 15), '800')}px sans-serif\`;
  ctx.fillText(label, x, y + size - 5);
  return Math.min(ctx.measureText(label).width, maxWidth);
}
async function drawEmojiRow(ctx, entries, x, y, size, gap, maxX) {
  let cx = x;
  let cy = y;
  for (const entry of entries) {
    if (cx + size > maxX) {
      cx = x;
      cy += size + 5;
    }
    const drawnWidth = await drawEmojiOrText(ctx, entry.emoji, entry.text, cx, cy, size, Math.max(32, maxX - cx));
    cx += (drawnWidth || size) + gap;
  }
  return cy + size;
}`);

const oldAvailabilityHelpers = "const availability = loadFishAvailability();\nfunction seasonText(fish) { const info = availability.get(fish.id); if (!info || !info.seasons.size) return 'All'; const allTimes = Object.keys(TIMES).length; return [...info.seasons.entries()].map(([season, times]) => { const seasonEmoji = SEASONS.find((item) => item.key === season)?.emoji || season; const timeText = times.size >= allTimes ? '' : ` - ${[...times].map((time) => TIMES[time] || time).join(' ')}`; return `${seasonEmoji}${timeText}`; }).join('  '); }\nfunction favoriteWeatherText(fish) { const info = availability.get(fish.id); if (!info || !info.weatherWeights.size) return 'All'; const max = Math.max(...info.weatherWeights.values()); return [...info.weatherWeights.entries()].filter(([, weight]) => weight === max).map(([weather]) => WEATHER_EMOJIS[weather] || weather).join(' '); }";
source = source.replace(oldAvailabilityHelpers, `const availability = loadFishAvailability();
function seasonEntries(fish) {
  const info = availability.get(fish.id);
  if (!info || !info.seasons.size) return [];
  const allTimes = Object.keys(TIMES).length;
  return [...info.seasons.entries()].flatMap(([season, times]) => {
    const seasonData = SEASONS.find((item) => item.key === season);
    const entries = [{ emoji: seasonData?.emoji, text: seasonData?.key || season }];
    if (times.size < allTimes) for (const time of times) entries.push({ emoji: TIMES[time], text: time });
    return entries;
  });
}
function favoriteWeatherEntries(fish) {
  const info = availability.get(fish.id);
  if (!info || !info.weatherWeights.size) return [];
  return [...info.weatherWeights.entries()]
    .sort(([weatherA, chanceA], [weatherB, chanceB]) => (Number(chanceB) - Number(chanceA)) || weatherA.localeCompare(weatherB))
    .slice(0, 3)
    .map(([weather]) => ({ emoji: WEATHER_EMOJIS[weather], text: weather }));
}`);

source = source.replace(
  "ctx.fillText(`Season: ${ok ? seasonText(fish) : '???'}`, x + 170, y + 132);",
  `ctx.fillText('Season:', x + 170, y + 132);
    if (ok) {
      const seasons = seasonEntries(fish);
      if (seasons.length) await drawEmojiRow(ctx, seasons, x + 240, y + 113, 22, 5, x + cardWidth - 18);
      else ctx.fillText('All', x + 240, y + 132);
    } else {
      ctx.fillText('???', x + 240, y + 132);
    }`
);

source = source.replace(
  "ctx.fillText(`Fav Weather: ${ok ? favoriteWeatherText(fish) : '???'}`, x + 170, y + 170);",
  `ctx.fillText('Fav Weather:', x + 170, y + 170);
    if (ok) {
      const weathers = favoriteWeatherEntries(fish);
      if (weathers.length) await drawEmojiRow(ctx, weathers, x + 282, y + 150, 25, 8, x + cardWidth - 18);
      else ctx.fillText('All', x + 282, y + 170);
    } else {
      ctx.fillText('???', x + 282, y + 170);
    }`
);

source = source.replace(
  "ctx.fillText(`Weather: ${ok ? (WEATHER_EMOJIS[mutation.weather] || FISH_EVENTS.attack_of_fish.emoji || mutation.weather) : '???'}`, x + 22, y + 154);",
  `ctx.fillText('Weather:', x + 22, y + 154);
    if (ok) {
      const emoji = WEATHER_EMOJIS[mutation.weather] || FISH_EVENTS.attack_of_fish.emoji;
      await drawEmojiOrText(ctx, emoji, mutation.weather, x + 102, y + 136, 24, cardWidth - 124);
    } else {
      ctx.fillText('???', x + 102, y + 154);
    }`
);

const patchedModule = new Module(originalPath, module.parent);
patchedModule.filename = originalPath;
patchedModule.paths = Module._nodeModulePaths(path.dirname(originalPath));
patchedModule._compile(source, originalPath);

module.exports = patchedModule.exports;
