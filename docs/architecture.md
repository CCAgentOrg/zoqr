# ZoQR — Architecture

## The 30-second version

A business pastes QRs around their facility. Each QR is a short URL that points to a **public landing page** with rich content (text, images, files, links, video, forms). Business owners manage everything from an admin UI. The same QR can be re-pointed without reprinting.

## Repos

```
┌──────────────────────────────────────────────────────────────────┐
│  zoqr  (this repo)                                               │
│  ────────────────                                                │
│  Hono server + DuckDB + React admin SPA                          │
│  Runs on the business owner's Zo (or anywhere with Bun).         │
│  Stores per-tenant data in tenants/<tenant>/data.duckdb.         │
└──────────────────────────────────────────────────────────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            ▼                 ▼                 ▼
    ┌─────────────┐   ┌─────────────┐   ┌─────────────────┐
    │  zoqr-pages │   │  zoqr-skill │   │  zoqr-wedges    │
    │  Static HTML│   │  CLI        │   │  Wedge registry │
    │  Renders    │   │  Author/    │   │  Public catalog │
    │  public QRs │   │  mint/install│   │  of wedges      │
    └─────────────┘   └─────────────┘   └─────────────────┘
```

## The data flow

1. **Authoring a wedge** — A developer describes a wedge in natural language and runs `zoqr author`. The CLI produces a config artifact (JSON) and pushes it to `CCAgentOrg/zoqr-wedges/<id>@<version>.json`.

2. **Installing a wedge** — A business runs `zoqr install menu-display@1.0.0`. The CLI downloads the wedge config and stores it in the local DuckDB (under `wedges`).

3. **Minting a QR** — The business runs `zoqr mint my-menu --wedge menu-display --title "Café Menu"`. The CLI creates a row in `qrs` with the content schema from the wedge.

4. **Public scan** — Customer scans the QR (printed, on a sticker, etc.) → URL `https://<base>/<slug>` → zoqr-pages fetches `/api/qr/<slug>` from this server → renders the content.

5. **Editing content** — Business goes to `/admin`, picks the QR, edits blocks/form/links → saves → row in `qrs` updated → next scan picks up the new content.

## Why 3 repos, not 1?

- **Separation of concerns.** The server (this repo) doesn't know what a wedge is — wedges are JSON. The CLI doesn't render anything. The pages repo doesn't store anything.
- **Independent lifecycles.** A wedge can be updated without redeploying the server. The pages repo can be served from a CDN.
- **Tenant data isolation.** Each business's `tenants/<name>/` directory is theirs. We don't want wedge configs or page templates mixed with their content.
- **Federation.** Anyone can publish a wedge. Anyone can deploy their own zoqr instance and point it at their own tenants.

## Multi-tenancy

The single env var `ZOQR_TENANT` selects the active tenant (default: `demo`). The header `X-ZoQR-Tenant` overrides per-request. Each tenant gets its own DuckDB file — there is no shared state across tenants in this repo.

**Why per-tenant DB?** It allows easy backup (copy the dir), easy migration, easy deletion, and zero cross-tenant leakage. The cost is that you can't run cross-tenant analytics from this server — that's what the zoqr-skill's `zoqr scans --all` is for.

## What this server is NOT

- **Not a CDN.** Public pages live in `zoqr-pages` and can be served from anywhere. This server is the API.
- **Not a multi-tenant SaaS.** Tenants are file-scoped. If you want SaaS, layer that on top.
- **Not a payment processor.** Forms can capture submission data (and store in DuckDB), but payments require a third-party integration.
