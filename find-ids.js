const fs = require('fs');
const d = fs.readFileSync('docs/dashboard.html', 'utf8');

console.log('Has id="content":', d.includes('id="content"'));
console.log('Has id=content:', d.includes('id=content'));

// Find all IDs
const idRegex = /id="([^"]+)"/g;
const ids = [];
let m;
while ((m = idRegex.exec(d)) !== null) {
    ids.push(m[1]);
}
console.log('\nAll IDs:', [...new Set(ids)].join(', '));
