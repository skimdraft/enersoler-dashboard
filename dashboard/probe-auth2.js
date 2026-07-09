#!/usr/bin/env node
/**
 * Probe 2: use session token from /openapi/login to access API
 * The non-OAuth2 flow might need the session token to get an OAuth2 token,
 * or use different endpoints that accept the session token directly.
 */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const APPKEY = '99927DD8A3562C02F3EEF55045F95419';
const ACCESSKEY = 'dwbumt012186my4mu7ffqzji4a3vrfu5';
const HOST = 'gateway.isolarcloud.com.hk';
const RSA_PUB = 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCcL4ik2_RgY_TxtfK-T3LojCtWJCloTR6UIxh-eycWYXNjAcxX1uzeQNKj29stle0Tef1ZXgXc29u6ULoOupFfFFoWa_U7SKSTxTHJghKoAijVnApiCzLMYWeymQG1e3VrB5qxlDLQoC9QnhsmIcwGW_UOsKAZlAaPbzR4lQQy3wIDAQAB';

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

function rsaEncrypt(plaintext) {
    const key = crypto.createPublicKey({ key: Buffer.from(RSA_PUB, 'base64'), format: 'der', type: 'spki' });
    return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_PADDING }, Buffer.from(plaintext)).toString('base64');
}

async function main() {
    console.log('=== Non-OAuth2 Flow Probe 2 ===\n');

    // Step 1: Login to get session token
    console.log('[1] Login as contact@enersoler.com...');
    const encPwd = rsaEncrypt('Enersoler12345!');
    const login = await post('/openapi/login',
        { appkey: APPKEY, user_account: 'contact@enersoler.com', user_password: encPwd, lang: '_fr_FR', sys_code: '901' },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    
    if (login.result_code !== '1') {
        console.log('  FAIL:', login.result_msg);
        return;
    }
    const sessionToken = login.result_data.token;
    console.log('  OK — session token:', sessionToken.slice(0, 30) + '...');

    // Step 2: Try OAuth2 token exchange with session token
    console.log('\n[2] Exchange session token for OAuth2 token...');
    
    // 2a: grant_type=password with session token as password
    const r2a = await post('/openapi/apiManage/token',
        { appkey: APPKEY, grant_type: 'password', username: 'contact@enersoler.com', password: sessionToken, lang: '_fr_FR' },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('  2a. session as password:', r2a.result_code, r2a.result_msg || r2a.error || '');

    // 2b: Skip RSA of session (too long), try plain text
    console.log('  2b. plain session as password:', '(skipped — RSA too large for key)');

    // Step 3: Try plant list with session token on DIFFERENT endpoints
    console.log('\n[3] Plant list with session token on various endpoints...');

    // 3a: /openapi/queryPowerStationList with session as Bearer
    const r3a = await post('/openapi/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901', 'Authorization': 'Bearer ' + sessionToken });
    console.log('  3a. /openapi/ + Bearer:', r3a.result_code, r3a.result_msg || '');

    // 3b: Same but with x-access-key = session token
    const r3b = await post('/openapi/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': sessionToken, sys_code: '901' });
    console.log('  3b. /openapi/ + session as x-access-key:', r3b.result_code, r3b.result_msg || '');

    // 3c: Different endpoint format — getStationList
    const r3c = await post('/openapi/getStationList',
        { appkey: APPKEY, lang: '_fr_FR', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901', 'Authorization': 'Bearer ' + sessionToken });
    console.log('  3c. /openapi/getStationList:', r3c.result_code, r3c.result_msg || r3c.http || '');

    // 3d: /openapi/platform/ with session as Bearer
    const r3d = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', sys_code: '901', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901', 'Authorization': 'Bearer ' + sessionToken });
    console.log('  3d. /openapi/platform/ + Bearer:', JSON.stringify(r3d).slice(0, 250));

    // 3e: Try with Token: header instead of Authorization:
    const r3e = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', sys_code: '901', page: 1, size: 20 },
        { 'x-access-key': ACCESSKEY, sys_code: '901', 'Token': sessionToken });
    console.log('  3e. Token header:', r3e.result_code, r3e.result_msg || r3e.error || '');

    // 3f: Try token as query parameter (GET-style in POST body)
    const r3f = await post('/openapi/platform/queryPowerStationList',
        { appkey: APPKEY, lang: '_fr_FR', sys_code: '901', page: 1, size: 20, token: sessionToken },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('  3f. token in body:', r3f.result_code, r3f.result_msg || r3f.error || '');

    // Step 4: Maybe the non-OAuth2 app needs a "bind" step first
    console.log('\n[4] Trying binding/activation endpoints...');
    
    // 4a: Try to bind plant
    const r4a = await post('/openapi/platform/bindPowerStation',
        { appkey: APPKEY, ps_id: '1437035', lang: '_fr_FR' },
        { 'x-access-key': ACCESSKEY, sys_code: '901', 'Authorization': 'Bearer ' + sessionToken });
    console.log('  4a. bindPowerStation:', r4a.result_code, r4a.result_msg || r4a.raw || '');

    // 4b: Check app status
    const r4b = await post('/openapi/getAppInfo',
        { appkey: APPKEY, lang: '_fr_FR' },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('  4b. getAppInfo:', r4b.result_code, r4b.result_msg || r4b.raw || JSON.stringify(r4b).slice(0, 200));

    // Step 5: Try the OAuth2 flow but with the non-OAuth2 appkey
    console.log('\n[5] OAuth2 token endpoint with non-OAuth2 appkey...');
    const r5 = await post('/openapi/apiManage/token',
        { appkey: APPKEY, grant_type: 'client_credentials', lang: '_fr_FR' },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('  5. client_credentials:', r5.result_code, r5.result_msg || r5.error || '');

    // 5b: Try grant_type=password with correct user/pwd
    const r5b = await post('/openapi/apiManage/token',
        { appkey: APPKEY, grant_type: 'password', username: 'contact@enersoler.com', password: encPwd, lang: '_fr_FR' },
        { 'x-access-key': ACCESSKEY, sys_code: '901' });
    console.log('  5b. password grant (encrypted):', JSON.stringify(r5b).slice(0, 300));
}
main().catch(e => console.error(e));
