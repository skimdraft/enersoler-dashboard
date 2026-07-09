// Mini HTTP server for iSolarCloud dashboard
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8787;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

// Landing page: redirects to dashboard
const LANDING = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Enersoler — Solar Dashboard</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0f0f0f; color: #e2e8f0; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; margin: 0; gap: 24px; }
  img { height: 64px; }
  h1 { font-size: 1.4em; font-weight: 600; }
  .links { display: flex; gap: 16px; flex-wrap: wrap; justify-content: center; }
  .links a { background: #f59e0b; color: #1a1a1a; padding: 12px 28px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 1em; transition: opacity 0.2s; }
  .links a:hover { opacity: 0.8; }
  .links a.secondary { background: rgba(255,255,255,0.08); color: #e2e8f0; border: 1px solid rgba(255,255,255,0.1); }
  .subtitle { color: #94a3b8; font-size: 0.85em; }
</style>
</head>
<body>
  <img src="https://enersoler.com/assets/images/logo-enersoler-2025-taille-infinie-5-360x83.png" alt="Enersoler">
  <h1>Dashboard Solaire</h1>
  <p class="subtitle">Données temps réel iSolarCloud · Tahiti 🇵🇫</p>
  <div class="links">
    <a href="/dashboard.html">📊 Vue Globale</a>
    <a href="/paea.html" class="secondary">🏫 Collège de Paea</a>
    <a href="/temana.html" class="secondary">🏢 Temana Import</a>
  </div>
  <p style="color:var(--muted);font-size:0.7em;margin-top:40px">Mise à jour automatique toutes les 5 minutes</p>
</body>
</html>`;

http.createServer((req, res) => {
  // Landing page at root
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(LANDING);
  }
  
  let filePath = path.join(ROOT, req.url.replace(/^\//, ''));
  
  // Security: prevent directory traversal
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  
  const ext = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  console.log(`  Global:    http://localhost:${PORT}/dashboard.html`);
  console.log(`  Paea:      http://localhost:${PORT}/paea.html`);
  console.log(`  Temana:    http://localhost:${PORT}/temana.html`);
});
