#!/usr/bin/env node
/**
 * iSolarCloud Non-OAuth2 (Installer Credentials) API Client
 *
 * Flow:
 *   1. Login with username + RSA-encrypted password → get token
 *   2. Fetch plant list → all plants visible to this installer account
 *   3. Fetch real-time data per plant
 *   4. Save to isolar-data.json for dashboard
 *
 * Non-OAuth2 mode accesses ALL plants linked to the iSolarCloud account,
 * bypassing the OAuth2 "authorized apps" limitation.
 */

const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DASHBOARD_DIR = __dirname;
const ENV_FILE = path.join(DASHBOARD_DIR, '..', '.env');
const DATA_FILE = path.join(DASHBOARD_DIR, 'isolar-data.json');
const NONOAUTH_TOKENS = path.join(DASHBOARD_DIR, 'isolar-nonoauth-tokens.json');
const HISTORY_FILE = path.join(DASHBOARD_DIR, 'history.json');

// ─── Load config ─────────────────────────────────────────────
function loadEnv() {
    const env = {};
    if (fs.existsSync(ENV_FILE)) {
        const lines = fs.readFileSync(ENV_FILE, 'utf8');
        for (const line of lines.split('\n')) {
            const m = line.match(/^([^#].*?)=(.*)$/);
            if (m) env[m[1].trim()] = m[2].trim();
        }
    }
    return env;
}

const env = loadEnv();

// Non-OAuth2 credentials (installer app)
const CONFIG = {
    baseUrl: 'gateway.isolarcloud.com.hk',

    // From the non-OAuth2 registered app (user-creds.json)
    appKey: '99927DD8A3562C02F3EEF55045F95419',
    accessKey: 'dwbumt012186my4mu7ffqzji4a3vrfu5',

    // iSolarCloud account credentials
    username: '502061',
    password: 'Enersoler12345!',

    // RSA public key from developer portal
    rsaPublicKey: 'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCcL4ik2_RgY_TxtfK-T3LojCtWJCloTR6UIxh-eycWYXNjAcxX1uzeQNKj29stle0Tef1ZXgXc29u6ULoOupFfFFoWa_U7SKSTxTHJghKoAijVnApiCzLMYWeymQG1e3VrB5qxlDLQoC9QnhsmIcwGW_UOsKAZlAaPbzR4lQQy3wIDAQAB',
};

// ─── RSA encryption ──────────────────────────────────────────
function rsaEncrypt(plaintext) {
    try {
        const derKey = Buffer.from(CONFIG.rsaPublicKey, 'base64');
        const publicKey = crypto.createPublicKey({
            key: derKey,
            format: 'der',
            type: 'spki',
        });
        const encrypted = crypto.publicEncrypt(
            { key: publicKey, padding: crypto.constants.RSA_PKCS1_PADDING },
            Buffer.from(plaintext, 'utf8')
        );
        return encrypted.toString('base64');
    } catch (e) {
        console.error('[RSA] Encryption failed:', e.message);
        throw e;
    }
}

// ─── HTTP helpers ─────────────────────────────────────────────
function httpPost(hostname, path, body, headers = {}) {
    return new Promise((resolve) => {
        const jsonBody = JSON.stringify(body);
        const reqHeaders = Object.assign(
            { 'Content-Type': 'application/json;charset=UTF-8' },
            headers
        );
        const req = https.request(
            { hostname, path, method: 'POST', headers: reqHeaders },
            (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        resolve({ http: res.statusCode, ...JSON.parse(data) });
                    } catch (e) {
                        resolve({ http: res.statusCode, raw: data.slice(0, 500) });
                    }
                });
            }
        );
        req.on('error', (err) =>
            resolve({ http: 0, error: err.message, raw: '' })
        );
        req.write(jsonBody);
        req.end();
    });
}

function apiCall(path, body, token, opts = {}) {
    const headers = {
        sys_code: '901',
    };
    // Only add x-access-key if not explicitly disabled
    if (!opts.noAccessKey) {
        headers['x-access-key'] = CONFIG.accessKey;
    }
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }
    return httpPost(CONFIG.baseUrl, path, body, headers);
}

