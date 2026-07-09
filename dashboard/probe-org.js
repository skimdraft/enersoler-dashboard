#!/usr/bin/env node
/**
 * Probe 3: Use the WORKING OAuth2 flow to explore org/plant structure
 * Goal: understand why only 2 of 10 plants are visible
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_FILE = path.join(__dirname, '..', '.env');
const TOKENS_FILE = path.join(__dirname, 'isolar-tokens.json');

const env = {};
fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^#].*?)=(.*)$/);
    if (m) env[m[1].trim()] = m[2].trim();
});

const OAUTH2_APPKEY = env.ISOLAR_APP_KEY;
const OAUTH2_SECRET = env.ISOLAR_APP_SECRET;
let tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
const HOST = 'gateway.isolarcloud.com.hk';

function post(path, body, headers) {
    return new Promise(r => {
        const j = JSON.stringify(body);
        const h = Object.assign({ 'Content-Type': 'application/json;charset=UTF-8' }, headers);
        const req = https.request({ hostname: HOST, path, method: 'POST', headers: h }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => {
                try { r(JSON.parse(d)); } catch (e) { r({ raw: d.slice(0, 500) }); }
            });
        });
        req.write(j); req.end();
    });
}

async function call(path, body) {
    return post(path, { ...body, appkey: OAUTH2_APPKEY, lang: '_fr_FR' }, {
        'x-access-key': OAUTH2_SECRET,
        'Authorization': 'Bearer ' + tokens.accessToken,
        sys_code: '901',
    });
}

async function main() {
    console.log('=== OAuth2 Org/Plant Discovery ===\n');
    console.log('Token expires:', new Date(tokens.expiresAt).toISOString());

    // 1) List all plants via OAuth2 (should show 2)
    console.log('\n[1] Plant list via OAuth2...');
    const r1 = await call('/openapi/platform/queryPowerStationList', { page: 1, size: 50 });
    if (r1.result_code === '1') {
        const plants = r1.result_data.pageList || r1.result_data;
        console.log('  Found:', plants.length, 'plants');
        for (const p of plants) {
            console.log('  -', p.ps_name, '(' + p.ps_id + ')', p.ps_capacity || '?', 'kWp',
                '| status:', p.online_status, '| org:', p.org_id);
        }
    } else {
        console.log('  Error:', r1.result_msg);
    }

    // 2) Get user/org info
    console.log('\n[2] User/org info...');
    const r2 = await call('/openapi/platform/getUserInfo', {});
    console.log('  ', JSON.stringify(r2).slice(0, 500));

    // 3) Try to list all orgs
    console.log('\n[3] Org list...');
    const r3 = await call('/openapi/platform/getOrgList', {});
    console.log('  ', JSON.stringify(r3).slice(0, 500));

    // 4) Get plant detail for the two known plants
    console.log('\n[4] Plant details...');
    for (const id of ['1437035', '1425869']) {
        const r4 = await call('/openapi/platform/getPowerStationDetail', { ps_ids: id });
        if (r4.result_code === '1') {
            const d = r4.result_data.data_list?.[0] || r4.result_data;
            console.log('  ' + d.ps_name + ':');
            console.log('    org_id:', d.org_id);
            console.log('    site_id:', d.site_id);
            console.log('    area_id:', d.area_id);
            console.log('    owner_id:', d.owner_id);
            console.log('    installer_id:', d.installer_id);
            console.log('    ps_type:', d.ps_type);
            console.log('    cloud_id:', d.cloud_id);
            console.log('    share_type:', d.share_type);
        }
    }

    // 5) Try to get device list per plant
    console.log('\n[5] Device lists...');
    for (const id of ['1437035', '1425869']) {
        const r5 = await call('/openapi/platform/getDeviceListByPsId', { ps_id: id, page: 1, size: 50 });
        if (r5.result_code === '1') {
            const devices = r5.result_data.pageList || [];
            console.log('  Plant ' + id + ': ' + devices.length + ' devices');
            for (const d of devices) {
                console.log('    -', d.dev_name || d.device_name, '| type:', d.dev_type || d.device_type,
                    '| model:', d.dev_model || d.device_model, '| sn:', d.dev_sn || d.serial_number);
            }
        }
    }

    // 6) Try to list all plants including shared ones
    console.log('\n[6] Try shared/other plant queries...');
    
    // 6a: Try with different org/site
    const r6a = await call('/openapi/platform/queryPowerStationList', { page: 1, size: 50, org_id: '', site_id: '' });
    if (r6a.result_code === '1') {
        const plants = r6a.result_data.pageList || [];
        console.log('  6a. empty org/site filter:', plants.length, 'plants');
    } else {
        console.log('  6a.', r6a.result_msg);
    }

    // 6b: Try to get station count
    const r6b = await call('/openapi/platform/getStationCount', {});
    console.log('  6b. Station count:', JSON.stringify(r6b).slice(0, 300));

    // 6c: Try getOwnerStationList
    const r6c = await call('/openapi/platform/getOwnerStationList', { page: 1, size: 50 });
    console.log('  6c. Owner station list:', JSON.stringify(r6c).slice(0, 300));

    // 7) Try REAL-TIME data for the known plants
    console.log('\n[7] Real-time data test...');
    const r7 = await call('/openapi/platform/getDeviceRealTimeData', {
        ps_key_list: ['1437035_1_1_2', '1425869_1_1_2'],
        point_id_list: ['10001', '10002', '10003', '10004', '10005', '10006', '10007', '10008', '10009', '10011', '10012', '10013', '10081'],
        device_type: 1,
        is_get_point_dict: '1',
    });
    if (r7.result_code === '1') {
        console.log('  ✅ Realtime data received!');
        const data = r7.result_data;
        
        // Print point dictionary to identify available measurements
        if (data.point_dict) {
            console.log('\n  Point dictionary:');
            for (const [pid, info] of Object.entries(data.point_dict)) {
                console.log('    ' + pid + ' = ' + info.point_name + ' [' + info.point_unit + ']');
            }
        }
        
        // Print actual values
        if (data.data) {
            console.log('\n  Values per plant:');
            for (const [psKey, devs] of Object.entries(data.data)) {
                const psId = psKey.split('_')[0];
                console.log('    Plant ' + psId + ':');
                for (const [devKey, points] of Object.entries(devs)) {
                    console.log('      Device ' + devKey + ':');
                    for (const [pid, val] of Object.entries(points)) {
                        const info = data.point_dict?.[pid];
                        const name = info?.point_name || pid;
                        const unit = info?.point_unit || '';
                        console.log('        ' + name + ' = ' + val + ' ' + unit);
                    }
                }
            }
        }
    } else {
        console.log('  ❌', r7.result_msg);
    }

    // 8) Also try with the FULL list of point IDs (comprehensive)
    console.log('\n[8] Comprehensive real-time query...');
    // Try all common point IDs 1-200
    const allPointIds = [];
    for (let i = 1; i <= 200; i++) {
        allPointIds.push(String(i).padStart(5, '0'));
    }
    const r8 = await call('/openapi/platform/getDeviceRealTimeData', {
        ps_key_list: ['1437035_1_1_2'],
        point_id_list: allPointIds,
        device_type: 1,
        is_get_point_dict: '1',
    });
    if (r8.result_code === '1' && r8.result_data?.point_dict) {
        console.log('  Available points for device type 1:');
        for (const [pid, info] of Object.entries(r8.result_data.point_dict)) {
            console.log('    ' + pid + ' = ' + info.point_name + ' [' + info.point_unit + ']');
        }
    } else {
        console.log('  ' + (r8.result_msg || 'OK but no dict'));
    }
}
main().catch(e => console.error('FATAL:', e));
