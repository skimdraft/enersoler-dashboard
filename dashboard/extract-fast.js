#!/usr/bin/env node
/**
 * iSolarCloud — Fast Extractor (every 5 min)
 * ONLY fetches real-time data + today's daily kWh from API.
 * Completes in <45 sec. Fails gracefully.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const DASHBOARD_DIR = __dirname;
const ENV_FILE = path.join(DASHBOARD_DIR, '..', '.env');
const TOKENS_FILE = path.join(DASHBOARD_DIR, 'isolar-tokens.json');
const DATA_FILE = path.join(DASHBOARD_DIR, 'isolar-data.json');
const BASELINE_FILE = path.join(DASHBOARD_DIR, 'daily-baseline.json');
const HISTORY_FILE = path.join(DASHBOARD_DIR, 'history.json');

// ─── Helpers ─────────────────────────────────────────────────
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

function loadTokens() {
    try { return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8')); } catch (e) { return null; }
}
function saveTokens(t) { fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2)); }

function loadHistory() {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) { return { points: [] }; }
}
function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h)); }

function loadBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch (e) { return null; }
}
function saveBaseline(b) { fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2)); }

function getTodayStr() { return new Date().toLocaleDateString('fr-FR', { timeZone: 'Pacific/Tahiti' }); }
function getTodayISO() {
    const d = new Date().toLocaleDateString('fr-FR', { timeZone: 'Pacific/Tahiti' });
    const [day, month, year] = d.split('/');
    return `${year}-${month}-${day}`;
}
function getTodayCompact() {
    return new Date().toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' }).replace(/-/g, '');
}

function getTahitiNow() {
    return {
        hour: parseInt(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Tahiti', hour: '2-digit', hour12: false })),
        min: parseInt(new Date().toLocaleString('en-US', { timeZone: 'Pacific/Tahiti', minute: '2-digit' })),
    };
}

// ─── API call with timeout ───────────────────────────────────
function apiCall(p, body, token, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        const j = JSON.stringify({ ...body, appkey: appKey, lang: '_fr_FR' });
        const headers = { 'Content-Type': 'application/json;charset=UTF-8', 'x-access-key': appSecret, 'sys_code': '901' };
        if (token) headers['Authorization'] = 'Bearer ' + token;

        const req = https.request({ hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST', headers, timeout: timeoutMs }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject({ code: 'PARSE' }); } });
        });
        req.on('error', e => reject({ code: 'NET', msg: e.message }));
        req.on('timeout', () => { req.destroy(); reject({ code: 'TIMEOUT' }); });
        req.write(j); req.end();
    });
}

// ─── Token ────────────────────────────────────────────────────
async function getToken() {
    let t = loadTokens();
    if (!t?.accessToken) throw new Error('NO_TOKEN');
    const refreshAge = Date.now() - (t.lastRefresh || 0);
    const needsRefresh = Date.now() > t.expiresAt || refreshAge > 12 * 3600000;
    if (needsRefresh) {
        console.log('[AUTH] Refresh...');
        try {
            const r = await apiCall('/openapi/apiManage/refreshToken', { refresh_token: t.refreshToken }, null, 20000);
            const newAccess = r.access_token || r.result_data?.access_token;
            const newRefresh = r.refresh_token || r.result_data?.refresh_token;
            if (newAccess) {
                t = {
                    accessToken: newAccess,
                    refreshToken: newRefresh || t.refreshToken,
                    expiresAt: Date.now() + ((r.expires_in || 172800) * 1000) - 60000,
                    lastRefresh: Date.now()
                };
                saveTokens(t);
                console.log('[AUTH] OK, expires in ' + Math.round((t.expiresAt - Date.now()) / 3600000) + 'h');
            }
        } catch (e) {
            console.error('[AUTH] Refresh failed: ' + (e.code || '') + ' ' + (e.msg || ''));
            if (Date.now() > t.expiresAt) throw new Error('TOKEN_EXPIRED');
            console.log('[AUTH] Using existing token (still valid)');
        }
    }
    return t.accessToken;
}

// ─── Timeline ─────────────────────────────────────────────────
function generateTimeline(todayISO) {
    const points = [];
    for (let h = 7; h < 19; h++) {
        for (let m = 0; m < 60; m += 5) {
            points.push({
                time: `${todayISO}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-10:00`,
                paea_power: null, temana_power: null,
                paea_temp: null, temana_temp: null,
                total_power: null, total_temp: null,
                total_daily_kwh: null,
            });
        }
    }
    return points;
}

function mergeTimeline(timeline, realPoints) {
    const map = {};
    for (const p of realPoints) {
        try {
            const d = new Date(p.time);
            let h = d.getUTCHours() - 10;
            if (h < 0) h += 24;
            const m = Math.floor(d.getUTCMinutes() / 5) * 5;
            map[String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0')] = p;
        } catch(e) {}
    }

    return timeline.map(slot => {
        const t = new Date(slot.time);
        let slotH = t.getUTCHours() - 10;
        if (slotH < 0) slotH += 24;
        const slotM = t.getUTCMinutes();
        const key = `${String(slotH).padStart(2,'0')}:${String(slotM).padStart(2,'0')}`;
        if (map[key]) return { ...map[key], time: slot.time };
        return slot;
    });
}

// ─── Plant API ────────────────────────────────────────────────
async function getPlants(token) {
    try {
        const r = await apiCall('/openapi/platform/queryPowerStationList', { page: 1, size: 20 }, token);
        return (r.result_code === '1') ? (r.result_data?.pageList || []) : [];
    } catch(e) { console.error('[PLANTS] Failed:', e.code); return []; }
}

async function getDetail(psId, token) {
    try {
        const r = await apiCall('/openapi/platform/getPowerStationDetail', { ps_ids: psId }, token);
        return (r.result_code === '1') ? (r.result_data?.data_list?.[0] || null) : null;
    } catch(e) { console.error('[DETAIL] Failed for ' + psId + ':', e.code); return null; }
}

async function getDevices(psId, token) {
    try {
        const r = await apiCall('/openapi/platform/getDeviceListByPsId', { ps_id: psId, page: 1, size: 50 }, token);
        return (r.result_code === '1') ? (r.result_data?.pageList || []) : [];
    } catch(e) { console.error('[DEVICES] Failed for ' + psId + ':', e.code); return []; }
}

async function getInverter(psKey, token) {
    try {
        const v = ['2','4','14','24','26','27','86'];
        const r = await apiCall('/openapi/platform/getDeviceRealTimeData', { ps_key_list: [psKey], point_id_list: v, device_type: 1 }, token);
        if (r.result_code !== '1' || !r.result_data?.device_point_list?.length) return null;
        const dp = r.result_data.device_point_list[0].device_point;
        if (!dp) return null;
        const p = k => parseFloat(dp[k] || 0);
        return {
            total_energy_wh: p('p2'), apparent_power_va: p('p24'),
            dc_power_w: p('p14'), temperature_c: p('p4'),
            load_ratio: p('p86'), power_factor: p('p26'), frequency_hz: p('p27'),
        };
    } catch(e) { console.error('[INVERTER] Failed for ' + psKey + ':', e.code); return null; }
}

// ─── Daily kWh from API (accurate, no baseline needed) ──────
async function fetchTodayDailyKWh(token) {
    const PS_KEYS = ['1437035_1_1_2', '1425869_1_1_1'];
    const psToSlug = { '1437035_1_1_2': 'paea', '1425869_1_1_1': 'temana' };
    const todayCompact = getTodayCompact();

    console.log('[DAILY] Fetching today kWh (' + todayCompact + ')...');
    try {
        const r = await apiCall('/openapi/platform/getDevicePointDayMonthYearDataList', {
            query_type: 'day', data_type: '2',
            ps_key_list: PS_KEYS,
            data_point: 'p1',
            start_time: todayCompact, end_time: todayCompact,
            order: 0
        }, token, 20000);

        if (r.result_code === '1' && r.result_data) {
            const result = {};
            for (const [psKey, pointData] of Object.entries(r.result_data)) {
                if (psKey === 'point_dict' || psKey === 'illegal_ps_key_list') continue;
                const slug = psToSlug[psKey];
                if (!slug) continue;
                const p1 = pointData.p1 || [];
                if (p1.length > 0) {
                    const val = parseFloat(p1[0]['2'] || '0');
                    result[slug] = Math.round(val / 10) / 100; // Wh*10 → kWh
                }
            }
            if (Object.keys(result).length > 0) {
                console.log('[DAILY]  paea=' + (result.paea || '?') + ' kWh  temana=' + (result.temana || '?') + ' kWh');
                return result;
            }
        }
        console.log('[DAILY] No data yet (code=' + r.result_code + ')');
    } catch(e) {
        console.log('[DAILY] Failed: ' + (e.code || e.message));
    }
    return null;
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
    const tzTime = new Date().toLocaleString('fr-FR', { timeZone: 'Pacific/Tahiti' });
    console.log('⚡ Fast Extract — ' + tzTime);

    // Token
    let token;
    try {
        token = await getToken();
    } catch(e) {
        console.error('[FATAL] Token: ' + e.message);
        process.exit(1);
    }

    // Plants
    const plants = await getPlants(token);
    if (!plants.length) {
        console.error('[FATAL] No plants returned from API');
        process.exit(1);
    }

    const today = getTodayStr();
    const todayISO = getTodayISO();

    const baseline = loadBaseline();
    const firstBaselineRun = !baseline || baseline.date !== today;
    const newBaselineP2 = {};

    // Fetch today's daily kWh from API (accurate, works without midnight baseline)
    const apiDailyKWh = await fetchTodayDailyKWh(token);

    let totalKVA = 0, totalCapW = 0, avgTemp = 0, activeCount = 0;
    const plantDetails = [];
    const nowPoint = { time: new Date().toISOString() };

    for (const plant of plants) {
        const psId = String(plant.ps_id);
        const slug = psId === '1437035' ? 'paea' : 'temana';

        const detail = await getDetail(psId, token);
        const capW = detail?.install_power || 0;
        totalCapW += capW;

        if (plant.online_status === 1) activeCount++;

        const devices = await getDevices(psId, token);
        const invDev = devices.find(d => d.device_type === 1);
        const inv = invDev ? await getInverter(invDev.ps_key, token) : null;

        if (inv) {
            totalKVA += inv.apparent_power_va / 1000;
            avgTemp += inv.temperature_c;
            newBaselineP2[psId] = inv.total_energy_wh;
            nowPoint[slug + '_power'] = +(inv.apparent_power_va / 1000).toFixed(1);
            nowPoint[slug + '_temp'] = +inv.temperature_c.toFixed(1);
        }

        // Daily kWh: API > baseline > fallback integration
        let dailyKWh = null;
        if (apiDailyKWh && apiDailyKWh[slug] !== undefined) {
            dailyKWh = apiDailyKWh[slug];
        } else if (!firstBaselineRun && baseline?.isMidnight && baseline.date === today && inv) {
            const mv = baseline.p2[psId];
            if (mv !== undefined) dailyKWh = Math.max(0, (inv.total_energy_wh - mv) / 1000);
        }

        plantDetails.push({
            id: psId, slug,
            name: plant.ps_name,
            capacity_kwp: +(capW / 1000).toFixed(1),
            daily_kwh: dailyKWh !== null ? +dailyKWh.toFixed(1) : null,
            daily_pending: dailyKWh === null,
            live_power_kva: inv ? +(inv.apparent_power_va / 1000).toFixed(1) : 0,
            temperature: inv ? +inv.temperature_c.toFixed(1) : 0,
            total_mwh: inv ? +(inv.total_energy_wh / 1000000).toFixed(2) : 0,
            load_ratio: inv ? +inv.load_ratio.toFixed(3) : 0,
            model: invDev?.device_model_code || '?',
            install_date: plant.install_date || detail?.install_date || '',
        });
    }

    avgTemp = activeCount > 0 ? +(avgTemp / activeCount).toFixed(1) : 0;

    if (firstBaselineRun) {
        const h = getTahitiNow().hour;
        saveBaseline({ date: today, p2: newBaselineP2, isMidnight: h < 1, savedAt: new Date().toISOString() });
        console.log('[BASE] New baseline: ' + today + (h < 1 ? ' MIDNIGHT' : ''));
    }

    // Daily total kWh: API sum > baseline > fallback
    let totalDailyKWh = null;
    if (apiDailyKWh) {
        const sum = (apiDailyKWh.paea || 0) + (apiDailyKWh.temana || 0);
        if (sum > 0) totalDailyKWh = +sum.toFixed(1);
    }
    if (totalDailyKWh === null) {
        const bl = loadBaseline();
        if (!firstBaselineRun && bl?.isMidnight && bl.date === today) {
            totalDailyKWh = plantDetails.reduce((sum, pd) => {
                const mv = bl.p2[pd.id];
                return mv !== undefined ? sum + Math.max(0, (pd.total_mwh * 1000000 - mv) / 1000) : sum;
            }, 0);
        }
    }

    nowPoint.total_power = +totalKVA.toFixed(1);
    nowPoint.total_temp = avgTemp;
    nowPoint.total_daily_kwh = totalDailyKWh !== null ? +totalDailyKWh.toFixed(1) : null;

    // ─── Merge into history timeline ────────────────────────
    const history = loadHistory();
    const todayReal = (history.points || []).filter(p => {
        try { return p.time.startsWith(todayISO); } catch(e) { return false; }
    }).filter(p => p.paea_power !== null || p.temana_power !== null);

    todayReal.push(nowPoint);

    const timeline = generateTimeline(todayISO);
    const merged = mergeTimeline(timeline, todayReal);

    history.points = (history.points || []).filter(p => {
        try { return new Date(p.time).getTime() > Date.now() - 90 * 86400000; } catch(e) { return false; }
    }).filter(p => !p.time.startsWith(todayISO));
    history.points = history.points.concat(merged);
    saveHistory(history);

    // ─── Fallback daily kWh from power integration ──────────
    let fallbackTotal = 0;
    for (const pd of plantDetails) {
        if (pd.daily_kwh === null) {
            const sum = todayReal
                .filter(p => (p[pd.slug + '_power'] || 0) > 0)
                .reduce((s, p) => s + (p[pd.slug + '_power'] || 0) * 5 / 60, 0);
            pd.daily_kwh = sum > 0 ? +sum.toFixed(1) : null;
        }
        if (pd.daily_kwh !== null) fallbackTotal += pd.daily_kwh;
    }
    if (totalDailyKWh === null && fallbackTotal > 0) {
        totalDailyKWh = +fallbackTotal.toFixed(1);
    }

    // CO2
    const totalMWh = plantDetails.reduce((s, p) => s + p.total_mwh, 0);
    const co2Tonnes = +(totalMWh * 0.7).toFixed(1);

    // Auth warning
    let authWarning = null;
    try {
        const t = loadTokens();
        if (!t?.accessToken) authWarning = 'Pas de token';
        else if (Date.now() > t.expiresAt) authWarning = 'Token expiré';
        else {
            const hoursLeft = Math.round((t.expiresAt - Date.now()) / 3600000);
            if (hoursLeft < 24) authWarning = 'Token expire dans ' + hoursLeft + 'h';
        }
    } catch(e) { authWarning = 'Erreur token'; }

    const output = {
        updateTime: tzTime,
        timestamp: new Date().toISOString(),
        activePlants: activeCount,
        totalPlants: plants.length,
        totalKVA: +totalKVA.toFixed(1),
        totalKWp: +(totalCapW / 1000).toFixed(1),
        totalMWh: +totalMWh.toFixed(2),
        dailyKWh: totalDailyKWh !== null ? +totalDailyKWh.toFixed(1) : null,
        dailyPending: totalDailyKWh === null,
        avgTemp,
        co2Tonnes,
        authWarning,
        history: merged,
        plants: plantDetails,
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));

    const realCount = merged.filter(p => p.paea_power !== null).length;
    console.log('═══ Saved ═══');
    console.log('  ⚡ ' + output.totalKVA + ' kVA  |  ☀ ' + (output.dailyKWh !== null ? output.dailyKWh + ' kWh' : '⏳'));
    console.log('  📊 ' + realCount + '/' + merged.length + ' data points today');
    console.log('  🌡 ' + output.avgTemp + '°C  |  🌱 ' + output.co2Tonnes + ' t CO₂\n');
}

main().catch(e => {
    console.error('FATAL:', e.message || e);
    process.exit(1);
});
