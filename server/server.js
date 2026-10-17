'use strict';

// AndConcept List — serveur léger, zéro dépendance (Node >= 16).
// Usage: node server/server.js  (PORT=3000 par défaut, DATA_FILE pour persistance)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ROOT = path.join(__dirname, '..');

let db = { lists: {}, reservations: {} };
try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* premier démarrage */ }
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(db), () => {}), 100);
}

function uid() {
  return require('crypto').randomBytes(9).toString('base64url');
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { reject(new Error('JSON invalide')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  // ---- API ----
  if (p === '/api/health' && req.method === 'GET')
    return json(res, 200, { ok: true, app: 'AndConcept List' });

  if (p === '/api/lists' && req.method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    if (!name) return json(res, 400, { error: 'nom manquant' });
    const id = uid();
    const adminToken = uid();
    db.lists[id] = { id, name, items: [], createdAt: Date.now(), adminToken };
    persist();
    return json(res, 201, { id, adminToken });
  }

  const m = p.match(/^\/api\/lists\/([^/]+)$/);
  if (m && req.method === 'GET') {
    const list = db.lists[m[1]];
    if (!list) return json(res, 404, { error: 'liste inconnue' });
    const reserved = db.reservations[m[1]] || {};
    return json(res, 200, {
      id: list.id, name: list.name, items: list.items,
      reservedIds: Object.keys(reserved)
    });
  }

  if (m && req.method === 'PUT') {
    const list = db.lists[m[1]];
    if (!list) return json(res, 404, { error: 'liste inconnue' });
    const auth = req.headers['x-admin-token'];
    if (auth !== list.adminToken) return json(res, 403, { error: 'non autorisé' });
    const body = await readBody(req);
    if (typeof body.name === 'string' && body.name.trim()) list.name = body.name.trim();
    if (Array.isArray(body.items)) list.items = body.items;
    persist();
    return json(res, 200, { ok: true });
  }

  if (m && req.method === 'DELETE') {
    const list = db.lists[m[1]];
    if (!list) return json(res, 404, { error: 'liste inconnue' });
    if (req.headers['x-admin-token'] !== list.adminToken) return json(res, 403, { error: 'non autorisé' });
    delete db.lists[m[1]];
    delete db.reservations[m[1]];
    persist();
    return json(res, 200, { ok: true });
  }

  const rm = p.match(/^\/api\/lists\/([^/]+)\/reserve$/);
  if (rm && req.method === 'POST') {
    const id = rm[1];
    const list = db.lists[id];
    if (!list) return json(res, 404, { error: 'liste inconnue' });
    const body = await readBody(req);
    const itemId = String(body.itemId || '');
    if (!list.items.some(i => i.id === itemId)) return json(res, 400, { error: 'article inconnu' });
    db.reservations[id] = db.reservations[id] || {};
    if (db.reservations[id][itemId]) return json(res, 409, { error: 'déjà réservé' });
    // Secret : le nom du réservataire n'est jamais renvoyé au propriétaire de la liste.
    db.reservations[id][itemId] = { by: String(body.by || 'Quelqu\'un'), ts: Date.now() };
    persist();
    return json(res, 200, { ok: true });
  }

  if (rm && req.method === 'DELETE') {
    const id = rm[1];
    const body = await readBody(req);
    const itemId = String(body.itemId || '');
    const secret = String(body.secret || '');
    const r = (db.reservations[id] || {})[itemId];
    if (!r) return json(res, 404, { error: 'réservation inconnue' });
    // Seul le réservataire (via son secret local) peut annuler sa réservation.
    if (r.secret && r.secret !== secret) return json(res, 403, { error: 'non autorisé' });
    delete db.reservations[id][itemId];
    persist();
    return json(res, 200, { ok: true });
  }

  // ---- Fichiers statiques (PWA) ----
  let file = p === '/' ? '/index.html' : p;
  const full = path.normalize(path.join(ROOT, file));
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' };
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
    res.end(buf);
  });
});

server.listen(PORT, () => console.log(`AndConcept List — serveur sur le port ${PORT}`));
