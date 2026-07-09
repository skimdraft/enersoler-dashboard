#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');

const D = __dirname;
const ACC = 'dwbumt012186my4mu7ffqzji4a3vrfu5';
const st = JSON.parse(fs.readFileSync(D + '/isolar-nonoauth-tokens.json', 'utf8'));
const SESSION = st.accessToken;
const E = {};
fs.readFileSync(path.join(D, '..', '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^#].*?)=(.*)$/);
    if (m) E[m[1].trim()] = m[2].trim();
});
const AK = E.ISOLAR_APP_KEY;

function call(p, body, headers) {
    return new Promise(r => {
        const h = { 'Content-Type': 'application/json;charset=UTF-8', ...headers };
        const j = JSON.stringify({ ...body, appkey: AK, lang: '_fr_FR' });
        const req = https.request({
            hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST', headers: h
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { r(JSON.parse(d)); }
                catch (e) { r({ raw: d.slice(0, 200) }); }
            });
        });
        req.on('error', e => r({ error: e.message }));
        req.write(j);
        req.end();
    });
}

async function main() {
    console.log('Session token:', SESSION.slice(0, 20) + '...');

    const approaches = [
        { name: 'Token as x-access-key', h: { 'x-access-key': SESSION, 'sys_code': '901' } },
        { name: 'Token as Bearer + accessKey', h: { 'Authorization': '*** ' + SESSION, 'x-access-key': ACC, 'sys_code': '901' } },
        { name: 'Only x-access-key=ACC, no session', h: { 'x-access-key': ACC, 'sys_code': '901' } },
    ];

    let workingAuth = null;

    for (const a of approaches) {
        const r = await call('/openapi/platform/queryPowerStationList', { page: 1, size: 20 }, a.h);
        const code = r.result_code || r.error || 'N/A';
        const msg = (r.result_msg || r.error_description || '').slice(0, 80);
        console.log(a.name + ': ' + code + ' ' + msg);
        if (r.result_code === '1' && r.result_data?.pageList) {
            console.log('  ✅ WORKS! Plants:');
            for (const p of r.result_data.pageList) {
                console.log('    ' + p.ps_name + ' id=' + p.ps_id + ' status=' + p.online_status);
            }
            workingAuth = a.h;
            break;
        }
    }

    if (!workingAuth) {
        console.log('\n❌ No auth approach works. Need to re-authorize OAuth2.');
        process.exit(1);
    }

    // Get all devices
    console.log('\n=== ALL DEVICES ===');
    const plantIds = ['1437035', '1425869'];
    for (const psId of plantIds) {
        const r = await call('/openapi/platform/getDeviceListByPsId', { ps_id: psId, page: 1, size: 100 }, workingAuth);
        if (r.result_code === '1' && r.result_data?.pageList) {
            console.log('\nPlant ' + psId + ' (' + r.result_data.pageList.length + ' devices):');
            for (const dev of r.result_data.pageList) {
                console.log('  type=' + dev.device_type + ' | ps_key=' + dev.ps_key +
                    ' | model=' + (dev.device_model_name || dev.device_model || '?') +
                    ' | sn=' + (dev.device_sn || '?'));
            }
        } else {
            console.log('Plant ' + psId + ': ' + r.result_code + ' ' + r.result_msg);
        }
    }

    console.log('\nDone.');
}

main().catch(e => console.error(e));
