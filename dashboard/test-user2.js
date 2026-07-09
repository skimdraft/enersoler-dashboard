const https = require('https');
const A = '99927DD8A3562C02F3EEF55045F95419';
const S = 'dwbumt012186my4mu7ffqzji4a3vrfu5';

function call(label, headers, body) {
    return new Promise((resolve) => {
        const j = JSON.stringify(Object.assign({ lang: '_fr_FR' }, body));
        const h = Object.assign({ 'Content-Type': 'application/json;charset=UTF-8' }, headers);
        const req = https.request({
            hostname: 'gateway.isolarcloud.com.hk',
            path: '/openapi/platform/queryPowerStationList',
            method: 'POST',
            headers: h,
        }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    const hasData = p.result_data ? 'YES' : 'NO';
                    console.log(label + ': ' + p.result_code + ' ' + (p.result_msg || '') + ' | data:' + hasData);
                } catch (e) {
                    console.log(label + ': PARSE ERROR - ' + d.slice(0, 200));
                }
                resolve();
            });
        });
        req.write(j);
        req.end();
    });
}

async function main() {
    console.log('=== iSolarCloud User API auth patterns ===\n');

    // Pattern 0: Same as OAuth2
    await call('0. OAuth2 style', { 'x-access-key': S, 'sys_code': '901' }, { appkey: A, page: 1, size: 20 });

    // Pattern 1: appkey in header too
    await call('1. appkey header', { appkey: A, 'x-access-key': S, 'sys_code': '901' }, { page: 1, size: 20 });

    // Pattern 2: No appkey in body
    await call('2. no appkey body', { 'x-access-key': S, 'sys_code': '901' }, { page: 1, size: 20 });

    // Pattern 3: No sys_code
    await call('3. no sys_code', { 'x-access-key': S }, { appkey: A, page: 1, size: 20 });

    // Pattern 4: different header names
    await call('4. x-app-key', { 'x-app-key': A, 'x-app-secret': S, 'sys_code': '901' }, { page: 1, size: 20 });

    // Pattern 5: appkey as query param style
    await call('5. appkey url', { 'x-access-key': S }, { appkey: A, page: 1, size: 20, sys_code: '901' });

    // Pattern 6: Check if it's a domain issue
    await call('6. try .com', { 'x-access-key': S, 'sys_code': '901' }, { appkey: A, page: 1, size: 20 });
}
main().catch((e) => console.error(e));
