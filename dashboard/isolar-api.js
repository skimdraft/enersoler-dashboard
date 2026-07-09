#!/usr/bin/env node
/**
 * iSolarCloud OAuth2.0 API Client — International Site
 * 
 * Flow:
 *   1. First run: node isolar-api.js --authorize
 *      Opens the authorization URL in browser, you paste the code
 *   2. Then: node isolar-api.js --fetch
 *      Fetches plant data and saves to isolar-data.json
 *   3. Auto-refreshes tokens when expired
 *
 * Endpoints:
 *   Token:        POST /openapi/apiManage/token
 *   Refresh:      POST /openapi/apiManage/refreshToken
 *   Plant list:   POST /openapi/platform/queryPowerStationList
 *   Plant detail: POST /openapi/platform/getPowerStationDetail
 *   Real-time:    POST /openapi/platform/getDeviceRealTimeData
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ─── Configuration ───────────────────────────────────────────
const DASHBOARD_DIR = __dirname;
const ENV_FILE = path.join(DASHBOARD_DIR, '..', '.env');
const DATA_FILE = path.join(DASHBOARD_DIR, 'isolar-data.json');
const TOKENS_FILE = path.join(DASHBOARD_DIR, 'isolar-tokens.json');

// ─── Load config from .env ───────────────────────────────────
function loadEnv() {
    const env = {};
    if (fs.existsSync(ENV_FILE)) {
        const content = fs.readFileSync(ENV_FILE, 'utf8');
        for (const line of content.split('\n')) {
            const m = line.match(/^([^#].*?)=(.*)$/);
            if (m) env[m[1].trim()] = m[2].trim();
        }
    }
    return env;
}

const env = loadEnv();

const CONFIG = {
    baseUrl: 'gateway.isolarcloud.com.hk',
    appKey: env.ISOLAR_APP_KEY,
    appSecret: env.ISOLAR_APP_SECRET,
    redirectUrl: env.ISOLAR_REDIRECT_URL,
    authorizeUrl: env.ISOLAR_AUTHORIZATION_URL,
    cloudId: env.ISOLAR_CLOUD_ID,
    applicationId: env.ISOLAR_APPLICATION_ID,
};

// ─── Token management ────────────────────────────────────────
function loadTokens() {
    if (fs.existsSync(TOKENS_FILE)) {
        return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
    }
    // Fallback: try .env
    if (env.ISOLAR_ACCESS_TOKEN && env.ISOLAR_REFRESH_TOKEN) {
        return {
            accessToken: env.ISOLAR_ACCESS_TOKEN,
            refreshToken: env.ISOLAR_REFRESH_TOKEN,
            expiresAt: 0
        };
    }
    return null;
}

function saveTokens(tokens) {
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
    // Also update .env
    if (fs.existsSync(ENV_FILE)) {
        let content = fs.readFileSync(ENV_FILE, 'utf8');
        content = content.replace(/^ISOLAR_ACCESS_TOKEN=.*$/m, `ISOLAR_ACCESS_TOKEN=${tokens.accessToken}`);
        content = content.replace(/^ISOLAR_REFRESH_TOKEN=.*$/m, `ISOLAR_REFRESH_TOKEN=${tokens.refreshToken}`);
        fs.writeFileSync(ENV_FILE, content);
    }
}

// ─── API call ────────────────────────────────────────────────
function apiCall(path, body, token) {
    return new Promise((resolve, reject) => {
        const jsonBody = JSON.stringify({
            ...body,
            appkey: CONFIG.appKey,
            lang: '_fr_FR'
        });

        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-access-key': CONFIG.appSecret,
            'sys_code': '901',
        };
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
        }

        const req = https.request({
            hostname: CONFIG.baseUrl,
            path: path,
            method: 'POST',
            headers,
        }, res => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    if (parsed.result_code === '1' || parsed.access_token) {
                        resolve(parsed);
                    } else if (res.statusCode === 401 && parsed.error === 'invalid_token') {
                        reject({ code: 'EXPIRED', ...parsed });
                    } else {
                        reject({ code: 'API_ERROR', status: res.statusCode, ...parsed });
                    }
                } catch (e) {
                    reject({ code: 'PARSE_ERROR', raw: data, error: e.message });
                }
            });
        });

        req.on('error', err => reject({ code: 'NETWORK_ERROR', error: err.message }));
        req.write(jsonBody);
        req.end();
    });
}

// ─── OAuth2 flow ─────────────────────────────────────────────
async function exchangeCode(code) {
    console.log('[OAUTH] Exchanging authorization code...');
    try {
        const resp = await apiCall('/openapi/apiManage/token', {
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: CONFIG.redirectUrl
        });
        
        const tokens = {
            accessToken: resp.access_token || resp.result_data?.access_token,
            refreshToken: resp.refresh_token || resp.result_data?.refresh_token,
            expiresAt: Date.now() + ((resp.expires_in || resp.result_data?.expires_in || 172800) * 1000) - 60000,
            authUser: resp.result_data?.auth_user,
            authorizedPlantIds: resp.result_data?.auth_ps_list || []
        };

        saveTokens(tokens);
        console.log('[OAUTH] Tokens saved! Expires in ' + Math.round((tokens.expiresAt - Date.now()) / 1000) + 's');
        console.log('[OAUTH] Authorized plants:', tokens.authorizedPlantIds.join(', '));
        return tokens;
    } catch (err) {
        console.error('[OAUTH] Failed to exchange code:', err);
        throw err;
    }
}

async function refreshTokens(refreshToken) {
    console.log('[OAUTH] Refreshing access token...');
    try {
        const resp = await apiCall('/openapi/apiManage/refreshToken', {
            refresh_token: refreshToken
        });
        
        const tokens = {
            accessToken: resp.access_token || resp.result_data?.access_token,
            refreshToken: resp.refresh_token || resp.result_data?.refresh_token || refreshToken,
            expiresAt: Date.now() + ((resp.expires_in || resp.result_data?.expires_in || 172800) * 1000) - 60000,
        };
        
        saveTokens(tokens);
        console.log('[OAUTH] Token refreshed!');
        return tokens;
    } catch (err) {
        console.error('[OAUTH] Refresh failed:', err);
        throw err;
    }
}

async function ensureValidToken() {
    let tokens = loadTokens();
    if (!tokens || !tokens.accessToken) {
        throw new Error('No tokens found. Run with --authorize first.');
    }
    
    if (Date.now() > tokens.expiresAt) {
        console.log('[OAUTH] Token expired, refreshing...');
        const newTokens = await refreshTokens(tokens.refreshToken);
        tokens.accessToken = newTokens.accessToken;
        tokens.refreshToken = newTokens.refreshToken;
    }
    
    return tokens;
}

// ─── Data fetching ───────────────────────────────────────────
async function fetchPlantList(token) {
    console.log('[API] Fetching plant list...');
    const resp = await apiCall('/openapi/platform/queryPowerStationList', { page: 1, size: 20 }, token);
    if (resp.result_code === '1' && resp.result_data) {
        return resp.result_data.pageList || resp.result_data;
    }
    throw new Error('Failed to get plant list: ' + resp.result_msg);
}

async function fetchPlantDetail(psId, token) {
    console.log('[API] Fetching detail for plant ' + psId + '...');
    const resp = await apiCall('/openapi/platform/getPowerStationDetail', { ps_ids: String(psId) }, token);
    if (resp.result_code === '1' && resp.result_data) {
        return resp.result_data.data_list?.[0] || resp.result_data;
    }
    return null;
}

async function fetchDeviceList(psId, token) {
    const resp = await apiCall('/openapi/platform/getDeviceListByPsId', {
        ps_id: String(psId), page: 1, size: 50
    }, token);
    if (resp.result_code === '1' && resp.result_data) {
        return resp.result_data.pageList || resp.result_data.list || [];
    }
    return [];
}

async function fetchRealtimeData(psIds, deviceType, pointIds, token) {
    const resp = await apiCall('/openapi/platform/getDeviceRealTimeData', {
        ps_key_list: psIds.map(String),
        point_id_list: pointIds.map(String),
        device_type: deviceType,
        is_get_point_dict: '1'
    }, token);
    if (resp.result_code === '1' && resp.result_data) {
        return resp.result_data;
    }
    return null;
}

// ─── Data aggregation for dashboard ──────────────────────────
async function fetchAllData(token) {
    const plants = await fetchPlantList(token);
    
    let totalCapacity = 0;
    let activeCount = 0;
    let offlineCount = 0;
    let commissioningCount = 0;
    const plantDetails = [];

    for (const plant of plants) {
        const detail = await fetchPlantDetail(plant.ps_id, token);
        if (detail) {
            const capacity = parseFloat(detail.design_capacity) || parseFloat(plant.ps_capacity) || 0;
            totalCapacity += capacity;
            
            if (plant.online_status === 1 || detail.online_status === 1) activeCount++;
            else offlineCount++;
            
            plantDetails.push({
                id: plant.ps_id,
                name: plant.ps_name || detail.ps_name,
                status: plant.online_status === 1 ? 'online' : 'offline',
                capacity: capacity,
                location: plant.ps_location || detail.ps_location,
                type: detail.ps_type_name || 'PV',
                buildStatus: plant.build_status
            });
        }
    }

    // Try to get realtime data from first plant
    let realtimeData = null;
    const firstPlant = plantDetails[0];
    if (firstPlant) {
        try {
            // Common measurement point IDs for PV inverters
            const pointIds = [
                '13001', // total_dc_power
                '13002', // total_active_power
                '13003', // daily_energy 
                '13004', // total_energy
                '13007', // total_reactive_power
                '13008', // power_factor
                '13009', // grid_frequency
                '13011', // phase_a_voltage
                '13012', // phase_b_voltage
                '13013', // phase_c_voltage
            ];
            realtimeData = await fetchRealtimeData(
                [firstPlant.id], 1, pointIds, token  // device_type 1 = PV Inverter
            );
        } catch (e) {
            console.log('[API] Could not fetch realtime data (may need specific device type):', e.code || e.message);
        }
    }

    return {
        timestamp: new Date().toISOString(),
        overview: {
            totalPlants: plants.length,
            activePlants: activeCount,
            offlinePlants: offlineCount,
            totalCapacityKWp: Math.round(totalCapacity * 100) / 100,
        },
        plants: plantDetails,
        realtime: realtimeData ? {
            raw: realtimeData
        } : null,
        note: 'Données via iSolarCloud OpenAPI OAuth2.0 — International Site'
    };
}

// ─── Save dashboard data ─────────────────────────────────────
function saveDashboardData(data) {
    // Merge with existing data if any
    let existing = {};
    if (fs.existsSync(DATA_FILE)) {
        try { existing = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) {}
    }

    // Parse realtime data into readable format
    const overview = { ...data.overview };
    
    if (data.realtime?.raw?.point_list) {
        const points = data.realtime.raw.point_list;
        const pointDict = data.realtime.raw.point_dict || {};
        
        for (const [psKey, deviceData] of Object.entries(data.realtime.raw.data || {})) {
            for (const [devKey, pointValues] of Object.entries(deviceData || {})) {
                for (const [pointId, value] of Object.entries(pointValues || {})) {
                    const info = pointDict[pointId] || {};
                    const name = info.point_name || pointId;
                    if (name === 'daily_energy') overview.dailyYieldKWh = value;
                    if (name === 'total_energy') overview.totalYieldKWh = value;
                    if (name === 'total_active_power') overview.realtimePowerKW = value;
                }
            }
        }
    }

    const dashboardData = {
        timestamp: data.timestamp,
        updateTime: new Date().toLocaleString('fr-FR', { timeZone: 'Pacific/Tahiti' }),
        overview: {
            dailyYieldMWh: overview.dailyYieldKWh ? (overview.dailyYieldKWh / 1000).toFixed(2) : existing.overview?.dailyYieldMWh || 'N/A',
            totalYieldMWh: overview.totalYieldKWh ? (overview.totalYieldKWh / 1000).toFixed(2) : existing.overview?.totalYieldMWh || 'N/A',
            realtimePowerKW: overview.realtimePowerKW || existing.overview?.realtimePowerKW || 'N/A',
            installedCapacityKWp: overview.totalCapacityKWp || existing.overview?.installedCapacityKWp || 'N/A',
            monthlyYieldMWh: existing.overview?.monthlyYieldMWh || 'N/A',
            dailyRevenueXPF: existing.overview?.dailyRevenueXPF || 'N/A',
            monthlyRevenueXPF: existing.overview?.monthlyRevenueXPF || 'N/A',
            yearlyRevenueXPF: existing.overview?.yearlyRevenueXPF || 'N/A',
            totalRevenueXPF: existing.overview?.totalRevenueXPF || 'N/A',
        },
        stations: {
            normal: overview.activePlants || existing.stations?.normal || 'N/A',
            offline: overview.offlinePlants || existing.stations?.offline || 'N/A',
            commissioning: existing.stations?.commissioning || 'N/A',
        },
        environmental: existing.environmental || {},
        plants: data.plants,
        note: data.note,
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(dashboardData, null, 2));
    console.log('[SAVE] Data written to ' + DATA_FILE);
    
    // Print summary
    console.log('\n══ Dashboard Summary ══');
    console.log('  Plants:', overview.activePlants, 'active /', overview.offlinePlants, 'offline');
    console.log('  Capacity:', overview.totalCapacityKWp, 'kWp');
    if (overview.realtimePowerKW) console.log('  Power:', overview.realtimePowerKW, 'kW');
    if (overview.dailyYieldKWh) console.log('  Today:', (overview.dailyYieldKWh / 1000).toFixed(2), 'MWh');
    if (overview.totalYieldKWh) console.log('  Total:', (overview.totalYieldKWh / 1000).toFixed(2), 'MWh');
    console.log('');
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const mode = args[0];

    if (!CONFIG.appKey || !CONFIG.appSecret) {
        console.error('ERROR: ISOLAR_APP_KEY and ISOLAR_APP_SECRET not found in .env');
        console.error('Make sure .env exists at:', ENV_FILE);
        process.exit(1);
    }

    console.log('═ iSolarCloud OAuth2.0 Client ═');
    console.log('  Base: https://' + CONFIG.baseUrl);
    console.log('  App:  ' + CONFIG.appKey.substring(0, 8) + '...');
    console.log('');

    if (mode === '--authorize' || mode === '-a') {
        // ─── Authorize ────────────────────────────────────────
        const authUrl = CONFIG.authorizeUrl || 
            `https://web3.isolarcloud.com.hk/#/authorized-app?cloudId=${CONFIG.cloudId}&applicationId=${CONFIG.applicationId}&redirectUrl=${encodeURIComponent(CONFIG.redirectUrl)}`;
        
        console.log('Opening authorization URL in browser...');
        console.log(authUrl);
        console.log('');
        
        // Try to open browser
        const platform = process.platform;
        const openCmd = platform === 'win32' ? 'start' : platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${openCmd} "${authUrl}"`);
        
        console.log('After authorization, you will be redirected to:');
        console.log(CONFIG.redirectUrl + '?code=XXXXXX');
        console.log('');
        console.log('Copy the code and run:');
        console.log('  node isolar-api.js --code YOUR_CODE');
        
    } else if (mode === '--code' || mode === '-c') {
        // ─── Exchange code ────────────────────────────────────
        const code = args[1];
        if (!code) {
            console.error('Usage: node isolar-api.js --code <AUTHORIZATION_CODE>');
            process.exit(1);
        }
        await exchangeCode(code);
        
    } else if (mode === '--refresh' || mode === '-r') {
        // ─── Refresh token ─────────────────────────────────────
        const tokens = loadTokens();
        if (!tokens?.refreshToken) {
            console.error('No refresh token found. Run --authorize first.');
            process.exit(1);
        }
        await refreshTokens(tokens.refreshToken);
        
    } else if (mode === '--fetch' || mode === '-f') {
        // ─── Fetch data ───────────────────────────────────────
        try {
            const tokens = await ensureValidToken();
            const data = await fetchAllData(tokens.accessToken);
            saveDashboardData(data);
        } catch (err) {
            if (err.code === 'EXPIRED') {
                console.log('[ERROR] Token expired and refresh failed.');
                console.log('Run: node isolar-api.js --authorize');
            } else {
                console.error('[ERROR]', err.code || err.message, err);
            }
            process.exit(1);
        }
        
    } else if (mode === '--test' || mode === '-t') {
        // ─── Test connection ──────────────────────────────────
        try {
            const tokens = await ensureValidToken();
            const plants = await fetchPlantList(tokens.accessToken);
            console.log('Connection OK! Found ' + plants.length + ' plant(s):');
            for (const p of plants) {
                console.log('  -', p.ps_name, '(ID:', p.ps_id + ', Status:', p.online_status === 1 ? 'ONLINE' : 'OFFLINE') + ')';
            }
        } catch (err) {
            console.error('[ERROR]', err.code || err.message);
            process.exit(1);
        }
        
    } else {
        // ─── Help ─────────────────────────────────────────────
        console.log('Usage:');
        console.log('  node isolar-api.js --authorize     Open browser for OAuth2 authorization');
        console.log('  node isolar-api.js --code <CODE>   Exchange authorization code for tokens');
        console.log('  node isolar-api.js --refresh       Refresh access token');
        console.log('  node isolar-api.js --fetch         Fetch plant data for dashboard');
        console.log('  node isolar-api.js --test          Test API connection');
        console.log('');
        
        // Check current status
        const tokens = loadTokens();
        if (tokens?.accessToken) {
            const remaining = Math.max(0, Math.round((tokens.expiresAt - Date.now()) / 1000));
            const hours = Math.floor(remaining / 3600);
            const mins = Math.floor((remaining % 3600) / 60);
            console.log('Token status: VALID (' + hours + 'h' + mins + 'm remaining)');
            console.log('Authorized plants:', tokens.authorizedPlantIds?.join(', ') || 'unknown');
        } else {
            console.log('Token status: NONE — run --authorize first');
        }
    }
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
