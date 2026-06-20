/**
 * Admin API: bearer-token gated. Used by the embedded React admin SPA
 * and by external scripts to manage QRs and wedges.
 *
 *   GET    /admin/qrs              list QRs for current tenant
 *   POST   /admin/qrs              create QR
 *   GET    /admin/qrs/:slug        fetch a QR (incl. inactive)
 *   PATCH  /admin/qrs/:slug        update QR
 *   DELETE /admin/qrs/:slug        delete QR
 *   GET    /admin/wedges           list installed wedges
 *   POST   /admin/wedges           install wedge
 *   DELETE /admin/wedges/:id       uninstall wedge
 *   GET    /admin/registry         browse wedges from upstream registry (cached)
 *   GET    /admin/scans/:slug      scan summary (last N days)
 *   GET    /admin/submissions/:slug fetch form responses
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  createQR,
  deleteQR,
  getQR,
  listQRs,
  listWedges,
  installWedge,
  uninstallWedge,
  updateQR,
  scanSummary,
  listSubmissions,
  getWedge,
} from "../db.ts";
import { bearerToken, requireMasterToken } from "../lib/auth.ts";
import { slugify, isReservedSlug, uniquify } from "../lib/slug.ts";
import {
  QRCreateSchema,
  QRUpdateSchema,
  WedgeInstallSchema,
} from "../lib/schemas.ts";

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

const tenantFromQuery = (c: { req: { query: (k: string) => string | undefined } }) =>
  c.req.query("tenant") ?? "demo";

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
  });
  return c.json(qr, 201);
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
