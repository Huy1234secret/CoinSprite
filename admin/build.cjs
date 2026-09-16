const path = require('node:path');
const esbuild = require('esbuild');
const options = {
  absWorkingDir: path.join(__dirname, '..'),
  entryPoints: [path.join(__dirname, 'client/main.js')],
  outfile: path.join(__dirname, 'workspace.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'info',
};
if (require.main === module) esbuild.buildSync(options);
module.exports = options;
