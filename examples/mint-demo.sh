#!/bin/bash
# Mint your first QR in 60 seconds.
#
# Prereqs:
#   - bun installed
#   - server running: `bun run dev` in another terminal
#   - ZOQR_API_TOKEN exported
#
# Usage: ./examples/mint-demo.sh

set -euo pipefail
HOST="${ZOQR_HOST:-http://localhost:3000}"
TOKEN="${ZOQR_API_TOKEN:?export ZOQR_API_TOKEN first}"

echo "1. Install the menu-display wedge"
curl -sS -X POST "$HOST/admin/api/wedges" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id":"menu-display","name":"Menu Display","version":"1.0.0","base_url":"https://github.com/CCAgentOrg/zoqr-wedges","content_schema":{"blocks":[]}}'
echo

echo "2. Create a QR"
curl -sS -X POST "$HOST/admin/api/qrs" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "table-3",
    "title": "Table 3 — Today'\''s Menu",
    "wedge_id": "menu-display",
    "blocks": [
      {"type": "text", "html": "<h1>Today</h1><ul><li>Masala Dosa — ₹80</li><li>Filter Coffee — ₹30</li></ul>"},
      {"type": "link", "href": "https://maps.google.com/?q=us", "label": "Find us"}
    ],
    "form": {
      "fields": [
        {"key": "rating", "label": "How was it?", "type": "select", "options": ["1","2","3","4","5"]},
        {"key": "comment", "label": "Comments", "type": "text", "optional": true}
      ]
    }
  }'
echo

echo "3. Fetch it"
curl -sS "$HOST/api/qr/table-3" | head -c 500
echo
