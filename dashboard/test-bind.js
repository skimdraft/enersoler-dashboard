const https = require('https');
const APPKEY = '99927D…5419';  
const SECRET = 'dwbumt…rfu5';

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
                    console.log(label + ': ' + p.result_code + ' ' + (p.result_msg || '') + (p.result_data ? ' | data: YES' : ''));
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
    console.log('=== Binding/authorization endpoints ===\n');

    // Possible bind/add endpoints
    const tests = [
        ['bindPs', '/openapi/bindPs', { appkey: APPKEY, ps_id: '1437035' }],
        ['bindPowerStation', '/openapi/bindPowerStation', { appkey: APPKEY, ps_id: '1437035' }],
        ['authorizePs', '/openapi/authorizePs', { appkey: APPKEY, ps_id: '1437035' }],
        ['addPs', '/openapi/addPs', { appkey: APPKEY, ps_id: '1437035' }],
        ['register', '/openapi/register', { appkey: APPKEY, ps_id: '1437035' }],
        ['apply', '/openapi/apply', { appkey: APPKEY, ps_id: '1437035' }],
        ['grant', '/openapi/grant', { appkey: APPKEY, ps_id: '1437035' }],
        ['psBind', '/openapi/psBind', { appkey: APPKEY, ps_id: '1437035' }],
        ['appBind', '/openapi/appBind', { appkey: APPKEY, ps_id: '1437035' }],
        ['activateApp', '/openapi/activateApp', { appkey: APPKEY }],
        ['appAuth', '/openapi/appAuth', { appkey: APPKEY, ps_id: '1437035' }],
    ];

    for (const [label, path, body] of tests) {
        await call(label, path, body);
    }
}
main().catch((e) => console.error(e));
