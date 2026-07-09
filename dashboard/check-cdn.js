const fs = require('fs');
['dashboard','paea','temana'].forEach(f => {
    const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/'+f+'.html','utf8');
    const m = h.match(/chart.js[^"]*/);
    console.log(f + ': ' + (m ? m[0] : 'MISSING'));
    // Check for mangled URLs
    const broken = h.match(/https\s+\/\/cdn/);
    if (broken) console.log('  BROKEN CDN!');
});
