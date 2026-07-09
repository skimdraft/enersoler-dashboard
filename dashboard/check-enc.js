const fs = require('fs');
const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/dashboard.html', 'utf8');
console.log('charset:', (h.match(/charset=[^"\'>]+/) || ['MISSING'])[0]);
console.log('Has BOM:', h.charCodeAt(0) === 0xFEFF);
console.log('File size:', (h.length / 1024).toFixed(1), 'KB');
// Check if data is valid JavaScript
const idx = h.indexOf('const INLINE_DATA');
const end = h.indexOf('</script>', idx);
console.log('Data block:', (end - idx).toFixed(0), 'chars');
// Check encoding of emoji
const note = h.match(/"note":"([^"]+)"/);
if (note) console.log('Note:', note[1]);
