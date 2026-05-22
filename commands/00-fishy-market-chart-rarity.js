const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalLoader = Module._extensions['.js'];

function isFishyMarketFile(filename) {
  return path.normalize(filename).split(path.sep).join('/').endsWith('/Fishing Game/fishyMarket.js');
}

function patchFishyMarketSource(source) {
  return source
    .replace(/const RARITY_EMOJI = \{[\s\S]*?\n\};/, `const RARITY_EMOJI = {
  common: '<:SBCommon:1506965202585780274>',
  uncommon: '<:SBUncommon:1506965215743447040>',
  rare: '<:SBRare:1506965211607994461>',
  epic: '<:SBEpic:1506965204624474153>',
  legendary: '<:SBLegendary:1506965206197207131>',
  mythical: '<:SBMythical:1506965209271762954>',
  secret: '<:SBSecret:1506965213881307186>',
};`)
    .replace(`function rarityLabel(rarity) {
  return \`\${RARITY_EMOJI[rarity] || ''} \${rarity}\`.trim();
}`, `function rarityLabel(rarity) {
  const key = String(rarity || '').toLowerCase();
  return RARITY_EMOJI[key] || '';
}`)
    .replace(`function soldFishMessage(fish, entry, value) {
  return \`-# **You've sold \${fish.displayName} \${fish.emoji} - \${fish.rarity} - \${Number(entry.weight || 0).toFixed(2)} kg - \${value} \${FISH_COIN}**\`;
}`, `function soldFishMessage(fish, entry, value) {
  return \`-# **You've sold \${fish.displayName} \${fish.emoji} - \${rarityLabel(fish.rarity)} - \${Number(entry.weight || 0).toFixed(2)} kg - \${value} \${FISH_COIN}**\`;
}`)
    .replace(`function soldItemMessage(item, amount, value) {
  return \`-# **You've sold \\u00d7\${amount} \${item.name} \${item.emoji} - \${item.rarity} - \${value} \${FISH_COIN}**\`;
}`, `function soldItemMessage(item, amount, value) {
  return \`-# **You've sold \\u00d7\${amount} \${item.name} \${item.emoji} - \${rarityLabel(item.rarity)} - \${value} \${FISH_COIN}**\`;
}`)
    .replace(/function renderChartImage\(entry, itemName\) \{[\s\S]*?\n\}\n\nfunction renderValueChart/, `function niceStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / power;
  if (scaled <= 1) return power;
  if (scaled <= 2) return 2 * power;
  if (scaled <= 5) return 5 * power;
  return 10 * power;
}

function yScale(values, targetTicks = 5) {
  const high = Math.max(...values);
  const low = Math.min(...values);
  const padding = Math.max(1, Math.ceil((high - low) * 0.1));
  let min = Math.max(0, low - padding);
  let max = high + padding;
  if (min === max) {
    min = Math.max(0, min - 5);
    max += 5;
  }
  const step = niceStep((max - min) / Math.max(1, targetTicks - 1));
  min = Math.max(0, Math.floor(min / step) * step);
  max = Math.ceil(max / step) * step;
  const ticks = [];
  for (let tick = min; tick <= max + (step / 2); tick += step) ticks.push(tick);
  return { min, max, ticks };
}

function formatAgo(ms) {
  if (ms <= 0) return 'now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return \`\${minutes}m\`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? \`\${hours}h\` : \`\${hours.toFixed(1)}h\`;
}

function renderChartImage(entry, itemName) {
  if (!fs.existsSync(CHART_DIR)) fs.mkdirSync(CHART_DIR, { recursive: true });
  const canvas = createCanvas(900, 500);
  const ctx = canvas.getContext('2d');
  const now = Date.now();
  const timeWindowMs = 2 * 60 * 60 * 1000;
  const history = (entry.history?.length ? entry.history : [{ at: now, value: entry.baseValue }])
    .map((point) => ({ at: Number(point.at) || now, value: Number(point.value) || entry.baseValue }))
    .filter((point) => point.at >= now - timeWindowMs && point.at <= now)
    .sort((a, b) => a.at - b.at);
  if (!history.length) history.push({ at: now, value: Number(entry.currentValue) || entry.baseValue });
  const values = history.map((point) => point.value);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const x0 = 90;
  const y0 = 350;
  const w = 760;
  const h = 220;
  ctx.fillStyle = '#10141f';
  ctx.fillRect(0, 0, 900, 500);
  roundedRect(ctx, 24, 24, 852, 452, 24, '#161c2a', '#2d3a55');
  ctx.fillStyle = '#f4f7fb';
  ctx.font = '700 30px Arial';
  ctx.fillText(entry.type === 'fish' ? 'Fish Value Chart' : 'Item Value Chart', 52, 70);
  ctx.font = '600 20px Arial';
  ctx.fillStyle = '#9fd4ff';
  ctx.fillText(itemName, 52, 102);
  ctx.fillStyle = '#f4f7fb';
  ctx.fillText(\`Current: \${entry.currentValue} coins\`, 620, 70);
  const scale = yScale(values);
  ctx.save();
  ctx.strokeStyle = '#31415f';
  ctx.lineWidth = 1;
  ctx.setLineDash([7, 7]);
  ctx.fillStyle = '#a9b8d0';
  ctx.font = '13px Arial';
  for (const tick of scale.ticks) {
    const y = y0 - (((tick - scale.min) / (scale.max - scale.min)) * h);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
    ctx.fillText(String(Math.round(tick)), 48, y + 4);
  }
  ctx.restore();
  ctx.strokeStyle = '#3b4966';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - h);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.stroke();
  ctx.fillStyle = '#93a4bf';
  ctx.font = '14px Arial';
  ctx.fillText('Coins', 42, 220);
  ctx.fillText('Time ago', 420, 404);
  ctx.font = '13px Arial';
  for (let offset = timeWindowMs; offset >= 0; offset -= 30 * 60 * 1000) {
    const x = x0 + (((timeWindowMs - offset) / timeWindowMs) * w);
    ctx.fillText(formatAgo(offset), x - 12, y0 + 25);
  }
  const points = history.map((point) => ({
    x: x0 + (((point.at - (now - timeWindowMs)) / timeWindowMs) * w),
    y: y0 - (((point.value - scale.min) / (scale.max - scale.min)) * h),
  }));
  ctx.strokeStyle = '#52f2c2';
  ctx.lineWidth = 4;
  ctx.beginPath();
  points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
  ctx.stroke();
  ctx.fillStyle = '#52f2c2';
  points.forEach((point) => { ctx.beginPath(); ctx.arc(point.x, point.y, 5, 0, Math.PI * 2); ctx.fill(); });
  ctx.font = '700 16px Arial';
  ctx.fillText('Value', x0 + w - 60, Math.max(y0 - h + 20, points[points.length - 1].y - 12));
  ctx.fillStyle = '#d6dfef';
  ctx.font = '16px Arial';
  ctx.fillText(\`Base: \${entry.baseValue} coins\`, 52, 430);
  ctx.fillText(\`High: \${high} coins\`, 270, 430);
  ctx.fillText(\`Low: \${low} coins\`, 470, 430);
  ctx.fillStyle = '#7f8faa';
  ctx.fillText('Value changes based on supply and demand', 52, 458);
  const chartPath = chartPathFor(entry.type, entry.id);
  fs.writeFileSync(chartPath, canvas.toBuffer('image/png'));
  entry.chartPath = chartPath;
  return chartPath;
}

function renderValueChart`);
}

if (!globalThis.__fishyMarketChartRarityPatch) {
  globalThis.__fishyMarketChartRarityPatch = true;
  Module._extensions['.js'] = function patchedFishyMarketLoader(module, filename) {
    if (!isFishyMarketFile(filename)) return originalLoader(module, filename);
    const source = patchFishyMarketSource(fs.readFileSync(filename, 'utf8'));
    return module._compile(source, filename);
  };
}

module.exports = {};
