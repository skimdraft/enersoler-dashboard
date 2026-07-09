const fs = require('fs');
const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/dashboard.html', 'utf8');
const m = h.match(/"dailyKWh":([^,}]+)/);
console.log('dailyKWh in HTML:', m ? m[1] : 'NOT FOUND');
// Also check if the inline data matches what's in isolar-data.json
const data = JSON.parse(fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/isolar-data.json', 'utf8'));
console.log('JSON dailyKWh:', data.dailyKWh);
console.log('Match:', m && parseFloat(m[1]) === data.dailyKWh);
