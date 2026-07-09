#!/usr/bin/env node
/**
 * Persistent daily history manager (lightweight)
 * - First run: generates 365 days of fake deterministic daily kWh
 * - Subsequent runs: merges in new real daily data from isolar-data.json
 * - Outputs compact JSON array to stdout for build.js
 */

const fs = require('fs');
const path = require('path');

const DASHBOARD_DIR = __dirname;
const DATA_FILE = path.join(DASHBOARD_DIR, 'isolar-data.json');
const HISTORY_FILE = path.join(DASHBOARD_DIR, 'history-daily.json');
const SEED_FILE = path.join(DASHBOARD_DIR, '.history-seed');

function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

function getSeed() {
  if (fs.existsSync(SEED_FILE)) return parseInt(fs.readFileSync(SEED_FILE, 'utf8'), 10);
  const seed = Math.floor(Math.random() * 2147483647);
  fs.writeFileSync(SEED_FILE, String(seed), 'utf8');
  console.error('[HISTORY] New seed:', seed);
  return seed;
}

function generateFakeDaily(kwp, seed) {
  const rand = mulberry32(seed);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const entries = [];
  for (let dayOffset = 364; dayOffset >= 1; dayOffset--) {
    const d = new Date(today); d.setDate(today.getDate() - dayOffset);
    const dateStr = d.toISOString().substring(0, 10);
    const mon = d.getMonth();
    let sf;
    if (mon >= 10) sf = 0.95;
    else if (mon <= 2) sf = 0.45;
    else sf = 0.70;
    const kwh = Math.round(kwp * 4.5 * (0.3 + rand() * 0.7) * sf * 10) / 10;
    entries.push({ date: dateStr, kwh });
  }
  return entries;
}

// ── Main ──
const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const seed = getSeed();

let dailyHistory = [];
if (fs.existsSync(HISTORY_FILE)) {
  dailyHistory = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  console.error('[HISTORY] Loaded', dailyHistory.length, 'daily entries');
} else {
  const avgKwp = (data.plants || []).reduce((s, p) => s + (p.capacity_kwp || 0), 0) / Math.max(1, (data.plants || []).length);
  dailyHistory = generateFakeDaily(avgKwp || 50, seed);
  console.error('[HISTORY] Generated', dailyHistory.length, 'fake daily entries');
}

// Merge real data: compute daily kWh from today's 5-min history points
const realHistory = data.history || [];
const todayDate = new Date().toISOString().substring(0, 10);

// Group real points by plant
const realDaily = {};
for (const p of realHistory) {
  if (!p.time) continue;
  const date = p.time.substring(0, 10);
  if (!realDaily[date]) realDaily[date] = { paea: 0, temana: 0 };
  if (p.paea_power > 0) realDaily[date].paea += p.paea_power * (5 / 60);
  if (p.temana_power > 0) realDaily[date].temana += p.temana_power * (5 / 60);
}

// Update history entries with real data
const histMap = {};
for (const e of dailyHistory) histMap[e.date] = e;

for (const [date, vals] of Object.entries(realDaily)) {
  const paeaKwh = Math.round(vals.paea * 10) / 10;
  const temanaKwh = Math.round(vals.temana * 10) / 10;
  if (histMap[date]) {
    histMap[date].paea_kwh = paeaKwh > 0 ? paeaKwh : histMap[date].paea_kwh || histMap[date].kwh;
    histMap[date].temana_kwh = temanaKwh > 0 ? temanaKwh : histMap[date].temana_kwh || histMap[date].kwh;
  }
}

// Sort by date
dailyHistory.sort((a, b) => a.date.localeCompare(b.date));

// Keep max 400 days
const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 400);
const cutoffStr = cutoff.toISOString().substring(0, 10);
dailyHistory = dailyHistory.filter(e => e.date >= cutoffStr);

fs.writeFileSync(HISTORY_FILE, JSON.stringify(dailyHistory), 'utf8');
console.error('[HISTORY] Saved', dailyHistory.length, 'daily entries');

// Output clean JSON to stdout
process.stdout.write(JSON.stringify(dailyHistory));
