/**
 * ZoQR API + Admin server.
 *
 * Endpoints:
 *   GET  /              → links to docs + admin UI
 *   GET  /admin         → React admin SPA (HTML, no JSX transform needed)
 *   GET  /api/...       → public API (see routes/api.ts)
 *   /admin/api/...      → admin API (see routes/admin.ts)
 *
 * Single-process Bun server. Multi-tenant via X-ZoQR-Tenant header
 * (default: "demo").
 */
import { Hono } from "hono";
import { logger } from "hono/logger";
import { api } from "./routes/api.ts";
import { admin } from "./routes/admin.ts";
import { render } from "./routes/render.ts";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 3000);

const app = new Hono();

app.use("*", logger());

// Static SPA assets served at /admin and /admin/*
const ADMIN_DIR = join(import.meta.dir, "..", "public");

app.route("/", render);

app.get("/", (c) =>
  c.html(`<!doctype html>
<html><head><meta charset="utf-8"><title>ZoQR</title>
<style>body{font-family:system-ui;max-width:640px;margin:4rem auto;padding:0 1rem;color:#222;line-height:1.6}
a{color:#2563eb}h1{margin-bottom:0}</style></head>
<body>
<h1>ZoQR</h1>
<p>Federated QR Wedge Platform — API + Admin.</p>
<ul>
  <li><a href="/admin">Open admin dashboard</a></li>
  <li><a href="/api/health">/api/health</a></li>
  <li><a href="/api/tenants">/api/tenants</a></li>
  <li><a href="/api/qrs">/api/qrs</a> (active QRs in default tenant)</li>
  <li><a href="/q/test-cafe?tenant=demo">/q/test-cafe</a> (landing page)</li>
  <li><a href="/qr/test-cafe.svg?tenant=demo">/qr/test-cafe.svg</a> (server-rendered QR SVG)</li>
</ul>
</body></html>`)
);

app.get("/admin", (c) => {
  const htmlPath = join(ADMIN_DIR, "admin.html");
  if (!existsSync(htmlPath)) return c.text("Admin UI not built.", 500);
  return c.html(readFileSync(htmlPath, "utf-8"));
});

app.route("/api", api);
app.route("/admin/api", admin);

// Static SPA assets (CSS, JS) at /admin/* (relative paths in admin.html resolve here)
app.get("/admin/:file", async (c) => {
  const f = c.req.param("file");
  if (f.includes("..") || f.includes("/")) return c.text("bad path", 400);
  const p = join(ADMIN_DIR, f);
  if (!existsSync(p)) return c.text("not found", 404);
  const ct = f.endsWith(".css") ? "text/css" : "application/javascript";
  return c.body(readFileSync(p, "utf-8"), 200, { "Content-Type": ct });
});

export default {
  port: PORT,
  fetch: app.fetch,
};
