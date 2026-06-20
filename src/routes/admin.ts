/**
 * Admin API: bearer-token gated. Used by the embedded React admin SPA
 * and by external scripts to manage QRs and wedges.
 *
 *   GET    /admin/qrs              list QRs for current tenant
 *   POST   /admin/qrs              create QR
 *   POST   /admin/qrs/bulk         bulk-create from range specs
 *   GET    /admin/qrs/:slug        fetch a QR (incl. inactive)
 *   PATCH  /admin/qrs/:slug        update QR
 *   DELETE /admin/qrs/:slug        delete QR
 *   GET    /admin/locations        distinct locations for this tenant
 *   GET    /admin/tags             distinct tags for this tenant
 *   GET    /admin/wedges           list installed wedges
 *   POST   /admin/wedges           install wedge
 *   DELETE /admin/wedges/:id       uninstall wedge
 *   GET    /admin/registry         browse wedges from upstream registry (cached)
 *   GET    /admin/scans/:slug      scan summary (last N days)
 *   GET    /admin/submissions/:slug fetch form responses
 *   GET    /admin/print            print sheet (HTML) for a location or all
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createQR,
  bulkCreateQRs,
  deleteQR,
  getQR,
  listQRs,
  listWedges,
  listLocations,
  listTags,
  installWedge,
  uninstallWedge,
  updateQR,
  scanSummary,
  listSubmissions,
  getWedge,
} from "../db.ts";
import { bearerToken, requireMasterToken } from "../lib/auth.ts";
import { slugify, isReservedSlug, uniquify } from "../lib/slug.ts";
import { parseRange } from "../lib/range.ts";
import {
  QRCreateSchema,
  QRBulkCreateSchema,
  QRUpdateSchema,
  WedgeInstallSchema,
} from "../lib/schemas.ts";
import { tenantFrom as _tenantFrom } from "./_shared.ts";

export const admin = new Hono();

// All admin routes require a valid bearer token.
admin.use("*", async (c, next) => {
  const master = process.env.ZOQR_API_TOKEN;
  const provided = bearerToken(c);
  if (!master) {
    return c.json({ error: "Server misconfigured" }, 500);
  }
  if (!provided || provided !== master) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

const tenantFromQuery = _tenantFrom;

// ---- QRs --------------------------------------------------------

admin.get("/qrs", (c) => {
  const tenant = tenantFromQuery(c);
  return c.json(listQRs(tenant));
});

admin.post("/qrs", zValidator("json", QRCreateSchema), async (c) => {
  const tenant = tenantFromQuery(c);
  const body = c.req.valid("json");
  let slug = body.slug ? slugify(body.slug) : slugify(body.title);
  if (isReservedSlug(slug)) slug = uniquify(slug);
  // Ensure unique.
  let candidate = slug;
  let n = 0;
  while (getQR(tenant, candidate)) {
    n++;
    candidate = uniquify(slug);
    if (n > 5) return c.json({ error: "Could not allocate unique slug" }, 500);
  }
  const qr = createQR(tenant, {
    slug: candidate,
    title: body.title,
    wedge_id: body.wedge_id ?? null,
    content: body.content,
    location: body.location ?? null,
    tags: body.tags ?? [],
  });
  return c.json(qr, 201);
});

// Bulk create: each spec.raw is expanded via the range parser. Slugs that
// collide with existing QRs in this tenant are silently skipped (the
// client only learns the count actually created).
admin.post("/qrs/bulk", zValidator("json", QRBulkCreateSchema), async (c) => {
  const tenant = tenantFromQuery(c);
  const { specs } = c.req.valid("json");

  // Build the "taken" set ONCE, then for each spec expand and skip conflicts.
  const taken = new Set(listQRs(tenant).map((q) => q.slug));
  const all: { slug: string; title: string; wedge_id: string | null; content: unknown; location: string | null; tags: string[] }[] = [];
  let skipped = 0;
  for (const spec of specs) {
    const expanded = parseRange(spec.raw, taken);
    if (expanded.length === 0) {
      skipped++;
      continue;
    }
    for (const ex of expanded) {
      taken.add(ex.slug); // protect against in-batch duplicates
      all.push({
        slug: ex.slug,
        title: spec.title,
        wedge_id: spec.wedge_id ?? null,
        content: spec.content,
        location: spec.location ?? null,
        tags: spec.tags ?? [],
      });
    }
  }

  if (all.length === 0) {
    return c.json({ error: "No QRs to create (all slugs taken or range empty)" }, 400);
  }
  if (all.length > 200) {
    return c.json(
      { error: `Bulk limit exceeded: ${all.length} > 200. Split into smaller batches.` },
      413
    );
  }

  const created = bulkCreateQRs(tenant, all);
  return c.json({ ok: true, count: created.length, skipped, qrs: created }, 201);
});

admin.get("/qrs/:slug", (c) => {
  const tenant = tenantFromQuery(c);
  const slug = c.req.param("slug");
  const qr = getQR(tenant, slug);
  if (!qr) return c.json({ error: "Not found" }, 404);
  return c.json(qr);
});

admin.patch("/qrs/:slug", zValidator("json", QRUpdateSchema), async (c) => {
  const tenant = tenantFromQuery(c);
  const slug = c.req.param("slug");
  const body = c.req.valid("json");
  const updated = updateQR(tenant, slug, body);
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

admin.delete("/qrs/:slug", (c) => {
  const tenant = tenantFromQuery(c);
  const slug = c.req.param("slug");
  const ok = deleteQR(tenant, slug);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ---- Wedges -----------------------------------------------------

admin.get("/wedges", (c) => c.json(listWedges(tenantFromQuery(c))));

admin.post("/wedges", zValidator("json", WedgeInstallSchema), async (c) => {
  const tenant = tenantFromQuery(c);
  const body = c.req.valid("json");
  const w = installWedge(tenant, body);
  return c.json(w, 201);
});

admin.delete("/wedges/:id", (c) => {
  const tenant = tenantFromQuery(c);
  const id = c.req.param("id");
  if (!getWedge(tenant, id)) return c.json({ error: "Not found" }, 404);
  uninstallWedge(tenant, id);
  return c.json({ ok: true });
});

// ---- Registry browser -----------------------------------------
// Proxies INDEX.json from the upstream wedges registry so the admin SPA
// can browse/install community wedges without CORS pain. Cached in-memory
// for 5 minutes — the registry is append-only with semver tags, so this is
// safe. Override the URL with ZOQR_REGISTRY_URL for testing/forking.

const REGISTRY_URL =
  process.env.ZOQR_REGISTRY_URL ||
  "https://raw.githubusercontent.com/CCAgentOrg/zoqr-wedges/main/INDEX.json";
const REGISTRY_TTL_MS = 5 * 60 * 1000;
const MANIFEST_TIMEOUT_MS = 3500;

interface RegistryCacheEntry {
  fetchedAt: number;
  body: { source: string; index: unknown; wedges: unknown[] };
}
const registryCache = new Map<string, RegistryCacheEntry>();

const slugToTitle = (slug: string) =>
  slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

async function fetchManifest(baseUrl: string, id: string, version: string) {
  const url = `${baseUrl.replace(/\/INDEX\.json$/, "")}/${id}/${version}/manifest.json`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), MANIFEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

admin.get("/registry", async (c) => {
  const force = c.req.query("fresh") === "1";
  const cached = registryCache.get(REGISTRY_URL);
  const now = Date.now();
  if (!force && cached && now - cached.fetchedAt < REGISTRY_TTL_MS) {
    return c.json({ ...cached.body, cached: true, age_ms: now - cached.fetchedAt });
  }
  try {
    const res = await fetch(REGISTRY_URL, {
      headers: { Accept: "application/json", "User-Agent": "zoqr-admin" },
    });
    if (!res.ok) {
      if (cached) {
        return c.json({ ...cached.body, cached: true, stale: true, age_ms: now - cached.fetchedAt });
      }
      return c.json({ error: `Registry upstream ${res.status}` }, 502);
    }
    const index = (await res.json()) as { wedges?: Array<{ id: string; latest: string; versions?: string[]; homepage?: string }> };
    const baseUrl = REGISTRY_URL.replace(/\/INDEX\.json$/, "");
    const enriched = await Promise.all(
      (index.wedges || []).map(async (w) => {
        const manifest = await fetchManifest(baseUrl, w.id, w.latest);
        return {
          id: w.id,
          name: manifest?.name || slugToTitle(w.id),
          description: manifest?.description || "",
          category: manifest?.category || "Other",
          latest: w.latest,
          versions: w.versions || [w.latest],
          homepage: w.homepage,
        };
      })
    );
    const body = { source: REGISTRY_URL, index, wedges: enriched };
    registryCache.set(REGISTRY_URL, { fetchedAt: now, body });
    return c.json({ ...body, cached: false });
  } catch (e) {
    if (cached) {
      return c.json({ ...cached.body, cached: true, stale: true, age_ms: now - cached.fetchedAt });
    }
    return c.json({ error: `Registry unreachable: ${(e as Error).message}` }, 502);
  }
});

// ---- Analytics --------------------------------------------------

admin.get("/scans/:slug", (c) => {
  const tenant = tenantFromQuery(c);
  const slug = c.req.param("slug");
  const days = Number(c.req.query("days") ?? "30");
  return c.json(scanSummary(tenant, slug, days));
});

admin.get("/submissions/:slug", (c) => {
  const tenant = tenantFromQuery(c);
  const slug = c.req.param("slug");
  const limit = Number(c.req.query("limit") ?? "100");
  return c.json(listSubmissions(tenant, slug, limit));
});

// ---- Print sheet ------------------------------------------------
//
// A4-friendly HTML view of all QRs (or a filtered subset by location / tag),
// each card showing the QR SVG, title, and slug. Built-in window.print() button.
// QRs are fetched inline by the browser (cached for 1h).

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]!));

function resolveBase(c: any): string {
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host") ?? "localhost";
  return `${proto}://${host}`;
}

admin.get("/print", (c) => {
  const tenant = tenantFromQuery(c);
  const locFilter = c.req.query("location");
  const tagFilter = c.req.query("tag");
  const title = c.req.query("title") ?? `Print — ${tenant}`;

  let qrs = listQRs(tenant).filter((q) => q.status === "active");
  if (locFilter) qrs = qrs.filter((q) => q.location === locFilter);
  if (tagFilter) {
    qrs = qrs.filter((q) => {
      try {
        return (JSON.parse(q.tags_json || "[]") as string[]).includes(tagFilter);
      } catch {
        return false;
      }
    });
  }
  // Stable order: by location, then slug.
  qrs.sort((a, b) => {
    const la = a.location ?? "zz";
    const lb = b.location ?? "zz";
    if (la !== lb) return la.localeCompare(lb);
    return a.slug.localeCompare(b.slug);
  });

  const base = resolveBase(c);
  const cards = qrs
    .map(
      (q) => `
    <div class="card">
      <img src="${esc(base)}/q/${encodeURIComponent(q.slug)}/qr.svg" alt="${esc(q.slug)}">
      <div class="title">${esc(q.title)}</div>
      <div class="slug">${esc(q.slug)}</div>
      ${q.location ? `<div class="loc">${esc(q.location)}</div>` : ""}
    </div>
  `
    )
    .join("");

  const filterLine = [
    locFilter ? `Location: <b>${esc(locFilter)}</b>` : "",
    tagFilter ? `Tag: <b>${esc(tagFilter)}</b>` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return c.html(
    `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { margin: 8mm; }
  * { box-sizing: border-box; }
  body { font: 12px system-ui, -apple-system, sans-serif; margin: 0; padding: 16px; color: #111; background: #fff; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .meta { color: #555; margin-bottom: 16px; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .card { border: 1px dashed #999; padding: 12px; text-align: center; page-break-inside: avoid; background: #fff; }
  .card img { width: 100%; max-width: 38mm; height: auto; aspect-ratio: 1; }
  .card .title { font-weight: 600; margin-top: 6px; font-size: 12px; word-break: break-word; }
  .card .slug { font-family: ui-monospace, monospace; font-size: 10px; color: #666; margin-top: 2px; }
  .card .loc { font-size: 10px; color: #888; margin-top: 2px; font-style: italic; }
  .toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
  .toolbar button { padding: 6px 12px; font: inherit; cursor: pointer; }
  @media print { .toolbar { display: none; } body { padding: 0; } }
</style></head>
<body>
  <div class="toolbar">
    <h1 style="margin:0;flex:1">${esc(title)}</h1>
    <button onclick="window.print()">🖨 Print</button>
  </div>
  <div class="meta">${qrs.length} QRs${filterLine ? " · " + filterLine : ""}</div>
  <div class="grid">${cards}</div>
</body></html>`,
    200,
    { "Content-Type": "text/html; charset=utf-8" }
  );
});

admin.get("/locations", (c) => {
  return c.json(listLocations(tenantFromQuery(c)));
});

admin.get("/tags", (c) => {
  return c.json(listTags(tenantFromQuery(c)));
});
