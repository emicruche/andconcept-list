'use strict';

// AndConcept List — serveur, Node >= 16.
// Persistance: PostgreSQL si DATABASE_URL est défini, sinon fichier JSON (local).
// Usage: node server/server.js  (PORT=3000 par défaut)

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ROOT = path.join(__dirname, '..');
const DATABASE_URL = process.env.DATABASE_URL;

// ---------- Couche de stockage ----------
let pg = null;
if (DATABASE_URL) {
  try { pg = require('pg'); } catch (e) { console.error('Driver pg non chargé:', e.message); pg = null; }
} else {
  console.error('DIAGNOSTIC: DATABASE_URL absent des variables d\'environnement');
}

let store;

if (pg) {
  const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false } });
  store = {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS lists (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          admin_token TEXT NOT NULL,
          items JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS reservations (
          list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
          item_id TEXT NOT NULL,
          by_name TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (list_id, item_id)
        );
      `);
    },
    async createList(id, name, adminToken) {
      await pool.query('INSERT INTO lists (id, name, admin_token) VALUES ($1, $2, $3)', [id, name, adminToken]);
    },
    async getList(id) {
      const r = await pool.query('SELECT id, name, admin_token, items FROM lists WHERE id = $1', [id]);
      if (r.rowCount === 0) return null;
      const res = await pool.query('SELECT item_id FROM reservations WHERE list_id = $1', [id]);
      return { id: r.rows[0].id, name: r.rows[0].name, adminToken: r.rows[0].admin_token, items: r.rows[0].items, reservedIds: res.rows.map(x => x.item_id) };
    },
    async updateList(id, name, items) {
      if (name !== undefined && items !== undefined)
        return (await pool.query('UPDATE lists SET name = $2, items = $3 WHERE id = $1', [id, name, items])).rowCount;
      if (items !== undefined)
        return (await pool.query('UPDATE lists SET items = $2 WHERE id = $1', [id, JSON.stringify(items)])).rowCount;
      if (name !== undefined)
        return (await pool.query('UPDATE lists SET name = $2 WHERE id = $1', [id, name])).rowCount;
      return 0;
    },
    async deleteList(id) {
      await pool.query('DELETE FROM reservations WHERE list_id = $1', [id]);
      return (await pool.query('DELETE FROM lists WHERE id = $1', [id])).rowCount;
    },
    async reserve(listId, itemId, by) {
      const r = await pool.query(
        'INSERT INTO reservations (list_id, item_id, by_name) VALUES ($1, $2, $3) ON CONFLICT (list_id, item_id) DO NOTHING',
        [listId, itemId, by]
      );
      return r.rowCount; // 0 si déjà réservé
    },
    async unreserve(listId, itemId) {
      return (await pool.query('DELETE FROM reservations WHERE list_id = $1 AND item_id = $2', [listId, itemId])).rowCount;
    }
  };
} else {
  // Repli fichier JSON (mode local / sans base)
  let db = { lists: {}, reservations: {} };
  try { db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch { /* premier démarrage */ }
  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => fs.writeFile(DATA_FILE, JSON.stringify(db), () => {}), 100);
  };
  store = {
    kind: 'file',
    async init() {},
    async createList(id, name, adminToken) { db.lists[id] = { id, name, adminToken, items: [] }; persist(); },
    async getList(id) {
      const l = db.lists[id];
      if (!l) return null;
      return { id: l.id, name: l.name, adminToken: l.adminToken, items: l.items, reservedIds: Object.keys(db.reservations[id] || {}) };
    },
    async updateList(id, name, items) {
      const l = db.lists[id];
      if (!l) return 0;
      if (name !== undefined) l.name = name;
      if (items !== undefined) l.items = items;
      persist();
      return 1;
    },
    async deleteList(id) {
      if (!db.lists[id]) return 0;
      delete db.lists[id];
      delete db.reservations[id];
      persist();
      return 1;
    },
    async reserve(listId, itemId, by) {
      db.reservations[listId] = db.reservations[listId] || {};
      if (db.reservations[listId][itemId]) return 0;
      db.reservations[listId][itemId] = { by, ts: Date.now() };
      persist();
      return 1;
    },
    async unreserve(listId, itemId) {
      const r = db.reservations[listId];
      if (!r || !r[itemId]) return 0;
      delete r[itemId];
      persist();
      return 1;
    }
  };
}

// ---------- Utilitaires ----------
function uid() {
  return require('crypto').randomBytes(9).toString('base64url');
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
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

// ---------- Serveur ----------
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/health' && req.method === 'GET')
      return json(res, 200, { ok: true, app: 'AndConcept List', store: store.kind });

    if (p === '/api/lists' && req.method === 'POST') {
      const body = await readBody(req);
      const name = String(body.name || '').trim();
      if (!name) return json(res, 400, { error: 'nom manquant' });
      const id = uid();
      const adminToken = uid();
      await store.createList(id, name, adminToken);
      return json(res, 201, { id, adminToken });
    }

    const m = p.match(/^\/api\/lists\/([^/]+)$/);
    if (m && req.method === 'GET') {
      const list = await store.getList(m[1]);
      if (!list) return json(res, 404, { error: 'liste inconnue' });
      return json(res, 200, { id: list.id, name: list.name, items: list.items, reservedIds: list.reservedIds });
    }

    if (m && req.method === 'PUT') {
      const list = await store.getList(m[1]);
      if (!list) return json(res, 404, { error: 'liste inconnue' });
      if (req.headers['x-admin-token'] !== list.adminToken) return json(res, 403, { error: 'non autorisé' });
      const body = await readBody(req);
      const n = await store.updateList(m[1], body.name !== undefined ? String(body.name).trim() || undefined : undefined, body.items);
      return json(res, 200, { ok: true });
    }

    if (m && req.method === 'DELETE') {
      const list = await store.getList(m[1]);
      if (!list) return json(res, 404, { error: 'liste inconnue' });
      if (req.headers['x-admin-token'] !== list.adminToken) return json(res, 403, { error: 'non autorisé' });
      await store.deleteList(m[1]);
      return json(res, 200, { ok: true });
    }

    const rm = p.match(/^\/api\/lists\/([^/]+)\/reserve$/);
    if (rm && req.method === 'POST') {
      const list = await store.getList(rm[1]);
      if (!list) return json(res, 404, { error: 'liste inconnue' });
      const body = await readBody(req);
      const itemId = String(body.itemId || '');
      if (!list.items.some(i => i.id === itemId)) return json(res, 400, { error: 'article inconnu' });
      const ok = await store.reserve(rm[1], itemId, String(body.by || 'Quelqu\'un'));
      if (!ok) return json(res, 409, { error: 'déjà réservé' });
      return json(res, 200, { ok: true });
    }

    if (rm && req.method === 'DELETE') {
      const body = await readBody(req);
      const n = await store.unreserve(rm[1], String(body.itemId || ''));
      if (!n) return json(res, 404, { error: 'réservation inconnue' });
      return json(res, 200, { ok: true });
    }

    // Aperçu dynamique pour WhatsApp (mode synchronisé)
    if (p === '/index.html' && req.method === 'GET' && url.searchParams.has('list')) {
      const list = await store.getList(url.searchParams.get('list'));
      const title = list ? list.name : 'Liste de cadeaux';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<title>${title.replace(/</g, '&lt;')} — AndConcept List</title>
<meta property="og:title" content="${title.replace(/</g, '&lt;')} 🎁 — AndConcept List">
<meta property="og:description" content="Une liste de cadeaux partagée avec vous — filtrez par budget et réservez en secret.">
<meta property="og:image" content="https://andconcept-list.onrender.com/icon-512.png">
<meta http-equiv="refresh" content="0; url=#/s/srv:${url.searchParams.get('list')}">
</head><body></body></html>`);
    }

    // Manifest dynamique: icônes selon la saison (Noël 1 nov - 6 janv)
    if (p === '/manifest.json' && req.method === 'GET') {
      const now = new Date();
      const m = now.getMonth();
      const d = now.getDate();
      const isXmas = (m >= 10) || (m === 0 && d <= 6);
      const prefix = isXmas ? 'icon-noel' : 'icon-store';
      const manifest = {
        name: 'AndConcept List — Listes de cadeaux partagées',
        short_name: 'AndConcept List',
        description: 'Créez votre liste d\'idées cadeaux en magasin et partagez-la avec vos proches, qui filtrent par budget et réservent en secret.',
        start_url: './index.html',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#f2cac7',
        theme_color: '#fc5185',
        lang: 'fr',
        icons: [
          { src: `${prefix}-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: `${prefix}-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: `${prefix}-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      };
      return json(res, 200, manifest);
    }

    // og:image dynamique selon la saison (carte WhatsApp)
    if (p === '/active-icon' && req.method === 'GET') {
      const now = new Date();
      const m = now.getMonth(); // 0 = janvier
      const d = now.getDate();
      const isXmas = (m >= 10) || (m === 0 && d <= 6);
      res.writeHead(302, { Location: isXmas ? '/icon-noel-512.png' : '/icon-store-512.png' });
      return res.end();
    }
    if (p === '/active-icon-192' && req.method === 'GET') {
      const now = new Date();
      const m = now.getMonth();
      const d = now.getDate();
      const isXmas = (m >= 10) || (m === 0 && d <= 6);
      res.writeHead(302, { Location: isXmas ? '/icon-noel-192.png' : '/icon-store-192.png' });
      return res.end();
    }

    // Fichiers statiques (PWA)
    let file = p === '/' ? '/index.html' : p;
    const full = path.normalize(path.join(ROOT, file));
    if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(full)] || 'application/octet-stream' });
      res.end(buf);
    });
  } catch (e) {
    json(res, 500, { error: 'erreur interne' });
  }
});

store.init().then(() => {
  server.listen(PORT, () => console.log(`AndConcept List — serveur sur le port ${PORT} (stockage: ${store.kind})`));
  if (store.kind === 'file') console.error('DIAGNOSTIC: mode fichier — vérifiez DATABASE_URL (service web > Environment) et la connexion à la base');
}).catch(e => {
  console.error('Échec initialisation stockage:', e.message);
  process.exit(1);
});
