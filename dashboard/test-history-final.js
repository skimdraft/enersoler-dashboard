#!/usr/bin/env node
/**
 * Test: getDevicePointDayMonthYearDataList
 * Uses extract.js pattern EXACTLY
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const D = __dirname;
const ENV_FILE = path.join(D, '..', '.env');
const TOKENS_FILE = path.join(D, 'isolar-tokens.json');

// EXACT copy of extract.js loadEnv
function loadEnv() {
    const env = {};
    if (fs.existsSync(ENV_FILE)) {
        fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(l => {
            const m = l.match(/^([^#].*?)=(.*)$/);
            if (m) env[m[1].trim()] = m[2].trim();
        });
    }
    return { appKey: env.ISOLAR_APP_KEY, appSecret: env.ISOLAR_APP_SECRET };
}

const { appKey, appSecret } = loadEnv();

// EXACT copy of extract.js apiCall
function apiCall(p, body, token) {
    return new Promise((resolve, reject) => {
        const j = JSON.stringify({ ...body, appkey: appKey, lang: '_fr_FR' });
        const headers = { 'Content-Type': 'application/json;charset=UTF-8', 'x-access-key': appSecret, 'sys_code': '901' };
        if (token) headers['Authorization'] = '*** ' + token;
        const req = https.request({ hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST', headers }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject({ code: 'PARSE', raw: d.slice(0, 200) }); } });
        });
        req.on('error', e => reject({ code: 'NET', msg: e.message }));
        req.write(j); req.end();
    });
}

// EXACT copy of extract.js loadTokens
function loadTokens() {
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch (e) { return null; }
}

// EXACT copy of extract.js getToken
async function getToken() {
    let t = loadTokens();
    if (!t?.accessToken) throw new Error('No tokens');
    if (Date.now() > t.expiresAt) {
        console.log('[AUTH] Refresh...');
        const r = await apiCall('/openapi/apiManage/refreshToken', { refresh_token: t.refreshToken });
        t = {
            accessToken: r.access_token || r.result_data?.access_token,
            refreshToken: r.refresh_token || r.result_data?.refresh_token || t.refreshToken,
            expiresAt: Date.now() + ((r.expires_in || 172800) * 1000) - 60000
        };
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
    }
    return t.accessToken;
}

async function main() {
    const token = await getToken();
    console.log('Token valid, making calls...\n');

    // 1. Plant list (verification)
    const plants = await apiCall('/openapi/platform/queryPowerStationList', { page: 1, size: 20 }, token);
    console.log('Plants: code=' + plants.result_code + ' count=' + (plants.result_data?.pageList?.length || 0));
    
    if (plants.result_code !== '1') {
        console.log('ERROR: ' + (plants.result_msg || plants.error || ''));
        process.exit(1);
    }
    for (const p of plants.result_data.pageList) {
        console.log('  ' + p.ps_name + ' (id=' + p.ps_id + ', status=' + (p.online_status === 1 ? 'ON' : 'OFF') + ')');
    }

    // 2. Device list for both plants
    const allDevices = {};
    for (const psId of ['1437035', '1425869']) {
        const r = await apiCall('/openapi/platform/getDeviceListByPsId', { ps_id: psId, page: 1, size: 50 }, token);
        if (r.result_code === '1') {
            allDevices[psId] = r.result_data.pageList;
            console.log('\n' + psId + ' devices:');
            for (const d of r.result_data.pageList) {
                console.log('  type=' + d.device_type + ' ps_key=' + d.ps_key + ' model=' + (d.device_model_name || d.device_model || '?'));
            }
        }
    }

    // 3. TEST: Historical data endpoint with INVERTER ps_keys
    console.log('\n═══ TEST: getDevicePointDayMonthYearDataList ═══');
    const histBody = {
        query_type: 'day',
        data_type: '2',
        ps_key_list: ['1437035_1_1_2', '1425869_1_1_1'],
        data_point: 'p1,p24,p14,p4',
        start_time: '20260706',
        end_time: '20260707',
        order: 0,
        is_get_point_dict: '1'
    };
    console.log('Request body: ' + JSON.stringify(histBody));

    const hist = await apiCall('/openapi/platform/getDevicePointDayMonthYearDataList', histBody, token);
    console.log('Response code: ' + hist.result_code);
    console.log('Response msg: ' + (hist.result_msg || hist.error || ''));
    
    if (hist.result_code === '1') {
        console.log('\n✅✅✅ HISTORICAL ENDPOINT WORKS! ✅✅✅');
        console.log('\nResult data keys: ' + Object.keys(hist.result_data || {}).join(', '));
        
        // Show point dictionary
        if (hist.result_data.point_dict) {
            console.log('\nPoint Dictionary:');
            for (const pd of hist.result_data.point_dict) {
                console.log('  p' + pd.point_id + ': ' + pd.point_name + ' (' + pd.point_unit + ')');
            }
        }

        // Show data per device per point
        console.log('\nData:');
        for (const [psKey, pointData] of Object.entries(hist.result_data)) {
            if (psKey === 'point_dict' || psKey === 'illegal_ps_key_list') continue;
            console.log('\n  Device ' + psKey + ':');
            for (const [pointKey, values] of Object.entries(pointData)) {
                console.log('    ' + pointKey + ': ' + JSON.stringify(values));
            }
        }
    } else {
        console.log('\n❌ Failed. Full response:');
        console.log(JSON.stringify(hist, null, 2).slice(0, 1000));
    }

    console.log('\nDone.');
}

main().catch(e => console.error('FATAL:', e));