// ─── Token management ────────────────────────────────────────
function saveTokens(tokens) {
    tokens.updatedAt = new Date().toISOString();
    fs.writeFileSync(NONOAUTH_TOKENS, JSON.stringify(tokens, null, 2));
    // Also update .env
    if (fs.existsSync(ENV_FILE)) {
        let content = fs.readFileSync(ENV_FILE, 'utf8');
        if (tokens.accessToken) {
            content = content.replace(
                /^ISOLAR_ACCESS_TOKEN=.*$/m,
                'ISOLAR_ACCESS_TOKEN=' + tokens.accessToken
            );
        }
        if (tokens.refreshToken) {
            content = content.replace(
                /^ISOLAR_REFRESH_TOKEN=.*$/m,
                'ISOLAR_REFRESH_TOKEN=' + tokens.refreshToken
            );
        }
        fs.writeFileSync(ENV_FILE, content);
    }
}

function loadTokens() {
    if (fs.existsSync(NONOAUTH_TOKENS)) {
        const t = JSON.parse(fs.readFileSync(NONOAUTH_TOKENS, 'utf8'));
        if (t.accessToken && t.expiresAt > Date.now()) {
            return t;
        }
    }
    // Fallback: try .env access token (will be validated)
    if (env.ISOLAR_ACCESS_TOKEN) {
        return { accessToken: env.ISOLAR_ACCESS_TOKEN, refreshToken: env.ISOLAR_REFRESH_TOKEN, expiresAt: 0 };
    }
    return null;
}

// ─── Login strategies ────────────────────────────────────────
async function tryLogin_passwordGrant() {
    // Strategy 1: OAuth2 token endpoint with grant_type=password
    // Many iSolarCloud APIs support password grant on the same endpoint
    console.log('\n[LOGIN] Strategy 1: password grant on /openapi/apiManage/token');
    const encryptedPwd = rsaEncrypt(CONFIG.password);
    const resp = await httpPost(CONFIG.baseUrl, '/openapi/apiManage/token', {
        appkey: CONFIG.appKey,
        grant_type: 'password',
        username: CONFIG.username,
        password: encryptedPwd,
        lang: '_fr_FR',
    }, {
        'x-access-key': CONFIG.accessKey,
        sys_code: '901',
    });
    console.log('  Response:', resp.result_code, resp.result_msg || resp.error || '');
    if (resp.access_token || resp.token) {
        return {
            accessToken: resp.access_token || resp.token,
            refreshToken: resp.refresh_token || resp.refreshToken,
            expiresIn: resp.expires_in || resp.expiresIn || 86400,
        };
    }
    if (resp.result_data?.access_token) {
        return {
            accessToken: resp.result_data.access_token,
            refreshToken: resp.result_data.refresh_token,
            expiresIn: resp.result_data.expires_in || 86400,
        };
    }
    return null;
}

async function tryLogin_v1Login(usernameOverride, passwordOverride) {
    // Strategy 2: Dedicated login endpoint /openapi/login
    // Try multiple username/password variants
    const user = usernameOverride || CONFIG.username;
    const pwd = passwordOverride || CONFIG.password;
    console.log('\n[LOGIN] Strategy 2: /openapi/login (user=' + user + ')');
    const encryptedPwd = rsaEncrypt(pwd);

    // Try different field names
    const bodyVariants = [
        { user_account: user, user_password: encryptedPwd },
        { username: user, password: encryptedPwd },
        { user_name: user, user_pwd: encryptedPwd },
        { account: user, pwd: encryptedPwd },
    ];

    for (const body of bodyVariants) {
        const resp = await httpPost(CONFIG.baseUrl, '/openapi/login', {
            appkey: CONFIG.appKey,
            ...body,
            lang: '_fr_FR',
            sys_code: '901',
        }, {
            'x-access-key': CONFIG.accessKey,
            sys_code: '901',
        });
        console.log('  [' + Object.keys(body)[0] + '] ' + resp.result_code + ' ' + resp.result_msg + ' | ' + JSON.stringify(resp.result_data || resp).slice(0, 200));
        if (resp.result_code === '1') {
            const token = resp.token || resp.access_token || resp.result_data?.token || resp.result_data?.access_token;
            const refresh = resp.refresh_token || resp.result_data?.refresh_token || resp.result_data?.refreshToken;
            if (token) {
                return { accessToken: token, refreshToken: refresh, expiresIn: resp.expires_in || resp.result_data?.expires_in || 86400 };
            }
            // login_state !== '-1' means success even without token
            if (resp.result_data?.login_state && resp.result_data.login_state !== '-1') {
                console.log('  ✓ Login state: ' + resp.result_data.login_state + ' — continuing with appkey as auth');
                return {
                    accessToken: CONFIG.accessKey, // Some APIs use access key directly after login
                    refreshToken: null,
                    expiresIn: 86400,
                    rawLogin: resp,
                };
            }
        }
    }
    return null;
}

