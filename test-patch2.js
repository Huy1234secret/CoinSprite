const source = "replace this";
const patched = source.replace("replace this", `  const currentChartValue = displayChartValue(entry.currentValue);
  ctx.fillText(\`\${entry.type === 'fish' ? 'Sell value' : 'Current'}: \${currentChartValue} coins\`, 620, 70);`);
console.log(patched);
