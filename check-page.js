const https = require('https');
https.get('https://enersoler.com/dashboard/', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Has INLINE_DATA:', d.includes('INLINE_DATA'));
    console.log('Has GitHub fetch URL:', d.includes('raw.githubusercontent.com'));
    const m = d.match(/dailyKWh[^:]*:\s*([\d.]+)/);
    console.log('Daily kWh inline:', m ? m[1] : 'not found');
    const t = d.match(/updateTime[^:]*:\s*"([^"]+)"/);
    console.log('Update time inline:', t ? t[1] : 'not found');
    // Check for common JS errors
    const hasRender = d.includes('render(INLINE_DATA)');
    console.log('Has render(INLINE_DATA):', hasRender);
    // Check if the file ends properly
    console.log('File length:', d.length);
    console.log('Last 200 chars:', d.slice(-200));
  });
}).on('error', e => console.error(e));
