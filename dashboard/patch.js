const fs=require('fs');
let c=fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/extract.js','utf8');

// Add isMidnight flag logic
c = c.replace(
  'const firstBaselineRun = !baseline || baseline.date !== today;',
  'const firstBaselineRun = !baseline || baseline.date !== today;\n    const midnightOK = baseline && baseline.isMidnight === true;'
);

// Save with isMidnight
c = c.replace(
  "saveBaseline({ date: today, p2: newBaselineP2, savedAt: new Date().toISOString() });",
  "const h = new Date().toLocaleString('en-US',{timeZone:'Pacific/Tahiti',hour:'2-digit',hour12:false});\n        saveBaseline({ date: today, p2: newBaselineP2, isMidnight: parseInt(h)<1, savedAt: new Date().toISOString() });"
);

// Per-plant daily check
c = c.replace(
  'if (!firstBaselineRun && baseline && baseline.date === today && inv)',
  'if (!firstBaselineRun && baseline && baseline.isMidnight && baseline.date === today && inv)'
);

// Global daily recompute
c = c.replace(
  'if (!firstBaselineRun && bl && bl.date === today)',
  'if (!firstBaselineRun && bl && bl.isMidnight && bl.date === today)'
);

fs.writeFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/extract.js',c);
console.log('Patched');