async function tryLogin_v1ApiManageLogin() {
    // Strategy 3: /v1/apiManage/token
    console.log('\n[LOGIN] Strategy 3: /v1/apiManage/token');
    const encryptedPwd = rsaEncrypt(CONFIG.password);
    const resp = await httpPost(CONFIG.baseUrl, '/v1/apiManage/token', {
        appkey: CONFIG.appKey,
        grant_type: 'password',
        username: CONFIG.username,
        password: encryptedPwd,
        lang: '_fr_FR',
    }, {
        'x-access-key': CONFIG.accessKey,
        sys_code: '901',
    });
    console.log('  Response:', resp.result_code, resp.result_msg || resp.error || '');
    if (resp.access_token || resp.token) {
        return {
            accessToken: resp.access_token || resp.token,
            refreshToken: resp.refresh_token || resp.refreshToken,
            expiresIn: resp.expires_in || 86400,
        };
    }
    return null;
}

async function tryLogin_plainBody() {
    // Strategy 4: username/password as plain text (not encrypted)
    console.log('\n[LOGIN] Strategy 4: plain password grant');
    const resp = await httpPost(CONFIG.baseUrl, '/openapi/apiManage/token', {
        appkey: CONFIG.appKey,
        grant_type: 'password',
        username: CONFIG.username,
        password: CONFIG.password,
        lang: '_fr_FR',
    }, {
        'x-access-key': CONFIG.accessKey,
        sys_code: '901',
    });
    console.log('  Response:', resp.result_code, resp.result_msg || resp.error || '');
    if (resp.access_token || resp.token) {
        return {
            accessToken: resp.access_token || resp.token,
            refreshToken: resp.refresh_token || resp.refreshToken,
            expiresIn: resp.expires_in || 86400,
        };
    }
    return null;
}

async function tryLogin_refresh(oldTokens) {
    // Strategy 5: Refresh existing token
    if (!oldTokens?.refreshToken) return null;
    console.log('\n[LOGIN] Strategy 5: refresh token');
    const resp = await httpPost(CONFIG.baseUrl, '/openapi/apiManage/refreshToken', {
        appkey: CONFIG.appKey,
        refresh_token: oldTokens.refreshToken,
        lang: '_fr_FR',
    }, {
        'x-access-key': CONFIG.accessKey,
        sys_code: '901',
    });
    console.log('  Response:', resp.result_code, resp.result_msg || resp.error || '');
    if (resp.access_token || resp.result_data?.access_token) {
        const at = resp.access_token || resp.result_data.access_token;
        const rt = resp.refresh_token || resp.result_data.refresh_token || oldTokens.refreshToken;
        return { accessToken: at, refreshToken: rt, expiresIn: resp.expires_in || 86400 };
    }
    return null;
}

