/**
 * iSolarCloud User API — HMAC signature attempt
 * Many Sungrow/iSolarCloud APIs use parameter-based HMAC-MD5 signing
 */
const https = require('https');
const crypto = require('crypto');

const APPKEY = '99927DD8A3562C02F3EEF55045F95419';
const SECRET = 'dwbumt012186my4mu7ffqzji4a3vrfu5';
const HOST = 'gateway.isolarcloud.com.hk';

function httpPost(path, body, headers) {
    return new Promise((resolve) => {
        const j = JSON.stringify(body);
        const h = Object.assign({ 'Content-Type': 'application/json;charset=UTF-8' }, headers);
        const req = https.request({ hostname: HOST, path, method: 'POST', headers: h }, (res) => {
            let d = '';
            res.on('data', (c) => (d += c));
            res.on('end', () => {
                try { resolve({ http: res.statusCode, ...JSON.parse(d) }); }
                catch (e) { resolve({ http: res.statusCode, raw: d.slice(0, 400) }); }
            });
        });
        req.write(j);
        req.end();
    });
}

async function main() {
    console.log('=== HMAC Signature Patterns ===\n');

    const ts = String(Math.floor(Date.now() / 1000));
    const baseParams = { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', ts };

    // Pattern 1: MD5(appkey + ts + secret) as sign param
    const sign1 = crypto.createHash('md5').update(APPKEY + ts + SECRET).digest('hex');
    let r1 = await httpPost('/openapi/queryPowerStationList', { ...baseParams, sign: sign1, page: 1, size: 20 }, { 'sys_code': '901' });
    console.log('1. MD5(appkey+ts+secret):', r1.result_code, r1.result_msg || r1.raw || '');

    // Pattern 2: SHA256(appkey + ts + secret)
    const sign2 = crypto.createHash('sha256').update(APPKEY + ts + SECRET).digest('hex');
    let r2 = await httpPost('/openapi/queryPowerStationList', { ...baseParams, sign: sign2, page: 1, size: 20 }, { 'sys_code': '901' });
    console.log('2. SHA256(appkey+ts+secret):', r2.result_code, r2.result_msg || r2.raw || '');

    // Pattern 3: HMAC-MD5(secret, body)
    const body3 = JSON.stringify({ appkey: APPKEY, sys_code: '901', lang: '_fr_FR', page: 1, size: 20 });
    const sign3 = crypto.createHmac('md5', SECRET).update(body3).digest('hex');
    let r3 = await httpPost('/openapi/queryPowerStationList', { appkey: APPKEY, sys_code: '901', lang: '_fr_FR', sign: sign3, page: 1, size: 20 }, {});
    console.log('3. HMAC-MD5 of body:', r3.result_code, r3.result_msg || r3.raw || '');

    // Pattern 4: Param sorting + MD5
    const params4 = { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20, sys_code: '901', ts };
    const sorted4 = Object.keys(params4).sort().map(k => k + '=' + params4[k]).join('&');
    const sign4 = crypto.createHash('md5').update(sorted4 + SECRET).digest('hex').toUpperCase();
    let r4 = await httpPost('/openapi/queryPowerStationList', { ...params4, sign: sign4 }, {});
    console.log('4. Sorted params MD5:', r4.result_code, r4.result_msg || r4.raw || '');

    // Pattern 5: Try /openapi/platform/ with HMAC
    let r5 = await httpPost('/openapi/platform/queryPowerStationList', { ...params4, sign: sign4 }, {});
    console.log('5. Platform + HMAC:', r5.result_code, r5.result_msg || r5.raw || '');

    // Pattern 6: Sign in header instead of body
    let r6 = await httpPost('/openapi/queryPowerStationList', { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 }, { 'x-sign': sign4, 'x-ts': ts, 'sys_code': '901' });
    console.log('6. Sign in header:', r6.result_code, r6.result_msg || r6.raw || '');

    // Pattern 7: MD5 of sorted values only (no keys)
    const vals7 = Object.keys(params4).sort().map(k => String(params4[k])).join('');
    const sign7 = crypto.createHash('md5').update(vals7 + SECRET).digest('hex').toUpperCase();
    let r7 = await httpPost('/openapi/queryPowerStationList', { ...params4, sign: sign7 }, {});
    console.log('7. Sorted values MD5:', r7.result_code, r7.result_msg || r7.raw || '');

    // Pattern 8: Secret as part of sorted params, then MD5
    const params8 = { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20, sys_code: '901', ts, key: SECRET };
    const sorted8 = Object.keys(params8).sort().map(k => k + '=' + params8[k]).join('&');
    const sign8 = crypto.createHash('md5').update(sorted8).digest('hex').toUpperCase();
    let r8 = await httpPost('/openapi/queryPowerStationList', { ...params4, sign: sign8 }, {});
    console.log('8. Secret in params, MD5 all:', r8.result_code, r8.result_msg || r8.raw || '');
}
main().catch((e) => console.error(e));
