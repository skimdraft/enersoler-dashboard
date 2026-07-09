const fs = require('fs');
for (const f of ['dashboard', 'paea', 'temana']) {
    const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/'+f+'.html', 'utf8');
    console.log('─── '+f+' ───');
    console.log('neon bolt:', h.includes('opacity:0.15') ? 'YES' : 'MISSING');
    console.log('footer banner:', h.includes('footer-banner') ? 'STILL THERE' : 'removed');
    console.log('Charge/PF:', h.includes('Charge ' + '%') ? 'STILL THERE' : 'removed');
    console.log('capacité in rendement:', h.includes('kWc</div>') && h.includes('Installé le') ? 'YES' : 'MISSING');
    console.log('dailyKWh inline:', (h.match(/"dailyKWh":([\d.]+)/) || [])[1] || 'MISSING');
}
