const fs = require('fs');
for (const f of ['dashboard', 'paea', 'temana']) {
    const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/'+f+'.html', 'utf8');
    console.log('─── '+f+' ───');
    console.log('todayDate filter:', h.includes('todayDate') ? 'YES' : 'MISSING');
    console.log('todayHist:', h.includes('todayHist') ? 'YES' : 'MISSING');
    console.log('chartGauge:', h.includes('chartGauge') ? 'YES' : f==='dashboard'?'OK':'N/A');
    console.log('gauge-center:', h.includes('gauge-center') ? 'YES' : 'MISSING');
    console.log('yieldPct:', h.includes('yieldPct') ? 'YES' : 'MISSING');
    console.log('CO2 doughnut:', h.includes('chartCO2') ? 'STILL' : 'removed');
    console.log('co2-clouds:', h.includes('co2-clouds') ? 'STILL' : 'removed');
    console.log('stat-label white:', h.includes('rgba(255,255,255,0.5)') ? 'YES' : 'MISSING');
}
