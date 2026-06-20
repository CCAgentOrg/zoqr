/**
 * Public API: read-only, used by zoqr-pages to render landing pages
 * and by user scripts to push form submissions.
 *
 *   GET  /api/qr/:slug       — fetch a single QR (active only)
 *   GET  /api/qrs            — list active QRs (sitemaps / directories)
 *   POST /api/submit         — record a form submission
 *   POST /api/scan           — log a scan (called by zoqr-pages on render)
 *   GET  /api/tenants        — list tenants (admin convenience)
 */
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
  getQR,
  listQRs,
  recordSubmission,
  logScan,
  scanCount,
} from "../db.ts";
import { hashIp, bearerToken } from "../lib/auth.ts";
import { SubmitSchema, ScanSchema } from "../lib/schemas.ts";

export const api = new Hono();

// Public read -----------------------------------------------------

api.get("/qr/:slug", (c) => {
  const tenant = c.req.header("x-zoqr-tenant") ?? "demo";
  const slug = c.req.param("slug");
  const qr = getQR(tenant, slug);
  if (!qr || qr.status !== "active") {
    return c.json({ error: "Not found" }, 404);
  }
  const content = JSON.parse(qr.content_json);
  return c.json({
    slug: qr.slug,
    title: qr.title,
    content,
    scans: scanCount(tenant, slug),
  });
});

api.get("/qrs", (c) => {
  const tenant = c.req.header("x-zoqr-tenant") ?? "demo";
  const all = listQRs(tenant).filter((q) => q.status === "active");
  return c.json(
    all.map((q) => ({
      slug: q.slug,
      title: q.title,
      updated_at: q.updated_at,
    }))
  );
});

// Write: submit a form -------------------------------------------

api.post("/submit", zValidator("json", SubmitSchema), async (c) => {
  const body = c.req.valid("json");
  const tenant = c.req.header("x-zoqr-tenant") ?? "demo";
  const qr = getQR(tenant, body.slug);
  if (!qr || qr.status !== "active") {
    return c.json({ error: "Not found" }, 404);
  }
  const id = recordSubmission(tenant, {
    slug: body.slug,
    form_data: body.form_data,
  });
  return c.json({ ok: true, id });
});

// Write: log a scan ----------------------------------------------

api.post("/scan", zValidator("json", ScanSchema), async (c) => {
  const { slug, referer } = c.req.valid("json");
  const tenant = c.req.header("x-zoqr-tenant") ?? "demo";
  const qr = getQR(tenant, slug);
  if (!qr || qr.status !== "active") {
    return c.json({ error: "Not found" }, 404);
  }
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
  const ua = c.req.header("user-agent") ?? null;
  logScan(tenant, { slug, ip_hash: hashIp(ip), user_agent: ua, referer });
  return c.json({ ok: true });
});

// Health ---------------------------------------------------------

api.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));

// Tenants list (no secrets) --------------------------------------

api.get("/tenants", (c) => {
  // Read from filesystem. Cheap and tenant-discovery-friendly.
  const { readdirSync, existsSync } = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const dir = path.join(process.cwd(), "tenants");
  const tenants = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
    : [];
  return c.json({ tenants });
});
