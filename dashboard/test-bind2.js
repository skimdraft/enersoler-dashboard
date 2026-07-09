const https = require('https');
const fs = require('fs');
const creds = JSON.parse(fs.readFileSync(__dirname + '/user-creds.json', 'utf8'));
const APPKEY = creds.appkey;
const SECRET = creds.secret;

async function call(label, path, body) {
    return new Promise((r) => {
        const j = JSON.stringify(Object.assign({ lang: '_fr_FR' }, body));
        const q = https.request({
            hostname: 'gateway.isolarcloud.com.hk', path, method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-access-key': SECRET, 'sys_code': '901' },
        }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => {
                try {
                    const p = JSON.parse(d);
                    const code = p.result_code || p.error || '?';
                    const msg = (p.result_msg || p.error_description || '').slice(0, 80);
                    const data = p.result_data ? 'YES' : 'NO';
                    console.log(label + ': ' + code + ' ' + msg + ' | data:' + data);
                    if (code === '1') console.log('  ✅ ' + JSON.stringify(p).slice(0, 300));
                } catch (e) {
                    console.log(label + ': RAW ' + d.slice(0, 200));
                }
                r();
            });
        });
        q.write(j);
        q.end();
    });
}

async function main() {
    // Also try adding the app to the DEV portal domain
    console.log('appkey: ' + APPKEY.slice(0, 16) + '...\n');

    const tests = [
        ['bindPs', '/openapi/bindPs', { appkey: APPKEY, ps_id: '1437035' }],
        ['bindPowerStation', '/openapi/bindPowerStation', { appkey: APPKEY, ps_id: '1437035' }],
        ['addPs', '/openapi/addPs', { appkey: APPKEY, ps_id: '1437035' }],
        ['applyAuth', '/openapi/applyAuth', { appkey: APPKEY, ps_id: '1437035' }],
        ['registerApp', '/openapi/registerApp', { appkey: APPKEY, ps_id: '1437035' }],
        // Maybe it needs the original appkey to grant access
        ['exchangeToken', '/openapi/exchangeToken', { appkey: APPKEY, secret: SECRET }],
        ['getAppToken', '/openapi/getAppToken', { appkey: APPKEY }],
    ];

    for (const [label, path, body] of tests) {
        await call(label, path, body);
    }
}
main().catch((e) => console.error(e));
