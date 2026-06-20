/**
 * Public landing-page renderer.
 *
 * Routes:
 *   GET /q/:slug                 — human-friendly landing page (HTML, mobile-first)
 *   GET /q/:slug.json            — raw QR content (alias of /api/qr/:slug)
 *   GET /q/:slug/qr.svg          — server-rendered SVG QR pointing at this /q/:slug
 *   GET /q/:slug/qr.png          — server-rendered PNG QR pointing at this /q/:slug
 *
 * Why a built-in renderer when zoqr-pages exists?
 *   - zoqr-pages is the multi-tenant SaaS renderer (CDN-served, themeable).
 *     It's the right choice when many tenants share one deployment.
 *   - This built-in renderer is the zero-deploy path: a single QR
 *     tenant (a small cafe, a library) can hit their own Zo
 *     instance and get working pages without spinning up Cloudflare.
 *
 * The two can coexist — pass `?renderer=pages` to delegate, or
 * just point zoqr-pages at this same instance via its API.
 */
import QRCode from "qrcode";
import type { Context } from "hono";
import { Hono } from "hono";
import { getQR, listQRs, scanCount, recordSubmission, logScan } from "../db.ts";
import { tenantFrom } from "./_shared.ts";
import { SubmitSchema } from "../lib/schemas.ts";
import { hashIp } from "../lib/auth.ts";
import { zValidator } from "@hono/zod-validator";

export const render = new Hono();

/**
 * Resolve the public base URL for absolute links (QR targets, OG tags).
 *
 * Priority: X-Forwarded-Proto/Host (when behind Funnel/nginx) > Host header.
 * We never read this from a query param — that would let anyone
 * spoof the canonical URL.
 */
function resolveBase(c: Context): string {
  const proto = c.req.header("x-forwarded-proto") ?? "http";
  const host = c.req.header("x-forwarded-host") ?? c.req.header("host");
  if (!host) return `${proto}://localhost`;
  // Strip /qr, /q, /api prefixes that Tailscale Funnel might inject.
  return `${proto}://${host}`;
}

/** Per-block HTML escaper (used inside the template below). */
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]!));

/** Render an array of content blocks to inline HTML for the landing page. */
function blocksToHtml(content: {
  blocks: Array<{ type: string; [k: string]: unknown }>;
}): string {
  if (!content.blocks?.length) {
    return `<section class="empty">
      <p>No content yet.</p>
      <p class="hint">Edit this QR in the <a href="/admin">admin dashboard</a>.</p>
    </section>`;
  }
  return content.blocks
    .map((b) => {
      switch (b.type) {
        case "text":
          return `<div class="block block-text">${esc(String(b.html ?? ""))}</div>`;
        case "image":
          return `<div class="block block-image">
            <img src="${esc(String(b.src))}" alt="${esc(String(b.alt ?? ""))}" loading="lazy">
          </div>`;
        case "file":
          return `<div class="block block-file">
            <a href="${esc(String(b.src))}" download="${esc(String(b.filename ?? "file"))}" class="file-link">
              📎 ${esc(String(b.filename ?? "Download file"))}
            </a>
          </div>`;
        case "link":
          return `<div class="block block-link${b.cta ? " cta" : ""}">
            <a href="${esc(String(b.href))}" target="_blank" rel="noopener">${esc(String(b.label))} ↗</a>
          </div>`;
        case "divider":
          return `<hr class="block block-divider">`;
        case "form":
          return formHtml(b as {
            type: "form";
            fields: Array<{ name: string; label: string; kind: string; required?: boolean; options?: string[] }>;
            submit_label?: string;
          });
        default:
          return `<!-- unknown block type: ${esc(String(b.type))} -->`;
      }
    })
    .join("\n");
}

