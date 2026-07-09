const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'dashboard');
const ENV_FILE = path.join(__dirname, '.env');
const TOKENS_FILE = path.join(DIR, 'isolar-tokens.json');

function loadEnv() {
    const env = {};
    if (fs.existsSync(ENV_FILE)) {
        fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(l => {
            const m = l.match(/^([^#].*?)=(.*)$/);
            if (m) env[m[1].trim()] = m[2].trim();
        });
    }
    return env;
}
const env = loadEnv();

function loadTokens() {
    if (fs.existsSync(TOKENS_FILE)) {
        try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch {}
    }
    return null;
}

function post(host, path, body, token) {
    return new Promise((resolve) => {
        const json = JSON.stringify({ ...body, appkey: env.ISOLAR_APP_KEY, lang: '_fr_FR' });
        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-access-key': env.ISOLAR_APP_SECRET,
            sys_code: '901',
        };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = https.request({ hostname: host, path, method: 'POST', headers }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { resolve({ raw: d.slice(0, 500) }); }
            });
        });
        req.on('error', e => resolve({ error: e.message }));
        req.write(json);
        req.end();
    });
}

async function main() {
    const tokens = loadTokens();
    const token = tokens.accessToken;
    const host = 'gateway.isolarcloud.com.hk';

    // Get raw device list for Paea (1437035) and Temana (1425869)
    for (const psId of ['1437035', '1425869']) {
        console.log('\n=== Plant ' + psId + ' devices ===');
        const resp = await post(host, '/openapi/platform/getDeviceListByPsId', { ps_id: psId, page: 1, size: 20 }, token);
        const devices = resp.result_data?.pageList || [];
        for (const d of devices) {
            console.log(`  dev_id=${d.device_id} type=${d.device_type} name="${d.device_name}" model="${d.device_model}" ps_key="${d.ps_key}"`);
        }
        
        // Now fetch realtime data with ALL point IDs we can think of
        const invDevices = devices.filter(d => d.device_type === 1);
        if (invDevices.length > 0) {
            const keys = invDevices.map(d => d.ps_key);
            // Request many point IDs to discover what's available
            const pointIds = ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','49','50','51','101','102','103'];
            const rtResp = await post(host, '/openapi/platform/getDeviceRealTimeData', {
                ps_key_list: keys,
                point_id_list: pointIds,
                device_type: 1,
            }, token);
            
            if (rtResp.result_data?.device_point_list) {
                for (const item of rtResp.result_data.device_point_list) {
                    const dp = item.device_point || item;
                    const psKey = dp.ps_key || '';
                    console.log(`\n  Inverter ${psKey}:`);
                    // Show all non-null p* fields
                    const fields = Object.keys(dp).filter(k => k.match(/^p\d+$/)).sort((a,b)=>parseInt(a.slice(1))-parseInt(b.slice(1)));
                    for (const f of fields) {
                        if (dp[f] !== null && dp[f] !== undefined && dp[f] !== '') {
                            console.log(`    ${f} = ${dp[f]}`);
                        }
                    }
                    // Also show point_name if available
                    if (dp.point_name) console.log('    point_name:', JSON.stringify(dp.point_name));
                }
            }
        }
    }
}

main().catch(e => console.error(e));
