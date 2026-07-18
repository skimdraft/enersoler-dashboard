const https = require('https');
const fs = require('fs');

const t = JSON.parse(fs.readFileSync('./isolar-tokens.json', 'utf8'));
const env = {};
fs.readFileSync('../.env', 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^#].*?)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
});

function apiCall(p, body, token) {
    return new Promise(r => {
        const j = JSON.stringify({ ...body, appkey: env.ISOLAR_APP_KEY, lang: '_fr_FR' });
        const h = { 'Content-Type': 'application/json;charset=UTF-8', 'x-access-key': env.ISOLAR_APP_SECRET, 'sys_code': '901' };
        if (token) h['Authorization'] = 'Bearer ' + token;
        const req = https.request({ hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST', headers: h, timeout: 30000 }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({ raw: d.slice(0, 500) }); } });
        });
        req.on('timeout', () => { req.destroy(); r({ error: 'TIMEOUT' }); });
        req.write(j); req.end();
    });
}

async function main() {
    const token = t.accessToken;

    // Fetch all UPF history in one call (full range)
    const r = await apiCall('/openapi/platform/getDevicePointDayMonthYearDataList', {
        query_type: 'day', data_type: '2',
        ps_key_list: ['1847942_1_1_3', '1847942_1_1_4'],
        data_point: 'p1,p24',
        start_time: '20260417', end_time: '20260717',
        order: 0
    }, token);

    if (r.result_code !== '1') {
        console.error('API error:', r.result_code, r.result_msg);
        process.exit(1);
    }

    // Build date map: sum both inverters
    const dateMap = {};
    for (const [psKey, pointData] of Object.entries(r.result_data)) {
        if (psKey === 'point_dict' || psKey === 'illegal_ps_key_list') continue;

        for (const [ptKey, values] of Object.entries(pointData)) {
            const ptId = ptKey.replace('p', '');
            for (const entry of values || []) {
                const stamp = entry.time_stamp;
                if (!stamp) continue;
                const isoDate = stamp.substring(0, 4) + '-' + stamp.substring(4, 6) + '-' + stamp.substring(6, 8);
                if (!dateMap[isoDate]) dateMap[isoDate] = { date: isoDate };
                const val = parseFloat(entry['2'] || '0');
                if (ptId === '1') {
                    dateMap[isoDate].upf_kwh = (dateMap[isoDate].upf_kwh || 0) + Math.round(val / 10) / 100;
                }
                if (ptId === '24') {
                    dateMap[isoDate].upf_peak_kw = Math.max(dateMap[isoDate].upf_peak_kw || 0, Math.round(val / 10) / 100);
                }
            }
        }
    }

    // Load existing history
    const historyDaily = JSON.parse(fs.readFileSync('./history-daily.json', 'utf8'));

    // Merge: update existing entries, add new ones
    let added = 0, updated = 0;
    for (const [isoDate, upfData] of Object.entries(dateMap)) {
        const existing = historyDaily.find(e => e.date === isoDate);
        if (existing) {
            existing.upf_kwh = Math.round(upfData.upf_kwh * 100) / 100;
            if (upfData.upf_peak_kw) existing.upf_peak_kw = upfData.upf_peak_kw;
            updated++;
        } else {
            historyDaily.push(upfData);
            added++;
        }
    }

    // Sort by date
    historyDaily.sort((a, b) => a.date.localeCompare(b.date));

    // Save
    fs.writeFileSync('./history-daily.json', JSON.stringify(historyDaily, null, 2));
    console.log(`UPF history: ${updated} updated, ${added} new, ${historyDaily.length} total entries`);

    // Summary
    const upfEntries = historyDaily.filter(e => e.upf_kwh !== undefined && e.upf_kwh > 0);
    console.log(`UPF days with data: ${upfEntries.length}`);
    if (upfEntries.length > 0) {
        console.log(`  First: ${upfEntries[0].date} ${upfEntries[0].upf_kwh} kWh`);
        console.log(`  Last:  ${upfEntries[upfEntries.length-1].date} ${upfEntries[upfEntries.length-1].upf_kwh} kWh`);
    }
}
main().catch(e => console.error(e));
