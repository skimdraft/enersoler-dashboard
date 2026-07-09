const fs = require('fs');

for (const f of ['dashboard', 'paea', 'temana']) {
    const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/'+f+'.html', 'utf8');
    console.log('─── '+f+' ───');
    console.log('eq-bars animation:', h.includes('eq-bars') ? 'YES' : 'MISSING');
    console.log('icon-bolt:', h.includes('icon-bolt') ? 'YES' : 'MISSING');
    console.log('live-kva glow:', h.includes('live-kva') ? 'YES' : 'MISSING');
    console.log('fillGaps:', h.includes('fillGaps') ? 'YES' : 'MISSING');
    console.log('retour tableau de bord:', h.includes('Retour au tableau de bord') ? 'STILL THERE' : 'removed');
    console.log('Détails techniques:', h.includes('Détails techniques') ? 'STILL THERE' : 'removed');
    console.log('capacité installée stat-row:', h.includes('Capacité installée</span><span class="stat-val">') ? 'YES' : 'MISSING');
    console.log('auto-refresh:', h.includes('refreshData') ? 'YES' : 'MISSING');
}
