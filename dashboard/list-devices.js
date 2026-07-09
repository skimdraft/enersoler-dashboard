#!/usr/bin/env node
/**
 * Quick script: refresh token + list ALL devices for both plants
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const D = __dirname;
const ENV = {};
fs.readFileSync(path.join(D, '..', '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^#].*?)=(.*)$/);
    if (m) ENV[m[1].trim()] = m[2].trim();
});
const AK = ENV.ISOLAR_APP_KEY;
const AS = ENV.ISOLAR_APP_SECRET;
const TOKENS_FILE = path.join(D, 'isolar-tokens.json');

function loadTokens() {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
}

function api(p, body, token) {
    return new Promise(r => {
        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-access-key': AS,
            'sys_code': '901',
            'Authorization': '*** ' + token,
        };
        const j = JSON.stringify({ ...body, appkey: AK, lang: '_fr_FR' });
        const req = https.request({
            hostname: 'gateway.isolarcloud.com.hk',
            path: p, method: 'POST', headers
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({ raw: d.slice(0, 200) }); } });
        });
        req.on('error', e => r({ error: e.message }));
        req.write(j);
        req.end();
    });
}

async function main() {
    // Refresh token
    let t = loadTokens();
    console.log('Current token expires:', new Date(t.expiresAt).toISOString());
    
    if (Date.now() > t.expiresAt - 300000) {
        console.log('Refreshing token...');
        const r = await api('/openapi/apiManage/refreshToken', { refresh_token: t.refreshToken }, t.accessToken);
        console.log('Refresh response code:', r.result_code);
        if (r.access_token || r.result_data?.access_token) {
            t.accessToken = r.access_token || r.result_data.access_token;
            t.refreshToken = r.refresh_token || r.result_data.refresh_token || t.refreshToken;
            t.expiresAt = Date.now() + ((r.expires_in || r.result_data?.expires_in || 172800) * 1000) - 60000;
            fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
            console.log('New token saved. Expires:', new Date(t.expiresAt).toISOString());
        }
    }

    const token = t.accessToken;

    // Get plant list
    console.log('\n=== Plant List ===');
    const plants = await api('/openapi/platform/queryPowerStationList', { page: 1, size: 20 }, token);
    if (plants.result_code === '1') {
        for (const p of plants.result_data.pageList) {
            console.log(p.ps_name + ' (id=' + p.ps_id + ') status=' + p.online_status);
        }
    } else {
        console.log('FAILED:', plants.result_code, plants.result_msg);
        return;
    }

    // Get ALL devices for each plant
    for (const psId of ['1437035', '1425869']) {
        console.log('\n=== ALL Devices for plant ' + psId + ' ===');
        const r = await api('/openapi/platform/getDeviceListByPsId', { ps_id: psId, page: 1, size: 100 }, token);
        if (r.result_code === '1' && r.result_data?.pageList) {
            console.log('Found ' + r.result_data.pageList.length + ' device(s):');
            for (const d of r.result_data.pageList) {
                // Dump ALL fields
                console.log('  ---');
                for (const [k, v] of Object.entries(d)) {
                    if (v !== null && v !== undefined && v !== '') {
                        console.log('    ' + k + ': ' + JSON.stringify(v));
                    }
                }
            }
        } else {
            console.log('Error: ' + r.result_code + ' ' + r.result_msg);
        }
    }

    // Also test: try getDeviceRealTimeData with plant ps_key as device_type 11 or 14
    console.log('\n=== Testing plant-level ps_keys ===');
    const plantKeys = ['1437035_11_0_0', '1425869_11_0_0'];
    
    for (const dtype of [1, 11, 14, 15, 22]) {
        const r = await api('/openapi/platform/getDeviceRealTimeData', {
            ps_key_list: plantKeys,
            point_id_list: ['24', '2', '4', '14'],
            device_type: dtype,
            is_get_point_dict: '1'
        }, token);
        console.log('  device_type=' + dtype + ': ' + r.result_code + ' ' + (r.result_msg || '') + ' data=' + (r.result_data ? 'YES' : 'NO'));
        if (r.result_code === '1') {
            console.log('    ' + JSON.stringify(r.result_data).slice(0, 500));
        }
    }

    // Also test with device-level ps_keys as device_type 14
    console.log('\n=== Testing inverter ps_keys as device_type 14 ===');
    const devKeys = ['1437035_1_1_2', '1425869_1_1_1'];
    const r14 = await api('/openapi/platform/getDeviceRealTimeData', {
        ps_key_list: devKeys,
        point_id_list: ['24', '2', '4', '14'],
        device_type: 14,
        is_get_point_dict: '1'
    }, token);
    console.log('  device_type=14 (inverter keys): ' + r14.result_code + ' ' + (r14.result_msg || ''));
    if (r14.result_code === '1') {
        console.log('    ' + JSON.stringify(r14.result_data).slice(0, 500));
    }

    console.log('\nDone.');
}

main().catch(e => console.error('FATAL:', e));
