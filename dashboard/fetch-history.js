#!/usr/bin/env node
/**
 * fetch-history.js — iSolarCloud Historical Data Fetcher
 * 
 * Fetches real daily/monthly data via getDevicePointDayMonthYearDataList
 * Saves to history-daily.json + history-monthly.json
 * Replaces generate-history.js fake data entirely.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const D = __dirname;
const ENV_FILE = path.join(D, '..', '.env');
const TOKENS_FILE = path.join(D, 'isolar-tokens.json');

// ─── Load config ─────────────────────────────────────────────
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
        if (token) headers['Authorization'] = '*** ' + token;
        const req = https.request({ hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST', headers }, res => {
            let d = ''; res.on('data', c => d += c);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject({ code: 'PARSE' }); } });
        });
        req.on('error', e => reject({ code: 'NET', msg: e.message }));
        req.write(j); req.end();
    });
}

async function getToken() {
    let t = loadTokens();
    if (!t?.accessToken) throw new Error('No tokens');
    if (Date.now() > t.expiresAt) {
        console.log('[AUTH] Refreshing token...');
        const r = await apiCall('/openapi/apiManage/refreshToken', { refresh_token: t.refreshToken }, t.accessToken);
        t = {
            accessToken: r.access_token || r.result_data?.access_token,
            refreshToken: r.refresh_token || r.result_data?.refresh_token || t.refreshToken,
            expiresAt: Date.now() + ((r.expires_in || 172800) * 1000) - 60000
        };
        fs.writeFileSync(TOKENS_FILE, JSON.stringify(t, null, 2));
    }
    return t.accessToken;
}

// ─── Date helpers (Tahiti) ───────────────────────────────────
function getTahitiDate(dayOffset) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return d.toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' }).replace(/-/g, '');
}

function getTahitiMonth(monthOffset) {
    const d = new Date();
    d.setMonth(d.getMonth() - monthOffset);
    return d.toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' }).substring(0, 7).replace(/-/g, '');
}

function getTahitiISODate(dayOffset) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return d.toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' });
}

// ─── Plant config ─────────────────────────────────────────────
const PLANTS = {
    '1437035': { slug: 'paea', psKey: '1437035_1_1_2', name: 'Paea' },
    '1425869': { slug: 'temana', psKey: '1425869_1_1_1', name: 'Temana' },
};

const PS_KEYS = Object.values(PLANTS).map(p => p.psKey);
const PS_KEY_TO_SLUG = {};
for (const [id, info] of Object.entries(PLANTS)) {
    PS_KEY_TO_SLUG[info.psKey] = info.slug;
}

// ─── Main fetcher ────────────────────────────────────────────
async function fetchHistory(queryType, startTime, endTime, token) {
    const body = {
        query_type: queryType,
        data_type: queryType === 'day' ? '2' : '4', // daily=peak, monthly/yearly=total
        ps_key_list: PS_KEYS,
        data_point: 'p1,p2,p24,p14,p4', // yield today, total yield, AC power, DC power, temp
        start_time: startTime,
        end_time: endTime,
        order: 0,
        is_get_point_dict: '1'
    };

    console.log(`  Fetching ${queryType} ${startTime} → ${endTime}...`);
    const r = await apiCall('/openapi/platform/getDevicePointDayMonthYearDataList', body, token);

    if (r.result_code !== '1') {
        console.error('  ❌ Failed: ' + (r.result_msg || r.error || JSON.stringify(r).slice(0, 200)));
        return null;
    }

    return r.result_data;
}

// ─── Parse results into daily entries ─────────────────────────
function parseDailyResults(resultData) {
    const entries = []; // { date, paea_kwh, temana_kwh, paea_peak_kw, temana_peak_kw, ... }
    const dateMap = new Map();

    for (const [psKey, pointData] of Object.entries(resultData || {})) {
        if (psKey === 'point_dict' || psKey === 'illegal_ps_key_list') continue;
        const slug = PS_KEY_TO_SLUG[psKey];
        if (!slug) continue;

        // pointData = { p1: [{...}], p24: [{...}], ... }
        for (const [pointKey, values] of Object.entries(pointData)) {
            const pointId = pointKey.replace('p', '');
            for (const entry of values || []) {
                const date = entry.time_stamp; // YYYYMMDD format
                if (!date) continue;

                // Convert YYYYMMDD → YYYY-MM-DD
                const isoDate = date.substring(0, 4) + '-' + date.substring(4, 6) + '-' + date.substring(6, 8);
                const val = parseFloat(entry['2'] || entry['4'] || '0');

                if (!dateMap.has(isoDate)) {
                    dateMap.set(isoDate, { date: isoDate, paea_kwh: 0, temana_kwh: 0 });
                }

                const row = dateMap.get(isoDate);

                if (pointId === '1') {
                    // Daily yield in Wh → convert to kWh
                    row[slug + '_kwh'] = Math.round(val / 10) / 100; // Wh → kWh, 2 decimals
                } else if (pointId === '24') {
                    // AC power peak in W → kW
                    row[slug + '_peak_kw'] = Math.round(val / 10) / 100;
                }
            }
        }
    }

    // Sort by date
    const sorted = [...dateMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    return sorted;
}

// ─── Parse monthly results ────────────────────────────────────
function parseMonthlyResults(resultData) {
    const monthlyMap = new Map();

    for (const [psKey, pointData] of Object.entries(resultData || {})) {
        if (psKey === 'point_dict' || psKey === 'illegal_ps_key_list') continue;
        const slug = PS_KEY_TO_SLUG[psKey];
        if (!slug) continue;

        for (const [pointKey, values] of Object.entries(pointData)) {
            const pointId = pointKey.replace('p', '');
            for (const entry of values || []) {
                const stamp = entry.time_stamp; // YYYYMM format
                if (!stamp) continue;

                const key = stamp.substring(0, 4) + '-' + stamp.substring(4, 6);
                const val = parseFloat(entry['4'] || '0'); // data_type 4 = total

                if (!monthlyMap.has(key)) {
                    monthlyMap.set(key, { month: key, paea_kwh: 0, temana_kwh: 0 });
                }

                const row = monthlyMap.get(key);
                if (pointId === '1') {
                    row[slug + '_kwh'] = Math.round(val / 10) / 100;
                }
            }
        }
    }

    const sorted = [...monthlyMap.values()].sort((a, b) => a.month.localeCompare(b.month));
    return sorted;
}

// ─── Main ─────────────────────────────────────────────────────
// ─── Delay helper ───────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithRetry(queryType, start, end, token, maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        if (attempt > 0) {
            console.log(`  🔄 Retry ${attempt + 1}/${maxRetries}...`);
            await sleep(2000);
            token = await getToken();
        }
        const result = await fetchHistory(queryType, start, end, token);
        if (result !== null || attempt === maxRetries - 1) return result;
    }
    return null;
}

async function main() {
    console.log('═ iSolarCloud History Fetcher ═\n');

    let token = await getToken();
    console.log('Token OK\n');

    // ─── 1. Fetch daily data — batch by month ────────────────
    console.log('─── Daily History (90 days, by 30-day chunks) ───');
    let dailyEntries = [];
    let allDates = new Set();

    // Fetch in 3 batches of 30 days
    for (let batch = 0; batch < 3; batch++) {
        const endOffset = batch * 30 + 1;
        const startOffset = (batch + 1) * 30;
        const start = getTahitiDate(startOffset);
        const end = getTahitiDate(endOffset);
        console.log(`  Batch ${batch + 1}/3: ${start} → ${end}`);

        const result = await fetchWithRetry('day', start, end, token);
        if (result) {
            const entries = parseDailyResults(result);
            for (const e of entries) {
                if (!allDates.has(e.date)) {
                    allDates.add(e.date);
                    dailyEntries.push(e);
                }
            }
            console.log(`    ✅ ${entries.length} entries`);
        }
        await sleep(1500);
    }

    // Also add today from live data (isolar-data.json)
    try {
        const liveData = JSON.parse(fs.readFileSync(path.join(D, 'isolar-data.json'), 'utf8'));
        const todayISO = new Date().toLocaleDateString('fr-CA', { timeZone: 'Pacific/Tahiti' });
        const existingToday = dailyEntries.find(e => e.date === todayISO);
        if (!existingToday && liveData.plants) {
            const todayEntry = { date: todayISO, paea_kwh: 0, temana_kwh: 0 };
            for (const p of liveData.plants) {
                if (p.daily_kwh !== null && p.slug) {
                    todayEntry[p.slug + '_kwh'] = p.daily_kwh;
                }
            }
            if (todayEntry.paea_kwh > 0 || todayEntry.temana_kwh > 0) {
                dailyEntries.unshift(todayEntry);
                console.log('  📍 Added today live data');
            }
        }
    } catch (e) { /* ignore */ }

    // ─── 2. Fetch monthly data (last 12 months) ───────────────
    console.log('\n─── Monthly History (12 months) ───');
    await sleep(2000);
    token = await getToken();
    const endMonth = getTahitiMonth(0);
    const startMonth = getTahitiMonth(11);
    console.log(`  Range: ${startMonth} → ${endMonth}`);

    const monthlyResults = await fetchWithRetry('month', startMonth, endMonth, token);
    let monthlyEntries = [];

    if (monthlyResults) {
        monthlyEntries = parseMonthlyResults(monthlyResults);
        console.log(`  ✅ Got ${monthlyEntries.length} monthly entries`);
    }

    // ─── 3. Save files ────────────────────────────────────────
    const dailyFile = path.join(D, 'history-daily.json');
    fs.writeFileSync(dailyFile, JSON.stringify(dailyEntries, null, 2));
    console.log('\n[SAVE] Daily → ' + path.basename(dailyFile) + ' (' + dailyEntries.length + ' days)');

    const monthlyFile = path.join(D, 'history-monthly.json');
    fs.writeFileSync(monthlyFile, JSON.stringify(monthlyEntries, null, 2));
    console.log('[SAVE] Monthly → ' + path.basename(monthlyFile) + ' (' + monthlyEntries.length + ' months)');

    // ─── Summary ──────────────────────────────────────────────
    console.log('\n═══ Summary ═══');
    if (dailyEntries.length > 0) {
        const last = dailyEntries[dailyEntries.length - 1];
        console.log(`  Last day (${last.date}): Paea=${last.paea_kwh} kWh, Temana=${last.temana_kwh} kWh`);
    }
    if (monthlyEntries.length > 0) {
        const lastM = monthlyEntries[monthlyEntries.length - 1];
        console.log(`  Last month (${lastM.month}): Paea=${lastM.paea_kwh} kWh, Temana=${lastM.temana_kwh} kWh`);
    }
    console.log('');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
