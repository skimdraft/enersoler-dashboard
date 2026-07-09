#!/usr/bin/env node
/**
 * Enersoler Dashboard — OAuth2 Data Fetcher
 * 
 * Uses the working OAuth2 flow to fetch real-time data from authorized plants.
 * Designed to work NOW (2 plants), extensible when non-OAuth2 app is approved.
 * 
 * Usage: node fetch-now.js [--live]
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const ENV_FILE = path.join(DIR, '..', '.env');
const TOKENS_FILE = path.join(DIR, 'isolar-tokens.json');
const DATA_FILE = path.join(DIR, 'isolar-data.json');
const HISTORY_FILE = path.join(DIR, 'history.json');

// ─── Config ───────────────────────────────────────────────────
function loadEnv() {
    const env = {};
    if (fs.existsSync(ENV_FILE)) {
        fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(l => {
            const m = l.match(/^([^#].*?)=(.*)$/);
            if (m) env[m[1].trim()] = m[2].trim();
        });
    }
    return env;
}

const env = loadEnv();

const CONFIG = {
    host: 'gateway.isolarcloud.com.hk',
    appKey: env.ISOLAR_APP_KEY,        // Read from .env!
    accessKey: env.ISOLAR_APP_SECRET,  // Read from .env!
};

// ─── Plant definitions (expand when more plants are accessible) ─
const PLANTS = {
    '1437035': { slug: 'paea', name: "Collège de Paea" },
    '1425869': { slug: 'temana', name: "Temana import" },
};

// ─── HTTP ──────────────────────────────────────────────────────
function post(path, body, token) {
    return new Promise((resolve) => {
        const json = JSON.stringify({ ...body, appkey: CONFIG.appKey, lang: '_fr_FR' });
        const headers = {
            'Content-Type': 'application/json;charset=UTF-8',
            'x-access-key': CONFIG.accessKey,
            sys_code: '901',
        };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const req = https.request({ hostname: CONFIG.host, path, method: 'POST', headers }, (res) => {
            let d = '';
            res.on('data', c => d += c);
            res.on('end', () => {
                try { resolve(JSON.parse(d)); }
                catch (e) { resolve({ raw: d.slice(0, 300) }); }
            });
        });
        req.on('error', e => resolve({ error: e.message }));
        req.write(json);
        req.end();
    });
}

// ─── Token ──────────────────────────────────────────────────────
function loadTokens() {
    if (fs.existsSync(TOKENS_FILE)) {
        try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch {}
    }
    if (env.ISOLAR_ACCESS_TOKEN) {
        return { accessToken: env.ISOLAR_ACCESS_TOKEN, refreshToken: env.ISOLAR_REFRESH_TOKEN, expiresAt: 0 };
    }
    return null;
}

function saveTokens(t) {
    t.updatedAt = new Date().toISOString();
    fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
}

async function refreshToken(refreshToken) {
    console.log('[AUTH] Refreshing token...');
    const resp = await post('/openapi/apiManage/refreshToken', { refresh_token: refreshToken });
    if (resp.access_token || resp.result_data?.access_token) {
        return {
            accessToken: resp.access_token || resp.result_data.access_token,
            refreshToken: resp.refresh_token || resp.result_data.refresh_token || refreshToken,
            expiresAt: Date.now() + ((resp.expires_in || 86400) * 1000) - 60000,
        };
    }
    throw new Error('Token refresh failed: ' + (resp.result_msg || resp.error));
}

async function ensureToken() {
    let t = loadTokens();
    if (!t?.accessToken) throw new Error('No token. Run OAuth2 authorization first.');
    if (Date.now() > t.expiresAt) {
        t = await refreshToken(t.refreshToken);
        saveTokens(t);
    }
    return t.accessToken;
}

// ─── Data Fetching ──────────────────────────────────────────────
async function fetchDeviceList(psId, token) {
    const resp = await post('/openapi/platform/getDeviceListByPsId',
        { ps_id: psId, page: 1, size: 20 }, token);
    if (resp.result_code === '1' && resp.result_data?.pageList) {
        return resp.result_data.pageList;
    }
    // Debug: log unexpected response
    if (resp.result_code !== '1') {
        console.log(`    ⚠ Device list for ${psId}: ${resp.result_code} ${resp.result_msg}`);
    } else {
        console.log(`    ⚠ Device list for ${psId}: success but no pageList. Keys: ${Object.keys(resp.result_data||resp).join(',')}`);
    }
    return [];
}

async function fetchPlantDetail(psId, token) {
    const resp = await post('/openapi/platform/getPowerStationDetail',
        { ps_ids: psId }, token);
    if (resp.result_code === '1' && resp.result_data?.data_list) {
        return resp.result_data.data_list[0];
    }
    return null;
}

async function fetchRealtimeData(psKeyList, deviceType, pointIds, token) {
    const resp = await post('/openapi/platform/getDeviceRealTimeData', {
        ps_key_list: psKeyList,
        point_id_list: pointIds,
        device_type: deviceType,
        // CRITICAL: do NOT set is_get_point_dict — it prevents values from being returned
    }, token);
    if (resp.result_code === '1' && resp.result_data) {
        return resp.result_data;
    }
    return null;
}

// ─── History ─────────────────────────────────────────────────────
function loadHistory() {
    if (fs.existsSync(HISTORY_FILE)) {
        try {
            const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
            // Support both formats: plain array and {points: [...]}
            if (Array.isArray(raw)) return raw;
            if (raw.points) return raw.points;
            return [];
        } catch { return []; }
    }
    return [];
}

function saveHistory(h) {
    // Keep last 7 days (2016 entries for 5-min)
    const trimmed = h.slice(-2016);
    // Save in the format dashboard.html expects: {points: [...]}
    fs.writeFileSync(HISTORY_FILE, JSON.stringify({ points: trimmed }, null, 2));
}

// ─── Main Fetch ──────────────────────────────────────────────────
async function fetchAll() {
    const token = await ensureToken();

    // 1) Get device lists for all plants → build ps_keys
    console.log('[FETCH] Getting device lists...');
    const plantKeys = {}; // plantId → [{ps_key, dev_type, dev_id}]
    const plantDetails = {};

    for (const [psId, info] of Object.entries(PLANTS)) {
        const devices = await fetchDeviceList(psId, token);
        console.log(`  ${info.name}: ${devices.length} device(s)`);
        plantKeys[psId] = devices.map(d => ({
            // ps_key is provided directly by the API
            ps_key: d.ps_key || `${psId}_${d.device_type || 1}_${d.chnnl_id || 1}_2`,
            dev_type: d.device_type || 1,
            dev_name: d.device_name || d.type_name || 'Device',
        }));

        const detail = await fetchPlantDetail(psId, token);
        plantDetails[psId] = detail;
    }

    // 2) Fetch real-time data for each plant's inverter (device type 1)
    console.log('\n[FETCH] Getting real-time data...');
    // Correct point IDs for SG50CX-P2 inverter (device_type=1)
    // p1=daily_production(Wh), p2=total_production(Wh), p4=internal_temp(°C),
    // p14=input_power(W), p11=PV1_power(W), p12=PV2_power(W), p13=PV3_power(W)
    const inverterPoints = ['1','2','3','4','11','12','13','14'];

    // Collect all inverter ps_keys
    const allInverterKeys = [];
    const keyToPlant = {};
    for (const [psId, keys] of Object.entries(plantKeys)) {
        const invKeys = keys.filter(k => k.dev_type === 1);
        for (const k of invKeys) {
            allInverterKeys.push(k.ps_key);
            keyToPlant[k.ps_key] = psId;
        }
    }

    let realtimeRaw = null;
    if (allInverterKeys.length > 0) {
        realtimeRaw = await fetchRealtimeData(allInverterKeys, 1, inverterPoints, token);
        if (!realtimeRaw) {
            console.log('  ⚠ No realtime data returned');
        }
    }

    // 3) Parse real-time data from device_point_list
    const parsedData = {
        totalPowerKW: 0,
        dailyEnergyKWh: 0,
        totalEnergyKWh: 0,
        temperatures: [],
        perPlant: {},
    };

    for (const psId of Object.keys(PLANTS)) {
        parsedData.perPlant[psId] = { power: 0, daily: 0, total: 0, temp: null, status: 'online' };
    }

    if (realtimeRaw?.device_point_list) {
        for (const item of realtimeRaw.device_point_list) {
            const dp = item.device_point || item;
            const psKey = dp.ps_key || '';
            const psId = psKey.split('_')[0];

            if (!parsedData.perPlant[psId]) {
                parsedData.perPlant[psId] = { power: 0, daily: 0, total: 0, temp: null, status: 'online' };
            }
            const pp = parsedData.perPlant[psId];

            // Values come as p1, p2, p3, p4, p11, p12, p13, p14, etc.
            // p1 = daily production (Wh) → convert to kWh
            // p2 = total production (Wh) → convert to kWh
            // p4 = internal temperature (°C)
            // p14 = total input power (W) → convert to kW
            const p1 = parseFloat(dp.p1) || 0;  // Daily Wh
            const p2 = parseFloat(dp.p2) || 0;  // Total Wh
            const p4 = parseFloat(dp.p4) || null; // Temp °C
            const p14 = parseFloat(dp.p14) || 0; // Power W

            pp.daily = p1 / 1000; // Wh → kWh
            pp.total = p2 / 1000; // Wh → kWh
            pp.power = p14 / 1000; // W → kW
            if (p4 !== null) {
                pp.temp = p4;
                parsedData.temperatures.push(p4);
            }

            parsedData.dailyEnergyKWh += pp.daily;
            parsedData.totalEnergyKWh += pp.total;
            parsedData.totalPowerKW += pp.power;

            console.log(`  ${psKey}: daily=${pp.daily.toFixed(1)}kWh total=${(pp.total/1000).toFixed(2)}MWh power=${pp.power.toFixed(1)}kW temp=${pp.temp}°C`);
        }
    }

    // 4) Build history entry
    const history = loadHistory();
    const now = new Date();
    const roundedMins = Math.floor(now.getMinutes() / 5) * 5;
    const slotTime = new Date(now);
    slotTime.setMinutes(roundedMins, 0, 0);
    
    // Format as Tahiti time ISO
    const pad = n => String(n).padStart(2, '0');
    const localTime = `${slotTime.getFullYear()}-${pad(slotTime.getMonth()+1)}-${pad(slotTime.getDate())}T${pad(slotTime.getHours())}:${pad(slotTime.getMinutes())}:00-10:00`;

    const entry = {
        time: localTime,
        total_power: Math.round(parsedData.totalPowerKW * 10) / 10 || null,
        total_temp: parsedData.temperatures.length > 0
            ? Math.round(parsedData.temperatures.reduce((a, b) => a + b, 0) / parsedData.temperatures.length * 10) / 10
            : null,
        total_daily_kwh: Math.round(parsedData.dailyEnergyKWh * 10) / 10 || null,
    };

    for (const [psId, info] of Object.entries(PLANTS)) {
        const pp = parsedData.perPlant[psId] || {};
        entry[info.slug + '_power'] = Math.round((pp.power || 0) * 10) / 10 || null;
        entry[info.slug + '_temp'] = pp.temp || null;
    }

    // Only record data during daylight hours (7h-19h Tahiti)
    const slotHour = slotTime.getHours();
    if (slotHour >= 7 && slotHour < 19) {
        // Don't duplicate same slot
        if (history.length && history[history.length - 1].time === localTime) {
            history[history.length - 1] = entry;
        } else {
            history.push(entry);
        }
    }
    saveHistory(history);

    // 5) Build dashboard JSON (compatible with dashboard.html format)
    const oldData = (() => {
        try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { return {}; }
    })();

    const avgTemp = parsedData.temperatures.length > 0
        ? Math.round(parsedData.temperatures.reduce((a, b) => a + b, 0) / parsedData.temperatures.length)
        : oldData.avgTemp || null;

    const totalMWh = parsedData.totalEnergyKWh > 0
        ? Math.round(parsedData.totalEnergyKWh / 10) / 100
        : (oldData.totalMWh || 0);

    const dashboardData = {
        updateTime: now.toLocaleString('fr-FR', { timeZone: 'Pacific/Tahiti' }),
        timestamp: now.toISOString(),
        activePlants: Object.keys(PLANTS).length,
        totalPlants: Object.keys(PLANTS).length,
        totalKVA: Math.round(parsedData.totalPowerKW * 10) / 10,
        totalKWp: oldData.totalKWp || 108.5,
        totalMWh: totalMWh,
        dailyKWh: parsedData.dailyEnergyKWh > 0 ? Math.round(parsedData.dailyEnergyKWh * 10) / 10 : oldData.dailyKWh,
        dailyPending: parsedData.dailyEnergyKWh <= 0,
        avgTemp: avgTemp,
        co2Tonnes: totalMWh * 0.7,
        history: history,
        plants: Object.entries(PLANTS).map(([psId, info]) => {
            const pp = parsedData.perPlant[psId] || {};
            const detail = plantDetails[psId] || {};
            const oldPlant = (oldData.plants || []).find(p => String(p.id) === psId) || {};
            const capacity = parseFloat(detail.design_capacity) || oldPlant.capacity_kwp || 0;
            const pTotalMWh = pp.total > 0 ? Math.round(pp.total / 10) / 100 : (oldPlant.total_mwh || 0);
            return {
                id: psId,
                slug: info.slug,
                name: info.name,
                capacity_kwp: capacity,
                daily_kwh: pp.daily > 0 ? Math.round(pp.daily * 10) / 10 : oldPlant.daily_kwh,
                daily_pending: pp.daily <= 0,
                live_power_kva: Math.round((pp.power || 0) * 10) / 10,
                temperature: pp.temp || oldPlant.temperature,
                total_mwh: pTotalMWh,
                load_ratio: capacity > 0 ? Math.round((pp.power || 0) / capacity * 1000) / 1000 : 0,
                model: oldPlant.model || detail.device_model || 'SG50CX-P2',
                install_date: oldPlant.install_date || detail.install_date || '',
            };
        }),
        note: 'Données via iSolarCloud OpenAPI OAuth2 — Enersoler Tahiti 🇵🇫',
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(dashboardData, null, 2));

    // Summary
    console.log('\n═══ Dashboard Updated ═══');
    console.log(`  Time: ${dashboardData.updateTime}`);
    console.log(`  Power: ${Math.round(parsedData.totalPowerKW * 10) / 10} kW`);
    console.log(`  Today: ${parsedData.dailyEnergyKWh > 0 ? (parsedData.dailyEnergyKWh / 1000).toFixed(2) + ' MWh' : 'N/A'}`);
    console.log(`  Total: ${totalMWh.toFixed(2)} MWh`);
    console.log(`  Temp: ${avgTemp}°C`);
    for (const [psId, info] of Object.entries(PLANTS)) {
        const pp = parsedData.perPlant[psId] || {};
        console.log(`  ${info.name}: ${(pp.power || 0).toFixed(1)} kW | ${pp.temp || '?'}°C`);
    }
}

// ─── Build dashboard HTML ─────────────────────────────────────
function buildDashboard() {
    if (!fs.existsSync(DATA_FILE)) {
        console.log('[BUILD] No data yet, skipping dashboard build');
        return;
    }

    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    let template = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');

    // Fix mangled CDN URLs (https:// → https   //)
    template = template.replace(/https\s+\/\/cdn\./g, 'https://cdn.');

    // Inject data
    const html = template.replace('/* INLINE_DATA */', `const INLINE_DATA = ${JSON.stringify(data)};`);
    fs.writeFileSync(path.join(DIR, 'dashboard.html'), html, 'utf8');
    console.log('[BUILD] dashboard.html updated');

    // Build plant pages
    let plantTpl = fs.readFileSync(path.join(DIR, 'plant-template.html'), 'utf8');
    plantTpl = plantTpl.replace(/https\s+\/\/cdn\./g, 'https://cdn.');
    const plantOutputs = {
        '1437035': 'paea.html',
        '1425869': 'temana.html',
    };

    for (const plant of data.plants) {
        const outFile = plantOutputs[plant.id];
        if (!outFile) continue;
        let pHtml = plantTpl
            .replace(/%%PLANT_ID%%/g, String(plant.id))
            .replace(/%%PLANT_NAME%%/g, plant.name)
            .replace('INLINE_PLACEHOLDER', JSON.stringify(data));
        fs.writeFileSync(path.join(DIR, outFile), pHtml, 'utf8');
        console.log(`[BUILD] ${outFile} updated`);
    }
}

// ═══════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════

async function main() {
    const args = process.argv.slice(2);
    const mode = args[0];

    console.log('═ Enersoler Dashboard Fetcher (OAuth2) ═\n');

    if (mode === '--live' || mode === '-l') {
        console.log('Live mode — fetching every 5 minutes. Ctrl+C to stop.\n');
        const run = async () => {
            try {
                await fetchAll();
                buildDashboard();
            } catch (e) {
                console.error('[ERROR]', e.message);
            }
        };
        await run();
        setInterval(run, 5 * 60 * 1000);

    } else if (mode === '--now' || mode === '-n' || !mode) {
        try {
            await fetchAll();
            buildDashboard();
        } catch (e) {
            console.error('[ERROR]', e.message);
            process.exit(1);
        }

    } else if (mode === '--build' || mode === '-b') {
        buildDashboard();

    } else if (mode === '--help' || mode === '-h') {
        console.log('Usage:');
        console.log('  node fetch-now.js          Fetch data + rebuild dashboard');
        console.log('  node fetch-now.js --live   Continuous 5-min fetch loop');
        console.log('  node fetch-now.js --build  Rebuild dashboard HTML only');
    }
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
