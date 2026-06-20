# ZoQR — Federated QR Wedge Platform

ZoQR turns physical spaces into a programmable surface. A café pastes a QR on every table, a museum on every exhibit, a hospital on every ward — each QR resolves to a **wedge** (a runtime config artifact) that decides what content, forms, and integrations it shows.

This repository is the **API + Admin dashboard**. It is **one of three** repositories that together form the platform:

| Repo | What it is | Stack |
|------|------------|-------|
| **[CCAgentOrg/zoqr](https://github.com/CCAgentOrg/zoqr)** ← you are here | API + Admin dashboard. Bearer-token gated. Per-tenant DuckDB. | Bun + Hono + DuckDB + React SPA |
| **[CCAgentOrg/zoqr-pages](https://github.com/CCAgentOrg/zoqr-pages)** | Public renderer. Mobile-first, fetches from zoqr, renders wedges. | Static HTML/JS, deploys to Cloudflare Pages |
| **[CCAgentOrg/zoqr-skill](https://github.com/CCAgentOrg/zoqr-skill)** | CLI for tenants. `zoqr author`, `zoqr install`, `zoqr mint`, `zoqr publish`. | Bun, gh-published to GitHub Releases |

---

## What is a wedge?

A **wedge** is a small JSON file that defines a runtime configuration: what content blocks a QR shows, what form fields it accepts, and where its scans and submissions go. Wedges are data-only — they don't run on the tenant's machine, they get pulled from a public registry (WedgeStore) at install time.

```json
{
  "id": "menu-display",
  "name": "Menu Display",
  "version": "1.0.0",
  "base_url": "https://example.com/wedge/menu-display",
  "config": { "show_prices": true }
}
```

A business can author their own wedge, or install one from the WedgeStore. Each QR a business creates can be tied to a wedge — when the customer scans, the page hydrates with that wedge's defaults.

---

## Architecture (30 seconds)

```
         Customer's phone                  Your tenants                 WedgeStore
              │                                │                            │
              │  scan QR                       │                            │
              ▼                                │                            │
      ┌────────────────┐     fetch /api/qr/x   │                            │
      │   zoqr-pages   │ ──────────────────►   │                            │
      │  (Cloudflare)  │                       │                            │
      └────────────────┘     submit /api/submit│                            │
              ▲                │               │                            │
              │                ▼               │                            │
              │         ┌──────────────┐       │       install <wedge>      │
              └───────  │     zoqr     │ ◄─────┼────────────────────────────┘
                        │ (this repo)  │       │
                        │  Hono+DuckDB │       │  zoqr-skill CLI
                        └──────────────┘       │
                              │                │
                              ▼                ▼
                        tenants/<id>/data.duckdb (per-tenant)
```

- **Per-tenant isolation**: every business has its own DuckDB file at `tenants/<tenant>/data.duckdb`. No cross-tenant joins. No shared write paths.
- **Single-process**: Hono + Bun, no Redis, no Postgres, no workers. Stateless across processes — drop in a new container and it works.
- **Stateless API**: the server doesn't cache. Every request hits DuckDB directly. DuckDB is fast enough that this is fine for tenants up to ~1M QRs.

---

## Quickstart

### 1. Install + run

```bash
git clone https://github.com/CCAgentOrg/zoqr
cd zoqr
bun install
ZOQR_API_TOKEN=your-secret-token bun run src/server.ts
```

Server prints:
```
ZoQR listening on http://localhost:3000
  Public API:   http://localhost:3000/api/
  Admin UI:     http://localhost:3000/admin
  Admin API:    http://localhost:3000/admin/api/
```

Open [http://localhost:3000/admin](http://localhost:3000/admin), paste your token, and start minting QRs.

### 2. Mint your first QR

```bash
curl -X POST http://localhost:3000/admin/api/qrs?tenant=cafe-atlas \
  -H "Authorization: Bearer your-secret-token" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "table-1",
    "title": "Café Atlas — Table 1",
    "content": {
      "blocks": [
        { "type": "text", "html": "<h2>Welcome</h2><p>Scan to see the menu and share feedback.</p>" },
        { "type": "link", "href": "https://example.com/menu.pdf", "label": "View full menu", "cta": true },
        { "type": "form", "fields": [
          { "name": "rating", "label": "How was your visit?", "kind": "select",
            "required": true, "options": ["Loved it", "OK", "Could be better"] }
        ], "submit_label": "Send feedback" }
      ]
    }
  }'
```

### 3. Render it

Open [http://localhost:3000/q/table-1](http://localhost:3000/q/table-1) (after deploying `zoqr-pages` to point at your API) — or use the embedded preview from the admin dashboard.

---

## API

See `docs/api.md` for the full reference. The headline endpoints:

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `GET` | `/api/qr/:slug` | none | Fetch a QR's content (used by `zoqr-pages`) |
| `POST` | `/api/submit` | none | Record a form submission |
| `POST` | `/api/scan` | none | Log a scan (called by pages) |
| `GET` | `/api/qrs` | none | List active QRs (for sitemaps) |
| `GET` | `/api/tenants` | none | List tenants on this instance |
| `GET` | `/admin/api/qrs` | bearer | List all QRs (admin only) |
| `POST` | `/admin/api/qrs` | bearer | Mint a new QR |
| `PATCH` | `/admin/api/qrs/:slug` | bearer | Update QR content |
| `DELETE` | `/admin/api/qrs/:slug` | bearer | Deactivate QR |
| `GET` | `/admin/api/scans/:slug` | bearer | Daily scan counts |
| `GET` | `/admin/api/submissions/:slug` | bearer | Form responses |

All admin endpoints are bearer-gated. The `ZOQR_API_TOKEN` env var is the master token.

---

## Multi-tenancy

Tenants are addressed via:
- Query param: `?tenant=cafe-atlas`
- Header: `X-ZoQR-Tenant: cafe-atlas`
- Default: `demo` (if neither is set)

Each tenant lives in its own directory: `tenants/<tenant>/data.duckdb`. There's no central registry — the tenant name *is* the path. This means the system auto-creates new tenants on first write, with no admin onboarding step.

To host ZoQR for a single business, just put it behind nginx with one DNS name and pin `?tenant=their-name` in the upstream config.

---

## Deployment

### Option A: Single-tenant (recommended for one business)

```nginx
server {
  server_name qr.mycafe.com;
  location / {
    proxy_pass http://localhost:3000/?tenant=mycafe;
  }
}
```

### Option B: Multi-tenant SaaS

Put Cloudflare in front, route by subdomain or path prefix, and inject `?tenant=<name>` from your auth layer. The admin dashboard is at `/admin`, gated by bearer token; the public renderer is the static `zoqr-pages` repo deployed separately.

### Option C: Local-only (development)

`bun run src/server.ts` is enough. DuckDB files live in `tenants/`.

---

## Why this stack?

- **Bun**: TS first-class, no separate ts-node, no node version churn. Native DuckDB integration via `bun:sqlite` or `bun:duckdb` (we use `@duckdb/node-api`).
- **DuckDB**: columnar, embedded, single-file. Perfect for the "lots of small datasets, one process" model. No separate DB server to babysit.
- **Hono**: tiny, type-safe, runs anywhere Bun runs. No framework lock-in.
- **htm + React (no build)**: the admin SPA is one `admin.js` file, no Vite, no webpack, no transpilation. Just `import` from esm.sh and you're done.

---

## License

Apache 2.0. See `LICENSE`.

---

*Built for the [Zo Ambassador Build Challenge](https://ambassador.zo.space/build-challenge).*
