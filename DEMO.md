# ZoQR — Demo Guide

> **Zo Ambassador Build Challenge — June 2026**
> Theme: *Small Businesses*
> Submit by: **June 25**

---

## What judges see (60-second pitch)

**ZoQR is a QR-code management platform for physical spaces.** A café pastes a QR on every table, a library on every shelf, a gym on every machine — each QR opens a landing page with rich content (menu, hours, booking form) that the owner edits from a dashboard. Scans and form submissions are tracked. Wedges (reusable templates) are published to a public registry so any business can install them in one click.

**Built entirely on Zo:** Hono API server (user service), Tailscale Funnel for public access, GitHub repos for the wedge registry, and the zoqr-skill for CLI authoring.

---

## Live URLs

| Surface | URL | Purpose |
|---------|-----|---------|
| **API + Admin** | `https://zocomp.hen-economy.ts.net` | API + admin dashboard |
| **Admin login** | `https://zocomp.hen-economy.ts.net/admin` | Enter token below |
| **Public pages** | `https://ccagentorg.github.io/zoqr-pages/` | Static renderer (GitHub Pages) |
| **Wedge registry** | `https://github.com/CCAgentOrg/zoqr-wedges` | 12 wedges, INDEX.json |
| **GitHub repos** | `CCAgentOrg/zoqr` · `zoqr-pages` · `zoqr-wedges` | Source code |

### Demo credentials

```
Admin token:  zoqr-demo-2026-cashless
Tenant:       library  (or demo)
```

---

## Demo script (walk through in order)

### 1. Open the admin dashboard

```
URL: https://zocomp.hen-economy.ts.net/admin
Token: zoqr-demo-2026-cashless
Tenant: library
```

→ Sidebar shows **21 QRs** grouped across locations (Reading Room, Entry Hallway, Lobby).
→ Location and tag filters narrow the list.
→ Each QR shows its wedge, location, and status.

### 2. Show a public landing page

Click **table-5** in the sidebar → see its content (heading + booking info + form).
Or open directly:

```
https://zocomp.hen-economy.ts.net/q/table-5?tenant=library
```

→ Mobile-first page renders blocks (text, links, forms).
→ Scan count is tracked automatically (visible in admin stats).

### 3. Generate a QR code (SVG)

```
https://zocomp.hen-economy.ts.net/q/table-5/qr.svg?tenant=library
```

→ Returns a crisp vector QR that points at the landing page.
→ Available as SVG (print-ready) or PNG.

### 4. Print sheet (the killer feature)

From the admin sidebar, click **"Print sheet"** → opens:

```
https://zocomp.hen-economy.ts.net/admin/api/print?tenant=library
```

→ A4-friendly grid of all 21 QRs, each with its QR image, title, and slug.
→ Filter by location: `?location=Reading%20Room` → 12 tables only.
→ Browser's **Print** button → physical stickers ready to cut.

### 5. Bulk create QRs

Click **"+ Bulk"** in the sidebar → modal with a multi-line textarea:

```
table-13-16    Reading Room Tables    Reading Room    table,reading-room
```

→ Parses the range (table-13, table-14, table-15, table-16).
→ Click **"Create 4 QR(s)"** → 4 new QRs appear instantly.
→ Each QR is independently editable.

### 6. Browse the wedge registry

Click **"Browse wedge registry"** → modal with 12 community wedges:

- `menu-display` (restaurant) — café table QR with menu
- `customer-feedback` (restaurant) — dish feedback form
- `gym-equipment-report` (gym) — broken machine reporting
- `facility-maintenance-request` (facilities) — work order form
- `asset-tag-inventory` (asset-mgmt) — service history lookup
- `event-check-in` (event) — attendee check-in
- + 6 more

→ Click **Install** on any wedge → it's added to the tenant.
→ New QRs can be created from that wedge with its default content.

### 7. Edit a QR's content

Click any QR → edit title, add blocks (text, image, file, link, video), toggle a form.
→ Click **Save** → the public page updates instantly (no deploy needed).

### 8. Show form submission

Open the feedback-desk QR:

```
https://zocomp.hen-economy.ts.net/q/feedback-desk?tenant=library
```

→ Fill the form → submit → "Thanks! We received your submission."
→ Back in admin: submissions are stored per-QR in DuckDB.

### 9. Show scan analytics

In admin, the stats grid per QR shows **Scans** count (auto-tracked on page load).
→ The `/admin/api/scans/:slug` endpoint returns daily breakdowns.

---

## How it uses Zo

