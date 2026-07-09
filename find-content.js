const fs = require('fs');
const d = fs.readFileSync('docs/dashboard.html', 'utf8');
const idx = d.indexOf('id="content"');
console.log('Content div at', idx);
if (idx >= 0) console.log(d.substring(idx, idx + 600));
