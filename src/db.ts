/**
 * DuckDB schema + helpers for ZoQR.
 *
 * Each tenant has its own DuckDB file at tenants/<tenant>/data.duckdb.
 * Helpers here are the ONLY place that writes SQL — route handlers
 * import from here.
 *
 * Schema:
 *   wedges       — installed wedge definitions (config + version + base URL)
 *   qrs          — short slugs -> content (JSON: blocks, form, meta)
 *   scans        — append-only scan log (slug, ua, ip-hash, referer, ts)
 *   submissions  — form responses attached to a QR
 */
import { Database } from "bun:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Wedge = {
  id: string;
  name: string;
  version: string;
  base_url: string;
  config_json: string;
  installed_at: string;
};

export type QR = {
  slug: string;
  wedge_id: string | null;
  title: string;
  content_json: string;
  status: "active" | "inactive";
  location: string | null;
  tags_json: string;
  created_at: string;
  updated_at: string;
};

export type Scan = {
  id: number;
  slug: string;
  user_agent: string | null;
  ip_hash: string | null;
  referer: string | null;
  scanned_at: string;
};

export type Submission = {
  id: number;
  slug: string;
  form_data_json: string;
  submitted_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wedges (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  version      TEXT NOT NULL,
  base_url     TEXT NOT NULL,
  config_json  TEXT NOT NULL DEFAULT '{}',
  installed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS qrs (
  slug         TEXT PRIMARY KEY,
  wedge_id     TEXT,
  title        TEXT NOT NULL,
  content_json TEXT NOT NULL DEFAULT '{}',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  location     TEXT,
  tags_json    TEXT NOT NULL DEFAULT '[]',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (wedge_id) REFERENCES wedges(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS scans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL,
  user_agent  TEXT,
  ip_hash     TEXT,
  referer     TEXT,
  scanned_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_scans_slug ON scans(slug);
CREATE INDEX IF NOT EXISTS idx_scans_time ON scans(scanned_at);

CREATE TABLE IF NOT EXISTS submissions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL,
  form_data_json  TEXT NOT NULL,
  submitted_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_submissions_slug ON submissions(slug);
`;

const dbCache = new Map<string, Database>();

export function getDb(tenant: string): Database {
  if (dbCache.has(tenant)) return dbCache.get(tenant)!;
  const dir = join(process.cwd(), "tenants", tenant);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = new Database(join(dir, "data.duckdb"));
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  // Additive migrations for older DBs that predate these columns.
  // SQLite has no "ADD COLUMN IF NOT EXISTS", so guard with try/catch.
  safeAddColumn(db, "qrs", "location", "TEXT");
  safeAddColumn(db, "qrs", "tags_json", "TEXT", "'[]'");
  safeCreateIndex(db, "idx_qrs_location", "qrs (location)");
  dbCache.set(tenant, db);
  return db;
}

function safeAddColumn(
  db: Database,
  table: string,
  column: string,
  typeSql: string,
  defaultSql?: string
): void {
  try {
    const def = defaultSql ? ` DEFAULT ${defaultSql}` : "";
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}${def}`);
  } catch (e) {
    // "duplicate column name" → already migrated. Anything else: rethrow.
    if (!String((e as Error).message).match(/duplicate column name/i)) throw e;
  }
}

function safeCreateIndex(db: Database, name: string, spec: string): void {
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ON ${spec}`);
  } catch {
    // Index creation is idempotent via IF NOT EXISTS; failure here is non-fatal.
  }
}

// ---- Wedges ----

export function installWedge(
  tenant: string,
  w: { id: string; name: string; version: string; base_url: string; config?: unknown }
): Wedge {
  const db = getDb(tenant);
  db.run(
    `INSERT OR REPLACE INTO wedges (id, name, version, base_url, config_json)
     VALUES (?, ?, ?, ?, ?)`,
    [w.id, w.name, w.version, w.base_url, JSON.stringify(w.config ?? {})]
  );
  return getWedge(tenant, w.id)!;
}

export function getWedge(tenant: string, id: string): Wedge | null {
  const db = getDb(tenant);
  return (
    (db.query("SELECT * FROM wedges WHERE id = ?").get(id) as Wedge | null) ??
    null
  );
}

export function listWedges(tenant: string): Wedge[] {
  const db = getDb(tenant);
  return db.query("SELECT * FROM wedges ORDER BY installed_at DESC").all() as Wedge[];
}

export function uninstallWedge(tenant: string, id: string): boolean {
  const db = getDb(tenant);
  const r = db.run("DELETE FROM wedges WHERE id = ?", [id]);
  return r.changes > 0;
}

// ---- QRs ----

export type QRSpec = {
  slug: string;
  title: string;
  wedge_id?: string | null;
  content: unknown;
  location?: string | null;
  tags?: string[];
};

export function createQR(tenant: string, qr: QRSpec): QR {
  const db = getDb(tenant);
  db.run(
    `INSERT INTO qrs (slug, wedge_id, title, content_json, location, tags_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      qr.slug,
      qr.wedge_id ?? null,
      qr.title,
      JSON.stringify(qr.content),
      qr.location ?? null,
      JSON.stringify(qr.tags ?? []),
    ]
  );
  return getQR(tenant, qr.slug)!;
}

