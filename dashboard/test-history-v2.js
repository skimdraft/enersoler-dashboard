#!/usr/bin/env node
/**
 * Test du nouveau format de requête historique (doc support)
 * Format: { query_type, is_get_point_dict, data_type, data_point, start_time, end_time, order, ps_key_list }
 */

const https = require('https');
const fs = require('fs');

const TOKENS_FILE = __dirname + '/isolar-tokens.json';
const ENV_FILE = __dirname + '/../.env';

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
const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));

// Our plant-level ps_keys
const PLANT_KEYS = ['1437035_11_0_0', '1425869_11_0_0'];

// Data points to try (from the doc example and common PV values)
// p13134, p13112, p13176, p13175 — need to map these
// Also try common point IDs in p-format
const DATA_POINTS = 'p2,p4,p14,p24'; // known working points in p-format

function call(hostname, path, body, authType) {
    return new Promise(resolve => {
        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-access-key': env.ISOLAR_APP_SECRET,
            'sys_code': '901',
        };

        if (authType === 'bearer') {
            headers['Authorization'] = 'Bearer ' + tokens.accessToken;
        } else if (authType === 'cookie' && tokens.accessToken) {
            headers['Cookie'] = 'access_token=' + tokens.accessToken;
        }

        const jsonBody = JSON.stringify(body);
        const req = https.request({
            hostname,
            path,
            method: 'POST',
            headers,
            rejectUnauthorized: false // allow self-signed
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                let parsed;
                try { parsed = JSON.parse(d); }
                catch (e) { parsed = { raw: d.slice(0, 500) }; }
                resolve({
                    status: res.statusCode,
                    hostname,
                    path,
                    authType,
                    body: parsed
                });
            });
        });
        req.on('error', e => resolve({ error: e.message, hostname, path, authType }));
        req.write(jsonBody);
        req.end();
    });
}

// The new query format from support documentation
function makeBody(queryType) {
    return {
        query_type: queryType || 'day',
        is_get_point_dict: '1',
        data_type: '2',
        data_point: DATA_POINTS,
        start_time: '20260706',
        end_time: '20260707',
        order: 0,
        ps_key_list: PLANT_KEYS,
    };
}

async function main() {
    console.log('═ Test nouveau format historique (doc support) ═\n');
    console.log('Plant ps_keys:', PLANT_KEYS.join(', '));
    console.log('Data points:', DATA_POINTS);
    console.log('');

    const hosts = [
        'gateway.isolarcloud.com.hk',
        'web3.isolarcloud.com.hk',
        'api.isolarcloud.com.hk',
    ];

    const paths = [
        // Try OpenAPI paths with new format
        '/openapi/platform/getDevicePointData',
        '/openapi/platform/queryDevicePowerCurve',
        '/openapi/platform/getDeviceDayData',
        '/openapi/platform/queryStationPowerData',
        '/openapi/platform/getPsPowerData',
        '/openapi/platform/getPsDayPower',
        // Try non-OpenAPI paths
        '/v1/device/point/data',
        '/v1/station/power/data',
        '/api/device/getPointData',
        '/api/station/getPowerData',
        '/api/data/query',
        '/api/history/query',
        // Internal paths
        '/iot/data/query',
        '/data/query',
    ];

    const authTypes = ['bearer', 'cookie', 'none'];

    const results = [];

    for (const host of hosts) {
        for (const p of paths) {
            for (const auth of authTypes) {
                const body = makeBody('day');
                const r = await call(host, p, body, auth);

                const status = r.status || 'ERR';
                const code = r.body?.result_code || r.body?.code || '';
                const msg = (r.body?.result_msg || r.body?.message || '').slice(0, 100);

                if (status === 200 && code === '1') {
                    console.log('✅✅✅ FOUND! ' + host + p + ' [' + auth + ']');
                    console.log(JSON.stringify(r.body, null, 2).slice(0, 1000));
                    console.log('');
                    results.push({ ok: true, ...r });
                } else if (status === 200 && code) {
                    console.log('  ❌ ' + host + p + ' [' + auth + '] → ' + code + ' ' + msg);
                } else if (status !== 200 && status !== 'ERR') {
                    console.log('  🔴 ' + host + p + ' [' + auth + '] → HTTP ' + status);
                } else {
                    // Skip logging errors to avoid noise
                }
            }
        }
    }

    // ─── Also try: maybe the format works with our existing getDeviceRealTimeData? ───
    console.log('\n═══ Trying with known working endpoint ═══');

    // Try the real-time endpoint with plant-level ps_keys
    const rtBody = {
        ps_key_list: PLANT_KEYS,
        point_id_list: ['2', '4', '14', '24'],
        device_type: 11, // try plant-level device type
        is_get_point_dict: '1'
    };

    const rt = await call('gateway.isolarcloud.com.hk',
        '/openapi/platform/getDeviceRealTimeData', rtBody, 'bearer');
    console.log('RT with plant ps_keys (type 11):', JSON.stringify(rt.body).slice(0, 300));

    // Try with device_type 1 (inverter) but plant ps_keys
    rtBody.device_type = 1;
    const rt2 = await call('gateway.isolarcloud.com.hk',
        '/openapi/platform/getDeviceRealTimeData', rtBody, 'bearer');
    console.log('RT with plant ps_keys (type 1):', JSON.stringify(rt2.body).slice(0, 300));

    // ─── Summary ───
    console.log('\n═══ Results ═══');
    const found = results.filter(r => r.ok);
    if (found.length > 0) {
        console.log('✅ SUCCESS — Found ' + found.length + ' working endpoint(s)!');
    } else {
        console.log('❌ No working endpoint found with this format.');
        console.log('\nPossible issues:');
        console.log('  1. Different hostname than tested');
        console.log('  2. Different authentication (session cookie, not OAuth2)');
        console.log('  3. Need appkey in body (the doc example lacks it)');
        console.log('  4. Different ps_key format for our plants');
    }
}

main().catch(e => console.error('FATAL:', e));
