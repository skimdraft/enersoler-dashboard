const fs = require('fs');
const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/paea.html', 'utf8');
// Find INLINE_DATA and extract plant data
const m = h.match(/const INLINE_DATA = ({.*?});/s);
if (m) {
    const d = JSON.parse(m[1]);
    const paea = d.plants.find(p => p.slug === 'paea');
    console.log('Paea daily_kwh:', paea?.daily_kwh);
    console.log('Paea daily_pending:', paea?.daily_pending);
    console.log('Paea capacity:', paea?.capacity_kwp);
} else {
    console.log('Could not extract INLINE_DATA');
}
