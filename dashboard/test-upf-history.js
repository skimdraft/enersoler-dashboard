const https = require('https');
const fs = require('fs');

const t = JSON.parse(fs.readFileSync('./isolar-tokens.json', 'utf8'));
const env = {};
fs.readFileSync('../.env', 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^#].*?)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
});

const APP_KEY = env.ISOLAR_APP_KEY;
const APP_SECRET = env.ISOLAR_APP_SECRET;

function apiCall(p, body, token) {
    return new Promise(r => {
        const j = JSON.stringify({ ...body, appkey: APP_KEY, lang: '_fr_FR' });
        const h = { 'Content-Type': 'application/json;charset=UTF-8', 'x-access-key': APP_SECRET, 'sys_code': '901' };
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
    const r = await apiCall('/openapi/platform/getDevicePointDayMonthYearDataList', {
        query_type: 'day', data_type: '2',
        ps_key_list: ['1847942_1_1_3', '1847942_1_1_4'],
        data_point: 'p1,p24',
        start_time: '20260417', end_time: '20260717',
        order: 0
    }, token);
    console.log('result_code:', r.result_code);
    if (r.result_data) {
        console.log('Keys:', Object.keys(r.result_data));
        for (const [k, v] of Object.entries(r.result_data)) {
            if (k === 'point_dict' || k === 'illegal_ps_key_list') {
                console.log(k + ':', JSON.stringify(v).slice(0, 200));
                continue;
            }
            console.log(k + ': p1=' + (v.p1?.length || 0) + ' p24=' + (v.p24?.length || 0));
            if (v.p1 && v.p1.length > 0) {
                const first = v.p1[0], last = v.p1[v.p1.length - 1];
                console.log('  First:', first.time_stamp, parseFloat(first['2']) / 1000, 'kWh');
                console.log('  Last:', last.time_stamp, parseFloat(last['2']) / 1000, 'kWh');
            }
        }
    }
}
main().catch(e => console.error(e));
