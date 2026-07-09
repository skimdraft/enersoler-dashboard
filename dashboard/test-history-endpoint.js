#!/usr/bin/env node
const https = require('https');
const fs = require('fs');
const path = require('path');

const D = path.join(__dirname);
const E = {};
fs.readFileSync(path.join(D, '..', '.env'), 'utf8').split('\n').forEach(l => {
    const m = l.match(/^([^#].*?)=(.*)$/);
    if (m) E[m[1].trim()] = m[2].trim();
});
const T = JSON.parse(fs.readFileSync(path.join(D, 'isolar-tokens.json'), 'utf8'));
const AK = E.ISOLAR_APP_KEY, AS = E.ISOLAR_APP_SECRET, TOK = T.accessToken;

function api(p, body) {
    return new Promise(r => {
        const h = {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-access-key': AS, 'sys_code': '901',
            'Authorization': '*** ' + TOK,
        };
        const j = JSON.stringify({ ...body, appkey: AK, lang: '_fr_FR' });
        const req = https.request({
            hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST', headers: h
        }, res => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => { try { r(JSON.parse(d)); } catch (e) { r({ raw: d.slice(0, 300) }); } });
        });
        req.on('error', e => r({ error: e.message }));
        req.write(j);
        req.end();
    });
}

async function main() {
    console.log('Token: ' + TOK.slice(0, 20) + '...\n');

    // Test 1: plant list
    console.log('=== Plant List ===');
    const pl = await api('/openapi/platform/queryPowerStationList', { page: 1, size: 20 });
    if (pl.result_code === '1') {
        for (const p of pl.result_data.pageList) console.log('  ' + p.ps_name + ' id=' + p.ps_id + ' status=' + (p.online_status === 1 ? 'ONLINE' : 'OFFLINE'));
    } else {
        console.log('  FAILED: ' + pl.result_code + ' ' + (pl.result_msg || pl.error || ''));
        return;
    }

    // Test 2: New plant 1681344
    console.log('\n=== Plant 1681344 ===');
    const dt = await api('/openapi/platform/getPowerStationDetail', { ps_ids: '1681344' });
    if (dt.result_code === '1' && dt.result_data?.data_list) {
        const d = dt.result_data.data_list[0];
        console.log('  Name: ' + d.ps_name);
        console.log('  Capacity: ' + d.install_power + ' W');
        console.log('  ps_key: ' + d.ps_key);
        console.log('  Install: ' + d.install_date);
    } else {
        console.log('  No detail: ' + dt.result_code);
    }

    // Test 3: Devices for 1681344
    console.log('\n=== Devices 1681344 ===');
    const dv = await api('/openapi/platform/getDeviceListByPsId', { ps_id: '1681344', page: 1, size: 50 });
    if (dv.result_code === '1' && dv.result_data?.pageList) {
        for (const d of dv.result_data.pageList) {
            console.log('  type=' + d.device_type + ' ps_key=' + d.ps_key + ' model=' + (d.device_model_name || d.device_model || '?'));
        }
    } else {
        console.log('  No devices');
    }

    // Test 4: HISTORICAL DATA ENDPOINT
    console.log('\n=== TEST: getDevicePointDayMonthYearDataList ===');
    const hist = await api('/openapi/platform/getDevicePointDayMonthYearDataList', {
        query_type: 'day',
        data_type: '2',
        ps_key_list: ['1437035_1_1_2', '1425869_1_1_1'],
        data_point: 'p1,p24,p14',
        start_time: '20260706',
        end_time: '20260707',
        order: 0,
        is_get_point_dict: '1'
    });
    console.log('code=' + hist.result_code + ' msg=' + (hist.result_msg || hist.error || ''));
    if (hist.result_code === '1') {
        console.log('✅ HISTORICAL DATA WORKS!');
        console.log(JSON.stringify(hist.result_data, null, 2).slice(0, 2000));
    } else {
        console.log('Full response: ' + JSON.stringify(hist).slice(0, 500));
    }

    // Test 5: Also try with plant-level ps_keys (device_type 14 as in doc example)
    console.log('\n=== TEST: with plant ps_keys ===');
    const hist2 = await api('/openapi/platform/getDevicePointDayMonthYearDataList', {
        query_type: 'day',
        data_type: '2',
        ps_key_list: ['1437035_11_0_0', '1425869_11_0_0'],
        data_point: 'p1,p24',
        start_time: '20260706',
        end_time: '20260707',
        order: 0,
        is_get_point_dict: '1'
    });
    console.log('plant keys: code=' + hist2.result_code + ' msg=' + (hist2.result_msg || hist2.error || ''));
    if (hist2.result_code === '1') {
        console.log('✅ Plant keys work!');
        console.log(JSON.stringify(hist2.result_data, null, 2).slice(0, 1000));
    }
}

main().catch(e => console.error(e));
