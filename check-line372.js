const https = require('https');

https.get('https://enersoler.com/dashboard/dashboard.html', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    const lines = d.split('\n');
    console.log('Line 370:', lines[369]);
    console.log('Line 371:', lines[370]);
    console.log('Line 372:', lines[371]);
    console.log('Line 373:', lines[372]);
    console.log('Line 374:', lines[373]);
    
    // Also find syntax-oddities
    for (let i = 360; i <= 380; i++) {
      const line = lines[i];
      if (line && (line.includes('?') && line.includes('??'))) {
        console.log(`\nLine ${i+1} has ?? :`, line.trim().substring(0, 120));
      }
    }
  });
}).on('error', e => console.error(e));
