#!/usr/bin/env node
/**
 * Quick probe: try all HMAC signing + auth patterns for non-OAuth2 plant list
 */
const https = require('https');
const crypto = require('crypto');

const APPKEY = '99927DD8A3562C02F3EEF55045F95419';
const ACCESSKEY = 'dwbumt012186my4mu7ffqzji4a3vrfu5';
const HOST = 'gateway.isolarcloud.com.hk';

function post(path, body, headers) {
    return new Promise(r => {
        const j = JSON.stringify(body);
        const h = Object.assign({ 'Content-Type': 'application/json;charset=UTF-8' }, headers);
        const req = https.request({ hostname: HOST, path, method: 'POST', headers: h }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => {
                try { r({ http: res.statusCode, ...JSON.parse(d) }); }
                catch (e) { r({ http: res.statusCode, raw: d.slice(0, 500) }); }
            });
        });
        req.write(j); req.end();
    });
}

const ts = String(Math.floor(Date.now() / 1000));

async function main() {
    console.log('=== Non-OAuth2 Auth Probe ===\n');

    // ── HMAC-MD5 variants ──
    // Pattern A: MD5(appkey + ts + accesskey)
    const signA = crypto.createHash('md5').update(APPKEY + ts + ACCESSKEY).digest('hex');
    const rA = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', ts, sign: signA, page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('A. MD5(appkey+ts+key) sign in body:', rA.result_code, rA.result_msg || '');

    // Pattern B: MD5(sorted params + key) — URL-style sign
    const paramsB = `appkey=${APPKEY}&lang=_fr_FR&page=1&size=20&sys_code=901&ts=${ts}`;
    const signB = crypto.createHash('md5').update(paramsB + ACCESSKEY).digest('hex').toUpperCase();
    const rB = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20, sys_code: '901', ts, sign: signB });
    console.log('B. MD5(sorted_params+key) sign in body:', rB.result_code, rB.result_msg || '');

    // Pattern C: HMAC-MD5(key, body_json)
    const bodyC = JSON.stringify({ appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 });
    const signC = crypto.createHmac('md5', ACCESSKEY).update(bodyC).digest('hex');
    const rC = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20, sign: signC },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('C. HMAC-MD5(body) sign in body:', rC.result_code, rC.result_msg || '');

    // Pattern D: sign in header, ts in header
    const paramsD = JSON.stringify({ appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 });
    const signD = crypto.createHmac('md5', ACCESSKEY).update(paramsD).digest('hex');
    const rD = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, 'x-sign': signD, 'x-ts': ts, sys_code: '901' });
    console.log('D. HMAC in header:', rD.result_code, rD.result_msg || '');

    // Pattern E: SHA256(appkey+ts+key)
    const signE = crypto.createHash('sha256').update(APPKEY + ts + ACCESSKEY).digest('hex');
    const rE = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', ts, sign: signE, page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('E. SHA256(appkey+ts+key):', rE.result_code, rE.result_msg || '');

    // Pattern F: No sign, just access key as x-access-key (the simplest)
    const rF = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('F. x-access-key only:', JSON.stringify(rF).slice(0, 400));

    // Pattern G: access key as x-access-key, appkey in body only
    const rG = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('G. access key + appkey (minimal):', JSON.stringify(rG).slice(0, 400));

    // Pattern A raw
    const rAraw = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', ts, sign: signA, page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('A-raw. MD5(appkey+ts+key):', JSON.stringify(rAraw).slice(0, 400));

    // ── Try different endpoints ──
    console.log('');
    // Pattern H: Same as F but on /v1/ path
    const rH = await post('/v1/platform/queryPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('H. /v1/platform/ with access key:', rH.result_code || rH.http, rH.result_msg || rH.raw || '');

    // Pattern I: /openapi/ (non-platform) path
    const rI = await post('/openapi/queryPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('I. /openapi/queryPowerStationList:', rI.result_code, rI.result_msg || '');

    // Pattern J: Try getPowerStationList (different endpoint name)
    const rJ = await post('/openapi/platform/getPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('J. getPowerStationList:', rJ.result_code, rJ.result_msg || '');

    // Pattern K: List format
    const rK = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', pageNo: 1, pageSize: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('K. pageNo/pageSize:', rK.result_code, rK.result_msg || '');

    // ── Also try OAuth2 appkey with non-OAuth2 access key ──
    console.log('');
    const OAUTH2_APPKEY = '81813B1B563074A483C44E60DE9A7EAA';
    const rL = await post('/openapi/platform/queryPowerStationList',
        { appkey: OAUTH2_APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('L. OAuth2 appkey + non-OAuth2 accesskey:', rL.result_code, rL.result_msg || '');

    const rM = await post('/openapi/platform/queryPowerStationList',
        { appkey: OAUTH2_APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901', 'Authorization': 'Bearer 03dd373dc6dd43eab87d2fa9fcf6d5eb' });
    console.log('M. OAuth2 appkey + OAuth2 token:', rM.result_code, rM.result_msg || '');

    // N: standalone with only token (no x-access-key)
    const rN = await post('/openapi/platform/queryPowerStationList',
        { appkey: OAUTH2_APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 },
        { 'Authorization': 'Bearer 03dd373dc6dd43eab87d2fa9fcf6d5eb', sys_code: '901' });
    console.log('N. OAuth2 token only (no x-access-key):', rN.result_code, rN.result_msg || '');
}
main().catch(e => console.error(e));
