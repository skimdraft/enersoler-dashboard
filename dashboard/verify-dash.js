const fs = require('fs');

for (const f of ['dashboard', 'paea', 'temana']) {
    const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/'+f+'.html', 'utf8');
    const hasRefresh = h.includes('refreshData');
    const hasDestroy = h.includes('destroyCharts');
    const hasDetail = h.includes('Détails techniques');
    const hasCDNbroken = h.match(/https\s+\/\/cdn/);
    console.log(f + ':');
    console.log('  Auto-refresh:', hasRefresh ? 'YES' : 'MISSING');
    console.log('  Chart destroy:', hasDestroy ? 'YES' : 'MISSING');
    console.log('  Détails techniques:', hasDetail ? 'STILL PRESENT' : 'removed');
    console.log('  CDN broken:', hasCDNbroken ? 'YES' : 'clean');
}
