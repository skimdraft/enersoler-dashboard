const fs=require('fs');
const h=fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/paea.html','utf8');

// Find hex card labels
const hexSection = h.split('<div class="hex-grid">')[1].split('</div>\n\n')[0];
const hexLabels = hexSection.match(/class="label">([^<]+)</g);
if (hexLabels) {
  console.log('HEX CARDS:', hexLabels.map(l => l.replace(/.*>([^<]+).*/, '$1')).join(' | '));
}

// Find stat labels
const statSection = h.split('<div class="stats-row">')[1].split('</div>\n\n')[0];
const statLabels = statSection.match(/class="s-label">([^<]+)</g);
if (statLabels) {
  console.log('STATS:', statLabels.map(l => l.replace(/.*>([^<]+).*/, '$1')).join(' | '));
}

console.log('Footer:', h.includes('Serveur Enersoler OAuth2.0') ? 'OK' : 'OLD');