export function bulkCreateQRs(tenant: string, specs: QRSpec[]): QR[] {
  if (specs.length === 0) return [];
  const db = getDb(tenant);
  const insert = db.prepare(
    `INSERT INTO qrs (slug, wedge_id, title, content_json, location, tags_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction((rows: QRSpec[]) => {
    for (const r of rows) {
      insert.run(
        r.slug,
        r.wedge_id ?? null,
        r.title,
        JSON.stringify(r.content),
        r.location ?? null,
        JSON.stringify(r.tags ?? [])
      );
    }
  });
  tx(specs);
  return specs.map((s) => getQR(tenant, s.slug)!).filter((q): q is QR => q !== null);
}

export function getQR(tenant: string, slug: string): QR | null {
  const db = getDb(tenant);
  return (
    (db.query("SELECT * FROM qrs WHERE slug = ?").get(slug) as QR | null) ??
    null
  );
}

export function listQRs(tenant: string): QR[] {
  const db = getDb(tenant);
  return db.query("SELECT * FROM qrs ORDER BY created_at DESC").all() as QR[];
}

export function listLocations(tenant: string): string[] {
  const db = getDb(tenant);
  const rows = db
    .query(
      `SELECT DISTINCT location FROM qrs
        WHERE location IS NOT NULL AND location != ''
        ORDER BY location`
    )
    .all() as { location: string }[];
  return rows.map((r) => r.location);
}

export function listTags(tenant: string): string[] {
  const db = getDb(tenant);
  const rows = db
    .query(`SELECT tags_json FROM qrs WHERE tags_json != '[]'`)
    .all() as { tags_json: string }[];
  const set = new Set<string>();
  for (const r of rows) {
    try {
      const arr = JSON.parse(r.tags_json) as string[];
      for (const t of arr) if (t) set.add(t);
    } catch {
      /* skip malformed */
    }
  }
  return [...set].sort();
}

export function updateQR(
  tenant: string,
  slug: string,
  patch: {
    title?: string;
    wedge_id?: string | null;
    content?: unknown;
    status?: "active" | "inactive";
    location?: string | null;
    tags?: string[];
  }
): QR | null {
  const db = getDb(tenant);
  const cur = getQR(tenant, slug);
  if (!cur) return null;
  const next = {
    title: patch.title ?? cur.title,
    wedge_id: patch.wedge_id === undefined ? cur.wedge_id : patch.wedge_id,
    content_json:
      patch.content === undefined
        ? cur.content_json
        : JSON.stringify(patch.content),
    status: patch.status ?? cur.status,
    location: patch.location === undefined ? cur.location : patch.location,
    tags_json:
      patch.tags === undefined
        ? cur.tags_json
        : JSON.stringify(patch.tags),
  };
  db.run(
    `UPDATE qrs
     SET title = ?, wedge_id = ?, content_json = ?, status = ?,
         location = ?, tags_json = ?,
         updated_at = datetime('now')
     WHERE slug = ?`,
    [
      next.title,
      next.wedge_id,
      next.content_json,
      next.status,
      next.location,
      next.tags_json,
      slug,
    ]
  );
  return getQR(tenant, slug);
}

export function deleteQR(tenant: string, slug: string): boolean {
  const db = getDb(tenant);
  const r = db.run("DELETE FROM qrs WHERE slug = ?", [slug]);
  return r.changes > 0;
}

// ---- Scans ----

export function logScan(
  tenant: string,
  s: { slug: string; user_agent?: string | null; ip_hash?: string | null; referer?: string | null }
): number {
  const db = getDb(tenant);
  const r = db.run(
    `INSERT INTO scans (slug, user_agent, ip_hash, referer) VALUES (?, ?, ?, ?)`,
    [s.slug, s.user_agent ?? null, s.ip_hash ?? null, s.referer ?? null]
  );
  return Number(r.lastInsertRowid);
}

export function scanCount(tenant: string, slug: string): number {
  const db = getDb(tenant);
  const row = db
    .query("SELECT COUNT(*) AS c FROM scans WHERE slug = ?")
    .get(slug) as { c: number };
  return row.c;
}

export function scanSummary(
  tenant: string,
  slug: string,
  days = 30
): { day: string; count: number }[] {
  const db = getDb(tenant);
  return db
    .query(
      `SELECT date(scanned_at) AS day, COUNT(*) AS count
         FROM scans
        WHERE slug = ?
          AND scanned_at >= datetime('now', ?)
     GROUP BY day
     ORDER BY day`
    )
    .all(slug, `-${days} days`) as { day: string; count: number }[];
}

// ---- Submissions ----

export function recordSubmission(
  tenant: string,
  s: { slug: string; form_data: unknown }
): number {
  const db = getDb(tenant);
  const r = db.run(
    `INSERT INTO submissions (slug, form_data_json) VALUES (?, ?)`,
    [s.slug, JSON.stringify(s.form_data)]
  );
  return Number(r.lastInsertRowid);
}

export function listSubmissions(tenant: string, slug: string, limit = 100): Submission[] {
  const db = getDb(tenant);
  return db
    .query(
      `SELECT * FROM submissions WHERE slug = ? ORDER BY submitted_at DESC LIMIT ?`
    )
    .all(slug, limit) as Submission[];
}
