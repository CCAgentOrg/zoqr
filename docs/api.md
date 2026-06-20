# ZoQR — API Reference

Base URL: `https://<your-zoqr-instance>/`

All endpoints accept the optional header `X-ZoQR-Tenant: <tenant>` to override the default tenant.

---

## Public API — read-only

### `GET /api/qr/:slug`

Returns a single active QR and its content.

```bash
curl https://<host>/api/qr/my-menu
```

Response:
```json
{
  "slug": "my-menu",
  "title": "Café Menu",
  "wedge_id": "menu-display",
  "wedge_version": "1.0.0",
  "blocks": [{"type": "text", "html": "<h1>Today's specials</h1>"}],
  "form": null,
  "meta": {"location": "Table 3"}
}
```

### `GET /api/qrs?limit=50`

List active QRs (for sitemaps / directories).

### `POST /api/submit`

Record a form submission.

```bash
curl -X POST https://<host>/api/submit \
  -H "Content-Type: application/json" \
  -d '{"slug":"my-menu","fields":{"rating":"5","comment":"Loved it"}}'
```

### `POST /api/scan`

Log a scan event. Called automatically by `zoqr-pages`.

```bash
curl -X POST https://<host>/api/scan \
  -H "Content-Type: application/json" \
  -d '{"slug":"my-menu","ua":"Mozilla/5.0...","ts":1700000000}'
```

---

## Admin API — bearer token required

All `/admin/api/*` routes require `Authorization: Bearer <token>`.

The token can be:
- The master `ZOQR_API_TOKEN` env var (super-admin, all tenants)
- A per-tenant token stored in the `wedges.api_token` column

### `GET /admin/api/qrs`

List QRs for the current tenant.

### `POST /admin/api/qrs`

Create a new QR.

```bash
curl -X POST https://<host>/admin/api/qrs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "table-3",
    "title": "Table 3 Menu",
    "wedge_id": "menu-display",
    "blocks": [{"type": "text", "html": "<p>Today's specials</p>"}],
    "form": null
  }'
```

### `PATCH /admin/api/qrs/:slug`

Update fields on an existing QR (partial merge).

### `DELETE /admin/api/qrs/:slug`

Delete a QR.

### `GET /admin/api/wedges`

List installed wedges for this tenant.

### `POST /admin/api/wedges`

Install a wedge by ID + version.

### `DELETE /admin/api/wedges/:id`

Uninstall a wedge.

### `GET /admin/api/registry`

Browse the upstream wedge registry (defaults to
`CCAgentOrg/zoqr-wedges/main/INDEX.json`, override via
`ZOQR_REGISTRY_URL`). Returns each wedge enriched with `name`,
`description`, and `category` from its `manifest.json`.

Cached in-memory for 5 minutes; pass `?fresh=1` to bypass. Falls back
to the stale cache if the upstream is unreachable and adds `stale: true`.
On cache miss + upstream down, returns HTTP 502.

```json
{
  "source": "https://raw.githubusercontent.com/.../INDEX.json",
  "wedges": [
    {
      "id": "menu-display",
      "name": "Café Menu Display",
      "description": "Restaurant/café table QR. ...",
      "category": "restaurant",
      "latest": "1.0.0",
      "versions": ["1.0.0"],
      "homepage": "https://github.com/.../menu-display/1.0.0"
    }
  ],
  "cached": false,
  "age_ms": 0
}
```

### `GET /admin/api/scans?slug=...&limit=100`

Recent scan events for a QR.

### `GET /admin/api/submissions?slug=...&limit=100`

Form submissions for a QR.

---

## Error format

All errors return JSON:

```json
{ "error": "Not found" }
```

Status codes: 400 (bad request / validation), 401 (no token), 403 (wrong tenant), 404 (not found), 409 (slug collision), 500 (server error).
