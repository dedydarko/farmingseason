const fs = require('fs');
const path = require('path');

const code = fs.readFileSync(path.resolve('asset', 'fs_20261022_0630', 'game-Ba54Z7I8.js'), 'utf8');

console.log('=== SEARCH FOR KEYBOARD SETUP IN BATTLE ===');

function findSnippet(term, max = 5) {
  console.log(`\n--- Term: "${term}" ---`);
  let idx = 0;
  let matches = 0;
  while ((idx = code.indexOf(term, idx)) !== -1 && matches < max) {
    const start = Math.max(0, idx - 100);
    const end = Math.min(code.length, idx + term.length + 120);
    console.log(`[Pos ${idx}]: ...${code.slice(start, end).replace(/\n/g, ' ')}...`);
    idx += term.length;
    matches++;
  }
}

findSnippet('addKeys');
findSnippet('SPACE');
findSnippet('dodge(');
findSnippet('doStorm');
findSnippet('keyboard');