| Zo capability | How ZoQR uses it |
|---------------|------------------|
| **User Service** (HTTP) | Hono + Bun server on port 3000, proxied via Tailscale Funnel |
| **Tailscale Funnel** | Public HTTPS URL without custom DNS — `zocomp.hen-economy.ts.net` |
| **GitHub integration** (`gh` CLI) | Wedge registry at `CCAgentOrg/zoqr-wedges`, source repos under `CCAgentOrg` |
| **DuckDB** (via `bun:sqlite`) | Per-tenant data isolation — `tenants/<tenant>/data.duckdb` |
| **Skills** (`Skills/zoqr/`) | CLI tool for authoring, minting, and publishing wedges |

---

## Two demo tenants

### `demo` — Café

| Slug | Content |
|------|---------|
| `test-cafe` | Menu + rating form |
| `coffee-corner` | Menu with prices |
| `test-cafe-xkzk` | Auto-generated variant |

### `library` — Public Library

| Slug | Location | Content |
|------|----------|---------|
| `table-1` through `table-12` | Reading Room | Table-specific info + booking |
| `locker-a` through `locker-d` | Entry Hallway | Storage locker info |
| `front-desk` | Lobby | Hours + ask-a-librarian form |
| `study-room-1` | — | Room reservation form |
| `new-arrivals` | — | Weekly arrivals + feedback |
| `feedback-desk` | — | Patron feedback form |
| `maker-lab` | — | Equipment booking |

---

## Architecture (for judges who ask)

```
┌─────────────────────────────────────────────┐
│  zoqr (API + Admin)                         │
│  Bun + Hono + DuckDB + React SPA            │
│  Port 3000 → Tailscale Funnel → HTTPS       │
└──────────────────┬──────────────────────────┘
                   │
       ┌───────────┼───────────────┐
       ▼           ▼               ▼
  ┌─────────┐ ┌──────────┐  ┌──────────────┐
  │ tenants │ │ zoqr-    │  │ zoqr-wedges  │
  │ /demo   │ │ pages    │  │ (GitHub)     │
  │ /library│ │ (GitHub  │  │ INDEX.json + │
  │ .duckdb │ │  Pages)  │  │ 12 wedges    │
  └─────────┘ └──────────┘  └──────────────┘
```

- **Per-tenant isolation**: every business gets its own DuckDB file. No cross-tenant joins.
- **Data sovereignty**: scans, submissions, and QR content stay on the tenant's server. The registry ships only templates.
- **Zero build step**: admin SPA is plain React + htm, no Vite, no webpack.

---

## What makes this different from QR SaaS (Beaconstac, MenuTiger)

1. **Self-hosted.** Data never leaves the business's own server.
2. **Wedge marketplace.** Templates are open, forkable, and authored by the community — not locked in a vendor CMS.
3. **Range-based bulk minting.** `table-1-12` → 12 QRs in one POST. Built for physical-space scale.
4. **Print-ready output.** Server-rendered SVG QRs + A4 print sheet with one click.
5. **API-first.** Every feature has a curl equivalent. POS/CRM integrations are a PATCH away.

---

## 60-second video outline

1. **0:00–0:10** — "This is ZoQR. QR management for any physical space."
2. **0:10–0:20** — Open admin dashboard, show 21 library QRs.
3. **0:20–0:30** — Click "Bulk" → type `table-13-16` → 4 QRs created instantly.
4. **0:30–0:40** — Click "Print sheet" → show the A4 grid → hit Print.
5. **0:40–0:50** — Open a landing page on phone (or browser) → show menu + form → submit.
6. **0:50–1:00** — "Scan tracking, form submissions, wedge marketplace. Built on Zo."

---

## Checklist

- [x] Live URL (Tailscale Funnel: `zocomp.hen-economy.ts.net`)
- [x] Admin dashboard (React SPA at `/admin`)
- [x] Two demo tenants (café + library)
- [x] 24 QRs with real content across 6 locations
- [x] Bulk create with range parsing (`table-1-12`, `locker-a-d`)
- [x] Print sheet (A4, filterable by location/tag)
- [x] QR SVG + PNG generation (server-rendered)
- [x] Form submission (stored in DuckDB)
- [x] Scan tracking (auto-logged on page load)
- [x] Wedge registry (12 wedges, browse + install from admin)
- [x] Public GitHub repos (3 repos under `CCAgentOrg`)
- [x] GitHub Pages deployment (zoqr-pages)
- [ ] 60-second video walkthrough

---

*Built for the [Zo Ambassador Build Challenge](https://ambassador.zo.space/build-challenge) — June 2026.*
