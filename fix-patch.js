const fs = require('fs');
let code = fs.readFileSync('commands/00z-fishy-market-value-patch.js', 'utf8');

// The file contents literally contain:
//   ctx.fillText(\`${entry.type === 'fish' ? 'Sell value' : 'Current'}: \${currentChartValue} coins\`, 620, 70);`)

// We need to escape the first `$` so it becomes `\${entry.type` instead of `${entry.type`

code = code.replace(
  "ctx.fillText(\`\\${entry.type",
  "ctx.fillText(\\\`\\\\\\${entry.type"
);

// Actually, wait, let's just write a Python script or use node to string replace:
