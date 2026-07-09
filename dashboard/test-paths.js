const https = require('https');
const crypto = require('crypto');

const A = '99927DD8A3562C02F3EEF55045F95419';
const S = 'dwbumt012186my4mu7ffqzji4a3vrfu5';

function call(label, host, path, body) {
    return new Promise((resolve) => {
        const j = JSON.stringify(Object.assign({ lang: '_fr_FR' }, body));
        const req = https.request({
            hostname: host,
            path: path,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=UTF-8',
                'x-access-key': S,
                'sys_code': '901',
            },
        }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    const code = p.result_code || '?';
                    const msg = p.result_msg || p.error_description || '';
                    const hasData = p.result_data ? Object.keys(p.result_data).slice(0, 3).join(',') : 'NO';
                    console.log(label + ': ' + code + ' ' + msg + ' | data: ' + hasData);
                    if (code === '1') console.log('   >> ' + JSON.stringify(p).slice(0, 300));
                } catch (e) {
                    console.log(label + ': PARSE=' + d.slice(0, 200));
                }
                resolve();
            });
        });
        req.write(j);
        req.end();
    });
}

async function main() {
    console.log('=== User API path discovery ===\n');
    const HOST = 'gateway.isolarcloud.com.hk';

    // Try /v1/ paths (common for User API)
    const v1Tests = [
        ['v1 queryPowerStationList', '/v1/powerStation/queryPowerStationList'],
        ['v1 getPowerStationDetail', '/v1/powerStation/getPowerStationDetail'],
        ['v1 getStationRealTimeData', '/v1/powerStation/getStationRealTimeData'],
        ['v1 getPlantPowerData', '/v1/powerStation/getPlantPowerData'],
        ['v1 getDeviceList', '/v1/device/getDeviceList'],
        ['v1 getDeviceRealTimeData', '/v1/device/getDeviceRealTimeData'],
        // Also try /openapi/ without /platform/
        ['openapi queryPowerStationList', '/openapi/queryPowerStationList'],
        ['openapi getPowerStationDetail', '/openapi/getPowerStationDetail'],
        // Try /api/
        ['api queryPowerStationList', '/api/powerStation/queryPowerStationList'],
    ];

    for (const [label, path] of v1Tests) {
        await call(label, HOST, path, {
            appkey: A,
            ps_id: '1437035',
            ps_ids: '1437035',
            page: 1,
            size: 20,
            date: '2026-07-01',
        });
    }
}
main().catch((e) => console.error(e));
