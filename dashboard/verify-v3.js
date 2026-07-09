const fs = require('fs');

for (const f of ['dashboard', 'paea', 'temana']) {
    const h = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/'+f+'.html', 'utf8');
    console.log('─── '+f+' ───');
    console.log('icon-thermo:', h.includes('icon-thermo') ? 'YES' : 'MISSING');
    console.log('co2-clouds:', h.includes('co2-clouds') ? 'YES' : 'MISSING');
    console.log('min:0 on y-axis:', h.includes('min:0') ? 'YES' : 'MISSING');
    console.log('spanGaps:true:', h.includes('spanGaps:true') ? 'YES' : 'MISSING');
    console.log('bolt svg 40px:', h.includes('width:40px') ? 'YES' : 'MISSING');
    console.log('eq-bars 34px:', h.includes('height:34px') ? 'YES' : 'MISSING');
    console.log('eq anim 2.4s:', h.includes('eq 2.4s') ? 'YES' : 'MISSING');
}
