const fs = require('fs');
const d = fs.readFileSync('docs/dashboard.html', 'utf8');

// Find all script tags
const scripts = d.match(/<script[^>]*src=["'][^"']*["'][^>]*>/g);
console.log('Script tags:');
if (scripts) scripts.forEach(s => console.log('  ', s));

// Find Chart.js reference
const cdn = d.match(/chart\.js[^"'\s]*/gi);
console.log('\nChart.js refs:', cdn);

// Check if there's a space in CDN URL
const spacedCDN = d.match(/https\s+\/\/cdn/);
console.log('Spaced CDN URLs:', spacedCDN ? spacedCDN.length : 0);

// Check the script loading order
const allScripts = [...d.matchAll(/<script[^>]*>/g)];
console.log('\nAll script tags:');
allScripts.forEach((m, i) => {
    const tag = m[0];
    if (tag.includes('src=')) console.log(`  ${i}: external - ${tag}`);
    else console.log(`  ${i}: inline (${tag.length} chars)`);
});

// Look for the try{render block more completely
const tryIdx = d.indexOf('try{render(INLINE_DATA)');
if (tryIdx >= 0) {
    console.log('\nRender block starts at', tryIdx);
    console.log(d.substring(tryIdx, tryIdx + 500));
}
