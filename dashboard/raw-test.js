const https = require('https');
const A = '99927DD8A3562C02F3EEF55045F95419';
const S = 'dwbumt012186my4mu7ffqzji4a3vrfu5';

async function rawCall(label, path, headers, body) {
    return new Promise((r) => {
        const j = JSON.stringify(Object.assign({ lang: '_fr_FR' }, body));
        const h = Object.assign({ 'Content-Type': 'application/json;charset=UTF-8' }, headers);
        const req = https.request({ hostname: 'gateway.isolarcloud.com.hk', path, method: 'POST', headers: h }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => {
                console.log(label);
                console.log('  HTTP ' + res.statusCode + ' | Content-Type: ' + res.headers['content-type']);
                console.log('  ' + d.slice(0, 500));
                console.log('');
                r();
            });
        });
        req.write(j);
        req.end();
    });
}

async function main() {
    console.log('=== Raw HTTP responses for appkey ' + A.slice(0, 16) + '... ===\n');

    // Try the simplest possible: queryPowerStationList with OAuth2-style headers
    await rawCall(
        'A. /openapi/platform/queryPowerStationList (OAuth2 path, User creds)',
        '/openapi/platform/queryPowerStationList',
        { 'x-access-key': S, 'sys_code': '901' },
        { appkey: A, page: 1, size: 20 }
    );

    // Without the secret
    await rawCall(
        'B. Same without x-access-key',
        '/openapi/platform/queryPowerStationList',
        { 'sys_code': '901' },
        { appkey: A, page: 1, size: 20 }
    );

    // The /openapi/ path (non-platform) with token-like approach
    await rawCall(
        'C. /openapi/queryPowerStationList (non-platform)',
        '/openapi/queryPowerStationList',
        { 'x-access-key': S, 'sys_code': '901' },
        { appkey: A, page: 1, size: 20 }
    );

    // Load original OAuth2 creds from env
    const env = {};
    require('fs').readFileSync(require('path').join(__dirname, '..', '.env'), 'utf8').split('\n').forEach(l => {
        const m = l.match(/^([^#].*?)=(.*)$/);
        if (m) env[m[1].trim()] = m[2].trim();
    });
    const origAppkey = env.ISOLAR_APP_KEY;
    const origSecret = env.ISOLAR_APP_SECRET;
    
    await rawCall(
        'D. Original OAuth2 appkey (known working)',
        '/openapi/platform/queryPowerStationList',
        { 'x-access-key': origSecret, 'sys_code': '901' },
        { appkey: origAppkey, page: 1, size: 20 }
    );
}
main().catch((e) => console.error(e));