async function authenticate() {
    let tokens = loadTokens();

    // If we have a valid token, return it
    if (tokens && tokens.accessToken && tokens.expiresAt > Date.now() + 60000) {
        console.log('[AUTH] Using cached token (valid until ' + new Date(tokens.expiresAt).toLocaleTimeString() + ')');
        return tokens;
    }

    // Try to use the existing .env access token as-is (might be from non-OAuth2)
    if (tokens?.accessToken) {
        console.log('[AUTH] Testing existing access token...');
        const testResp = await httpPost(CONFIG.baseUrl, '/openapi/platform/queryPowerStationList', {
            appkey: CONFIG.appKey,
            page: 1,
            size: 1,
            lang: '_fr_FR',
        }, {
            'x-access-key': CONFIG.accessKey,
            'Authorization': 'Bearer ' + tokens.accessToken,
            sys_code: '901',
        });
        if (testResp.result_code === '1') {
            console.log('[AUTH] Existing token works!');
            return tokens;
        }
        console.log('[AUTH] Existing token invalid (' + testResp.result_msg + '), re-authenticating...');
    }

    // Try refresh first if we have a refresh token
    const refreshed = await tryLogin_refresh(tokens);
    if (refreshed) {
        const result = {
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken,
            expiresAt: Date.now() + (refreshed.expiresIn * 1000) - 60000,
        };
        saveTokens(result);
        return result;
    }

    // Try all login strategies in order, with multiple username/password variants
    const userVariants = [
        { user: '502061', pwd: CONFIG.password },
        { user: 'contact@enersoler.com', pwd: CONFIG.password },
        { user: 'contact@enersoler.com', pwd: '€nersOler12345!!' },
    ];

    for (const uv of userVariants) {
        const result = await tryLogin_v1Login(uv.user, uv.pwd);
        if (result?.accessToken) {
            const tokens = {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresAt: Date.now() + (result.expiresIn * 1000) - 60000,
            };
            saveTokens(tokens);
            console.log('[AUTH] ✓ Login successful! Token expires in ' + Math.round((tokens.expiresAt - Date.now()) / 1000) + 's');
            return tokens;
        }
    }

    // Also try the other strategies with the original username
    const strategies = [tryLogin_passwordGrant, tryLogin_v1ApiManageLogin, tryLogin_plainBody];
    for (const strat of strategies) {
        const result = await strat();
        if (result?.accessToken) {
            const tokens = {
                accessToken: result.accessToken,
                refreshToken: result.refreshToken,
                expiresAt: Date.now() + (result.expiresIn * 1000) - 60000,
            };
            saveTokens(tokens);
            console.log('[AUTH] ✓ Login successful! Token expires in ' + Math.round((tokens.expiresAt - Date.now()) / 1000) + 's');
            return tokens;
        }
    }

    throw new Error('All login strategies failed. Check credentials, app approval status, and region.');
}

// ─── Data fetching ───────────────────────────────────────────
async function fetchPlantList(token) {
    console.log('\n[API] Fetching plant list...');

    // The login token is a session token (502061_xxx), not OAuth2.
    // Try multiple auth approaches for the plant list call
    const approaches = [
        // 1. Session token as x-access-key instead of Bearer
        {
            label: 'token as x-access-key',
            path: '/openapi/platform/queryPowerStationList',
            body: { appkey: CONFIG.appKey, page: 1, size: 50, lang: '_fr_FR' },
            headers: { 'x-access-key': token, sys_code: '901' },
            useToken: false,
        },
        // 2. Use v1 endpoint instead of openapi
        {
            label: 'v1 platform endpoint',
            path: '/v1/platform/queryPowerStationList',
            body: { appkey: CONFIG.appKey, page: 1, size: 50, lang: '_fr_FR' },
            headers: { 'x-access-key': CONFIG.accessKey, sys_code: '901' },
            useToken: true,
        },
        // 3. Try queryPowerStationList WITHOUT platform prefix
        {
            label: '/openapi/queryPowerStationList (no platform)',
            path: '/openapi/queryPowerStationList',
            body: { appkey: CONFIG.appKey, page: 1, size: 50, lang: '_fr_FR' },
            headers: { 'x-access-key': CONFIG.accessKey, sys_code: '901' },
            useToken: true,
        },
        // 4. Bearer token + appkey (standard approach from first test)
        {
            label: 'Bearer token + appkey',
            path: '/openapi/platform/queryPowerStationList',
            body: { appkey: CONFIG.appKey, page: 1, size: 50, lang: '_fr_FR' },
            headers: { 'x-access-key': CONFIG.accessKey, sys_code: '901' },
            useToken: true,
        },
        // 5. Try without appkey in body — token + access key only
        {
            label: 'token + access key, no appkey',
            path: '/openapi/platform/queryPowerStationList',
            body: { page: 1, size: 50, lang: '_fr_FR' },
            headers: { 'x-access-key': CONFIG.accessKey, sys_code: '901' },
            useToken: true,
        },
        // 6. Session token as Cookie with appkey
        {
            label: 'token as Cookie',
            path: '/openapi/platform/queryPowerStationList',
            body: { appkey: CONFIG.appKey, page: 1, size: 50, lang: '_fr_FR' },
            headers: { 'x-access-key': CONFIG.accessKey, sys_code: '901', 'Cookie': 'token=' + token },
            useToken: false,
        },
    ];

    for (const approach of approaches) {
        console.log('  Trying: ' + approach.label + '...');
        const headers = { ...approach.headers };
        if (approach.useToken) {
            headers['Authorization'] = 'Bearer ' + token;
        }
        const resp = await httpPost(CONFIG.baseUrl, approach.path, approach.body, headers);
        const code = resp.result_code || resp.error || '';
        const msg = resp.result_msg || resp.error_description || '';
        console.log('    → ' + code + ' ' + (msg.slice(0, 80)));

        if (resp.result_code === '1' && resp.result_data?.pageList) {
            console.log('  ✅ Found ' + resp.result_data.pageList.length + ' plant(s)');
            return resp.result_data.pageList;
        }
        if (resp.result_code === '1' && Array.isArray(resp.result_data)) {
            console.log('  ✅ Found ' + resp.result_data.length + ' plant(s)');
            return resp.result_data;
        }
    }

    throw new Error('Failed to get plant list with all approaches');
}

