#!/usr/bin/env node
/**
 * Test v3 — with appkey, and web3 internal API paths
 */
const https = require('https');
const fs = require('fs');

const TOKENS_FILE = __dirname + '/isolar-tokens.json';
const ENV_FILE = __dirname + '/../.env';

const env = {}; fs.readFileSync(ENV_FILE,'utf8').split('\n').forEach(l=>{const m=l.match(/^([^#].*?)=(.*)$/);if(m)env[m[1].trim()]=m[2].trim();});
const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE,'utf8'));

const PLANT_KEYS = ['1437035_11_0_0', '1425869_11_0_0'];

function callPost(host, path, body, extraHeaders={}) {
    return new Promise(resolve => {
        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-access-key': env.ISOLAR_APP_SECRET,
            'sys_code': '901',
            ...extraHeaders,
        };
        if (tokens.accessToken) headers['Authorization'] = 'Bearer ' + tokens.accessToken;

        const jsonBody = JSON.stringify(body);
        const req = https.request({hostname:host, path, method:'POST', headers, rejectUnauthorized:false},
        res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve({s:res.statusCode,b:JSON.parse(d)})}catch(e){resolve({s:res.statusCode,raw:d.slice(0,500)})}});});
        req.on('error',e=>resolve({err:e.message}));
        req.write(jsonBody); req.end();
    });
}

function callGet(host, path, extraHeaders={}) {
    return new Promise(resolve => {
        const headers = { ...extraHeaders };
        const req = https.request({hostname:host, path, method:'GET', headers, rejectUnauthorized:false},
        res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>{try{resolve({s:res.statusCode,b:JSON.parse(d)})}catch(e){resolve({s:res.statusCode,raw:d.slice(0,500)})}});});
        req.on('error',e=>resolve({err:e.message}));
        req.end();
    });
}

async function main() {
    console.log('═ Test v3 — with appkey + web3 internal paths ═\n');

    // ─── 1. Gateway WITH appkey ───
    console.log('─── Gateway WITH appkey ───');
    const paths = [
        '/openapi/platform/getPsDayPower',
        '/openapi/platform/queryStationPowerData',
        '/openapi/platform/getStationEnergy',
        '/openapi/platform/getPlantPowerByDay',
    ];

    for (const p of paths) {
        // Try with appkey added
        const bodyWithAppkey = {
            appkey: env.ISOLAR_APP_KEY,
            lang: '_fr_FR',
            query_type: 'day',
            is_get_point_dict: '1',
            data_type: '2',
            data_point: 'p14,p24',
            start_time: '20260706',
            end_time: '20260707',
            order: 0,
            ps_key_list: PLANT_KEYS,
        };

        const r = await callPost('gateway.isolarcloud.com.hk', p, bodyWithAppkey);
        const msg = r.raw || (r.b?.result_msg || r.b?.message || '');
        const code = r.b?.result_code || r.b?.code || '';
        console.log(`  ${code} | ${p} → ${String(msg).slice(0,120)}`);
    }

    // ─── 2. web3 with GET (internal API) ───
    console.log('\n─── web3.isolarcloud.com.hk GET ───');
    const web3Paths = [
        '/',
        '/api/',
        '/v1/',
        '/iot/',
        '/data/',
        '/api/v1/',
    ];
    for (const p of web3Paths) {
        const r = await callGet('web3.isolarcloud.com.hk', p);
        console.log(`  HTTP ${r.s} | ${p} → ${(r.raw||'').slice(0,100)}`);
    }

    // ─── 3. web3 with POST (various paths) ───
    console.log('\n─── web3.isolarcloud.com.hk POST ───');
    const dataBody = {
        query_type: 'day',
        is_get_point_dict: '1',
        data_type: '2',
        data_point: 'p14,p24',
        start_time: '20260706',
        end_time: '20260707',
        order: 0,
        ps_key_list: [PLANT_KEYS[0]], // just one plant to test
    };

    const web3postPaths = [
        '/api/query',
        '/api/data',
        '/v1/data',
        '/iot/query',
        '/query',
        '/data',
        '/api/data/query',
        '/api/v1/data/query',
    ];
    for (const p of web3postPaths) {
        const r = await callPost('web3.isolarcloud.com.hk', p, dataBody, {
            'x-access-key': undefined, // don't send this
            'sys_code': undefined,
            'Authorization': undefined,
        });
        const msg = r.raw || (r.b?.msg || r.b?.message || JSON.stringify(r.b||{}));
        console.log(`  HTTP ${r.s} | ${p} → ${String(msg).slice(0,100)}`);
    }

    // ─── 4. Try with the EXACT format from doc, on various gateways ───
    console.log('\n─── Exact doc format on different hosts ───');
    const docBody = {
        query_type: 'day',
        is_get_point_dict: '1',
        data_type: '2',
        data_point: 'p13134,p13112,p13176,p13175',
        start_time: '20240823',
        end_time: '20240825',
        order: 0,
        ps_key_list: ['700009960_14_1_1', '700009960_14_3_1'],
    };

    const hosts = [
        { host: 'gateway.isolarcloud.com.hk', path: '/openapi/v1/query' },
        { host: 'gateway.isolarcloud.com.hk', path: '/openapi/platform/queryData' },
        { host: 'web3.isolarcloud.com.hk', path: '/api/query' },
        { host: 'web3.isolarcloud.com.hk', path: '/api/v1/query' },
        { host: 'web3.isolarcloud.com.hk', path: '/api/data/query' },
    ];

    for (const {host, path} of hosts) {
        // without auth
        const r1 = await callPost(host, path, docBody, {Authorization:undefined,'sys_code':undefined,'x-access-key':undefined});
        console.log(`  ${host}${path} (no auth) → HTTP ${r1.s} ${(r1.raw||'').slice(0,100)}`);

        // with bearer
        const r2 = await callPost(host, path, docBody);
        console.log(`  ${host}${path} (bearer) → HTTP ${r2.s} ${(r2.raw||'').slice(0,100)}`);
    }

    console.log('\nDone.');
}
main().catch(e=>console.error(e));
