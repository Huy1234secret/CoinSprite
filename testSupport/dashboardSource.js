const fs = require('node:fs');
const path = require('node:path');
module.exports = function dashboardSource() {
  const directory = path.join(__dirname, '../admin/client');
  return fs.readdirSync(directory).filter(name => name.endsWith('.js')).sort()
    .map(name => fs.readFileSync(path.join(directory,name),'utf8')).join('\n');
};