async function fetchPlantDetail(psId, token) {
    const resp = await apiCall('/openapi/platform/getPowerStationDetail', {
        ps_ids: String(psId),
        lang: '_fr_FR',
    }, token);
    if (resp.result_code === '1' && resp.result_data?.data_list) {
        return resp.result_data.data_list[0];
    }
    return null;
}

async function fetchDeviceList(psId, token) {
    const resp = await apiCall('/openapi/platform/getDeviceListByPsId', {
        ps_id: String(psId),
        page: 1,
        size: 100,
        lang: '_fr_FR',
    }, token);
    if (resp.result_code === '1' && resp.result_data?.pageList) {
        return resp.result_data.pageList;
    }
    return [];
}

async function fetchRealtimeData(psIds, deviceType, pointIds, token) {
    const resp = await apiCall('/openapi/platform/getDeviceRealTimeData', {
        ps_key_list: psIds.map(String),
        point_id_list: pointIds.map(String),
        device_type: deviceType,
        is_get_point_dict: '1',
        lang: '_fr_FR',
    }, token);
    if (resp.result_code === '1' && resp.result_data) {
        return resp.result_data;
    }
    return null;
}

// ─── Data aggregation ────────────────────────────────────────
async function fetchAllData(token) {
    const plants = await fetchPlantList(token);

    let totalCapacity = 0;
    const plantDetails = [];

    console.log('\n[API] Fetching plant details...');
    for (const plant of plants) {
        const detail = await fetchPlantDetail(plant.ps_id, token);
        const capacity = parseFloat(detail?.design_capacity) || parseFloat(plant.ps_capacity) || 0;
        totalCapacity += capacity;
        plantDetails.push({
            id: plant.ps_id,
            name: plant.ps_name || detail?.ps_name || 'Plant ' + plant.ps_id,
            status: plant.online_status === 1 ? 'online' : 'offline',
            capacity: capacity,
            location: plant.ps_location || detail?.ps_location || '',
            type: detail?.ps_type_name || 'PV',
            buildStatus: plant.build_status || '',
            model: detail?.device_model || '',
            installDate: detail?.install_date || detail?.create_time || '',
        });
        console.log('  ' + plant.ps_name + ' (' + plant.ps_id + ') — ' + capacity + ' kWp');
    }

    // Fetch realtime data for all plants with inverters
    let realtimeResults = [];
    const pvPlants = plantDetails.filter(p => p.status === 'online');
    const psIds = pvPlants.map(p => p.id);

    if (psIds.length > 0) {
        console.log('\n[API] Fetching realtime data for ' + psIds.length + ' plant(s)...');

        // Try device type 1 (PV Inverter) — most common
        const pointIds = [
            '10001', // daily_energy
            '10002', // daily_correction_energy
            '10003', // total_energy
            '10004', // total_correction_energy
            '10005', // total_dc_power
            '10006', // total_active_power
            '10007', // total_reactive_power
            '10008', // power_factor
            '10009', // grid_frequency
            '10011', // phase_a_voltage
            '10012', // phase_b_voltage
            '10013', // phase_c_voltage
            '10081', // inside_temperature
            // Alternative point IDs (some installations use different numbering)
            '13001', '13002', '13003', '13004', '13007', '13008', '13009', '13011',
            '13012', '13013',
        ];

        try {
            const rt = await fetchRealtimeData(psIds, 1, pointIds, token);
            if (rt) realtimeResults.push(rt);
        } catch (e) {
            console.log('  Device type 1 failed: ' + e.message);
        }

        // Also try individual per-plant queries with device discovery
        for (const plant of pvPlants.slice(0, 5)) {
            try {
                const devices = await fetchDeviceList(plant.id, token);
                for (const dev of devices) {
                    try {
                        const rt = await fetchRealtimeData(
                            [plant.id],
                            dev.device_type || 1,
                            pointIds,
                            token
                        );
                        if (rt) realtimeResults.push(rt);
                        break; // One successful read per plant is enough
                    } catch (e) {
                        continue;
                    }
                }
            } catch (e) {
                continue;
            }
        }
    }

    return {
        timestamp: new Date().toISOString(),
        totalPlants: plants.length,
        totalCapacityKWp: Math.round(totalCapacity * 100) / 100,
        plants: plantDetails,
        realtimeRaw: realtimeResults,
    };
}

