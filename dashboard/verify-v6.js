const fs = require('fs');
for (const f of ['dashboard', 'paea', 'temana']) {
    const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/'+f+'.html', 'utf8');
    console.log('─── '+f+' ───');
    console.log('chartGauge or chartDoughnut canvas:', h.includes('chartGauge')||h.includes('chartDoughnut')?'STILL':'removed');
    console.log('gauge-center:', h.includes('gauge-center')?'YES':'MISSING');
    console.log('var(--muted):', (h.match(/var\(--muted\)/g)||[]).length+' occurrences');
    console.log('color:#fff:', (h.match(/color:#fff/g)||[]).length+' occurrences');
    console.log('dailyVal:', h.includes('const dailyVal')?'YES':'MISSING');
}