function formHtml(form: {
  fields: Array<{ name: string; label: string; kind: string; required?: boolean; options?: string[] }>;
  submit_label?: string;
}): string {
  const fields = form.fields
    .map((f) => {
      const req = f.required ? "required" : "";
      const labelHtml = `<label for="f-${esc(f.name)}">${esc(f.label)}${f.required ? " <span class=\"req\">*</span>" : ""}</label>`;
      let input: string;
      switch (f.kind) {
        case "textarea":
          input = `<textarea id="f-${esc(f.name)}" name="${esc(f.name)}" rows="3" ${req}></textarea>`;
          break;
        case "select":
          input = `<select id="f-${esc(f.name)}" name="${esc(f.name)}" ${req}>
            <option value="" disabled selected hidden>Select…</option>
            ${(f.options ?? []).map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join("")}
          </select>`;
          break;
        case "rating":
          input = `<div class="rating" role="radiogroup" aria-label="${esc(f.label)}">
            ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="${esc(f.name)}" value="${n}" ${req}><span>${n}</span></label>`).join("")}
          </div>`;
          break;
        case "email":
          input = `<input id="f-${esc(f.name)}" type="email" name="${esc(f.name)}" ${req} autocomplete="email">`;
          break;
        case "tel":
          input = `<input id="f-${esc(f.name)}" type="tel" name="${esc(f.name)}" ${req} autocomplete="tel">`;
          break;
        default:
          input = `<input id="f-${esc(f.name)}" type="text" name="${esc(f.name)}" ${req}>`;
      }
      return `<div class="field">${labelHtml}${input}</div>`;
    })
    .join("\n");
  return `<form class="block block-form" data-slug-fallback>
    ${fields}
    <button type="submit">${esc(form.submit_label ?? "Submit")}</button>
    <p class="form-status" hidden></p>
  </form>`;
}

/**
 * Build the full HTML document for a landing page.
 * Kept inline so we can serve it from one place; ~6KB minified.
 */
function renderLandingPage(args: {
  title: string;
  description: string;
  url: string;
  blocksHtml: string;
  theme: "light" | "dark";
  hasForm: boolean;
}): string {
  const themeClass = args.theme === "dark" ? " data-theme=\"dark\"" : "";
  const desc = esc(args.description);
  return `<!doctype html>
<html lang="en"${themeClass}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(args.title)}</title>
<meta name="description" content="${desc}">
<meta property="og:title" content="${esc(args.title)}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${esc(args.url)}">
<meta name="twitter:card" content="summary">
<link rel="canonical" href="${esc(args.url)}">
<style>
  :root { color-scheme: ${args.theme}; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #fafaf7;
    color: #111;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
    padding: env(safe-area-inset-top, 0) env(safe-area-inset-right, 1rem) env(safe-area-inset-bottom, 0) env(safe-area-inset-left, 1rem);
  }
  [data-theme="dark"] body { background: #0d0d0b; color: #f5f1e8; }
  main { max-width: 36rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 1.5rem; letter-spacing: -0.01em; }
  .block { margin: 0 0 1.5rem; }
  .block-text { font-size: 1.0625rem; }
  .block-text :is(h2,h3,h4) { margin-top: 1.5em; margin-bottom: 0.4em; font-weight: 600; }
  .block-text p { margin: 0.5em 0; }
  .block-image img { max-width: 100%; height: auto; border-radius: 8px; display: block; }
  .block-link a { color: #1a4fbf; text-decoration: none; font-weight: 500; }
  [data-theme="dark"] .block-link a { color: #8ab4ff; }
  .block-link.cta a {
    display: inline-block; padding: 0.75rem 1.25rem;
    background: #1a4fbf; color: white !important;
    border-radius: 8px; font-weight: 600; margin: 0.5rem 0;
  }
  .block-file a.file-link {
    display: inline-flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 0.75rem; background: rgba(0,0,0,0.05);
    border-radius: 6px; text-decoration: none; color: inherit;
  }
  .block-divider { border: 0; border-top: 1px solid rgba(0,0,0,0.1); margin: 2rem 0; }
  .block-form .field { margin: 0 0 1rem; }
  .block-form label { display: block; font-size: 0.9rem; font-weight: 500; margin-bottom: 0.3rem; }
  .block-form .req { color: #d33; }
  .block-form input[type=text], .block-form input[type=email], .block-form input[type=tel], .block-form textarea, .block-form select {
    width: 100%; padding: 0.6rem 0.75rem; font-size: 1rem;
    border: 1px solid rgba(0,0,0,0.15); border-radius: 6px;
    background: white; color: inherit;
    font-family: inherit;
  }
  [data-theme="dark"] .block-form input, [data-theme="dark"] .block-form textarea, [data-theme="dark"] .block-form select {
    background: #1a1a17; border-color: rgba(255,255,255,0.15);
  }
  .block-form input:focus, .block-form textarea:focus, .block-form select:focus {
    outline: 2px solid #1a4fbf; outline-offset: -1px; border-color: #1a4fbf;
  }
  .block-form .rating { display: flex; gap: 0.5rem; }
  .block-form .rating label { display: flex; align-items: center; cursor: pointer; }
  .block-form .rating input { position: absolute; opacity: 0; pointer-events: none; }
  .block-form .rating span {
    display: inline-flex; align-items: center; justify-content: center;
    width: 2.25rem; height: 2.25rem; border: 1px solid rgba(0,0,0,0.15);
    border-radius: 6px; font-weight: 500;
  }
  .block-form .rating input:checked + span {
    background: #1a4fbf; color: white; border-color: #1a4fbf;
  }
  .block-form button {
    margin-top: 0.5rem; padding: 0.7rem 1.5rem; font-size: 1rem; font-weight: 600;
    background: #1a4fbf; color: white; border: 0; border-radius: 6px; cursor: pointer;
    font-family: inherit;
  }
  .block-form button:hover { background: #143f99; }
  .block-form button:disabled { opacity: 0.6; cursor: wait; }
  .form-status { margin-top: 1rem; padding: 0.75rem; border-radius: 6px; }
  .form-status.ok { background: rgba(20, 160, 80, 0.1); color: #0a7038; }
  .form-status.err { background: rgba(220, 50, 50, 0.1); color: #a82828; }
  .empty { text-align: center; color: rgba(0,0,0,0.6); padding: 3rem 1rem; }
  [data-theme="dark"] .empty { color: rgba(255,255,255,0.6); }
  .empty .hint { font-size: 0.9rem; margin-top: 0.5rem; }
  .footer {
    margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid rgba(0,0,0,0.08);
    font-size: 0.8rem; color: rgba(0,0,0,0.5); text-align: center;
  }
  [data-theme="dark"] .footer { border-color: rgba(255,255,255,0.08); color: rgba(255,255,255,0.5); }
</style>
</head>
<body>
<main>
  <h1>${esc(args.title)}</h1>
  ${args.blocksHtml}
  <footer class="footer">Powered by <a href="/" rel="noopener">ZoQR</a></footer>
</main>
${args.hasForm ? `<script>
(function(){
  var form = document.querySelector('form[data-slug-fallback]');
  if (!form) return;
  // The form lives inside <main> for this slug. Extract the slug from the URL.
  var m = location.pathname.match(/\\/q\\/([a-z0-9-]+)/);
  if (!m) return;
  var slug = m[1];
  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var btn = form.querySelector('button'); var status = form.querySelector('.form-status');
    btn.disabled = true;
    var fd = new FormData(form); var data = {};
    fd.forEach(function(v,k){ data[k] = v; });
    try {
      var res = await fetch('/api/submit', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ slug: slug, form_data: data })
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      status.hidden = false; status.className = 'form-status ok';
      status.textContent = 'Thanks! We received your submission.';
      form.reset();
    } catch (err) {
      status.hidden = false; status.className = 'form-status err';
      status.textContent = 'Something went wrong. Please try again.';
    } finally {
      btn.disabled = false;
    }
  });
})();
</script>` : ""}
</body>
</html>`;
}

// ---- Landing page (HTML) ----

render.get("/q/:slug", async (c) => {
  const tenant = tenantFrom(c);
  const rawSlug = c.req.param("slug");

  // Handle /q/:slug.json inline (Hono doesn't match :slug.json patterns).
  if (rawSlug.endsWith(".json")) {
    const slug = rawSlug.slice(0, -5);
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
  }

  const slug = rawSlug;
  const qr = getQR(tenant, slug);
  if (!qr || qr.status !== "active") {
    return c.html(
      `<!doctype html><meta charset="utf-8"><title>Not found</title>
       <main style="max-width:36rem;margin:4rem auto;padding:0 1rem;font-family:system-ui">
       <h1>QR not found</h1><p>No active QR with slug <code>${esc(slug)}</code> in tenant <code>${esc(tenant)}</code>.</p>
       </main>`,
      404
    );
  }
  const content = JSON.parse(qr.content_json);
  const theme: "light" | "dark" = content.meta?.theme === "dark" ? "dark" : "light";
  const base = resolveBase(c);
  const url = `${base}/q/${slug}`;
  const description =
    content.meta?.og_description ||
    (content.blocks?.[0]?.type === "text"
      ? String(content.blocks[0].html ?? "").replace(/<[^>]+>/g, " ").slice(0, 200).trim()
      : qr.title);
  const blocksHtml = blocksToHtml(content);
  const hasForm = content.blocks?.some((b: { type: string }) => b.type === "form");
  const html = renderLandingPage({
    title: qr.title,
    description,
    url,
    blocksHtml,
    theme,
    hasForm: Boolean(hasForm),
  });
  // Auto-log a scan (best-effort; never block the response on it).
  try {
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? "0.0.0.0";
    logScan(tenant, {
      slug,
      ip_hash: hashIp(ip),
      user_agent: c.req.header("user-agent") ?? null,
      referer: c.req.header("referer") ?? null,
    });
  } catch {
    /* scan log is best-effort */
  }
  // Tag with a header so the pages repo / dev tools can see scan count
  const scanCnt = (() => {
    try { return scanCount(tenant, slug); } catch { return 0; }
  })();
  c.header("X-ZoQR-Scans", String(scanCnt));
  return c.html(html);
});

// Raw JSON handled inline in /q/:slug (see .json suffix check above)

// ---- QR generation (SVG / PNG) ----
//
// These render a QR whose target is the landing page itself
// (https://<host>/q/<slug>). They live under /q/<slug>/qr.svg
// so the QR is always scoped to one specific landing page.

async function renderQr(c: Context, format: "svg" | "png"): Promise<Response> {
  const tenant = tenantFrom(c);
  const slug = c.req.param("slug");
  const qr = getQR(tenant, slug);
  if (!qr || qr.status !== "active") return c.text("Not found", 404);
  const base = resolveBase(c);
  const target = `${base}/q/${slug}`;
  const margin = Math.min(Math.max(Number(c.req.query("margin") ?? "2"), 0), 8);
  const dark = c.req.query("dark") ?? "#000000";
  const light = c.req.query("light") ?? "#ffffff";
  if (format === "svg") {
    const svg = await QRCode.toString(target, {
      type: "svg",
      margin,
      width: 512,
      errorCorrectionLevel: "M",
      color: { dark, light },
    });
    return c.body(svg, 200, {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=3600",
      "X-QR-Target": target,
    });
  }
  const buf = await QRCode.toBuffer(target, {
    type: "png",
    margin,
    width: 512,
    errorCorrectionLevel: "M",
    color: { dark, light },
  });
  return c.body(buf, 200, {
    "Content-Type": "image/png",
    "Content-Length": String(buf.length),
    "Cache-Control": "public, max-age=3600",
    "X-QR-Target": target,
  });
}

render.get("/q/:slug/qr.svg", (c) => renderQr(c, "svg"));
render.get("/q/:slug/qr.png", (c) => renderQr(c, "png"));
