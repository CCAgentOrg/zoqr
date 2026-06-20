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
