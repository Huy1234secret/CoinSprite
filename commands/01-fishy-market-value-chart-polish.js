const path = require('path');
const Module = require('module');

const originalCompile = Module.prototype._compile;

function isFishyMarketFile(filename) {
  return path.normalize(filename).split(path.sep).join('/').endsWith('/Fishing Game/fishyMarket.js');
}

function patchFishyMarketChartSource(source) {
  return source.replace(/function renderChartImage\(entry, itemName\) \{[\s\S]*?\n\}\n\nfunction renderValueChart/, `function chartStep(value) {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const power = Math.pow(10, Math.floor(Math.log10(value)));
  const scaled = value / power;
  if (scaled <= 1) return power;
  if (scaled <= 2) return 2 * power;
  if (scaled <= 5) return 5 * power;
  return 10 * power;
}

function formatChartNumber(value) {
  const num = Number(value) || 0;
  const abs = Math.abs(num);
  if (abs >= 1000000) return (num / 1000000).toFixed(1).replace(/\\.0$/, '') + 'm';
  if (abs >= 1000) return (num / 1000).toFixed(1).replace(/\\.0$/, '') + 'k';
  return Number.isInteger(num) ? String(num) : num.toFixed(abs < 10 ? 1 : 0).replace(/\\.0$/, '');
}

function formatChartAge(at, now) {
  const minutes = Math.max(0, Math.round((now - (Number(at) || now)) / 60000));
  if (minutes <= 0) return 'now';
  if (minutes < 60) return minutes + 'm ago';
  const hours = minutes / 60;
  return (Number.isInteger(hours) ? String(hours) : hours.toFixed(1)) + 'h ago';
}

function getChartScale(values, baseValue) {
  const allValues = values.concat([baseValue]).map((value) => Number(value) || 0);
  const low = Math.min(...allValues);
  const high = Math.max(...allValues);
  const integerOnly = allValues.every((value) => Number.isInteger(value));
  const spread = Math.max(0, high - low);
  const padding = spread > 0 ? Math.max(spread * 0.22, integerOnly ? 1 : 0.5) : Math.max(2, Math.ceil(Math.max(1, high) * 0.25));
  let min = Math.max(0, low - padding);
  let max = high + padding;
  let step = chartStep((max - min) / 4);
  if (integerOnly) step = Math.max(1, Math.ceil(step));
  min = Math.max(0, Math.floor(min / step) * step);
  max = Math.ceil(max / step) * step;
  if (max <= min) max = min + (step * 4);
  const ticks = [];
  for (let tick = min, guard = 0; tick <= max + (step / 2) && guard < 8; tick += step, guard += 1) ticks.push(tick);
  return { min, max, ticks };
}

function chartPill(ctx, x, y, text, fill, stroke) {
  const width = Math.max(94, ctx.measureText(text).width + 26);
  roundedRect(ctx, x, y, width, 30, 15, fill, stroke);
  ctx.fillStyle = '#dce6f6';
  ctx.font = '700 13px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(text, x + (width / 2), y + 20);
  return width;
}

function renderChartImage(entry, itemName) {
  if (!fs.existsSync(CHART_DIR)) fs.mkdirSync(CHART_DIR, { recursive: true });
  const canvas = createCanvas(900, 500);
  const ctx = canvas.getContext('2d');
  const now = Date.now();
  const baseValue = Number(entry.baseValue) || 1;
  const currentValue = Math.max(1, Math.round(Number(entry.currentValue) || baseValue));
  const history = (entry.history?.length ? entry.history : [{ at: now, value: currentValue }])
    .map((point) => ({ at: Number(point.at) || now, value: Math.max(1, Math.round(Number(point.value) || baseValue)) }))
    .sort((a, b) => a.at - b.at)
    .slice(-14);

  if (!history.length) history.push({ at: now, value: currentValue });
  if (history[history.length - 1].value !== currentValue) history.push({ at: now, value: currentValue });

  const values = history.map((point) => point.value);
  const high = Math.max(...values);
  const low = Math.min(...values);
  const first = values[0];
  const delta = currentValue - first;
  const percent = first ? (delta / first) * 100 : 0;
  const scale = getChartScale(values, baseValue);
  const x0 = 92;
  const y0 = 354;
  const w = 756;
  const h = 206;

  ctx.fillStyle = '#0d1320';
  ctx.fillRect(0, 0, 900, 500);
  roundedRect(ctx, 24, 24, 852, 452, 24, '#151c2b', '#33425f');
  const headerGradient = ctx.createLinearGradient(24, 24, 876, 118);
  headerGradient.addColorStop(0, 'rgba(82, 242, 194, 0.14)');
  headerGradient.addColorStop(1, 'rgba(159, 212, 255, 0.04)');
  roundedRect(ctx, 38, 38, 824, 84, 18, headerGradient, 'rgba(255, 255, 255, 0.03)');

  ctx.textAlign = 'left';
  ctx.fillStyle = '#f6f8ff';
  ctx.font = '700 30px Arial';
  ctx.fillText(entry.type === 'fish' ? 'Fish Value Chart' : 'Item Value Chart', 54, 72);
  ctx.font = '700 20px Arial';
  ctx.fillStyle = '#9fd4ff';
  ctx.fillText(itemName, 54, 102);
  ctx.font = '600 13px Arial';
  ctx.fillStyle = '#91a2be';
  ctx.fillText('Last ' + history.length + ' market update' + (history.length === 1 ? '' : 's'), 214, 101);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f7fbff';
  ctx.font = '800 26px Arial';
  ctx.fillText(formatChartNumber(currentValue), 786, 76);
  ctx.fillStyle = '#91a2be';
  ctx.font = '700 13px Arial';
  ctx.fillText('CURRENT COINS', 786, 100);

  roundedRect(ctx, 54, 136, 804, 246, 18, '#111827', '#263754');
  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0 - h, w, h);
  ctx.clip();
  const plotGradient = ctx.createLinearGradient(0, y0 - h, 0, y0);
  plotGradient.addColorStop(0, 'rgba(82, 242, 194, 0.10)');
  plotGradient.addColorStop(1, 'rgba(82, 242, 194, 0.00)');
  ctx.fillStyle = plotGradient;
  ctx.fillRect(x0, y0 - h, w, h);
  ctx.restore();

  ctx.textAlign = 'right';
  ctx.font = '13px Arial';
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = '#263754';
  ctx.lineWidth = 1;
  for (const tick of scale.ticks) {
    const y = y0 - (((tick - scale.min) / (scale.max - scale.min)) * h);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + w, y);
    ctx.stroke();
    ctx.fillStyle = '#9aa9c2';
    ctx.fillText(formatChartNumber(tick), x0 - 12, y + 4);
  }
  ctx.setLineDash([]);

  ctx.strokeStyle = '#465a7d';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0 - h);
  ctx.lineTo(x0, y0);
  ctx.lineTo(x0 + w, y0);
  ctx.stroke();

  const points = history.map((point, index) => ({
    x: x0 + ((history.length === 1 ? 0.5 : index / (history.length - 1)) * w),
    y: y0 - (((point.value - scale.min) / (scale.max - scale.min)) * h),
    value: point.value,
    at: point.at,
  }));

  if (points.length === 1) {
    ctx.strokeStyle = 'rgba(82, 242, 194, 0.55)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x0, points[0].y);
    ctx.lineTo(x0 + w, points[0].y);
    ctx.stroke();
  } else {
    const areaGradient = ctx.createLinearGradient(0, y0 - h, 0, y0);
    areaGradient.addColorStop(0, 'rgba(82, 242, 194, 0.26)');
    areaGradient.addColorStop(1, 'rgba(82, 242, 194, 0.02)');
    ctx.fillStyle = areaGradient;
    ctx.beginPath();
    ctx.moveTo(points[0].x, y0);
    points.forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.lineTo(points[points.length - 1].x, y0);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#52f2c2';
    ctx.lineWidth = 5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    points.forEach((point, index) => index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y));
    ctx.stroke();
  }

  points.forEach((point, index) => {
    const isLast = index === points.length - 1;
    ctx.beginPath();
    ctx.fillStyle = isLast ? 'rgba(82, 242, 194, 0.22)' : 'rgba(82, 242, 194, 0.14)';
    ctx.arc(point.x, point.y, isLast ? 12 : 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = '#52f2c2';
    ctx.arc(point.x, point.y, isLast ? 6 : 4, 0, Math.PI * 2);
    ctx.fill();
  });

  const lastPoint = points[points.length - 1];
  ctx.textAlign = 'left';
  ctx.fillStyle = '#dcfff7';
  ctx.font = '800 15px Arial';
  ctx.fillText(formatChartNumber(lastPoint.value) + ' coins', Math.min(lastPoint.x + 14, x0 + w - 86), Math.max(y0 - h + 22, lastPoint.y - 12));

  ctx.textAlign = 'center';
  ctx.fillStyle = '#9aa9c2';
  ctx.font = '12px Arial';
  const labelIndexes = [...new Set([0, Math.round((points.length - 1) / 2), points.length - 1])];
  for (const index of labelIndexes) ctx.fillText(formatChartAge(points[index].at, now), points[index].x, y0 + 24);
  ctx.font = '700 12px Arial';
  ctx.fillStyle = '#7889a8';
  ctx.fillText('Market update history', x0 + (w / 2), y0 + 48);

  ctx.textAlign = 'left';
  ctx.font = '700 13px Arial';
  chartPill(ctx, 54, 410, 'Base ' + formatChartNumber(baseValue), '#172235', '#2b3b59');
  chartPill(ctx, 184, 410, 'High ' + formatChartNumber(high), '#172235', '#2b3b59');
  chartPill(ctx, 314, 410, 'Low ' + formatChartNumber(low), '#172235', '#2b3b59');
  const trendText = (delta > 0 ? '+' : '') + formatChartNumber(delta) + ' (' + (percent > 0 ? '+' : '') + percent.toFixed(1) + '%)';
  chartPill(ctx, 444, 410, 'Trend ' + trendText, delta > 0 ? '#12342d' : delta < 0 ? '#351d29' : '#172235', delta > 0 ? '#2f705f' : delta < 0 ? '#70425b' : '#2b3b59');
  ctx.fillStyle = '#7889a8';
  ctx.font = '15px Arial';
  ctx.fillText('Value changes based on supply, demand, and recent market updates.', 54, 458);

  const chartPath = chartPathFor(entry.type, entry.id);
  fs.writeFileSync(chartPath, canvas.toBuffer('image/png'));
  entry.chartPath = chartPath;
  return chartPath;
}

function renderValueChart`);
}

if (!globalThis.__fishyMarketValueChartPolishPatch) {
  globalThis.__fishyMarketValueChartPolishPatch = true;
  Module.prototype._compile = function polishedFishyMarketCompile(source, filename) {
    const nextSource = isFishyMarketFile(filename) ? patchFishyMarketChartSource(source) : source;
    return originalCompile.call(this, nextSource, filename);
  };
}

module.exports = { patchFishyMarketChartSource };
