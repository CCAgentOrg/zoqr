# AGENTS.md — ZoQR API & Admin

> Onboarding guide for AI agents working in this repo.

## What this is
`zoqr` is the **API + Admin dashboard** for the ZoQR platform. It is the management interface for businesses to create QR codes, manage their content (rich text, images, files, links), and generate short URLs that point to public landing pages.

This is **repo 1 of 3** in the ZoQR platform:
- [CCAgentOrg/zoqr](https://github.com/CCAgentOrg/zoqr) ← you are here
- [CCAgentOrg/zoqr-pages](https://github.com/CCAgentOrg/zoqr-pages) — Public landing pages
- [CCAgentOrg/zoqr-skill](https://github.com/CCAgentOrg/zoqr-skill) — CLI tool

## Repo layout

```
zoqr/
├── src/
│   ├── server.ts             # Hono entry point (port 3000)
│   ├── db.ts                 # DuckDB schema + helpers (per-tenant)
│   ├── routes/
│   │   ├── api.ts            # /api/qr/:slug, /api/submit
│   │   └── admin.ts          # /admin/* (auth-gated)
│   ├── pages/                # React SPA — admin UI
│   │   └── admin.tsx
│   └── lib/                  # Shared utilities (auth, slugify, validation)
├── tenants/                  # Per-tenant data dir (gitignored)
├── docs/
│   ├── architecture.md
│   └── api.md
├── examples/                 # Sample wedge configs + curl commands
├── package.json
├── tsconfig.json
└── README.md
```

## Conventions for AI agents

### Code style
- TypeScript strict mode. No `any` without a comment justifying it.
- ESM imports. Use `bun:test` for tests.
- All routes return JSON. Admin pages return HTML.
- Schemas: `zod` for request validation, parse at the route boundary.

### Database
- **Per-tenant**: every business has its own DuckDB file at `tenants/<tenant>/data.duckdb`.
- **Schema is owned by `src/db.ts`**. Always check there before adding fields.
- Tables: `wedges`, `qrs`, `scans`, `submissions`.
- **Never write SQL in route handlers**. Put it in `src/db.ts` and import.

### Adding a new API endpoint
1. Add the SQL helper to `src/db.ts`.
2. Add the zod schema to `src/lib/schemas.ts`.
3. Add the route to `src/routes/api.ts` (public) or `src/routes/admin.ts` (gated).
4. Add a curl example to `docs/api.md`.
5. If the admin UI should expose it, add a React component to `src/pages/admin.tsx`.

### Testing
- `bun test` runs all `*.test.ts` files.
- Mock DuckDB with an in-memory `bun:sqlite` for tests.

## Routes (current)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/qr/:slug` | none | Fetch a QR's content (used by zoqr-pages) |
| POST | `/api/submit` | none | Submit a form attached to a QR |
| GET | `/admin/qr` | bearer | List QRs for current tenant |
| POST | `/admin/qr` | bearer | Create a new QR |
| PATCH | `/admin/qr/:slug` | bearer | Update QR content |
| DELETE | `/admin/qr/:slug` | bearer | Deactivate QR |

## Environment

- `PORT` (default `3000`)
- `ZOQR_TENANT` (default `demo`) — which tenant dir to use
- `ZOQR_API_TOKEN` — required for `/admin/*` routes

## How this connects to other repos

- **zoqr-skill** writes to the same `data.duckdb` schema (in a tenant dir on the user's Zo).
- **zoqr-pages** calls `/api/qr/:slug` to fetch content and renders it.

When a business mints a QR via the CLI, the CLI writes to its local DuckDB. The API server reads from the same DuckDB file. The public page fetches via the API.