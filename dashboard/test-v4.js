#!/usr/bin/env node
/**
 * Test v4 — Session token + doc format on various paths
 */
const https = require('https');
const fs = require('fs');

const ENV_FILE = __dirname + '/../.env';
const NONOAUTH = __dirname + '/isolar-nonoauth-tokens.json';

const env = {}; fs.readFileSync(ENV_FILE,'utf8').split('\n').forEach(l=>{const m=l.match(/^([^#].*?)=(.*)$/);if(m)env[m[1].trim()]=m[2].trim();});
const sessionToken = JSON.parse(fs.readFileSync(NONOAUTH,'utf8')).accessToken;

const PLANT_KEYS = ['1437035_11_0_0', '1425869_11_0_0'];
const DEVICE_KEYS = ['1437035_1_1_2', '1425869_1_1_1'];

function call(host, path, body, headers={}) {
    return new Promise(resolve => {
        const h = { 'Content-Type': 'application/json;charset=UTF-8', ...headers };
        const j = JSON.stringify(body);
        const req = https.request({hostname:host, path, method:'POST', headers:h, rejectUnauthorized:false},
        res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve({s:res.statusCode,b:JSON.parse(d)})}catch(e){resolve({s:res.statusCode,raw:d.slice(0,500)})}});});
        req.on('error',e=>resolve({err:e.message}));
        req.write(j); req.end();
    });
}

async function main() {
    console.log('═ Test v4 — Session token auth ═');
    console.log('Token:', sessionToken.slice(0, 30) + '...\n');

    // The EXACT doc format — no appkey, no lang
    const docBody = {
        query_type: 'day',
        is_get_point_dict: '1',
        data_type: '2',
        data_point: 'p14,p24',
        start_time: '20260706',
        end_time: '20260707',
        order: 0,
        ps_key_list: PLANT_KEYS,
    };

    // Auth approaches to try
    const auths = [
        { name: 'Bearer session', h: { 'Authorization': 'Bearer ' + sessionToken } },
        { name: 'x-access-key session', h: { 'x-access-key': sessionToken } },
        { name: 'Token header', h: { 'token': sessionToken } },
        { name: 'Cookie token', h: { 'Cookie': 'token=' + sessionToken } },
        { name: 'Cookie JSESSIONID', h: { 'Cookie': 'JSESSIONID=' + sessionToken } },
        { name: 'sys_code only', h: { 'sys_code': '901' } },
        { name: 'x-access-key + sys_code', h: { 'x-access-key': env.ISOLAR_APP_SECRET, 'sys_code': '901' } },
    ];

    // Path patterns to try
    const paths = [
        '/openapi/device/queryPointData',
        '/openapi/device/getHistoryData', 
        '/openapi/data/queryHistory',
        '/openapi/data/queryByDay',
        '/openapi/data/getPointHistory',
        '/openapi/platform/getDevicePointMinute',
        '/openapi/platform/getDevicePointHour',
        '/openapi/platform/getDevicePointDay',
        '/openapi/platform/getDevicePointMonth',
        '/openapi/platform/getDevicePointYear',
        '/v1/device/queryPointData',
        '/v1/device/getHistoryData',
        '/v1/data/queryHistory',
        '/api/device/queryPointData',
        '/api/data/queryHistory',
    ];

    // With device-level ps_keys
    const deviceBody = { ...docBody, ps_key_list: DEVICE_KEYS };

    let foundAny = false;

    for (const p of paths) {
        for (const auth of auths) {
            // Try with plant keys
            const r1 = await call('gateway.isolarcloud.com.hk', p, docBody, auth.h);
            const code1 = r1.b?.result_code || r1.b?.code || '';
            if (r1.s === 200 && (code1 === '1' || (r1.b && !code1))) {
                console.log('✅✅✅ FOUND! gateway' + p + ' [' + auth.name + '] (plant keys)');
                console.log(JSON.stringify(r1.b,null,2).slice(0,800));
                foundAny = true;
            }

            // Try with device keys
            const r2 = await call('gateway.isolarcloud.com.hk', p, deviceBody, auth.h);
            const code2 = r2.b?.result_code || r2.b?.code || '';
            if (r2.s === 200 && (code2 === '1' || (r2.b && !code2))) {
                console.log('✅✅✅ FOUND! gateway' + p + ' [' + auth.name + '] (device keys)');
                console.log(JSON.stringify(r2.b,null,2).slice(0,800));
                foundAny = true;
            }
        }
    }

    if (!foundAny) {
        console.log('─── No hits on gateway. Testing web3 with session auth ───\n');

        // Try web3 with session token/cookie
        for (const p of paths) {
            for (const auth of auths) {
                const r = await call('web3.isolarcloud.com.hk', p, docBody, auth.h);
                const code = r.b?.result_code || r.b?.code || r.b?.error || '';
                const msg = (r.b?.result_msg || r.b?.message || '').slice(0,80);
                if (r.s !== 405) {
                    console.log('  web3' + p + ' [' + auth.name + '] → HTTP ' + r.s + ' ' + code + ' ' + msg);
                }
                if (r.s === 200 && r.b && (code === '1' || code === '0' || code === '')) {
                    console.log('  ✅ HAS DATA!');
                    console.log('  ' + JSON.stringify(r.b).slice(0, 500));
                    foundAny = true;
                }
            }
        }
    }

    // ─── Also: try without appkey on KNOWN working endpoint ───
    console.log('\n─── Real-time endpoint WITHOUT appkey ───');
    const rtBody = {
        ps_key_list: DEVICE_KEYS,
        point_id_list: ['24'],
        device_type: 1,
        is_get_point_dict: '1',
    };
    for (const auth of auths) {
        const r = await call('gateway.isolarcloud.com.hk', 
            '/openapi/platform/getDeviceRealTimeData', rtBody, auth.h);
        const code = r.b?.result_code || '';
        const msg = (r.b?.result_msg || '').slice(0,80);
        console.log('  [' + auth.name + '] → ' + code + ' ' + msg);
    }

    // ─── Summary ───
    console.log('\n═══ ' + (foundAny ? '✅ SOME WORKED!' : '❌ Nothing found') + ' ═══');
    if (!foundAny) {
        console.log('\nLe format de la doc ne correspond à aucun endpoint testé.');
        console.log('Options restantes :');
        console.log('  1. Demander au support l\'URL complète (pas juste le body)');
        console.log('  2. Inspecter les appels réseau de l\'interface web (F12 → Network)');
        console.log('  3. Vérifier si le format nécessite un hostname différent (Chine vs HK)');
        console.log('  4. Le ps_key de l\'exemple (700009960_14_1_1) est peut-être d\'un autre type');
    }
}
main().catch(e=>console.error(e));