// ─── Save dashboard data ─────────────────────────────────────
function loadHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        } catch (e) {
            return [];
        }
    }
    return [];
}

function saveHistory(history) {
    // Keep last 7 days (2016 entries for 5-min intervals)
    const max = 7 * 24 * 12; // 7 days * 24h * 12 slots per hour
    const trimmed = history.slice(-max);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

function extractRealtimeValues(realtimeResults) {
    const result = {
        totalPowerKW: 0,
        dailyEnergyKWh: 0,
        totalEnergyKWh: 0,
        temperatures: [],
        perPlant: {},
    };

    for (const rt of realtimeResults) {
        const data = rt.data || rt.plant_data || {};
        const pointDict = rt.point_dict || {};

        for (const [psKey, devices] of Object.entries(data)) {
            const plantId = psKey.split('_')[0];
            if (!result.perPlant[plantId]) {
                result.perPlant[plantId] = { power: 0, daily: 0, total: 0, temp: null };
            }

            for (const [devKey, points] of Object.entries(devices || {})) {
                for (const [pointId, value] of Object.entries(points || {})) {
                    const info = pointDict[pointId] || {};
                    const name = info.point_name || pointId;
                    const numVal = parseFloat(value);

                    if (name.includes('daily_energy') || pointId === '10001' || pointId === '13003') {
                        result.dailyEnergyKWh += numVal;
                        result.perPlant[plantId].daily += numVal;
                    }
                    if (name.includes('total_energy') || pointId === '10003' || pointId === '13004') {
                        result.totalEnergyKWh += numVal;
                        result.perPlant[plantId].total += numVal;
                    }
                    if (name.includes('active_power') || pointId === '10006' || pointId === '13002') {
                        result.totalPowerKW += numVal;
                        result.perPlant[plantId].power += numVal;
                    }
                    if (name.includes('temperature') || pointId === '10081') {
                        if (!isNaN(numVal)) {
                            result.temperatures.push(numVal);
                            result.perPlant[plantId].temp = numVal;
                        }
                    }
                }
            }
        }
    }

    result.avgTemp = result.temperatures.length > 0
        ? Math.round(result.temperatures.reduce((a, b) => a + b, 0) / result.temperatures.length)
        : null;

    return result;
}

function saveDashboardData(data, existing) {
    const realtime = extractRealtimeValues(data.realtimeRaw);

    // Load history
    let history = loadHistory();
    const now = new Date();

    // Round to nearest 5 minutes in Tahiti time
    const mins = now.getMinutes();
    const roundedMins = Math.floor(mins / 5) * 5;

    const eventTime = new Date(now);
    eventTime.setMinutes(roundedMins, 0, 0);
    const tzOffset = -10 * 60; // Tahiti UTC-10
    const localISO = new Date(eventTime.getTime() - tzOffset * 60000).toISOString().replace('Z', '-10:00');

    // Build history entry
    const entry = {
        time: localISO,
        total_power: realtime.totalPowerKW || null,
        daily_kwh: realtime.dailyEnergyKWh || null,
        avg_temp: realtime.avgTemp,
    };

    // Per-plant power
    for (const plant of data.plants) {
        const pp = realtime.perPlant[plant.id] || {};
        entry[plant.id + '_power'] = pp.power || null;
        entry[plant.id + '_temp'] = pp.temp || null;
    }

    // Don't duplicate same time slot
    const lastEntry = history.length > 0 ? history[history.length - 1] : null;
    if (!lastEntry || lastEntry.time !== localISO) {
        history.push(entry);
    } else {
        // Update last entry
        history[history.length - 1] = entry;
    }

    saveHistory(history);

    // Build dashboard JSON
    const oldOverview = existing?.overview || {};
    const oldEnv = existing?.environmental || {};
    const oldStations = existing?.stations || {};

    const dashboardData = {
        updateTime: new Date().toLocaleString('fr-FR', { timeZone: 'Pacific/Tahiti' }),
        timestamp: new Date().toISOString(),
        activePlants: data.plants.filter(p => p.status === 'online').length,
        totalPlants: data.totalPlants,
        totalKVA: Math.round(realtime.totalPowerKW * 10) / 10,
        totalKWp: data.totalCapacityKWp,
        totalMWh: realtime.totalEnergyKWh
            ? Math.round(realtime.totalEnergyKWh / 10) / 100
            : oldOverview?.totalMWh || 0,
        dailyKWh: realtime.dailyEnergyKWh
            ? Math.round(realtime.dailyEnergyKWh * 10) / 10
            : null,
        dailyPending: realtime.dailyEnergyKWh === 0,
        avgTemp: realtime.avgTemp || oldOverview?.avgTemp || null,
        co2Tonnes: existing?.co2Tonnes || oldEnv?.co2Tonnes || 0,
        history: history,
        plants: data.plants.map(p => {
            const pp = realtime.perPlant[p.id] || {};
            const oldP = (existing?.plants || []).find(op => String(op.id) === String(p.id));
            return {
                id: p.id,
                slug: oldP?.slug || p.name.toLowerCase().replace(/[^a-z0-9]/g, '-'),
                name: p.name,
                capacity_kwp: p.capacity,
                daily_kwh: pp.daily || oldP?.daily_kwh || null,
                daily_pending: pp.daily === 0,
                live_power_kva: pp.power || oldP?.live_power_kva || 0,
                temperature: pp.temp || oldP?.temperature || null,
                total_mwh: pp.total
                    ? Math.round(pp.total / 10) / 100
                    : oldP?.total_mwh || 0,
                load_ratio: p.capacity > 0
                    ? Math.round((pp.power || 0) / p.capacity * 1000) / 1000
                    : 0,
                model: p.model || oldP?.model || '',
                install_date: p.installDate || oldP?.install_date || '',
                status: p.status,
            };
        }),
        note: 'Données via iSolarCloud OpenAPI — Installer credentials (non-OAuth2)',
    };

    // Keep old overview data where realtime is missing
    if (!dashboardData.totalMWh) dashboardData.totalMWh = oldOverview?.totalMWh || 0;
    if (!dashboardData.dailyKWh && oldOverview?.dailyKWh) dashboardData.dailyKWh = oldOverview.dailyKWh;
    if (!dashboardData.avgTemp) dashboardData.avgTemp = oldOverview?.avgTemp || null;
    dashboardData.co2Tonnes = dashboardData.co2Tonnes || (dashboardData.totalMWh * 0.7);

    fs.writeFileSync(DATA_FILE, JSON.stringify(dashboardData, null, 2));
    console.log('\n═══ Dashboard Summary ═══');
    console.log('  Plants:', data.totalPlants, 'total /', dashboardData.activePlants, 'active');
    console.log('  Capacity:', data.totalCapacityKWp, 'kWp');
    console.log('  Live Power:', Math.round(realtime.totalPowerKW * 10) / 10, 'kW');
    console.log('  Avg Temp:', realtime.avgTemp, '°C');
    for (const plant of data.plants) {
        const pp = realtime.perPlant[plant.id] || {};
        console.log('  ' + plant.name + ': ' + (pp.power ? Math.round(pp.power * 10) / 10 + ' kW' : '—') +
            ' | ' + plant.capacity + ' kWp | ' + plant.status);
    }
    console.log('');
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const mode = args[0];

    console.log('═ iSolarCloud Non-OAuth2 Client ═');
    console.log('  Base: https://' + CONFIG.baseUrl);
    console.log('  App:  ' + CONFIG.appKey.slice(0, 8) + '...');
    console.log('  User: ' + CONFIG.username);
    console.log('');

    if (mode === '--test' || mode === '-t') {
        // Quick connection test
        try {
            const tokens = await authenticate();
            const plants = await fetchPlantList(tokens.accessToken);
            console.log('\n✅ Connection OK! Found ' + plants.length + ' plant(s):');
            for (const p of plants) {
                const status = p.online_status === 1 ? '🟢ONLINE' : '⚫OFFLINE';
                console.log('  ' + status + ' ' + p.ps_name + ' (ID:' + p.ps_id + ', ' + (p.ps_capacity || '?') + ' kWp)');
            }
        } catch (err) {
            console.error('\n❌ Connection failed:', err.message);
            process.exit(1);
        }

    } else if (mode === '--fetch' || mode === '-f') {
        // Full fetch
        try {
            const tokens = await authenticate();
            const data = await fetchAllData(tokens.accessToken);

            // Load existing data to preserve history
            let existing = {};
            if (fs.existsSync(DATA_FILE)) {
                try {
                    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                } catch (e) {}
            }

            saveDashboardData(data, existing);
        } catch (err) {
            console.error('\n❌ Fetch failed:', err.message);
            process.exit(1);
        }

    } else if (mode === '--live' || mode === '-l') {
        // Continuous 5-minute fetch loop
        console.log('Starting live fetch loop (every 5 min)...');
        console.log('Press Ctrl+C to stop.\n');

        const fetchLoop = async () => {
            try {
                const tokens = await authenticate();
                const data = await fetchAllData(tokens.accessToken);
                let existing = {};
                try {
                    existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
                } catch (e) {}
                saveDashboardData(data, existing);
            } catch (err) {
                console.error('Loop error:', err.message);
            }
        };

        await fetchLoop();
        setInterval(fetchLoop, 5 * 60 * 1000);

    } else if (mode === '--token' || mode === '-k') {
        // Just authenticate and show token status
        try {
            const tokens = await authenticate();
            console.log('\n✅ Token valid for ' + Math.round((tokens.expiresAt - Date.now()) / 1000) + 's');
        } catch (err) {
            console.error('❌', err.message);
            process.exit(1);
        }

    } else {
        console.log('Usage:');
        console.log('  node isolar-nonoauth.js --test    Test API connection');
        console.log('  node isolar-nonoauth.js --fetch   Fetch plant data');
        console.log('  node isolar-nonoauth.js --live    Continuous 5-min fetch loop');
        console.log('  node isolar-nonoauth.js --token   Check token status');
        console.log('');

        // Show token status
        const tokens = loadTokens();
        if (tokens?.accessToken && tokens?.expiresAt > Date.now()) {
            const remaining = Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 1000));
            console.log('Token: VALID (' + Math.floor(remaining / 3600) + 'h' + Math.floor((remaining % 3600) / 60) + 'm remaining)');
        } else {
            console.log('Token: NONE (run --fetch to authenticate)');
        }
    }
}

main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
});
