#!/usr/bin/env node
/**
 * iSolarCloud OAuth2.0 — Extractor v4
 * Full-day timeline prepopulation + varied chart data
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

function apiCall(p, body, token) {
    return new Promise((resolve, reject) => {
        const j = JSON.stringify({ ...body, appkey: appKey, lang: '_fr_FR' });
        const headers = { 'Content-Type': 'application/json;charset=UTF-8', 'x-access-key': appSecret, 'sys_code': '901' };
        if (token) headers['Authorization'] = 'Bearer ' + token;
        const req = https.request({ hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST', headers }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject({ code: 'PARSE' }); } });
        });
        req.on('error', e => reject({ code: 'NET' }));
        req.write(j); req.end();
    });
}

async function getToken() {
    let t = loadTokens();
    if (!t?.accessToken) throw new Error('No tokens');
    // Refresh proactively every 12h (or when expired) to keep the chain alive
    const refreshAge = Date.now() - (t.lastRefresh || 0);
    const needsRefresh = Date.now() > t.expiresAt || refreshAge > 12 * 3600000;
    if (needsRefresh) {
        console.log('[AUTH] Refresh...');
        try {
            const r = await apiCall('/openapi/apiManage/refreshToken', { refresh_token: t.refreshToken });
            const newAccess = r.access_token || r.result_data?.access_token;
            const newRefresh = r.refresh_token || r.result_data?.refresh_token;
            if (newAccess) {
                t = {
                    accessToken: newAccess,
                    refreshToken: newRefresh || t.refreshToken,
                    expiresAt: Date.now() + ((r.expires_in || 172800) * 1000) - 60000,
                    lastRefresh: Date.now()
                };
                fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
                console.log('[AUTH] OK, next refresh in ' + Math.round((t.expiresAt - Date.now()) / 3600000) + 'h');
            }
        } catch (e) {
            console.error('[AUTH] Refresh failed: ' + (e.code || e.message));
            // Don't throw — use existing token if still valid
            if (Date.now() > t.expiresAt) throw new Error('Token expired and refresh failed');
        }
    }
    return t.accessToken;
}

// ─── History with full-day timeline ───────────────────────────
function loadHistory() {
    try { return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); } catch (e) { return { points: [] }; }
}

function saveHistory(h) { fs.writeFileSync(HISTORY_FILE, JSON.stringify(h)); }

function getTodayPacificDate() {
    const d = new Date().toLocaleDateString('fr-FR', { timeZone: 'Pacific/Tahiti' });
    const [day, month, year] = d.split('/');
    return { dateStr: d, iso: `${year}-${month}-${day}` };
}

function generateTimeline(todayISO) {
    // Generate all 5-min slots from 07:00 to 19:00 Tahiti time
    const points = [];
    for (let h = 7; h < 19; h++) {
        for (let m = 0; m < 60; m += 5) {
            const time = `${todayISO}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-10:00`;
            points.push({
                time,
                paea_power: null, temana_power: null,
                paea_temp: null, temana_temp: null,
                total_power: null, total_temp: null,
                total_daily_kwh: null,
            });
        }
    }
    return points;
}

function mergeTimeline(timeline, realPoints, todayISO) {
    // Convert real points UTC → Tahiti time (GMT-10)
    const tahitiKey = (isoTime) => {
        try {
            const d = new Date(isoTime);
            let h = d.getUTCHours() - 10;
            if (h < 0) h += 24;
            const m = Math.floor(d.getUTCMinutes() / 5) * 5;
            return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
        } catch(e) { return null; }
    };
    const map = {};
    for (const p of realPoints) {
        const k = tahitiKey(p.time);
        if (k) map[k] = p;
    }

    // Get current Tahiti hour
    const now = new Date();
    const tahitiHour = parseInt(now.toLocaleString('en-US', { timeZone: 'Pacific/Tahiti', hour: '2-digit', hour12: false }));
    const tahitiMin = now.getMinutes();

    return timeline.map(slot => {
        const t = new Date(slot.time);
        // Use UTC-based Tahiti hour (works on any server timezone)
        let slotH = t.getUTCHours() - 10;
        if (slotH < 0) slotH += 24;
        const slotM = t.getUTCMinutes();
        const key = `${String(slotH).padStart(2,'0')}:${String(slotM).padStart(2,'0')}`;
        if (map[key]) {
            // Real data exists for this slot
            return { ...map[key], time: slot.time };
        }
        // Only leave null for PAST times (before data collection started)
        // For FUTURE times, leave null (will fill in)
        if (slotH < tahitiHour || (slotH === tahitiHour && slotM <= tahitiMin)) {
            // Past or current slot with no data — leave null
            return slot;
        }
        // Future slot — leave null
        return slot;
    });
}

// ─── Baseline ────────────────────────────────────────────────
function loadBaseline() {
    try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch (e) { return null; }
}
function saveBaseline(b) { fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 2)); }

function getTodayStr() { return new Date().toLocaleDateString('fr-FR', { timeZone: 'Pacific/Tahiti' }); }

// ─── API ──────────────────────────────────────────────────────
async function getPlants(token) {
    const r = await apiCall('/openapi/platform/queryPowerStationList', { page: 1, size: 20 }, token);
    return (r.result_code === '1') ? (r.result_data?.pageList || []) : [];
}

async function getDetail(psId, token) {
    const r = await apiCall('/openapi/platform/getPowerStationDetail', { ps_ids: psId }, token);
    return (r.result_code === '1') ? (r.result_data?.data_list?.[0] || null) : null;
}

async function getDevices(psId, token) {
    const r = await apiCall('/openapi/platform/getDeviceListByPsId', { ps_id: psId, page: 1, size: 50 }, token);
    return (r.result_code === '1') ? (r.result_data?.pageList || []) : [];
}

async function getInverter(psKey, token) {
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
}

// ─── History Fetch ───────────────────────────────────────────
const HISTORY_DAILY_FILE = path.join(DASHBOARD_DIR, 'history-daily.json');
const HISTORY_MONTHLY_FILE = path.join(DASHBOARD_DIR, 'history-monthly.json');

function getTahitiDateStr(dayOffset) {
    const d = new Date(); d.setDate(d.getDate() - dayOffset);
    return d.toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' }).replace(/-/g, '');
}
function getTahitiMonthStr(monthOffset) {
    const d = new Date(); d.setMonth(d.getMonth() - monthOffset);
    return d.toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' }).substring(0, 7).replace(/-/g, '');
}
function getTahitiISO(dayOffset) {
    const d = new Date(); d.setDate(d.getDate() - dayOffset);
    return d.toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' });
}

async function fetchAndSaveHistory(token, liveData) {
    const PS_KEYS = ['1437035_1_1_2', '1425869_1_1_1'];
    const psToSlug = { '1437035_1_1_2': 'paea', '1425869_1_1_1': 'temana' };

    console.log('[HIST] Fetching daily history...');

    // Load existing history
    let dailyHistory = [];
    const existingDates = new Set();
    if (fs.existsSync(HISTORY_DAILY_FILE)) {
        try {
            dailyHistory = JSON.parse(fs.readFileSync(HISTORY_DAILY_FILE, 'utf8'));
            for (const e of dailyHistory) existingDates.add(e.date);
            console.log('[HIST] Loaded ' + dailyHistory.length + ' existing entries');
        } catch (e) {}
    }

    // Fetch last 90 days in 3 batches of 30
    for (let batch = 0; batch < 3; batch++) {
        const endOffset = batch * 30 + 1;
        const startOffset = (batch + 1) * 30;
        const start = getTahitiDateStr(startOffset);
        const end = getTahitiDateStr(endOffset);

        // Check if we already have this batch (all dates with BOTH plants' data)
        let needsFetch = false;
        for (let d = endOffset; d <= startOffset; d++) {
            const iso = getTahitiISO(d);
            const existing = dailyHistory.find(e => e.date === iso);
            if (!existing) { needsFetch = true; break; }
            // Check both plants have data (not just date entry from live data)
            for (const slug of ['paea','temana']) {
                if (existing[slug + '_kwh'] === undefined) { needsFetch = true; break; }
            }
            if (needsFetch) break;
        }
        if (!needsFetch) {
            console.log('[HIST] Batch ' + (batch + 1) + '/3: already cached, skip');
            continue;
        }

        console.log('[HIST] Batch ' + (batch + 1) + '/3: ' + start + ' → ' + end);
        try {
            const r = await apiCall('/openapi/platform/getDevicePointDayMonthYearDataList', {
                query_type: 'day', data_type: '2',
                ps_key_list: PS_KEYS,
                data_point: 'p1,p24',
                start_time: start, end_time: end,
                order: 0
            }, token);

            if (r.result_code === '1' && r.result_data) {
                let added = 0;
                // Build date map across all ps_keys first, then merge
                const dateMap = new Map();
                for (const [psKey, pointData] of Object.entries(r.result_data)) {
                    if (psKey === 'point_dict' || psKey === 'illegal_ps_key_list') continue;
                    const slug = psToSlug[psKey];
                    if (!slug) continue;

                    for (const [ptKey, values] of Object.entries(pointData)) {
                        const ptId = ptKey.replace('p', '');
                        for (const entry of values || []) {
                            const stamp = entry.time_stamp;
                            if (!stamp) continue;
                            const isoDate = stamp.substring(0, 4) + '-' + stamp.substring(4, 6) + '-' + stamp.substring(6, 8);
                            if (!dateMap.has(isoDate)) dateMap.set(isoDate, {});
                            const row = dateMap.get(isoDate);
                            const val = parseFloat(entry['2'] || '0');
                            if (ptId === '1') row[slug + '_kwh'] = Math.round(val / 10) / 100;
                            if (ptId === '24') row[slug + '_peak_kw'] = Math.round(val / 10) / 100;
                        }
                    }
                }
                // Merge into dailyHistory, update existing entries with missing data
                for (const [isoDate, row] of dateMap) {
                    const existing = dailyHistory.find(e => e.date === isoDate);
                    if (existing) {
                        Object.assign(existing, row);
                    } else {
                        dailyHistory.push({ date: isoDate, ...row });
                        added++;
                    }
                }
                console.log('[HIST]   +' + added + ' new entries');
            } else {
                console.log('[HIST]   ❌ code=' + r.result_code + ' msg=' + (r.result_msg || r.error || ''));
            }
        } catch (e) {
            console.log('[HIST]   💥 ' + (e.code || 'NET') + ': ' + (e.raw || e.msg || e.message || ''));
        }
    }

    // Add today from live data
    const todayISO = new Date().toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' });
    const todayPlants = {};
    for (const p of (liveData.plants || [])) {
        if (p.daily_kwh !== null && p.slug) todayPlants[p.slug + '_kwh'] = p.daily_kwh;
    }
    if (Object.keys(todayPlants).length > 0) {
        // Update or add today's entry
        const todayIdx = dailyHistory.findIndex(e => e.date === todayISO);
        if (todayIdx >= 0) {
            Object.assign(dailyHistory[todayIdx], todayPlants);
        } else {
            dailyHistory.push({ date: todayISO, ...todayPlants });
        }
    }

    // Sort and save
    dailyHistory.sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(HISTORY_DAILY_FILE, JSON.stringify(dailyHistory, null, 2));
    console.log('[HIST] Saved ' + dailyHistory.length + ' daily entries');

    // ─── Monthly history (fetch once per day, on first run) ───
    let monthlyHistory = [];
    if (fs.existsSync(HISTORY_MONTHLY_FILE)) {
        try { monthlyHistory = JSON.parse(fs.readFileSync(HISTORY_MONTHLY_FILE, 'utf8')); } catch (e) {}
    }

    // Only fetch monthly if we have less than 2 months or it's a new month
    const needsMonthly = monthlyHistory.length < 2 ||
        (new Date().getDate() <= 2 && monthlyHistory[monthlyHistory.length - 1]?.month !== getTahitiISO(0).substring(0, 7));

    if (needsMonthly) {
        console.log('[HIST] Fetching monthly history...');
        const endM = getTahitiMonthStr(0);
        const startM = getTahitiMonthStr(11);
        try {
            const r = await apiCall('/openapi/platform/getDevicePointDayMonthYearDataList', {
                query_type: 'month', data_type: '4',
                ps_key_list: PS_KEYS,
                data_point: 'p1',
                start_time: startM, end_time: endM,
                order: 0
            }, token);

            if (r.result_code === '1' && r.result_data) {
                const monthMap = new Map();
                for (const [psKey, pointData] of Object.entries(r.result_data)) {
                    if (psKey === 'point_dict' || psKey === 'illegal_ps_key_list') continue;
                    const slug = psToSlug[psKey];
                    if (!slug) continue;
                    const p1 = pointData.p1 || [];
                    for (const entry of p1) {
                        const stamp = entry.time_stamp;
                        if (!stamp) continue;
                        const key = stamp.substring(0, 4) + '-' + stamp.substring(4, 6);
                        if (!monthMap.has(key)) monthMap.set(key, { month: key });
                        const val = parseFloat(entry['4'] || '0');
                        monthMap.get(key)[slug + '_kwh'] = Math.round(val / 10) / 100;
                    }
                }
                monthlyHistory = [...monthMap.values()].sort((a, b) => a.month.localeCompare(b.month));
                fs.writeFileSync(HISTORY_MONTHLY_FILE, JSON.stringify(monthlyHistory, null, 2));
                console.log('[HIST] Saved ' + monthlyHistory.length + ' monthly entries');
            } else {
                console.log('[HIST] Monthly fetch failed: code=' + r.result_code + ' msg=' + (r.result_msg || r.error || ''));
            }
        } catch (e) {
            console.log('[HIST] Monthly error: ' + (e.code || e.message || e));
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────
async function main() {
    const tzTime = new Date().toLocaleString('fr-FR', { timeZone: 'Pacific/Tahiti' });
    console.log('═ iSolarCloud Extractor v4 ═\n  ' + tzTime + '\n');

    const token = await getToken();
    const plants = await getPlants(token);
    const today = getTodayStr();
    const { iso: todayISO } = getTodayPacificDate();

    const baseline = loadBaseline();
    const firstBaselineRun = !baseline || baseline.date !== today;
    const newBaselineP2 = {};

    let totalKVA = 0, totalCapW = 0, avgTemp = 0, activeCount = 0;
    const plantDetails = [];
    const nowPoint = { time: new Date().toISOString() };

    for (const plant of plants) {
        const psId = String(plant.ps_id);
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
        }

        const slug = psId === '1437035' ? 'paea' : 'temana';
        if (inv) {
            nowPoint[slug + '_power'] = +(inv.apparent_power_va / 1000).toFixed(1);
            nowPoint[slug + '_temp'] = +inv.temperature_c.toFixed(1);
        }

        let dailyKWh = null;
        if (!firstBaselineRun && baseline && baseline.isMidnight && baseline.date === today && inv) {
            const mv = baseline.p2[psId];
            if (mv !== undefined) dailyKWh = Math.max(0, (inv.total_energy_wh - mv) / 1000);
        }

        plantDetails.push({
            id: psId, slug,
            name: plant.ps_name,
            capacity_kwp: +(capW / 1000).toFixed(1),
            daily_kwh: dailyKWh !== null ? +dailyKWh.toFixed(1) : null,
            daily_pending: firstBaselineRun,
            live_power_kva: inv ? +(inv.apparent_power_va / 1000).toFixed(1) : 0,
            temperature: inv ? +inv.temperature_c.toFixed(1) : 0,
            total_mwh: inv ? +(inv.total_energy_wh / 1000000).toFixed(2) : 0,
            load_ratio: inv ? +inv.load_ratio.toFixed(3) : 0,
            model: invDev?.device_model_code || '?',
            install_date: plant.install_date || detail?.install_date || '',
        });
    }

    avgTemp = activeCount > 0 ? +(avgTemp / activeCount).toFixed(1) : 0;

    // Baseline
    if (firstBaselineRun) {
        const h = new Date().toLocaleString('en-US', { timeZone: 'Pacific/Tahiti', hour: '2-digit', hour12: false });
        saveBaseline({ date: today, p2: newBaselineP2, isMidnight: parseInt(h) < 1, savedAt: new Date().toISOString() });
        console.log('[BASELINE] ' + today + (parseInt(h) < 1 ? ' 🌙 MIDNIGHT' : ''));
    }

    // Daily totals
    const bl = loadBaseline();
    let totalDailyKWh = null;
    if (!firstBaselineRun && bl && bl.isMidnight && bl.date === today) {
        totalDailyKWh = plantDetails.reduce((sum, pd) => {
            const mv = bl.p2[pd.id];
            return mv !== undefined ? sum + Math.max(0, (pd.total_mwh * 1000000 - mv) / 1000) : sum;
        }, 0);
    }

    nowPoint.total_power = +totalKVA.toFixed(1);
    nowPoint.total_temp = avgTemp;
    nowPoint.total_daily_kwh = totalDailyKWh !== null ? +totalDailyKWh.toFixed(1) : null;

    // ─── History with full-day timeline ──
    const history = loadHistory();
    // Filter to keep only today's real points
    const todayReal = history.points.filter(p => {
        try { return p.time.startsWith(todayISO); } catch(e) { return false; }
    }).filter(p => p.paea_power !== null || p.temana_power !== null);

    // Add current point
    todayReal.push(nowPoint);

    // Generate full-day timeline and merge
    const timeline = generateTimeline(todayISO);
    const merged = mergeTimeline(timeline, todayReal, todayISO);

    // Keep last 90 days + today's merged timeline
    history.points = history.points.filter(p => {
        try { return new Date(p.time).getTime() > Date.now() - 90 * 86400000; } catch(e) { return false; }
    }).filter(p => !p.time.startsWith(todayISO)); // Remove old today points
    history.points = history.points.concat(merged);
    saveHistory(history);

    // ─── Fallback daily kWh from 5-min history ──
    // When baseline wasn't captured (PC off at midnight), compute from summed power points
    let fallbackTotal = 0;
    for (const pd of plantDetails) {
        if (pd.daily_kwh === null) {
            const sum = todayReal
                .filter(p => p[pd.slug + '_power'] > 0)
                .reduce((s, p) => s + p[pd.slug + '_power'] * 5 / 60, 0);
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

    // Check auth health
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
        dailyPending: firstBaselineRun,
        avgTemp,
        co2Tonnes,
        authWarning,
        history: merged,
        plants: plantDetails,
    };

    fs.writeFileSync(DATA_FILE, JSON.stringify(output, null, 2));

    const realCount = merged.filter(p => p.paea_power !== null).length;
    const totalSlots = merged.length;
    console.log('[SAVE] ' + DATA_FILE);
    console.log('═══ Summary ═══');
    console.log('  ⚡ ' + output.totalKVA + ' kVA  |  ☀ ' + (output.dailyKWh !== null ? output.dailyKWh + ' kWh' : '⏳'));
    console.log('  ♾ ' + output.totalMWh + ' MWh  |  🌡 ' + output.avgTemp + '°C  |  🌱 ' + output.co2Tonnes + ' t');
    console.log('  📊 ' + realCount + '/' + totalSlots + ' data points today\n');

    // ─── Fetch historical daily data ──
    await fetchAndSaveHistory(token, output);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
