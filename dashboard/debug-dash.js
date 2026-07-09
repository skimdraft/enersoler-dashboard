const fs = require('fs');
const html = fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/dashboard.html', 'utf8');

// 1. Check for </script> in data (would close script tag prematurely)
const dataStart = html.indexOf('const INLINE_DATA');
const nextScript = html.indexOf('</script>', dataStart);
const dataBlockLength = nextScript - dataStart;
console.log('Data block length:', dataBlockLength, 'chars');

// Check if </script> appears inside the JSON string itself
const between = html.slice(dataStart, nextScript);
const insideData = between.indexOf('</script>');
console.log('</script> inside data:', insideData > -1 ? 'YES - THIS IS THE BUG' : 'clean');

// 2. Try to extract and parse the JSON
const m = html.match(/const INLINE_DATA = ({.*?\n});/s);
if (m) {
    try {
        const data = JSON.parse(m[1]);
        console.log('JSON valid — updateTime:', data.updateTime, '| plants:', data.plants.length, '| history:', data.history.length);
    } catch (e) {
        console.log('JSON parse error:', e.message);
        // Show context around error
        const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0');
        console.log('Context:', m[1].slice(Math.max(0, pos - 50), pos + 50));
    }
} else {
    console.log('Could not extract INLINE_DATA with regex');
}

// 3. Check if render function exists
console.log('Has function render:', html.includes('function render'));
console.log('Has try{render:', html.includes('try{render'));
console.log('Has catch:', html.includes('catch(e)'));

// 4. Check CDN script 
const cdnMatch = html.match(/script src="([^"]*chart[^"]*)"/);
console.log('Chart.js CDN:', cdnMatch ? cdnMatch[1] : 'NOT FOUND');
