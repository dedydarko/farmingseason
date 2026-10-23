const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.resolve('asset', 'fs_20261022_0630', 'game-Ba54Z7I8.js'), 'utf8');

console.log('=== INPUT SETUP (around 1615000 - 1616000) ===');
console.log(code.slice(1615000, 1616000));
