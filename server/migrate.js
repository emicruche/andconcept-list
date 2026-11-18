'use strict';

// AndConcept List — migration des données entre deux bases PostgreSQL
// (ex. Render -> Neon) : copie intégrale et idempotente de `lists` et `reservations`.
// Les id et admin_token sont copiés à l'identique : les liens partagés et les
// jetons des propriétaires continuent de fonctionner, aucune liste n'est perdue.
//
// Usage:
//   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... node server/migrate.js
//   node server/migrate.js --verify-only   (compare les compteurs sans rien écrire)
// Sur le shell Render, SOURCE_DATABASE_URL prend $DATABASE_URL par défaut.
// Les chaînes de connexion ne sont jamais affichées.

const SCHEMA = `
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
`;

const SCHEMA_STATEMENTS = SCHEMA.split(';').map(s => s.trim()).filter(Boolean);

async function ensureSchema(pool) {
  const r = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('lists', 'reservations')`
  );
  const existing = new Set(r.rows.map(x => x.table_name.toLowerCase()));
  for (const s of SCHEMA_STATEMENTS) {
    const m = s.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i);
    if (m && existing.has(m[1].toLowerCase())) continue;
    await pool.query(s);
  }
}

function makePool(pg, url) {
  return new pg.Pool({
    connectionString: url,
    ssl: url.includes('localhost') ? false : { rejectUnauthorized: false }
  });
}

async function stats(pool) {
  const l = await pool.query('SELECT count(*)::int AS n FROM lists');
  const r = await pool.query('SELECT count(*)::int AS n FROM reservations');
  const it = await pool.query('SELECT items FROM lists');
  const items = it.rows.reduce((n, row) => n + (Array.isArray(row.items) ? row.items.length : 0), 0);
  return { lists: l.rows[0].n, items, reservations: r.rows[0].n };
}

async function exportAll(pool) {
  const lists = await pool.query('SELECT id, name, admin_token, items, created_at FROM lists ORDER BY created_at');
  const reservations = await pool.query('SELECT list_id, item_id, by_name, created_at FROM reservations ORDER BY list_id, created_at');
  return { lists: lists.rows, reservations: reservations.rows };
}

async function importAll(pool, data) {
  await ensureSchema(pool);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const l of data.lists) {
      await client.query(
        `INSERT INTO lists (id, name, admin_token, items, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           admin_token = EXCLUDED.admin_token,
           items = EXCLUDED.items`,
        [l.id, l.name, l.admin_token, JSON.stringify(l.items ?? []), l.created_at]
      );
    }
    for (const r of data.reservations) {
      await client.query(
        `INSERT INTO reservations (list_id, item_id, by_name, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (list_id, item_id) DO NOTHING`,
        [r.list_id, r.item_id, r.by_name, r.created_at]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function run(opts) {
  const pg = opts.pg || require('pg');
  const log = opts.log || (m => console.log(m));
  const verifyOnly = !!opts.verifyOnly;
  const source = opts.sourcePool || makePool(pg, opts.sourceUrl);
  const target = opts.targetPool || makePool(pg, opts.targetUrl);
  try {
    await ensureSchema(target);
    const before = await stats(target);
    const data = await exportAll(source);
    const srcStats = await stats(source);
    log(`source: ${srcStats.lists} liste(s), ${srcStats.items} article(s), ${srcStats.reservations} réservation(s)`);
    if (!verifyOnly) {
      await importAll(target, data);
      log(`import: ${data.lists.length} liste(s), ${data.reservations.length} réservation(s) traités (idempotent)`);
    }
    const after = await stats(target);
    log(`cible:  ${after.lists} liste(s), ${after.items} article(s), ${after.reservations} réservation(s)`);
    const ok = after.lists >= srcStats.lists && after.items >= srcStats.items && after.reservations >= srcStats.reservations;
    log(ok ? 'VÉRIFICATION OK — la cible contient au moins toutes les données de la source' : 'VÉRIFICATION ÉCHOUÉE — compteurs inférieurs à la source');
    return { ok, srcStats, after, before };
  } finally {
    await source.end();
    await target.end();
  }
}

if (require.main === module) {
  const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL;
  const targetUrl = process.env.TARGET_DATABASE_URL;
  if (!sourceUrl || !targetUrl) {
    console.error('Variables requises: SOURCE_DATABASE_URL (ou DATABASE_URL) et TARGET_DATABASE_URL');
    process.exit(2);
  }
  run({ sourceUrl, targetUrl, verifyOnly: process.argv.includes('--verify-only') })
    .then(r => process.exit(r.ok ? 0 : 1))
    .catch(e => { console.error('Migration échouée:', e.message); process.exit(1); });
}

module.exports = { run, exportAll, importAll, stats, ensureSchema, makePool, SCHEMA };
