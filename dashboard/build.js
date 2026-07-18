#!/usr/bin/env node
/**
 * Build self-contained dashboard HTML pages
 * Injects data JSON + persistent history + Chart.js CDN URLs
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DASHBOARD_DIR = __dirname;
const DATA_FILE = path.join(DASHBOARD_DIR, 'isolar-data.json');
const INDEX_TEMPLATE = path.join(DASHBOARD_DIR, 'index.html');
const PLANT_TEMPLATE = path.join(DASHBOARD_DIR, 'plant-template.html');
const GLOBAL_OUTPUT = path.join(DASHBOARD_DIR, 'dashboard.html');
const LANDING_TEMPLATE = path.join(DASHBOARD_DIR, 'landing.html');
const LANDING_OUTPUT = path.join(DASHBOARD_DIR, '..', 'docs', 'index.html');
const HISTORY_DAILY = path.join(DASHBOARD_DIR, 'history-daily.json');
const HISTORY_MONTHLY = path.join(DASHBOARD_DIR, 'history-monthly.json');
const PLANT_OUTPUTS = {
    '1437035': path.join(DASHBOARD_DIR, 'paea.html'),
    '1425869': path.join(DASHBOARD_DIR, 'temana.html'),
    '1847942': path.join(DASHBOARD_DIR, 'upf.html'),
};

const json = fs.existsSync(DATA_FILE) ? fs.readFileSync(DATA_FILE, 'utf8') : '{}';
const data = JSON.parse(json);

// ─── Load real history ──────────────────────────────────────
try {
    if (fs.existsSync(HISTORY_DAILY)) {
        data.history_daily = JSON.parse(fs.readFileSync(HISTORY_DAILY, 'utf8'));
        console.log('[BUILD] Loaded ' + data.history_daily.length + ' daily entries');
    }
} catch (e) {
    console.error('[BUILD] History load failed:', e.message);
}
try {
    if (fs.existsSync(HISTORY_MONTHLY)) {
        data.history_monthly = JSON.parse(fs.readFileSync(HISTORY_MONTHLY, 'utf8'));
    }
} catch (e) { /* ignore */ }

// ─── Fix CDN links ───────────────────────────────────────────
function fixCDN(html) {
    return html
        .replace(/https\s+\/\/cdn\./g, 'https://cdn.')
        .replace(/INLINE_PLACEHOLDER/g, JSON.stringify(data));
}

// ─── Build plant pages ───────────────────────────────────────
const plantTemplate = fs.readFileSync(PLANT_TEMPLATE, 'utf8');

for (const plant of (data.plants || [])) {
    const plantId = String(plant.id);
    const outputFile = PLANT_OUTPUTS[plantId];
    if (!outputFile) continue;

    const now = new Date();
    const monthName = now.toLocaleDateString('fr-FR', { timeZone: 'Pacific/Tahiti', month: 'long' });
    const year = now.toLocaleDateString('fr-FR', { timeZone: 'Pacific/Tahiti', year: 'numeric' });
    let html = plantTemplate
        .replace(/%%PLANT_ID%%/g, plantId)
        .replace(/%%PLANT_NAME%%/g, plant.name)
        .replace(/%%CURRENT_MONTH%%/g, monthName)
        .replace(/%%CURRENT_YEAR%%/g, year);

    html = fixCDN(html);
    fs.writeFileSync(outputFile, html, 'utf8');
    console.log('[BUILD] ' + plant.name + ' → ' + path.basename(outputFile));
}

// ─── Build global dashboard ──────────────────────────────────
if (fs.existsSync(INDEX_TEMPLATE)) {
    let html = fs.readFileSync(INDEX_TEMPLATE, 'utf8');
    html = fixCDN(html);
    fs.writeFileSync(GLOBAL_OUTPUT, html, 'utf8');
    console.log('[BUILD] Global → ' + path.basename(GLOBAL_OUTPUT));
}

// ─── Copy landing page to docs/ ────────────────────────────
if (fs.existsSync(LANDING_TEMPLATE)) {
    fs.copyFileSync(LANDING_TEMPLATE, LANDING_OUTPUT);
    console.log('[BUILD] Landing → ' + path.basename(LANDING_OUTPUT));
}

console.log('[BUILD] Done — ' + ((data.plants||[]).length + 2) + ' pages');
