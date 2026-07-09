const https = require('https');

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

async function main() {
  const html = await fetchPage('https://enersoler.com/dashboard/dashboard.html');
  
  console.log('File size:', html.length);
  
  // Check key elements
  console.log('Has INLINE_DATA:', html.includes('INLINE_DATA'));
  console.log('Has INLINE_PLACEHOLDER:', html.includes('INLINE_PLACEHOLDER'));
  
  // Extract and validate JSON
  const start = html.indexOf('const INLINE_DATA = ');
  if (start >= 0) {
    const end = html.indexOf(';', start);
    const json = html.substring(start + 20, end);
    try {
      const obj = JSON.parse(json);
      console.log('JSON VALID - dailyKWh:', obj.dailyKWh);
      console.log('Plants:', obj.plants?.length);
      console.log('History points:', obj.history?.length);
    } catch(e) {
      console.log('JSON INVALID:', e.message);
    }
  } else {
    console.log('INLINE_DATA not found!');
  }
  
  // Check for render call
  console.log('Has try{render:', html.includes('try{render'));
  console.log('Has refreshData:', html.includes('refreshData'));
  
  // Check CDN
  const cdn = html.match(/chart\.js[^"'\s]*/i);
  console.log('Chart.js CDN:', cdn ? cdn[0] : 'not found');
  
  // Check GitHub URL
  console.log('Has raw.githubusercontent.com:', html.includes('raw.githubusercontent.com'));
  
  // Show first script tags
  const scripts = html.match(/<script[^>]*>/g);
  console.log('\nScript tags found:', scripts ? scripts.length : 0);
  if (scripts) scripts.slice(0,5).forEach((s,i) => console.log(`  ${i}:`, s.substring(0, 100)));
}

main().catch(e => console.error('Fetch error:', e.message));
