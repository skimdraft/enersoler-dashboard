#!/usr/bin/env node
/**
 * iSolarCloud Point Scanner — discovers all available data points
 */
const https = require('https');
const fs = require('fs');

const TOKENS_FILE = __dirname + '/isolar-tokens.json';
const ENV_FILE = __dirname + '/../.env';

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

const ENV = loadEnv();
const TOKENS = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));

function apiCall(p, body, token) {
    return new Promise((resolve, reject) => {
        const b = JSON.stringify({ ...body, appkey: ENV.ISOLAR_APP_KEY, lang: '_fr_FR' });
        const req = https.request({
            hostname: 'gateway.isolarcloud.com.hk', path: p, method: 'POST',
            headers: { 'Content-Type': 'application/json;charset=UTF-8', 'x-access-key': ENV.ISOLAR_APP_SECRET, 'sys_code': '901', 'Authorization': 'Bearer ' + token }
        }, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d))); });
        req.on('error', e => reject(e));
        req.write(b); req.end();
    });
}

async function getInverterPsKey(psId, token) {
    const r = await apiCall('/openapi/platform/getDeviceListByPsId', { ps_id: psId, page: 1, size: 50 }, token);
    const devices = r.result_data?.pageList || [];
    const inv = devices.find(d => d.device_type === 1);
    return inv ? inv.ps_key : null;
}

async function scanAll(psKey, token) {
    const all = {};
    for (const range of [[1,50],[51,100],[100,150],[150,200]]) {
        const ids = [];
        for (let i=range[0]; i<=range[1]; i++) ids.push(String(i));
        const r = await apiCall('/openapi/platform/getDeviceRealTimeData', {
            ps_key_list: [psKey], point_id_list: ids, device_type: 1
        }, token);
        const dp = r.result_data?.device_point_list?.[0]?.device_point || {};
        for (const [k, v] of Object.entries(dp)) {
            if (k.startsWith('p') && v !== null && v !== undefined && v !== '') {
                all[k] = parseFloat(v);
            }
        }
    }
    return all;
}

// ─── Point ID reference (known Sungrow SG50CX-P2 registers) ──
const KNOWN = {
    p1:  'Puissance active (W)',
    p2:  'Énergie totale (Wh)',
    p3:  'Énergie du jour (Wh)',
    p4:  'Température onduleur (°C)',
    p5:  'Tension phase A (V)',
    p6:  'Courant phase A (A)',
    p7:  'Tension phase B (V)',
    p8:  'Courant phase B (A)',
    p9:  'Tension phase C (V)',
    p10: 'Courant phase C (A)',
    p14: 'Puissance DC totale (W)',
    p18: 'Tension DC string 1 (V)',
    p19: 'Tension DC string 2 (V)',
    p20: 'Tension DC string 3 (V)',
    p21: 'Courant DC string 1 (A)',
    p22: 'Courant DC string 2 (A)',
    p23: 'Courant DC string 3 (A)',
    p24: 'Puissance apparente (VA)',
    p25: 'Puissance réactive (var)',
    p26: 'Facteur de puissance (cos φ)',
    p27: 'Fréquence réseau (Hz)',
    p28: 'Rendement (%)',
    p29: 'Statut défaut (0=OK)',
    p43: 'Puissance batterie (W)',
    p44: 'Tension bus DC (V)',
    // Guesses for unknown range:
    p70: 'Courant MPPT 1 (A)',
    p72: 'Courant MPPT 2 (A)',
    p74: 'Courant MPPT 3 (A)',
    p45: 'Tension nominale AC (V)',
    p46: 'Courant nominal AC (A)',
    p86: 'Facteur déclassement',
    p87: 'Puissance assignée (W)',
    p88: 'Énergie mensuelle (Wh)',
    p89: 'Puissance DC assignée (W)',
    p90: 'Puissance réactive absorbée (var)',
    p94: 'Tension ligne AB (V)',
    p95: 'Tension ligne BC (V)',
    p96: 'Tension phase A-N (V)',
    p97: 'Tension phase B-N (V)',
    p98: 'Tension phase C-N (V)',
    p100:'Tension assignée AC (V)',
    p117:'Résistance isolation + (kΩ)',
    p118:'Résistance isolation - (kΩ)',
};

async function main() {
    const token = TOKENS.accessToken;
    
    for (const psId of ['1437035', '1425869']) {
        const psKey = await getInverterPsKey(psId, token);
        if (!psKey) continue;
        
        const name = psId === '1437035' ? 'Collège de Paea' : 'Temana Import';
        const points = await scanAll(psKey, token);
        
        console.log('═══ ' + name + ' ═══');
        console.log('ps_key:', psKey);
        console.log('Total points: ' + Object.keys(points).length);
        console.log('');
        
        // Group by known/unknown
        const known = [];
        const unknown = [];
        for (const [k, v] of Object.entries(points)) {
            const num = parseInt(k.substring(1));
            if (KNOWN[k]) {
                known.push([num, k, v, KNOWN[k]]);
            } else {
                unknown.push([num, k, v]);
            }
        }
        
        console.log('── Connus ──');
        known.sort((a,b)=>a[0]-b[0]);
        known.forEach(([n,k,v,d]) => {
            console.log('  ' + k.padEnd(5) + '= ' + String(v).padStart(12) + '  ' + d);
        });
        
        console.log('\n── Inconnus ──');
        unknown.sort((a,b)=>a[0]-b[0]);
        unknown.forEach(([n,k,v]) => {
            console.log('  ' + k.padEnd(5) + '= ' + String(v).padStart(12));
        });
        console.log('');
    }
}

main().catch(e => console.error(e));
