const fs=require('fs');
let c=fs.readFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/extract.js','utf8');

// Replace the mergeTimeline function
const oldFn = `function mergeTimeline(timeline, realPoints, todayISO) {
    // Merge real data into the timeline slots (match by HH:MM)
    const map = {};
    for (const p of realPoints) {
        try {
            const t = new Date(p.time);
            const hh = String(t.getUTCHours()).padStart(2,'0'); // UTC but we store Tahiti time in the ISO
            const mm = String(t.getUTCMinutes()).padStart(2,'0');
            const key = \`\${String(t.getUTCHours()).padStart(2,'0')}:\${String(Math.floor(t.getUTCMinutes()/5)*5).padStart(2,'0')}\`;
            map[key] = p;
        } catch(e) {}
    }`;

const newFn = `function mergeTimeline(timeline, realPoints, todayISO) {
    // Convert real points UTC → Tahiti time (GMT-10)
    const tahitiKey = (isoTime) => {
        try {
            const d = new Date(isoTime);
            let h = d.getUTCHours() - 10;
            if (h < 0) h += 24;
            const m = Math.floor(d.getUTCMinutes() / 5) * 5;
            return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
        } catch(e) { return null; }
    };
    const map = {};
    for (const p of realPoints) {
        const k = tahitiKey(p.time);
        if (k) map[k] = p;
    }`;

c = c.replace(oldFn, newFn);
fs.writeFileSync('C:/Users/User/.openclaw/workspace/netrun/dashboard/extract.js', c);
console.log('Patched mergeTimeline');
